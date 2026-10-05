/* ================================================================
   3D core
   ================================================================ */
const stageEl = $('#stage'), labelsEl = $('#labels'), tipEl = $('#tip');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stageEl.prepend(renderer.domElement);
const canvas = renderer.domElement;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
const hemi = new THREE.HemisphereLight(0xffffff, 0xb7c2ce, .85);
const sun = new THREE.DirectionalLight(0xffffff, .75);
sun.position.set(-70, 130, 70);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 10, far: 420 });
sun.shadow.bias = -.0005;
scene.add(hemi, sun, sun.target);
const groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), groundMat);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);
const world = new THREE.Group(); scene.add(world);

const PAL = {
  light: { bg: 0xe8ecf0, ground: 0xe0e5ea, lot: 0xf2f4f7, road: 0xcad2da, roadMark: 0xf5f7f9, plate: 0xf3f5f8, file: 0xf7f9fb, pad: 0xd5dbe2, padRelease: 0xcbd7f3,
    scaffold: 0x6c7a8c, hl: 0x2853c7, tether: 0x9aa5b2, strained: 0xc28a0e, spark: 0xec6a18, weed: 0x67a956, cloud: 0xffffff, cloudOp: .62,
    hemiSky: 0xffffff, hemiGround: 0xa9b4c1, hemiI: .66, sunI: .52, windowLit: 0xffbe4d, winI: .45, facade: '#f3f5f8', win: '#c9d2dc', winLit: '#ffcf70', roof: 0xdde3e9,
    ok: 0x15875a, crit: 0xc93636, run: 0x2853c7, jenkins: 0xb04f29, newci: 0x0d817e, heat: [0xeef1f4, 0xf6d27c, 0xec8a2c, 0xc8342b], hotLo: 0xeef1f4, hotMid: 0xf0a24a, hotHi: 0xc62f2f,
    unowned: 0xc3cad2, truck: 0xfafbfc, cargo: 0x2853c7, crate: 0xc99c5c, pallet: 0xb48a57, pipe: 0xa4afbb, smoke: 0xffffff, wheel: 0x2b3440, crane: 0xe0a41c,
    tints: ['#dce5fa', '#f6dde7', '#d7ede1', '#e8def6', '#f5e5cd', '#d4e9f3', '#f3dbd3', '#e2e9cf', '#e6e1ee'] },
  dark: { bg: 0x0d131a, ground: 0x111922, lot: 0x17202b, road: 0x1c2632, roadMark: 0x2e3a48, plate: 0x1a2430, file: 0x2c3949, pad: 0x222d3a, padRelease: 0x24335c,
    scaffold: 0x8b9aad, hl: 0x7196ff, tether: 0x55626f, strained: 0xeab53c, spark: 0xff8a3d, weed: 0x4c8b43, cloud: 0x9eabbc, cloudOp: .38,
    hemiSky: 0xa9bad1, hemiGround: 0x18202a, hemiI: .62, sunI: .5, windowLit: 0xffc35a, winI: 1.1, facade: '#1f2934', win: '#2a3542', winLit: '#ffcb66', roof: 0x2b3643,
    ok: 0x3fcf94, crit: 0xff6b6b, run: 0x7196ff, jenkins: 0xe47d50, newci: 0x3ec8c4, heat: [0x2c3949, 0x8a6b2c, 0xdc7a2a, 0xff5a48], hotLo: 0x2c3949, hotMid: 0xc9792e, hotHi: 0xff5050,
    unowned: 0x3a4552, truck: 0xd9e0e8, cargo: 0x5a7fe6, crate: 0xae854c, pallet: 0x8a6a43, pipe: 0x55626f, smoke: 0xaab6c4, wheel: 0x0d1117, crane: 0xe0a41c,
    tints: ['#29365a', '#4a2c3a', '#244236', '#392e55', '#4a3b24', '#203f4b', '#4a2f29', '#33402a', '#37324a'] }
};
function isDark() { const t = document.documentElement.getAttribute('data-theme'); if (t) return t === 'dark'; return matchMedia('(prefers-color-scheme: dark)').matches; }
let P = PAL.light;
function teamColor(t) { return TEAMS[t] ? TEAMS[t].c[isDark() ? 1 : 0] : '#888'; }
function districtStrong(i) { const c = new THREE.Color(P.tints[i % P.tints.length]); const hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, clamp(hsl.s + .25, 0, .7), isDark() ? .55 : .62); return c; }

const M = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: .82, metalness: 0 }, o || {}));
const MB = (color, o) => new THREE.MeshBasicMaterial(Object.assign({ color }, o || {}));
function box(w, h, d, mat, shadow = true) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = shadow; m.receiveShadow = true; return m; }
function cyl(rt, rb, h, mat, seg = 12) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.castShadow = true; return m; }

/* ---------- layers, picking, tickers, tweens ---------- */
const layers = {}; let pickables = []; const tickers = {}; const anims = [];
function layer(name) { if (!layers[name]) { layers[name] = new THREE.Group(); layers[name].name = name; world.add(layers[name]); } return layers[name]; }
function disposeTree(o) { o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) { const ms = Array.isArray(n.material) ? n.material : [n.material]; ms.forEach(m => { if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); }); } }); }
function clearLayer(name) {
  const g = layers[name];
  if (g) { world.remove(g); disposeTree(g); delete layers[name]; }
  removeLabels(name);
  tickers[name] = [];
  pickables = pickables.filter(p => p.userData.layer !== name);
}
function clearAll() { Object.keys(layers).forEach(clearLayer); Object.keys(tickers).forEach(k => tickers[k] = []); anims.length = 0; labels.slice().forEach(l => l.el.remove()); labels.length = 0; pickables = []; }
function addTicker(name, fn) { (tickers[name] = tickers[name] || []).push(fn); }
function pickable(m, data) { m.userData = Object.assign({}, data); pickables.push(m); return m; }
function tween(dur, update, done) { const a = { t: 0, dur: reduceMotion ? .001 : dur, update, done }; anims.push(a); return a; }
const ease = p => p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

