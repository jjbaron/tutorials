/* ================================================================
   Kubernetes view: clusters as platforms, deployments (or nodes) as
   container bays, every pod a shipping container
   ================================================================ */
let KS = null;
const POD_W = 1.75, POD_H = 1.4, POD_D = 3.05, SLOT_X = 2.35, SLOT_Z = 3.65;
const BAY_W = 4 * SLOT_X + 1.2, BAY_D = 3 * SLOT_Z + 1.3, BAY_GX = 3, BAY_GZ = 6.5;
const KPAL = {
  light: { cur: 0x3566d6, old: 0x9aa5b2, crash: 0xd23b3b, pending: 0xb7c0ca, gantry: 0xe0a41c, cordon: 0xe0a41c },
  dark: { cur: 0x5f86f5, old: 0x56637a, crash: 0xff5a5a, pending: 0x3d4858, gantry: 0xe0a41c, cordon: 0xe0a41c }
};
const kp = () => KPAL[isDark() ? 'dark' : 'light'];

function clusterGroups(env) {
  if (state.k8sLayout === 'node') return nodesOf(env).map(n => ({ key: 'node:' + n.name, kind: 'node', node: n }));
  return k8s.deps.filter(d => d.env === env).map(d => ({ key: 'dep:' + d.id, kind: 'dep', dep: d }));
}
function groupPods(g) {
  const arr = g.kind === 'node' ? [...k8s.pods.values()].filter(p => p.node === g.node.name) : g.dep.pods.slice();
  return arr.sort((a, b) => a.born - b.born || (a.id < b.id ? -1 : 1));
}
function bayLabelHtml(g) {
  if (g.kind === 'node') {
    const n = podsOn(g.node.name);
    const pct = Math.round(n / SLOTS * 100);
    return `<div class="b-name">${esc(g.node.name)}</div><div class="b-meta"><span class="num">${n}/${SLOTS} pods</span><span>${esc(g.node.zone)}</span>${g.node.cordoned ? '<span class="pill warn">cordoned · draining</span>' : `<span class="pill ${pct > 80 ? 'warn' : ''}">${pct}% full</span>`}</div>`;
  }
  const d = g.dep, st = depStatus(d);
  const ver = d.rollout ? `${esc(d.version)} → ${esc(d.rollout.target)}` : esc(d.version);
  return `<div class="b-name">${esc(d.name)}</div><div class="b-meta"><span class="num">${readyCount(d)}/${d.desired} ready</span><span class="mono">${ver}</span><span class="pill ${DEP_STATUS_CLS[st]}">${st}</span></div>`;
}

