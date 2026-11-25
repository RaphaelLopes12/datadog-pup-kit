import { SignalState } from '../monitoring/SignalState.js';

const stateByMonitorStatus = {
  'alert': SignalState.Alert,
  'warn': SignalState.Warn,
  'no data': SignalState.NoData,
  'ok': SignalState.Ok
};

export function toSignalState(overallState) {
  return stateByMonitorStatus[String(overallState ?? '').toLowerCase()] ?? SignalState.Unknown;
}

export function toMonitorSignal(monitor, datadogAppUrl) {
  return {
    id: `monitor:${monitor.id}`,
    kind: 'monitor',
    name: monitor.name ?? `Monitor ${monitor.id}`,
    state: toSignalState(monitor.overall_state),
    since: monitor.overall_state_modified ?? null,
    detail: monitor.message ?? '',
    query: monitor.query ?? '',
    url: `${datadogAppUrl}/monitors/${monitor.id}`
  };
}

export class MonitorSignalSource {
  #pupClient;
  #datadogAppUrl;

  constructor({ pupClient, datadogAppUrl }) {
    this.#pupClient = pupClient;
    this.#datadogAppUrl = datadogAppUrl;
  }

  get kind() {
    return 'monitor';
  }

  appliesTo(service) {
    return service.monitorTags.length > 0;
  }

  async collect(service) {
    const response = await this.#pupClient.run(['monitors', 'list', `--tags=${service.monitorTags.join(',')}`, '--limit=200']);
    const monitors = Array.isArray(response?.data) ? response.data : [];
    return monitors.map((monitor) => toMonitorSignal(monitor, this.#datadogAppUrl));
  }
}
