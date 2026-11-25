import { EventEmitter } from 'node:events';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfiguration, normalizeServices } from './loadConfiguration.js';

export class SettingsStore extends EventEmitter {
  #filePath;
  #configuration = null;

  constructor(filePath) {
    super();
    this.#filePath = filePath;
  }

  async load() {
    this.#configuration = await loadConfiguration(this.#filePath);
    return this.#configuration;
  }

  get configuration() {
    return this.#configuration;
  }

  get services() {
    return this.#configuration.services;
  }

  async replaceServices(services) {
    this.#configuration = { ...this.#configuration, services: normalizeServices(services) };
    await this.#save();
    this.emit('changed');
  }

  async #save() {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.#configuration, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.#filePath);
  }
}
