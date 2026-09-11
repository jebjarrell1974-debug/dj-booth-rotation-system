import { getSongName } from './rotationAssignments.js';

export function normalizeInterstitialSongs(nextSongs) {
  const normalized = {};
  for (const [rawKey, songs] of Object.entries(nextSongs || {})) {
    if (!Array.isArray(songs)) continue;
    const names = songs.map(getSongName).filter(Boolean);
    if (names.length > 0) normalized[String(rawKey)] = names;
  }
  return normalized;
}

export function commitInterstitialWorkspace(nextSongs, {
  manualBreaks = {},
  markManual = [],
} = {}) {
  const songs = normalizeInterstitialSongs(nextSongs);
  const ownership = { ...(manualBreaks || {}) };
  for (const key of markManual || []) ownership[String(key)] = true;
  for (const key of Object.keys(ownership)) {
    if (!Object.prototype.hasOwnProperty.call(songs, key)) delete ownership[key];
  }
  return { songs, manualBreaks: ownership };
}

// Changing the automatic default must not erase a DJ-owned one-shot queue.
// Keep the active automatic queue too, because changing a control cannot stop
// audio already on air; it is cleared by normal completion/rotation handling.
export function retainInterstitialQueuesForAutomaticCount(
  nextSongs,
  manualBreaks = {},
  automaticCount = 0,
  activeBreakKey = null,
) {
  const normalized = normalizeInterstitialSongs(nextSongs);
  if (automaticCount > 0) {
    return commitInterstitialWorkspace(normalized, { manualBreaks });
  }
  const retained = {};
  for (const [key, songs] of Object.entries(normalized)) {
    if (manualBreaks?.[key] === true || key === activeBreakKey) retained[key] = songs;
  }
  const retainedManual = Object.fromEntries(
    Object.keys(manualBreaks || {})
      .filter(key => Object.prototype.hasOwnProperty.call(retained, key))
      .map(key => [key, true]),
  );
  return commitInterstitialWorkspace(retained, { manualBreaks: retainedManual });
}

export function clearInterstitialBreak(nextSongs, manualBreaks = {}, breakKey) {
  const songs = { ...(nextSongs || {}) };
  delete songs[String(breakKey)];
  const ownership = { ...(manualBreaks || {}) };
  delete ownership[String(breakKey)];
  return commitInterstitialWorkspace(songs, { manualBreaks: ownership });
}