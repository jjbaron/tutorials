/* ================================================================
   Live mode: when the page is served by the Repo Yard collector it
   reads /api/snapshot and /api/stream instead of running the simulator.
   ================================================================ */
let LIVE_SNAP = null, LIVE_CONNECTED = false;
const liveSeen = new Set();
const TZ_MS = new Date().getTimezoneOffset() * 60000;
const toMin = v => { if (v == null) return null; const ms = typeof v === 'number' ? v : Date.parse(v); return isFinite(ms) ? (ms - TZ_MS) / 60000 : null; };
const liveNow = () => (Date.now() - TZ_MS) / 60000;
const TEAM_PALETTE = [['#5877e0', '#7f99f2'], ['#d46f98', '#ec8fb5'], ['#3f9c70', '#5cc792'], ['#9566d4', '#b58cee'], ['#cf9233', '#ecb357'], ['#3797b8', '#55bfe0'], ['#c45f45', '#e58468'], ['#6d7f2e', '#a3b65a'], ['#a0527a', '#cf86ab'], ['#4b8f8c', '#73c2be']];
let teamSeq = 0;
function ensureTeam(slug) {
  if (!slug) return null;
  if (!TEAMS[slug]) TEAMS[slug] = { name: slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), c: TEAM_PALETTE[teamSeq++ % TEAM_PALETTE.length] };
  return slug;
}
function shortTag(tag) {
  if (!tag) return '?';
  const rel = /-release-(\d{2})-(\d{2})-(\d{2})-REL$/.exec(tag);
  const uuid = /([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(tag);
  const sha = /([0-9a-f]{40})/.exec(tag);
  let s = sha ? sha[1].slice(0, 7) : uuid ? `build ${uuid[1]}` : tag.length > 26 ? tag.slice(0, 24) + '…' : tag;
  if (rel) s += ` · rel ${rel[1]}.${rel[2]}.${rel[3]}`;
  return s;
}
const isReleaseBranch = name => /^release\//.test(name || '');

async function tryLive() {
  if (!/^https?:$/.test(location.protocol)) return null;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000);
      res = await fetch('api/snapshot', { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
    } catch (e) { return null; }
    if (res.status === 503) {          // collector is up, first sync still running
      showWaiting(`Collecting data from GitHub, Jenkins and your clusters… (${attempt * 2}s)`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    if (!res.ok) return null;
    try { const s = await res.json(); hideWaiting(); return s && s.schema === 'repo-yard/1' ? s : null; } catch (e) { return null; }
  }
}
function showWaiting(text) {
  let el = $('#live-wait');
  if (!el) { el = document.createElement('div'); el.id = 'live-wait'; el.className = 'fatal'; stageEl.appendChild(el); }
  el.textContent = text;
}
function hideWaiting() { const el = $('#live-wait'); if (el) el.remove(); }

function initLive(snap) {
  LIVE = true;
  applySnapshot(snap, true);
  state.view = { mode: 'town' };
  startStream();
}
function startStream() {
  if (!window.EventSource) { setInterval(pollSnapshot, 15000); return; }
  const es = new EventSource('api/stream');
  es.addEventListener('snapshot', e => { LIVE_CONNECTED = true; try { onLiveSnapshot(JSON.parse(e.data)); } catch (err) { console.error(err); } });
  es.onopen = () => { LIVE_CONNECTED = true; renderLiveChrome(); };
  es.onerror = () => { LIVE_CONNECTED = false; renderLiveChrome(); };
}
async function pollSnapshot() { try { const r = await fetch('api/snapshot', { cache: 'no-store' }); if (r.ok) onLiveSnapshot(await r.json()); } catch (e) { /* retry next tick */ } }

function onLiveSnapshot(s) {
  if (!s || s.schema !== 'repo-yard/1' || (LIVE_SNAP && s.version <= LIVE_SNAP.version)) return;
  const prev = applySnapshot(s, false);
  refreshLiveScene(prev.prevRepos, prev.newEvents);
  ui.dirty = true;
  renderLiveChrome();
}

/* ---------- snapshot → page model ---------- */
function applySnapshot(snap, initial) {
  LIVE_SNAP = snap;
  sim.now = liveNow();
  ENV_ORDER = snap.environments.map(e => e.name);
  const prodEnv = snap.environments.find(e => e.production) || snap.environments[snap.environments.length - 1];
  ENV_PROD = prodEnv ? prodEnv.name : 'prod';
  const pre = snap.environments.filter(e => !e.production);
  ENV_PRE = pre.length ? pre[pre.length - 1].name : ENV_PROD;
  if (initial || (!ENV_ORDER.includes(state.k8sEnv) && state.k8sEnv !== 'both')) state.k8sEnv = ENV_PROD;
  const prevRepos = new Map(state.repos.map(r => [r.id, r]));
  state.commits = new Map(); state.repos = []; state.byId = {};
  snap.repos.forEach((sr, i) => { const r = liveRepo(sr, i, snap.repos.length, prevRepos.get(sr.name), snap); state.repos.push(r); state.byId[r.id] = r; });
  applyK8s(snap);
  const newEvents = [];
  for (const e of snap.events.slice().reverse()) {
    if (liveSeen.has(e.id)) continue;
    liveSeen.add(e.id);
    const item = { id: e.id, t: toMin(e.t), repo: e.repo || e.label || 'cluster', icon: e.icon, cls: e.cls, html: e.html, sha: e.sha && state.commits.has(e.sha) ? e.sha : null, kind: e.kind, branch: e.branch };
    state.feed.unshift(item);
    newEvents.push(item);
    if (!initial) { prependFeed(item); if (e.cls === 'crit') toast({ cls: 'crit', title: e.repo || 'Cluster', body: e.html }); }
  }
  if (initial) state.feed.sort((a, b) => b.t - a.t);
  if (state.feed.length > 120) state.feed.length = 120;
  for (const r of state.repos) {
    if (!r.seenConflicts) { r.seenConflicts = new Set(collisions(r).map(c => c.key)); }
    else if (!initial) checkNewConflicts(r);
  }
  if (initial && !state.selectedSha) { const r = state.repos.find(x => x.staged.length); if (r) state.selectedSha = r.staged[r.staged.length - 1]; }
  return { prevRepos, newEvents };
}

function liveRepo(sr, idx, n, prev, snap) {
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const pos = [((idx % cols) - (cols - 1) / 2) * 32, (Math.floor(idx / cols) - (rows - 1) / 2) * 32];
  const team = ensureTeam(sr.team || 'unassigned');
  const rel = sr.release || null;
  const deps = snap.deployments.filter(d => d.repo === sr.name);
  const prodDep = deps.find(d => d.production);
  const repo = {
    id: sr.name, def: { pos, msgs: [], topics: [] }, lang: sr.language || '—', team, ci: sr.ci === 'actions' ? 'newci' : 'jenkins',
    version: (rel && rel.prodRelease) || (prodDep ? shortTag(prodDep.tag) : '—'), prefix: '', lib: !!sr.lib, people: [], nextPr: 0, nextBuild: 0, deps: {},
    files: [], fileById: {}, districts: [], branches: [], staged: [], log: [], builds: [], lastBuild: null, hourly: Array(12).fill(0),
    seenConflicts: prev ? prev.seenConflicts : null, lastRelease: 0, ticket: 0, defaultBranch: sr.defaultBranch || 'main', release: rel, error: sr.error || null, full: sr.full
  };
  // files and districts
  const prevHeat = prev ? new Map(prev.files.map(f => [f.id, f.heat])) : new Map();
  const groups = new Map();
  for (const f of sr.files || []) {
    if (f.owner) ensureTeam(f.owner);
    const file = { id: f.path, name: f.path.split('/').pop(), district: f.district, owner: f.owner || null, loc: f.loc || 20, complexity: clamp(Math.log((f.loc || 20) + 1) / 7.2, .08, .9), churn: f.churn || 0, heat: prevHeat.get(f.path) || 0, mesh: null, h: 0 };
    repo.files.push(file); repo.fileById[file.id] = file;
    if (!groups.has(f.district)) groups.set(f.district, []);
    groups.get(f.district).push(file.id);
  }
  [...groups.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([path, ids], i) => {
    const counts = {};
    for (const id of ids) { const o = repo.fileById[id].owner; if (o) counts[o] = (counts[o] || 0) + 1; }
    const owner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    repo.districts.push({ path, owner: owner ? owner[0] : null, files: ids, idx: i });
  });
  // builds
  repo.builds = (sr.builds || []).map(b => ({ id: b.number, label: b.label, status: b.status, sha: b.sha, branch: b.branch, start: toMin(b.startedAt), end: b.durationMs != null ? toMin(b.startedAt + b.durationMs) : null, url: b.url }));
  const mainBuild = repo.builds.find(b => b.branch === repo.defaultBranch) || repo.builds[0];
  if (mainBuild) repo.lastBuild = { id: mainBuild.id, label: mainBuild.label, status: mainBuild.status === 'running' ? 'running' : mainBuild.status === 'passed' ? 'passed' : 'failed', sha: mainBuild.sha, at: mainBuild.start };
  const buildFor = sha => { const b = repo.builds.find(x => x.sha === sha); return b ? { id: b.id, label: b.label, status: b.status === 'passed' ? 'passed' : b.status === 'running' ? 'running' : 'failed', start: b.start, end: b.end != null ? b.end : b.start } : null; };
  // where commits are deployed
  const preDep = deps.find(d => d.env === ENV_PRE);
  const deployedAt = d => { if (!d) return null; const ts = d.pods.map(p => toMin(p.startedAt)).filter(v => v != null); return ts.length ? Math.max(...ts) : sim.now; };
  const notOnPre = rel && rel.notOnEnv && rel.notOnEnv[ENV_PRE] ? new Set(rel.notOnEnv[ENV_PRE]) : null;
  const notInProd = rel ? new Set([...rel.waitingForCut, ...rel.inReleaseNotDeployed].map(c => c.sha)) : new Set();
  const addCommit = c => {
    if (state.commits.has(c.sha)) return state.commits.get(c.sha);
    const full = Object.assign({ build: buildFor(c.sha), image: null, staging: null, prod: null, prodVersion: null, mergeSha: null, approvals: null, files: [] }, c);
    const onDefault = c.branch === repo.defaultBranch;
    if (onDefault && notOnPre && preDep && !notOnPre.has(c.sha)) { full.staging = deployedAt(preDep); full.image = `${repo.id}:${preDep.tag}`; }
    if (rel && rel.prodSha && !notInProd.has(c.sha) && (onDefault || isReleaseBranch(c.branch))) { full.prod = deployedAt(prodDep); full.prodVersion = rel.prodRelease || shortTag(prodDep && prodDep.tag); }
    state.commits.set(c.sha, full);
    repo.log.push(c.sha);
    if (c.author && !repo.people.includes(c.author)) repo.people.push(c.author);
    return full;
  };
  for (const c of sr.recent || []) addCommit({ sha: c.sha, repo: repo.id, branch: repo.defaultBranch, msg: c.message, author: c.author, t: toMin(c.at), kind: c.pr ? 'merge' : 'push', pr: c.pr });
  if (rel) {
    for (const c of rel.waitingForCut) addCommit({ sha: c.sha, repo: repo.id, branch: repo.defaultBranch, msg: c.message, author: c.author, t: toMin(c.at), kind: c.pr ? 'merge' : 'push', pr: c.pr });
    for (const c of [...rel.inReleaseNotDeployed, ...rel.notBackMerged]) addCommit({ sha: c.sha, repo: repo.id, branch: rel.latestRelease, msg: c.message, author: c.author, t: toMin(c.at), kind: c.pr ? 'merge' : 'push', pr: c.pr });
    repo.staged = [...new Set([...rel.waitingForCut, ...rel.inReleaseNotDeployed].map(c => c.sha))];
  }
  // branches and PRs
  const prevBranches = prev ? new Map(prev.branches.map(b => [b.name, b])) : new Map();
  for (const b of sr.branches || []) {
    const pr = b.pr ? { n: b.pr.number, title: b.pr.title, state: b.pr.state, author: b.pr.author || b.author, reviewers: b.pr.reviewers.map(r => ({ p: r.login, s: r.state })),
      requestedAt: toMin(b.pr.createdAt), openedAt: toMin(b.pr.createdAt), ci: b.pr.ci === 'none' ? 'passing' : b.pr.ci, branch: b.name, url: b.pr.url } : null;
    const last = toMin(b.lastCommitAt) ?? sim.now;
    const pb = prevBranches.get(b.name);
    repo.branches.push({ name: b.name, sha: b.sha, author: b.author, ahead: b.ahead, behind: b.behind, last, add: b.additions, del: b.deletions,
      files: b.files.filter(f => repo.fileById[f]), kind: b.kind, bump: null, pr, created: pb ? pb.created : (b.commits[0] ? toMin(b.commits[0].at) : last), commits: b.commits });
    for (const c of b.commits) addCommit({ sha: c.sha, repo: repo.id, branch: b.name, msg: c.message, author: c.author, t: toMin(c.at), kind: 'push', pr: pr ? pr.n : null });
    for (const p of [b.author, ...(pr ? pr.reviewers.map(r => r.p) : [])]) if (p && !repo.people.includes(p)) repo.people.push(p);
  }
  repo.log.sort((a, b) => state.commits.get(a).t - state.commits.get(b).t);
  for (const sha of repo.log) { const c = state.commits.get(sha); const age = sim.now - c.t; if (age >= 0 && age < 720) repo.hourly[11 - Math.floor(age / 60)]++; }
  return repo;
}

function liveDepStatus(raw) {
  if (['Running', 'ContainerCreating', 'Terminating', 'Pending', 'CrashLoopBackOff'].includes(raw)) return raw;
  return /BackOff|Err|Error|Failed|OOM|Unknown/.test(raw) ? 'CrashLoopBackOff' : 'Pending';
}
function applyK8s(snap) {
  k8s.envs = {}; k8s.nodes = {}; k8s.deps = []; k8s.pods = new Map();
  for (const c of snap.clusters) {
    k8s.envs[c.env] = { id: c.env, name: c.label, cluster: c.context, nodes: [], ok: c.ok, error: c.error };
    for (const nd of c.nodes) {
      const key = `${c.env}/${nd.name}`;
      k8s.nodes[key] = { name: key, display: nd.name, env: c.env, cordoned: nd.cordoned, zone: nd.zone || nd.pool || '', maxPods: nd.maxPods, podCount: nd.podCount, ready: nd.ready };
      k8s.envs[c.env].nodes.push(key);
    }
  }
  for (const d of snap.deployments) {
    const repo = state.byId[d.repo];
    const target = shortTag(d.tag);
    const dep = { id: d.id, env: d.env, name: d.name, ns: d.namespace, team: repo ? repo.team : 'unassigned', repo: d.repo, desired: d.desired, hpa: false, min: d.desired, max: d.desired,
      version: target, rollout: null, cpu: .5, pods: [], commit: d.commit, commitSource: d.commitSource, releaseBranch: d.releaseBranch, build: d.build, fullTag: d.tag };
    for (const p of d.pods) {
      const pod = { id: p.name, dep, version: shortTag(p.tag), status: liveDepStatus(p.status), rawStatus: p.status, node: p.node ? `${d.env}/${p.node}` : null, restarts: p.restarts, born: toMin(p.startedAt) ?? sim.now, statusAt: sim.now };
      k8s.pods.set(pod.id, pod); dep.pods.push(pod);
    }
    const old = dep.pods.find(p => p.version !== target && p.status !== 'Terminating');
    if (d.rolling || old) { dep.rollout = { target, from: old ? old.version : 'previous', started: sim.now, stalled: !!d.stalled }; dep.version = old ? old.version : target; }
    k8s.deps.push(dep);
  }
  k8s.dirty = true;
}

/* ---------- keep the 3D view in step with new snapshots ---------- */
function refreshLiveScene(prevRepos, newEvents) {
  const mode = state.view.mode;
  if (mode === 'repo') {
    const r = state.byId[state.view.repoId];
    if (!r) return enterTown();
    const old = prevRepos.get(r.id);
    const sig = x => x.files.map(f => f.id).join('|');
    if (!RS || !old || sig(old) !== sig(r)) { buildRepoScene(r); return; }
    RS.repo = r;
    const names = new Set(r.branches.map(b => b.name));
    for (const ob of old.branches) if (!names.has(ob.name) && newEvents.some(e => e.kind === 'merge' && e.branch === ob.name)) fxMerge(r, ob, ob.files);
    for (const nb of r.branches) {
      const ob = old.branches.find(x => x.name === nb.name);
      if (ob && ob.sha !== nb.sha) { const files = nb.files.slice(0, 3); for (const f of files) r.fileById[f].heat += 1; fxPush(r, nb, files); }
    }
    clearLayer('stage'); buildStage(r);
    RS.mainLabel.el.innerHTML = mainLabelHtml(r);
    RS.dirty = true;
  } else if (mode === 'town') {
    buildTownScene();
  } else if (mode === 'cluster') {
    if (KS && KS.sig === clusterSig()) {
      for (const bay of Object.values(KS.bays)) {
        if (bay.grp.kind === 'dep') bay.grp.dep = k8s.deps.find(d => d.id === bay.grp.dep.id) || bay.grp.dep;
        else bay.grp.node = k8s.nodes[bay.grp.node.name] || bay.grp.node;
      }
      k8s.dirty = true;
      for (const e of newEvents) if (e.kind === 'rollout') { const d = k8s.deps.find(x => x.repo === e.repo && x.env === ENV_PROD); if (d && d.rollout) fxPromote(d); }
    } else buildClusterScene();
    applyBayHighlight();
  }
}
const clusterSig = () => k8s.deps.map(d => d.id).join('|') + '#' + Object.keys(k8s.nodes).join('|') + '#' + state.k8sEnv + '#' + state.k8sLayout;

/* ---------- live-only UI ---------- */
function renderLiveChrome() {
  if (!LIVE) return;
  $('#btn-pause').hidden = true; $('#speed-seg').hidden = true;
  const chip = $('.demo-chip');
  const s = LIVE_SNAP && LIVE_SNAP.sources;
  const bad = s ? Object.entries(s).filter(([, v]) => v.ok === false).map(([k]) => k) : [];
  chip.textContent = !LIVE_CONNECTED && LIVE_SNAP ? 'Reconnecting…' : bad.length ? `Live · ${bad.join(', ')} failing` : 'Live data';
  chip.style.color = bad.length || !LIVE_CONNECTED ? 'var(--warn)' : 'var(--ok)';
  chip.style.background = bad.length || !LIVE_CONNECTED ? 'var(--warn-soft)' : 'var(--ok-soft)';
  chip.title = s ? Object.entries(s).map(([k, v]) => `${k}: ${v.ok === true ? 'ok' : v.ok === 'disabled' ? 'not configured' : 'error'}${v.lastSync ? ` (synced ${new Date(v.lastSync).toLocaleTimeString()})` : ''}`).join('\n') : '';
  const lbl = $('#clock-wrap').querySelector('span:nth-child(2)'); if (lbl) lbl.textContent = 'Live';
  $('#clock-wrap').classList.remove('paused');
}
function sourcesSection() {
  const s = LIVE_SNAP && LIVE_SNAP.sources; if (!s) return '';
  const row = (name, v, extra) => `<div class="dep"><div class="d-top"><span>${name}</span><span class="pill ${v.ok === true ? 'ok' : v.ok === 'disabled' ? '' : 'crit'}">${v.ok === true ? 'connected' : v.ok === 'disabled' ? 'not configured' : 'error'}</span></div>
    <div class="d-sub">${v.lastSync ? `synced ${fmtAge((Date.now() - v.lastSync) / 60000)} ago` : 'not synced yet'}${extra ? ' · ' + extra : ''}</div>
    ${v.errors ? Object.entries(v.errors).map(([k, e]) => `<div class="d-sub" style="color:var(--crit)">${esc(k)}: ${esc(e)}</div>`).join('') : ''}</div>`;
  return `<section><h3>Data sources</h3>${row('GitHub', s.github, s.github.rateRemaining != null ? `${s.github.rateRemaining} API calls left this hour` : '')}${row('Jenkins', s.jenkins, s.jenkins.indexedTags ? `${s.jenkins.indexedTags} image builds mapped` : '')}${row('Kubernetes', s.kubernetes, ENV_ORDER.map(e => envName(e)).join(', '))}</section>`;
}
function liveReleaseSection(r) {
  const rel = r.release;
  if (!rel) return `<section><h3>Release status</h3><div class="empty">${esc(r.error || 'Not synced yet.')}</div></section>`;
  const group = (title, items, color, empty) => `<div class="lane"><div class="lane-h"><span class="bar" style="background:var(--${color})"></span>${title} <span class="n">${items.length}</span></div>${items.length
    ? `<div class="staged-list">${items.slice(0, 12).map(c => `<div class="staged-item"><button class="sha${state.selectedSha === c.sha ? ' sel' : ''}" data-action="trace" data-id="${c.sha}">${c.sha.slice(0, 7)}</button><span>${esc(c.message)}</span></div>`).join('')}${items.length > 12 ? `<div class="empty">and ${items.length - 12} more</div>` : ''}</div>`
    : `<div class="empty">${empty}</div>`}</div>`;
  return `<section><h3>Release status <span class="h-aside">${esc(rel.latestRelease || 'no release branch')}</span></h3>
    <div class="chips" style="margin:0 0 12px">${rel.prodRelease ? `<span class="pill">production on ${esc(rel.prodRelease)}</span>` : ''}${rel.prodSha ? `<span class="pill">${rel.prodSha.slice(0, 7)} via ${esc(rel.prodCommitSource)}</span>` : '<span class="pill warn">production commit unknown</span>'}</div>
    ${group('Waiting for the next release cut', rel.waitingForCut, 'accent', `Nothing merged to ${esc(r.defaultBranch)} since the last cut.`)}
    ${group(`In ${esc(rel.latestRelease || 'the release')}, not in production`, rel.inReleaseNotDeployed, 'warn', 'Production runs the newest release.')}
    ${group('Release fixes not merged back', rel.notBackMerged, 'crit', `Every release fix is on ${esc(r.defaultBranch)}.`)}
    ${(rel.notes || []).map(n => `<div class="caption">${esc(n)}</div>`).join('')}</section>`;
}
function liveTraceSteps(c) {
  const repo = state.byId[c.repo], rel = repo.release || { waitingForCut: [], inReleaseNotDeployed: [], notBackMerged: [] };
  const has = arr => (arr || []).some(x => x.sha === c.sha);
  const S = [{ k: 'commit', l: 'Committed', s: `${esc(firstName(c.author))} · ${fmtWhen(c.t)}`, st: 'done' }];
  const feature = c.branch && c.branch !== repo.defaultBranch && !isReleaseBranch(c.branch);
  if (feature) {
    const b = repo.branches.find(x => x.name === c.branch), pr = b && b.pr;
    S.push({ k: 'pr', l: 'Pull request', s: pr ? `#${pr.n} ${pr.state === 'draft' ? 'draft' : 'open'}` : b ? 'not opened yet' : 'branch is gone', st: pr && pr.state !== 'draft' ? 'done' : 'blocked' });
    S.push({ k: 'review', l: 'Review', s: !pr ? 'not requested' : pr.state === 'changes_requested' ? 'changes requested' : `${approvals(pr)} approval${approvals(pr) === 1 ? '' : 's'}`, st: !pr ? 'pending' : pr.state === 'approved' ? 'done' : pr.state === 'changes_requested' ? 'blocked' : 'active' });
    S.push({ k: 'build', l: 'Checks', s: pr ? `CI ${pr.ci}` : 'on PR', st: !pr ? 'pending' : pr.ci === 'failing' ? 'failed' : pr.ci === 'running' ? 'active' : 'done' });
    S.push({ k: 'merge', l: `Merged to ${repo.defaultBranch}`, s: 'not yet', st: 'pending' });
    S.push({ k: 'staging', l: cap(envName(ENV_PRE)), s: 'after merge', st: 'pending' });
    S.push({ k: 'cut', l: 'Release cut', s: 'after merge', st: 'pending' });
    S.push({ k: 'prod', l: cap(envName(ENV_PROD)), s: 'after release', st: 'pending' });
    return S;
  }
  const onRelease = isReleaseBranch(c.branch);
  S.push({ k: 'merge', l: onRelease ? 'On release branch' : `On ${repo.defaultBranch}`, s: c.pr ? `PR #${c.pr}` : 'direct commit', st: 'done' });
  const b = c.build;
  S.push({ k: 'build', l: 'Build', s: b ? `${esc(b.label || '#' + b.id)} ${b.status}` : 'no build found for this commit', st: !b ? 'pending' : b.status === 'running' ? 'active' : b.status === 'failed' ? 'failed' : 'done' });
  if (!onRelease) {
    const known = rel.notOnEnv && rel.notOnEnv[ENV_PRE];
    S.push({ k: 'staging', l: cap(envName(ENV_PRE)), s: c.staging ? `running since ${fmtWhen(c.staging)}` : known ? 'not deployed yet' : 'unknown', st: c.staging ? 'done' : known ? 'active' : 'pending' });
    S.push({ k: 'cut', l: 'Release cut', s: has(rel.waitingForCut) ? 'waiting for the next cut' : rel.latestRelease ? `in ${esc(rel.latestRelease)} or earlier` : 'no release branch', st: has(rel.waitingForCut) ? 'blocked' : 'done' });
  } else S.push({ k: 'cut', l: 'Release', s: esc(c.branch), st: 'done' });
  if (has(rel.notBackMerged)) S.push({ k: 'back', l: `Back to ${repo.defaultBranch}`, s: 'not merged back yet', st: 'failed' });
  const prodTxt = c.prod ? `running ${esc(c.prodVersion || '')}` : has(rel.inReleaseNotDeployed) ? `${esc(rel.latestRelease)} not deployed${rel.prodRelease ? `; production runs ${esc(rel.prodRelease)}` : ''}` : has(rel.waitingForCut) ? 'after the next release' : rel.prodSha ? 'not in production' : 'production commit unknown';
  S.push({ k: 'prod', l: cap(envName(ENV_PROD)), s: prodTxt, st: c.prod ? 'done' : has(rel.inReleaseNotDeployed) ? 'blocked' : 'pending' });
  return S;
}
const cap = s => (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
