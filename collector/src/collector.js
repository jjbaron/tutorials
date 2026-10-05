// The collector engine: polls sources, resolves running commits, assembles the snapshot the page reads,
// and turns differences between snapshots into feed events.
import { syncRepo } from './repo-sync.js';
import { normBuild } from './sources/jenkins.js';
import { compileTagPatterns, parseTag } from './model.js';
import { repoFullName } from './config.js';

export const SCHEMA = 'repo-yard/1';

export function createCollector({ cfg, gh, jenkins, k8s, log = () => {}, onSnapshot = () => {} }) {
  const tagRes = compileTagPatterns(cfg.images.tagPatterns);
  const envs = cfg.kubernetes.environments || [];
  const st = {
    k8s: {}, k8sErr: {}, builds: {}, jenkinsErr: {}, uuidIndex: new Map(), scanned: new Set(),
    repos: {}, repoErr: {}, events: [], snapshot: null, version: 0,
    sources: { github: { ok: null }, jenkins: { ok: cfg.jenkins.url ? null : 'disabled' }, kubernetes: { ok: envs.length ? null : 'disabled' } }
  };

  /* ---------- Kubernetes ---------- */
  async function syncK8s() {
    if (!envs.length) return;
    let okCount = 0;
    await Promise.all(envs.map(async env => {
      try { st.k8s[env.name] = await k8s.env(env); delete st.k8sErr[env.name]; okCount++; }
      catch (e) { st.k8sErr[env.name] = e.message; log(`kubernetes ${env.name}: ${e.message}`); }
    }));
    st.sources.kubernetes = { ok: okCount === envs.length, partial: okCount > 0 && okCount < envs.length, lastSync: Date.now(), errors: { ...st.k8sErr } };
  }

  /* ---------- Jenkins ---------- */
  const consoleRe = () => new RegExp(cfg.images.consoleTagPattern, 'g');
  function indexText(text, build) {
    for (const m of (text || '').matchAll(consoleRe())) if (!st.uuidIndex.has(m[1])) st.uuidIndex.set(m[1], build);
  }
  async function syncJenkins() {
    if (!jenkins) return;
    let ok = true;
    for (const rc of cfg.repos.filter(r => r.jenkinsJob)) {
      try {
        const jobs = await jenkins.branchJobs(rc.jenkinsJob, cfg.jenkins.buildsPerBranch);
        if (!jobs) { st.jenkinsErr[rc.name] = `Jenkins job "${rc.jenkinsJob}" not found`; ok = false; continue; }
        const builds = [];
        for (const j of jobs) for (const b of j.builds) {
          const nb = normBuild(b, rc.name, j.branch);
          builds.push(nb);
          indexText(nb.text, nb);
        }
        builds.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
        st.builds[rc.name] = builds;
        delete st.jenkinsErr[rc.name];
      } catch (e) { st.jenkinsErr[rc.name] = e.message; ok = false; log(`jenkins ${rc.name}: ${e.message}`); }
    }
    if (cfg.jenkins.searchConsoleForTags) await scanConsoles();
    st.sources.jenkins = { ok, lastSync: Date.now(), errors: { ...st.jenkinsErr }, calls: jenkins.stats.calls, indexedTags: st.uuidIndex.size };
  }
  // Read console logs of recent builds until every running image build id is mapped to a build.
  async function scanConsoles() {
    const wanted = new Map();   // uuid -> { repo, branchHint }
    for (const d of runningDeployments()) if (d.tagInfo && d.tagInfo.uuid && !st.uuidIndex.has(d.tagInfo.uuid) && d.repo) wanted.set(d.tagInfo.uuid, { repo: d.repo, branch: d.tagInfo.releaseBranch });
    if (!wanted.size) return;
    let budget = cfg.jenkins.maxConsoleScansPerCycle;
    for (const [uuid, w] of wanted) {
      const builds = (st.builds[w.repo] || []).filter(b => !st.scanned.has(b.url) && b.status !== 'running')
        .sort((a, b) => ((b.branch === w.branch) - (a.branch === w.branch)) || (b.startedAt || 0) - (a.startedAt || 0));
      for (const b of builds) {
        if (st.uuidIndex.has(uuid) || budget <= 0) break;
        budget--;
        try { indexText(await jenkins.consoleText(b.url), b); st.scanned.add(b.url); }
        catch (e) { log(`jenkins console ${b.url}: ${e.message}`); }
      }
    }
  }

  /* ---------- running deployments → repos and commits ---------- */
  function repoForDeployment(d) {
    for (const rc of cfg.repos) {
      if ((rc.deployment || rc.name) === d.name) return rc.name;
      if (d.imageInfo && (rc.image || rc.name) === d.imageInfo.name) return rc.name;
    }
    return null;
  }
  function runningDeployments() {
    const out = [];
    for (const env of envs) {
      const e = st.k8s[env.name]; if (!e) continue;
      for (const d of e.deployments) {
        const repo = repoForDeployment(d);
        if (!repo) continue;
        const tagInfo = d.imageInfo ? parseTag(d.imageInfo.tag, tagRes, cfg.images.releaseBranchTemplate) : null;
        let sha = null, source = null;
        const ann = d.annotations && d.annotations[cfg.kubernetes.commitAnnotation];
        if (ann && /^[0-9a-f]{7,40}$/.test(ann)) { sha = ann; source = 'annotation'; }
        else if (tagInfo && tagInfo.sha) { sha = tagInfo.sha; source = 'image tag'; }
        else if (tagInfo && tagInfo.uuid && st.uuidIndex.has(tagInfo.uuid)) { sha = st.uuidIndex.get(tagInfo.uuid).sha; source = 'jenkins build'; }
        const build = tagInfo && tagInfo.uuid ? st.uuidIndex.get(tagInfo.uuid) || null : null;
        let releaseBranch = (tagInfo && tagInfo.releaseBranch) || null;
        if (!releaseBranch && build && build.branch && new RegExp(cfg.github.releaseBranchPattern).test(build.branch)) releaseBranch = build.branch;
        out.push({ ...d, repo, production: !!env.production, envLabel: env.label || env.name, tagInfo, commit: sha, commitSource: source, build: build ? { label: build.label, url: build.url, number: build.number } : null, releaseBranch });
      }
    }
    return out;
  }
  function deployedFor(repo) {
    const ds = runningDeployments().filter(d => d.repo === repo);
    const prod = ds.find(d => d.production);
    return {
      production: prod ? { sha: prod.commit, releaseBranch: prod.releaseBranch, commitSource: prod.commitSource, tag: prod.imageInfo && prod.imageInfo.tag } : null,
      preprod: ds.filter(d => !d.production).map(d => ({ env: d.env, sha: d.commit, releaseBranch: d.releaseBranch }))
    };
  }

  /* ---------- GitHub ---------- */
  async function syncGithub() {
    let ok = true;
    for (const rc of cfg.repos) {
      const full = repoFullName(cfg, rc);
      try {
        st.repos[rc.name] = await syncRepo({ gh, cfg, rc, full, prev: st.repos[rc.name], deployed: deployedFor(rc.name), log });
        delete st.repoErr[rc.name];
      } catch (e) { st.repoErr[rc.name] = e.message; ok = false; log(`github ${full}: ${e.message}`); }
    }
    st.sources.github = { ok, lastSync: Date.now(), errors: { ...st.repoErr }, calls: gh.stats.calls, notModified: gh.stats.notModified, rateRemaining: gh.stats.remaining, rateLimit: gh.stats.limit, rateReset: gh.stats.reset };
  }

  /* ---------- snapshot ---------- */
  function buildSnapshot() {
    const running = runningDeployments();
    const repos = cfg.repos.map(rc => {
      const r = st.repos[rc.name];
      const jb = st.builds[rc.name] || [];
      const runs = (r && r.runs) || [];
      const builds = [...jb, ...runs].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 40).map(({ text, ...b }) => b);
      const ci = rc.ci && rc.ci !== 'auto' ? rc.ci : (runs.length && (!jb.length || (runs[0].startedAt || 0) > (jb[0].startedAt || 0)) ? 'actions' : 'jenkins');
      const deps = running.filter(d => d.repo === rc.name);
      if (!r) return { name: rc.name, team: rc.team || null, lib: !!rc.lib, ci, error: st.repoErr[rc.name] || 'not synced yet', builds, deployments: deps.map(depSummary) };
      return {
        name: rc.name, full: r.full, team: rc.team || null, lib: !!rc.lib, ci, defaultBranch: r.defaultBranch, defSha: r.defSha, language: r.language,
        files: pickFiles(r, cfg.github.maxFiles), hasCodeowners: r.structure.hasCodeowners, totalSourceFiles: r.structure.totalSourceFiles,
        branches: r.branches, skippedBranches: r.skippedBranches, releases: r.releases,
        recent: r.recent, release: r.release, builds, deployments: deps.map(depSummary),
        error: st.repoErr[rc.name] || null, syncedAt: r.syncedAt
      };
    });
    const clusters = envs.map(env => {
      const e = st.k8s[env.name];
      return { env: env.name, label: env.label || env.name, production: !!env.production, context: env.context, ok: !!e && !st.k8sErr[env.name], error: st.k8sErr[env.name] || null, nodes: e ? e.nodes : [], syncedAt: e ? e.syncedAt : null };
    });
    const deployments = running.map(d => {
      const e = st.k8s[d.env];
      const pods = d.pods.map(n => e.pods.find(p => p.name === n)).filter(Boolean).map(p => ({ name: p.name, status: p.status, node: p.node, restarts: p.restarts, startedAt: p.startedAt, tag: p.image ? p.image.split(':').pop() : null }));
      return { ...depSummary(d), pods };
    });
    return {
      schema: SCHEMA, version: ++st.version, generatedAt: new Date().toISOString(),
      sources: st.sources,
      environments: envs.map(e => ({ name: e.name, label: e.label || e.name, production: !!e.production })),
      repos, clusters, deployments, events: st.events.slice(0, 120)
    };
  }
  function depSummary(d) {
    return { id: d.id, env: d.env, envLabel: d.envLabel, production: d.production, namespace: d.namespace, name: d.name, repo: d.repo,
      desired: d.desired, ready: d.ready, updated: d.updated, available: d.available, rolling: d.rolling, stalled: d.stalled,
      image: d.image, tag: d.imageInfo && d.imageInfo.tag, commit: d.commit, commitSource: d.commitSource, releaseBranch: d.releaseBranch, build: d.build };
  }

  async function cycle(which) {
    const t0 = Date.now();
    if (which.includes('kubernetes')) await syncK8s();
    if (which.includes('jenkins')) await syncJenkins();
    if (which.includes('github')) await syncGithub();
    const snap = buildSnapshot();
    const evs = diffEvents(st.snapshot, snap);
    if (evs.length) { st.events.unshift(...evs); st.events.length = Math.min(st.events.length, 300); snap.events = st.events.slice(0, 120); }
    st.snapshot = snap;
    log(`sync ${which.join('+')} done in ${Date.now() - t0}ms (${evs.length} new events)`);
    onSnapshot(snap, evs);
    return snap;
  }

  return { cycle, state: st, snapshot: () => st.snapshot };
}

