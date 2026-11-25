import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const defaults = {
  port: 4319,
  pollIntervalSeconds: 90,
  datadogAppUrl: 'https://app.datadoghq.com',
  pupPath: 'pup',
  pupArguments: [],
  openBrowserOnStart: false,
  notifications: { windowsToast: true, notifyOnRecovery: true },
  agent: { model: 'composer-2.5', maximumMinutes: 10 }
};

export class ConfigurationError extends Error {}

function requireCondition(condition, message) {
  if (!condition) {
    throw new ConfigurationError(message);
  }
}

function normalizeService(service, index) {
  const label = `services[${index}]`;
  requireCondition(service && typeof service.name === 'string' && service.name.trim(), `${label}.name is required`);

  const monitorTags = service.monitorTags ?? [];
  requireCondition(Array.isArray(monitorTags) && monitorTags.every((tag) => typeof tag === 'string'), `${label}.monitorTags must be a list of strings`);

  let errorLogs = null;
  if (service.errorLogs) {
    requireCondition(typeof service.errorLogs.query === 'string' && service.errorLogs.query.trim(), `${label}.errorLogs.query is required`);
    errorLogs = {
      query: service.errorLogs.query,
      windowMinutes: Number(service.errorLogs.windowMinutes ?? 15),
      threshold: Number(service.errorLogs.threshold ?? 20)
    };
    requireCondition(errorLogs.windowMinutes > 0, `${label}.errorLogs.windowMinutes must be positive`);
    requireCondition(errorLogs.threshold > 0, `${label}.errorLogs.threshold must be positive`);
  }

  requireCondition(monitorTags.length > 0 || errorLogs, `${label} needs monitorTags or errorLogs`);

  let repositoryPath = null;
  if (service.repositoryPath) {
    requireCondition(typeof service.repositoryPath === 'string' && existsSync(service.repositoryPath), `${label}.repositoryPath does not exist: ${service.repositoryPath}`);
    repositoryPath = service.repositoryPath;
  }

  return { name: service.name.trim(), monitorTags, errorLogs, repositoryPath };
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
  requireCondition(Array.isArray(merged.services) && merged.services.length > 0, 'services must list at least one service');

  return {
    ...merged,
    datadogAppUrl: String(merged.datadogAppUrl).replace(/\/+$/, ''),
    services: merged.services.map(normalizeService)
  };
}

export async function loadConfiguration(filePath) {
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new ConfigurationError(`Configuration file not found: ${filePath}. Copy config.example.json to config.json and edit it.`);
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
