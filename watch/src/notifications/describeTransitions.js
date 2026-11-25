import { SignalState, isFiring } from '../monitoring/SignalState.js';

const stateLabels = {
  [SignalState.Alert]: 'em alerta',
  [SignalState.Warn]: 'em aviso',
  [SignalState.NoData]: 'sem dados',
  [SignalState.Ok]: 'voltou ao normal',
  [SignalState.Unknown]: 'em estado desconhecido'
};

export function describeTransitions(transitions, { includeRecoveries }) {
  const relevant = transitions.filter((transition) => isFiring(transition.to) || includeRecoveries);
  if (relevant.length === 0) {
    return null;
  }

  if (relevant.length === 1) {
    const [transition] = relevant;
    return {
      title: `${transition.serviceName}: ${stateLabels[transition.to]}`,
      message: transition.signalName
    };
  }

  const firing = relevant.filter((transition) => isFiring(transition.to));
  const recovered = relevant.length - firing.length;
  const services = [...new Set(relevant.map((transition) => transition.serviceName))];
  const parts = [];
  if (firing.length > 0) {
    parts.push(`${firing.length} disparando`);
  }
  if (recovered > 0) {
    parts.push(`${recovered} normalizados`);
  }

  return {
    title: `Datadog: ${parts.join(', ')}`,
    message: services.join(', ')
  };
}
