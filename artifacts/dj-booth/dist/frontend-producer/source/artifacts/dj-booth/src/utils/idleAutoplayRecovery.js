export const IDLE_AUTOPLAY_START_MODES = Object.freeze({
  BLOCKED: 'blocked',
  QUEUE: 'queue',
  AUTOFILL: 'autofill',
});

/**
 * Decide whether an idle starter may begin playback.
 *
 * A non-empty manual queue is authoritative even when AutoFill is disabled.
 * An empty queue may only be filled when AutoFill and hydrated automatic
 * history are both enabled. Rotation and an explicit pause always win.
 */
export function getIdleAutoplayStartMode({
  hasQueue = false,
  autoFillEnabled = false,
  historyReady = false,
  rotationActive = false,
  paused = false,
} = {}) {
  if (paused || rotationActive) return IDLE_AUTOPLAY_START_MODES.BLOCKED;
  if (hasQueue) return IDLE_AUTOPLAY_START_MODES.QUEUE;
  if (autoFillEnabled && historyReady) return IDLE_AUTOPLAY_START_MODES.AUTOFILL;
  return IDLE_AUTOPLAY_START_MODES.BLOCKED;
}

/**
 * Startup may latch its library only after the shared idle starter actually
 * plays a track. Explicitly paused/manual-off empty-queue states are held,
 * rather than retried or replaced with a random library starter.
 */
export function getColdAutoplayStartupDecision({
  hasTracks = false,
  startMode = IDLE_AUTOPLAY_START_MODES.BLOCKED,
  playbackSucceeded = false,
} = {}) {
  if (!hasTracks) return 'retry';
  if (startMode === IDLE_AUTOPLAY_START_MODES.BLOCKED) return 'hold';
  return playbackSucceeded ? 'ready' : 'retry';
}