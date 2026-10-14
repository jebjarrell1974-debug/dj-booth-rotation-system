export const OWNED_BED_FADE_MS = 2000;

export function clampOwnedDeckFadeMs(durationMs) {
  const numericDuration = Number(durationMs);
  if (!Number.isFinite(numericDuration)) return OWNED_BED_FADE_MS;
  return Math.max(0, Math.min(OWNED_BED_FADE_MS, numericDuration));
}

const sameHandle = (left, right) => (
  left?.deck === right?.deck
  && left?.generation === right?.generation
);

/**
 * Fade one deck that was captured by its owner. The generation check is
 * deliberately supplied by the AudioEngine: a deck can be reused while an
 * old commercial callback is still settling, and that callback must not be
 * allowed to pause the replacement track.
 */
export function createOwnedDeckFadeController({
  getDeck,
  getGain,
  isCurrent,
  requestFrame = callback => globalThis.requestAnimationFrame(callback),
  cancelFrame = frameId => globalThis.cancelAnimationFrame(frameId),
  now = () => globalThis.performance.now(),
  audioTime = () => 0,
} = {}) {
  let active = null;

  const settle = (entry, result) => {
    if (active !== entry) return;
    active = null;
    if (entry.frameId !== null) {
      cancelFrame(entry.frameId);
      entry.frameId = null;
    }
    entry.resolve(result);
  };

  const cancel = (reason = 'cancelled', handle = null) => {
    if (!active || (handle && !sameHandle(active.handle, handle))) return false;
    const entry = active;
    settle(entry, { status: 'cancelled', reason });
    return true;
  };

  const fade = (handle, { durationMs = OWNED_BED_FADE_MS } = {}) => {
    if (!handle || typeof isCurrent !== 'function' || !isCurrent(handle)) {
      return Promise.resolve({ status: 'stale' });
    }

    // Repeated natural-completion callbacks share the first fade rather than
    // extending it or scheduling a second pause.
    if (active && sameHandle(active.handle, handle)) {
      return active.promise;
    }
    cancel('replaced');

    const deck = getDeck?.(handle.deck);
    const gainNode = getGain?.(handle.deck);
    if (!deck || !gainNode?.gain || deck.ended || deck.paused || !deck.src) {
      return Promise.resolve({ status: 'already-ended' });
    }

    const duration = clampOwnedDeckFadeMs(durationMs);
    const startGain = Number.isFinite(gainNode.gain.value)
      ? Math.max(0, gainNode.gain.value)
      : 1;
    let entry;
    entry = {
      handle,
      deck,
      gainNode,
      startGain,
      frameId: null,
      startedAt: now(),
      promise: null,
      resolve: null,
    };
    entry.promise = new Promise(resolve => {
      entry.resolve = resolve;
    });
    active = entry;

    const finish = () => {
      // A replacement track or explicit cancellation owns the deck now.
      if (active !== entry || !isCurrent(entry.handle)) {
        settle(entry, { status: 'stale' });
        return;
      }
      try {
        entry.gainNode.gain.setValueAtTime(0, audioTime());
        entry.deck.pause();
      } catch {
        // Cleanup is best effort; the session still has to settle.
      }
      settle(entry, { status: 'completed' });
    };

    if (duration <= 0) {
      finish();
      return entry.promise;
    }

    const animate = timestamp => {
      if (active !== entry || !isCurrent(entry.handle)) {
        settle(entry, { status: 'stale' });
        return;
      }

      const progress = Math.min(1, Math.max(0, (timestamp - entry.startedAt) / duration));
      const gain = entry.startGain * Math.cos(progress * Math.PI * 0.5);
      try {
        entry.gainNode.gain.setValueAtTime(gain, audioTime());
      } catch {
        settle(entry, { status: 'completed' });
        return;
      }

      if (progress >= 1) {
        finish();
      } else {
        entry.frameId = requestFrame(animate);
      }
    };

    entry.frameId = requestFrame(animate);
    return entry.promise;
  };

  const stopOwnedDeck = handle => {
    if (!handle || typeof isCurrent !== 'function' || !isCurrent(handle)) {
      return false;
    }
    cancel('stop-owned', handle);
    const deck = getDeck?.(handle.deck);
    if (!deck) return false;
    deck.pause();
    deck.onended = null;
    deck.ontimeupdate = null;
    return true;
  };

  return {
    fade,
    cancel,
    stopOwnedDeck,
    get activeHandle() {
      return active?.handle || null;
    },
  };
}