const MAX_ERRORS = 100;
const errorBuffer = [];

let _currentState = {
  currentDancer: null,
  currentSong: null,
  rotationActive: false,
};

export function updateSystemState(state) {
  _currentState = { ..._currentState, ...state };
}

export function trackError(type, message, context = {}) {
  const entry = {
    ts: Date.now(),
    type,
    message: String(message).slice(0, 500),
    currentDancer: context.currentDancer ?? _currentState.currentDancer,
    currentSong: context.currentSong ?? _currentState.currentSong,
    rotationActive: context.rotationActive ?? _currentState.rotationActive,
    component: context.component || type.split('_')[0],
    extra: context.extra || null,
  };
  errorBuffer.push(entry);
  if (errorBuffer.length > MAX_ERRORS) errorBuffer.shift();
  console.error(`[error-tracker] ${type}: ${message}`);
}

export function getAndClearErrors() {
  const errors = [...errorBuffer];
  errorBuffer.length = 0;
  return errors;
}

export function peekErrors() {
  return [...errorBuffer];
}