/* ---------- HTML labels pinned to 3D points ---------- */
const labels = [];
const _v = new THREE.Vector3();
function addLabel(html, pos, layerName, cls, o = {}) {
  const el = document.createElement('div');
  el.className = 'lbl ' + (cls || '');
  el.innerHTML = html;
  if (o.action) { el.dataset.action = o.action; el.dataset.id = o.data; }
  labelsEl.appendChild(el);
  const L = Object.assign({ el, pos: pos.clone(), layer: layerName, anchor: 'center', hidden: false }, o);
  labels.push(L);
  return L;
}
function removeLabels(name) { for (let i = labels.length - 1; i >= 0; i--) if (labels[i].layer === name) { labels[i].el.remove(); labels.splice(i, 1); } }
function updateLabels() {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  for (const L of labels) {
    let show = !L.when || L.when();
    if (show) { _v.copy(L.pos).project(camera); if (_v.z > 1 || _v.z < -1) show = false; }
    if (!show) { if (!L.hidden) { L.el.style.display = 'none'; L.hidden = true; } continue; }
    if (L.hidden) { L.el.style.display = ''; L.hidden = false; }
    const x = (_v.x + 1) / 2 * w, y = (1 - _v.y) / 2 * h;
    const ax = L.anchor === 'left' ? '0' : '-50%', ay = L.anchor === 'below' ? '4px' : '-100%';
    L.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(${ax},${ay})`;
  }
}

/* ---------- camera controls (pan / rotate / zoom) ---------- */
const cam = { target: new THREE.Vector3(), r: 160, theta: .62, phi: .92 };
const goal = { target: new THREE.Vector3(), r: 160, theta: .62, phi: .92 };
function applyCam() {
  const sp = Math.sin(cam.phi);
  camera.position.set(cam.target.x + cam.r * sp * Math.sin(cam.theta), cam.target.y + cam.r * Math.cos(cam.phi), cam.target.z + cam.r * sp * Math.cos(cam.theta));
  camera.lookAt(cam.target);
}
function updateCamera(dt) {
  const k = 1 - Math.exp(-dt * 5.5);
  cam.target.lerp(goal.target, k);
  cam.r += (goal.r - cam.r) * k; cam.theta += (goal.theta - cam.theta) * k; cam.phi += (goal.phi - cam.phi) * k;
  applyCam();
}
function contentRadius() {
  if (state.view.mode === 'town') return 70;
  if (state.view.mode === 'cluster') return KS ? Math.max(KS.extent.w / 2 / Math.max(1, aspectNow() / 1.25), KS.extent.d / 2) + 4 : 60;
  if (!RS) return 60;
  return Math.max(RS.campus.hx, RS.campus.hz) + 26;
}
function aspectNow() { return Math.max(.4, stageEl.clientWidth / Math.max(1, stageEl.clientHeight)); }
function defaultView(fromAbove) {
  const aspect = Math.max(.4, stageEl.clientWidth / Math.max(1, stageEl.clientHeight));
  const R = contentRadius();
  const fit = R / Math.tan(THREE.MathUtils.degToRad(15)) * (aspect >= 1.25 ? .78 : .78 * (state.view.mode === 'cluster' ? 1.2 : 1.6) / aspect);
  const kc = state.view.mode === 'cluster';
  const v = { target: state.view.mode === 'town' ? new THREE.Vector3(-2, 0, -7) : kc ? new THREE.Vector3(0, 0, -3) : new THREE.Vector3(4, 0, -6), r: clamp(fit, 60, 520), theta: kc ? .16 : .62, phi: kc ? .78 : .92 };
  goal.target.copy(v.target); goal.r = v.r; goal.theta = v.theta; goal.phi = v.phi;
  if (fromAbove) { cam.target.copy(v.target); cam.r = v.r * 1.6; cam.theta = v.theta - .5; cam.phi = .55; }
}
function focusOn(p, r) { goal.target.set(p.x, 0, p.z); goal.r = r || 70; }

const ptr = { down: false, x: 0, y: 0, sx: 0, sy: 0, t0: 0, rotate: false, moved: false, nx: 0, ny: 0, inside: false, dirty: false, touches: new Map(), pinch: 0 };
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  ptr.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptr.touches.size === 2) { const [a, b] = [...ptr.touches.values()]; ptr.pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  ptr.down = true; ptr.x = ptr.sx = e.clientX; ptr.y = ptr.sy = e.clientY; ptr.t0 = performance.now(); ptr.moved = false;
  ptr.rotate = e.button === 2 || e.shiftKey || e.ctrlKey || e.altKey;
  hideHint();
});
canvas.addEventListener('pointermove', e => {
  const rect = canvas.getBoundingClientRect();
  ptr.nx = (e.clientX - rect.left) / rect.width * 2 - 1; ptr.ny = -(e.clientY - rect.top) / rect.height * 2 + 1;
  ptr.px = e.clientX - rect.left; ptr.py = e.clientY - rect.top; ptr.inside = true; ptr.dirty = true;
  if (!ptr.down) return;
  if (ptr.touches.has(e.pointerId)) ptr.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptr.touches.size === 2) {
    const [a, b] = [...ptr.touches.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (ptr.pinch) { goal.r = cam.r = clamp(cam.r * ptr.pinch / d, 30, 520); } ptr.pinch = d; ptr.moved = true; return;
  }
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y; ptr.x = e.clientX; ptr.y = e.clientY;
  if (Math.hypot(e.clientX - ptr.sx, e.clientY - ptr.sy) > 5) { ptr.moved = true; canvas.classList.add('dragging'); }
  if (!ptr.moved) return;
  if (ptr.rotate) {
    cam.theta = goal.theta = goal.theta - dx * .006;
    cam.phi = goal.phi = clamp(goal.phi - dy * .004, .3, 1.32);
  } else {
    const s = cam.r * .0019 * (900 / Math.max(500, stageEl.clientHeight));
    const rx = Math.cos(cam.theta), rz = -Math.sin(cam.theta), fx = -Math.sin(cam.theta), fz = -Math.cos(cam.theta);
    goal.target.x += -rx * dx * s + fx * dy * s; goal.target.z += -rz * dx * s + fz * dy * s;
    goal.target.x = clamp(goal.target.x, -170, 170); goal.target.z = clamp(goal.target.z, -170, 170);
    cam.target.copy(goal.target);
  }
});
function endPointer(e) {
  ptr.touches.delete(e.pointerId);
  if (ptr.touches.size < 2) ptr.pinch = 0;
  if (!ptr.down) return;
  if (ptr.touches.size === 0) ptr.down = false;
  canvas.classList.remove('dragging');
  if (!ptr.moved && performance.now() - ptr.t0 < 600 && e.type === 'pointerup') handleClick();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { ptr.inside = false; setHover(null); });
canvas.addEventListener('wheel', e => { e.preventDefault(); goal.r = clamp(goal.r * Math.exp(e.deltaY * .0011), 30, 520); hideHint(); }, { passive: false });
function hideHint() { const h = $('#hint'); if (h) h.classList.add('gone'); }

const raycaster = new THREE.Raycaster();
function pickAt() {
  raycaster.setFromCamera({ x: ptr.nx, y: ptr.ny }, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  return hits.length ? hits[0].object.userData : null;
}

/* ================================================================
   Repo view: the campus (main branch) + construction sites (branches)
   ================================================================ */
let RS = null;   // repo-scene refs
let TS = null;   // town-scene refs
function treemap(items, x, z, w, d, out) {
  if (!items.length) return;
  if (items.length === 1) { out.push({ ref: items[0].ref, x, z, w, d }); return; }
  const total = sum(items.map(i => i.w)); let acc = 0, i = 0;
  while (i < items.length - 1 && acc + items[i].w <= total / 2) { acc += items[i].w; i++; }
  if (i === 0) { acc = items[0].w; i = 1; }
  const f = acc / total, a = items.slice(0, i), b = items.slice(i);
  if (w >= d) { treemap(a, x, z, w * f, d, out); treemap(b, x + w * f, z, w * (1 - f), d, out); }
  else { treemap(a, x, z, w, d * f, out); treemap(b, x, z + d * f, w, d * (1 - f), out); }
}
const fileHeight = f => .7 + Math.sqrt(f.loc) / 6.6;

function buildRepoScene(repo) {
  clearAll();
  TS = null; KS = null;
  RS = { repo, fileMesh: {}, fileTop: {}, sites: {}, hold: 0, dirty: false, lastRebuild: 0, rings: [] };
  buildCampus(repo);
  buildStage(repo);
  buildBranches(repo);
  buildCollisions(repo);
  recolorFiles();
}

function buildCampus(repo) {
  const g = layer('campus');
  const items = repo.districts.map(d => ({ w: d.files.length + 1.3, ref: d })).sort((a, b) => b.w - a.w);
  const area = Math.max(40, sum(items.map(i => i.w)) * 15);
  const W = Math.sqrt(area * 1.5), D = area / W;
  const rects = []; treemap(items, -W / 2, -D / 2, W, D, rects);
  RS.campus = { W, D, hx: W / 2 + 2.5, hz: D / 2 + 2.5 };
  const slab = box(W + 5, .8, D + 5, M(P.plate)); slab.position.y = .4; g.add(slab);
  const fog = layer('fog');
  for (const r of rects) {
    const d = r.ref, gap = .8;
    const x = r.x + gap / 2, z = r.z + gap / 2, w = r.w - gap, dd = r.d - gap;
    const plate = box(w, .3, dd, M(P.tints[d.idx % P.tints.length])); plate.position.set(x + w / 2, .95, z + dd / 2); g.add(plate);
    addLabel(`${esc(d.path)}/`, new THREE.Vector3(x + .2, 1.15, z + dd - .15), 'campus', 'lbl-district', { anchor: 'left' });
    const n = d.files.length, cols = Math.max(1, Math.round(Math.sqrt(n * w / dd))), rows = Math.ceil(n / cols);
    const cw = w / cols, cd = dd / rows, fp = Math.min(cw, cd, 4.8) * .7;
    d.files.forEach((fid, i) => {
      const f = repo.fileById[fid], c = i % cols, rr = Math.floor(i / cols), h = fileHeight(f);
      const m = box(fp, h, fp, M(P.file, { emissive: 0x000000 }));
      m.position.set(x + cw * (c + .5), 1.1 + h / 2, z + cd * (rr + .5));
      g.add(pickable(m, { layer: 'campus', kind: 'file', id: fid }));
      RS.fileMesh[fid] = m; RS.fileTop[fid] = new THREE.Vector3(m.position.x, 1.1 + h, m.position.z);
      f.flash = 0; f.flashColor = new THREE.Color(P.hl);
    });
    if (!d.owner) {
      const cm = M(P.cloud, { transparent: true, opacity: P.cloudOp, depthWrite: false });
      for (let k = 0; k < 5; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(rnd(1.6, 2.6), 14, 10), cm);
        s.position.set(x + w * (.15 + .7 * Math.random()), rnd(5, 7.5), z + dd * (.15 + .7 * Math.random()));
        s.scale.y = .55; fog.add(s);
        const base = s.position.y, ph = Math.random() * 6;
        addTicker('fog', t => { s.position.y = base + Math.sin(t * .8 + ph) * .3; });
      }
      addLabel('No CODEOWNERS', new THREE.Vector3(x + w / 2, 9.4, z + dd / 2), 'fog', 'lbl-fog', { when: () => state.layer === 'owners' });
    }
  }
  fog.visible = state.layer === 'owners';
  // hotspot call-outs
  const ranked = repo.files.map(f => ({ f, s: hotScore(repo, f) })).sort((a, b) => b.s - a.s).slice(0, 3);
  for (const { f } of ranked) addLabel(`${esc(f.name)} · ${f.churn} changes/30d`, RS.fileTop[f.id].clone().add(new THREE.Vector3(0, .8, 0)), 'campus', 'lbl-hot', { when: () => state.layer === 'hotspots' });
  RS.mainLabel = addLabel(mainLabelHtml(repo), new THREE.Vector3(0, .9, D / 2 + 2.6), 'campus', 'lbl-card lbl-main');
}
function mainLabelHtml(repo) { return `${esc(repo.defaultBranch || 'main')}<span>${esc(verLabel(repo.version))} in ${esc(envName(ENV_PROD))}</span>`; }

function hotScore(repo, f) {
  const maxC = Math.max(...repo.files.map(x => x.churn), 1);
  return (f.churn / maxC) * f.complexity;
}
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function rampColor(stops, t, out) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  _c1.set(stops[i]); _c2.set(stops[i + 1]);
  return out.copy(_c1).lerp(_c2, t - i);
}
function recolorFiles() {
  if (!RS) return;
  const repo = RS.repo;
  const maxHot = Math.max(...repo.files.map(f => hotScore(repo, f)), .01);
  for (const f of repo.files) {
    const m = RS.fileMesh[f.id]; if (!m) continue;
    const c = m.material.color;
    if (state.layer === 'activity') rampColor(P.heat, Math.pow(f.heat / 2.2, .8), c);
    else if (state.layer === 'hotspots') rampColor([P.hotLo, P.hotMid, P.hotHi], Math.pow(hotScore(repo, f) / maxHot, 1.1), c);
    else if (state.layer === 'owners') c.set(f.owner ? teamColor(f.owner) : P.unowned);
    else { const d = repo.districts.find(x => x.path === f.district); c.set(P.file).lerp(_c2.set(P.tints[d.idx % P.tints.length]), isDark() ? .55 : .85); if (!isDark()) c.offsetHSL(0, .05, -.04); }
  }
  if (layers.fog) layers.fog.visible = state.layer === 'owners';
}

/* ---------- staging area: merged-but-unreleased pallets, the truck, main's build light ---------- */
function buildStage(repo) {
  const g = layer('stage');
  const { hx, hz } = RS.campus;
  const sx = hx + 13, sz = hz + 2;
  RS.stagePos = new THREE.Vector3(sx, 0, sz);
  const road = box(260, .1, 6.5, M(P.road), false); road.position.set(sx + 128, .05, sz + 8); g.add(road);
  for (let i = 0; i < 24; i++) { const d = box(3, .12, .3, M(P.roadMark), false); d.position.set(sx + 6 + i * 10, .07, sz + 8); g.add(d); }
  const apron = box(13, .3, 11, M(P.pad)); apron.position.set(sx, .15, sz); g.add(apron);
  g.add(pickable(apron, { layer: 'stage', kind: 'stage' }));
  // main build light
  const pole = cyl(.12, .12, 6, M(P.scaffold)); pole.position.set(sx - 5.6, 3, sz - 4.6); g.add(pole);
  const lampMat = MB(P.ok); const lamp = new THREE.Mesh(new THREE.SphereGeometry(.65, 16, 12), lampMat); lamp.position.set(sx - 5.6, 6.3, sz - 4.6); g.add(lamp);
  RS.lamp = lamp;
  addTicker('stage', t => {
    const st = repo.lastBuild ? repo.lastBuild.status : 'passed';
    lampMat.color.set(st === 'running' ? P.run : st === 'failed' ? P.crit : P.ok);
    lamp.scale.setScalar(st === 'running' ? 1 + Math.sin(t * 8) * .18 : st === 'failed' ? 1 + Math.sin(t * 12) * .1 : 1);
  });
  RS.stageLabel = addLabel(stageLabelHtml(repo), new THREE.Vector3(sx - 5.6, 7.6, sz - 4.6), 'stage', 'lbl-card lbl-stage');
  RS.truck = makeTruck(); RS.truck.position.set(sx + 4, 0, sz + 8); RS.truckHome = RS.truck.position.clone(); g.add(RS.truck);
  rebuildCrates(repo);
}
function stageLabelHtml(repo) {
  const b = repo.lastBuild || { status: 'passed', id: 0 };
  const cls = b.status === 'running' ? 'run' : b.status === 'failed' ? 'crit' : 'ok';
  const word = b.status === 'running' ? 'building' : b.status;
  const ready = repo.staged.filter(s => state.commits.get(s).staging).length;
  return `<div>Staged for release <b class="num">${repo.staged.length}</b></div><div class="b-meta" style="color:var(--muted);font-size:10.5px;display:flex;gap:5px;align-items:center"><span class="dot ${cls}"></span>${esc(repo.defaultBranch || 'main')}: ${esc(ciLabel(repo, b.id))} ${word}${ready ? ` · ${ready} on ${esc(envName(ENV_PRE))}` : ''}</div>`;
}
function makeTruck() {
  const t = new THREE.Group();
  const cargo = box(6.4, 3, 2.8, M(P.truck)); cargo.position.set(-1.2, 2.1, 0); t.add(cargo);
  const stripe = box(6.42, .5, 2.82, M(P.cargo)); stripe.position.set(-1.2, 1.2, 0); t.add(stripe);
  const cab = box(2.1, 2.3, 2.6, M(P.truck)); cab.position.set(3.2, 1.75, 0); t.add(cab);
  const glass = box(.1, .9, 2.2, M(0x1d2733, { roughness: .2 })); glass.position.set(4.26, 2.3, 0); t.add(glass);
  const wm = M(P.wheel);
  for (const [x, z] of [[-3, 1.4], [-3, -1.4], [-.4, 1.4], [-.4, -1.4], [3.2, 1.4], [3.2, -1.4]]) { const w = cyl(.55, .55, .45, wm, 14); w.rotation.x = Math.PI / 2; w.position.set(x, .55, z); t.add(w); }
  return t;
}
function cratePos(i) {
  const per = 6, layerN = Math.floor(i / per), k = i % per, c = k % 3, r = Math.floor(k / 3);
  return new THREE.Vector3(RS.stagePos.x - 2.2 + c * 1.9, .62 + .25 + layerN * 1.5 + .7, RS.stagePos.z - 1.4 + r * 1.9);
}
function rebuildCrates(repo) {
  clearLayer('crates');
  const g = layer('crates');
  const pal = box(6, .25, 4, M(P.pallet)); pal.position.set(RS.stagePos.x - .3, .42, RS.stagePos.z - .45); g.add(pal);
  RS.crateMeshes = repo.staged.map((sha, i) => {
    const c = state.commits.get(sha);
    const m = box(1.5, 1.4, 1.5, M(P.crate)); m.position.copy(cratePos(i));
    m.material.color.offsetHSL(0, 0, (i % 3) * .03 - .03);
    g.add(pickable(m, { layer: 'crates', kind: 'staged', sha: c.sha }));
    return m;
  });
  if (RS.stageLabel) RS.stageLabel.el.innerHTML = stageLabelHtml(repo);
}

/* ---------- branches as construction sites ---------- */
function scaffoldGeometry(w, h, d, step) {
  const v = [], hw = w / 2, hd = d / 2;
  const posts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  if (w > 4.5) posts.push([0, -hd], [0, hd]);
  if (d > 4.5) posts.push([-hw, 0], [hw, 0]);
  for (const [x, z] of posts) v.push(x, 0, z, x, h, z);
  for (let y = step; y <= h + .01; y += step) {
    for (let i = 0; i < 4; i++) { const a = posts[i], b = posts[(i + 1) % 4]; v.push(a[0], y, a[1], b[0], y, b[1]); }
  }
  // diagonal bracing on two faces
  for (let y = 0; y + step <= h + .01; y += step) { v.push(-hw, y, hd, hw, y + step, hd); v.push(hw, y, -hd, hw, y + step, hd); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); return g;
}
function nearestOnCampus(x, z) { const { hx, hz } = RS.campus; return new THREE.Vector3(clamp(x, -hx, hx), .85, clamp(z, -hz, hz)); }

function branchLabelHtml(repo, b) {
  const stale = isStale(b);
  let meta;
  if (b.kind === 'release') meta = `<span class="pill accent">release branch</span> cut ${fmtAge(sim.now - b.last)} ago`;
  else if (stale) meta = `${avatar(b.author)} <span class="pill">stale ${fmtAge(sim.now - b.last)}</span>`;
  else {
    const pr = b.pr ? `<span class="pill ${PR_STATES[b.pr.state].cls}">#${b.pr.n} ${PR_STATES[b.pr.state].label}</span>` : '<span class="pill">no PR</span>';
    meta = `${avatar(b.author)} <span class="num">${b.ahead} ahead · ${b.behind} behind</span> ${pr}`;
  }
  return `<div class="b-name">${esc(b.name)}</div><div class="b-meta">${meta}</div>`;
}
function prColorHex(b) {
  if (b.kind === 'release') return P.hl;
  if (!b.pr) return P.tether;
  return { draft: P.tether, review_requested: P.hl, in_review: P.hl, changes_requested: P.strained, approved: P.ok }[b.pr.state];
}
function buildBranches(repo) {
  clearLayer('branches');
  const g = layer('branches');
  RS.sites = {};
  const { hx, hz } = RS.campus;
  const bs = repo.branches.slice().sort((a, b) => a.created - b.created);
  const resA = .1, resB = 1.2, span = Math.PI * 2 - (resB - resA), n = bs.length;
  bs.forEach((b, i) => {
    const a = resB + span * (i + .5) / Math.max(n, 1);
    const behindF = clamp(Math.log1p(b.behind) / Math.log1p(220), 0, 1);
    const gap = 11 + behindF * 22;
    const x = Math.cos(a) * (hx + gap), z = Math.sin(a) * (hz + gap);
    const stale = isStale(b), rel = b.kind === 'release';
    const s = 4.8 + clamp(Math.log2(b.add + b.del + 1) * .45, 0, 5);
    const site = new THREE.Group(); site.position.set(x, 0, z);
    const data = { layer: 'branches', kind: 'branch', name: b.name };
    const pad = box(s, .3, s, M(rel ? P.padRelease : P.pad)); pad.position.y = .15; site.add(pickable(pad, data));
    const sh = rel ? 1.4 : 1.6 + Math.min(b.ahead, 24) * .3;
    const sw = s - 1.3;
    const scafMat = new THREE.LineBasicMaterial({ color: stale ? P.tether : P.scaffold, transparent: true, opacity: stale ? .45 : .95 });
    const scaf = new THREE.LineSegments(scaffoldGeometry(sw, sh, sw, 1.25), scafMat); scaf.position.y = .3; site.add(scaf);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sw), MB(0xffffff)); hit.visible = false; hit.position.y = .3 + sh / 2; site.add(pickable(hit, data));
    // one crate per touched file, tinted by the district it lands in
    const crates = [];
    const cols = Math.max(1, Math.ceil(Math.sqrt(b.files.length))), cell = sw / cols, cs = Math.min(cell * .66, 1.35);
    b.files.forEach((fid, k) => {
      const f = repo.fileById[fid]; const d = repo.districts.find(dd => dd.path === f.district);
      const c = box(cs, cs, cs, M(districtStrong(d.idx)));
      c.position.set(-sw / 2 + cell * (k % cols + .5), .3 + cs / 2, -sw / 2 + cell * (Math.floor(k / cols) + .5));
      c.userData = { fid }; site.add(pickable(c, Object.assign({ fid }, data))); crates.push(c);
    });
    const poleH = sh + 2.4;
    const pole = cyl(.07, .07, poleH, M(P.scaffold), 6); pole.position.set(-s / 2 + .35, poleH / 2 + .3, -s / 2 + .35); site.add(pole);
    const flagMat = M(prColorHex(b), { side: THREE.DoubleSide }); const flag = box(1.5, .85, .06, flagMat); flag.position.set(-s / 2 + .35 + .78, poleH - .2, -s / 2 + .35); site.add(flag);
    if (stale) {
      const wm = M(P.weed);
      for (let k = 0; k < 9; k++) { const wd = new THREE.Mesh(new THREE.ConeGeometry(rnd(.18, .32), rnd(.6, 1.3), 5), wm); wd.position.set(rnd(-s / 2, s / 2), .55, rnd(-s / 2, s / 2)); wd.castShadow = true; site.add(wd); }
    }
    g.add(site);
    // tether back to main: dashed and amber when the branch has drifted far
    const from = new THREE.Vector3(x, .5, z), to = nearestOnCampus(x, z);
    const strained = b.behind > 40;
    const lg = new THREE.BufferGeometry().setFromPoints([from, to]);
    const lm = strained ? new THREE.LineDashedMaterial({ color: P.strained, dashSize: .9, gapSize: .6 }) : new THREE.LineBasicMaterial({ color: P.tether, transparent: true, opacity: .8 });
    const line = new THREE.Line(lg, lm); if (strained) line.computeLineDistances(); g.add(line);
    if (strained && !rel) addLabel(`${b.behind} commits behind main`, from.clone().lerp(to, .5).add(new THREE.Vector3(0, .6, 0)), 'branches', 'lbl-strain');
    const lbl = addLabel(branchLabelHtml(repo, b), new THREE.Vector3(x, sh + 3.1, z), 'branches', 'lbl-card lbl-branch' + (stale ? ' stale' : ''), { action: 'focus-branch', data: b.name });
    RS.sites[b.name] = { group: site, pos: new THREE.Vector3(x, 0, z), top: new THREE.Vector3(x, sh + .6, z), scafMat, size: s, sh, crates, label: lbl, flagMat, stale };
  });
  RS.lastRebuild = performance.now() / 1000;
  RS.dirty = false;
  applyHighlights(true);
}

