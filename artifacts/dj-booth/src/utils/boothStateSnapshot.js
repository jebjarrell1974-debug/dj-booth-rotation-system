function finiteRevision(value) {
  const revision = Number(value);
  return Number.isFinite(revision) ? revision : null;
}

function snapshotEpoch(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function epochClock(epoch) {
  const match = epoch?.match(/^(\d+)/);
  if (!match) return null;
  const clock = Number(match[1]);
  return Number.isFinite(clock) ? clock : null;
}

function isConfirmedSnapshot(snapshot) {
  const updatedAt = finiteRevision(snapshot?.updatedAt);
  const stateVersion = finiteRevision(snapshot?.stateVersion);
  return (updatedAt !== null && updatedAt > 0) || (stateVersion !== null && stateVersion > 0);
}

function snapshotOrder(next, current) {
  const nextEpoch = snapshotEpoch(next?.stateEpoch);
  const currentEpoch = snapshotEpoch(current?.stateEpoch);
  if (nextEpoch !== currentEpoch) {
    // A restarted server starts at stateVersion=0/updatedAt=0. Do not let
    // that empty process default erase the last confirmed kiosk snapshot.
    if (current && !isConfirmedSnapshot(next)) return -1;
    // Once an epoch is known, an epoch-less legacy response is necessarily
    // from an older server (or cannot be ordered safely).
    if (currentEpoch !== null && nextEpoch === null) return -1;
    const nextClock = epochClock(nextEpoch);
    const currentClock = epochClock(currentEpoch);
    if (nextClock !== null && currentClock !== null && nextClock !== currentClock) {
      return nextClock > currentClock ? 1 : -1;
    }
    // A confirmed snapshot from a different server process is the only safe
    // way to move to a reset revision sequence. Any later old-epoch response
    // will fail this branch in the opposite direction.
    return 1;
  }

  const nextVersion = finiteRevision(next?.stateVersion);
  const currentVersion = finiteRevision(current?.stateVersion);
  if (nextVersion !== null && currentVersion !== null && nextVersion !== currentVersion) {
    return nextVersion > currentVersion ? 1 : -1;
  }

  const nextUpdatedAt = finiteRevision(next?.updatedAt);
  const currentUpdatedAt = finiteRevision(current?.updatedAt);
  if (nextUpdatedAt !== null && currentUpdatedAt !== null && nextUpdatedAt !== currentUpdatedAt) {
    return nextUpdatedAt > currentUpdatedAt ? 1 : -1;
  }

  // A response without a usable ordering token is only safe to accept before
  // the first confirmed snapshot. Once a snapshot has been accepted, an
  // unversioned legacy response must not roll it back.
  if (nextVersion === null && nextUpdatedAt === null) return current ? -1 : 1;
  return 0;
}

/**
 * Accept a booth snapshot only when it is newer than the last confirmed one.
 *
 * The kiosk increments stateVersion for every publish, including explicit
 * stopped/empty states. Therefore this deliberately orders by revision rather
 * than treating an empty rotation or a false isPlaying value as a default
 * that can be ignored.
 */
export function acceptBoothSnapshot(current, next) {
  if (!next || typeof next !== 'object') return current;
  if (!current || typeof current !== 'object') return next;
  return snapshotOrder(next, current) > 0 ? next : current;
}

export function compareBoothSnapshots(next, current) {
  if (!current || typeof current !== 'object') return 1;
  if (!next || typeof next !== 'object') return -1;
  return snapshotOrder(next, current);
}
