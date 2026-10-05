import { test } from 'node:test';
import assert from 'node:assert/strict';
import { podStatus, normalizeEnv } from '../src/sources/k8s.js';

const pod = (over = {}) => ({ metadata: { name: 'p1', namespace: 'ns', labels: { app: 'a' }, ...over.metadata }, spec: { nodeName: 'n1', containers: [{ image: 'r.io/a:t1' }] }, status: { phase: 'Running', containerStatuses: [{ ready: true, restartCount: 2, state: { running: {} } }], ...over.status } });

test('pod status mapping', () => {
  assert.equal(podStatus(pod()), 'Running');
  assert.equal(podStatus(pod({ metadata: { deletionTimestamp: 'x' } })), 'Terminating');
  assert.equal(podStatus(pod({ status: { phase: 'Running', containerStatuses: [{ ready: false, restartCount: 5, state: { waiting: { reason: 'CrashLoopBackOff' } } }] } })), 'CrashLoopBackOff');
  assert.equal(podStatus(pod({ status: { phase: 'Pending', containerStatuses: [] } })), 'Pending');
  assert.equal(podStatus(pod({ status: { phase: 'Pending', containerStatuses: [{ ready: false, state: { waiting: { reason: 'ContainerCreating' } } }] } })), 'ContainerCreating');
});

test('normalizeEnv links pods to deployments by selector and detects rollouts', () => {
  const dep = { metadata: { name: 'a', namespace: 'ns', generation: 3, annotations: { 'repo-yard/commit': 'abc1234' } }, spec: { replicas: 2, selector: { matchLabels: { app: 'a' } }, template: { metadata: {}, spec: { containers: [{ image: 'r.io/a:t2' }] } } },
    status: { observedGeneration: 3, replicas: 3, updatedReplicas: 1, readyReplicas: 2, conditions: [{ type: 'Progressing', status: 'True', reason: 'ReplicaSetUpdated' }] } };
  const e = normalizeEnv({ name: 'prod', context: 'c', production: true }, [dep], [pod(), pod({ metadata: { name: 'other', labels: { app: 'b' } } })], [{ metadata: { name: 'n1', labels: { 'topology.kubernetes.io/zone': 'eastus-1' } }, spec: { unschedulable: true }, status: { conditions: [{ type: 'Ready', status: 'True' }] } }]);
  const d = e.deployments[0];
  assert.deepEqual(d.pods, ['p1']);
  assert.equal(d.rolling, true);
  assert.equal(d.imageInfo.tag, 't2');
  assert.equal(d.annotations['repo-yard/commit'], 'abc1234');
  assert.equal(e.nodes[0].cordoned, true);
  assert.equal(e.nodes[0].podCount, 2);
  assert.equal(e.pods[0].restarts, 2);
});
