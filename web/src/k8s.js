/* ================================================================
   Kubernetes model: clusters, nodes, deployments, pods
   ================================================================ */
const K8S_ENVS = [
  { id: 'staging', name: 'staging', cluster: 'eks-staging-us-east-1', nodes: ['ip-10-1-0-14', 'ip-10-1-1-52', 'ip-10-1-2-37'] },
  { id: 'prod', name: 'production', cluster: 'eks-prod-us-east-1', nodes: ['ip-10-0-0-21', 'ip-10-0-0-88', 'ip-10-0-1-17', 'ip-10-0-1-140', 'ip-10-0-2-63', 'ip-10-0-2-201'] }
];
// name, namespace, repo, prod replicas/HPA range, staging replicas, fixed image tag for third-party
const K8S_DEPS = [
  ['payments-api', 'payments', 'payments-api', { r: 6, min: 4, max: 10 }, 2],
  ['checkout-web', 'storefront', 'checkout-web', { r: 6, min: 4, max: 10 }, 2],
  ['inventory-svc', 'fulfillment', 'inventory-svc', { r: 4, min: 3, max: 8 }, 2],
  ['auth-service', 'identity', 'auth-service', { r: 4, min: 3, max: 8 }, 2],
  ['data-pipeline-worker', 'data', 'data-pipeline', { r: 3 }, 1],
  ['ingress-nginx', 'platform', null, { r: 3 }, 1, '1.11.2'],
  ['otel-collector', 'platform', null, { r: 2 }, 1, '0.104.0']
];
const SLOTS = 12;
const k8s = { envs: {}, deps: [], nodes: {}, pods: new Map(), dirty: true, nextAt: 0, draining: null };
const POD_CHARS = 'bcdfghjklmnpqrstvwxz2456789';
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function podName(dep, version) {
  const rs = (hashStr(dep.id + version).toString(36) + 'f7c9d').slice(0, 9).replace(/[aeiou]/g, 'c');
  let sfx = ''; for (let i = 0; i < 5; i++) sfx += POD_CHARS[Math.floor(Math.random() * POD_CHARS.length)];
  return `${dep.name}-${rs}-${sfx}`;
}
const envName = env => k8s.envs[env] ? k8s.envs[env].name : env;
const depFor = (env, repoId) => k8s.deps.find(d => d.env === env && d.repo === repoId);
const nodesOf = env => k8s.envs[env].nodes.map(n => k8s.nodes[n]);
function podsOn(name) { let n = 0; for (const p of k8s.pods.values()) if (p.node === name) n++; return n; }
function pickNode(env) {
  const ns = nodesOf(env).filter(n => !n.cordoned).sort((a, b) => podsOn(a.name) - podsOn(b.name));
  return ns.length && podsOn(ns[0].name) < SLOTS ? ns[0].name : null;
}
function newPod(dep, version, status) {
  const node = pickNode(dep.env);
  const p = { id: podName(dep, version), dep, version, status: node ? status : 'Pending', node, restarts: 0, born: sim.now, statusAt: sim.now };
  k8s.pods.set(p.id, p); dep.pods.push(p); k8s.dirty = true;
  return p;
}
function removePod(p) { if (!k8s.pods.has(p.id)) return; k8s.pods.delete(p.id); p.dep.pods.splice(p.dep.pods.indexOf(p), 1); k8s.dirty = true; }
function setStatus(p, s) { p.status = s; p.statusAt = sim.now; k8s.dirty = true; ui.dirty = true; }
const readyCount = dep => dep.pods.filter(p => p.status === 'Running').length;
function depStatus(dep) {
  if (dep.pods.some(p => p.status === 'CrashLoopBackOff')) return 'Degraded';
  if (dep.rollout) return 'Progressing';
  if (readyCount(dep) < dep.desired) return 'Scaling';
  return 'Available';
}
const DEP_STATUS_CLS = { Available: 'ok', Progressing: 'accent', Scaling: 'accent', Degraded: 'crit' };
const repoOf = dep => dep.repo ? state.byId[dep.repo] : null;
const kfeed = (dep, o) => addFeed(Object.assign({ repo: repoOf(dep), label: dep.name }, o));

