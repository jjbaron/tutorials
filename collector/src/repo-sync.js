// Pulls everything the yard needs for one repository from GitHub.
import { normCommit } from './sources/github.js';
import { isSourceFile, districtOf, jvmRootDepth, parseCodeowners, ownersFor, ownerSlug, prNumberFromMessage, firstLine, releaseSortKey } from './model.js';

const DAY = 86400000;

export async function syncRepo({ gh, cfg, rc, full, prev, deployed, log = () => {} }) {
  const g = cfg.github;
  const meta = await gh.repo(full);
  if (!meta) throw new Error(`Repository ${full} not found or not accessible with this token`);
  const def = meta.default_branch;
  const branches = await gh.branches(full);
  const head = (branches.find(b => b.name === def) || {}).commit;
  if (!head) throw new Error(`${full}: default branch ${def} has no commits`);
  const defSha = head.sha;
  const relRe = new RegExp(g.releaseBranchPattern);
  const releases = branches.filter(b => relRe.test(b.name)).map(b => ({ name: b.name, sha: b.commit.sha, key: releaseSortKey(b.name, relRe) })).sort((a, b) => (a.key < b.key ? 1 : -1));
  const pulls = await gh.openPulls(full);
  const prByBranch = new Map(pulls.filter(p => p.head && p.head.repo && p.head.repo.full_name === full).map(p => [p.head.ref, p]));

  // ---- branches: compare each with the default branch ----
  const keepReleases = new Set(releases.slice(0, 2).map(r => r.name));
  let candidates = branches.filter(b => b.name !== def && (!relRe.test(b.name) || keepReleases.has(b.name)));
  candidates.sort((a, b) => (prByBranch.has(b.name) - prByBranch.has(a.name)) || (keepReleases.has(b.name) - keepReleases.has(a.name)));
  const skipped = Math.max(0, candidates.length - g.maxBranches);
  candidates = candidates.slice(0, g.maxBranches);
  const outBranches = [];
  for (const b of candidates) {
    const cmp = await gh.compare(full, def, b.name);
    if (!cmp) continue;
    const commits = (cmp.commits || []).map(normCommit);
    const last = commits[commits.length - 1] || null;
    let lastAt = last && last.at, author = last && last.author;
    if (!last && cmp.base_commit) { const bc = normCommit(cmp.base_commit); lastAt = bc.at; author = bc.author; }
    const files = (cmp.files || []).map(f => f.filename);
    const pr = prByBranch.get(b.name);
    const isRelease = relRe.test(b.name);
    outBranches.push({
      name: b.name, sha: b.commit.sha, kind: isRelease ? 'release' : 'branch',
      author: (pr && pr.user && pr.user.login) || author || 'unknown',
      ahead: cmp.ahead_by, behind: cmp.behind_by, lastCommitAt: lastAt,
      additions: (cmp.files || []).reduce((s, f) => s + (f.additions || 0), 0),
      deletions: (cmp.files || []).reduce((s, f) => s + (f.deletions || 0), 0),
      files: isRelease ? [] : files,
      commits: commits.slice(-15).map(c => ({ sha: c.sha, message: firstLine(c.message), author: c.author, at: c.at })),
      pr: pr ? await prInfo(gh, full, pr) : null
    });
  }

  // ---- files, districts, churn, owners (refreshed when main moves or every treeRefreshMinutes) ----
  let structure = prev && prev.structure;
  const stale = !structure || structure.defSha !== defSha || Date.now() - structure.at > g.treeRefreshMinutes * 60000;
  if (stale) structure = await syncStructure({ gh, cfg, full, defSha, def, prevStructure: structure });

  // ---- recent commits on the default branch ----
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const recent = ((await gh.commits(full, def, since, 50)) || []).map(normCommit);

  // ---- PR-less recent merges for the "staged" groups and the trace ----
  const release = await computeRelease({ gh, full, def, releases, deployed, relRe });

  // ---- GitHub Actions runs (for repos already migrated) ----
  let runs = [];
  if (rc.ci === 'actions' || rc.ci === 'auto' || !rc.ci) {
    const wr = await gh.workflowRuns(full, 30).catch(() => null);
    runs = ((wr && wr.workflow_runs) || []).map(r => ({
      id: `actions:${rc.name}#${r.run_number}`, system: 'actions', label: `${r.name} #${r.run_number}`, number: r.run_number, repo: rc.name,
      branch: r.head_branch, sha: r.head_sha,
      status: r.status !== 'completed' ? 'running' : ({ success: 'passed', failure: 'failed', cancelled: 'aborted', timed_out: 'failed', skipped: 'skipped' }[r.conclusion] || r.conclusion || 'unknown'),
      startedAt: Date.parse(r.run_started_at || r.created_at) || null, durationMs: r.updated_at && r.run_started_at ? Date.parse(r.updated_at) - Date.parse(r.run_started_at) : null, url: r.html_url
    }));
  }

  return {
    name: rc.name, full, defaultBranch: def, defSha, language: meta.language, archived: meta.archived,
    branches: outBranches, skippedBranches: skipped, releases: releases.map(r => r.name),
    structure, recent: recent.map(c => ({ ...c, message: firstLine(c.message), pr: prNumberFromMessage(c.message) })),
    release, runs, syncedAt: Date.now()
  };
}

