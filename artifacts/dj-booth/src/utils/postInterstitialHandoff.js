/**
 * A break starts with the next entertainer at the top of the rotation.
 * The numeric cursor may be changed by a removal or VIP edit while the
 * break is playing, so it cannot identify the incoming set.
 *
 * A deliberate reorder of the live top takes precedence over the original
 * next entertainer. If the top became the entertainer who just finished,
 * use the captured next ID when it is still present, then the first other
 * available entertainer. A one-person rotation may legitimately repeat.
 */
export function resolvePostInterstitialHandoff(rotation, expectedNextId, finishedId, availableIds) {
  if (!Array.isArray(rotation) || rotation.length === 0) return null;
  const available = availableIds == null
    ? rotation
    : rotation.filter(id => availableIds.some(known => String(known) === String(id)));
  const isAvailable = id => available.some(known => String(known) === String(id));
  const isFinished = id => finishedId != null && String(id) === String(finishedId);
  const top = rotation[0];
  const selected = isAvailable(top) && !isFinished(top)
    ? top
    : isAvailable(expectedNextId) && !isFinished(expectedNextId)
      ? rotation.find(id => String(id) === String(expectedNextId))
      : rotation.find(id => isAvailable(id) && !isFinished(id))
        ?? rotation.find(isAvailable);
  if (selected == null) return null;
  const index = rotation.findIndex(id => String(id) === String(selected));
  return { dancerId: selected, index, corrected: index !== 0 };
}

export function canRecoverPostInterstitialHandoff(
  originalGeneration, currentGeneration, rotationActive, rotation,
) {
  return originalGeneration === currentGeneration
    && rotationActive
    && Array.isArray(rotation)
    && rotation.length > 0;
}