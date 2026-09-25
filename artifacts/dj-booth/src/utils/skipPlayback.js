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

// Put the selected entertainer immediately after the still-playing set owner.
// The hard-skip path then moves that owner to the bottom and starts the
// selected entertainer, without playing the outgoing outro or break.
export function planImmediateHandoff(rotation, activeId, selectedId) {
  if (!Array.isArray(rotation) || rotation.length < 2 ||
      activeId == null || selectedId == null ||
      String(activeId) === String(selectedId)) return null;
  const active = rotation.find(id => String(id) === String(activeId));
  const selected = rotation.find(id => String(id) === String(selectedId));
  if (active == null || selected == null) return null;
  return [
    active,
    selected,
    ...rotation.filter(id => String(id) !== String(active) && String(id) !== String(selected)),
  ];
}

export function canCommitAssignmentRefill(startVersion, currentVersion) {
  return startVersion === currentVersion;
}

export function songNumberAfterPlayback(currentSongNumber, nextSongNumber, playbackSucceeded) {
  return playbackSucceeded ? nextSongNumber : currentSongNumber;
}