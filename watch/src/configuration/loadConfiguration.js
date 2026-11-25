import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const defaults = {
  port: 4319,
  pollIntervalSeconds: 90,
  datadogAppUrl: 'https://app.datadoghq.com',
  pupPath: 'pup',
  pupArguments: [],
  openBrowserOnStart: true,
  notifications: { windowsToast: true, notifyOnRecovery: true },
  agent: { model: 'composer-2.5', maximumMinutes: 10 },
  services: []
};

export class ConfigurationError extends Error {}

function requireCondition(condition, message) {
  if (!condition) {
    throw new ConfigurationError(message);
  }
}

export function normalizeService(service, index) {
  const label = typeof service?.name === 'string' && service.name.trim() ? `Serviço "${service.name.trim()}"` : `Serviço ${index + 1}`;
  requireCondition(service && typeof service.name === 'string' && service.name.trim(), `${label}: informe o nome.`);

  const monitorTags = (service.monitorTags ?? []).map((tag) => String(tag).trim()).filter(Boolean);

  let errorLogs = null;
  if (service.errorLogs && String(service.errorLogs.query ?? '').trim()) {
    errorLogs = {
      query: String(service.errorLogs.query).trim(),
      windowMinutes: Number(service.errorLogs.windowMinutes ?? 15),
      threshold: Number(service.errorLogs.threshold ?? 20)
    };
    requireCondition(errorLogs.windowMinutes > 0, `${label}: a janela de erros precisa ser maior que zero.`);
    requireCondition(errorLogs.threshold > 0, `${label}: o limite de erros precisa ser maior que zero.`);
  }

  requireCondition(monitorTags.length > 0 || errorLogs, `${label}: informe as tags dos monitors ou uma query de erros.`);

  let repositoryPath = null;
  const requestedPath = String(service.repositoryPath ?? '').trim();
  if (requestedPath) {
    requireCondition(existsSync(requestedPath), `${label}: a pasta do repositório não existe (${requestedPath}).`);
    repositoryPath = requestedPath;
  }

  return { name: service.name.trim(), monitorTags, errorLogs, repositoryPath };
}

export function normalizeServices(services) {
  requireCondition(Array.isArray(services), 'A lista de serviços é inválida.');
  const normalized = services.map(normalizeService);
  const names = normalized.map((service) => service.name.toLowerCase());
  requireCondition(new Set(names).size === names.length, 'Há serviços com o mesmo nome.');
  return normalized;
}

export function normalizeConfiguration(raw) {
  const merged = {
    ...defaults,
    ...raw,
    notifications: { ...defaults.notifications, ...(raw.notifications ?? {}) },
    agent: { ...defaults.agent, ...(raw.agent ?? {}) }
  };

  requireCondition(Number.isInteger(merged.port) && merged.port > 0 && merged.port < 65536, 'port must be a valid TCP port');
  requireCondition(merged.pollIntervalSeconds >= 30, 'pollIntervalSeconds must be at least 30');
  requireCondition(typeof merged.agent.model === 'string' && merged.agent.model.trim(), 'agent.model is required');
  requireCondition(merged.agent.maximumMinutes > 0, 'agent.maximumMinutes must be positive');

  return {
    ...merged,
    datadogAppUrl: String(merged.datadogAppUrl).replace(/\/+$/, ''),
    services: normalizeServices(merged.services)
  };
}

export async function loadConfiguration(filePath) {
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return normalizeConfiguration({});
    }
    throw error;
  }

  let raw;
  try {
    raw = JSON.parse(content.replace(/^﻿/, ''));
  } catch (error) {
    throw new ConfigurationError(`Configuration file is not valid JSON: ${error.message}`);
  }

  return normalizeConfiguration(raw);
}
