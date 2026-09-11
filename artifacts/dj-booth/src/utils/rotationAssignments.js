export function normalizeSongsPerSet(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

export function capSongList(songs, songsPerSet) {
  if (!Array.isArray(songs)) return [];
  const limit = normalizeSongsPerSet(songsPerSet);
  return songs.length > limit ? songs.slice(0, limit) : songs;
}

export function capSongAssignments(assignments, songsPerSet) {
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) return {};

  let changed = false;
  const capped = {};
  for (const [dancerId, songs] of Object.entries(assignments)) {
    const limited = capSongList(songs, songsPerSet);
    capped[dancerId] = limited;
    if (limited !== songs) changed = true;
  }
  return changed ? capped : assignments;
}

// Workspace state can contain either the browser's track objects or the
// compact names sent by a remote editor. Older scanner payloads used
// file_name/filename instead of name, so never let that shape reach a React
// text node or a draggable key as undefined.
export function getSongName(song) {
  if (typeof song === 'string') {
    const value = song.trim();
    return value || null;
  }
  if (!song || typeof song !== 'object') return null;
  for (const field of ['name', 'file_name', 'filename', 'trackName', 'title', 'path']) {
    if (typeof song[field] !== 'string') continue;
    const value = song[field].trim();
    if (!value) continue;
    if (field === 'path') return value.split(/[\\/]/).pop() || value;
    return value;
  }
  return null;
}

export function normalizeSongList(songs, songsPerSet) {
  if (!Array.isArray(songs)) return [];
  return capSongList(songs.map(getSongName).filter(Boolean), songsPerSet);
}

export function normalizeSongAssignments(assignments, songsPerSet) {
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) return {};
  return Object.fromEntries(
    Object.entries(assignments).map(([dancerId, songs]) => [
      dancerId,
      normalizeSongList(songs, songsPerSet),
    ]),
  );
}

// Reconcile the display-layer assignment map with a kiosk snapshot without
// allocating a new object for an unchanged snapshot. Dirty editor entries are
// intentionally retained until the command is acknowledged.
export function reconcileAuthoritativeAssignments(current, authoritative, songsPerSet, dirtyIds = []) {
  const previous = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const next = normalizeSongAssignments(authoritative, songsPerSet);
  for (const rawId of dirtyIds || []) {
    const dancerId = String(rawId);
    if (Object.prototype.hasOwnProperty.call(previous, dancerId)) {
      next[dancerId] = previous[dancerId];
    }
  }

  const ids = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const unchanged = [...ids].every(dancerId => {
    const before = previous[dancerId];
    const after = next[dancerId];
    return Array.isArray(before) && Array.isArray(after) &&
      before.length === after.length && before.every((song, index) => song === after[index]);
  });
  return unchanged ? current : next;
}

// Apply only explicit DJ updates to the live queue. An explicit empty list is
// meaningful (the DJ removed the final song), while dancers omitted from both
// the update map and override list must remain untouched.
export function applyManualAssignments(assignments, updates, manualOverrides = []) {
  const next = assignments && typeof assignments === 'object' && !Array.isArray(assignments)
    ? { ...assignments }
    : {};
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return next;

  for (const rawId of manualOverrides || []) {
    const dancerId = String(rawId);
    next[dancerId] = Object.prototype.hasOwnProperty.call(updates, dancerId)
      ? updates[dancerId]
      : [];
  }
  return next;
}

// Keep the one-shot DJ override ledger separate from automatic queue picks.
// The kiosk broadcasts this filtered map so a remote workspace save cannot
// promote an old automatic assignment into a new manual override.
export function filterManualAssignments(assignments, manualFlags) {
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) return {};
  if (!manualFlags || typeof manualFlags !== 'object' || Array.isArray(manualFlags)) return {};

  const filtered = {};
  for (const [dancerId, songs] of Object.entries(assignments)) {
    if (!manualFlags[dancerId] || !Array.isArray(songs) || songs.length === 0) continue;
    filtered[dancerId] = songs;
  }
  return filtered;
}

export function fillSongListToLimit(existingSongs, candidateSongs, songsPerSet) {
  const limit = normalizeSongsPerSet(songsPerSet);
  const existing = capSongList(existingSongs, limit);
  if (existing.length >= limit || !Array.isArray(candidateSongs)) return existing;

  const songKey = getSongName;
  const seen = new Set(existing.map(songKey).filter(Boolean));
  const additions = [];
  for (const song of candidateSongs) {
    const key = songKey(song);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    additions.push(song);
    if (existing.length + additions.length >= limit) break;
  }
  return additions.length > 0 ? [...existing, ...additions] : existing;
}