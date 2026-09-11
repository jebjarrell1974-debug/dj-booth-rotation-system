// A commercial owns the deck until it is naturally done or the DJ skips it.
// Keeping this lifecycle separate from AudioEngine lets the caller cancel
// delayed voiceover work without adding commercial-specific behavior to the
// shared music engine.
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
