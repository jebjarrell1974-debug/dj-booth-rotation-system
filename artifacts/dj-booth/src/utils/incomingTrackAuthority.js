const hasOwn = (value, key) => (
  !!value && Object.prototype.hasOwnProperty.call(value, key)
);

const valueForDancer = (assignments, dancerId) => {
  if (!assignments || typeof assignments !== 'object') return undefined;
  if (hasOwn(assignments, dancerId)) return assignments[dancerId];
  const stringId = String(dancerId);
  return hasOwn(assignments, stringId) ? assignments[stringId] : undefined;
};

const trackName = track => track?.name || track?.path || null;

const hasDancer = (dancers, dancerId) => (
  dancers?.has?.(dancerId) || dancers?.has?.(String(dancerId))
);

/**
 * Resolve one incoming slot from the live assignment ledgers.
 *
 * This deliberately does not pick or fill anything. A manual empty set is a
 * real result, and automatic assignments are filtered only through the
 * caller-provided filter. The caller can therefore invalidate a warm target
 * without accidentally replacing a DJ edit with a random song.
 */
export function resolveAuthoritativeIncomingSlot({
  dancerId,
  slotIndex = 0,
  rotationSongs = {},
  savedSongs = {},
  savedManual = {},
  manualDancers = new Set(),
  manualSetLengths = {},
  isManualSet: isManualSetOverride = null,
  getManualSetLength = null,
  filterAutomaticTracks = tracks => tracks,
} = {}) {
  const manual = typeof isManualSetOverride === 'function'
    ? !!isManualSetOverride(dancerId)
    : !!(
      hasDancer(manualDancers, dancerId)
      || hasOwn(manualSetLengths, String(dancerId))
      || valueForDancer(savedManual, dancerId)
    );
  const saved = valueForDancer(savedSongs, dancerId);
  const savedTracks = Array.isArray(saved) && saved.length > 0 ? saved : null;
  const configuredLength = typeof getManualSetLength === 'function'
    ? getManualSetLength(dancerId)
    : manualSetLengths?.[String(dancerId)];
  const intentionalEmpty = manual && Number(configuredLength) === 0;

  if (intentionalEmpty) {
    return {
      dancerId,
      slotIndex,
      track: null,
      tracks: [],
      manual,
      intentionalEmpty: true,
      source: 'manual-empty',
    };
  }

  let tracks;
  let source;
  if (savedTracks) {
    // A live Save All/reroll ledger wins over the rotation snapshot.
    tracks = savedTracks;
    source = 'saved';
  } else {
    const rotation = valueForDancer(rotationSongs, dancerId);
    tracks = Array.isArray(rotation) ? rotation : [];
    if (!manual) tracks = filterAutomaticTracks(tracks) || [];
    source = manual ? 'rotation-manual' : 'rotation-automatic';
  }

  return {
    dancerId,
    slotIndex,
    track: tracks[slotIndex] || null,
    tracks,
    manual,
    intentionalEmpty: false,
    source,
  };
}

/**
 * Compare a warm target captured before an ad with the live incoming slot.
 * A version bump alone is not stale when the exact URL is still authoritative;
 * a changed URL or intentional empty assignment is stale. A missing
 * automatically-filtered slot with the same version preserves the selected
 * target rather than inventing a fallback.
 */
export function reconcileIncomingPreparedTrack({
  preparedTrack = null,
  preparedVersion = null,
  currentVersion = null,
  currentSlot = null,
} = {}) {
  const preparedUrl = preparedTrack?.url || null;
  const currentUrl = currentSlot?.track?.url || null;
  const sameUrl = !!preparedUrl && preparedUrl === currentUrl;
  const missingManualTrack = !!currentSlot?.manual && !currentUrl;
  const changed = !!currentSlot?.intentionalEmpty
    || missingManualTrack
    || (!sameUrl && (
      preparedVersion !== currentVersion
      || !!currentUrl
    ));

  return {
    changed,
    shouldInvalidate: changed,
    intentionalEmpty: !!currentSlot?.intentionalEmpty,
    manual: !!currentSlot?.manual,
    track: changed ? currentSlot?.track || null : preparedTrack,
    currentSlot,
  };
}

/**
 * Resolve name-only assignments without allowing an in-flight lookup to
 * overwrite a newer edit. The reader is called again after every lookup, and
 * a changed slot/version is resolved from scratch.
 */
export async function resolveAuthoritativeNameOnlyTrack({
  currentSlot = null,
  currentVersion = null,
  readCurrentSlot = null,
  resolveTrackByName = null,
  maxAttempts = 3,
} = {}) {
  let observed = {
    slot: currentSlot,
    version: currentVersion,
  };
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const slot = observed.slot;
    if (slot?.intentionalEmpty || !slot?.track) {
      return {
        track: slot?.track || null,
        currentSlot: slot,
        intentionalEmpty: !!slot?.intentionalEmpty,
      };
    }
    if (slot.track.url || typeof resolveTrackByName !== 'function') {
      return {
        track: slot.track,
        currentSlot: slot,
        intentionalEmpty: false,
      };
    }
    const name = trackName(slot.track);
    if (!name) {
      return { track: slot.track, currentSlot: slot, intentionalEmpty: false };
    }
    const versionBeforeLookup = observed.version;
    let resolved = null;
    try {
      resolved = await resolveTrackByName(name);
    } catch {
      resolved = null;
    }
    const latest = typeof readCurrentSlot === 'function'
      ? readCurrentSlot()
      : observed;
    const latestSlot = latest?.slot || latest || slot;
    const latestVersion = latest?.version ?? versionBeforeLookup;
    if (latestSlot?.intentionalEmpty) {
      return {
        track: null,
        currentSlot: latestSlot,
        intentionalEmpty: true,
      };
    }
    if (latestSlot?.track?.url) {
      return {
        track: latestSlot.track,
        currentSlot: latestSlot,
        intentionalEmpty: false,
      };
    }
    const latestName = trackName(latestSlot?.track);
    if (
      latestName
      && (latestName !== name || latestVersion !== versionBeforeLookup)
    ) {
      observed = { slot: latestSlot, version: latestVersion };
      continue;
    }
    return {
      track: resolved?.url
        ? { ...latestSlot.track, ...resolved }
        : (latestSlot?.track || null),
      currentSlot: latestSlot,
      intentionalEmpty: false,
    };
  }
  return {
    track: observed.slot?.track || null,
    currentSlot: observed.slot,
    intentionalEmpty: !!observed.slot?.intentionalEmpty,
  };
}