async function prInfo(gh, full, pr) {
  const reviews = await gh.reviews(full, pr.number);
  const latest = new Map();
  for (const r of reviews || []) if (r.user && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) latest.set(r.user.login, r.state);
  const reviewers = [];
  for (const [login, st] of latest) reviewers.push({ login, state: st === 'APPROVED' ? 'approved' : st === 'CHANGES_REQUESTED' ? 'changes' : 'pending' });
  for (const u of pr.requested_reviewers || []) if (!latest.has(u.login)) reviewers.push({ login: u.login, state: 'pending' });
  for (const t of pr.requested_teams || []) reviewers.push({ login: `team:${t.slug}`, state: 'pending' });
  const ci = await gh.checkState(full, pr.head.sha).catch(() => 'none');
  const approvals = reviewers.filter(r => r.state === 'approved').length;
  let state;
  if (pr.draft) state = 'draft';
  else if (reviewers.some(r => r.state === 'changes')) state = 'changes_requested';
  else if (approvals > 0 && !reviewers.some(r => r.state === 'pending')) state = 'approved';
  else if (approvals > 0 || reviewers.some(r => r.state !== 'pending')) state = 'in_review';
  else state = 'review_requested';
  return { number: pr.number, title: pr.title, author: pr.user && pr.user.login, state, reviewers, ci, createdAt: pr.created_at, updatedAt: pr.updated_at, url: pr.html_url, headSha: pr.head.sha };
}

async function syncStructure({ gh, cfg, full, defSha, def, prevStructure }) {
  const g = cfg.github;
  const tree = await gh.tree(full, defSha);
  const blobs = ((tree && tree.tree) || []).filter(t => t.type === 'blob' && isSourceFile(t.path));
  const ctx = { jvmRootDepth: jvmRootDepth(blobs.map(b => b.path)) };
  // churn over the last churnDays days on the default branch (commit details are cached forever)
  const since = new Date(Date.now() - g.churnDays * DAY).toISOString();
  const list = (await gh.commits(full, def, since, 100)) || [];
  const churn = {};
  for (const c of list.slice(0, g.maxChurnCommits)) {
    const d = await gh.commit(full, c.sha);
    for (const f of (d && d.files) || []) churn[f.path] = (churn[f.path] || 0) + 1;
  }
  const ownersText = await gh.codeowners(full);
  const rules = parseCodeowners(ownersText);
  const files = blobs.map(b => {
    const owners = rules.length ? ownersFor(rules, b.path) : null;
    return { path: b.path, district: districtOf(b.path, ctx), size: b.size || 0, loc: Math.max(1, Math.round((b.size || 0) / 32)), churn: churn[b.path] || 0, owner: owners && owners.length ? ownerSlug(owners[0]) : null };
  });
  return { defSha, at: Date.now(), files, totalSourceFiles: blobs.length, truncated: !!(tree && tree.truncated), hasCodeowners: !!rules.length, commitsScanned: Math.min(list.length, g.maxChurnCommits) };
}

