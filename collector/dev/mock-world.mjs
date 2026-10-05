#!/usr/bin/env node
// A fake GitHub + Jenkins + AKS environment for developing and testing Repo Yard without real access.
// It keeps a real commit graph (so compare/ahead/behind are correct), release branches named like
// release/26.10.05.REL, Jenkins builds whose console logs contain dev-latest<uuid> image tags,
// and clusters whose deployments run those tags. Every few seconds the team "works": pushes, reviews,
// merges, builds and rollouts.
//
//   node dev/mock-world.mjs [--port 7788] [--tick 8] [--seed 42]
// Then run the collector with config.mock.json (see package.json: npm run demo).
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function createWorld({ seed = 42 } = {}) {
  let s = seed >>> 0;
  const rand = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rand() * a.length)];
  const rint = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const hex = n => { let o = ''; for (let i = 0; i < n; i++) o += '0123456789abcdef'[Math.floor(rand() * 16)]; return o; };
  const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[rint(0, 3)]}${hex(3)}-${hex(12)}`;
  const DAY = 86400000;
  let clock = Date.now();
  const iso = t => new Date(t).toISOString();
  const people = ['priya-r', 'mlee', 'sofia-a', 'nbrooks', 'dpatel', 'hkim', 'mtanaka', 'tortega', 'jblake'];

  const REPOS = {
    'payments-api': {
      lang: 'Java', ci: 'jenkins', reviewers: ['priya-r', 'mlee', 'sofia-a', 'nbrooks'],
      files: ['pom.xml', 'Jenkinsfile', 'src/main/resources/application.yml',
        ...['Application'].map(f => `src/main/java/com/acme/payments/${f}.java`),
        ...['PaymentController', 'RefundController', 'WebhookController', 'PayoutController'].map(f => `src/main/java/com/acme/payments/api/${f}.java`),
        ...['PaymentService', 'RefundService', 'LedgerService', 'FraudCheckService', 'IdempotencyService'].map(f => `src/main/java/com/acme/payments/service/${f}.java`),
        ...['StripeGatewayClient', 'AdyenGatewayClient', 'GatewayRouter', 'RetryPolicy'].map(f => `src/main/java/com/acme/payments/gateway/${f}.java`),
        ...['PaymentRepository', 'RefundRepository', 'LedgerEntryRepository'].map(f => `src/main/java/com/acme/payments/repository/${f}.java`),
        ...['Payment', 'Refund', 'LedgerEntry', 'Money'].map(f => `src/main/java/com/acme/payments/model/${f}.java`),
        ...['PaymentServiceTest', 'RefundFlowIT', 'GatewayContractTest'].map(f => `src/test/java/com/acme/payments/${f}.java`),
        ...['V40__idempotency_keys', 'V41__refund_reason'].map(f => `src/main/resources/db/migration/${f}.sql`)],
      codeowners: '* @acme/payments\n/src/main/resources/db/ @acme/dba\n/pom.xml @acme/platform\n',
      features: [['feature/PAY-1421-partial-refunds', ['service/RefundService', 'service/PaymentService', 'api/RefundController', 'model/Refund']],
        ['fix/PAY-1433-idempotency-keys', ['service/IdempotencyService', 'service/PaymentService']],
        ['feature/PAY-1452-payout-batching', ['api/PayoutController', 'service/LedgerService']],
        ['spike/PAY-1440-adyen-3ds2', ['gateway/AdyenGatewayClient', 'gateway/GatewayRouter']]]
    },
    'checkout-web': {
      lang: 'TypeScript', ci: 'actions', reviewers: ['dpatel', 'hkim', 'mtanaka'],
      files: ['package.json', '.github/workflows/build.yml', ...['page', 'CheckoutForm', 'ShippingStep', 'PaymentStep'].map(f => `app/checkout/${f}.tsx`),
        ...['PriceTag', 'PromoCodeInput', 'Stepper'].map(f => `components/${f}.tsx`), ...['paymentsClient', 'fetcher'].map(f => `lib/api/${f}.ts`), 'e2e/checkout.spec.ts'],
      codeowners: '* @acme/storefront\n/lib/analytics/ @acme/data\n',
      features: [['feature/SHOP-881-apple-pay', ['app/checkout/PaymentStep', 'app/checkout/CheckoutForm']], ['fix/SHOP-902-promo-rounding', ['components/PromoCodeInput', 'app/checkout/CheckoutForm']]]
    },
    'inventory-svc': {
      lang: 'Go', ci: 'jenkins', reviewers: ['tortega', 'jblake', 'mtanaka'],
      files: ['go.mod', 'Jenkinsfile', 'cmd/server/main.go', ...['reserve', 'release', 'ledger'].map(f => `internal/stock/${f}.go`), ...['allocator', 'zones', 'picklist'].map(f => `internal/warehouse/${f}.go`), 'internal/api/handlers.go'],
      codeowners: null,
      features: [['feature/INV-310-split-shipments', ['internal/warehouse/allocator', 'internal/stock/reserve']], ['fix/INV-322-reservation-ttl', ['internal/stock/reserve', 'internal/stock/release']]]
    }
  };
  const resolveFile = (r, short) => REPOS[r].files.find(f => f.includes(short + '.')) || REPOS[r].files[0];
  const subjects = ['Handle partial capture', 'Add retry with backoff', 'Tighten validation', 'Log gateway latency', 'Refactor service wiring', 'Add missing index', 'Fix flaky test', 'Bump dependency versions', 'Improve error messages', 'Add metrics for latency'];

  const W = { repos: {}, jenkins: {}, k8s: { 'aks-dev': { ns: 'apps-dev', nodes: [], deployments: {}, pods: {} }, 'aks-prod': { ns: 'apps-prod', nodes: [], deployments: {}, pods: {} } }, prSeq: 1500, log: [] };

  function commit(repo, parents, message, author, files, at) {
    const sha = hex(40);
    W.repos[repo].commits.set(sha, { sha, parents, message, author, at, files: files.map(f => ({ path: f, additions: rint(2, 60), deletions: rint(0, 20) })) });
    return sha;
  }
  function ancestors(repo, sha) {
    const seen = new Set(), stack = [sha], C = W.repos[repo].commits;
    while (stack.length) { const x = stack.pop(); if (!x || seen.has(x)) continue; seen.add(x); const c = C.get(x); if (c) stack.push(...c.parents); }
    return seen;
  }
  function resolve(repo, ref) {
    const R = W.repos[repo];
    if (R.refs.has(ref)) return R.refs.get(ref);
    for (const k of R.commits.keys()) if (k.startsWith(ref)) return k;
    return null;
  }

  // ---- build history ----
  for (const [name, def] of Object.entries(REPOS)) {
    const R = W.repos[name] = { commits: new Map(), refs: new Map(), pulls: new Map(), checks: new Map(), runs: [] };
    let t = clock - 30 * DAY, head = commit(name, [], 'Initial import', pick(def.reviewers), def.files.slice(0, 6), t);
    const mainline = [head];
    for (let i = 0; i < 28; i++) {
      t += rint(4, 22) * 3600000;
      const pr = W.prSeq++;
      head = commit(name, [head], `${pick(subjects)} (#${pr})`, pick(def.reviewers), [pick(def.files), pick(def.files)], t);
      mainline.push(head);
    }
    R.refs.set('master', head);
    // two release branches; the newer one has a hotfix that never reached master and a cherry-pick
    const relOld = mainline[mainline.length - 12], relNew = mainline[mainline.length - 5];
    R.refs.set('release/26.09.28.REL', relOld);
    const pickedFrom = mainline[mainline.length - 2];
    let rh = commit(name, [relNew], `${W.repos[name].commits.get(pickedFrom).message.split(' (#')[0]}\n\n(cherry picked from commit ${pickedFrom})`, pick(def.reviewers), [def.files[3]], clock - 20 * 3600000);
    rh = commit(name, [rh], 'Hotfix: guard null merchant config on release', pick(def.reviewers), [def.files[4]], clock - 6 * 3600000);
    R.refs.set('release/26.10.05.REL', rh);
    R.mainline = mainline;
    // feature branches
    def.features.forEach(([bname, shorts], i) => {
      let b = mainline[mainline.length - 1 - rint(0, 6)];
      const files = shorts.map(x => resolveFile(name, x));
      const n = rint(1, 5);
      for (let k = 0; k < n; k++) b = commit(name, [b], pick(subjects), pick(def.reviewers), files.slice(0, rint(1, files.length)), clock - rint(1, 50) * 3600000);
      R.refs.set(bname, b);
      if (i < def.features.length - 1 || def.features.length < 3) openPr(name, bname, i === 0 ? 'in_review' : i === 1 ? 'review_requested' : 'draft');
    });
    // CI
    if (def.ci === 'jenkins') {
      W.jenkins[name] = { master: [], 'release/26.10.05.REL': [], 'release/26.09.28.REL': [] };
      mainline.slice(-12).forEach((sha, i) => jenkinsBuild(name, 'master', sha, 'SUCCESS', i));
      jenkinsBuild(name, 'release/26.09.28.REL', relOld, 'SUCCESS');
      jenkinsBuild(name, 'release/26.10.05.REL', relNew, 'SUCCESS');
      jenkinsBuild(name, 'release/26.10.05.REL', rh, 'SUCCESS');
    } else mainline.slice(-10).forEach(sha => R.runs.unshift(actionsRun(name, 'master', sha, 'success')));
  }

  function openPr(repo, branch, state) {
    const R = W.repos[repo], def = REPOS[repo];
    const n = W.prSeq++;
    const author = pick(def.reviewers);
    const reviewers = def.reviewers.filter(p => p !== author).slice(0, 2);
    const reviews = state === 'in_review' ? [{ user: reviewers[0], state: 'APPROVED' }] : [];
    R.pulls.set(n, { number: n, title: branch.split('/').pop().replace(/^[A-Z]+-\d+-/, '').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()), draft: state === 'draft', author, branch, reviewers, reviews, created: clock - rint(2, 60) * 3600000 });
    R.checks.set(R.refs.get(branch), 'success');
  }
  function jenkinsBuild(repo, branch, sha, result, ageIndex = 0) {
    const list = W.jenkins[repo][branch] || (W.jenkins[repo][branch] = []);
    const number = (list[0] ? list[0].number : 100 + rint(0, 50)) + 1;
    const rel = branch.startsWith('release/') ? branch.replace('release/', '').replace('.REL', '').replace(/\./g, '-') : null;
    const id = uuid();
    const tag = `dev-latest${id}${rel ? `-release-${rel}-REL` : ''}`;
    const b = { number, sha, branch, result, building: result === null, timestamp: clock - (12 - ageIndex) * 3 * 3600000, duration: rint(240, 600) * 1000, tag, uuid: id };
    list.unshift(b);
    return b;
  }
  function actionsRun(repo, branch, sha, conclusion) {
    return { id: rint(1e6, 9e6), run_number: (W.repos[repo].runs[0] ? W.repos[repo].runs[0].run_number : 800) + 1, name: 'build-and-deploy', head_branch: branch, head_sha: sha,
      status: conclusion ? 'completed' : 'in_progress', conclusion, created_at: iso(clock), run_started_at: iso(clock), updated_at: iso(clock + 300000), html_url: 'https://example.invalid/run' };
  }
  const latestOk = (repo, branch, skip = 0) => W.jenkins[repo][branch].filter(b => b.result === 'SUCCESS')[skip];

  // ---- clusters ----
  function mkNodes(ctx, n) { W.k8s[ctx].nodes = Array.from({ length: n }, (_, i) => ({ name: `aks-pool1-${hex(8)}-vmss00000${i}`, zone: `eastus-${(i % 3) + 1}`, cordoned: false })); }
  mkNodes('aks-dev', 2); mkNodes('aks-prod', 4);
  function setImage(ctx, dname, image, replicas, annotations = {}) {
    const C = W.k8s[ctx];
    const old = C.deployments[dname];
    C.deployments[dname] = { name: dname, image, replicas: replicas || (old ? old.replicas : 2), generation: old ? old.generation + 1 : 1, annotations, rollingTicks: old && old.image !== image ? 2 : 0 };
    const pods = Object.values(C.pods).filter(p => p.dep === dname);
    if (!old) for (let i = 0; i < C.deployments[dname].replicas; i++) addPod(ctx, dname, image, true);
    else if (old.image !== image) { for (const p of pods) p.oldImage = true; }
  }
  function addPod(ctx, dname, image, settled) {
    const C = W.k8s[ctx];
    const name = `${dname}-${hex(9).replace(/[aeiou]/g, 'c')}-${hex(5)}`;
    C.pods[name] = { name, dep: dname, image, node: pick(C.nodes.filter(n => !n.cordoned)).name, status: settled ? 'Running' : 'ContainerCreating', restarts: settled && rand() < .2 ? rint(1, 3) : 0, started: clock - (settled ? rint(1, 90) * 3600000 : 0) };
  }
  for (const [name, def] of Object.entries(REPOS)) {
    if (def.ci === 'jenkins') {
      setImage('aks-dev', name, `acmeprod.azurecr.io/${name}:${latestOk(name, 'master', 2).tag}`, 2);
      const prodBuild = latestOk(name, 'release/26.09.28.REL');
      const ann = name === 'inventory-svc' ? { 'repo-yard/commit': prodBuild.sha } : {};
      setImage('aks-prod', name, `acmeprod.azurecr.io/${name}:${prodBuild.tag}`, name === 'payments-api' ? 6 : 3, ann);
    } else {
      const R = W.repos[name];
      setImage('aks-dev', name, `acmeprod.azurecr.io/${name}:dev-latest-${R.mainline[R.mainline.length - 1]}`, 2);
      setImage('aks-prod', name, `acmeprod.azurecr.io/${name}:dev-latest-${R.mainline[R.mainline.length - 6]}`, 4);
    }
  }
  for (const ctx of Object.keys(W.k8s)) for (const d of Object.values(W.k8s[ctx].deployments)) d.rollingTicks = 0;
  setImage('aks-prod', 'ingress-nginx', 'registry.k8s.io/ingress-nginx/controller:v1.11.2', 2);

  // ---- the team at work ----
  function tick() {
    clock = Date.now();
    const name = pick(Object.keys(REPOS)), R = W.repos[name], def = REPOS[name];
    const x = rand();
    const branches = [...R.refs.keys()].filter(b => b !== 'master' && !b.startsWith('release/'));
    if (x < .45 && branches.length) {                      // push to a branch
      const b = pick(branches);
      const feat = def.features.find(f => f[0] === b);
      const files = feat ? feat[1].map(f => resolveFile(name, f)) : [pick(def.files)];
      const sha = commit(name, [R.refs.get(b)], pick(subjects), pick(def.reviewers), files.slice(0, rint(1, files.length)), clock);
      R.refs.set(b, sha);
      R.checks.set(sha, 'pending');
      W.log.push(`push ${name} ${b}`);
    } else if (x < .62) {                                 // a review lands
      const pr = pick([...R.pulls.values()].filter(p => !p.draft));
      if (pr) { const who = pr.reviewers.find(r => !pr.reviews.some(v => v.user === r)); if (who) pr.reviews.push({ user: who, state: rand() < .8 ? 'APPROVED' : 'CHANGES_REQUESTED' }); }
    } else if (x < .75) {                                 // merge an approved PR
      const pr = [...R.pulls.values()].find(p => p.reviews.filter(r => r.state === 'APPROVED').length >= 2) || [...R.pulls.values()].find(p => p.reviews.some(r => r.state === 'APPROVED') && rand() < .3);
      if (pr) {
        const files = [...new Set([...ancestors(name, R.refs.get(pr.branch))].filter(sh => !ancestors(name, R.refs.get('master')).has(sh)).flatMap(sh => R.commits.get(sh).files.map(f => f.path)))];
        const sha = commit(name, [R.refs.get('master')], `${pr.title} (#${pr.number})`, pr.author, files.length ? files : [pick(def.files)], clock);
        R.refs.set('master', sha); R.mainline.push(sha);
        R.refs.delete(pr.branch); R.pulls.delete(pr.number);
        if (def.ci === 'jenkins') { const b = jenkinsBuild(name, 'master', sha, null, 12); b.timestamp = clock; }
        else R.runs.unshift(actionsRun(name, 'master', sha, null));
        W.log.push(`merge ${name} #${pr.number}`);
      }
    } else if (x < .82 && branches.length < 5) {          // start a branch and open a PR
      const bname = `feature/${name.slice(0, 3).toUpperCase()}-${rint(1500, 1999)}-${pick(['audit-log', 'faster-search', 'retry-budget', 'better-errors'])}`;
      if (!R.refs.has(bname)) { R.refs.set(bname, commit(name, [R.refs.get('master')], pick(subjects), pick(def.reviewers), [pick(def.files)], clock)); openPr(name, bname, 'review_requested'); }
    } else if (x < .9) {                                  // prod pod restarts or scales
      const C = W.k8s['aks-prod'];
      const p = pick(Object.values(C.pods).filter(q => q.status === 'Running'));
      if (p && rand() < .5) { p.status = 'CrashLoopBackOff'; p.restarts++; p.recoverAt = clock + 20000; }
      else { const d = C.deployments['payments-api']; d.replicas = d.replicas >= 8 ? 5 : d.replicas + 1; d.generation++; }
    }
    // builds finish, checks settle, rollouts progress
    for (const [rn, jobs] of Object.entries(W.jenkins)) for (const [br, list] of Object.entries(jobs)) for (const b of list) if (b.building && clock - b.timestamp > 12000) {
      b.building = false; b.result = rand() < .9 ? 'SUCCESS' : 'FAILURE';
      if (b.result === 'SUCCESS' && br === 'master') setImage('aks-dev', rn, `acmeprod.azurecr.io/${rn}:${b.tag}`);
    }
    for (const [rn, def2] of Object.entries(REPOS)) {
      const R2 = W.repos[rn];
      for (const [sha, st] of R2.checks) if (st === 'pending' && rand() < .5) R2.checks.set(sha, rand() < .88 ? 'success' : 'failure');
      for (const run of R2.runs) if (run.status !== 'completed' && rand() < .5) { run.status = 'completed'; run.conclusion = 'success'; setImage('aks-dev', rn, `acmeprod.azurecr.io/${rn}:dev-latest-${run.head_sha}`); }
    }
    for (const ctx of Object.keys(W.k8s)) {
      const C = W.k8s[ctx];
      for (const d of Object.values(C.deployments)) {
        const pods = Object.values(C.pods).filter(p => p.dep === d.name);
        for (const p of pods) { if (p.status === 'ContainerCreating') p.status = 'Running'; if (p.status === 'Terminating') delete C.pods[p.name]; if (p.status === 'CrashLoopBackOff' && clock > p.recoverAt) p.status = 'Running'; }
        const old = pods.filter(p => p.oldImage && p.status !== 'Terminating');
        const live = pods.filter(p => p.status !== 'Terminating');
        if (old.length) { addPod(ctx, d.name, d.image, false); old[0].status = 'Terminating'; }
        else if (live.length < d.replicas) addPod(ctx, d.name, d.image, false);
        else if (live.length > d.replicas) live[live.length - 1].status = 'Terminating';
      }
    }
  }

  /* ---------- API shapes ---------- */
  const R0 = repo => W.repos[repo];
  const commitApi = (repo, sha) => { const c = R0(repo).commits.get(sha); return { sha, commit: { message: c.message, author: { name: c.author, date: iso(c.at) }, committer: { date: iso(c.at) } }, author: { login: c.author } }; };
  function compare(repo, base, head) {
    const b = resolve(repo, base), h = resolve(repo, head);
    if (!b || !h) return null;
    const A = ancestors(repo, b), H = ancestors(repo, h);
    const ahead = [...H].filter(x => !A.has(x)).map(x => R0(repo).commits.get(x)).sort((x, y) => x.at - y.at);
    const behind = [...A].filter(x => !H.has(x));
    const fm = new Map();
    for (const c of ahead) for (const f of c.files) { const e = fm.get(f.path) || { filename: f.path, additions: 0, deletions: 0 }; e.additions += f.additions; e.deletions += f.deletions; fm.set(f.path, e); }
    return { ahead_by: ahead.length, behind_by: behind.length, base_commit: commitApi(repo, b), commits: ahead.map(c => commitApi(repo, c.sha)), files: [...fm.values()] };
  }
  function k8sJson(ctx, kind, ns) {
    const C = W.k8s[ctx];
    if (!C) return null;
    if (ns && ns !== C.ns) return { items: [] };
    if (kind === 'nodes') return { items: C.nodes.map(n => ({ metadata: { name: n.name, labels: { 'topology.kubernetes.io/zone': n.zone, 'kubernetes.azure.com/agentpool': 'pool1' } }, spec: { unschedulable: n.cordoned || undefined }, status: { conditions: [{ type: 'Ready', status: 'True' }], allocatable: { pods: '30' } } })) };
    if (kind === 'deployments') return { items: Object.values(C.deployments).map(d => {
      const pods = Object.values(C.pods).filter(p => p.dep === d.name);
      const ready = pods.filter(p => p.status === 'Running').length, updated = pods.filter(p => p.image === d.image && p.status !== 'Terminating').length;
      const rolling = pods.some(p => p.oldImage && p.status !== 'Terminating') || updated < d.replicas;
      return { metadata: { name: d.name, namespace: C.ns, generation: d.generation, annotations: d.annotations },
        spec: { replicas: d.replicas, selector: { matchLabels: { app: d.name } }, template: { metadata: { annotations: {} }, spec: { containers: [{ name: d.name, image: d.image }] } } },
        status: { observedGeneration: d.generation, replicas: pods.length, updatedReplicas: updated, readyReplicas: ready, availableReplicas: ready, conditions: [{ type: 'Progressing', status: 'True', reason: rolling ? 'ReplicaSetUpdated' : 'NewReplicaSetAvailable' }] } };
    }) };
    if (kind === 'pods') return { items: Object.values(C.pods).map(p => ({
      metadata: { name: p.name, namespace: C.ns, labels: { app: p.dep }, creationTimestamp: iso(p.started), deletionTimestamp: p.status === 'Terminating' ? iso(clock) : undefined, annotations: {} },
      spec: { nodeName: p.node, containers: [{ name: p.dep, image: p.image }] },
      status: { phase: p.status === 'ContainerCreating' ? 'Pending' : 'Running', startTime: iso(p.started),
        containerStatuses: [{ ready: p.status === 'Running', restartCount: p.restarts, state: p.status === 'CrashLoopBackOff' ? { waiting: { reason: 'CrashLoopBackOff' } } : p.status === 'ContainerCreating' ? { waiting: { reason: 'ContainerCreating' } } : { running: {} } }] } })) };
    return null;
  }

  function route(method, url) {
    const u = new URL(url, 'http://x');
    const p = u.pathname, q = u.searchParams;
    let m;
    // --- kubernetes (used by fake-kubectl) ---
    if ((m = /^\/__k8s\/contexts$/.exec(p))) return Object.keys(W.k8s);
    if ((m = /^\/__k8s\/([^/]+)\/(nodes|deployments|pods)$/.exec(p))) return k8sJson(decodeURIComponent(m[1]), m[2], q.get('ns'));
    // --- github ---
    if (p === '/gh/user') return { login: 'mock-user' };
    if (p === '/gh/rate_limit') return { resources: { core: { remaining: 4999, limit: 5000 } } };
    if ((m = /^\/gh\/repos\/acme\/([^/]+)(\/.*)?$/.exec(p))) {
      const repo = decodeURIComponent(m[1]), rest = m[2] || '', R = W.repos[repo];
      if (!R) return null;
      if (!rest) return { name: repo, full_name: `acme/${repo}`, default_branch: 'master', language: REPOS[repo].lang, archived: false };
      if (rest === '/branches') { const page = +(q.get('page') || 1); return page > 1 ? [] : [...R.refs].map(([name, sha]) => ({ name, commit: { sha } })); }
      if (rest === '/pulls') return [...R.pulls.values()].map(pr => ({ number: pr.number, title: pr.title, draft: pr.draft, user: { login: pr.author }, head: { ref: pr.branch, sha: R.refs.get(pr.branch), repo: { full_name: `acme/${repo}` } },
        requested_reviewers: pr.reviewers.filter(r => !pr.reviews.some(v => v.user === r)).map(login => ({ login })), requested_teams: [], created_at: iso(pr.created), updated_at: iso(clock), html_url: `https://example.invalid/pr/${pr.number}` }));
      if ((m = /^\/pulls\/(\d+)\/reviews$/.exec(rest))) { const pr = R.pulls.get(+m[1]); return pr ? (+q.get('page') > 1 ? [] : pr.reviews.map(r => ({ user: { login: r.user }, state: r.state }))) : null; }
      if ((m = /^\/compare\/(.+)\.\.\.(.+)$/.exec(rest))) return compare(repo, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      if ((m = /^\/commits\/([^/]+)\/check-runs$/.exec(rest))) { const st = R.checks.get(m[1]); return { check_runs: st ? [{ status: st === 'pending' ? 'in_progress' : 'completed', conclusion: st === 'pending' ? null : st }] : [] }; }
      if ((m = /^\/commits\/([^/]+)\/status$/.exec(rest))) return { statuses: [] };
      if ((m = /^\/commits\/([^/]+)$/.exec(rest))) { const sha = resolve(repo, decodeURIComponent(m[1])); const c = sha && R.commits.get(sha); return c ? { sha, files: c.files.map(f => ({ filename: f.path, additions: f.additions, deletions: f.deletions })) } : null; }
      if (rest === '/commits') {
        const sha = resolve(repo, q.get('sha') || 'master'), since = Date.parse(q.get('since') || 0) || 0;
        return [...ancestors(repo, sha)].map(x => R.commits.get(x)).filter(c => c.at >= since).sort((a, b) => b.at - a.at).slice(0, +(q.get('per_page') || 30)).map(c => commitApi(repo, c.sha));
      }
      if ((m = /^\/git\/trees\/(.+)$/.exec(rest))) return { tree: REPOS[repo].files.map(f => ({ path: f, type: 'blob', size: 800 + (hashNum(f) % 30000) })), truncated: false };
      if ((m = /^\/contents\/(.+)$/.exec(rest))) { const path = decodeURIComponent(m[1]); return path === '.github/CODEOWNERS' && REPOS[repo].codeowners ? { __raw: REPOS[repo].codeowners } : null; }
      if (rest === '/actions/runs') return { workflow_runs: R.runs.slice(0, +(q.get('per_page') || 30)) };
      return null;
    }
    // --- jenkins ---
    if (p === '/jenkins/me/api/json') return { id: 'mock-user', fullName: 'Mock User' };
    if ((m = /^\/jenkins\/((?:job\/[^/]+\/)+)(\d+\/)?(api\/json|consoleText)$/.exec(p))) {
      const segs = m[1].split('/').filter((x, i) => i % 2 === 1).map(s => decodeURIComponent(decodeURIComponent(s)));
      const repo = segs[0], branch = segs[1] || null, J = W.jenkins[repo];
      if (!J) return null;
      const base = `http://${HOST}/jenkins/job/${encodeURIComponent(repo)}/`;
      const bUrl = (br, n) => `${base}job/${encodeURIComponent(encodeURIComponent(br))}/${n}/`;
      if (m[3] === 'consoleText') { const b = (J[branch] || []).find(x => x.number === parseInt(m[2])); return b ? { __raw: `Started by GitHub push\nChecking out Revision ${b.sha} (origin/${branch})\n[Pipeline] sh\n+ docker build -t acmeprod.azurecr.io/${repo}:${b.tag} .\n+ docker push acmeprod.azurecr.io/${repo}:${b.tag}\nFinished: ${b.result || 'RUNNING'}\n` } : null; }
      if (!branch) return { name: repo, url: base, jobs: Object.keys(J).map(br => ({ name: encodeURIComponent(br), url: `${base}job/${encodeURIComponent(encodeURIComponent(br))}/`, color: 'blue' })) };
      return { name: encodeURIComponent(branch), url: `${base}job/${encodeURIComponent(encodeURIComponent(branch))}/`,
        builds: (J[branch] || []).slice(0, 25).map(b => ({ number: b.number, url: bUrl(branch, b.number), result: b.building ? null : b.result, building: b.building, timestamp: b.timestamp, duration: b.duration, displayName: `#${b.number}`, description: null,
          actions: [{ _class: 'hudson.model.CauseAction' }, { _class: 'hudson.plugins.git.util.BuildData', lastBuiltRevision: { SHA1: b.sha, branch: [{ name: `origin/${branch}` }] } }] })) };
    }
    return undefined;
  }
  let HOST = '127.0.0.1:7788';
  return { route, tick, setHost: h => { HOST = h; }, W };
}
function hashNum(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

export function serveWorld({ port = 7788, tickSeconds = 8, seed = 42, quiet = false } = {}) {
  const world = createWorld({ seed });
  world.setHost(`127.0.0.1:${port}`);
  const server = http.createServer((req, res) => {
    const out = world.route(req.method, req.url);
    if (out === undefined || out === null) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"message":"Not Found"}'); }
    const raw = out && out.__raw !== undefined;
    const body = raw ? out.__raw : JSON.stringify(out);
    const etag = '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    res.writeHead(200, { 'Content-Type': raw ? 'text/plain' : 'application/json', ETag: etag, 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) });
    res.end(body);
  });
  const timer = tickSeconds > 0 ? setInterval(() => world.tick(), tickSeconds * 1000) : null;
  return new Promise(r => server.listen(port, '127.0.0.1', () => {
    if (!quiet) console.log(`Mock world on http://127.0.0.1:${port} (GitHub at /gh, Jenkins at /jenkins, kubectl via dev/fake-kubectl.mjs)`);
    r({ world, server, close: () => { if (timer) clearInterval(timer); return new Promise(rr => server.close(rr)); } });
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const a = process.argv.slice(2), o = n => { const i = a.indexOf(`--${n}`); return i >= 0 ? +a[i + 1] : undefined; };
  serveWorld({ port: o('port') || 7788, tickSeconds: o('tick') ?? 8, seed: o('seed') || 42 });
}
