import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildInvestigationPrompt } from './buildInvestigationPrompt.js';
import { createDatadogReadTool } from './datadogReadTool.js';

const maximumStored = 30;
const availabilityCacheMs = 30000;
const datadogToolName = 'datadog_read';

export class InvestigationUnavailableError extends Error {}

function summarizeArguments(value) {
  if (value === undefined || value === null) {
    return '';
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}

export class InvestigationService extends EventEmitter {
  #gateway;
  #pupClient;
  #services;
  #model;
  #maximumMinutes;
  #storagePath;
  #scratchDirectory;
  #investigations = [];
  #active = null;
  #availability = null;
  #availabilityCheckedAt = 0;

  constructor({ gateway, pupClient, services, model, maximumMinutes, dataDirectory }) {
    super();
    this.#gateway = gateway;
    this.#pupClient = pupClient;
    this.#services = services;
    this.#model = model;
    this.#maximumMinutes = maximumMinutes;
    this.#storagePath = path.join(dataDirectory, 'investigations.json');
    this.#scratchDirectory = path.join(dataDirectory, 'agent-workspace');
  }

  async load() {
    try {
      const stored = JSON.parse(await readFile(this.#storagePath, 'utf8'));
      this.#investigations = (Array.isArray(stored) ? stored : []).map((investigation) =>
        investigation.status === 'running' ? { ...investigation, status: 'error', error: 'O vigia foi encerrado durante a investigação.' } : investigation
      );
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
    await this.refreshAvailability();
  }

  get availability() {
    if (Date.now() - this.#availabilityCheckedAt > availabilityCacheMs) {
      this.refreshAvailability();
    }
    return this.#availability;
  }

  get investigations() {
    return this.#investigations.slice(0, 10);
  }

  async refreshAvailability() {
    this.#availabilityCheckedAt = Date.now();
    const next = await this.#gateway.availability();
    const changed = JSON.stringify(next) !== JSON.stringify(this.#availability);
    this.#availability = next;
    if (changed) {
      this.emit('changed');
    }
  }

  async login() {
    await this.#gateway.login();
    await this.refreshAvailability();
  }

  async start({ serviceName, signal }) {
    if (this.#active) {
      throw new InvestigationUnavailableError('Já existe uma investigação em andamento.');
    }

    await this.refreshAvailability();
    if (!this.#availability.available) {
      throw new InvestigationUnavailableError(this.#availability.reason);
    }

    const service = this.#services.find((candidate) => candidate.name === serviceName);
    if (!service) {
      throw new InvestigationUnavailableError(`Serviço não configurado: ${serviceName}`);
    }

    const investigation = {
      id: randomUUID(),
      serviceName,
      signalId: signal.id,
      signalName: signal.name,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      steps: [],
      draft: '',
      report: null,
      error: null,
      usage: null
    };

    this.#investigations = [investigation, ...this.#investigations].slice(0, maximumStored);
    this.#active = { investigation, cancel: null };
    this.emit('changed');

    this.#execute(investigation, service, signal);
    return investigation.id;
  }

  async cancel(investigationId) {
    if (this.#active?.investigation.id === investigationId && this.#active.cancel) {
      await this.#active.cancel();
    }
  }

  #addStep(investigation, label) {
    const step = { at: new Date().toISOString(), label, status: 'running' };
    investigation.steps.push(step);
    this.emit('changed');
    return step;
  }

  async #execute(investigation, service, signal) {
    let handle = null;
    let timer = null;

    try {
      await mkdir(this.#scratchDirectory, { recursive: true });

      const datadogTool = createDatadogReadTool({
        pupClient: this.#pupClient,
        onCall: ({ label, status }) => {
          const step = this.#addStep(investigation, label);
          step.status = status;
          return {
            finish: (finalStatus) => {
              step.status = finalStatus;
              this.emit('changed');
            }
          };
        }
      });

      handle = await this.#gateway.startRun({
        prompt: buildInvestigationPrompt({ service, signal, hasRepository: Boolean(service.repositoryPath) }),
        model: this.#model,
        repositoryPath: service.repositoryPath,
        workingDirectory: this.#scratchDirectory,
        customTools: { [datadogToolName]: datadogTool }
      });

      this.#active.cancel = () => handle.run.cancel();
      timer = setTimeout(() => handle.run.cancel(), this.#maximumMinutes * 60000);

      const stepsByCall = new Map();
      for await (const event of handle.run.stream()) {
        this.#consume(investigation, event, stepsByCall);
      }

      const result = await handle.run.wait();
      investigation.status = result.status;
      investigation.report = result.result ?? (investigation.draft || null);
      investigation.usage = result.usage ?? null;
      if (result.status === 'error') {
        investigation.error = result.error?.message ?? 'O agente terminou com erro.';
      }
      if (result.status === 'cancelled') {
        investigation.error = 'Investigação cancelada ou encerrada por tempo.';
      }
    } catch (error) {
      investigation.status = 'error';
      investigation.error = error.message;
    } finally {
      clearTimeout(timer);
      handle?.close();
      investigation.finishedAt = new Date().toISOString();
      investigation.draft = '';
      for (const step of investigation.steps) {
        if (step.status === 'running') {
          step.status = 'error';
        }
      }
      this.#active = null;
      await this.#save();
      this.emit('changed');
      this.emit('finished', investigation);
    }
  }

  #consume(investigation, event, stepsByCall) {
    if (event.type === 'assistant') {
      for (const block of event.message?.content ?? []) {
        if (block.type === 'text') {
          investigation.draft += block.text;
        }
      }
      this.emit('changed');
      return;
    }

    if (event.type !== 'tool_call' || String(event.name).includes(datadogToolName)) {
      return;
    }

    const existing = stepsByCall.get(event.call_id);
    if (existing) {
      existing.status = event.status;
      this.emit('changed');
      return;
    }

    const step = this.#addStep(investigation, `${event.name} ${summarizeArguments(event.args)}`.trim());
    step.status = event.status;
    stepsByCall.set(event.call_id, step);
  }

  async #save() {
    await mkdir(path.dirname(this.#storagePath), { recursive: true });
    const temporaryPath = `${this.#storagePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(this.#investigations, null, 2), 'utf8');
    await rename(temporaryPath, this.#storagePath);
  }
}
