import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectTransitions } from '../src/monitoring/detectTransitions.js';
import { extractCount } from '../src/datadog/ErrorLogSignalSource.js';
import { toSignalState } from '../src/datadog/MonitorSignalSource.js';
import { describeTransitions } from '../src/notifications/describeTransitions.js';
import { normalizeConfiguration, ConfigurationError } from '../src/configuration/loadConfiguration.js';

const signal = (id, state) => ({ id, kind: 'monitor', name: id, state });
const detect = (signals, previousStates) => detectTransitions({ serviceName: 'svc', signals, previousStates, occurredAt: '2026-01-01T00:00:00Z' });

test('reports a signal that starts firing', () => {
  const [transition] = detect([signal('a', 'alert')], { a: 'ok' });
  assert.equal(transition.from, 'ok');
  assert.equal(transition.to, 'alert');
});

test('reports signals already firing on the first check', () => {
  assert.equal(detect([signal('a', 'warn')], {}).length, 1);
});

test('stays silent when nothing changed', () => {
  assert.equal(detect([signal('a', 'alert'), signal('b', 'ok')], { a: 'alert', b: 'ok' }).length, 0);
});

test('stays silent for healthy signals seen for the first time', () => {
  assert.equal(detect([signal('a', 'ok')], {}).length, 0);
});

test('reports recovery only after a firing state', () => {
  assert.equal(detect([signal('a', 'ok')], { a: 'alert' }).length, 1);
  assert.equal(detect([signal('a', 'ok')], { a: 'unknown' }).length, 0);
});

test('maps Datadog monitor states', () => {
  assert.equal(toSignalState('Alert'), 'alert');
  assert.equal(toSignalState('No Data'), 'nodata');
  assert.equal(toSignalState('OK'), 'ok');
  assert.equal(toSignalState('Skipped'), 'unknown');
});

test('extracts the count from enveloped and raw aggregate responses', () => {
  assert.equal(extractCount({ data: { data: { buckets: [{ computes: { c0: 7 } }] } } }), 7);
  assert.equal(extractCount({ data: { buckets: [{ computes: { c0: 2 } }, { computes: { c0: 3 } }] } }), 5);
  assert.equal(extractCount({ data: { buckets: [] } }), 0);
  assert.equal(extractCount({ data: [] }), null);
});

test('summarizes several transitions in one notification', () => {
  const transitions = [
    { serviceName: 'a', signalName: 'x', to: 'alert' },
    { serviceName: 'b', signalName: 'y', to: 'ok' }
  ];
  assert.deepEqual(describeTransitions(transitions, { includeRecoveries: true }), { title: 'Datadog: 1 disparando, 1 normalizados', message: 'a, b' });
  assert.equal(describeTransitions([transitions[1]], { includeRecoveries: false }), null);
});

test('rejects a service without any signal configured', () => {
  assert.throws(() => normalizeConfiguration({ services: [{ name: 'svc' }] }), ConfigurationError);
});

test('starts with no services and rejects duplicated names', () => {
  assert.deepEqual(normalizeConfiguration({}).services, []);
  const duplicated = [{ name: 'svc', monitorTags: ['a'] }, { name: 'SVC', monitorTags: ['b'] }];
  assert.throws(() => normalizeConfiguration({ services: duplicated }), ConfigurationError);
});
