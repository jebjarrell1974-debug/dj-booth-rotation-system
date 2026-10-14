// Saved playlists sometimes omit the extension. Use the same identity for
// availability checks without confusing unrelated names containing SQL wildcards.
export function musicNameKey(name) {
  return String(name || '').trim().toLowerCase()
    .replace(/\.(mp3|wav|flac|m4a|aac|ogg|opus|wma|aiff)$/i, '');
}

export function filterBlockedMusicNames(names, blockedNames) {
  if (!Array.isArray(names)) return [];
  const blocked = new Set(blockedNames.map(musicNameKey));
  return names.filter(name => typeof name === 'string' && !blocked.has(musicNameKey(name)));
}
