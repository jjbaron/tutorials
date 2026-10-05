// GitHub REST client: read-only, ETag-cached (304s do not count against the rate limit).
export class HttpError extends Error {
  constructor(status, url, body) { super(`HTTP ${status} for ${url}${body ? ': ' + String(body).slice(0, 200) : ''}`); this.status = status; this.url = url; }
}

export function createGitHub({ apiUrl = 'https://api.github.com', token, fetchImpl = globalThis.fetch, log = () => {} }) {
  const base = apiUrl.replace(/\/$/, '');
  const etags = new Map();        // url -> { etag, body }
  const forever = new Map();      // immutable responses (commit details)
  const stats = { calls: 0, notModified: 0, remaining: null, limit: null, reset: null, lastError: null };

  async function req(path, { raw = false, conditional = true } = {}) {
    const url = path.startsWith('http') ? path : base + path;
    const headers = {
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'repo-yard-collector'
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const hit = conditional ? etags.get(url) : null;
    if (hit) headers['If-None-Match'] = hit.etag;
    const res = await fetchImpl(url, { headers });
    stats.calls++;
    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem != null) { stats.remaining = +rem; stats.limit = +res.headers.get('x-ratelimit-limit'); stats.reset = +res.headers.get('x-ratelimit-reset') * 1000; }
    if (res.status === 304 && hit) { stats.notModified++; return hit.body; }
    if (res.status === 404 || res.status === 409) return null;   // 409 = empty repository
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new HttpError(res.status, url, text);
      stats.lastError = err.message;
      throw err;
    }
    const body = raw ? await res.text() : await res.json();
    const etag = res.headers.get('etag');
    if (etag && conditional) etags.set(url, { etag, body });
    return body;
  }
  async function paged(path, maxPages = 3) {
    const out = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; page <= maxPages; page++) {
      const batch = await req(`${path}${sep}per_page=100&page=${page}`);
      if (!batch || !batch.length) break;
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }
  const enc = s => encodeURIComponent(s);
  const repoPath = full => `/repos/${full.split('/').map(enc).join('/')}`;

  return {
    stats,
    req,
    user: () => req('/user', { conditional: false }),
    rateLimit: () => req('/rate_limit', { conditional: false }),
    repo: full => req(repoPath(full)),
    branches: full => paged(`${repoPath(full)}/branches`, 5),
    openPulls: full => paged(`${repoPath(full)}/pulls?state=open&sort=updated&direction=desc`, 2),
    reviews: (full, n) => paged(`${repoPath(full)}/pulls/${n}/reviews`, 1),
    // commits reachable from head but not from base, plus ahead/behind counts and changed files
    compare: (full, base, head) => req(`${repoPath(full)}/compare/${enc(base)}...${enc(head)}`),
    commits: (full, sha, sinceIso, perPage = 100) => req(`${repoPath(full)}/commits?sha=${enc(sha)}&since=${enc(sinceIso)}&per_page=${perPage}`),
    async commit(full, sha) {
      const key = `${full}@${sha}`;
      if (forever.has(key)) return forever.get(key);
      const c = await req(`${repoPath(full)}/commits/${enc(sha)}`, { conditional: false });
      if (c) forever.set(key, { sha: c.sha, files: (c.files || []).map(f => ({ path: f.filename, additions: f.additions, deletions: f.deletions })) });
      return forever.get(key) || null;
    },
    tree: (full, sha) => req(`${repoPath(full)}/git/trees/${enc(sha)}?recursive=1`),
    async codeowners(full) {
      for (const p of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
        const t = await req(`${repoPath(full)}/contents/${p}`, { raw: true });
        if (t) return t;
      }
      return null;
    },
    async checkState(full, sha) {
      const [runs, status] = await Promise.all([
        req(`${repoPath(full)}/commits/${enc(sha)}/check-runs?per_page=100`),
        req(`${repoPath(full)}/commits/${enc(sha)}/status`)
      ]);
      const cr = (runs && runs.check_runs) || [];
      const st = (status && status.statuses) || [];
      if (cr.some(r => r.status !== 'completed') || st.some(s => s.state === 'pending')) return 'running';
      if (cr.some(r => ['failure', 'timed_out', 'action_required'].includes(r.conclusion)) || st.some(s => s.state === 'failure' || s.state === 'error')) return 'failing';
      if (cr.length || st.length) return 'passing';
      return 'none';
    },
    workflowRuns: (full, perPage = 30) => req(`${repoPath(full)}/actions/runs?per_page=${perPage}`)
  };
}

// Normalizes a commit object from the commits/compare APIs.
export function normCommit(c) {
  return {
    sha: c.sha,
    message: (c.commit && c.commit.message) || '',
    author: (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || 'unknown',
    authorName: (c.commit && c.commit.author && c.commit.author.name) || null,
    at: (c.commit && ((c.commit.committer && c.commit.committer.date) || (c.commit.author && c.commit.author.date))) || null
  };
}