/* ---------- conflict arcs between branches that edit the same files ---------- */
function buildCollisions(repo) {
  clearLayer('collisions');
  if (!state.showConflicts) return;
  const g = layer('collisions');
  const ringed = new Set();
  for (const c of collisions(repo)) {
    const A = RS.sites[c.a.name], B = RS.sites[c.b.name];
    if (!A || !B) continue;
    const p0 = A.top.clone(), p2 = B.top.clone();
    const mid = p0.clone().add(p2).multiplyScalar(.5); mid.y += 5 + p0.distanceTo(p2) * .3;
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
    const data = { layer: 'collisions', kind: 'conflict', key: c.key };
    const op = c.stale ? .28 : .9;
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, c.stale ? .07 : .13, 6, false), MB(P.spark, { transparent: true, opacity: op }));
    g.add(pickable(tube, data));
    const apex = curve.getPoint(.5);
    if (c.stale) continue;
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(.8), MB(P.spark));
    star.position.copy(apex); g.add(pickable(star, data));
    const sparks = [];
    for (let k = 0; k < 6; k++) { const sp = new THREE.Mesh(new THREE.SphereGeometry(.26, 8, 6), MB(P.spark)); g.add(sp); sparks.push(sp); }
    addLabel(`${c.files.length} shared file${c.files.length > 1 ? 's' : ''}`, apex.clone().add(new THREE.Vector3(0, 1.5, 0)), 'collisions', 'lbl-spark', { action: 'focus-conflict', data: c.key });
    addTicker('collisions', t => {
      sparks.forEach((s, k) => { const u = ((t * .45 + k / sparks.length) % 1) * .5; s.position.copy(curve.getPoint(k % 2 ? u : 1 - u)); });
      star.rotation.y = t * 2.2; star.scale.setScalar(1 + Math.sin(t * 6) * .2);
    });
    for (const fid of c.files) {
      if (ringed.has(fid) || !RS.fileTop[fid]) continue; ringed.add(fid);
      const top = RS.fileTop[fid];
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, .11, 8, 28), MB(P.spark));
      ring.rotation.x = Math.PI / 2; ring.position.set(top.x, top.y + .7, top.z); g.add(ring);
      const by = ring.position.y, ph = Math.random() * 6;
      addTicker('collisions', t => { ring.position.y = by + Math.sin(t * 3 + ph) * .25; ring.rotation.z = t; });
    }
  }
}
function refreshBranches() {
  if (!RS) return;
  buildBranches(RS.repo); buildCollisions(RS.repo);
}

