#!/usr/bin/env node
// Discovers how your environment is laid out and drafts a collector config, so nothing has to be typed by hand.
//
//   node scripts/discover.mjs [--repos-dir <folder with your git clones>] [--out <folder>]
//
// It runs read-only commands only: kubectl config/get, az account/aks list, git remote, and reads Jenkinsfiles.
// Output: discovery-report.md (for humans) and config.draft.json (copy to collector/config.json after review).
// Both files contain internal names (clusters, namespaces, repos). Review before sharing them.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const reposDir = path.resolve(opt('repos-dir') || path.join(process.cwd(), '..'));
const outDir = path.resolve(opt('out') || process.cwd());
const WIN = process.platform === 'win32';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TAG_UUID = new RegExp(`^dev-latest-?(${UUID})(?:-release-(\\d{2}-\\d{2}-\\d{2})-REL)?$`);
const TAG_SHA = /(^|[^0-9a-f])([0-9a-f]{40})$/;

const run = (cmd, a, timeout = 45000) => new Promise(res => {
  execFile(cmd, a, { timeout, maxBuffer: 256 * 1024 * 1024, shell: WIN, windowsHide: true }, (err, stdout, stderr) =>
    res({ ok: !err, out: stdout || '', err: err ? (stderr || err.message).trim().split('\n').slice(-3).join(' ') : null }));
});
const report = [];
const say = (s = '') => { report.push(s); console.log(s); };
const tagKind = tag => { if (!tag) return 'no tag'; const m = TAG_UUID.exec(tag); if (m) return m[2] ? `uuid + release ${m[2]}` : 'uuid (master build)'; if (TAG_SHA.test(tag)) return 'git sha'; return 'other'; };
function guessEnv(s) {
  s = (s || '').toLowerCase();
  if (/prod|prd|live/.test(s)) return 'prod';
  if (/stag|stg|preprod/.test(s)) return 'staging';
  if (/uat/.test(s)) return 'uat';
  if (/\bqa\b|-qa|qa-|test/.test(s)) return 'qa';
  if (/dev/.test(s)) return 'dev';
  return null;
}
const parseImage = img => { const noDigest = img.split('@')[0]; const slash = noDigest.lastIndexOf('/'), colon = noDigest.lastIndexOf(':'); const tag = colon > slash ? noDigest.slice(colon + 1) : null; const repo = colon > slash ? noDigest.slice(0, colon) : noDigest; return { name: repo.split('/').pop(), tag }; };

