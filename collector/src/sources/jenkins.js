// Jenkins REST client (read-only): branch jobs, builds with their git revision, and console search
// to map image build ids (UUID tags) back to the build and commit that produced them.
import { HttpError } from './github.js';

const BUILD_TREE = 'builds[number,url,result,building,timestamp,duration,displayName,description,actions[lastBuiltRevision[SHA1,branch[name]]]]';

export function createJenkins({ url, user, token, fetchImpl = globalThis.fetch }) {
  const base = url.replace(/\/$/, '') + '/';
  const auth = user && token ? 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64') : null;
  const stats = { calls: 0, lastError: null };

  async function get(u, { text = false } = {}) {
    const full = u.startsWith('http') ? u : base + u.replace(/^\//, '');
    const headers = { 'User-Agent': 'repo-yard-collector' };
    if (auth) headers.Authorization = auth;
    const res = await fetchImpl(full, { headers });
    stats.calls++;
    if (res.status === 404) return null;
    if (!res.ok) { const e = new HttpError(res.status, full, await res.text().catch(() => '')); stats.lastError = e.message; throw e; }
    return text ? res.text() : res.json();
  }
  // "payments-api" or "folder/payments-api" -> "job/payments-api/" or "job/folder/job/payments-api/"
  const jobPath = name => name.split('/').map(s => 'job/' + encodeURIComponent(s)).join('/') + '/';

  return {
    stats,
    whoAmI: () => get('me/api/json?tree=id,fullName'),
    root: () => get('api/json?tree=mode,nodeDescription,useSecurity'),
    // Multibranch jobs return one child per branch; a plain pipeline job returns itself.
    async branchJobs(jobName, n = 20) {
      const j = await get(`${jobPath(jobName)}api/json?tree=name,url,jobs[name,url,color],${BUILD_TREE}{0,${n}}`);
      if (!j) return null;
      if (j.jobs && j.jobs.length) {
        const out = [];
        for (const child of j.jobs) {
          const cj = await get(`${child.url}api/json?tree=name,url,${BUILD_TREE}{0,${n}}`);
          if (cj) out.push({ branch: decodeURIComponent(child.name), url: child.url, builds: cj.builds || [] });
        }
        return out;
      }
      return [{ branch: null, url: j.url, builds: j.builds || [] }];
    },
    consoleText: buildUrl => get(`${buildUrl.replace(/\/?$/, '/')}consoleText`, { text: true })
  };
}

export function normBuild(b, repo, branchFromJob) {
  const rev = (b.actions || []).find(a => a && a.lastBuiltRevision);
  const sha = rev ? rev.lastBuiltRevision.SHA1 : null;
  let branch = branchFromJob;
  if (!branch && rev && rev.lastBuiltRevision.branch && rev.lastBuiltRevision.branch[0]) branch = rev.lastBuiltRevision.branch[0].name.replace(/^(refs\/remotes\/)?origin\//, '');
  const status = b.building ? 'running' : ({ SUCCESS: 'passed', FAILURE: 'failed', ABORTED: 'aborted', UNSTABLE: 'unstable', NOT_BUILT: 'skipped' }[b.result] || 'unknown');
  return { id: `jenkins:${repo}#${b.number}`, system: 'jenkins', label: `Jenkins #${b.number}`, number: b.number, repo, branch, sha, status,
    startedAt: b.timestamp || null, durationMs: b.duration || null, url: b.url, text: `${b.displayName || ''} ${b.description || ''}` };
}
