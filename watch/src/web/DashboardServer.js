import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const staticFiles = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/dashboard.css': { file: 'dashboard.css', type: 'text/css; charset=utf-8' },
  '/dashboard.js': { file: 'dashboard.js', type: 'text/javascript; charset=utf-8' }
};

export class DashboardServer {
  #port;
  #publicDirectory;
  #watcher;
  #datadogAppUrl;
  #server;
  #subscribers = new Set();

  constructor({ port, publicDirectory, watcher, datadogAppUrl }) {
    this.#port = port;
    this.#publicDirectory = publicDirectory;
    this.#watcher = watcher;
    this.#datadogAppUrl = datadogAppUrl;
    this.#server = createServer((request, response) => this.#handle(request, response));
    this.#watcher.on('changed', () => this.#broadcast());
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
    return { ...this.#watcher.snapshot(), datadogAppUrl: this.#datadogAppUrl };
  }

  #isLocalRequest(request) {
    const host = String(request.headers.host ?? '');
    return host === `localhost:${this.#port}` || host === `127.0.0.1:${this.#port}`;
  }

  async #handle(request, response) {
    if (!this.#isLocalRequest(request)) {
      response.writeHead(403).end();
      return;
    }

    const { pathname } = new URL(request.url, this.url);

    if (request.method === 'GET' && pathname === '/api/state') {
      this.#sendJson(response, 200, this.#state());
      return;
    }

    if (request.method === 'GET' && pathname === '/api/events') {
      this.#subscribe(request, response);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/check') {
      this.#watcher.check();
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

  #sendJson(response, status, body) {
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

  #broadcast() {
    const payload = `data: ${JSON.stringify(this.#state())}\n\n`;
    for (const subscriber of this.#subscribers) {
      subscriber.write(payload);
    }
  }
}
