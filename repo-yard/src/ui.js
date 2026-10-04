/* ================================================================
   HUD & panels
   ================================================================ */
const svg = p => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  push: svg('<path d="M8 13V3M4 7l4-4 4 4"/>'),
  pr: svg('<circle cx="4" cy="4" r="1.6"/><circle cx="4" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><path d="M4 5.6v4.8M12 10.4V7a2 2 0 0 0-2-2H7M8.5 3.5 7 5l1.5 1.5"/>'),
  approve: svg('<path d="M3 8.5 6.5 12 13 4.5"/>'),
  changes: svg('<path d="M2.5 3h11v7.5H7l-3 2.5v-2.5H2.5z"/>'),
  merge: svg('<circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="8" r="1.6"/><path d="M4 5.1v5.8M4 5.5c0 2.5 2 2.5 6.4 2.5"/>'),
  build: svg('<circle cx="8" cy="8" r="2.3"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6 5 5M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4"/>'),
  fail: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  release: svg('<path d="M1.5 4.5h8v6h-8zM9.5 7h3l2 2v1.5h-5"/><circle cx="4.5" cy="11.8" r="1.3"/><circle cx="11.5" cy="11.8" r="1.3"/>'),
  branch: svg('<circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="5" r="1.6"/><path d="M4 5.1v5.8M12 6.6c0 3-8 2-8 4.3"/>'),
  deploy: svg('<path d="M8 2 13.5 4.8v6.4L8 14l-5.5-2.8V4.8z"/><path d="M2.5 4.8 8 7.6l5.5-2.8M8 7.6V14"/>'),
  conflict: svg('<path d="M8 2.2 14.5 13.5h-13z"/><path d="M8 6.5v3.2M8 11.6v.1"/>'),
  trash: svg('<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/>'),
  sync: svg('<path d="M13 8a5 5 0 0 1-9 3M3 8a5 5 0 0 1 9-3"/><path d="M12 2v3H9M4 14v-3h3"/>'),
  commit: svg('<circle cx="8" cy="8" r="2.6"/><path d="M1.5 8h3.9M10.6 8h3.9"/>'),
  review: svg('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>'),
  image: svg('<path d="M8 2 14 5 8 8 2 5z"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3"/>'),
  staging: svg('<rect x="2.5" y="2.5" width="11" height="4.5" rx="1"/><rect x="2.5" y="9" width="11" height="4.5" rx="1"/><path d="M5 4.75h.1M5 11.25h.1"/>'),
  prod: svg('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2.2 2 2.2 10 0 12M8 2c-2.2 2-2.2 10 0 12"/>'),
  pause: svg('<path d="M5.5 3.5v9M10.5 3.5v9"/>'),
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L13 8z" fill="currentColor"/></svg>',
  wait: svg('<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>')
};

const ui = { dirty: true, lastRender: 0, holdSide: false };
function curRepo() { return state.view.mode === 'repo' ? state.byId[state.view.repoId] : null; }

