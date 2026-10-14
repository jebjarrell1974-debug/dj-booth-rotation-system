/**
 * Small, synchronous ownership token for competing playback operations.
 *
 * A newer operation invalidates every token issued before it. Callers still
 * need to check the token after awaits; this helper deliberately does not try
 * to cancel an AudioEngine operation that is already inside the browser.
 */
export function createPlaybackOwnership() {
  return { generation: 0, owner: null };
}

export function claimPlaybackOwnership(state, owner) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('playback ownership state is required');
  }
  state.generation += 1;
  const token = Object.freeze({ generation: state.generation, owner });
  state.owner = token;
  return token;
}

export function ownsPlaybackOperation(state, token) {
  return !!state
    && !!token
    && state.owner === token
    && state.generation === token.generation;
}

export function normalizePlaybackTrackName(value) {
  return String(value || '').toLowerCase().replace(/\.[^.]+$/, '').trim();
}

/**
 * Recovery must never retry the track that caused the watchdog. There is no
 * "use it if every alternative failed" branch: callers can decide how to
 * report an empty result without making the stuck track audible again.
 */
export function excludeFailedPlaybackTrack(tracks, failedTrackName) {
  const source = Array.isArray(tracks) ? tracks : [];
  const failed = normalizePlaybackTrackName(failedTrackName);
  if (!failed) return source;
  return source.filter(track => normalizePlaybackTrackName(track?.name) !== failed);
}

export function shouldHoldSkipTransition({ rotationActive = false, rotationCount = 0 } = {}) {
  return !!rotationActive && rotationCount > 0;
}

export function watchdogRecoveryOutcome({ owns = true, recovered = false } = {}) {
  if (!owns) return 'stale';
  return recovered ? 'success' : 'failed';
}

export function transitionRecoveryAction(fallbackSucceeded) {
  return fallbackSucceeded ? 'fallback' : 'leave-deck';
}