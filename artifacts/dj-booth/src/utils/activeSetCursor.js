export function createActiveSetCursor({ dancerId = null, songNumber = 1, setLength = 1, generation = 0 } = {}) {
  return {
    dancerId: dancerId == null ? null : String(dancerId),
    songNumber: Math.max(0, Number(songNumber) || 0),
    setLength: Math.max(0, Number(setLength) || 0),
    generation: Math.max(0, Number(generation) || 0),
  };
}

export function beginActiveSet(cursor, { dancerId, setLength, generation = cursor?.generation + 1 } = {}) {
  return createActiveSetCursor({ dancerId, songNumber: 1, setLength, generation });
}

export function advanceActiveSet(cursor, songNumber, generation = cursor?.generation) {
  if (!cursor || generation !== cursor.generation) return cursor;
  return createActiveSetCursor({ ...cursor, songNumber, generation });
}

export function rewindActiveSetForReplacement(cursor, dancerId, songNumber, generation) {
  if (!ownsActiveSet(cursor, { dancerId, generation }) || cursor.songNumber !== songNumber) return null;
  return advanceActiveSet(cursor, Math.max(0, songNumber - 1));
}

export function locateCursorDancer(cursor, rotation) {
  if (!cursor?.dancerId || !Array.isArray(rotation)) return -1;
  return rotation.findIndex(id => String(id) === String(cursor.dancerId));
}

export function rebaseRotationIndex(previousRotation, nextRotation, currentIndex, cursor, isActive) {
  if (!Array.isArray(nextRotation) || nextRotation.length === 0) {
    if (isActive) throw new Error('Stop the rotation before clearing every entertainer');
    return 0;
  }
  const activeId = isActive && cursor?.dancerId != null
    ? cursor.dancerId
    : previousRotation?.[currentIndex];
  if (activeId == null) return Math.max(0, Math.min(currentIndex || 0, nextRotation.length - 1));
  const nextIndex = nextRotation.findIndex(id => String(id) === String(activeId));
  if (nextIndex < 0 && isActive) {
    throw new Error('The active entertainer must remain in the rotation; use Next Entertainer or stop the rotation first');
  }
  return nextIndex >= 0 ? nextIndex : Math.max(0, Math.min(currentIndex || 0, nextRotation.length - 1));
}

export function ownsActiveSet(cursor, { dancerId, generation } = {}) {
  return !!cursor
    && String(cursor.dancerId) === String(dancerId)
    && cursor.generation === generation;
}

export function planActiveSetTransition(cursor, { dancerId, generation, nextSongNumber }) {
  if (!ownsActiveSet(cursor, { dancerId, generation })) return { kind: 'stale' };
  return nextSongNumber <= cursor.setLength
    ? { kind: 'song', songNumber: nextSongNumber }
    : { kind: 'dancer' };
}

export function remainingVipMs(snapshot, receivedAt = 0, now = 0, monotonicNow = 0) {
  const remaining = Number(snapshot?.remainingMs);
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  const elapsed = Math.max(0, Number(monotonicNow) - Number(receivedAt));
  return Math.max(0, remaining - elapsed);
}