function buildK8s() {
  for (const e of K8S_ENVS) {
    k8s.envs[e.id] = e;
    e.nodes.forEach((n, i) => { k8s.nodes[n] = { name: n, env: e.id, cordoned: false, zone: 'us-east-1' + 'abc'[i % 3] }; });
  }
  for (const [name, ns, repoId, prod, stagingR, fixed] of K8S_DEPS) {
    for (const env of ['staging', 'prod']) {
      const repo = repoId && state.byId[repoId];
      let version = fixed;
      if (repo && env === 'prod') version = repo.version;
      if (repo && env === 'staging') {
        const deployed = repo.log.map(s => state.commits.get(s)).filter(c => c.kind === 'merge' && c.staging).sort((a, b) => b.t - a.t)[0];
        version = deployed ? (deployed.image && deployed.image.includes(':sha-') ? 'sha-' + deployed.sha : repo.version) : repo.version;
      }
      const r = env === 'prod' ? prod.r : stagingR;
      const dep = { id: `${env}/${name}`, env, name, ns, repo: repoId, desired: r, hpa: env === 'prod' && !!prod.max, min: prod.min || r, max: prod.max || r,
        version, rollout: null, cpu: rnd(.45, .7, seeded), pods: [] };
      k8s.deps.push(dep);
      for (let i = 0; i < r; i++) {
        const p = newPod(dep, version, 'Running');
        p.born = sim.now - rint(40, 3 * DAY, seeded);
        p.restarts = seeded() < .15 ? rint(1, 3, seeded) : 0;
      }
    }
  }
  k8s.nextAt = sim.now + 2;
}

/* ---------- rollouts: surge one new pod, wait for ready, retire one old pod ---------- */
function k8sRollout(dep, version, onDone, opts = {}) {
  if (dep.version === version && !dep.rollout) { if (onDone) onDone(); return; }
  if (dep.rollout) { Object.assign(dep.rollout, { target: version, onDone, stalled: false, bad: false }); stepRollout(dep); return; }
  dep.rollout = { target: version, from: dep.version, started: sim.now, onDone, bad: !opts.safe && dep.env === 'staging' && Math.random() < .14 };
  kfeed(dep, { icon: 'rollout', cls: 'accent', html: `Rolling out ${code(dep.name + ':' + version)} to ${envName(dep.env)} · ${dep.desired} pods` });
  emit('k8s', repoOf(dep), { rolloutStart: dep });
  stepRollout(dep);
}
function stepRollout(dep) {
  const R = dep.rollout; if (!R || R.stalled) return;
  if (dep.pods.some(p => p.version === R.target && (p.status === 'ContainerCreating' || p.status === 'Pending'))) return;
  const old = dep.pods.filter(p => p.version !== R.target && p.status !== 'Terminating');
  const fresh = dep.pods.filter(p => p.version === R.target && p.status === 'Running').length;
  if (!old.length && fresh >= dep.desired) return finishRollout(dep);
  const p = newPod(dep, R.target, 'ContainerCreating');
  scheduleReady(dep, p, old[0]);
}
function scheduleReady(dep, p, replace) {
  after(rnd(.6, 1.3), () => {
    if (!k8s.pods.has(p.id)) return;
    const R = dep.rollout;
    if (R && R.bad && p.version === R.target) {
      setStatus(p, 'CrashLoopBackOff'); p.restarts = 1; R.stalled = true;
      kfeed(dep, { icon: 'fail', cls: 'crit', html: `Pod ${code(p.id)} is in CrashLoopBackOff: readiness probe failing on /healthz` });
      emit('toast', repoOf(dep), { cls: 'crit', title: `Rollout stuck: ${dep.name} on ${envName(dep.env)}`, body: `New pods for <span class="mono">${esc(R.target)}</span> keep crashing. Old pods are still serving traffic.` });
      const tick = () => { if (k8s.pods.has(p.id) && p.status === 'CrashLoopBackOff') { p.restarts++; k8s.dirty = true; after(1.2, tick); } };
      after(1.2, tick);
      after(rnd(4, 6), () => rollback(dep, R));
      return;
    }
    setStatus(p, 'Running');
    if (replace && k8s.pods.has(replace.id)) { setStatus(replace, 'Terminating'); after(.5, () => { removePod(replace); stepRollout(dep); }); }
    else stepRollout(dep);
  });
}
function finishRollout(dep) {
  const R = dep.rollout;
  dep.version = R.target; dep.rollout = null;
  kfeed(dep, { icon: 'deploy', cls: 'ok', html: `Rollout complete: ${code(dep.name + ':' + R.target)} on ${envName(dep.env)}, ${readyCount(dep)}/${dep.desired} pods ready` });
  if (R.onDone) R.onDone();
  emit('k8s', repoOf(dep), { rolloutDone: dep });
}
function rollback(dep, R) {
  if (dep.rollout !== R) return;
  dep.rollout = null;
  for (const p of dep.pods.filter(x => x.version === R.target)) { setStatus(p, 'Terminating'); after(.5, () => removePod(p)); }
  kfeed(dep, { icon: 'rollback', cls: 'crit', html: `Rollout of ${code(dep.name + ':' + R.target)} exceeded its progress deadline. Rolled back to ${code(dep.version)}` });
  ensureReplicas(dep);
  emit('k8s', repoOf(dep), { rollback: dep });
  // someone fixes the config and retries
  const onDone = R.onDone;
  after(rnd(7, 11), () => {
    if (dep.rollout || dep.version === R.target) return;
    kfeed(dep, { icon: 'sync', cls: '', html: `Fixed the readiness probe config for ${code(dep.name)} and retried the rollout` });
    k8sRollout(dep, R.target, onDone, { safe: true });
  });
}
function ensureReplicas(dep) {
  const live = dep.pods.filter(p => p.status !== 'Terminating').length;
  for (let i = live; i < dep.desired; i++) {
    const p = newPod(dep, dep.version, 'ContainerCreating');
    after(rnd(.5, 1), () => { if (k8s.pods.has(p.id)) setStatus(p, 'Running'); });
  }
}

