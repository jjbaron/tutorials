// Runs the real collector against the mock world over HTTP and the fake kubectl.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveWorld } from '../dev/mock-world.mjs';
import { loadConfig } from '../src/config.js';
import { createGitHub } from '../src/sources/github.js';
import { createJenkins } from '../src/sources/jenkins.js';
import { createK8s, kubectlRunner } from '../src/sources/k8s.js';
import { createCollector } from '../src/collector.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = 7799;
let mock, collector;

before(async () => {
  mock = await serveWorld({ port: PORT, tickSeconds: 0, quiet: true });
  process.env.REPO_YARD_MOCK_URL = `http://127.0.0.1:${PORT}`;
  const cfg = loadConfig(path.join(dir, '../config.mock.json'));
  cfg.github.apiUrl = `http://127.0.0.1:${PORT}/gh`;
  cfg.jenkins.url = `http://127.0.0.1:${PORT}/jenkins`;
  const gh = createGitHub({ apiUrl: cfg.github.apiUrl, token: 't' });
  const jenkins = createJenkins({ url: cfg.jenkins.url, user: 'u', token: 't' });
  const k8s = createK8s({ run: kubectlRunner(['node', path.join(dir, '../dev/fake-kubectl.mjs')]) });
  collector = createCollector({ cfg, gh, jenkins, k8s });
});
after(async () => { await mock.close(); });

test('first sync resolves commits three ways and computes release stages', async () => {
  const s = await collector.cycle(['kubernetes', 'jenkins', 'github']);
  assert.equal(s.schema, 'repo-yard/1');
  assert.equal(s.sources.github.ok, true);
  assert.equal(s.sources.jenkins.ok, true);
  assert.equal(s.sources.kubernetes.ok, true);
  const by = n => s.repos.find(r => r.name === n);
  const prodOf = n => s.deployments.find(d => d.repo === n && d.production);
  assert.equal(prodOf('payments-api').commitSource, 'jenkins build');
  assert.equal(prodOf('checkout-web').commitSource, 'image tag');
  assert.equal(prodOf('inventory-svc').commitSource, 'annotation');
  assert.equal(prodOf('payments-api').releaseBranch, 'release/26.09.28.REL');
  const rel = by('payments-api').release;
  assert.equal(rel.latestRelease, 'release/26.10.05.REL');
  assert.equal(rel.waitingForCut.length, 4);
  assert.equal(rel.inReleaseNotDeployed.length, 9);
  assert.equal(rel.notBackMerged.length, 1, 'the hotfix is flagged; the cherry-pick is not');
  assert.match(rel.notBackMerged[0].message, /Hotfix/);
  assert.ok(Array.isArray(rel.notOnEnv.dev) && rel.notOnEnv.dev.length === 2, 'dev runs a master build two commits back');
  const pr = by('payments-api').branches.find(b => b.name === 'feature/PAY-1421-partial-refunds').pr;
  assert.equal(pr.state, 'in_review');
  assert.ok(s.events.length > 0, 'first snapshot seeds the feed');
  assert.ok(s.clusters.find(c => c.env === 'prod').nodes.length === 4);
});

test('later syncs turn changes into feed events', async () => {
  for (let i = 0; i < 40; i++) mock.world.tick();
  const before = collector.state.events.length;
  const s = await collector.cycle(['kubernetes', 'jenkins', 'github']);
  assert.ok(s.version >= 2);
  const fresh = collector.state.events.slice(0, collector.state.events.length - before);
  assert.ok(fresh.length > 0, 'expected new events after the team worked');
  const kinds = new Set(fresh.map(e => e.kind));
  assert.ok(kinds.size >= 2, `expected several kinds of events, got ${[...kinds]}`);
});

test('unchanged data is served from the ETag cache', async () => {
  const gh = createGitHub({ apiUrl: `http://127.0.0.1:${PORT}/gh`, token: 't' });
  await gh.repo('acme/payments-api');
  await gh.repo('acme/payments-api');
  assert.equal(gh.stats.notModified, 1);
});
