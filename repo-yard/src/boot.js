/* ================================================================
   Wiring: sim events → 3D + panels
   ================================================================ */
emit = (type, repo, data) => {
  const inRepo = RS && RS.repo === repo;
  switch (type) {
    case 'feed': prependFeed(data); break;
    case 'toast': toast(data); break;
    case 'push': if (inRepo) fxPush(repo, data.branch, data.files); break;
    case 'merge':
      if (inRepo) fxMerge(repo, data.branch, data.files);
      if (TS) { refreshTownBuilding(repo); if (data.branch.bump) buildPipes(); }
      break;
    case 'release':
      if (inRepo) fxRelease(repo);
      if (TS && repo.lib) buildPipes();
      break;
    case 'branches': case 'pr':
      if (inRepo) RS.dirty = true;
      if (TS && (type === 'branches')) refreshTownBuilding(repo);
      break;
    case 'k8s':
      if (KS && data.rolloutStart) fxPromote(data.rolloutStart);
      break;
    case 'build': case 'deploy':
      if (inRepo && RS.stageLabel) RS.stageLabel.el.innerHTML = stageLabelHtml(repo);
      break;
  }
  if (TS && (type === 'push' || type === 'pr') && TS.bld[repo.id]) {
    const b = TS.bld[repo.id];
    b.label.el.innerHTML = townLabelHtml(repo);
    if (repo.branches.filter(isActive).length !== b.lit || (collisions(repo).some(c => !c.stale) !== !!b.label.el.querySelector('.safety'))) refreshTownBuilding(repo);
  }
  ui.dirty = true;
};

/* ---------- view switching ---------- */
function enterRepo(id, keepCamera) {
  state.view = { mode: 'repo', repoId: id }; state.lastCode = state.view; state.hoverPod = null;
  state.focusBranch = null; state.hoverBranch = null; state.hoverFile = null;
  tipEl.hidden = true;
  buildRepoScene(state.byId[id]);
  if (!keepCamera) defaultView(true);
  renderAll();
}
function enterCluster(depId) {
  state.view = { mode: 'cluster' };
  state.focusBranch = null; state.hoverBranch = null; state.hoverFile = null; state.hoverPod = null;
  state.selectedDep = depId || null;
  const d = depId && k8s.deps.find(x => x.id === depId);
  if (d && state.k8sEnv !== 'both') state.k8sEnv = d.env;
  tipEl.hidden = true;
  buildClusterScene();
  defaultView(!depId);
  if (depId) { cam.r = goal.r * 1.4; focusDep(depId); }
  renderAll();
}
function selectDep(id) {
  state.selectedDep = id || null;
  const d = id && k8s.deps.find(x => x.id === id);
  if (d && state.k8sEnv !== 'both' && d.env !== state.k8sEnv) { state.k8sEnv = d.env; buildClusterScene(); renderLayers(); }
  applyBayHighlight();
  if (id) focusDep(id); else defaultView(false);
  renderCrumbs(); renderSide();
  $('#side').scrollTop = 0;
}
function enterTown() {
  state.view = { mode: 'town' }; state.lastCode = state.view; state.hoverPod = null;
  state.focusBranch = null; state.hoverBranch = null; state.hoverFile = null;
  tipEl.hidden = true;
  buildTownScene();
  defaultView(false);
  goal.r *= 1; cam.r = goal.r * .7;
  renderAll();
}
function renderAll() { renderCrumbs(); renderSimControls(); renderKpis(); renderLayers(); renderSide(); renderTrace(); $('#feed-scope').textContent = 'All repos'; ui.dirty = false; }

