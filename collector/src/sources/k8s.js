// Kubernetes source. Shells out to kubectl so every auth method kubectl supports
// (AKS + Entra ID via kubelogin, az, certs) works without extra code.
import { execFile } from 'node:child_process';
import { parseImage } from '../model.js';

export function kubectlRunner(kubectl) {
  const cmd = Array.isArray(kubectl) ? kubectl : [kubectl];
  return args => new Promise((resolve, reject) => {
    execFile(cmd[0], [...cmd.slice(1), ...args], { maxBuffer: 256 * 1024 * 1024, timeout: 60000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) { err.message = `kubectl ${args.join(' ')} failed: ${(stderr || err.message).trim()}`; reject(err); }
      else resolve(stdout);
    });
  });
}

export function createK8s({ run }) {
  async function getJson(context, args) {
    const out = await run(['--context', context, ...args, '-o', 'json', '--request-timeout=30s']);
    return JSON.parse(out);
  }
  async function listNamespaced(context, kind, namespaces) {
    if (!namespaces || !namespaces.length) return (await getJson(context, ['get', kind, '-A'])).items || [];
    const lists = await Promise.all(namespaces.map(ns => getJson(context, ['get', kind, '-n', ns])));
    return lists.flatMap(l => l.items || []);
  }
  return {
    async env(env) {
      const [deployments, pods, nodes] = await Promise.all([
        listNamespaced(env.context, 'deployments', env.namespaces),
        listNamespaced(env.context, 'pods', env.namespaces),
        getJson(env.context, ['get', 'nodes']).then(l => l.items || []).catch(() => [])   // node read may be forbidden; not fatal
      ]);
      return normalizeEnv(env, deployments, pods, nodes);
    },
    contexts: async () => (await run(['config', 'get-contexts', '-o', 'name'])).split(/\r?\n/).filter(Boolean)
  };
}

const matches = (selector, labels) => selector && Object.entries(selector).every(([k, v]) => labels && labels[k] === v);

export function podStatus(p) {
  if (p.metadata.deletionTimestamp) return 'Terminating';
  const cs = (p.status && p.status.containerStatuses) || [];
  for (const c of cs) {
    const w = c.state && c.state.waiting;
    if (w && w.reason && w.reason !== 'ContainerCreating' && w.reason !== 'PodInitializing') return w.reason;   // CrashLoopBackOff, ImagePullBackOff, ...
  }
  const phase = p.status && p.status.phase;
  if (phase === 'Pending') return cs.length ? 'ContainerCreating' : 'Pending';
  if (phase === 'Running') return cs.length && cs.every(c => c.ready) ? 'Running' : 'ContainerCreating';
  return phase || 'Unknown';   // Succeeded, Failed, Unknown
}

export function normalizeEnv(env, deployments, pods, nodes) {
  const podCount = {};
  const outPods = pods.map(p => {
    const c0 = (p.spec.containers || [])[0] || {};
    const node = p.spec.nodeName || null;
    if (node) podCount[node] = (podCount[node] || 0) + 1;
    return {
      name: p.metadata.name, namespace: p.metadata.namespace, labels: p.metadata.labels || {},
      status: podStatus(p), node, image: c0.image || null,
      restarts: ((p.status && p.status.containerStatuses) || []).reduce((s, c) => s + (c.restartCount || 0), 0),
      startedAt: (p.status && p.status.startTime) || p.metadata.creationTimestamp || null,
      annotations: p.metadata.annotations || {}
    };
  });
  const outDeps = deployments.map(d => {
    const sel = d.spec.selector && d.spec.selector.matchLabels;
    const containers = d.spec.template.spec.containers || [];
    const image = (containers[0] || {}).image || null;
    const st = d.status || {};
    const conds = st.conditions || [];
    const progressing = conds.find(c => c.type === 'Progressing');
    const desired = d.spec.replicas == null ? 1 : d.spec.replicas;
    const rolling = (st.observedGeneration || 0) < (d.metadata.generation || 0) || (st.updatedReplicas || 0) < desired || (st.replicas || 0) > desired ||
      (progressing && progressing.status === 'True' && progressing.reason === 'ReplicaSetUpdated');
    const stalled = !!(progressing && progressing.status === 'False');   // ProgressDeadlineExceeded
    return {
      id: `${env.name}/${d.metadata.namespace}/${d.metadata.name}`, env: env.name, namespace: d.metadata.namespace, name: d.metadata.name,
      desired, ready: st.readyReplicas || 0, updated: st.updatedReplicas || 0, available: st.availableReplicas || 0,
      image, imageInfo: image ? parseImage(image) : null, rolling: !!rolling, stalled,
      annotations: Object.assign({}, d.spec.template.metadata && d.spec.template.metadata.annotations, d.metadata.annotations),
      pods: outPods.filter(p => p.namespace === d.metadata.namespace && matches(sel, p.labels)).map(p => p.name)
    };
  });
  const outNodes = nodes.map(n => {
    const ready = ((n.status && n.status.conditions) || []).find(c => c.type === 'Ready');
    const l = n.metadata.labels || {};
    return {
      name: n.metadata.name, ready: !!(ready && ready.status === 'True'), cordoned: !!n.spec.unschedulable,
      zone: l['topology.kubernetes.io/zone'] || l['failure-domain.beta.kubernetes.io/zone'] || null,
      pool: l['kubernetes.azure.com/agentpool'] || l['agentpool'] || null,
      maxPods: +((n.status && n.status.allocatable && n.status.allocatable.pods) || 0) || null,
      podCount: podCount[n.metadata.name] || 0
    };
  });
  return { env: env.name, label: env.label || env.name, context: env.context, production: !!env.production, deployments: outDeps, pods: outPods, nodes: outNodes, syncedAt: Date.now() };
}
