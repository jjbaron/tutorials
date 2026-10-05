# Repo Yard

A 3D, strategy-game style view of software delivery: repos as buildings, branches as construction sites, conflict
warnings between branches that edit the same files, PR review docks, release status for `release/yy.mm.dd.REL`
branches, and a Kubernetes view where every pod is a shipping container.

- **Standalone page** (`web/dist/index.html`): runs a built-in simulation, no setup.
- **Live mode**: run the collector and the same page shows your real GitHub, Jenkins / GitHub Actions and AKS data.

## Quick start

Requires Node 20+.

```bash
cd collector
npm test          # unit + end-to-end tests against a mock environment
npm run demo      # mock GitHub/Jenkins/AKS + collector → http://127.0.0.1:7777
```

## Use with your environment

Follow **[HANDOFF.md](HANDOFF.md)**. In short:

```bash
node scripts/discover.mjs --repos-dir <folder with your git clones>   # writes config.draft.json
cp config.draft.json collector/config.json && cp collector/.env.example collector/.env   # edit both
cd collector && npm run doctor && npm run once && npm start
```

Credentials, all read-only: a GitHub fine-grained token, a Jenkins API token, and your existing `kubectl`/`az aks` access.

## Layout

- `collector/`: Node service (no dependencies) that polls the sources and serves the page plus `/api/snapshot` and `/api/stream`
- `web/`: the page (three.js); `node web/build.mjs` rebuilds `web/dist`
- `scripts/discover.mjs`: environment discovery and draft config
- `HANDOFF.md`: status, setup, design notes, troubleshooting

All data on the demo page is simulated. Names of people, teams and repos there are fictional.