function focusBranch(name) {
  if (!RS) return;
  state.focusBranch = name;
  const s = RS.sites[name];
  if (s) focusOn(s.pos, 80);
  applyHighlights(true);
  renderSide();
}
function focusConflict(key) {
  if (!RS) return;
  const c = collisions(RS.repo).find(x => x.key === key); if (!c) return;
  const A = RS.sites[c.a.name], B = RS.sites[c.b.name];
  if (A && B) focusOn(A.pos.clone().lerp(B.pos, .5), Math.max(70, A.pos.distanceTo(B.pos) * 1.6));
  state.focusBranch = c.a.name;
  applyHighlights(true);
}
function selectCommit(sha) {
  state.selectedSha = sha;
  document.querySelectorAll('.sha').forEach(b => b.classList.toggle('sel', b.dataset.id === sha));
  renderTrace();
  applyHighlights(true);
}
function showInYard() {
  const c = state.selectedSha && state.commits.get(state.selectedSha); if (!c) return;
  if (!curRepo() || curRepo().id !== c.repo) enterRepo(c.repo);
  const b = RS.repo.branches.find(x => x.name === c.branch);
  if (b) focusBranch(b.name);
  else if (c.files.length && RS.fileTop[c.files[0]]) { focusOn(RS.fileTop[c.files[0]], 90); }
  applyHighlights(true);
  for (const fid of c.files) { const f = RS.repo.fileById[fid]; if (f && RS.fileTop[fid]) { f.flash = 1.4; f.flashColor.set(P.ok); pulseAt(RS.fileTop[fid], P.ok); } }
}
function handleClick() {
  const d = pickAt();
  if (!d) { if (state.focusBranch) { state.focusBranch = null; applyHighlights(true); renderSide(); } return; }
  if (d.kind === 'repo') return enterRepo(d.id);
  if (d.kind === 'pod') { const p = k8s.pods.get(d.id); if (p) selectDep(p.dep.id); return; }
  if (d.kind === 'bay') { if (d.key.startsWith('dep:')) selectDep(d.key.slice(4)); return; }
  if (d.kind === 'branch') return focusBranch(d.name);
  if (d.kind === 'conflict') return focusConflict(d.key);
  if (d.kind === 'staged') return selectCommit(d.sha);
  if (d.kind === 'file' && RS) {
    // trace the latest commit that touched this file
    const repo = RS.repo;
    for (let i = repo.log.length - 1; i >= 0; i--) { const c = state.commits.get(repo.log[i]); if (c.files.includes(d.id)) { selectCommit(c.sha); break; } }
  }
  if (d.kind === 'pipe') { const C = state.byId[d.consumer]; return enterRepo(C.id); }
}

