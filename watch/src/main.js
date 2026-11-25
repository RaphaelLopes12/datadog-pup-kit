import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigurationError } from './configuration/loadConfiguration.js';
import { SettingsStore } from './configuration/SettingsStore.js';
import { PupClient } from './datadog/PupClient.js';
import { DatadogSession } from './datadog/DatadogSession.js';
import { MonitorSignalSource } from './datadog/MonitorSignalSource.js';
import { ErrorLogSignalSource } from './datadog/ErrorLogSignalSource.js';
import { HistoryStore } from './monitoring/HistoryStore.js';
import { Watcher } from './monitoring/Watcher.js';
import { CursorAgentGateway } from './investigation/CursorAgentGateway.js';
import { InvestigationService } from './investigation/InvestigationService.js';
import { WindowsToastNotifier } from './notifications/WindowsToastNotifier.js';
import { DashboardServer } from './web/DashboardServer.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultPort = 4319;

function openInBrowser(url) {
  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }, () => {});
  }
}

async function run() {
  const settings = new SettingsStore(path.resolve(process.argv[2] ?? path.join(rootDirectory, 'config.json')));
  const configuration = await settings.load();
  const getServices = () => settings.services;

  const pupClient = new PupClient({ executable: configuration.pupPath, leadingArguments: configuration.pupArguments });
  const session = new DatadogSession({ pupClient });
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
    getServices,
    signalSources: [new MonitorSignalSource(sourceOptions), new ErrorLogSignalSource(sourceOptions)],
    historyStore,
    notifier,
    session,
    intervalSeconds: configuration.pollIntervalSeconds
  });

  const investigations = new InvestigationService({
    gateway: new CursorAgentGateway(),
    pupClient,
    getServices,
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
  settings.on('changed', () => watcher.check());
  session.on('loggedIn', () => watcher.check());

  const server = new DashboardServer({
    port: configuration.port,
    publicDirectory: path.join(rootDirectory, 'public'),
    watcher,
    investigations,
    session,
    settings,
    datadogAppUrl: configuration.datadogAppUrl
  });

  await server.listen();
  watcher.start();

  console.log(`Painel: ${server.url}`);
  console.log('Deixe esta janela aberta. Feche a janela ou use Ctrl+C para parar o vigia.');

  if (configuration.openBrowserOnStart) {
    openInBrowser(server.url);
  }
}

run().catch((error) => {
  if (error instanceof ConfigurationError) {
    console.error(error.message);
  } else if (error.code === 'EADDRINUSE') {
    console.error('O vigia já está rodando. Abrindo o painel.');
    openInBrowser(`http://localhost:${error.port ?? defaultPort}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