/* ---------- cluster events: autoscaling, restarts, node maintenance ---------- */
function hpaEvent() {
  const dep = pick(k8s.deps.filter(d => d.hpa && !d.rollout));
  if (!dep) return false;
  dep.cpu = clamp(dep.cpu + (.6 - dep.cpu) * .3 + rnd(-.2, .26), .22, .97);
  const want = clamp(Math.ceil(dep.desired * dep.cpu / .6), dep.min, dep.max);
  if (want === dep.desired) return false;
  const from = dep.desired; dep.desired = want;
  if (want > from) {
    for (let i = from; i < want; i++) { const p = newPod(dep, dep.version, 'ContainerCreating'); after(rnd(.6, 1.4), () => { if (k8s.pods.has(p.id)) setStatus(p, 'Running'); }); }
  } else {
    const victims = dep.pods.filter(p => p.status === 'Running').sort((a, b) => b.born - a.born).slice(0, from - want);
    for (const p of victims) { setStatus(p, 'Terminating'); after(.6, () => removePod(p)); }
  }
  kfeed(dep, { icon: 'scale', cls: 'accent', html: `Autoscaler moved ${code(dep.name)} from ${from} to ${want} pods (CPU ${Math.round(dep.cpu * 100)}% of request)` });
  return true;
}
function restartEvent() {
  const p = pick([...k8s.pods.values()].filter(x => x.status === 'Running' && x.dep.env === 'prod' && !x.dep.rollout));
  if (!p) return false;
  setStatus(p, 'CrashLoopBackOff'); p.restarts++;
  kfeed(p.dep, { icon: 'fail', cls: 'warn', html: `Pod ${code(p.id)} was OOMKilled and is restarting (restarts: ${p.restarts})` });
  after(rnd(2, 3.5), () => { if (k8s.pods.has(p.id) && p.status === 'CrashLoopBackOff') setStatus(p, 'Running'); });
  return true;
}
function drainEvent() {
  if (k8s.draining) return false;
  const node = pick(nodesOf('prod').filter(n => !n.cordoned));
  if (!node) return false;
  const pods = [...k8s.pods.values()].filter(p => p.node === node.name && p.status === 'Running');
  if (!pods.length) return false;
  node.cordoned = true; k8s.draining = node.name; k8s.dirty = true;
  addFeed({ label: 'cluster', icon: 'trash', cls: 'warn', html: `Draining node ${code(node.name)} for kernel patching · ${pods.length} pods to reschedule` });
  let k = 0;
  const next = () => {
    const p = pods[k++];
    if (!p) {
      after(rnd(8, 14), () => { node.cordoned = false; k8s.draining = null; k8s.dirty = true; addFeed({ label: 'cluster', icon: 'approve', cls: 'ok', html: `Node ${code(node.name)} patched and schedulable again` }); });
      return;
    }
    if (!k8s.pods.has(p.id) || p.status !== 'Running') return next();
    const r = newPod(p.dep, p.version, 'ContainerCreating');
    after(rnd(.5, 1), () => { if (k8s.pods.has(r.id)) setStatus(r, 'Running'); if (k8s.pods.has(p.id)) { setStatus(p, 'Terminating'); after(.4, () => removePod(p)); } next(); });
  };
  next();
  return true;
}
function k8sTick() {
  if (sim.now < k8s.nextAt) return;
  k8s.nextAt = sim.now + rnd(2.2, 4.5);
  const x = Math.random();
  if (x < .5) hpaEvent(); else if (x < .75) restartEvent(); else if (x < .87) drainEvent();
}

/* ---------- hooks used by the build/release flow ---------- */
function deployStaging(repo, c) {
  const dep = depFor('staging', repo.id);
  const mark = () => {
    for (const sha of repo.staged) { const x = state.commits.get(sha); if (!x.staging && x.t <= c.t && x.build && x.build.status === 'passed') x.staging = sim.now; }
    if (!c.staging) c.staging = sim.now;
    if (!dep) addFeed({ repo, icon: 'deploy', cls: 'accent', html: `Deployed ${code('sha-' + c.sha)} to staging`, sha: c.sha });
    emit('deploy', repo, { commit: c });
  };
  if (!dep) { after(rnd(1, 2.5), mark); return; }
  after(rnd(.5, 1.2), () => k8sRollout(dep, 'sha-' + c.sha, mark));
}
function deployProd(repo, commits, version) {
  const dep = depFor('prod', repo.id);
  const mark = () => { for (const c of commits) c.prod = sim.now; emit('deploy', repo, {}); };
  if (!dep) { mark(); return; }
  k8sRollout(dep, version, mark);
}
