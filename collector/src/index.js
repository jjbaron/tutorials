#!/usr/bin/env node
// Repo Yard collector.
//   node src/index.js run     [--config config.json]   serve the page with live data
//   node src/index.js once    [--config config.json]   one sync, write snapshot.json, print a summary
//   node src/index.js doctor  [--config config.json]   check every credential and connection
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createGitHub } from './sources/github.js';
import { createJenkins } from './sources/jenkins.js';
import { createK8s, kubectlRunner } from './sources/k8s.js';
import { createCollector } from './collector.js';
import { createServer } from './server.js';
import { doctor } from './doctor.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cmd = args.find(a => !a.startsWith('--')) || 'run';
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

// Optional .env file next to the config (KEY=value lines) so tokens need not be exported by hand.
function loadDotEnv(dir) {
  const p = path.join(dir, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function buildSources(cfg) {
  const ghToken = process.env[cfg.github.tokenEnv];
  const gh = createGitHub({ apiUrl: cfg.github.apiUrl, token: ghToken });
  const jenkins = cfg.jenkins.url ? createJenkins({ url: cfg.jenkins.url, user: process.env[cfg.jenkins.userEnv], token: process.env[cfg.jenkins.tokenEnv] }) : null;
  const k8s = createK8s({ run: kubectlRunner(resolveKubectl(cfg)) });
  return { gh, jenkins, k8s, ghToken };
}
// Relative script paths in an array kubectl command resolve against the config folder.
function resolveKubectl(cfg) {
  const k = cfg.kubernetes.kubectl;
  if (!Array.isArray(k)) return k;
  return k.map((part, i) => (i > 0 && /\.m?js$/.test(part) && !path.isAbsolute(part) ? path.join(cfg._dir, part) : part));
}

async function main() {
  const cfgPath = opt('config') || 'config.json';
  loadDotEnv(path.dirname(path.resolve(cfgPath)));
  let cfg;
  try { cfg = loadConfig(cfgPath); } catch (e) { console.error(e.message); process.exit(2); }
  if (opt('port')) cfg.port = +opt('port');
  const src = buildSources(cfg);
  if (!src.ghToken && cmd !== 'doctor') console.warn(`Warning: ${cfg.github.tokenEnv} is not set; GitHub calls will be anonymous and heavily rate limited.`);

  if (cmd === 'doctor') { const ok = await doctor({ cfg, ...src, print: console.log }); process.exit(ok ? 0 : 1); }

  const collector = createCollector({ cfg, ...src, log });
  if (cmd === 'once') {
    const snap = await collector.cycle(['kubernetes', 'jenkins', 'github']);
    const out = opt('out') || 'snapshot.json';
    fs.writeFileSync(out, JSON.stringify(snap, null, 2));
    console.log(summarize(snap));
    console.log(`\nWrote ${out}`);
    return;
  }

  const webDir = path.resolve(here, '../../web/dist');
  const server = createServer({ host: cfg.host, port: cfg.port, webDir, getSnapshot: collector.snapshot, log });
  await server.listen();
  // one sync at a time; sources that come due while a sync runs are queued
  const due = new Set(['kubernetes', 'jenkins', 'github']);
  let busy = false;
  async function pump() {
    if (busy || !due.size) return;
    busy = true;
    const which = ['kubernetes', 'jenkins', 'github'].filter(s => due.has(s));
    due.clear();
    try { const snap = await collector.cycle(which); server.broadcast(snap); }
    catch (e) { log('sync failed:', e.message); }
    busy = false;
    setImmediate(pump);
  }
  for (const s of ['kubernetes', 'jenkins', 'github']) setInterval(() => { due.add(s); pump(); }, cfg.pollSeconds[s] * 1000);
  pump();
  log(`First sync running. Open http://${cfg.host}:${cfg.port} (the page switches to live data when it finishes).`);
}

export function summarize(s) {
  const lines = [];
  lines.push(`Sources: ` + Object.entries(s.sources).map(([k, v]) => `${k}=${v.ok === true ? 'ok' : v.ok === 'disabled' ? 'disabled' : 'ERROR'}`).join('  '));
  for (const [k, v] of Object.entries(s.sources)) if (v.errors) for (const [n, e] of Object.entries(v.errors)) lines.push(`  ${k} ${n}: ${e}`);
  for (const r of s.repos) {
    if (r.error && !r.branches) { lines.push(`\n${r.name}: ERROR ${r.error}`); continue; }
    lines.push(`\n${r.name} (${r.full}, default ${r.defaultBranch}, CI ${r.ci})`);
    lines.push(`  ${r.branches.length} branches compared${r.skippedBranches ? ` (${r.skippedBranches} skipped)` : ''}, ${r.branches.filter(b => b.pr).length} open PRs, ${r.files.length} files shown of ${r.totalSourceFiles}`);
    const rel = r.release;
    lines.push(`  release: latest ${rel.latestRelease || 'none'} · production ${rel.prodRelease || '?'} @ ${rel.prodSha ? rel.prodSha.slice(0, 12) : 'unknown'} (via ${rel.prodCommitSource || 'n/a'})`);
    lines.push(`  staged: ${rel.waitingForCut.length} waiting for cut · ${rel.inReleaseNotDeployed.length} in release, not deployed · ${rel.notBackMerged.length} not merged back`);
    for (const n of rel.notes) lines.push(`  note: ${n}`);
    for (const d of r.deployments) lines.push(`  ${d.envLabel}: ${d.namespace}/${d.name} ${d.ready}/${d.desired} ready · tag ${d.tag} · commit ${d.commit ? d.commit.slice(0, 12) + ' via ' + d.commitSource : 'UNRESOLVED'}`);
    if (!r.deployments.length) lines.push('  no matching Kubernetes deployments (check repos[].deployment / image)');
  }
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
