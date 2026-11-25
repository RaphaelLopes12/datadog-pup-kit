export const SignalState = Object.freeze({
  Alert: 'alert',
  Warn: 'warn',
  NoData: 'nodata',
  Unknown: 'unknown',
  Ok: 'ok'
});

const firingStates = new Set([SignalState.Alert, SignalState.Warn, SignalState.NoData]);

export function isFiring(state) {
  return firingStates.has(state);
}
