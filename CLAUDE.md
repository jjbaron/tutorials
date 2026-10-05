# Repo Yard: notes for coding agents

Start with HANDOFF.md. It has the user's environment facts, what is done, what is left, and the step-by-step plan.

- Collector: `cd collector`, then `npm test` (must stay green), `npm run demo` (mock environment on :7777), and `npm run doctor` / `once` / `start` (real env; needs config.json + .env).
- Page: edit `web/src/*`, then run `node web/build.mjs`. Never edit `web/dist` by hand.
- Keep everything read-only against real systems. Never commit config.json, .env, snapshot.json, config.draft.json or discovery-report.md.
- Zero npm dependencies by design (corporate machines may block the registry). Use Node built-ins.
- Commit resolution and release-stage logic: `collector/src/collector.js` (runningDeployments) and `collector/src/repo-sync.js` (computeRelease).