function buildClusterScene() {
  clearAll();
  RS = null; TS = null;
  KS = { mesh: new Map(), bays: {}, envs: {}, slot: new Map() };
  const g = layer('kstatic');
  const envs = state.k8sEnv === 'both' ? ['staging', 'prod'] : [state.k8sEnv];
  const both = envs.length > 1;
  const dims = {};
  for (const env of envs) {
    const n = clusterGroups(env).length, cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(n * 1.6)))), rows = Math.ceil(n / cols);
    const slotRows = state.k8sLayout === 'deployment' && env === 'staging' ? 1 : 3;
    const bd = slotRows * SLOT_Z + 1.3;
    dims[env] = { cols, rows, slotRows, bd, w: cols * (BAY_W + BAY_GX) + 6, d: rows * (bd + BAY_GZ) + 6 };
  }
  const aspect = stageEl.clientWidth / Math.max(1, stageEl.clientHeight);
  const side = aspect > 1.15, road = 14;
  const pos = {};
  if (!both) {
    const D = dims[envs[0]];
    pos[envs[0]] = { x: 0, z: 0 };
    KS.extent = { w: D.w, d: D.d };
  } else if (side) {
    const tw = dims.staging.w + road + dims.prod.w;
    pos.staging = { x: -tw / 2 + dims.staging.w / 2, z: -(dims.prod.d - dims.staging.d) / 2 };
    pos.prod = { x: tw / 2 - dims.prod.w / 2, z: 0 };
    KS.extent = { w: tw, d: Math.max(dims.staging.d, dims.prod.d) };
  } else {
    const td = dims.staging.d + road + dims.prod.d;
    pos.staging = { x: 0, z: -td / 2 + dims.staging.d / 2 };
    pos.prod = { x: 0, z: td / 2 - dims.prod.d / 2 };
    KS.extent = { w: Math.max(dims.staging.w, dims.prod.w), d: td };
  }
  KS.side = side;
  for (const env of envs) {
    const D = dims[env], { x: cx, z: cz } = pos[env];
    const plat = box(D.w, .6, D.d, M(isDark() ? P.plate : 0xcdd5de)); plat.position.set(cx, .3, cz); g.add(plat);
    const e = k8s.envs[env];
    KS.envs[env] = { x: cx, z: cz, ...D };
    addLabel(`${envName(env)}<span>${esc(e.cluster)} · ${e.nodes.length} nodes</span>`, new THREE.Vector3(cx - D.w / 2 + 1, .7, cz + D.d / 2 + .2), 'kstatic', 'lbl-card lbl-main', { anchor: 'left' });
    clusterGroups(env).forEach((grp, i) => {
      const c = i % D.cols, r = Math.floor(i / D.cols);
      const x = cx - D.w / 2 + 3 + (BAY_W + BAY_GX) * (c + .5), z = cz - D.d / 2 + 2 + (D.bd + BAY_GZ) * r + D.bd / 2;
      let tint;
      if (grp.kind === 'dep') { tint = new THREE.Color(P.tints[Object.keys(TEAMS).indexOf(grp.dep.ns) % P.tints.length]); if (!isDark()) tint.offsetHSL(0, .1, -.03); }
      else tint = new THREE.Color(isDark() ? P.pad : 0xf6f8fa);
      const pad = box(BAY_W, .25, D.bd, M(tint)); pad.position.set(x, .72, z);
      g.add(pickable(pad, { layer: 'kstatic', kind: 'bay', key: grp.key }));
      const bay = { grp, x, z, d: D.bd, rows: D.slotRows, pad };
      if (grp.kind === 'node') {
        // cordon tape posts, shown while the node drains
        const tape = new THREE.Group();
        const tm = M(kp().cordon);
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const post = cyl(.12, .12, 1.6, tm, 6); post.position.set(x + sx * BAY_W / 2, 1.6, z + sz * D.bd / 2); tape.add(post); }
        for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
          const vert = a[0] === b[0];
          const bar = box(vert ? .08 : BAY_W, .16, vert ? D.bd : .08, tm, false);
          bar.position.set(x + (a[0] + b[0]) / 4 * BAY_W, 2.2, z + (a[1] + b[1]) / 4 * D.bd); tape.add(bar);
        }
        g.add(tape); bay.tape = tape;
      } else {
        // gantry crane that sweeps the bay during a rollout
        const gm = M(kp().gantry);
        const gan = new THREE.Group();
        const l1 = box(.3, 4.6, .3, gm), l2 = box(.3, 4.6, .3, gm), beam = box(BAY_W + .8, .35, .5, gm);
        l1.position.set(-BAY_W / 2 - .4, 2.3, 0); l2.position.set(BAY_W / 2 + .4, 2.3, 0); beam.position.set(0, 4.6, 0);
        gan.add(l1, l2, beam); gan.position.set(x, .7, z); gan.visible = false; g.add(gan);
        bay.gantry = gan;
      }
      bay.label = addLabel(bayLabelHtml(grp), new THREE.Vector3(x, .9, z + D.bd / 2 + .3), 'kstatic', 'lbl-card lbl-branch lbl-bay' + (both || stageEl.clientWidth < 720 ? ' compact' : ''), Object.assign({ anchor: 'below' }, grp.kind === 'dep' ? { action: 'select-dep', data: grp.dep.id } : {}));
      KS.bays[grp.key] = bay;
    });
  }
  KS.lane = null;
  if (!both) { syncPods(true); applyBayHighlight(); return; }
  // promotion lane between the clusters
  const lane = side ? { x: (pos.staging.x + dims.staging.w / 2 + pos.prod.x - dims.prod.w / 2) / 2, z: 0 } : { x: 0, z: pos.staging.z + dims.staging.d / 2 + road / 2 };
  const len = (side ? KS.extent.d : KS.extent.w) + 30;
  const rd = box(side ? 6 : len, .1, side ? len : 6, M(P.road), false); rd.position.set(lane.x, .05, lane.z); g.add(rd);
  for (let i = 0; i < 14; i++) { const o = -len / 2 + 3 + i * 6.5; const dm = box(side ? .3 : 3, .12, side ? 3 : .3, M(P.roadMark), false); dm.position.set(side ? lane.x : o, .08, side ? o : lane.z); g.add(dm); }
  addLabel('promotion lane · staging → production', new THREE.Vector3(lane.x, .3, side ? KS.extent.d / 2 + 4 : lane.z + 3.4), 'kstatic', 'lbl-strain');
  KS.lane = lane; KS.laneLen = len;
  KS.truck = makeTruck(); KS.truck.visible = false; g.add(KS.truck);
  syncPods(true);
  applyBayHighlight();
}
function slotPos(bay, i) {
  const cap = bay.rows * 4, layerN = Math.floor(i / cap), k = i % cap, c = k % 4, r = Math.floor(k / 4);
  return new THREE.Vector3(bay.x - BAY_W / 2 + .6 + SLOT_X * (c + .5), .85 + POD_H / 2 + layerN * (POD_H + .08), bay.z - bay.d / 2 + .65 + SLOT_Z * (r + .5));
}
function syncPods(initial) {
  if (!KS) return;
  KS.slot.clear();
  for (const bay of Object.values(KS.bays)) groupPods(bay.grp).forEach((p, i) => KS.slot.set(p.id, slotPos(bay, i)));
  const pods = layer('kpods');
  for (const [id, m] of KS.mesh) if (!k8s.pods.has(id) || !KS.slot.has(id)) {
    pods.remove(m); m.geometry.dispose(); m.material.dispose(); KS.mesh.delete(id);
    pickables = pickables.filter(x => x !== m);
  }
  for (const [id, pos] of KS.slot) {
    if (KS.mesh.has(id)) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(POD_W, POD_H, POD_D), M(kp().cur, { transparent: true, emissive: 0x000000 }));
    m.castShadow = true; m.receiveShadow = true;
    m.position.copy(pos);
    if (!initial && !reduceMotion) m.position.y += 9;
    pods.add(pickable(m, { layer: 'kpods', kind: 'pod', id }));
    KS.mesh.set(id, m);
  }
  for (const bay of Object.values(KS.bays)) bay.label.el.innerHTML = bayLabelHtml(bay.grp);
  k8s.dirty = false;
}
const _kc = new THREE.Color();
function updateK8sScene(dt, t) {
  if (!KS) return;
  if (k8s.dirty) syncPods(false);
  const K = kp(), k = 1 - Math.exp(-dt * 7);
  for (const [id, m] of KS.mesh) {
    const p = k8s.pods.get(id), pos = KS.slot.get(id); if (!p || !pos) continue;
    const tgt = p.status === 'Terminating' ? pos.y - 1.4 : pos.y;
    m.position.x += (pos.x - m.position.x) * k; m.position.z += (pos.z - m.position.z) * k; m.position.y += (tgt - m.position.y) * k;
    const d = p.dep;
    let color = K.cur, op = 1;
    if (state.k8sLayout === 'node') color = teamColor(d.ns);
    const target = d.rollout ? d.rollout.target : d.version;
    if (state.k8sLayout !== 'node' && p.version !== target) color = K.old;
    if (p.status === 'ContainerCreating') op = .35 + .25 * Math.sin(t * 6);
    if (p.status === 'Pending') { color = K.pending; op = .5; }
    if (p.status === 'Terminating') op = .45;
    if (p.status === 'CrashLoopBackOff') { color = K.crash; op = .55 + .45 * Math.abs(Math.sin(t * 5)); }
    m.material.color.set(color); m.material.opacity = op;
    const hl = state.hoverPod === id || (state.selectedDep && state.selectedDep === d.id);
    m.material.emissive.set(hl ? P.hl : 0x000000); m.material.emissiveIntensity = state.hoverPod === id ? .55 : hl ? .22 : 0;
  }
  for (const bay of Object.values(KS.bays)) {
    if (bay.gantry) {
      const R = bay.grp.dep.rollout;
      bay.gantry.visible = !!R;
      if (R) bay.gantry.position.z = bay.z + Math.sin(t * 1.4) * Math.max(0, bay.d / 2 - .6);
    }
    if (bay.tape) bay.tape.visible = bay.grp.node.cordoned;
  }
}
function applyBayHighlight() {
  if (!KS) return;
  for (const bay of Object.values(KS.bays)) bay.label.el.classList.toggle('hl', bay.grp.kind === 'dep' && bay.grp.dep.id === state.selectedDep);
}
function refreshBayLabels() { if (KS) for (const bay of Object.values(KS.bays)) bay.label.el.innerHTML = bayLabelHtml(bay.grp); }
function focusDep(id) {
  if (!KS) return;
  const bay = KS.bays['dep:' + id] || Object.values(KS.bays).find(b => b.grp.kind === 'node' && k8s.deps.find(d => d.id === id).pods.some(p => p.node === b.grp.node.name));
  if (bay) focusOn(new THREE.Vector3(bay.x, 0, bay.z - 2), 70);
}
function fxPromote(dep) {
  if (!KS || !KS.lane || dep.env !== 'prod' || reduceMotion) return;
  const tr = KS.truck, a = -KS.laneLen / 2 + 4, b = KS.laneLen / 2 - 4;
  tr.visible = true; tr.rotation.y = KS.side ? -Math.PI / 2 : 0;
  tween(3, p => { const v = a + (b - a) * ease(p); if (KS.side) tr.position.set(KS.lane.x, 0, v); else tr.position.set(v, 0, KS.lane.z); }, () => { tr.visible = false; });
}
function podTipHtml(id) {
  const p = k8s.pods.get(id); if (!p) return '';
  const d = p.dep, age = sim.now - p.born;
  const cls = { Running: 'ok', ContainerCreating: 'accent', Terminating: '', CrashLoopBackOff: 'crit', Pending: 'warn' }[p.status];
  return `<h4>${esc(p.id)}</h4><div class="t-row"><span>Status</span><span class="pill ${cls}">${p.status}</span></div>${row('Image', `${esc(d.name)}:${esc(p.version)}`)}${row('Namespace', d.ns)}${row('Node', p.node || 'unscheduled')}${row('Restarts', p.restarts)}${row('Age', fmtAge(age))}${d.rollout && p.version !== d.rollout.target ? '<div class="t-note">Old version: will be replaced by the rollout.</div>' : ''}`;
}
function bayTipHtml(key) {
  const bay = KS && KS.bays[key]; if (!bay) return '';
  if (bay.grp.kind === 'node') {
    const n = bay.grp.node, ps = [...k8s.pods.values()].filter(p => p.node === n.name);
    const byDep = {}; ps.forEach(p => { byDep[p.dep.name] = (byDep[p.dep.name] || 0) + 1; });
    return `<h4>${esc(n.name)}</h4>${row('Cluster', esc(k8s.envs[n.env].cluster))}${row('Zone', n.zone)}${row('Pods', `${ps.length} / ${SLOTS}`)}${n.cordoned ? '<div class="t-note safety">Cordoned: pods are being moved off for maintenance.</div>' : ''}<ul>${Object.entries(byDep).map(([k, v]) => `<li>${esc(k)} × ${v}</li>`).join('')}</ul>`;
  }
  const d = bay.grp.dep;
  return `<h4>${esc(d.ns)}/${esc(d.name)}</h4>${row('Environment', envName(d.env))}${row('Image', esc(d.version))}${row('Ready', `${readyCount(d)} / ${d.desired}`)}${d.hpa ? row('Autoscaler', `${d.min}–${d.max} pods · CPU ${Math.round(d.cpu * 100)}%`) : ''}${row('Status', depStatus(d))}${d.rollout ? `<div class="t-note">Rolling out <span class="mono">${esc(d.rollout.target)}</span>${d.rollout.stalled ? ', stuck on crashing pods' : ''}.</div>` : ''}<div class="t-note">Click for pod details.</div>`;
}