/* ---------- highlight logic: hovered/focused branch ↔ files it touches ---------- */
let hlKey = '';
function applyHighlights(force) {
  if (!RS) return;
  const bName = state.hoverBranch || state.focusBranch;
  const traceFiles = traceFileSet();
  const key = `${bName}|${state.hoverFile}|${[...traceFiles].join(',')}|${Object.keys(RS.sites).length}`;
  if (key === hlKey && !force) return;
  hlKey = key;
  clearLayer('hl');
  const g = layer('hl');
  for (const [name, s] of Object.entries(RS.sites)) {
    const on = name === bName || (state.hoverFile && RS.repo.branches.find(b => b.name === name && b.files.includes(state.hoverFile)));
    s.scafMat.color.set(on ? P.hl : s.stale ? P.tether : P.scaffold);
    s.label.el.classList.toggle('hl', !!on);
  }
  const b = bName && RS.repo.branches.find(x => x.name === bName);
  if (b && RS.sites[b.name]) {
    const s = RS.sites[b.name];
    for (const fid of b.files) {
      const top = RS.fileTop[fid]; if (!top) continue;
      const mid = s.top.clone().lerp(top, .5); mid.y += 6;
      const curve = new THREE.QuadraticBezierCurve3(s.top, mid, top);
      const lg = new THREE.BufferGeometry().setFromPoints(curve.getPoints(30));
      const line = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: P.hl, dashSize: .7, gapSize: .45 }));
      line.computeLineDistances(); g.add(line);
    }
  }
  RS.hlFiles = new Set(b ? b.files : []);
  RS.traceFiles = traceFiles;
}
function traceFileSet() {
  const c = state.selectedSha && state.commits.get(state.selectedSha);
  return new Set(c && RS && c.repo === RS.repo.id ? c.files : []);
}
const _em = new THREE.Color(), _ok = new THREE.Color();
function updateEmissive(dt) {
  if (!RS) return;
  _ok.set(P.ok);
  for (const f of RS.repo.files) {
    const m = RS.fileMesh[f.id]; if (!m) continue;
    f.flash = Math.max(0, (f.flash || 0) - dt * 1.1);
    let i = 0; _em.setRGB(0, 0, 0);
    if (RS.hlFiles && RS.hlFiles.has(f.id)) { _em.set(P.hl); i = .45; }
    if (RS.traceFiles && RS.traceFiles.has(f.id)) { _em.copy(_ok); i = .45; }
    if (state.hoverFile === f.id) { _em.set(P.hl); i = .6; }
    if (f.flash > 0) { _em.lerp(f.flashColor, Math.min(1, f.flash * 1.5)); i = Math.max(i, f.flash * .9); }
    m.material.emissive.copy(_em); m.material.emissiveIntensity = i;
  }
}

