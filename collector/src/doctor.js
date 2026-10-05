// Checks each credential and connection and explains how to fix what fails.
import { repoFullName } from './config.js';

export async function doctor({ cfg, gh, jenkins, k8s, ghToken, print = console.log }) {
  let ok = true;
  const pass = m => print(`  ✔ ${m}`);
  const fail = (m, fix) => { ok = false; print(`  ✘ ${m}`); if (fix) print(`      → ${fix}`); };
  const warn = (m, fix) => { print(`  ! ${m}`); if (fix) print(`      → ${fix}`); };

  print(`Config: ${cfg._file}`);
  const major = +process.versions.node.split('.')[0];
  major >= 20 ? pass(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} is too old`, 'Install Node 20 or newer');

  print('\nGitHub');
  if (!ghToken) fail(`${cfg.github.tokenEnv} is not set`, `Create a fine-grained PAT (read-only: Contents, Metadata, Pull requests, Commit statuses, Checks, Actions) and put ${cfg.github.tokenEnv}=... in collector/.env`);
  else {
    try {
      const u = await gh.user();
      u ? pass(`Token works (signed in as ${u.login})`) : fail('Token rejected');
      const rl = await gh.rateLimit();
      if (rl) pass(`Rate limit: ${rl.resources.core.remaining}/${rl.resources.core.limit} requests left this hour`);
    } catch (e) { fail(`Token check failed: ${e.message}`, e.status === 401 ? 'The token is invalid or expired' : null); }
  }
  for (const rc of cfg.repos) {
    const full = repoFullName(cfg, rc);
    try {
      const r = await gh.repo(full);
      if (!r) { fail(`${full}: not found`, 'Check the name, and that the PAT is granted access to this repository (fine-grained PATs list repositories explicitly). If your org uses SSO, authorize the token for the org.'); continue; }
      pass(`${full}: default branch ${r.default_branch}`);
      const bs = await gh.branches(full);
      const rel = bs.filter(b => new RegExp(cfg.github.releaseBranchPattern).test(b.name)).map(b => b.name);
      rel.length ? pass(`${full}: ${rel.length} release branches, newest by name: ${rel.sort().slice(-1)[0]}`) : warn(`${full}: no branch matches releaseBranchPattern ${cfg.github.releaseBranchPattern}`, 'Fix github.releaseBranchPattern if release branches are named differently');
      const owners = await gh.codeowners(full);
      owners ? pass(`${full}: CODEOWNERS found`) : warn(`${full}: no CODEOWNERS file (the Owners layer will show everything as unowned)`);
    } catch (e) { fail(`${full}: ${e.message}`, e.status === 403 ? 'The token lacks permission for this repository, or the org requires SSO authorization for the token' : null); }
  }

  print('\nJenkins');
  if (!jenkins) warn('jenkins.url not set, so Jenkins is skipped');
  else {
    try {
      const me = await jenkins.whoAmI();
      me && me.id !== 'anonymous' ? pass(`Signed in as ${me.id}`) : fail('Not signed in (anonymous)', `Set ${cfg.jenkins.userEnv} and ${cfg.jenkins.tokenEnv} (Jenkins → your name → Configure → API Token)`);
    } catch (e) { fail(`Cannot reach ${cfg.jenkins.url}: ${e.message}`, 'Check the URL and that this machine can reach Jenkins (VPN?)'); }
    for (const rc of cfg.repos.filter(r => r.jenkinsJob)) {
      try {
        const jobs = await jenkins.branchJobs(rc.jenkinsJob, 5);
        if (!jobs) { fail(`${rc.name}: job "${rc.jenkinsJob}" not found`, 'Use the job path from the Jenkins URL, e.g. folder/payments-api'); continue; }
        const withSha = jobs.flatMap(j => j.builds).filter(b => (b.actions || []).some(a => a && a.lastBuiltRevision));
        pass(`${rc.name}: ${jobs.length} branch job(s): ${jobs.slice(0, 4).map(j => j.branch || '(single job)').join(', ')}${jobs.length > 4 ? ', …' : ''}`);
        withSha.length ? pass(`${rc.name}: builds record their git commit`) : warn(`${rc.name}: no git revision found on recent builds`, 'Commit lookup through Jenkins will not work; use the deployment annotation instead (HANDOFF.md)');
      } catch (e) { fail(`${rc.name}: ${e.message}`); }
    }
  }

  print('\nKubernetes');
  const envs = cfg.kubernetes.environments || [];
  if (!envs.length) warn('No environments configured, so the Kubernetes view stays empty');
  let contexts = [];
  try { contexts = await k8s.contexts(); pass(`kubectl works; ${contexts.length} contexts in your kubeconfig`); }
  catch (e) { fail(`kubectl failed: ${e.message}`, 'Install kubectl and run: az aks get-credentials -g <resource-group> -n <cluster>'); }
  for (const env of envs) {
    if (contexts.length && !contexts.includes(env.context)) { fail(`${env.name}: context "${env.context}" is not in your kubeconfig`, `Available: ${contexts.join(', ')}`); continue; }
    try {
      const e = await k8s.env(env);
      pass(`${env.name}${env.production ? ' (production)' : ''}: ${e.deployments.length} deployments, ${e.pods.length} pods, ${e.nodes.length} nodes`);
      if (!e.nodes.length) warn(`${env.name}: cannot list nodes (the node view will be empty)`, 'Ask for get/list/watch on nodes, or ignore');
      const matched = cfg.repos.filter(rc => e.deployments.some(d => (rc.deployment || rc.name) === d.name || (d.imageInfo && (rc.image || rc.name) === d.imageInfo.name)));
      matched.length ? pass(`${env.name}: found deployments for ${matched.map(m => m.name).join(', ')}`) : warn(`${env.name}: none of the configured repos matched a deployment`, 'Set repos[].deployment to the Deployment name, or repos[].image to the image name');
    } catch (e) { fail(`${env.name}: ${e.message}`, /Forbidden|forbidden/.test(e.message) ? 'Your identity lacks read access here; ask for the "Azure Kubernetes Service RBAC Reader" role' : /login|token|expired|devicecode/i.test(e.message) ? 'Run az login (and kubelogin convert-kubeconfig -l azurecli) then retry' : null); }
  }
  print(ok ? '\nAll required checks passed.' : '\nSome checks failed; fix the ✘ items above.');
  return ok;
}
