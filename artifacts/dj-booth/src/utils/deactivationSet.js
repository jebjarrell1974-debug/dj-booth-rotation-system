export function replaceBlockedCurrentSlot(songs, blockedName, slot, replacement) {
  const next = Array.isArray(songs) ? [...songs] : [];
  for (let i = 0; i < next.length; i++) {
    if (next[i]?.name === blockedName) next[i] = undefined;
  }
  next[slot] = replacement || undefined;
  return next;
}