import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { CommandRejectedError, createDatadogReadTool, validateCommand } from '../src/investigation/datadogReadTool.js';
import { buildInvestigationPrompt } from '../src/investigation/buildInvestigationPrompt.js';
import { InvestigationService, InvestigationUnavailableError } from '../src/investigation/InvestigationService.js';

const service = { name: 'svc', monitorTags: ['service:svc'], errorLogs: null, repositoryPath: null };
const signal = { id: 'monitor:1', kind: 'monitor', name: 'Latency', state: 'alert', since: '2026-01-01T00:00:00Z', query: 'q', detail: 'slow' };

test('accepts read commands and forces read-only mode', () => {
  assert.deepEqual(validateCommand(['logs', 'search', '--query=status:error', '--from=1h']), ['logs', 'search', '--query=status:error', '--from=1h', '--read-only']);
  assert.deepEqual(validateCommand(['monitors', 'get', '--help']), ['monitors', 'get', '--help', '--read-only']);
});

test('rejects write commands, unknown domains and unsafe flags', () => {
  const rejected = [
    ['monitors', 'delete', '123'],
    ['monitors', 'list', 'delete'],
    ['api-keys', 'list'],
    ['auth', 'token'],
    ['workflows', 'run', 'abc'],
    ['monitors'],
    ['monitors', 'list', '--yes'],
    ['logs', 'search', '--org', 'other'],
    ['logs', 'search', '--output=csv'],
    [],
    'monitors list'
  ];
  for (const command of rejected) {
    assert.throws(() => validateCommand(command), CommandRejectedError, JSON.stringify(command));
  }
});

test('the tool reports rejected commands to the agent instead of running them', async () => {
  const calls = [];
  const pupClient = { run: async (commandArguments) => calls.push(commandArguments) && { data: [] } };
  const tool = createDatadogReadTool({ pupClient });

  const refused = await tool.execute({ arguments: ['monitors', 'delete', '1'] });
  assert.equal(refused.isError, true);
  assert.equal(calls.length, 0);

  const allowed = await tool.execute({ arguments: ['monitors', 'list'] });
  assert.equal(allowed, '{"data":[]}');
  assert.deepEqual(calls[0], ['monitors', 'list', '--read-only']);
});

test('the prompt names the signal and adapts to a missing repository', () => {
  const withRepository = buildInvestigationPrompt({ service, signal, hasRepository: true });
  const withoutRepository = buildInvestigationPrompt({ service, signal, hasRepository: false });
  assert.match(withRepository, /monitor "Latency" do serviço svc está em alerta/);
  assert.match(withRepository, /neste repositório/);
  assert.doesNotMatch(withoutRepository, /neste repositório/);
});

function fakeGateway({ available = true, events = [], result }) {
  return {
    availability: async () => (available ? { available: true, canLogin: false, reason: null } : { available: false, canLogin: true, reason: 'Falta entrar na conta do Cursor.' }),
    startRun: async ({ customTools }) => ({
      close() {},
      run: {
        cancel: async () => {},
        async *stream() {
          await customTools.datadog_read.execute({ arguments: ['monitors', 'list'] });
          yield* events;
        },
        wait: async () => result
      }
    })
  };
}

async function createService(gateway) {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'watch-test-'));
  const investigations = new InvestigationService({
    gateway,
    pupClient: { run: async () => ({ data: [] }) },
    getServices: () => [service],
    model: 'm',
    maximumMinutes: 1,
    dataDirectory
  });
  await investigations.load();
  return { investigations, dataDirectory };
}

test('runs an investigation, records steps and stores the report', async () => {
  const { investigations, dataDirectory } = await createService(fakeGateway({
    events: [
      { type: 'tool_call', call_id: 'c1', name: 'grep', status: 'running', args: { pattern: 'Timeout' } },
      { type: 'tool_call', call_id: 'c1', name: 'grep', status: 'completed' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'parcial' }] } }
    ],
    result: { status: 'finished', result: 'Resumo: banco lento.', usage: { totalTokens: 10 } }
  }));

  await investigations.start({ serviceName: 'svc', signal });
  const [finished] = await once(investigations, 'finished');

  assert.equal(finished.status, 'finished');
  assert.equal(finished.report, 'Resumo: banco lento.');
  assert.deepEqual(finished.steps.map((step) => [step.label, step.status]), [
    ['pup monitors list', 'completed'],
    ['grep {"pattern":"Timeout"}', 'completed']
  ]);

  const stored = JSON.parse(await readFile(path.join(dataDirectory, 'investigations.json'), 'utf8'));
  assert.equal(stored[0].report, 'Resumo: banco lento.');
});

test('surfaces agent errors', async () => {
  const { investigations } = await createService(fakeGateway({ result: { status: 'error', error: { message: 'Invalid User API Key' } } }));
  await investigations.start({ serviceName: 'svc', signal });
  const [finished] = await once(investigations, 'finished');
  assert.equal(finished.status, 'error');
  assert.equal(finished.error, 'Invalid User API Key');
});

test('refuses to start when the agent is unavailable or busy', async () => {
  const unavailable = await createService(fakeGateway({ available: false }));
  await assert.rejects(unavailable.investigations.start({ serviceName: 'svc', signal }), InvestigationUnavailableError);

  const busy = await createService(fakeGateway({ result: { status: 'finished', result: 'ok' } }));
  await busy.investigations.start({ serviceName: 'svc', signal });
  await assert.rejects(busy.investigations.start({ serviceName: 'svc', signal }), InvestigationUnavailableError);
  await once(busy.investigations, 'finished');
});
