// Loads collector configuration (JSON, full-line // comments allowed) and fills defaults.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  host: '127.0.0.1',
  port: 7777,
  pollSeconds: { github: 60, jenkins: 30, kubernetes: 15 },
  github: {
    apiUrl: 'https://api.github.com',
    org: null,
    tokenEnv: 'GITHUB_TOKEN',
    // Release branches look like release/26.10.05.REL
    releaseBranchPattern: '^release/(?<yy>\\d{2})\\.(?<mm>\\d{2})\\.(?<dd>\\d{2})\\.REL$',
    maxBranches: 40,
    maxFiles: 70,
    churnDays: 30,
    maxChurnCommits: 80,
    staleDays: 14,
    treeRefreshMinutes: 15
  },
  jenkins: {
    url: null,
    userEnv: 'JENKINS_USER',
    tokenEnv: 'JENKINS_TOKEN',
    buildsPerBranch: 20,
    searchConsoleForTags: true,
    maxConsoleScansPerCycle: 10
  },
  kubernetes: {
    // A string, or an array such as ["node", "dev/fake-kubectl.mjs"]
    kubectl: 'kubectl',
    commitAnnotation: 'repo-yard/commit',
    environments: []
  },
  images: {
    // Tried in order. Named groups: sha (git commit), uuid (build id), release (yy-mm-dd).
    tagPatterns: [
      '^(?:[a-z]+-latest-?)?(?<sha>[0-9a-f]{40})$',
      '^dev-latest-?(?<uuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-release-(?<release>\\d{2}-\\d{2}-\\d{2})-REL)?$'
    ],
    // How a tag's release (yy-mm-dd) maps to its branch
    releaseBranchTemplate: 'release/{yy}.{mm}.{dd}.REL',
    // Finds image build ids in Jenkins console output. Group 1 is the uuid.
    consoleTagPattern: 'dev-latest-?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
  },
  repos: []
};

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
export function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

export function parseJsonc(text) {
  return JSON.parse(text.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n'));
}

export function validateConfig(cfg) {
  const errors = [];
  if (!Array.isArray(cfg.repos) || !cfg.repos.length) errors.push('repos: list at least one repository');
  for (const [i, r] of (cfg.repos || []).entries()) {
    if (!r.name) errors.push(`repos[${i}]: "name" is required`);
    if (!r.fullName && !cfg.github.org) errors.push(`repos[${i}] (${r.name}): set "fullName" (owner/repo) or github.org`);
  }
  const envs = cfg.kubernetes.environments || [];
  for (const [i, e] of envs.entries()) {
    if (!e.name) errors.push(`kubernetes.environments[${i}]: "name" is required`);
    if (!e.context) errors.push(`kubernetes.environments[${i}] (${e.name}): "context" is required (see kubectl config get-contexts)`);
  }
  if (envs.length && envs.filter(e => e.production).length !== 1) errors.push('kubernetes.environments: mark exactly one environment with "production": true');
  for (const p of cfg.images.tagPatterns) { try { new RegExp(p); } catch (e) { errors.push(`images.tagPatterns: invalid regex ${p}: ${e.message}`); } }
  try { new RegExp(cfg.github.releaseBranchPattern); } catch (e) { errors.push(`github.releaseBranchPattern: ${e.message}`); }
  return errors;
}

export function loadConfig(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`Config file not found: ${abs}. Copy config.example.json to config.json and edit it.`);
  const cfg = deepMerge(DEFAULTS, parseJsonc(fs.readFileSync(abs, 'utf8')));
  cfg._file = abs;
  cfg._dir = path.dirname(abs);
  const errors = validateConfig(cfg);
  if (errors.length) { const e = new Error('Invalid config:\n  - ' + errors.join('\n  - ')); e.errors = errors; throw e; }
  return cfg;
}

export function repoFullName(cfg, rc) { return rc.fullName || `${cfg.github.org}/${rc.name}`; }
