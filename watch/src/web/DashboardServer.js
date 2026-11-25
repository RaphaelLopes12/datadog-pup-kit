import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ConfigurationError } from '../configuration/loadConfiguration.js';
import { InvestigationUnavailableError } from '../investigation/InvestigationService.js';

const staticFiles = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/dashboard.css': { file: 'dashboard.css', type: 'text/css; charset=utf-8' },
  '/dashboard.js': { file: 'dashboard.js', type: 'text/javascript; charset=utf-8' }
};

const broadcastIntervalMs = 250;
const maximumBodyBytes = 256 * 1024;

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximumBodyBytes) {
        reject(new Error('Request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Request body is not valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

export class DashboardServer {
  #port;
  #publicDirectory;
  #watcher;
  #investigations;
  #session;
  #settings;
  #datadogAppUrl;
  #server;
  #subscribers = new Set();
  #broadcastTimer = null;

  constructor({ port, publicDirectory, watcher, investigations, session, settings, datadogAppUrl }) {
    this.#port = port;
    this.#publicDirectory = publicDirectory;
    this.#watcher = watcher;
    this.#investigations = investigations;
    this.#session = session;
    this.#settings = settings;
    this.#datadogAppUrl = datadogAppUrl;
    this.#server = createServer((request, response) => {
      this.#handle(request, response).catch((error) => this.#sendJson(response, 500, { error: error.message }));
    });
    this.#watcher.on('changed', () => this.#scheduleBroadcast());
    this.#investigations.on('changed', () => this.#scheduleBroadcast());
    this.#session.on('changed', () => this.#scheduleBroadcast());
    this.#settings.on('changed', () => this.#scheduleBroadcast());
  }

  get url() {
    return `http://localhost:${this.#port}`;
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(this.#port, '127.0.0.1', resolve);
    });
  }

  #state() {
    return {
      ...this.#watcher.snapshot(),
      datadogAppUrl: this.#datadogAppUrl,
      datadog: this.#session.status,
      settings: { services: this.#settings.services },
      agent: this.#investigations.availability,
      investigations: this.#investigations.investigations
    };
  }

  #isLocalRequest(request) {
    const host = String(request.headers.host ?? '');
    const hostIsLocal = host === `localhost:${this.#port}` || host === `127.0.0.1:${this.#port}`;
    const origin = request.headers.origin;
    const originIsLocal = !origin || origin === `http://localhost:${this.#port}` || origin === `http://127.0.0.1:${this.#port}`;
    return hostIsLocal && originIsLocal;
  }

  #findSignal(serviceName, signalId) {
    const service = this.#watcher.snapshot().services.find((candidate) => candidate.name === serviceName);
    return service?.signals.find((signal) => signal.id === signalId) ?? null;
  }

  async #handle(request, response) {
    if (!this.#isLocalRequest(request)) {
      response.writeHead(403).end();
      return;
    }

    const { pathname } = new URL(request.url, this.url);
    const route = `${request.method} ${pathname}`;

    if (route === 'GET /api/state') {
      this.#sendJson(response, 200, this.#state());
      return;
    }

    if (route === 'GET /api/events') {
      this.#subscribe(request, response);
      return;
    }

    if (route === 'POST /api/check') {
      this.#watcher.check();
      this.#sendJson(response, 202, { accepted: true });
      return;
    }

    if (route === 'POST /api/datadog/login') {
      this.#session.login();
      this.#sendJson(response, 202, { accepted: true });
      return;
    }

    if (route === 'PUT /api/settings/services') {
      await this.#replaceServices(request, response);
      return;
    }

    if (route === 'POST /api/agent/login') {
      this.#investigations.login().catch((error) => console.error(`Cursor login failed: ${error.message}`));
      this.#sendJson(response, 202, { accepted: true });
      return;
    }

    if (route === 'POST /api/investigations') {
      await this.#startInvestigation(request, response);
      return;
    }

    const cancelMatch = /^\/api\/investigations\/([0-9a-f-]{36})\/cancel$/.exec(pathname);
    if (request.method === 'POST' && cancelMatch) {
      await this.#investigations.cancel(cancelMatch[1]);
      this.#sendJson(response, 202, { accepted: true });
      return;
    }

    const asset = staticFiles[pathname];
    if (request.method === 'GET' && asset) {
      const content = await readFile(path.join(this.#publicDirectory, asset.file));
      response.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-store' });
      response.end(content);
      return;
    }

    response.writeHead(404).end();
  }

  async #replaceServices(request, response) {
    try {
      const body = await readJsonBody(request);
      await this.#settings.replaceServices(body.services);
      this.#sendJson(response, 200, { services: this.#settings.services });
    } catch (error) {
      if (error instanceof ConfigurationError || !error.code) {
        this.#sendJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
  }

  async #startInvestigation(request, response) {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      this.#sendJson(response, 400, { error: error.message });
      return;
    }

    const signal = this.#findSignal(body.serviceName, body.signalId);
    if (!signal) {
      this.#sendJson(response, 404, { error: 'Sinal não encontrado. Atualize o painel e tente de novo.' });
      return;
    }

    try {
      const id = await this.#investigations.start({ serviceName: body.serviceName, signal });
      this.#sendJson(response, 202, { id });
    } catch (error) {
      if (error instanceof InvestigationUnavailableError) {
        this.#sendJson(response, 409, { error: error.message });
        return;
      }
      throw error;
    }
  }

  #sendJson(response, status, body) {
    if (response.headersSent) {
      response.end();
      return;
    }
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  }

  #subscribe(request, response) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive'
    });
    response.write(`data: ${JSON.stringify(this.#state())}\n\n`);
    this.#subscribers.add(response);
    request.on('close', () => this.#subscribers.delete(response));
  }

  #scheduleBroadcast() {
    if (this.#broadcastTimer) {
      return;
    }
    this.#broadcastTimer = setTimeout(() => {
      this.#broadcastTimer = null;
      const payload = `data: ${JSON.stringify(this.#state())}\n\n`;
      for (const subscriber of this.#subscribers) {
        subscriber.write(payload);
      }
    }, broadcastIntervalMs);
  }
}