// Three release stages, computed from git history:
//  waitingForCut        on the default branch, not yet on the newest release branch
//  inReleaseNotDeployed on the newest release branch, newer than what production runs
//  notBackMerged        on the release branch but never brought back to the default branch
export async function computeRelease({ gh, full, def, releases, deployed, relRe }) {
  const latest = releases[0] || null;
  const prod = deployed && deployed.production;
  const out = { latestRelease: latest ? latest.name : null, prodRelease: prod ? prod.releaseBranch : null, prodSha: prod ? prod.sha : null, prodCommitSource: prod ? prod.commitSource : null,
    preprod: (deployed && deployed.preprod) || [], waitingForCut: [], inReleaseNotDeployed: [], notBackMerged: [], notes: [] };
  const pack = cs => cs.map(normCommit).map(c => ({ sha: c.sha, message: firstLine(c.message), body: c.message, author: c.author, at: c.at, pr: prNumberFromMessage(c.message) }));
  if (latest) {
    const ahead = await gh.compare(full, latest.name, def);
    out.waitingForCut = ahead ? pack(ahead.commits || []) : [];
    if (out.prodSha) {
      const notDeployed = await gh.compare(full, out.prodSha, latest.name);
      if (notDeployed) out.inReleaseNotDeployed = pack(notDeployed.commits || []);
      else out.notes.push(`Production commit ${out.prodSha.slice(0, 12)} was not found in the repository`);
    } else out.notes.push('Production commit unknown: see the commit resolution section of HANDOFF.md');
    const relOnly = await gh.compare(full, def, latest.name);
    const relCommits = relOnly ? pack(relOnly.commits || []) : [];
    // a cherry-pick gets a new sha, so treat a release commit as merged back when the default branch has
    // a commit with the same subject, the same PR number, or a "cherry picked from" trailer naming it
    const mainSubjects = new Set(out.waitingForCut.map(c => c.message));
    const mainPrs = new Set(out.waitingForCut.map(c => c.pr).filter(Boolean));
    const picked = new Set(out.waitingForCut.flatMap(c => [...(c.body || '').matchAll(/cherry picked from commit ([0-9a-f]{7,40})/g)].map(m => m[1])));
    // (a release commit that is itself a cherry-pick came from the default branch already)
    out.notBackMerged = relCommits.filter(c => !/^Merge /.test(c.message) && !/cherry picked from commit/.test(c.body || '') && !mainSubjects.has(c.message) && !(c.pr && mainPrs.has(c.pr)) && ![...picked].some(p => c.sha.startsWith(p)));
  } else if (out.prodSha) {
    const ahead = await gh.compare(full, out.prodSha, def);
    out.waitingForCut = ahead ? pack(ahead.commits || []) : [];
    out.notes.push('No release branch found, so "staged" = default branch commits newer than production');
  } else out.notes.push('No release branch and no production commit, so nothing staged can be computed');
  // which default-branch commits each pre-production environment does not have yet
  out.notOnEnv = {};
  for (const p of out.preprod) {
    if (!p.sha || p.releaseBranch) continue;
    const c = await gh.compare(full, p.sha, def);
    if (c) out.notOnEnv[p.env] = (c.commits || []).map(x => x.sha);
  }
  for (const k of ['waitingForCut', 'inReleaseNotDeployed', 'notBackMerged']) out[k] = out[k].map(({ body, ...c }) => c);
  return out;
}