/* ---------- click delegation for all HUD controls ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]'); if (!t) return;
  const a = t.dataset.action, id = t.dataset.id;
  switch (a) {
    case 'pause': sim.paused = !sim.paused; renderSimControls(); break;
    case 'speed': sim.speed = +t.dataset.speed; renderSimControls(); break;
    case 'town': enterTown(); break;
    case 'view-k8s': if (state.view.mode !== 'cluster') enterCluster(); break;
    case 'view-code': if (state.view.mode === 'cluster') { const l = state.lastCode || { mode: 'repo', repoId: 'payments-api' }; if (l.mode === 'town') enterTown(); else enterRepo(l.repoId); } break;
    case 'open-k8s': enterCluster(id); break;
    case 'select-dep': selectDep(id); break;
    case 'k8s-layout': state.k8sLayout = id; buildClusterScene(); renderLayers(); break;
    case 'k8s-env': state.k8sEnv = id; buildClusterScene(); defaultView(false); renderLayers(); break;
    case 'enter-repo': enterRepo(id); break;
    case 'focus-branch': focusBranch(id); break;
    case 'focus-conflict': focusConflict(id); break;
    case 'trace': selectCommit(id); break;
    case 'show-in-yard': showInYard(); break;
    case 'ship': { const r = curRepo(); if (r) doRelease(r, true); ui.dirty = true; break; }
    case 'layer': state.layer = id; recolorFiles(); renderLayers(); break;
    case 'toggle-conflicts': state.showConflicts = !state.showConflicts; if (RS) buildCollisions(RS.repo); renderLayers(); break;
    case 'town-color': state.townColor = id; if (TS) state.repos.forEach(refreshTownBuilding); renderLayers(); break;
    case 'toggle-pipes': state.showPipes = !state.showPipes; buildPipes(); if (!state.showPipes) clearLayer('pipes'); renderLayers(); break;
    case 'zoom-in': goal.r = clamp(goal.r * .75, 30, 520); break;
    case 'zoom-out': goal.r = clamp(goal.r * 1.33, 30, 520); break;
    case 'rotate': goal.theta -= Math.PI / 2; break;
    case 'reset-cam': defaultView(false); break;
  }
  if (e.detail > 0 && t.closest('#side') && document.activeElement && document.activeElement.blur) document.activeElement.blur();
});
$('#side').addEventListener('pointerdown', () => { ui.holdSide = true; });
window.addEventListener('pointerup', () => { if (ui.holdSide) { ui.holdSide = false; ui.dirty = true; } });
$('#side').addEventListener('focusout', () => { if (ui.pendingSide) setTimeout(renderSide, 0); });

/* ---------- resize & theme ---------- */
function resize() {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stageEl);
function rethemeScene() {
  applyTheme();
  if (state.view.mode === 'repo') enterRepo(state.view.repoId, true);
  else if (state.view.mode === 'cluster') { buildClusterScene(); renderAll(); }
  else { buildTownScene(); renderAll(); }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rethemeScene);
new MutationObserver(rethemeScene).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* ================================================================
   Main loop
   ================================================================ */
let lastT = performance.now(), uiAcc = 0, colorAcc = 0;
function frame(now) {
  const dt = Math.min(.05, (now - lastT) / 1000); lastT = now;
  const t = now / 1000;
  if (!sim.paused) simTick(dt * sim.speed);
  updateCamera(dt);
  const adt = dt * Math.min(sim.speed, 2.5);
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i]; a.t += sim.paused ? dt : adt;
    const p = Math.min(1, a.t / a.dur); a.update(p);
    if (p >= 1) { anims.splice(i, 1); if (a.done) a.done(); }
  }
  for (const k in tickers) for (const fn of tickers[k]) fn(t, dt);
  updateEmissive(dt);
  updateK8sScene(dt, t);
  if (RS && RS.dirty && RS.hold === 0 && t - RS.lastRebuild > .4) refreshBranches();
  if (ptr.dirty && ptr.inside && !ptr.down) { ptr.dirty = false; setHover(pickAt()); }
  positionTip();
  renderer.render(scene, camera);
  updateLabels();
  renderClock();
  colorAcc += dt; if (colorAcc > .5) { colorAcc = 0; recolorFiles(); }
  uiAcc += dt;
  if ((ui.dirty && uiAcc > .35) || uiAcc > 1.5) {
    uiAcc = 0; ui.dirty = false;
    renderKpis(); renderSide(); renderTrace(); refreshBayLabels();
    if (RS && RS.stageLabel) RS.stageLabel.el.innerHTML = stageLabelHtml(RS.repo);
  }
  requestAnimationFrame(frame);
}

/* ---------- boot ---------- */
buildRepos();
buildK8s();
seedFeed();
applyTheme();
resize();
renderFeed();
enterRepo(state.view.repoId);
sim.nextEventAt = sim.now + 1.2;
// pick up the boot-time running PR checks
for (const r of state.repos) for (const b of r.branches) if (b.pr && b.pr.ci === 'running') {
  after(rnd(2, 6), () => { if (b.pr) { b.pr.ci = 'passing'; if (b.pr.state === 'in_review' && approvals(b.pr) >= 2) b.pr.state = 'approved'; ui.dirty = true; if (RS && RS.repo === r) RS.dirty = true; } });
}
requestAnimationFrame(frame);
