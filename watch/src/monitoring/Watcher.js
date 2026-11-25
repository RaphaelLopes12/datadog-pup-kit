import { EventEmitter } from 'node:events';
import { detectTransitions } from './detectTransitions.js';

export class Watcher extends EventEmitter {
  #services;
  #signalSources;
  #historyStore;
  #notifier;
  #intervalSeconds;
  #timer = null;
  #checking = false;
  #checkedAt = null;
  #serviceViews;

  constructor({ services, signalSources, historyStore, notifier, intervalSeconds }) {
    super();
    this.#services = services;
    this.#signalSources = signalSources;
    this.#historyStore = historyStore;
    this.#notifier = notifier;
    this.#intervalSeconds = intervalSeconds;
    this.#serviceViews = services.map((service) => ({ name: service.name, signals: [], errors: [] }));
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
      services: this.#serviceViews,
      events: this.#historyStore.events.slice(0, 100)
    };
  }

  async check() {
    if (this.#checking) {
      return;
    }

    this.#checking = true;
    this.emit('changed');

    try {
      const occurredAt = new Date().toISOString();
      const previousStates = this.#historyStore.states;
      const nextStates = {};
      const transitions = [];
      const views = [];

      for (const [index, service] of this.#services.entries()) {
        const view = await this.#collectService(service, this.#serviceViews[index]);
        views.push(view);

        transitions.push(...detectTransitions({ serviceName: service.name, signals: view.freshSignals, previousStates, occurredAt }));
        for (const signal of view.freshSignals) {
          nextStates[signal.id] = signal.state;
        }
      }

      this.#serviceViews = views.map(({ freshSignals, ...view }) => view);
      this.#checkedAt = occurredAt;
      await this.#historyStore.record({ states: nextStates, transitions });

      if (transitions.length > 0) {
        await this.#notifier.notify(transitions);
      }
    } catch (error) {
      this.emit('failed', error);
    } finally {
      this.#checking = false;
      this.emit('changed');
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
