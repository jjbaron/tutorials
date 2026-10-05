# Handoff: connect Repo Yard to the real environment

This document is for the agent (or person) finishing this project on the work machine. Read it fully before changing anything. Everything here was built and tested against a mock environment; **nothing has touched the real systems yet.**

## What this is

Repo Yard is a 3D web view of software delivery, inspired by "strategy game" dashboards:

- **Code view:** each repo is a building. Opening a repo shows a campus for the default branch (folders are districts, files are buildings). Open branches are construction sites around it, and orange arcs connect branches that edit the same files (merge-conflict risk). The side panel has PR review docks, review queues, and **release status**.
- **Kubernetes view:** clusters are platforms, deployments are bays, and each pod is a shipping container. It shows rollouts, crash loops, node drains, and dev vs production drift.
- **Follow a commit:** traces any commit from branch → PR → merge → build → dev → release cut → production.

The page runs a built-in **simulation** when opened standalone (that is the published demo). When served by the **collector** in this repo, it switches to **live data** automatically.

## The user's environment (confirmed with the user)

| Thing | Value |
|---|---|
| Git hosting | **github.com** (not Enterprise Server) |
| CI today | **Jenkins**. It builds **and deploys** to Kubernetes. |
| CI target | **GitHub Actions**, migrating by end of year |
| Deploys target | **Argo CD**, replacing Jenkins deploys |
| Kubernetes | **AKS** (Azure). Auth is probably Entra ID via kubelogin. |
| Release branches | `release/26.10.05.REL` (that is `release/yy.mm.dd.REL`) |
| Image tag, master builds | `payments-api:dev-latest<uuid>`, e.g. `dev-latest58b8b7af-5c85-4ba1-b4be-78cf55a86db4` |
| Image tag, release builds | `payments-api:dev-latest<uuid>-release-yy-mm-dd-REL` |
| Still unknown | Cluster/namespace layout per environment; exact Jenkins job paths; repo list; whether images carry an OCI revision label |

The `<uuid>` is a random UUID (32 hex digits in 8-4-4-4-12 groups), **not a git commit**. That is the central problem; see "How a running pod is tied to a commit" below.

## Status