/* ---------- animations for live events ---------- */
function flyArc(mesh, from, to, height, dur, done) {
  const mid = from.clone().lerp(to, .5); mid.y = Math.max(from.y, to.y) + height;
  const curve = new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone());
  tween(dur, p => mesh.position.copy(curve.getPoint(ease(p))), done);
}
function pulseAt(pos, color) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(.9, 1.2, 32), MB(color, { transparent: true, opacity: .95, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.copy(pos).add(new THREE.Vector3(0, .08, 0));
  layer('fx').add(ring);
  tween(1, p => { ring.scale.setScalar(1 + p * 2.6); ring.material.opacity = .95 * (1 - p); }, () => { layer('fx').remove(ring); ring.geometry.dispose(); ring.material.dispose(); });
}
function fxPush(repo, b, files) {
  if (!RS || RS.repo !== repo) return;
  const s = RS.sites[b.name], rs = RS;
  RS.dirty = true;
  if (!s) return;
  files.forEach((fid, k) => {
    const top = RS.fileTop[fid]; if (!top) return;
    const pk = new THREE.Mesh(new THREE.BoxGeometry(.55, .55, .55), MB(P.hl));
    pk.position.copy(s.top); layer('fx').add(pk);
    setTimeout(() => { if (RS !== rs) return; flyArc(pk, s.top, top, 7, .95, () => {
      layer('fx').remove(pk); pk.geometry.dispose(); pk.material.dispose();
      if (RS !== rs) return;
      pulseAt(top, P.hl); const f = repo.fileById[fid]; f.flash = 1; f.flashColor.set(P.hl);
    }); }, reduceMotion ? 0 : k * 140);
  });
}
function makeCrane(h) {
  const g = new THREE.Group(); const m = M(P.crane);
  const mast = box(.45, h + 6, .45, m); mast.position.y = (h + 6) / 2; g.add(mast);
  const jib = box(9, .35, .35, m); jib.position.set(-3.2, h + 6, 0); g.add(jib);
  const counter = box(1.3, .9, .9, M(P.scaffold)); counter.position.set(1.6, h + 5.7, 0); g.add(counter);
  return g;
}
function fxMerge(repo, b, files) {
  if (!RS || RS.repo !== repo) return;
  const s = RS.sites[b.name];
  if (!s) { RS.dirty = true; rebuildCrates(repo); return; }
  RS.hold++;
  const rs = RS, fx = layer('fx');
  const crane = makeCrane(s.sh); crane.position.set(s.pos.x + s.size / 2, 0, s.pos.z - s.size / 2); fx.add(crane);
  crane.scale.y = .01; tween(.45, p => { crane.scale.y = Math.max(.01, ease(p)); });
  s.crates.forEach((c, k) => {
    const fid = c.userData.fid; const top = RS.fileTop[fid];
    fx.attach(c);
    const from = c.position.clone();
    setTimeout(() => { if (RS !== rs) return; flyArc(c, from, top ? top.clone().add(new THREE.Vector3(0, .6, 0)) : RS.stagePos, 9, 1.1, () => {
      fx.remove(c); c.geometry.dispose(); c.material.dispose();
      if (top && RS === rs) { pulseAt(top, P.ok); const f = repo.fileById[fid]; f.flash = 1.2; f.flashColor.set(P.ok); }
    }); }, reduceMotion ? 0 : 450 + k * 160);
  });
  tween(1.8, p => { s.scafMat.opacity = .95 * (1 - p); s.group.scale.y = Math.max(.02, 1 - ease(p) * .98); });
  setTimeout(() => {
    if (RS !== rs) return;
    // one new crate drops onto the staging pallet
    rebuildCrates(repo);
    const last = RS.crateMeshes[RS.crateMeshes.length - 1];
    if (last) { const to = last.position.clone(); const from = to.clone().add(new THREE.Vector3(0, 14, 0)); last.position.copy(from); tween(.7, p => last.position.lerpVectors(from, to, p * p)); }
    tween(.4, p => { crane.scale.y = Math.max(.01, 1 - p); }, () => { fx.remove(crane); disposeTree(crane); });
    RS.hold--; RS.dirty = true;
  }, reduceMotion ? 10 : 450 + s.crates.length * 160 + 1250);
}
function fxRelease(repo) {
  if (!RS || RS.repo !== repo) return;
  RS.mainLabel.el.innerHTML = mainLabelHtml(repo);
  const truck = RS.truck, home = RS.truckHome.clone();
  const crates = RS.crateMeshes.filter(m => { const c = state.commits.get(m.userData.sha); return c && c.prod; });
  RS.hold++;
  const rs = RS;
  crates.forEach((m, k) => {
    const to = truck.position.clone().add(new THREE.Vector3(-1.2, 2.2, 0));
    setTimeout(() => { if (RS === rs) flyArc(m, m.position.clone(), to, 4, .6, () => { m.visible = false; }); }, reduceMotion ? 0 : k * 120);
  });
  const t0 = reduceMotion ? 0 : 700 + crates.length * 120;
  setTimeout(() => {
    if (RS !== rs) return;
    tween(2.4, p => { truck.position.x = home.x + ease(p) * 150; }, () => {
      rebuildCrates(repo);
      truck.position.x = home.x + 60;
      tween(1.6, p => { truck.position.x = home.x + 60 * (1 - ease(p)); });
      RS.hold--;
    });
  }, t0);
}

/* ================================================================
   Town view: every repo as a building
   ================================================================ */
function facadeTextures(floors, cols, lit, seedStr) {
  const cw = 18, ch = 22, pad = 6;
  const W = cols * cw + pad * 2, H = floors * ch + pad;
  const a = document.createElement('canvas'); a.width = W; a.height = H;
  const e = document.createElement('canvas'); e.width = W; e.height = H;
  const x = a.getContext('2d'), y = e.getContext('2d');
  x.fillStyle = P.facade; x.fillRect(0, 0, W, H); y.fillStyle = '#000'; y.fillRect(0, 0, W, H);
  const total = floors * cols;
  let h = 0; for (const ch2 of seedStr) h = (h * 31 + ch2.charCodeAt(0)) >>> 0;
  const rng = mulberry32(h);
  const litSet = new Set(shuffle([...Array(total).keys()], rng).slice(0, Math.min(total, lit)));
  for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
    const idx = f * cols + c, px = pad + c * cw + 3, py = pad + f * ch + 3;
    const on = litSet.has(idx);
    x.fillStyle = on ? P.winLit : P.win; x.fillRect(px, py, cw - 6, ch - 8);
    if (on) { y.fillStyle = '#fff'; y.fillRect(px, py, cw - 6, ch - 8); }
  }
  const ta = new THREE.CanvasTexture(a), te = new THREE.CanvasTexture(e);
  return [ta, te];
}
function repoLoc(repo) { return sum(repo.files.map(f => f.loc)); }
function townLabelHtml(repo) {
  const act = repo.branches.filter(isActive).length, prs = openPrs(repo).length;
  const cr = collisions(repo).filter(c => !c.stale).length;
  return `<div class="r-name">${esc(repo.id)}</div><div class="r-meta"><span class="pill ${repo.ci}">${ciName(repo)}</span><span>${act} branches · ${prs} PRs</span>${cr ? `<span class="pill safety">${cr} conflict risk${cr > 1 ? 's' : ''}</span>` : ''}</div>`;
}
function buildTownScene() {
  clearAll();
  RS = null; KS = null; TS = { bld: {} };
  const g = layer('town');
  for (const v of [-48, -16, 16, 48]) {
    const r1 = box(6.5, .1, 108, M(P.road), false); r1.position.set(v, .05, 0); g.add(r1);
    const r2 = box(108, .1, 6.5, M(P.road), false); r2.position.set(0, .06, v); g.add(r2);
    for (let i = -5; i <= 5; i++) {
      const d1 = box(.3, .12, 3, M(P.roadMark), false); d1.position.set(v, .08, i * 9.6 + 4.8); g.add(d1);
      const d2 = box(3, .13, .3, M(P.roadMark), false); d2.position.set(i * 9.6 + 4.8, .09, v); g.add(d2);
    }
  }
  for (const repo of state.repos) buildTownBuilding(repo);
  buildPipes();
}
function buildTownBuilding(repo) {
  const g = layer('town');
  const [px, pz] = repo.def.pos;
  if (!TS.bld[repo.id]) {
    const lot = box(24, .3, 24, M(P.lot)); lot.position.set(px, .15, pz); g.add(lot);
  }
  clearLayer('bld:' + repo.id);
  const bg = layer('bld:' + repo.id);
  const size = repo.lib ? 10 : 13;
  const h = clamp(4 + Math.sqrt(repoLoc(repo)) / 7.5, 7, 24);
  const floors = Math.max(3, Math.round(h / 2.3)), cols = Math.round(size / 2.6);
  const lit = repo.branches.filter(isActive).length;
  const [ta, te] = facadeTextures(floors, cols, lit, repo.id);
  const side = new THREE.MeshStandardMaterial({ map: ta, emissiveMap: te, emissive: new THREE.Color(P.windowLit), emissiveIntensity: P.winI, roughness: .85 });
  const roof = M(P.roof);
  const bm = new THREE.Mesh(new THREE.BoxGeometry(size, h, size), [side, side, roof, roof, side, side]);
  bm.castShadow = true; bm.receiveShadow = true; bm.position.set(px, .3 + h / 2, pz);
  bg.add(pickable(bm, { layer: 'bld:' + repo.id, kind: 'repo', id: repo.id }));
  const capColor = state.townColor === 'team' ? teamColor(repo.team) : (repo.ci === 'jenkins' ? P.jenkins : P.newci);
  const cap = box(size * .82, .5, size * .82, M(capColor)); cap.position.set(px, .3 + h + .25, pz); bg.add(cap);
  const top = .3 + h + .5;
  const chim = cyl(.55, .65, 2.6, M(P.scaffold)); chim.position.set(px - size * .3, top + 1.3, pz - size * .3); bg.add(chim);
  const lampMat = MB(P.ok); const lamp = new THREE.Mesh(new THREE.SphereGeometry(.55, 14, 10), lampMat); lamp.position.set(px + size * .3, top + .6, pz + size * .3); bg.add(lamp);
  let star = null;
  const cr = collisions(repo).filter(c => !c.stale).length;
  if (cr) { star = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), MB(P.spark)); star.position.set(px, top + 4, pz); bg.add(star); }
  let smokeAcc = 0;
  addTicker('bld:' + repo.id, (t, dt) => {
    const st = repo.lastBuild ? repo.lastBuild.status : 'passed';
    lampMat.color.set(st === 'running' ? P.run : st === 'failed' ? P.crit : P.ok);
    lamp.scale.setScalar(st === 'running' ? 1 + Math.sin(t * 8) * .25 : 1);
    if (star) { star.rotation.y = t * 2; star.position.y = top + 4 + Math.sin(t * 3) * .4; }
    const rate = commitsSince(repo, 60) * .35;
    smokeAcc += rate * dt;
    if (smokeAcc >= 1 && !reduceMotion) { smokeAcc = 0; puff(new THREE.Vector3(px - size * .3, top + 2.8, pz - size * .3)); }
  });
  const L = addLabel(townLabelHtml(repo), new THREE.Vector3(px, top + (cr ? 7 : 3.2), pz), 'bld:' + repo.id, 'lbl-card lbl-repo', { action: 'enter-repo', data: repo.id });
  TS.bld[repo.id] = { top, label: L, pos: new THREE.Vector3(px, top, pz), size, lit };
}
function puff(pos) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(.7, 10, 8), MB(P.smoke, { transparent: true, opacity: .5, depthWrite: false }));
  m.position.copy(pos); layer('fx').add(m);
  const drift = new THREE.Vector3(rnd(-1, 1), 0, rnd(-1, 1));
  tween(3.2, p => { m.position.set(pos.x + drift.x * p * 2, pos.y + p * 7, pos.z + drift.z * p * 2); m.scale.setScalar(1 + p * 2); m.material.opacity = .5 * (1 - p); }, () => { layer('fx').remove(m); m.geometry.dispose(); m.material.dispose(); });
}
function buildPipes() {
  clearLayer('pipes');
  if (!state.showPipes || !TS) return;
  const g = layer('pipes');
  for (const a of depAlerts()) {
    const A = TS.bld[a.lib.id], B = TS.bld[a.consumer.id]; if (!A || !B) continue;
    const p0 = new THREE.Vector3(A.pos.x, A.top * .55, A.pos.z), p3 = new THREE.Vector3(B.pos.x, B.top * .55, B.pos.z);
    const dir = p3.clone().sub(p0).normalize();
    const s0 = p0.clone().add(dir.clone().multiplyScalar(A.size / 2 + .2)), s3 = p3.clone().sub(dir.clone().multiplyScalar(B.size / 2 + .2));
    const mid = s0.clone().lerp(s3, .5); mid.y = Math.max(A.top, B.top) * .55 + 7;
    const curve = new THREE.CatmullRomCurve3([s0, s0.clone().lerp(mid, .5).setY(mid.y - 1.5), mid, s3.clone().lerp(mid, .5).setY(mid.y - 1.5), s3]);
    const color = a.behind ? P.spark : P.pipe;
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, .38, 10, false), M(color, { emissive: a.behind ? new THREE.Color(P.spark) : new THREE.Color(0), emissiveIntensity: a.behind ? .25 : 0 }));
    tube.castShadow = true;
    g.add(pickable(tube, { layer: 'pipes', kind: 'pipe', lib: a.lib.id, consumer: a.consumer.id }));
    const balls = [];
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(.5, 10, 8), MB(a.behind ? P.spark : P.hl)); g.add(b); balls.push(b); }
    addTicker('pipes', t => balls.forEach((b, k) => b.position.copy(curve.getPoint(((t * .12) + k / balls.length) % 1))));
    if (a.behind) addLabel(`${esc(a.consumer.id)} on ${esc(a.have)} · latest ${esc(a.want)}`, curve.getPoint(.5).add(new THREE.Vector3(0, 1.2, 0)), 'pipes', 'lbl-pipe');
  }
}
function refreshTownBuilding(repo) {
  if (!TS) return;
  buildTownBuilding(repo);
}

