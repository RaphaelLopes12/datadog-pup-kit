import { SignalState } from '../monitoring/SignalState.js';

function findBuckets(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) {
    return null;
  }
  if (Array.isArray(node.buckets)) {
    return node.buckets;
  }
  for (const value of Object.values(node)) {
    const found = findBuckets(value, depth + 1);
    if (found) {
      return found;
    }
  }
  return null;
}

export function extractCount(response) {
  const buckets = findBuckets(response);
  if (!buckets) {
    return null;
  }

  let total = 0;
  for (const bucket of buckets) {
    const value = Object.values(bucket?.computes ?? {}).find((candidate) => typeof candidate === 'number');
    if (typeof value === 'number') {
      total += value;
    }
  }
  return total;
}

export class ErrorLogSignalSource {
  #pupClient;
  #datadogAppUrl;

  constructor({ pupClient, datadogAppUrl }) {
    this.#pupClient = pupClient;
    this.#datadogAppUrl = datadogAppUrl;
  }

  get kind() {
    return 'errorLogs';
  }

  appliesTo(service) {
    return service.errorLogs !== null;
  }

  async collect(service) {
    const { query, windowMinutes, threshold } = service.errorLogs;
    const response = await this.#pupClient.run(['logs', 'aggregate', `--query=${query}`, `--from=${windowMinutes}min`, '--compute=count']);
    const count = extractCount(response);

    const signal = {
      id: `errorLogs:${service.name}`,
      kind: 'errorLogs',
      name: `Erros em log (${windowMinutes} min)`,
      since: null,
      query,
      url: `${this.#datadogAppUrl}/logs?query=${encodeURIComponent(query)}`
    };

    if (count === null) {
      return [{ ...signal, state: SignalState.Unknown, detail: 'Não reconheci o formato da resposta do pup logs aggregate.' }];
    }

    return [{
      ...signal,
      state: count >= threshold ? SignalState.Alert : SignalState.Ok,
      detail: `${count} erros nos últimos ${windowMinutes} min (limite ${threshold})`,
      value: count,
      threshold
    }];
  }
}
