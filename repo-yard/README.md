# Repo Yard

A prototype that shows active development across repositories as a 3D "yard",
in the spirit of a strategy-game view. It runs entirely on simulated data.

Open `index.html` in a browser (it loads three.js r128 from cdnjs).

## What it shows

- **Town view**: each repo is a building. Height is codebase size, lit windows
  are active branches, chimney smoke is commits in the last hour, and the roof
  light is the latest `main` build. Roof color shows the CI system (Jenkins vs.
  the new CI/CD) or the owning team. Pipes connect shared libraries to their
  consumers and turn orange when a consumer is on an old version.
- **Repo view**: the campus is `main`. Districts are folders and buildings are
  files. Each open branch is a construction site: scaffold height is commits
  ahead, distance from the campus is commits behind, the crates are the files it
  changes, and weeds mark branches idle for 14+ days.
- **Conflict arcs**: orange arcs join branches that edit the same files, an early
  warning of merge conflicts.
- **Color layers**: structure, live activity (recently pushed files glow),
  hotspots (churn × complexity) and owners from CODEOWNERS, with fog over
  unowned code.
- **Kubernetes view** (Code / Kubernetes switch in the header): staging and
  production clusters as platforms. Each deployment is a bay and every pod is a
  shipping container. Rollouts surge new pods before retiring old ones (a gantry
  crane marks the bay), the autoscaler adds and removes pods, nodes get cordoned
  and drained for maintenance, and a bad staging rollout crash-loops and rolls
  back. Group pods by deployment or by node. Merges roll out to staging and
  releases roll out to production, so the commit trace follows a change all the
  way into the cluster.
- **Panels**: PR docks grouped by review state, review queues, the branch list,
  pallets staged for release with a ship button, a live activity feed, and
  "Follow a commit", which traces a commit from push to production.

## Source

`src/` holds the parts; `./build.sh` concatenates them into `index.html`.

- `data.js`: fictional repos, people, branches and PRs, plus derived metrics
- `sim.js`: the event simulator (pushes, reviews, merges, builds, releases)
- `k8s.js`: clusters, nodes, deployments and pods, plus rollouts, autoscaling and drains
- `scene.js`: three.js scene, camera controls, labels, repo and town views
- `kscene.js`: the Kubernetes 3D view
- `ui.js`, `kui.js`: HUD, side panels, feed and commit trace
- `boot.js`: wiring and the render loop

To use real data, replace the simulators with collectors that turn Git webhooks,
CI events and the Kubernetes watch API (Deployments, ReplicaSets, Pods, Nodes)
into the same state changes `sim.js` and `k8s.js` make.