export function pickFiles(r, max) {
  const files = r.structure.files;
  const must = new Set();
  for (const b of r.branches) for (const f of b.files) must.add(f);
  for (const c of [...r.release.waitingForCut, ...r.release.inReleaseNotDeployed]) for (const f of c.files || []) must.add(f);
  const byPath = new Map(files.map(f => [f.path, f]));
  const chosen = new Map();
  for (const p of must) chosen.set(p, byPath.get(p) || { path: p, district: p.includes('/') ? p.split('/')[0] : 'root', size: 0, loc: 20, churn: 0, owner: null, outsideTree: true });
  const rest = files.filter(f => !chosen.has(f.path)).sort((a, b) => b.churn - a.churn || b.size - a.size);
  for (const f of rest) { if (chosen.size >= Math.max(max, must.size)) break; chosen.set(f.path, f); }
  return [...chosen.values()];
}

/* ---------- events: what changed between two snapshots ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const code = s => `<code>${esc(s)}</code>`;
const who = s => `<b>${esc(s)}</b>`;
let evSeq = 0;
const ev = (repo, icon, cls, html, extra = {}) => ({ id: `e${Date.now().toString(36)}${(evSeq++).toString(36)}`, t: Date.now(), repo, icon, cls, html, ...extra });

export function diffEvents(prev, next) {
  if (!prev) return seedEvents(next);
  const out = [];
  const prevRepos = new Map(prev.repos.map(r => [r.name, r]));
  for (const r of next.repos) {
    const p = prevRepos.get(r.name);
    if (!p || !p.branches || !r.branches) continue;
    const pb = new Map(p.branches.map(b => [b.name, b]));
    const nb = new Map(r.branches.map(b => [b.name, b]));
    for (const b of r.branches) {
      const old = pb.get(b.name);
      if (!old) { out.push(ev(r.name, 'branch', 'accent', `${who(b.author)} started ${code(b.name)}`, { sha: b.sha, branch: b.name, kind: 'branch' })); continue; }
      if (old.sha !== b.sha) {
        const seen = new Set(old.commits.map(c => c.sha));
        const fresh = b.commits.filter(c => !seen.has(c.sha));
        const last = fresh[fresh.length - 1] || b.commits[b.commits.length - 1];
        if (last) out.push(ev(r.name, 'push', 'accent', `${who(last.author)} pushed to ${code(b.name)}: ${esc(last.message)}`, { sha: last.sha, branch: b.name, kind: 'push' }));
      }
      if (b.pr && !(old && old.pr)) out.push(ev(r.name, 'pr', 'accent', `${who(b.pr.author)} opened PR #${b.pr.number} ${esc(b.pr.title)}`, { kind: 'pr' }));
      else if (b.pr && old.pr && b.pr.state !== old.pr.state) {
        const m = { approved: ['approve', 'ok', 'is approved'], changes_requested: ['changes', 'warn', 'has changes requested'], in_review: ['pr', 'accent', 'is in review'], review_requested: ['pr', 'accent', 'is ready for review'], draft: ['pr', '', 'went back to draft'] }[b.pr.state];
        out.push(ev(r.name, m[0], m[1], `PR #${b.pr.number} ${esc(b.pr.title)} ${m[2]}`, { kind: 'pr' }));
      }
      if (b.pr && old.pr && b.pr.ci !== old.pr.ci && b.pr.ci === 'failing') out.push(ev(r.name, 'fail', 'crit', `Checks failing on PR #${b.pr.number} (${code(b.name)})`, { kind: 'ci' }));
    }
    for (const old of p.branches) if (!nb.has(old.name)) {
      const merged = old.pr && r.recent.find(c => c.pr === old.pr.number);
      if (merged) out.push(ev(r.name, 'merge', 'ok', `${who(old.pr.author)} merged #${old.pr.number} ${esc(old.pr.title)} into ${code(r.defaultBranch)}`, { sha: merged.sha, branch: old.name, kind: 'merge' }));
      else out.push(ev(r.name, 'trash', '', `Branch ${code(old.name)} was deleted`, { branch: old.name, kind: 'delete' }));
    }
    if (r.release && p.release && r.release.latestRelease !== p.release.latestRelease && r.release.latestRelease) out.push(ev(r.name, 'branch', 'accent', `Release branch ${code(r.release.latestRelease)} was cut`, { kind: 'release-cut' }));
    const pbuilds = new Map((p.builds || []).map(b => [b.id, b]));
    for (const b of (r.builds || []).slice(0, 10)) {
      const ob = pbuilds.get(b.id);
      if (ob && ob.status === b.status) continue;
      if (!ob && b.status !== 'running' && (b.startedAt || 0) < Date.now() - 3600000) continue;
      const m = { running: ['build', 'accent', 'started'], passed: ['build', 'ok', 'passed'], failed: ['fail', 'crit', 'failed'], unstable: ['fail', 'warn', 'is unstable'], aborted: ['fail', '', 'was aborted'] }[b.status] || ['build', '', b.status];
      out.push(ev(r.name, m[0], m[1], `${esc(b.label)} ${m[2]} on ${code(b.branch || '?')}`, { sha: b.sha, kind: 'build' }));
    }
  }
  const pd = new Map((prev.deployments || []).map(d => [d.id, d]));
  for (const d of next.deployments || []) {
    const o = pd.get(d.id);
    if (!o) continue;
    if (o.tag !== d.tag) out.push(ev(d.repo, 'rollout', 'accent', `Rolling out ${code(d.name + ':' + (d.tag || '?'))} to ${esc(d.envLabel)}`, { sha: d.commit, kind: 'rollout' }));
    else if (o.rolling && !d.rolling) out.push(ev(d.repo, 'deploy', 'ok', `Rollout complete: ${code(d.name)} on ${esc(d.envLabel)}, ${d.ready}/${d.desired} ready`, { sha: d.commit, kind: 'rollout-done' }));
    if (d.stalled && !o.stalled) out.push(ev(d.repo, 'fail', 'crit', `Rollout of ${code(d.name)} on ${esc(d.envLabel)} exceeded its progress deadline`, { kind: 'stalled' }));
    if (o.desired !== d.desired) out.push(ev(d.repo, 'scale', 'accent', `${code(d.name)} on ${esc(d.envLabel)} scaled from ${o.desired} to ${d.desired} pods`, { kind: 'scale' }));
    const op = new Map(o.pods.map(p => [p.name, p]));
    for (const p of d.pods) {
      const q = op.get(p.name);
      if (/CrashLoopBackOff|ImagePullBackOff|ErrImagePull|Error/.test(p.status) && (!q || q.status !== p.status)) out.push(ev(d.repo, 'fail', 'crit', `Pod ${code(p.name)} is in ${esc(p.status)} (${esc(d.envLabel)})`, { kind: 'pod' }));
      else if (q && p.restarts > q.restarts && p.status === 'Running') out.push(ev(d.repo, 'fail', 'warn', `Pod ${code(p.name)} restarted (restarts: ${p.restarts})`, { kind: 'pod' }));
    }
  }
  const pn = new Map((prev.clusters || []).flatMap(c => c.nodes.map(n => [`${c.env}/${n.name}`, n])));
  for (const c of next.clusters || []) for (const n of c.nodes) {
    const o = pn.get(`${c.env}/${n.name}`);
    if (o && !o.cordoned && n.cordoned) out.push(ev(null, 'trash', 'warn', `Node ${code(n.name)} in ${esc(c.label)} was cordoned`, { kind: 'node', label: 'cluster' }));
    if (o && o.cordoned && !n.cordoned) out.push(ev(null, 'approve', 'ok', `Node ${code(n.name)} in ${esc(c.label)} is schedulable again`, { kind: 'node', label: 'cluster' }));
  }
  return out;
}

// First snapshot: show recent history so the feed is not empty.
function seedEvents(snap) {
  const out = [];
  for (const r of snap.repos) {
    for (const c of (r.recent || []).slice(0, 8)) out.push({ ...ev(r.name, c.pr ? 'merge' : 'push', c.pr ? 'ok' : 'accent', c.pr ? `${who(c.author)} merged #${c.pr} ${esc(c.message.replace(/\s*\(#\d+\)\s*$/, ''))}` : `${who(c.author)} committed to ${code(r.defaultBranch)}: ${esc(c.message)}`, { sha: c.sha, kind: 'history' }), t: Date.parse(c.at) || Date.now() });
    for (const b of (r.branches || [])) for (const c of b.commits.slice(-2)) out.push({ ...ev(r.name, 'push', 'accent', `${who(c.author)} pushed to ${code(b.name)}: ${esc(c.message)}`, { sha: c.sha, branch: b.name, kind: 'history' }), t: Date.parse(c.at) || Date.now() });
  }
  return out.sort((a, b) => b.t - a.t).slice(0, 60);
}
