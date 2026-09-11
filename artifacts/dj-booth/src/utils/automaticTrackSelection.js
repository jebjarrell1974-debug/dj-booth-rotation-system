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