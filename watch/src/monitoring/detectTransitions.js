import { SignalState, isFiring } from './SignalState.js';

export function detectTransitions({ serviceName, signals, previousStates, occurredAt }) {
  const transitions = [];

  for (const signal of signals) {
    const previous = previousStates[signal.id] ?? null;
    if (previous === signal.state) {
      continue;
    }

    const startedFiring = isFiring(signal.state);
    const recovered = signal.state === SignalState.Ok && previous !== null && isFiring(previous);
    if (!startedFiring && !recovered) {
      continue;
    }

    transitions.push({
      at: occurredAt,
      serviceName,
      signalId: signal.id,
      signalName: signal.name,
      kind: signal.kind,
      from: previous,
      to: signal.state,
      detail: signal.detail ?? '',
      url: signal.url ?? null
    });
  }

  return transitions;
}
