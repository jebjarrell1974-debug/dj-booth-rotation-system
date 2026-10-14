// Tracks in these folders are valid DJ/library material, but must never be
// selected by an automatic entertainer/fallback path. Promo generation and
// manual library playback intentionally do not use this filter. Keep this
// list in sync with the server's automatic selector: DJ-only tracks must not
// leak into a client-side fallback just because the server request failed.
export const AUTOMATIC_SELECTION_EXCLUDED_GENRES = Object.freeze([
  'Promo Beds',
  'Promos',
  'FEATURE',
  'Z DJ ONLY',
]);

const EXCLUDED_GENRES = new Set(
  AUTOMATIC_SELECTION_EXCLUDED_GENRES.map(genre => genre.toLowerCase()),
);

// The play-history ledger is intentionally retained indefinitely by callers,
// but automatic eligibility is only affected by the six-hour cooldown window.
// Keep the old history names exported below: DJBooth and older remote clients
// import them, while the newer names make the time-bounded semantics explicit.
export const AUTOMATIC_COOLDOWN_HOURS = 6;
export const AUTOMATIC_COOLDOWN_MS = AUTOMATIC_COOLDOWN_HOURS * 60 * 60 * 1000;
export const AUTOMATIC_COOLDOWN_SCOPE = 'recent';
export const AUTOMATIC_HISTORY_SCOPE = AUTOMATIC_COOLDOWN_SCOPE;
export const AUTOMATIC_HISTORY_LEDGER_SCOPE = 'all';

function normalizeTrackName(name) {
  return typeof name === 'string' ? name.toLowerCase() : '';
}

function timestampOf(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  }
  const timestamp = Number(value);
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  // Numeric timestamps are the normal API/storage representation. Accept an
  // ISO date as well so a history map copied from a diagnostics endpoint does
  // not accidentally make every song look permanently recent.
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function historyEntries(history) {
  if (!history || typeof history !== 'object') return [];
  if (history instanceof Map) return [...history.entries()];
  if (history instanceof Set || Array.isArray(history)) {
    // Sets/arrays are useful for one-shot exclusions but contain no age
    // information. They are handled by namesToSet, not by recent history.
    return [];
  }
  return Object.entries(history);
}

/**
 * Return whether a track has a valid play timestamp inside the automatic
 * cooldown window. The optional now argument makes the boundary deterministic
 * for callers/tests. An array/Set is treated as an explicit one-shot
 * exclusion for backwards compatibility; it is not a persisted history map.
 */
export function isRecentlyPlayed(name, history = {}, now = Date.now()) {
  const normalizedName = normalizeTrackName(name);
  if (!normalizedName) return false;
  if (history instanceof Set) {
    return [...history].some(entry => normalizeTrackName(entry) === normalizedName);
  }
  if (Array.isArray(history)) {
    return history.some(entry => normalizeTrackName(entry) === normalizedName);
  }
  const currentTime = timestampOf(now) || Date.now();
  const cutoff = currentTime - AUTOMATIC_COOLDOWN_MS;
  return historyEntries(history).some(([trackName, playedAt]) => (
    normalizeTrackName(trackName) === normalizedName
    && (timestampOf(playedAt) || 0) > cutoff
  ));
}

/**
 * Filter a retained ledger down to entries that still block automatic
 * selection. This never mutates or deletes the caller's all-time ledger.
 */
export function getRecentSongHistory(history = {}, now = Date.now()) {
  const currentTime = timestampOf(now) || Date.now();
  const cutoff = currentTime - AUTOMATIC_COOLDOWN_MS;
  const recent = {};
  const newestByName = new Map();
  for (const [trackName, playedAt] of historyEntries(history)) {
    const timestamp = timestampOf(playedAt);
    if (!trackName || timestamp == null || timestamp <= cutoff) continue;
    const normalizedName = normalizeTrackName(trackName);
    const existing = newestByName.get(normalizedName);
    if (!existing || timestamp > existing.timestamp) {
      newestByName.set(normalizedName, { trackName, timestamp });
    }
  }
  for (const { trackName, timestamp } of newestByName.values()) {
    recent[trackName] = timestamp;
  }
  return recent;
}

export function isAutomaticSelectionExcluded(track) {
  const genre = typeof track?.genre === 'string' ? track.genre.trim().toLowerCase() : '';
  return EXCLUDED_GENRES.has(genre);
}

export function filterAutomaticTracks(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks.filter(track => track && !isAutomaticSelectionExcluded(track));
}

function namesToSet(names) {
  if (names instanceof Set || Array.isArray(names)) {
    return new Set([...names].map(normalizeTrackName).filter(Boolean));
  }
  if (names && typeof names === 'object') {
    return new Set(Object.keys(names).map(normalizeTrackName).filter(Boolean));
  }
  return new Set();
}

