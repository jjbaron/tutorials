#!/usr/bin/env node
// Stands in for kubectl when using the mock world. Supports exactly what the collector runs:
//   config get-contexts -o name
//   --context C get deployments|pods|nodes [-A | -n NS] -o json
const MOCK = process.env.REPO_YARD_MOCK_URL || 'http://127.0.0.1:7788';
const a = process.argv.slice(2);
const val = f => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : null; };
async function main() {
  if (a[0] === 'version') { process.stdout.write('{"clientVersion":{"gitVersion":"v1.30.0-mock"}}\n'); return; }
  if (a[0] === 'config' && a[1] === 'current-context') { process.stdout.write('aks-dev\n'); return; }
  if (a[0] === 'config' && a[1] === 'get-contexts') {
    const ctxs = await (await fetch(`${MOCK}/__k8s/contexts`)).json();
    process.stdout.write(ctxs.join('\n') + '\n');
    return;
  }
  const ctx = val('--context'), gi = a.indexOf('get'), kind = a[gi + 1], ns = val('-n');
  const res = await fetch(`${MOCK}/__k8s/${encodeURIComponent(ctx)}/${kind}${ns ? `?ns=${encodeURIComponent(ns)}` : ''}`);
  if (!res.ok) { process.stderr.write(`error: context "${ctx}" does not exist\n`); process.exit(1); }
  process.stdout.write(await res.text());
}
main().catch(e => { process.stderr.write(`Unable to connect to the server: ${e.message}\n`); process.exit(1); });
