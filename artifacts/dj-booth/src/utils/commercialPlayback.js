// A commercial owns the deck until it is naturally done or the DJ skips it.
// Keeping this lifecycle separate from AudioEngine lets the caller cancel
// delayed voiceover work without adding commercial-specific behavior to the
// shared music engine.
import { OWNED_BED_FADE_MS } from './ownedDeckFade.js';

export { OWNED_BED_FADE_MS };

export function createCommercialSession({ mode = 'new' } = {}) {
  let finished = false;
  let voiceStarted = false;
  let voiceFinished = false;
  let ownedStop = null;
  let ownedStopped = false;
  let resolveDone;
  const done = new Promise(resolve => {
    resolveDone = resolve;
  });

  return {
    mode,
    done,
    get finished() {
      return finished;
    },
    get voiceStarted() {
      return voiceStarted;
    },
    get voiceFinished() {
      return voiceFinished;
    },
    markVoiceStarted() {
      voiceStarted = true;
    },
    completeVoice() {
      voiceFinished = true;
      return this.finish();
    },
    trackEnded() {
      if (mode === 'old' && !voiceFinished) return false;
      return this.finish();
    },
    registerOwnedStop(stop) {
      ownedStop = typeof stop === 'function' ? stop : null;
    },
    stopOwned() {
      if (ownedStopped) return false;
      ownedStopped = true;
      ownedStop?.();
      return true;
    },
    cancel() {
      this.stopOwned();
      return this.finish();
    },
    finish() {
      if (finished) return false;
      finished = true;
      resolveDone();
      return true;
    },
  };
}

// Voice completion is intentionally not the same as session completion for a
// legacy bed-plus-voice commercial. The owned bed gets one bounded fade first,
// then the caller can clean up and admit the next intro.
export function createCommercialBedCompletion({
  session,
  fadeOwnedDeck,
  getDeckHandle,
} = {}) {
  let completion = null;

  return () => {
    if (completion) return completion;
    if (!session || session.finished) return Promise.resolve(false);

    const handle = getDeckHandle?.();
    const fadeResult = typeof fadeOwnedDeck === 'function' && handle
      ? fadeOwnedDeck(handle, { durationMs: OWNED_BED_FADE_MS })
      : null;

    completion = Promise.resolve(fadeResult).then(() => {
      if (session.finished) return false;
      session.completeVoice();
      return true;
    });
    return completion;
  };
}
