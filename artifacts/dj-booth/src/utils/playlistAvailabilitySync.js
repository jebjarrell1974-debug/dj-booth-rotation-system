// The save timer being empty does NOT mean a save has completed. A revision
// owns local additions/reorders from their first edit until its PUT succeeds.
export function createPlaylistEditGuard() {
  let revision = 0;
  let dirty = false;
  return {
    edit() { dirty = true; return ++revision; },
    capture() { return { revision, dirty }; },
    acknowledge(savedRevision) {
      if (savedRevision === revision) dirty = false;
    },
    canRestore(snapshot) {
      return !snapshot.dirty && !dirty && snapshot.revision === revision;
    },
  };
}

export function reconcileAvailablePlaylist(current, saved, queried, available, restoreSaved) {
  // Names added during the request weren't queried: preserve them rather than
  // treating absent evidence as deactivation. Playback still checks the server.
  const candidates = restoreSaved ? saved : current;
  return candidates.filter(name => !queried.has(name) || available.has(name));
}

export function samePlaylist(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}