// Accept either the persisted name→timestamp ledger or a Set so every offline
// fallback can apply the same six-hour rule as the server selector. The
// optional excludedNames argument is useful for one-shot automatic pools
// (for example, swapping an active break song without repeating another song
// already in that break or rotation).
export function filterUnplayedAutomaticTracks(
  tracks,
  playedSongs = {},
  excludedNames = [],
  now = Date.now(),
) {
  const played = (playedSongs instanceof Set || Array.isArray(playedSongs))
    ? namesToSet(playedSongs)
    : namesToSet(getRecentSongHistory(playedSongs, now));
  const excluded = namesToSet(excludedNames);
  const seen = new Set();

  return filterAutomaticTracks(tracks).filter(track => {
    const name = normalizeTrackName(track?.name);
    if (!name || played.has(name) || excluded.has(name) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function hydrationFailure(error) {
  return {
    ready: false,
    scope: null,
    cooldowns: {},
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Validate and normalize the server history response.
 *
 * A successful HTTP response is not enough to enable automatic playback. An
 * empty cooldown map is valid (a new installation can have no history); a
 * missing or malformed map is not. This deliberately does not merge a local
 * ledger on failure — stale local data is useful for diagnostics/recording,
 * but never proves that automatic history is ready. The optional all-scope
 * argument is retained for older callers; selection still applies the
 * six-hour filter to every hydrated map.
 */
export function hydrateRecentSongHistory(payload, { scope = AUTOMATIC_COOLDOWN_SCOPE } = {}) {
  if (scope !== AUTOMATIC_COOLDOWN_SCOPE && scope !== AUTOMATIC_HISTORY_LEDGER_SCOPE) {
    return hydrationFailure(`Automatic history requires scope=${AUTOMATIC_COOLDOWN_SCOPE}`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return hydrationFailure('Automatic history response was not an object');
  }
  const payloadScope = payload.scope == null ? null : String(payload.scope).toLowerCase();
  // Older servers returned scope=all even for the legacy cooldown endpoint.
  // Accept that marker for a recent request as a compatibility bridge; the
  // selector still checks every timestamp against the six-hour boundary.
  const legacyAllScope = scope === AUTOMATIC_COOLDOWN_SCOPE && payloadScope === AUTOMATIC_HISTORY_LEDGER_SCOPE;
  if (
    payloadScope != null
    && payloadScope !== String(scope).toLowerCase()
    && !legacyAllScope
  ) {
    return hydrationFailure(`Automatic history response was not scope=${scope}`);
  }
  if (
    !payload.cooldowns
    || typeof payload.cooldowns !== 'object'
    || Array.isArray(payload.cooldowns)
  ) {
    return hydrationFailure('Automatic history response did not include a cooldown map');
  }

  const cooldowns = {};
  for (const [trackName, playedAt] of Object.entries(payload.cooldowns)) {
    const timestamp = timestampOf(playedAt);
    if (!trackName || timestamp == null) {
      return hydrationFailure(`Automatic history contains an invalid entry for "${trackName}"`);
    }
    cooldowns[trackName] = timestamp;
  }

  return {
    ready: true,
    scope,
    cooldowns,
    error: null,
  };
}

// API-compatibility alias for callers that still use the previous
// all-history-oriented helper name.
export const hydrateAutomaticHistory = hydrateRecentSongHistory;

/**
 * Fetch the server's six-hour automatic cooldown map with bounded retries.
 *
 * No local fallback is returned on failure. The caller should keep its
 * existing local ledger only for display/recording, leave its readiness flag
 * false, and retry later. This prevents startup/auth failures from silently
 * re-enabling automatic selection against stale history. The local ledger is
 * still retained by the caller; only eligibility is time-bounded.
 */
export async function fetchRecentSongHistory({
  fetchImpl = globalThis.fetch,
  token = null,
  retries = 2,
  retryDelayMs = 250,
  signal,
  endpoint = `/api/history/cooldowns?hours=${AUTOMATIC_COOLDOWN_HOURS}`,
} = {}) {
  const attempts = Math.max(1, Number(retries) + 1);
  let lastError = 'Automatic history request failed';

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (typeof fetchImpl !== 'function') {
        throw new Error('Automatic history fetch is unavailable');
      }

      const response = await fetchImpl(endpoint, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        ...(signal ? { signal } : {}),
      });
      if (!response?.ok) {
        throw new Error(`Automatic history request failed (${response?.status ?? 'unknown'})`);
      }

       const payload = await response.json();
       const hydrated = hydrateRecentSongHistory(payload, { scope: AUTOMATIC_COOLDOWN_SCOPE });
      if (!hydrated.ready) throw new Error(hydrated.error);
      return { ...hydrated, attempts: attempt + 1 };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt + 1 >= attempts) break;
      if (retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  return {
    ...hydrationFailure(lastError),
    attempts,
  };
}

// API-compatibility alias for the former helper name. Its request is now
// explicitly six-hour, while its return value remains the same ready/map
// shape consumed by the existing DJBooth owner.
export const fetchAutomaticHistory = fetchRecentSongHistory;