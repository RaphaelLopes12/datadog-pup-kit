import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const maximumEvents = 300;

export class HistoryStore {
  #filePath;
  #states = {};
  #events = [];

  constructor(filePath) {
    this.#filePath = filePath;
  }

  async load() {
    try {
      const stored = JSON.parse(await readFile(this.#filePath, 'utf8'));
      this.#states = stored.states ?? {};
      this.#events = Array.isArray(stored.events) ? stored.events : [];
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }

  get states() {
    return this.#states;
  }

  get events() {
    return this.#events;
  }

  async record({ states, transitions }) {
    this.#states = { ...this.#states, ...states };
    if (transitions.length > 0) {
      this.#events = [...transitions.slice().reverse(), ...this.#events].slice(0, maximumEvents);
    }
    await this.#save();
  }

  async #save() {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ states: this.#states, events: this.#events }, null, 2), 'utf8');
    await rename(temporaryPath, this.#filePath);
  }
}
