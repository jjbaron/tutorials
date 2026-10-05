/* ================================================================
   Kubernetes panels
   ================================================================ */
function k8sKpis() {
  const pods = [...k8s.pods.values()];
  const ready = pods.filter(p => p.status === 'Running').length;
  const desired = sum(k8s.deps.map(d => d.desired));
  const rolling = k8s.deps.filter(d => d.rollout);
  const bad = pods.filter(p => p.status === 'CrashLoopBackOff' || p.status === 'Pending').length;
  const nodes = Object.values(k8s.nodes), cordoned = nodes.filter(n => n.cordoned).length;
  return kpi('Pods ready', `${ready}<small>/ ${desired}</small>`, `${pods.length} pods in ${ENV_ORDER.length} clusters`)
    + kpi('Rollouts in progress', rolling.length, rolling.length ? esc(rolling.map(d => d.name).slice(0, 2).join(', ')) : 'nothing rolling out')
    + kpi('Unhealthy pods', bad, bad ? 'CrashLoopBackOff or Pending' : 'all pods healthy', bad > 0)
    + kpi('Nodes schedulable', `${nodes.length - cordoned}<small>/ ${nodes.length}</small>`, cordoned ? `<b>${cordoned} draining for maintenance</b>` : 'none cordoned')
    + kpi('Container restarts', sum(pods.map(p => p.restarts)), 'across current pods');
}
const POD_CLS = { Running: 'ok', ContainerCreating: 'accent', Terminating: '', CrashLoopBackOff: 'crit', Pending: 'warn' };
const POD_WORD = { Running: 'Running', ContainerCreating: 'Starting', Terminating: 'Terminating', CrashLoopBackOff: 'CrashLoop', Pending: 'Pending' };
function depDetail(d) {
  const st = depStatus(d);
  const pods = d.pods.slice().sort((a, b) => a.born - b.born);
  return `<div class="chips"><span class="pill ${DEP_STATUS_CLS[st]}">${st}</span><span class="pill">image ${esc(d.version)}</span>${d.hpa ? `<span class="pill">autoscaler ${d.min}–${d.max} · CPU ${Math.round(d.cpu * 100)}%</span>` : `<span class="pill">${d.desired} replicas</span>`}</div>
    ${d.rollout ? `<div class="t-note" style="margin-top:8px;color:var(--muted)">Rolling out <span class="mono">${esc(d.rollout.target)}</span>${d.rollout.stalled ? ': <b style="color:var(--crit)">new pods are crashing</b>' : ''}</div>` : ''}
    <div class="tbl-wrap" style="margin-top:12px"><table class="btable pods-tbl"><thead><tr><th>Pod</th><th>Status</th><th>Node</th><th>Restarts</th><th>Age</th></tr></thead><tbody>
    ${pods.map(p => `<tr><td class="bn" title="${esc(p.id)}">…${esc(p.id.slice(d.name.length))}<div style="color:var(--faint)">${esc(p.version)}</div></td><td class="st"><span class="pill ${POD_CLS[p.status]}">${POD_WORD[p.status]}</span></td><td class="ab">${esc(p.node || '—')}</td><td class="num">${p.restarts}</td><td class="num">${fmtAge(sim.now - p.born)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="chips" style="margin-top:10px">${d.repo ? `<button class="btn" data-action="enter-repo" data-id="${d.repo}">Open ${esc(d.repo)} code</button>` : ''}<button class="btn" data-action="select-dep" data-id="">Show all deployments</button></div>`;
}
function clusterPanel() {
  const sel = state.selectedDep && k8s.deps.find(d => d.id === state.selectedDep);
  const rolling = k8s.deps.filter(d => d.rollout);
  const pods = [...k8s.pods.values()];
  const attn = pods.filter(p => p.status === 'CrashLoopBackOff' || p.status === 'Pending');
  const cordoned = Object.values(k8s.nodes).filter(n => n.cordoned);
  const repoDeps = state.repos.filter(r => depFor(ENV_PROD, r.id) && depFor(ENV_PRE, r.id));
  let h = `<section>
    <div class="eyebrow">Kubernetes · ${ENV_ORDER.length} clusters · ${Object.keys(k8s.nodes).length} nodes</div>
    <h2>${sel ? esc(sel.name) : 'Deployments'}</h2>
    <div class="repo-meta">${sel ? `${esc(sel.ns)} namespace · ${envName(sel.env)}` : 'Every shipping container is a pod. Click a bay to see its pods.'}</div>
    ${sel ? depDetail(sel) : ''}</section>`;
  h += `<section><h3>Rollouts in progress <span class="count">${rolling.length}</span></h3>${rolling.length ? rolling.map(d => {
    const R = d.rollout, done = d.pods.filter(p => p.version === R.target && p.status === 'Running').length;
    return `<button class="rollout${R.stalled ? ' stuck' : ''}" data-action="select-dep" data-id="${d.id}"><div class="r-top"><span>${esc(d.name)} · ${envName(d.env)}</span><span class="pill ${R.stalled ? 'crit' : 'accent'}">${R.stalled ? 'stuck' : `${done}/${d.desired} new pods`}</span></div><div class="r-sub">${esc(R.from)} → ${esc(R.target)}</div><div class="progress"><i style="width:${Math.min(100, done / d.desired * 100)}%"></i></div></button>`;
  }).join('') : '<div class="empty">Nothing rolling out right now.</div>'}</section>`;
  h += `<section><h3>Needs attention <span class="count ${attn.length ? 'safety' : ''}">${attn.length + cordoned.length}</span></h3>${attn.length || cordoned.length
    ? attn.map(p => `<div class="attn"><span class="pill ${POD_CLS[p.status]}">${POD_WORD[p.status]}</span><span class="mono">${esc(p.id)}</span><span style="color:var(--muted)">${p.restarts} restarts</span></div>`).join('') + cordoned.map(n => `<div class="attn"><span class="pill warn">cordoned</span><span class="mono">${esc(n.name)}</span><span style="color:var(--muted)">draining for maintenance</span></div>`).join('')
    : '<div class="empty">All pods healthy and every node schedulable.</div>'}</section>`;
  h += `<section><h3>${esc(cap(envName(ENV_PRE)))} vs ${esc(envName(ENV_PROD))}</h3>${repoDeps.map(r => {
    const pd = depFor(ENV_PROD, r.id), sd = depFor(ENV_PRE, r.id), n = r.staged.length;
    return `<div class="dep"><div class="d-top"><span>${esc(r.id)}</span><span class="pill ${n ? 'warn' : 'ok'}">${n ? `${n} change${n > 1 ? 's' : ''} not in prod` : 'in sync'}</span></div><div class="d-sub">${esc(envName(ENV_PROD))} <span class="mono">${esc(pd.version)}</span> · ${esc(envName(ENV_PRE))} <span class="mono">${esc(sd.version)}</span></div></div>`;
  }).join('')}</section>`;
  for (const env of [ENV_PROD, ...ENV_ORDER.filter(e => e !== ENV_PROD).reverse()]) {
    if (!k8s.envs[env]) continue;
    h += `<section><h3>${envName(env)} <span class="h-aside">${esc(k8s.envs[env].cluster)}</span></h3><div class="tbl-wrap"><table class="btable"><thead><tr><th>Deployment</th><th>Ready</th><th>Image</th><th>Status</th></tr></thead><tbody>
    ${k8s.deps.filter(d => d.env === env).map(d => { const st = depStatus(d); return `<tr data-action="select-dep" data-id="${d.id}"${d.id === state.selectedDep ? ' style="background:var(--accent-soft)"' : ''}><td class="bn">${esc(d.name)}</td><td class="num">${readyCount(d)}/${d.desired}</td><td class="imgc">${esc(d.version)}</td><td><span class="pill ${DEP_STATUS_CLS[st]}">${st}</span></td></tr>`; }).join('')}
    </tbody></table></div></section>`;
  }
  return h;
}
function repoK8sSection(r) {
  const ds = [ENV_PROD, ...ENV_ORDER.filter(e => e !== ENV_PROD).reverse()].map(e => depFor(e, r.id)).filter(Boolean);
  if (!ds.length) return `<section><h3>Kubernetes</h3><div class="empty">${r.lib ? 'Library: shipped inside other services, not deployed on its own.' : r.id === 'mobile-app' ? 'Ships through the app stores, not Kubernetes.' : 'Helm charts, applied to the clusters by the platform pipeline.'}</div></section>`;
  return `<section><h3>Running in Kubernetes</h3>${ds.map(d => { const st = depStatus(d); return `<div class="k8s-row"><span class="kr-env">${envName(d.env)}</span><span class="pill ${DEP_STATUS_CLS[st]}">${st}</span><div class="kr-sub"><span class="num">${readyCount(d)}/${d.desired} pods ready</span> · <span class="mono">${esc(d.version)}</span>${d.rollout ? ` → <span class="mono">${esc(d.rollout.target)}</span>` : ''}</div></div>`; }).join('')}
    <button class="btn" style="margin-top:10px" data-action="open-k8s" data-id="${ds[0].id}">Open in Kubernetes view</button></section>`;
}
