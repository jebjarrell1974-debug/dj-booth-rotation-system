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

export const AUTOMATIC_HISTORY_SCOPE = 'all';

function normalizeTrackName(name) {
  return typeof name === 'string' ? name.toLowerCase() : '';
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

// Automatic history is an all-time no-repeat ledger, not a four-hour
// cooldown. Accept either the persisted name→timestamp map or a Set so every
// offline fallback can apply the same rule as the server selector. The
// optional excludedNames argument is useful for one-shot automatic pools
// (for example, swapping an active break song without repeating another song
// already in that break or rotation).
export function filterUnplayedAutomaticTracks(
  tracks,
  playedSongs = {},
  excludedNames = [],
) {
  const played = namesToSet(playedSongs);
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
 * Validate and normalize the complete server history response.
 *
 * A successful HTTP response is not enough to enable automatic playback:
 * callers must request scope=all, and a response with a scope marker must
 * confirm that scope. An empty cooldown map is valid (a new installation can
 * have no history); a missing or malformed map is not. This deliberately
 * does not merge a local ledger on failure — stale local data is useful for
 * diagnostics/recording, but never proves that automatic history is ready.
 */
export function hydrateAutomaticHistory(payload, { scope = AUTOMATIC_HISTORY_SCOPE } = {}) {
  if (scope !== AUTOMATIC_HISTORY_SCOPE) {
    return hydrationFailure(`Automatic history requires scope=${AUTOMATIC_HISTORY_SCOPE}`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return hydrationFailure('Automatic history response was not an object');
  }
  if (
    payload.scope != null
    && String(payload.scope).toLowerCase() !== AUTOMATIC_HISTORY_SCOPE
  ) {
    return hydrationFailure(`Automatic history response was not scope=${AUTOMATIC_HISTORY_SCOPE}`);
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
    if (
      !trackName
      || !Number.isFinite(Number(playedAt))
      || Number(playedAt) <= 0
    ) {
      return hydrationFailure(`Automatic history contains an invalid entry for "${trackName}"`);
    }
    cooldowns[trackName] = Number(playedAt);
  }

  return {
    ready: true,
    scope: AUTOMATIC_HISTORY_SCOPE,
    cooldowns,
    error: null,
  };
}

/**
 * Fetch the server's all-history ledger with bounded retries.
 *
 * No local fallback is returned on failure. The caller should keep its
 * existing local ledger only for display/recording, leave its readiness flag
 * false, and retry later. This prevents startup/auth failures from silently
 * re-enabling automatic selection against stale history.
 */
export async function fetchAutomaticHistory({
  fetchImpl = globalThis.fetch,
  token = null,
  retries = 2,
  retryDelayMs = 250,
  signal,
  endpoint = '/api/history/cooldowns?scope=all',
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
      const hydrated = hydrateAutomaticHistory(payload, { scope: AUTOMATIC_HISTORY_SCOPE });
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