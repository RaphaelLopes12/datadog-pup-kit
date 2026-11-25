import { EventEmitter } from 'node:events';
import { detectTransitions } from './detectTransitions.js';

const emptyView = (name) => ({ name, signals: [], errors: [] });

export class Watcher extends EventEmitter {
  #getServices;
  #signalSources;
  #historyStore;
  #notifier;
  #session;
  #intervalSeconds;
  #timer = null;
  #checking = false;
  #checkAgain = false;
  #checkedAt = null;
  #views = new Map();

  constructor({ getServices, signalSources, historyStore, notifier, session, intervalSeconds }) {
    super();
    this.#getServices = getServices;
    this.#signalSources = signalSources;
    this.#historyStore = historyStore;
    this.#notifier = notifier;
    this.#session = session;
    this.#intervalSeconds = intervalSeconds;
  }

  start() {
    this.check();
    this.#timer = setInterval(() => this.check(), this.#intervalSeconds * 1000);
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }

  snapshot() {
    return {
      checkedAt: this.#checkedAt,
      checking: this.#checking,
      intervalSeconds: this.#intervalSeconds,
      services: this.#getServices().map((service) => this.#views.get(service.name) ?? emptyView(service.name)),
      events: this.#historyStore.events.slice(0, 100)
    };
  }

  async check() {
    if (this.#checking) {
      this.#checkAgain = true;
      return;
    }

    this.#checking = true;
    this.emit('changed');

    try {
      const session = await this.#session.refresh();
      if (session.authenticated) {
        await this.#collect();
      }
    } catch (error) {
      this.emit('failed', error);
    } finally {
      this.#checking = false;
      this.emit('changed');
    }

    if (this.#checkAgain) {
      this.#checkAgain = false;
      this.check();
    }
  }

  async #collect() {
    const occurredAt = new Date().toISOString();
    const previousStates = this.#historyStore.states;
    const nextStates = {};
    const transitions = [];
    const views = new Map();

    for (const service of this.#getServices()) {
      const { freshSignals, ...view } = await this.#collectService(service, this.#views.get(service.name) ?? emptyView(service.name));
      views.set(service.name, view);

      transitions.push(...detectTransitions({ serviceName: service.name, signals: freshSignals, previousStates, occurredAt }));
      for (const signal of freshSignals) {
        nextStates[signal.id] = signal.state;
      }
    }

    this.#views = views;
    this.#checkedAt = occurredAt;
    await this.#historyStore.record({ states: nextStates, transitions });

    if (transitions.length > 0) {
      await this.#notifier.notify(transitions);
    }
  }

  async #collectService(service, previousView) {
    const sources = this.#signalSources.filter((source) => source.appliesTo(service));
    const results = await Promise.allSettled(sources.map((source) => source.collect(service)));

    const signals = [];
    const freshSignals = [];
    const errors = [];

    results.forEach((result, index) => {
      const source = sources[index];
      if (result.status === 'fulfilled') {
        signals.push(...result.value);
        freshSignals.push(...result.value);
        return;
      }
      errors.push(result.reason?.message ?? String(result.reason));
      signals.push(...previousView.signals.filter((signal) => signal.kind === source.kind).map((signal) => ({ ...signal, stale: true })));
    });

    return { name: service.name, signals, errors, freshSignals };
  }
}