### Done and tested (against the mock)
- `collector/`: Node 20+ service with **zero npm dependencies**.
  - **GitHub source:** branches, compare (ahead/behind/files), PRs, reviews, check status, file tree, churn, CODEOWNERS, Actions runs. Uses ETag caching (304s don't count against the rate limit).
  - **Jenkins source:** multibranch jobs, builds with git revision, and console-log search to map UUID tags to builds.
  - **Kubernetes source:** shells out to `kubectl`, so AKS/Entra ID/kubelogin auth works exactly as it does for the user.
  - **Commit resolution** for running deployments, in this order: deployment annotation → SHA in tag → Jenkins build lookup by UUID.
  - **Release stages:** waiting for cut / in release but not deployed / release fixes not merged back. Also which master commits each pre-prod environment lacks.
  - **Snapshot API** (`/api/snapshot`), **live push** (`/api/stream`, server-sent events), feed events computed by diffing snapshots, **doctor** (credential checks with fix hints), and **once** (one sync plus a printed summary).
- `web/`: the page with **live mode**. It auto-detects the collector, hides simulation controls, shows data-source health, uses the release-branch aware trace and release panel, and supports any number of environments.
- `scripts/discover.mjs`: runs all discovery commands and writes `discovery-report.md` and `config.draft.json`.
- `collector/dev/`: **mock world** (fake GitHub + Jenkins + AKS with a real commit graph that changes over time) and a fake kubectl. `npm run demo` runs everything locally.
- Tests: `cd collector && npm test`. These are unit tests plus an end-to-end test of the real collector over HTTP against the mock. All 13 pass.

### Not done (your job)
1. Run discovery on the work machine and produce a real `collector/config.json`.
2. Set up credentials (below) and get `npm run doctor` fully green.
3. Run `npm run once` and check the printed summary with the user. In particular, every production deployment needs a resolved commit.
4. Run `npm start`, open the page, and fix whatever real data breaks (see "Likely real-world issues").
5. Optional improvements, listed at the end.

## Step by step on the work machine

Prerequisites: Node 20+, git, `kubectl`, `az` CLI, and `kubelogin` (`az aks install-cli` installs the last two).

```bash
git clone -b repo-yard --single-branch https://github.com/jjbaron/tutorials.git repo-yard
cd repo-yard

# 0. sanity check with fake data (no credentials needed)
cd collector && npm test && npm run demo     # open http://127.0.0.1:7777, Ctrl+C to stop
cd ..

# 1. make sure every cluster is in your kubeconfig
az login
az aks list -o table                                  # repeat after: az account set -s <subscription>
az aks get-credentials -g <resource-group> -n <cluster>   # once per cluster
kubelogin convert-kubeconfig -l azurecli               # if kubectl asks for device-code login every time

# 2. discover the layout (point --repos-dir at the folder holding the user's git clones)
node scripts/discover.mjs --repos-dir ~/src
#    -> discovery-report.md, config.draft.json  (internal names inside; do not commit)

# 3. config + secrets
cp config.draft.json collector/config.json             # then edit: see "Config checklist"
cp collector/.env.example collector/.env               # then fill in the tokens

# 4. verify, then one sync with a readable summary
cd collector
npm run doctor
npm run once                                           # writes snapshot.json and prints per-repo status

# 5. run it
npm start                                              # http://127.0.0.1:7777
```

On Windows, use the same commands in PowerShell. Paths like `~/src` become `C:\Users\<you>\src`.

## Credentials (all read-only)

**GitHub: fine-grained personal access token**
- github.com → Settings → Developer settings → Fine-grained tokens → Generate.
- Resource owner: the org. Repository access: only the repos being visualized.
- Repository permissions, all **Read-only**: Metadata, Contents, Pull requests, Commit statuses, Checks, Actions.
- If the org enforces SAML SSO, or requires approval for fine-grained tokens, the token must be authorized or approved first. `doctor` reports a 403 or not-found if not.
- Put it in `collector/.env` as `GITHUB_TOKEN=...`.
- Later, for a shared deployment, replace the PAT with a GitHub App. That gives higher rate limits, isn't tied to one person, and supports webhooks.

**Jenkins: API token**
- Jenkins → your name (top right) → Configure → API Token → Add new token.
- Put `JENKINS_USER=<your user id>` and `JENKINS_TOKEN=<token>` in `collector/.env`.
- Needs Overall/Read and Job/Read. Console-log search also needs permission to read console output, which Job/Read normally includes.

**AKS: the user's own kubectl access**
- No token. The collector runs `kubectl --context <ctx> get ... -o json`, so if `kubectl get pods` works in a terminal, the collector works.
- For a shared/server deployment later: give a dedicated identity the **Azure Kubernetes Service RBAC Reader** role (if Azure RBAC is on), or bind a ClusterRole with `get/list/watch` on deployments, replicasets, pods, nodes, events, namespaces.

## Config checklist (`collector/config.json`)

See `collector/config.example.json` for every field.

- `github.org` is the org from the git remotes. Repos in another org need `"fullName": "owner/repo"`.
- `kubernetes.environments`: one entry per environment.
  - `context` must match `kubectl config get-contexts -o name` exactly.
  - Give `namespaces` if the cluster is shared, so it doesn't list every namespace.
  - Exactly one entry has `"production": true`.
  - If there's an env between dev and prod (qa/uat/staging), list them in promotion order (dev first, prod last). The **last non-production** one is treated as "pre-prod" in the trace.
- `repos[]`:
  - `name` is the GitHub repo.
  - `jenkinsJob` is the job path as shown in the Jenkins URL: `.../job/team/job/payments-api/` becomes `"team/payments-api"`.
  - `deployment` and `image` are only needed when they differ from the repo name.
  - `team` sets the color and grouping.
- Tag format defaults already match `dev-latest<uuid>[-release-yy-mm-dd-REL]` (`images.tagPatterns` in `src/config.js`). Change them only if real tags differ.

## How a running pod is tied to a commit

`runningDeployments()` in `collector/src/collector.js` resolves a deployment's commit in this order:
1. **Deployment annotation** `repo-yard/commit` (name set by `kubernetes.commitAnnotation`). Exact and cheap. Recommended.
2. **SHA inside the image tag** (named group `sha`). This will apply once GitHub Actions tags images with the commit.
3. **Jenkins lookup by UUID.** It indexes UUIDs found in build display names/descriptions, then searches the console logs of recent builds (`consoleTagPattern`) until every running UUID maps to a build. The build's `lastBuiltRevision.SHA1` is the commit. This works today with zero changes to Jenkins, but only for builds Jenkins still retains, and it costs one console fetch per build scanned. Results are cached for the process lifetime.

If production shows `commit UNRESOLVED` in `npm run once`:
- Check the console regex against a real console log. Open a build's `consoleText` and confirm the full `dev-latest<uuid>` string appears.
- Raise `jenkins.buildsPerBranch` if the deployed build is older than the retained window.
- Better fix: ask the build owners to add the annotation (next section).

### Commit annotation (one line in the Jenkinsfile deploy step)
```groovy
sh "kubectl --context ${ctx} -n ${ns} annotate deployment/${app} repo-yard/commit=${env.GIT_COMMIT} --overwrite"
```
It doesn't change images and takes effect from the next deploy. When moving to GitHub Actions + Argo CD:
- Tag images with the commit SHA, e.g. `dev-latest-${{ github.sha }}`. The default tag pattern already accepts that.
- Add the OCI label `org.opencontainers.image.revision=${{ github.sha }}`.
- Have the Argo CD manifests set the same annotation.

Note: Argo CD's own "revision" is the commit of the **manifests repo**, not the app repo. Don't use it as the app commit.

## How "staged for release" is computed (release-branch flow)

`computeRelease()` in `collector/src/repo-sync.js`, for each repo:
- **latest release** is the highest `release/yy.mm.dd.REL` branch.
- **production commit** comes from the production deployment (see above). **Production release** is the `-release-yy-mm-dd-REL` part of its tag.
- **Waiting for the next cut:** `compare(latestRelease...default)`, the commits on the default branch not yet on the release branch.
- **In release, not deployed:** `compare(prodSha...latestRelease)`, release commits production doesn't run yet.
- **Not merged back:** `compare(default...latestRelease)`, minus cherry-picks. A commit is treated as merged back if it has a "cherry picked from commit" trailer, or the default branch has the same subject line or the same PR number. This is a heuristic; check it against reality with the user.
- **Pre-prod drift:** `notOnEnv[env]` = `compare(envSha...default)`.

## Repository map

```
collector/
  src/index.js          CLI: run | once | doctor   (loads collector/.env next to the config)
  src/config.js         defaults + validation (JSON, full-line // comments allowed)
  src/model.js          pure helpers: tag parsing, release names, CODEOWNERS, districts, PR numbers
  src/sources/github.js REST client with ETag cache
  src/sources/jenkins.js
  src/sources/k8s.js    kubectl runner + normalization (pod status, rollouts, nodes)
  src/repo-sync.js      per-repo GitHub sync + computeRelease()
  src/collector.js      orchestration, commit resolution, snapshot assembly, feed events (diffEvents)
  src/server.js         serves web/dist, /api/snapshot, /api/stream (SSE), /api/health
  src/doctor.js         credential and connectivity checks
  dev/mock-world.mjs    fake GitHub + Jenkins + AKS (npm run mock / npm run demo)
  dev/fake-kubectl.mjs
  test/                 node:test (npm test)
web/
  src/*.js, shell.html  the page (plain three.js r128, no build tooling)
  src/live.js           live mode: snapshot → page model, streaming updates
  build.mjs             node web/build.mjs → web/dist/index.html (+ artifact.html)
  vendor/three.min.js   local copy, used when the CDN is blocked
scripts/discover.mjs    environment discovery → report + draft config
```

After editing `web/src`, run `node web/build.mjs`. The collector serves `web/dist/index.html`. The dist files are committed, so a fresh clone works without building.

### Snapshot shape (`schema: "repo-yard/1"`)
`{ schema, version, generatedAt, sources{github,jenkins,kubernetes}, environments[{name,label,production}], repos[{name, full, team, ci, defaultBranch, files[], branches[{name, sha, ahead, behind, files[], commits[], pr{number, state, reviewers[], ci}}], recent[], release{latestRelease, prodRelease, prodSha, waitingForCut[], inReleaseNotDeployed[], notBackMerged[], notOnEnv{}}, builds[], deployments[]}], clusters[{env, nodes[]}], deployments[{id, env, name, namespace, repo, desired, ready, rolling, stalled, tag, commit, commitSource, releaseBranch, pods[]}], events[] }`.
Run `npm run once` and open `snapshot.json` for a real example.

## Likely real-world issues and where to fix them

| Symptom | Likely cause | Fix |
|---|---|---|
| `doctor`: repo not found | Fine-grained PAT not granted that repo, or SSO not authorized | Edit the token's repository access, then authorize for SSO |
| GitHub rate limit runs low | Many repos/branches | Lower `github.maxBranches` / `maxChurnCommits`, raise `pollSeconds.github` |
| `kubectl ... failed: ... devicecode` | kubelogin not converted | `kubelogin convert-kubeconfig -l azurecli`, then `az login` |
| Production `commit UNRESOLVED` | UUID not found in retained console logs | See "How a running pod is tied to a commit" |
| No deployments matched | Deployment/image named differently from repo | Set `repos[].deployment` / `repos[].image` |
| Jenkins job not found | Job lives in a folder | `jenkinsJob: "folder/job"` |
| Districts look odd | Unusual repo layout | `districtOf()` in `src/model.js` |
| Huge clusters slow | `-A` lists every pod | Set `namespaces` per environment |
| Page blank | CDN blocked and `vendor/three.min.js` missing | It's committed; check that `web/vendor` exists |

## Security notes
- The collector binds to `127.0.0.1` by default. Only change `host` with the user's agreement. The page shows internal repo, cluster and people names and has no login.
- Every call is read-only (GET requests, `kubectl get`). Keep it that way.
- Secrets stay in `collector/.env` (gitignored). Never commit `config.json`, `.env`, `snapshot.json`, or discovery output.

## Optional next steps (agree with the user first)
- Hourly churn history and a hotspot trend, from more commit history.
- GitHub App auth + webhooks instead of polling.
- Argo CD source (read Applications: sync and health status) once Argo CD is live.
- A shared deployment (container in AKS, behind SSO).
- Port the page to React + React Three Fiber (see the earlier discussion with the user). Keep the snapshot API as the contract.