/* ---------- top bar ---------- */
function renderCrumbs() {
  const r = curRepo();
  $('#crumbs').innerHTML = r
    ? `<button data-action="town">All repos</button><span class="sep">/</span><span class="here">${esc(r.id)}</span>`
    : `<span class="here">All repos</span>`;
}
function renderSimControls() {
  $('#btn-pause').innerHTML = sim.paused ? ICON.play : ICON.pause;
  $('#btn-pause').setAttribute('aria-label', sim.paused ? 'Resume simulation' : 'Pause simulation');
  document.querySelectorAll('#speed-seg button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === sim.speed)));
  $('#clock-wrap').classList.toggle('paused', sim.paused);
  $('#clock-wrap').querySelector('span:nth-child(2)').textContent = sim.paused ? 'Paused' : 'Live';
}
let lastClock = '';
function renderClock() { const s = fmtClock(sim.now); if (s !== lastClock) { $('#clock').textContent = s; lastClock = s; } }

/* ---------- KPI cards ---------- */
function kpi(label, val, sub, alert) { return `<div class="kpi${alert ? ' alert' : ''}"><div class="k-label">${label}</div><div class="k-val">${val}</div><div class="k-sub">${sub}</div></div>`; }
function renderKpis() {
  const r = curRepo();
  const repos = r ? [r] : state.repos;
  const active = sum(repos.map(x => x.branches.filter(isActive).length));
  const stale = sum(repos.map(x => x.branches.filter(isStale).length));
  const prs = sum(repos.map(x => openPrs(x).length));
  const waits = reviewWaits(repos);
  const slow = waits.filter(w => w > DAY).length;
  const conf = sum(repos.map(x => collisions(x).filter(c => !c.stale).length));
  const staged = sum(repos.map(x => x.staged.length));
  const lastHour = sum(repos.map(x => commitsSince(x, 60)));
  let html = '';
  if (!r) html += kpi('Commits, last hour', lastHour, `across ${state.repos.length} repos`);
  html += kpi('Active branches', active, stale ? `${stale} stale, idle 14d+` : 'none stale');
  html += kpi('Open pull requests', prs, slow ? `<b>${slow} waiting over 24h</b>` : 'none waiting over 24h');
  html += kpi('Median review wait', fmtWait(median(waits)), `${waits.length} PRs awaiting review`);
  if (r) html += kpi('Staged for release', staged, `merged, not in production`);
  html += kpi('Conflict risks', conf, conf ? 'branches editing the same files' : 'no overlapping work', conf > 0);
  $('#kpis').innerHTML = html;
}

/* ---------- layer chips + legend ---------- */
function renderLayers() {
  const el = $('#layers');
  if (curRepo()) {
    const L = [['structure', 'Structure'], ['activity', 'Live activity'], ['hotspots', 'Hotspots'], ['owners', 'Owners']];
    el.innerHTML = `<span class="l-title">Color by</span>${L.map(([k, n]) => `<button class="chip-btn" data-action="layer" data-id="${k}" aria-pressed="${state.layer === k}">${n}</button>`).join('')}<span class="divider"></span><button class="chip-btn" data-action="toggle-conflicts" aria-pressed="${state.showConflicts}"><span class="sw" style="color:var(--safety)"></span>Conflict arcs</button>`;
  } else {
    el.innerHTML = `<span class="l-title">Roof color</span><button class="chip-btn" data-action="town-color" data-id="ci" aria-pressed="${state.townColor === 'ci'}">CI system</button><button class="chip-btn" data-action="town-color" data-id="team" aria-pressed="${state.townColor === 'team'}">Team</button><span class="divider"></span><button class="chip-btn" data-action="toggle-pipes" aria-pressed="${state.showPipes}"><span class="sw" style="color:var(--safety)"></span>Shared libraries</button>`;
  }
  renderLegend();
}
function cssHex(n) { return '#' + n.toString(16).padStart(6, '0'); }
function renderLegend() {
  const key = $('#legend-key'), body = $('#legend-body');
  if (curRepo()) {
    let k = '';
    if (state.layer === 'activity') k = `<div><b>Live activity</b>: files pushed to recently glow, cooling over about an hour.<div class="ramp" style="background:linear-gradient(90deg,${P.heat.map(cssHex).join(',')})"></div><div class="ramp-lbl"><span>quiet</span><span>being edited now</span></div></div>`;
    else if (state.layer === 'hotspots') k = `<div><b>Hotspots</b>: changes in the last 30 days × complexity. Bugs and merge pain collect here.<div class="ramp" style="background:linear-gradient(90deg,${cssHex(P.hotLo)},${cssHex(P.hotMid)},${cssHex(P.hotHi)})"></div><div class="ramp-lbl"><span>calm</span><span>hotspot</span></div></div>`;
    else if (state.layer === 'owners') k = `<div><b>Owners</b> from CODEOWNERS. Fog marks code nobody owns.<div class="teams" style="margin-top:4px">${Object.entries(TEAMS).filter(([id]) => curRepo().files.some(f => f.owner === id)).map(([id, t]) => `<span><i style="background:${teamColor(id)}"></i>${t.name}</span>`).join('')}<span><i style="background:${cssHex(P.unowned)}"></i>Unowned</span></div></div>`;
    key.innerHTML = k;
    body.innerHTML = `<div><b>Campus</b> = main. Districts are folders; building height is lines of code.</div><div><b>Scaffolding</b> = an open branch. Height is commits ahead; each crate is a file it changes.</div><div><b>Distance</b> from campus = commits behind main. Weeds mean idle 14+ days.</div><div><b>Orange arcs</b> join branches that edit the same files.</div><div><b>Pallets</b> by the truck = merged, not yet released.</div>`;
  } else {
    key.innerHTML = '';
    body.innerHTML = `<div><b>Height</b> = codebase size. <b>Lit windows</b> = active branches.</div><div><b>Smoke</b> = commits in the last hour. <b>Roof light</b> = latest main build.</div><div><b>Roof color</b> = CI system or team.</div><div><b>Pipes</b> = shared libraries; orange means a consumer is on an old version.</div>`;
  }
}

/* ---------- side panel ---------- */
function renderSide() {
  const side = $('#side');
  if (ui.holdSide) return;
  if (side.contains(document.activeElement) && document.activeElement !== side) { ui.pendingSide = true; return; }
  const r = curRepo();
  side.innerHTML = r ? repoPanel(r) : townPanel();
  ui.pendingSide = false;
}
function stat(l, v, cls) { return `<div class="stat ${cls || ''}"><div class="s-l">${l}</div><div class="s-v">${v}</div></div>`; }
function prCard(pr, b) {
  const waited = sim.now - pr.requestedAt;
  const wcls = pr.state === 'draft' ? '' : waited > 3 * DAY ? 'crit' : waited > DAY ? 'warn' : '';
  const pips = pr.reviewers.map(r => `<i class="${r.s === 'approved' ? 'ok' : r.s === 'changes' ? 'x' : ''}" title="${esc(PEOPLE[r.p])}: ${r.s}"></i>`).join('');
  const ci = pr.ci === 'running' ? 'run' : pr.ci === 'failing' ? 'crit' : 'ok';
  const focus = state.focusBranch === b.name;
  return `<button class="pr${focus ? ' hl' : ''}" data-action="focus-branch" data-id="${esc(b.name)}">
    <div class="p-top"><span class="p-n">#${pr.n}</span><span class="p-title">${esc(pr.title)}</span></div>
    <div class="p-meta">${avatar(pr.author)}<span class="diff"><span class="a">+${b.add}</span> <span class="d">−${b.del}</span></span>
      ${pr.reviewers.length ? `<span class="pips" title="Approvals">${pips}</span>` : ''}
      <span style="display:inline-flex;align-items:center;gap:4px"><span class="dot ${ci}"></span>CI ${pr.ci}</span>
      ${pr.state === 'draft' ? `<span>opened ${fmtAge(sim.now - pr.openedAt)} ago</span>` : `<span class="pill ${wcls}">waiting ${fmtWait(waited)}</span>`}</div></button>`;
}
function repoPanel(r) {
  const prsB = r.branches.filter(b => b.pr);
  const conf = collisions(r);
  const live = conf.filter(c => !c.stale);
  const lanes = ['review_requested', 'in_review', 'changes_requested', 'approved', 'draft'];
  const laneColor = { draft: 'var(--faint)', review_requested: 'var(--accent)', in_review: 'var(--accent)', changes_requested: 'var(--warn)', approved: 'var(--ok)' };
  const rq = reviewerQueues(r);
  const maxQ = Math.max(4, ...rq.map(q => q.prs.length));
  const stagedList = r.staged.map(s => state.commits.get(s));
  const readyN = stagedList.filter(c => c.staging).length;
  const branches = r.branches.slice().sort((a, b) => (isStale(a) - isStale(b)) || (a.last < b.last ? 1 : -1));
  return `
  <section>
    <div class="eyebrow">${esc(TEAMS[r.team].name)} team · ${esc(r.lang)}</div>
    <h2>${esc(r.id)}</h2>
    <div class="chips"><span class="pill ${r.ci}">${r.ci === 'jenkins' ? 'Builds on Jenkins' : 'Builds on new CI/CD'}</span><span class="pill">v${esc(r.version)} in production</span>${Object.entries(r.deps).map(([l, v]) => `<span class="pill ${cmpVer(v, state.byId[l].version) < 0 ? 'safety' : ''}">${esc(l)} ${esc(v)}</span>`).join('')}</div>
    <div class="stat-grid">
      ${stat('Active branches', `${r.branches.filter(isActive).length}<small>${r.branches.filter(isStale).length ? `+${r.branches.filter(isStale).length} stale` : ''}</small>`)}
      ${stat('Open PRs', prsB.length)}
      ${stat('Staged for release', `${r.staged.length}<small>${readyN} on staging</small>`)}
      ${stat('Conflict risks', live.length, live.length ? 'safety' : '')}
    </div>
  </section>
  <section>
    <h3>Conflict risks <span class="count ${live.length ? 'safety' : ''}">${conf.length}</span><span class="h-aside">open branches editing the same files</span></h3>
    ${conf.length ? conf.map(c => `<button class="conflict${c.stale ? ' stale' : ''}" data-action="focus-conflict" data-id="${esc(c.key)}">
      <div class="c-pair"><span>${esc(c.a.name)}</span><i>and</i><span>${esc(c.b.name)}</span></div>
      <div class="c-files">Both change ${c.files.map(f => `<b>${esc(fileName(f))}</b>`).join(', ')}${c.stale ? ' · one branch is stale' : ''}</div></button>`).join('') : '<div class="empty">No open branches overlap. Merges should be clean.</div>'}
  </section>
  <section>
    <h3>Pull request docks <span class="count">${prsB.length}</span><span class="h-aside">oldest wait first</span></h3>
    ${lanes.map(st => {
      const items = prsB.filter(b => b.pr.state === st).sort((a, b) => a.pr.requestedAt - b.pr.requestedAt);
      if (!items.length) return '';
      return `<div class="lane"><div class="lane-h"><span class="bar" style="background:${laneColor[st]}"></span>${PR_STATES[st].label} <span class="n">${items.length}</span></div>${items.map(b => prCard(b.pr, b)).join('')}</div>`;
    }).join('') || '<div class="empty">No open pull requests.</div>'}
  </section>
  <section>
    <h3>Staged for release <span class="count">${r.staged.length}</span></h3>
    ${stagedList.length ? `<div class="staged-list">${stagedList.map(c => `<div class="staged-item"><button class="sha${state.selectedSha === c.sha ? ' sel' : ''}" data-action="trace" data-id="${c.sha}">${c.sha}</button><span>#${c.pr} ${esc(c.msg)}</span></div>`).join('')}</div>` : '<div class="empty">Nothing waiting. main matches production.</div>'}
    <button class="btn primary" data-action="ship" ${readyN ? '' : 'disabled'}>Ship ${readyN || ''} to production</button>
  </section>
  <section>
    <h3>Review queues <span class="h-aside">pending reviews per person</span></h3>
    ${rq.length ? rq.map(q => `<div class="rq">${avatar(q.p, true)}<div><div class="rq-name">${esc(PEOPLE[q.p])}</div><div class="rq-sub">${q.prs.map(p => '#' + p.n).join(', ')} · oldest ${fmtWait(q.oldest)}</div></div>
      <div class="crates" aria-label="${q.prs.length} pending">${Array.from({ length: maxQ }, (_, i) => `<i class="${i < q.prs.length ? (q.oldest > DAY ? 'old' : 'on') : ''}"></i>`).join('')}</div></div>`).join('') : '<div class="empty">Nobody has reviews waiting.</div>'}
    <div class="caption">Shows queue size so reviews get spread evenly. No commit counts or per-person output.</div>
  </section>
  <section>
    <h3>Branches <span class="count">${r.branches.length}</span></h3>
    <div class="tbl-wrap"><table class="btable"><thead><tr><th>Branch</th><th>Ahead / behind</th><th>Last commit</th></tr></thead><tbody>
    ${branches.map(b => `<tr data-action="focus-branch" data-id="${esc(b.name)}"><td class="bn">${esc(b.name)}${isStale(b) ? ' <span class="pill">stale</span>' : ''}</td><td class="ab">${b.ahead} / <span class="${b.behind > 40 ? 'behind-hi' : ''}">${b.behind}</span></td><td class="num" style="white-space:nowrap">${fmtAge(sim.now - b.last)}</td></tr>`).join('')}
    </tbody></table></div>
  </section>`;
}
function sparkline(vals) {
  const w = 64, h = 22, max = Math.max(3, ...vals);
  const pts = vals.map((v, i) => [i / (vals.length - 1) * w, h - 2 - v / max * (h - 5)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-label="Commits per hour, last 12 hours"><path d="${d}L${w},${h}L0,${h}Z" fill="var(--accent-soft)"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.4"/><circle cx="${last[0]}" cy="${last[1]}" r="2.2" fill="var(--accent)"/></svg>`;
}
function townPanel() {
  const moved = state.repos.filter(r => r.ci === 'newci');
  const deps = depAlerts();
  const repos = state.repos.slice().sort((a, b) => collisions(b).filter(c => !c.stale).length - collisions(a).filter(c => !c.stale).length || commitsSince(b, 120) - commitsSince(a, 120));
  return `
  <section>
    <div class="eyebrow">Engineering · all teams</div>
    <h2>All repositories</h2>
    <div class="repo-meta">${state.repos.length} repos · ${Object.keys(TEAMS).length} teams. Click a building or a row to open a repo.</div>
  </section>
  <section class="mig">
    <h3>Jenkins → new CI/CD</h3>
    <div class="m-top"><div class="m-big">${moved.length}<small> of ${state.repos.length} repos moved</small></div><span class="pill">target Dec 15</span></div>
    <div class="progress" role="img" aria-label="${moved.length} of ${state.repos.length} migrated"><i style="width:${moved.length / state.repos.length * 100}%"></i></div>
    <div class="m-row">${state.repos.map(r => `<span class="pill ${r.ci}">${esc(r.id)}</span>`).join('')}</div>
  </section>
  <section>
    <h3>Shared library versions</h3>
    ${deps.map(a => `<div class="dep"><div class="d-top"><span>${esc(a.consumer.id)}</span><span class="pill ${a.behind ? 'safety' : 'ok'}">${a.behind ? 'needs bump' : 'up to date'}</span></div><div class="d-sub"><span class="mono">${esc(a.lib.id)}</span> ${esc(a.have)}${a.behind ? ` → ${esc(a.want)}` : ''}${a.bumpBranch ? ` · bump in progress (${a.bumpBranch.pr ? '#' + a.bumpBranch.pr.n : 'no PR yet'})` : ''}</div></div>`).join('')}
  </section>
  <section style="padding-bottom:8px">
    <h3>Repositories <span class="h-aside">commits/hour, last 12h</span></h3>
    ${repos.map(r => {
      const cr = collisions(r).filter(c => !c.stale).length;
      const st = r.lastBuild ? r.lastBuild.status : 'passed';
      return `<button class="repo-row" data-action="enter-repo" data-id="${r.id}"><div class="rr-name">${esc(r.id)}</div><span class="dot ${st === 'running' ? 'run' : st === 'failed' ? 'crit' : 'ok'}" title="main build ${st}"></span>${sparkline(r.hourly)}
        <div class="rr-sub"><span class="pill ${r.ci}">${r.ci === 'jenkins' ? 'Jenkins' : 'New CI'}</span><span>${TEAMS[r.team].name}</span><span>${r.branches.filter(isActive).length} branches · ${openPrs(r).length} PRs · ${r.staged.length} staged</span>${cr ? `<span class="pill safety">${cr} conflict risk${cr > 1 ? 's' : ''}</span>` : ''}</div></button>`;
    }).join('')}
  </section>`;
}

/* ---------- live feed ---------- */
function feedItemHtml(it, fresh) {
  return `<li class="ev${fresh ? ' fresh' : ''}"><time>${fmtClock(it.t)}</time><span class="ic ${it.cls || ''}">${ICON[it.icon] || ''}</span><div class="e-body"><span class="e-repo">${esc(it.repo)}</span> <span class="e-text">${it.html}</span>${it.sha ? ` <button class="sha${state.selectedSha === it.sha ? ' sel' : ''}" data-action="trace" data-id="${it.sha}">${it.sha}</button>` : ''}</div></li>`;
}
function renderFeed() { $('#feed').innerHTML = state.feed.slice(0, 60).map(it => feedItemHtml(it, false)).join(''); }
function prependFeed(it) {
  const ol = $('#feed');
  ol.insertAdjacentHTML('afterbegin', feedItemHtml(it, true));
  while (ol.children.length > 60) ol.lastElementChild.remove();
}
function seedFeed() {
  const all = [];
  for (const r of state.repos) for (const sha of r.log) { const c = state.commits.get(sha); if (sim.now - c.t < 300 && c.kind !== 'merge' || (c.kind === 'merge' && sim.now - c.t < 300 && c.pr)) all.push(c); }
  all.sort((a, b) => b.t - a.t);
  state.feed = all.slice(0, 24).map(c => c.kind === 'merge'
    ? { id: c.sha, t: c.t, repo: c.repo, icon: 'merge', cls: 'ok', html: `${nm(c.author)} merged #${c.pr} ${esc(c.msg)} into ${code('main')}`, sha: c.sha }
    : { id: c.sha, t: c.t, repo: c.repo, icon: 'push', cls: 'accent', html: `${nm(c.author)} pushed to ${code(c.branch)}: ${esc(c.msg)}`, sha: c.sha });
}

/* ---------- follow a commit ---------- */
function traceSteps(c) {
  const repo = state.byId[c.repo];
  const m = c.kind === 'merge' ? c : (c.mergeSha ? state.commits.get(c.mergeSha) : null);
  const b = c.kind === 'push' ? repo.branches.find(x => x.name === c.branch) : null;
  const pr = b && b.pr;
  const S = [];
  S.push({ k: 'commit', l: 'Committed', s: `${esc(firstName(c.author))} · ${fmtWhen(c.t)}`, st: 'done' });
  if (m) {
    S.push({ k: 'pr', l: 'Pull request', s: `#${m.pr} opened`, st: 'done' });
    S.push({ k: 'review', l: 'Review', s: `${m.approvals || 2} approvals`, st: 'done' });
    S.push({ k: 'merge', l: 'Merged to main', s: `${fmtWhen(m.t)} · <span class="mono">${m.sha}</span>`, st: 'done' });
    const bd = m.build;
    if (!bd) S.push({ k: 'build', l: 'Build', s: 'queued', st: 'pending' });
    else S.push({ k: 'build', l: 'Build', s: `${esc(ciLabel(repo, bd.id))} ${bd.status === 'running' ? 'running' : bd.status === 'failed' ? 'failed, retrying' : `passed in ${Math.max(1, Math.round(bd.end - bd.start))}m`}`, st: bd.status === 'running' ? 'active' : bd.status === 'failed' ? 'failed' : 'done' });
    S.push({ k: 'image', l: 'Image', s: m.image ? `<span class="mono">sha-${m.sha}</span>` : 'after build', st: m.image ? 'done' : 'pending', mono: true });
    S.push({ k: 'staging', l: 'Staging', s: m.staging ? `deployed ${fmtWhen(m.staging)}` : m.image ? 'deploying' : 'after image', st: m.staging ? 'done' : m.image ? 'active' : 'pending' });
    S.push({ k: 'prod', l: 'Production', s: m.prod ? `v${esc(m.prodVersion)} · ${fmtWhen(m.prod)}` : m.staging ? 'waiting for the next release' : 'after staging', st: m.prod ? 'done' : m.staging ? 'blocked' : 'pending' });
  } else {
    if (!pr) S.push({ k: 'pr', l: 'Pull request', s: b ? 'not opened yet' : 'branch was deleted', st: b ? 'blocked' : 'pending' });
    else S.push({ k: 'pr', l: 'Pull request', s: `#${pr.n} ${pr.state === 'draft' ? 'draft' : 'open'}`, st: pr.state === 'draft' ? 'blocked' : 'done' });
    if (!pr || pr.state === 'draft') S.push({ k: 'review', l: 'Review', s: 'not requested', st: 'pending' });
    else if (pr.state === 'changes_requested') S.push({ k: 'review', l: 'Review', s: 'changes requested', st: 'blocked' });
    else if (pr.state === 'approved') S.push({ k: 'review', l: 'Review', s: `${approvals(pr)} of 2 approvals`, st: 'done' });
    else S.push({ k: 'review', l: 'Review', s: `${approvals(pr)} of 2 approvals · waiting ${fmtWait(sim.now - pr.requestedAt)}`, st: 'active' });
    const ready = pr && pr.state === 'approved' && pr.ci === 'passing';
    S.push({ k: 'merge', l: 'Merged to main', s: ready ? 'ready to merge' : pr && pr.ci === 'failing' ? 'blocked by failing CI' : 'not yet', st: ready ? 'active' : pr && pr.ci === 'failing' ? 'failed' : 'pending' });
    S.push({ k: 'build', l: 'Build', s: c.build ? `PR check ${esc(ciLabel(repo, c.build.id))} ${c.build.status}` : 'on merge', st: 'pending' });
    S.push({ k: 'image', l: 'Image', s: 'after main build', st: 'pending' });
    S.push({ k: 'staging', l: 'Staging', s: 'after image', st: 'pending' });
    S.push({ k: 'prod', l: 'Production', s: 'next release', st: 'pending' });
  }
  return S;
}
function renderTrace() {
  const el = $('#trace');
  const c = state.selectedSha && state.commits.get(state.selectedSha);
  if (!c) { el.innerHTML = '<div class="empty" style="padding:0 16px">Pick a commit id in the feed or the panel to see where it is on its way to production.</div>'; return; }
  const repo = state.byId[c.repo];
  const steps = traceSteps(c);
  const icon = { commit: 'commit', pr: 'pr', review: 'review', merge: 'merge', build: 'build', image: 'image', staging: 'staging', prod: 'prod' };
  const here = curRepo() && curRepo().id === repo.id;
  el.innerHTML = `<div class="trace-head"><div class="t-title"><div class="t-msg">${esc(c.msg)}</div>
    <div class="t-sub"><span class="mono">${c.sha}</span><span>·</span><b>${esc(repo.id)}</b><span>·</span><span class="mono">${esc(c.kind === 'merge' ? 'main' : c.branch)}</span><span>·</span><span>${c.files.length} file${c.files.length === 1 ? '' : 's'}</span></div></div>
    <button class="btn" data-action="show-in-yard">${here ? 'Highlight in yard' : `Open ${esc(repo.id)}`}</button></div>
    <div class="steps-scroll"><div class="steps">${steps.map(s => `<div class="step ${s.st}"><div class="s-dot">${s.st === 'failed' ? ICON.fail : s.st === 'blocked' ? ICON.wait : ICON[icon[s.k]]}</div><div class="s-l">${s.l}</div><div class="s-sub">${s.s}</div></div>`).join('')}</div></div>`;
}

/* ---------- toasts ---------- */
function toast(o) {
  const el = document.createElement('div');
  el.className = `toast ${o.cls || ''}`;
  el.innerHTML = `<b>${esc(o.title)}</b>${o.body}`;
  const box = $('#toasts');
  box.prepend(el);
  while (box.children.length > 3) box.lastElementChild.remove();
  setTimeout(() => el.remove(), 7000);
}
