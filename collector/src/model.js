// Pure helpers: image/tag parsing, release branch naming, CODEOWNERS matching,
// grouping files into "districts", and PR numbers from commit messages.

export function parseImage(image) {
  let rest = image, digest = null;
  const at = rest.indexOf('@');
  if (at >= 0) { digest = rest.slice(at + 1); rest = rest.slice(0, at); }
  const slash = rest.lastIndexOf('/'), colon = rest.lastIndexOf(':');
  let tag = null;
  if (colon > slash) { tag = rest.slice(colon + 1); rest = rest.slice(0, colon); }
  const parts = rest.split('/');
  const registry = parts.length > 1 && /[.:]|^localhost$/.test(parts[0]) ? parts.shift() : null;
  return { registry, repository: parts.join('/'), name: parts[parts.length - 1], tag, digest };
}

export function compileTagPatterns(patterns) { return patterns.map(p => new RegExp(p)); }

// -> { sha, uuid, release, releaseBranch } (fields null when absent), or null when no pattern matches
export function parseTag(tag, regexes, releaseBranchTemplate) {
  if (!tag) return null;
  for (const re of regexes) {
    const m = re.exec(tag);
    if (!m) continue;
    const g = m.groups || {};
    const release = g.release || null;
    return { sha: g.sha || null, uuid: g.uuid || null, release, releaseBranch: release ? releaseToBranch(release, releaseBranchTemplate) : null };
  }
  return null;
}

export function releaseToBranch(release, template) {
  const [yy, mm, dd] = release.split(/[-.]/);
  return template.replace('{yy}', yy).replace('{mm}', mm).replace('{dd}', dd).replace('{release}', release);
}

// Sort key for release branch names using the named groups yy/mm/dd (or all digits as fallback)
export function releaseSortKey(name, re) {
  const m = re.exec(name);
  if (!m) return null;
  const g = m.groups || {};
  if (g.yy && g.mm && g.dd) return `${g.yy}${g.mm}${g.dd}`;
  return (name.match(/\d+/g) || []).map(n => n.padStart(4, '0')).join('');
}

export function prNumberFromMessage(msg) {
  if (!msg) return null;
  const first = msg.split('\n')[0];
  let m = /^Merge pull request #(\d+)/.exec(first);
  if (m) return +m[1];
  m = /\(#(\d+)\)\s*$/.exec(first);
  return m ? +m[1] : null;
}
export const firstLine = msg => (msg || '').split('\n')[0];

/* ---------- CODEOWNERS ---------- */
// Supports the common subset: *, **, ?, leading /, trailing /, plain names matching anywhere.
export function parseCodeowners(text) {
  const rules = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    rules.push({ pattern, owners, re: codeownersRegex(pattern) });
  }
  return rules;
}
function codeownersRegex(p) {
  let anchored = p.startsWith('/');
  let s = p.replace(/^\//, '');
  const dirOnly = s.endsWith('/');
  if (dirOnly) s = s.slice(0, -1);
  if (s.includes('/')) anchored = true;
  let re = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '*' && s[i + 1] === '*') { re += '.*'; i++; if (s[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const prefix = anchored ? '^' : '^(?:.*/)?';
  return new RegExp(prefix + re + (dirOnly ? '/.*$' : '(?:/.*)?$'));
}
export function ownersFor(rules, file) {
  let owners = null;
  for (const r of rules) if (r.re.test(file)) owners = r.owners;
  return owners;
}
// "@org/payments-team" -> "payments-team"; "@user" -> "user"
export const ownerSlug = o => o.replace(/^@/, '').split('/').pop();

/* ---------- districts ---------- */
const SOURCE_RE = /\.(java|kt|kts|scala|groovy|go|py|rb|js|jsx|ts|tsx|mjs|cs|fs|php|rs|swift|m|mm|c|cc|cpp|h|hpp|sql|yaml|yml|json|xml|gradle|tf|sh|vue|svelte|css|scss|html|proto|tpl)$|(^|\/)(Dockerfile|Jenkinsfile|Makefile|pom\.xml)$/;
const SKIP_RE = /(^|\/)(node_modules|vendor|dist|build|target|out|\.git|\.idea|\.vscode|coverage|__pycache__|\.gradle|generated)(\/|$)|\.(min\.js|lock|map)$|package-lock\.json$|yarn\.lock$/;
export const isSourceFile = p => SOURCE_RE.test(p) && !SKIP_RE.test(p);

// Groups a file path into a short "district" (folder) name, collapsing Java/Kotlin package roots.
export function districtOf(file, ctx) {
  const parts = file.split('/');
  const jvm = /^(.*?\/)?src\/(main|test|it|integrationTest)\/(java|kotlin|scala|groovy|resources)\//.exec(file);
  if (jvm) {
    const kind = jvm[2], lang = jvm[3];
    if (kind !== 'main') return 'test';
    if (lang === 'resources') return 'resources';
    const rel = file.slice(jvm[0].length).split('/');
    const rootDepth = ctx && ctx.jvmRootDepth != null ? ctx.jvmRootDepth : 3;
    const pkg = rel.slice(rootDepth, -1);
    return pkg.length ? pkg[0] : 'root';
  }
  if (parts.length === 1) return 'root';
  if (['src', 'lib', 'app', 'internal', 'pkg', 'cmd', 'charts', 'packages'].includes(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}
// For JVM repos, find how many package segments are shared by every main source file (e.g. com/acme/payments = 3)
export function jvmRootDepth(files) {
  const pkgs = [];
  for (const f of files) {
    const m = /^(?:.*?\/)?src\/main\/(?:java|kotlin|scala|groovy)\/(.*)\/[^/]+$/.exec(f);
    if (m) pkgs.push(m[1].split('/'));
  }
  if (!pkgs.length) return null;
  let depth = 0;
  while (pkgs.every(p => p.length > depth && p[depth] === pkgs[0][depth])) depth++;
  return depth;
}
