// Tracks in these folders are valid DJ/library material, but must never be
// selected by an automatic entertainer/fallback path.  Promo generation and
// manual library playback intentionally do not use this filter.
export const AUTOMATIC_SELECTION_EXCLUDED_GENRES = Object.freeze([
  'Promo Beds',
  'Promos',
]);

const EXCLUDED_GENRES = new Set(
  AUTOMATIC_SELECTION_EXCLUDED_GENRES.map(genre => genre.toLowerCase()),
);

export function isAutomaticSelectionExcluded(track) {
  const genre = typeof track?.genre === 'string' ? track.genre.trim().toLowerCase() : '';
  return EXCLUDED_GENRES.has(genre);
}

export function filterAutomaticTracks(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks.filter(track => track && !isAutomaticSelectionExcluded(track));
}

// Automatic history is an all-time no-repeat ledger, not a four-hour
// cooldown. Accept either the persisted name→timestamp map or a Set so every
// offline fallback can apply the same rule as the server selector.
export function filterUnplayedAutomaticTracks(tracks, playedSongs = {}) {
  const played = playedSongs instanceof Set
    ? playedSongs
    : new Set(
      playedSongs && typeof playedSongs === 'object'
        ? Object.keys(playedSongs)
        : [],
    );
  return filterAutomaticTracks(tracks).filter(track => track?.name && !played.has(track.name));
}