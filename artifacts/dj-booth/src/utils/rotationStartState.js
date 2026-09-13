/**
 * What the Start/Stop control should say, derived from AUTHORITATIVE kiosk state plus
 * one local "we just pressed it" flag.
 *
 * The operator reported pressing Start and seeing nothing change, then pressing Skip
 * and having the rotation begin. That is because starting is deliberately deferred:
 * the kiosk sets `rotationPending` and waits for the current song to finish
 * (`if (isPlaying) { rotationPendingRef.current = true; return; }`). The command really
 * did apply - it was the feedback that was missing, and pressing Skip merely ended the
 * song the rotation was waiting for.
 *
 * Rules:
 *  - never call the rotation active because a button was pressed; only kiosk state does that
 *  - while waiting for the playback boundary, SAY what it is waiting for
 *  - `starting` is a local, short-lived "sent, not yet acknowledged" state
 */
export function rotationStartState({
  isRotationActive = false,
  rotationPending = false,
  starting = false,
  connected = true,
} = {}) {
  if (isRotationActive) {
    return { kind: 'active', label: 'Stop Rotation', hint: '', busy: false, disabled: !connected };
  }
  if (rotationPending) {
    return {
      kind: 'queued',
      label: 'Starting after this song',
      hint: 'The kiosk is finishing the song that is playing, then the rotation begins.',
      busy: true,
      disabled: false,
    };
  }
  if (starting) {
    return { kind: 'starting', label: 'Starting…', hint: 'Sent to the kiosk.', busy: true, disabled: true };
  }
  return { kind: 'idle', label: 'Start Rotation', hint: '', busy: false, disabled: !connected };
}

/**
 * Should the local "starting" flag be cleared? It must not linger once the kiosk has
 * told us what really happened, and it must not linger after a failure either.
 */
export function clearStartingFlag({ isRotationActive = false, rotationPending = false, failed = false, connected = true } = {}) {
  return !!(isRotationActive || rotationPending || failed || !connected);
}