/* ---------- theme ---------- */
function applyTheme() {
  P = isDark() ? PAL.dark : PAL.light;
  scene.background = new THREE.Color(P.bg);
  scene.fog = new THREE.Fog(P.bg, 320, 900);
  groundMat.color.set(P.ground);
  hemi.color.set(P.hemiSky); hemi.groundColor.set(P.hemiGround); hemi.intensity = P.hemiI;
  sun.intensity = P.sunI;
}

/* ---------- hover & click ---------- */
let hoverData = null;
function setHover(d) {
  hoverData = d;
  const prevB = state.hoverBranch, prevF = state.hoverFile;
  state.hoverBranch = d && (d.kind === 'branch') ? d.name : null;
  state.hoverFile = d && d.kind === 'file' ? d.id : null;
  state.hoverPod = d && d.kind === 'pod' ? d.id : null;
  if (prevB !== state.hoverBranch || prevF !== state.hoverFile) applyHighlights();
  canvas.classList.toggle('pointer', !!d && d.kind !== 'district');
  if (!d) { tipEl.hidden = true; return; }
  const html = tipHtml(d);
  if (!html) { tipEl.hidden = true; return; }
  tipEl.innerHTML = html; tipEl.hidden = false;
}
function positionTip() {
  if (tipEl.hidden) return;
  const w = stageEl.clientWidth, h = stageEl.clientHeight, tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  let x = ptr.px + 16, y = ptr.py + 16;
  if (x + tw > w - 8) x = ptr.px - tw - 16;
  if (y + th > h - 8) y = ptr.py - th - 16;
  tipEl.style.left = Math.max(8, x) + 'px'; tipEl.style.top = Math.max(8, y) + 'px';
}
function row(k, v) { return `<div class="t-row"><span>${k}</span><b>${v}</b></div>`; }
function tipHtml(d) {
  if (d.kind === 'file' && RS) {
    const repo = RS.repo, f = repo.fileById[d.id];
    const inBranches = repo.branches.filter(b => b.files.includes(f.id));
    const live = inBranches.filter(b => !isStale(b));
    return `<h4>${esc(f.id)}</h4>${row('Lines', f.loc.toLocaleString())}${row('Changes, last 30 days', f.churn)}${row('Complexity', Math.round(f.complexity * 100) + '/100')}${row('Owner', f.owner ? esc(teamName(f.owner)) : 'No CODEOWNERS')}
      ${inBranches.length ? `<div class="t-note ${live.length > 1 ? 'safety' : ''}">${live.length > 1 ? `Being changed in ${live.length} open branches` : `Changed in ${inBranches.length} open branch${inBranches.length > 1 ? 'es' : ''}`}:</div><ul>${inBranches.map(b => `<li class="mono">${esc(b.name)}</li>`).join('')}</ul>` : '<div class="t-note">No open branch touches this file.</div>'}`;
  }
  if (d.kind === 'branch' && RS) {
    const b = RS.repo.branches.find(x => x.name === d.name); if (!b) return '';
    const cs = collisions(RS.repo).filter(c => c.a === b || c.b === b);
    const fileLine = d.fid ? `<div class="t-note">Crate: <span class="mono">${esc(d.fid)}</span></div>` : '';
    return `<h4>${esc(b.name)}</h4>${row('Author', esc(personName(b.author)))}${row('Ahead / behind main', `${b.ahead} / ${b.behind}`)}${row('Last commit', fmtAge(sim.now - b.last) + (sim.now - b.last >= 1 ? ' ago' : ''))}${row('Diff', `+${b.add} −${b.del}`)}${row('Files touched', b.files.length)}${row('Pull request', b.pr ? `#${b.pr.n} · ${PR_STATES[b.pr.state].label}` : 'none')}${fileLine}${cs.length ? `<div class="t-note safety">Overlaps with ${cs.map(c => esc((c.a === b ? c.b : c.a).name)).join(', ')}</div>` : ''}`;
  }
  if (d.kind === 'conflict' && RS) {
    const c = collisions(RS.repo).find(x => x.key === d.key); if (!c) return '';
    return `<h4>Conflict risk</h4><div class="t-row"><span class="mono">${esc(c.a.name)}</span></div><div class="t-row"><span class="mono">${esc(c.b.name)}</span></div><div class="t-note ${c.stale ? '' : 'safety'}">Both change:</div><ul>${c.files.map(f => `<li class="mono">${esc(f)}</li>`).join('')}</ul>${c.stale ? '<div class="t-note">One branch is stale, so this is lower priority.</div>' : '<div class="t-note">Whoever merges second will likely hit a merge conflict. Coordinate now.</div>'}`;
  }
  if (d.kind === 'staged' || d.kind === 'stage') {
    const repo = RS.repo; const list = repo.staged.map(s => state.commits.get(s));
    return `<h4>Staged for release</h4><div class="t-note">${list.length ? `${list.length} merged change${list.length > 1 ? 's' : ''} not yet in production:` : 'Nothing waiting. main matches production.'}</div><ul>${list.map(c => `<li>#${c.pr} ${esc(c.msg)}</li>`).join('')}</ul>`;
  }
  if (d.kind === 'repo') {
    const r = state.byId[d.id];
    const cr = collisions(r).filter(c => !c.stale).length;
    return `<h4>${esc(r.id)}</h4>${row('Stack', esc(r.lang))}${row('Team', esc(teamName(r.team)))}${row('CI', ciName(r))}${row('In production', esc(verLabel(r.version)))}${row('Active branches (lit windows)', r.branches.filter(isActive).length)}${row('Open PRs', openPrs(r).length)}${row('Commits, last hour (smoke)', commitsSince(r, 60))}${row('Staged for release', r.staged.length)}${cr ? `<div class="t-note safety">${cr} conflict risk${cr > 1 ? 's' : ''} between open branches</div>` : ''}<div class="t-note">Click to open the repo.</div>`;
  }
  if (d.kind === 'pod') return podTipHtml(d.id);
  if (d.kind === 'bay') return bayTipHtml(d.key);
  if (d.kind === 'pipe') {
    const L = state.byId[d.lib], C = state.byId[d.consumer];
    const behind = cmpVer(C.deps[L.id], L.version) < 0;
    return `<h4>${esc(L.id)} → ${esc(C.id)}</h4>${row('Latest release', L.version)}${row(`${esc(C.id)} uses`, C.deps[L.id])}<div class="t-note ${behind ? 'safety' : ''}">${behind ? 'Needs a version bump.' : 'Up to date.'}</div>`;
  }
  return '';
}
