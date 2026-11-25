import { EventEmitter } from 'node:events';

const loginTimeoutMs = 5 * 60 * 1000;

export class DatadogSession extends EventEmitter {
  #pupClient;
  #status = { installed: true, authenticated: false, loggingIn: false, site: null, message: null };
  #loginInProgress = null;

  constructor({ pupClient }) {
    super();
    this.#pupClient = pupClient;
  }

  get status() {
    return this.#status;
  }

  async refresh() {
    let next;
    try {
      const response = await this.#pupClient.run(['auth', 'status']);
      next = {
        installed: true,
        authenticated: response?.authenticated === true,
        site: response?.site ?? null,
        message: response?.authenticated === true ? null : 'Falta entrar no Datadog.'
      };
    } catch (error) {
      next = {
        installed: !error.notInstalled,
        authenticated: false,
        site: null,
        message: error.notInstalled ? 'O pup não está instalado.' : error.message
      };
    }

    this.#update({ ...next, loggingIn: this.#loginInProgress !== null });
    return this.#status;
  }

  login() {
    if (!this.#loginInProgress) {
      this.#loginInProgress = this.#pupClient
        .runText(['auth', 'login', '--read-only'], { timeoutMs: loginTimeoutMs })
        .catch((error) => {
          this.#update({ ...this.#status, message: `O login no Datadog falhou: ${error.message}` });
        })
        .finally(async () => {
          this.#loginInProgress = null;
          await this.refresh();
          this.emit('loggedIn');
        });
      this.#update({ ...this.#status, loggingIn: true });
    }
    return this.#loginInProgress;
  }

  #update(next) {
    const changed = JSON.stringify(next) !== JSON.stringify(this.#status);
    this.#status = next;
    if (changed) {
      this.emit('changed');
    }
  }
}
