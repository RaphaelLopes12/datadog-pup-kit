import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigurationError, loadConfiguration } from './configuration/loadConfiguration.js';
import { PupClient } from './datadog/PupClient.js';
import { MonitorSignalSource } from './datadog/MonitorSignalSource.js';
import { ErrorLogSignalSource } from './datadog/ErrorLogSignalSource.js';
import { HistoryStore } from './monitoring/HistoryStore.js';
import { Watcher } from './monitoring/Watcher.js';
import { CursorAgentGateway } from './investigation/CursorAgentGateway.js';
import { InvestigationService } from './investigation/InvestigationService.js';
import { WindowsToastNotifier } from './notifications/WindowsToastNotifier.js';
import { DashboardServer } from './web/DashboardServer.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function openInBrowser(url) {
  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }, () => {});
  }
}

async function run() {
  const configurationPath = path.resolve(process.argv[2] ?? path.join(rootDirectory, 'config.json'));
  const configuration = await loadConfiguration(configurationPath);

  const pupClient = new PupClient({ executable: configuration.pupPath, leadingArguments: configuration.pupArguments });
  const sourceOptions = { pupClient, datadogAppUrl: configuration.datadogAppUrl };

  const historyStore = new HistoryStore(path.join(rootDirectory, 'data', 'history.json'));
  await historyStore.load();

  const dashboardUrl = `http://localhost:${configuration.port}`;
  const notifier = new WindowsToastNotifier({
    enabled: configuration.notifications.windowsToast,
    includeRecoveries: configuration.notifications.notifyOnRecovery,
    dashboardUrl
  });

  const watcher = new Watcher({
    services: configuration.services,
    signalSources: [new MonitorSignalSource(sourceOptions), new ErrorLogSignalSource(sourceOptions)],
    historyStore,
    notifier,
    intervalSeconds: configuration.pollIntervalSeconds
  });

  const investigations = new InvestigationService({
    gateway: new CursorAgentGateway(),
    pupClient,
    services: configuration.services,
    model: configuration.agent.model,
    maximumMinutes: configuration.agent.maximumMinutes,
    dataDirectory: path.join(rootDirectory, 'data')
  });
  await investigations.load();

  investigations.on('finished', (investigation) => {
    const outcome = investigation.status === 'finished' ? 'Investigação concluída' : 'Investigação interrompida';
    notifier.show(`${outcome}: ${investigation.serviceName}`, investigation.signalName);
  });

  watcher.on('failed', (error) => console.error(`Check failed: ${error.message}`));

  const server = new DashboardServer({
    port: configuration.port,
    publicDirectory: path.join(rootDirectory, 'public'),
    watcher,
    investigations,
    datadogAppUrl: configuration.datadogAppUrl
  });

  await server.listen();
  watcher.start();

  console.log(`Painel: ${server.url}`);
  console.log(`Vigiando ${configuration.services.length} serviço(s) a cada ${configuration.pollIntervalSeconds}s. Ctrl+C para parar.`);
  console.log(investigations.availability.available ? 'Agente: disponível.' : `Agente: indisponível. ${investigations.availability.reason}`);

  if (configuration.openBrowserOnStart) {
    openInBrowser(server.url);
  }
}

run().catch((error) => {
  if (error instanceof ConfigurationError) {
    console.error(error.message);
  } else if (error.code === 'EADDRINUSE') {
    console.error('A porta configurada já está em uso. O vigia já está rodando, ou troque "port" no config.json.');
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
