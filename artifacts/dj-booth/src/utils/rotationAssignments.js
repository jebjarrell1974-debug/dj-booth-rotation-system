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

export function fillSongListToLimit(existingSongs, candidateSongs, songsPerSet) {
  const limit = normalizeSongsPerSet(songsPerSet);
  const existing = capSongList(existingSongs, limit);
  if (existing.length >= limit || !Array.isArray(candidateSongs)) return existing;

  const songKey = (song) => typeof song === 'string' ? song : song?.name;
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