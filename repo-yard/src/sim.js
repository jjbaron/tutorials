/* ================================================================
   Simulation: a plausible stream of development events
   ================================================================ */
let emit = () => {};   // wired up in boot
function weightedPick(arr, wfn) { const ws = arr.map(wfn); let x = Math.random() * sum(ws); for (let i = 0; i < arr.length; i++) { x -= ws[i]; if (x <= 0) return arr[i]; } return arr[arr.length - 1]; }
function genMsg(repo, files) {
  if (Math.random() < .5 && repo.def.msgs.length) return pick(repo.def.msgs);
  return pick(GENERIC_MSGS).replace('{stem}', files[0] ? fileStem(files[0]) : 'module');
}
function titleFromBranch(name) {
  const slug = name.split('/').pop().replace(/^[A-Z]+-\d+-/, '').replace(/-/g, ' ');
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
function pickReviewers(repo, author) {
  let pool = repo.people.filter(p => p !== author);
  if (pool.length < 2) pool = pool.concat(Object.keys(PEOPLE).filter(p => p !== author && !pool.includes(p)));
  return shuffle(pool).slice(0, 2).map(p => ({ p, s: 'pending' }));
}
function addFeed(o) {
  const item = Object.assign({ id: Math.random().toString(36).slice(2), t: sim.now }, o, { repo: o.repo.id });
  state.feed.unshift(item);
  if (state.feed.length > 80) state.feed.pop();
  emit('feed', o.repo, item);
}
const nm = id => `<b>${esc(firstName(id))}</b>`;
const code = s => `<code>${esc(s)}</code>`;

function checkNewConflicts(repo) {
  for (const c of collisions(repo)) {
    if (c.stale || repo.seenConflicts.has(c.key)) continue;
    repo.seenConflicts.add(c.key);
    const f = fileName(c.files[0]);
    addFeed({ repo, icon: 'conflict', cls: 'safety', html: `New conflict risk: ${code(c.a.name)} and ${code(c.b.name)} both change ${code(f)}${c.files.length > 1 ? ` and ${c.files.length - 1} more` : ''}` });
    emit('toast', repo, { cls: 'safety', title: `Conflict risk in ${repo.id}`, body: `<span class="mono">${esc(c.a.name)}</span> and <span class="mono">${esc(c.b.name)}</span> both change <span class="mono">${esc(f)}</span>.` });
  }
}

function startPrBuild(repo, b, c) {
  const id = repo.nextBuild++;
  b.pr.ci = 'running';
  if (c) c.build = { id, status: 'running', start: sim.now };
  emit('pr', repo, { branch: b });
  after(rnd(3, 7), () => {
    const pass = Math.random() < .86;
    if (c) { c.build.status = pass ? 'passed' : 'failed'; c.build.end = sim.now; }
    if (!repo.branches.includes(b) || !b.pr) return;
    b.pr.ci = pass ? 'passing' : 'failing';
    if (pass && b.pr.state === 'in_review' && approvals(b.pr) >= 2) b.pr.state = 'approved';
    if (!pass) {
      addFeed({ repo, icon: 'fail', cls: 'crit', html: `${ciLabel(repo, id)} failed on ${code(b.name)} (PR #${b.pr.n})`, sha: c && c.sha });
      // the author fixes it a bit later
      after(rnd(4, 10), () => { if (repo.branches.includes(b) && b.pr && b.pr.ci === 'failing') doPush(repo, b, 'Fix failing test'); });
    }
    emit('pr', repo, { branch: b });
  });
}

function doPush(repo, forced, forcedMsg) {
  const cands = repo.branches.filter(isActive);
  if (!cands.length) return false;
  const b = forced || weightedPick(cands, x => 1 / (1 + (sim.now - x.last) / 90) + (x.pr && x.pr.state === 'changes_requested' ? 1.2 : 0));
  let files = b.files.length ? shuffle(b.files).slice(0, rint(1, Math.min(3, b.files.length))) : [];
  if (Math.random() < .28 || !files.length) {
    const dPath = b.files.length ? repo.fileById[pick(b.files)].district : pick(repo.districts).path;
    const nf = pick(repo.districts.find(d => d.path === dPath).files);
    if (!b.files.includes(nf)) b.files.push(nf);
    if (!files.includes(nf)) files.push(nf);
  }
  b.ahead++; b.last = sim.now; b.add += rint(4, 70); b.del += rint(0, 25);
  let extra = '';
  let msg = forcedMsg || genMsg(repo, files);
  if (b.pr && b.pr.state === 'changes_requested') {
    msg = 'Address review comments';
    b.pr.state = 'in_review'; b.pr.requestedAt = sim.now;
    b.pr.reviewers.forEach(r => { if (r.s === 'changes') r.s = 'pending'; });
    extra = ' and re-requested review';
  }
  const c = mkCommit({ repo: repo.id, branch: b.name, msg, author: b.author, files, pr: b.pr ? b.pr.n : null });
  for (const f of files) repo.fileById[f].heat += 1;
  addFeed({ repo, icon: 'push', cls: 'accent', html: `${nm(b.author)} pushed to ${code(b.name)}${extra}: ${esc(msg)}`, sha: c.sha });
  if (b.pr && b.pr.state !== 'draft') startPrBuild(repo, b, c);
  emit('push', repo, { branch: b, files, commit: c });
  checkNewConflicts(repo);
  return true;
}

function doReview(repo) {
  const prs = waitingPrs(repo).filter(p => p.reviewers.some(r => r.s === 'pending'));
  if (!prs.length) return false;
  const pr = weightedPick(prs, p => 1 + (sim.now - p.requestedAt) / 240);
  const r = pick(pr.reviewers.filter(x => x.s === 'pending'));
  const b = repo.branches.find(x => x.pr === pr);
  if (Math.random() < .78) {
    r.s = 'approved';
    pr.state = approvals(pr) >= 2 && pr.ci === 'passing' ? 'approved' : 'in_review';
    addFeed({ repo, icon: 'approve', cls: 'ok', html: `${nm(r.p)} approved #${pr.n} ${esc(pr.title)}${pr.state === 'approved' ? ' · ready to merge' : ''}` });
  } else {
    r.s = 'changes'; pr.state = 'changes_requested';
    addFeed({ repo, icon: 'changes', cls: 'warn', html: `${nm(r.p)} requested changes on #${pr.n} ${esc(pr.title)}` });
  }
  emit('pr', repo, { branch: b });
  return true;
}

function doOpenPr(repo) {
  const b = repo.branches.find(x => isActive(x) && !x.pr && x.ahead >= 2 && !x.name.startsWith('spike/'));
  if (!b) return false;
  const draft = Math.random() < .3;
  b.pr = { n: repo.nextPr++, title: titleFromBranch(b.name), state: draft ? 'draft' : 'review_requested', author: b.author,
    reviewers: draft ? [] : pickReviewers(repo, b.author), requestedAt: sim.now, openedAt: sim.now, ci: 'passing', branch: b.name };
  addFeed({ repo, icon: 'pr', cls: 'accent', html: `${nm(b.author)} opened ${draft ? 'draft ' : ''}PR #${b.pr.n} ${esc(b.pr.title)} from ${code(b.name)}` });
  if (!draft) { const last = [...repo.log].reverse().map(s => state.commits.get(s)).find(c => c.branch === b.name); startPrBuild(repo, b, last); }
  emit('pr', repo, { branch: b });
  return true;
}

function doReady(repo) {
  const b = repo.branches.find(x => x.pr && x.pr.state === 'draft');
  if (!b) return false;
  b.pr.state = 'review_requested'; b.pr.requestedAt = sim.now; b.pr.reviewers = pickReviewers(repo, b.author);
  addFeed({ repo, icon: 'pr', cls: 'accent', html: `PR #${b.pr.n} is ready for review · ${b.pr.reviewers.map(r => nm(r.p)).join(' and ')} requested` });
  emit('pr', repo, { branch: b });
  return true;
}

function doMerge(repo) {
  const b = repo.branches.find(x => x.pr && x.pr.state === 'approved' && x.pr.ci === 'passing');
  if (!b) return false;
  const pr = b.pr, files = b.files.slice();
  const c = mkCommit({ repo: repo.id, branch: 'main', msg: pr.title, author: b.author, files, kind: 'merge', pr: pr.n, approvals: approvals(pr), mergedFrom: b.name });
  for (const sha of repo.log) { const x = state.commits.get(sha); if (x.branch === b.name && x.kind === 'push' && !x.mergeSha) x.mergeSha = c.sha; }
  repo.branches.splice(repo.branches.indexOf(b), 1);
  for (const o of repo.branches) o.behind += 1;
  for (const f of files) { const ff = repo.fileById[f]; ff.churn += 1; ff.heat += .6; }
  if (b.bump) repo.deps[b.bump[0]] = b.bump[1];
  repo.staged.push(c.sha);
  addFeed({ repo, icon: 'merge', cls: 'ok', html: `${nm(b.author)} merged #${pr.n} ${esc(pr.title)} into ${code('main')}`, sha: c.sha });
  emit('merge', repo, { branch: b, files, commit: c });
  startMainBuild(repo, c);
  return true;
}

function startMainBuild(repo, c) {
  const id = repo.nextBuild++;
  c.build = { id, status: 'running', start: sim.now };
  repo.lastBuild = { id, status: 'running', sha: c.sha, at: sim.now };
  emit('build', repo, { commit: c });
  after(rnd(4, 9), () => {
    const pass = Math.random() < .92;
    c.build.status = pass ? 'passed' : 'failed'; c.build.end = sim.now;
    repo.lastBuild = { id, status: c.build.status, sha: c.sha, at: sim.now };
    if (pass) {
      c.image = `${repo.id}:sha-${c.sha}`;
      addFeed({ repo, icon: 'build', cls: 'ok', html: `${ciLabel(repo, id)} passed on ${code('main')} · image ${code('sha-' + c.sha)} published`, sha: c.sha });
      after(rnd(1, 2.5), () => {
        c.staging = sim.now;
        addFeed({ repo, icon: 'deploy', cls: 'accent', html: `Deployed ${code('sha-' + c.sha)} to staging`, sha: c.sha });
        emit('deploy', repo, { commit: c });
      });
    } else {
      addFeed({ repo, icon: 'fail', cls: 'crit', html: `${ciLabel(repo, id)} failed on ${code('main')} · retrying`, sha: c.sha });
      emit('toast', repo, { cls: 'crit', title: `main is red in ${repo.id}`, body: `${esc(ciLabel(repo, id))} failed after merging #${c.pr}. Retrying the build.` });
      after(rnd(2, 4), () => startMainBuild(repo, c));
    }
    emit('build', repo, { commit: c });
  });
}

function doRelease(repo, manual) {
  const ready = repo.staged.map(s => state.commits.get(s)).filter(c => c.staging);
  if (!ready.length) return false;
  if (!manual && (ready.length < 3 || Math.random() < .5)) return false;
  const minor = ready.some(c => /^(Add|Partial|Passkey|Apple|Split|Batch|Combobox|Open|Route|Expose|Track|Lazy|Propagate)/.test(c.msg));
  const v = bumpVersion(repo.version, minor ? 'minor' : 'patch');
  repo.version = v;
  for (const c of ready) { c.prod = sim.now; c.prodVersion = v; }
  repo.staged = repo.staged.filter(s => !ready.includes(state.commits.get(s)));
  repo.lastRelease = sim.now;
  addFeed({ repo, icon: 'release', cls: 'ok', html: `Released ${code(repo.id + ' ' + v)} to production · ${ready.length} change${ready.length > 1 ? 's' : ''}` });
  emit('toast', repo, { cls: 'ok', title: `${repo.id} ${v} is live`, body: `${ready.length} merged change${ready.length > 1 ? 's' : ''} shipped to production.` });
  emit('release', repo, { count: ready.length, version: v });
  return true;
}

function doNewBranch(repo) {
  if (repo.branches.length >= 9) return false;
  const [type, slug, dPath] = pick(repo.def.topics);
  if (repo.branches.some(b => b.name.endsWith(slug))) return false;
  repo.ticket += rint(1, 5);
  const name = `${type}/${repo.prefix}-${repo.ticket}-${slug}`;
  const d = repo.districts.find(x => x.path === dPath) || pick(repo.districts);
  const files = shuffle(d.files).slice(0, rint(1, Math.min(3, d.files.length)));
  const testD = repo.districts.find(x => /test|e2e|spec/.test(x.path));
  if (testD && Math.random() < .5) files.push(pick(testD.files));
  const author = pick(repo.people);
  const b = { name, author, ahead: 1, behind: 0, last: sim.now, add: rint(10, 90), del: rint(0, 20), files: [...new Set(files)], kind: 'branch', bump: null, pr: null, created: sim.now };
  repo.branches.push(b);
  const c = mkCommit({ repo: repo.id, branch: name, msg: genMsg(repo, b.files), author, files: b.files });
  for (const f of b.files) repo.fileById[f].heat += 1;
  addFeed({ repo, icon: 'branch', cls: 'accent', html: `${nm(author)} started ${code(name)}`, sha: c.sha });
  emit('branches', repo, { branch: b, created: true });
  checkNewConflicts(repo);
  return true;
}

function doSyncMain(repo) {
  const b = repo.branches.find(x => isActive(x) && x.behind >= 4 && Math.random() < .6);
  if (!b) return false;
  const was = b.behind;
  b.behind = 0; b.ahead += 1; b.last = sim.now;
  const c = mkCommit({ repo: repo.id, branch: b.name, msg: `Merge main into ${b.name}`, author: b.author, files: [], pr: b.pr ? b.pr.n : null });
  addFeed({ repo, icon: 'sync', cls: '', html: `${nm(b.author)} brought ${code(b.name)} up to date with main (was ${was} behind)`, sha: c.sha });
  emit('branches', repo, { branch: b });
  return true;
}

function doDeleteStale(repo) {
  const b = repo.branches.find(isStale);
  if (!b || Math.random() < .5) return false;
  repo.branches.splice(repo.branches.indexOf(b), 1);
  addFeed({ repo, icon: 'trash', cls: '', html: `${nm(b.author)} deleted stale branch ${code(b.name)} (idle ${fmtAge(sim.now - b.last)})` });
  emit('branches', repo, { removed: b });
  return true;
}

function doDepBump(repo) {
  for (const [lib, have] of Object.entries(repo.deps)) {
    const L = state.byId[lib];
    if (cmpVer(have, L.version) >= 0 || repo.branches.some(b => b.bump && b.bump[0] === lib)) continue;
    const buildFile = repo.files.find(f => /pom\.xml|package\.json|build\.gradle/.test(f.name)) || repo.files[0];
    const author = pick(repo.people);
    const name = `chore/bump-${lib}-${L.version}`;
    const b = { name, author, ahead: 1, behind: 0, last: sim.now, add: 2, del: 2, files: [buildFile.id], kind: 'branch', bump: [lib, L.version], pr: null, created: sim.now };
    repo.branches.push(b);
    const c = mkCommit({ repo: repo.id, branch: name, msg: `Bump ${lib} to ${L.version}`, author, files: b.files });
    b.pr = { n: repo.nextPr++, title: `Bump ${lib} to ${L.version}`, state: 'review_requested', author, reviewers: pickReviewers(repo, author), requestedAt: sim.now, openedAt: sim.now, ci: 'running', branch: name };
    addFeed({ repo, icon: 'pr', cls: 'accent', html: `${nm(author)} opened #${b.pr.n} to bump ${code(lib)} ${esc(have)} → ${esc(L.version)}`, sha: c.sha });
    startPrBuild(repo, b, c);
    emit('branches', repo, { branch: b, created: true });
    return true;
  }
  return false;
}

function chooseRepo() {
  if (state.view.mode === 'repo' && Math.random() < .55) return state.byId[state.view.repoId];
  return weightedPick(state.repos, r => r.people.length + r.branches.length * .5);
}
function fireEvent() {
  const repo = chooseRepo();
  const pool = [
    [40, () => doPush(repo)], [15, () => doReview(repo)], [10, () => doMerge(repo)], [8, () => doOpenPr(repo)],
    [4, () => doReady(repo)], [5, () => doNewBranch(repo)], [4, () => doSyncMain(repo)], [4, () => doRelease(repo, false)],
    [2, () => doDeleteStale(repo)], [3, () => doDepBump(repo)]
  ];
  while (pool.length) {
    let x = Math.random() * sum(pool.map(p => p[0])), i = 0;
    for (; i < pool.length - 1; i++) { x -= pool[i][0]; if (x <= 0) break; }
    if (pool[i][1]()) return;
    pool.splice(i, 1);
  }
}

function simTick(dtMin) {
  sim.now += dtMin;
  const hour = Math.floor(sim.now / 60);
  if (sim.lastHour == null) sim.lastHour = hour;
  if (hour !== sim.lastHour) { sim.lastHour = hour; for (const r of state.repos) { r.hourly.push(0); r.hourly.shift(); } }
  const k = Math.exp(-dtMin / 90);
  for (const r of state.repos) for (const f of r.files) f.heat *= k;
  for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= sim.now) { const t = timers.splice(i, 1)[0]; t.fn(); }
  if (sim.now >= sim.nextEventAt) { fireEvent(); sim.nextEventAt = sim.now + rnd(1.3, 3); }
}
