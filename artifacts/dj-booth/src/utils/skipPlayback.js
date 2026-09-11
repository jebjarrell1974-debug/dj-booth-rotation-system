/**
 * Decide what a user-facing skip should advance.
 *
 * Song skips stay within the current entertainer's configured set.  The
 * explicit entertainer mode is reserved for the separate "Next Entertainer"
 * control; it must not be inferred from a UI event or from a stale sentinel.
 *
 * `trackCount` is intentionally not used to decide whether the set is over.
 * A live assignment can be temporarily short while the kiosk refills it, and
 * that must never turn a missing song into an entertainer transition.
 */
export function planSkipAdvance({
  skipBreaks = false,
  currentSongNumber,
  songsPerSet,
  skipLocked = false,
}) {
  if (skipLocked) {
    return {
      accepted: false,
      kind: 'locked',
      songNumber: currentSongNumber,
    };
  }

  if (skipBreaks) {
    return { accepted: true, kind: 'entertainer' };
  }

  const canAdvanceSong =
    Number.isInteger(currentSongNumber) &&
    currentSongNumber >= 0 &&
    Number.isInteger(songsPerSet) &&
    songsPerSet > currentSongNumber;

  if (canAdvanceSong) {
    return {
      accepted: true,
      kind: 'song',
      trackIndex: currentSongNumber,
      songNumber: currentSongNumber + 1,
    };
  }

  return { accepted: true, kind: 'entertainer' };
}

export function remoteSkipPayload(nextEntertainer = false) {
  return nextEntertainer ? { skipBreaks: true } : {};
}

export function canCommitAssignmentRefill(startVersion, currentVersion) {
  return startVersion === currentVersion;
}

export function songNumberAfterPlayback(currentSongNumber, nextSongNumber, playbackSucceeded) {
  return playbackSucceeded ? nextSongNumber : currentSongNumber;
}