async function main() {
  say('# Repo Yard environment discovery');
  say(`Generated ${new Date().toISOString()} on ${process.platform}, Node ${process.versions.node}`);
  say('');

  /* ---------- tools ---------- */
  say('## Tools');
  const kv = await run('kubectl', ['version', '--client', '-o', 'json']);
  say(`- kubectl: ${kv.ok ? 'found' : 'NOT FOUND: install kubectl (az aks install-cli) and rerun'}`);
  const azv = await run('az', ['version', '-o', 'json']);
  say(`- az CLI: ${azv.ok ? 'found' : 'not found (optional; used to list AKS clusters)'}`);
  const kl = await run('kubelogin', ['--version']);
  say(`- kubelogin: ${kl.ok ? 'found' : 'not found (AKS with Entra ID usually needs it: az aks install-cli)'}`);
  say('');

  /* ---------- Azure ---------- */
  let aks = [];
  if (azv.ok) {
    say('## Azure');
    const acct = await run('az', ['account', 'show', '-o', 'json']);
    if (acct.ok) { const a = JSON.parse(acct.out); say(`- Signed in to subscription "${a.name}" as ${a.user && a.user.name}`); }
    else say(`- Not signed in (${acct.err}). Run: az login`);
    const subs = await run('az', ['account', 'list', '-o', 'json']);
    if (subs.ok) { const list = JSON.parse(subs.out); say(`- ${list.length} subscription(s) visible: ${list.map(s => s.name).join(', ')}`); }
    const l = await run('az', ['aks', 'list', '-o', 'json']);
    if (l.ok) {
      aks = JSON.parse(l.out);
      say(`- AKS clusters in the current subscription: ${aks.length ? '' : 'none'}`);
      for (const c of aks) say(`  - ${c.name} (resource group ${c.resourceGroup}, ${c.location}, Kubernetes ${c.kubernetesVersion}, Azure RBAC ${c.aadProfile && c.aadProfile.enableAzureRbac ? 'on' : 'off'})`);
      say('  Clusters in other subscriptions need: az account set -s <subscription> then az aks list');
    } else say(`- az aks list failed: ${l.err}`);
    say('');
  }

  /* ---------- Kubernetes ---------- */
  say('## Kubernetes contexts');
  const ctxRes = await run('kubectl', ['config', 'get-contexts', '-o', 'name']);
  const contexts = ctxRes.ok ? ctxRes.out.split(/\r?\n/).filter(Boolean) : [];
  const current = (await run('kubectl', ['config', 'current-context'])).out.trim();
  if (!contexts.length) say(`- No contexts found (${ctxRes.err || 'empty kubeconfig'}). Run: az aks get-credentials -g <resource-group> -n <cluster>`);
  const inKube = new Set();
  const found = [];   // { context, namespace, name, image, tag, kind, annotations }
  for (const ctx of contexts) {
    const d = await run('kubectl', ['--context', ctx, 'get', 'deployments', '-A', '-o', 'json', '--request-timeout=30s'], 90000);
    if (!d.ok) { say(`- **${ctx}**${ctx === current ? ' (current)' : ''}: cannot list deployments: ${d.err}`); continue; }
    const items = JSON.parse(d.out).items || [];
    const nodes = await run('kubectl', ['--context', ctx, 'get', 'nodes', '-o', 'json', '--request-timeout=30s']);
    const nodeCount = nodes.ok ? (JSON.parse(nodes.out).items || []).length : null;
    say(`- **${ctx}**${ctx === current ? ' (current)' : ''}: ${items.length} deployments, ${nodeCount == null ? 'nodes not readable' : nodeCount + ' nodes'}`);
    for (const it of items) {
      if (/^(kube-|gatekeeper|calico|tigera|azure-|cert-manager|ingress|monitoring|flux|argocd)/.test(it.metadata.namespace)) continue;
      const img = ((it.spec.template.spec.containers || [])[0] || {}).image || '';
      const { name, tag } = parseImage(img);
      found.push({ context: ctx, namespace: it.metadata.namespace, name: it.metadata.name, image: name, tag, kind: tagKind(tag), annotations: Object.keys(Object.assign({}, it.metadata.annotations, it.spec.template.metadata && it.spec.template.metadata.annotations)) });
      inKube.add(name);
    }
  }
  say('');
  say('## Application deployments and their image tags');
  if (!found.length) say('None found (system namespaces are skipped).');
  else {
    say('| Context | Namespace | Deployment | Image | Tag kind | Tag |');
    say('|---|---|---|---|---|---|');
    for (const f of found) say(`| ${f.context} | ${f.namespace} | ${f.name} | ${f.image} | ${f.kind} | \`${f.tag || ''}\` |`);
  }
  const withAnn = found.filter(f => f.annotations.includes('repo-yard/commit'));
  say('');
  say(`- Deployments with the repo-yard/commit annotation: ${withAnn.length ? withAnn.map(f => f.name).join(', ') : 'none yet (see HANDOFF.md, "Commit annotation")'}`);
  say('');

  /* ---------- git repos and Jenkinsfiles ---------- */
  say(`## Local git clones under ${reposDir}`);
  const remotes = [];
  const jenkinsLines = [];
  const walk = (dir, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', '.git', 'target', 'build', 'dist'].includes(e.name) && depth < 3) walk(p, depth + 1); }
      else if (/^Jenkinsfile/.test(e.name)) {
        const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
        lines.forEach((l, i) => { if (/dev-latest|docker (build|push)|docker\.build|\btag\b.*=|kubectl|helm |--context|--namespace|\s-n\s|az aks|UUID|randomUUID|uuidgen/i.test(l)) jenkinsLines.push(`${path.relative(reposDir, p)}:${i + 1}: ${l.trim().slice(0, 200)}`); });
      }
    }
  };
  let subdirs = [];
  try { subdirs = fs.readdirSync(reposDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(reposDir, e.name)); } catch { /* ignore */ }
  for (const d of subdirs) {
    if (!fs.existsSync(path.join(d, '.git'))) continue;
    const r = await run('git', ['-C', d, 'remote', 'get-url', 'origin'], 10000);
    const m = r.ok && /github\.com[:/]([^/]+)\/([^/.\s]+)/.exec(r.out.trim());
    if (m) remotes.push({ dir: path.basename(d), org: m[1], repo: m[2] });
    walk(d, 0);
  }
  if (!remotes.length) say('No GitHub clones found here. Rerun with --repos-dir pointing at the folder that holds your clones.');
  for (const r of remotes) say(`- ${r.dir}: github.com/${r.org}/${r.repo}${inKube.has(r.repo) ? ' (deployed)' : ''}`);
  say('');
  say('## Jenkinsfile lines about image tags and deploys');
  if (!jenkinsLines.length) say('No Jenkinsfiles found under the clones.');
  for (const l of jenkinsLines.slice(0, 80)) say(`    ${l}`);
  say('');

  /* ---------- draft config ---------- */
  const orgCounts = {};
  for (const r of remotes) orgCounts[r.org] = (orgCounts[r.org] || 0) + 1;
  const org = Object.entries(orgCounts).sort((a, b) => b[1] - a[1])[0];
  const appDeps = found.filter(f => f.kind !== 'other' && f.kind !== 'no tag');
  const groups = new Map();
  for (const f of appDeps) {
    const env = guessEnv(f.namespace) || guessEnv(f.context) || f.context;
    const byNs = !!guessEnv(f.namespace);
    const key = `${env}|${f.context}`;
    if (!groups.has(key)) groups.set(key, { name: env, context: f.context, namespaces: new Set(), byNs });
    groups.get(key).namespaces.add(f.namespace);
  }
  const order = ['dev', 'qa', 'uat', 'staging', 'prod'];
  const environments = [...groups.values()].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)).map(g => ({
    name: g.name, label: g.name === 'prod' ? 'Production' : g.name.charAt(0).toUpperCase() + g.name.slice(1), context: g.context,
    namespaces: [...g.namespaces], ...(g.name === 'prod' ? { production: true } : {})
  }));
  if (environments.length && !environments.some(e => e.production)) environments[environments.length - 1].production = true;
  const repoNames = [...new Set(appDeps.map(f => f.image))];
  const draft = {
    port: 7777,
    github: { org: org ? org[0] : 'YOUR-GITHUB-ORG', tokenEnv: 'GITHUB_TOKEN' },
    jenkins: { url: process.env.JENKINS_URL || 'https://YOUR-JENKINS-HOST', userEnv: 'JENKINS_USER', tokenEnv: 'JENKINS_TOKEN' },
    kubernetes: { environments },
    repos: repoNames.map(n => {
      const dep = appDeps.find(f => f.image === n);
      const remote = remotes.find(r => r.repo === n);
      return { name: n, ...(remote && org && remote.org !== org[0] ? { fullName: `${remote.org}/${remote.repo}` } : {}), team: null, jenkinsJob: n, deployment: dep.name, image: n };
    })
  };
  fs.writeFileSync(path.join(outDir, 'config.draft.json'), JSON.stringify(draft, null, 2) + '\n');
  say('## Draft config');
  say(`Wrote config.draft.json with ${environments.length} environment(s) and ${draft.repos.length} repo(s).`);
  say('Check: environment names and which one is production, repo names matching GitHub, the Jenkins URL, and jenkinsJob paths (copy them from the job URL in Jenkins).');
  fs.writeFileSync(path.join(outDir, 'discovery-report.md'), report.join('\n') + '\n');
  console.log(`\nWrote ${path.join(outDir, 'discovery-report.md')} and config.draft.json. They contain internal names; review before sharing.`);
}
main().catch(e => { console.error(e); process.exit(1); });
