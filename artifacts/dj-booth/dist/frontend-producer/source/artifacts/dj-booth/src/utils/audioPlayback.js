const DEFAULT_TRANSITION_LEAD_SECONDS = 15;

/**
 * Return the point at which a normal track should ask the DJ controller to
 * start its transition. Premixed commercials are different from music: the
 * commercial session owns the deck until the media element emits `ended`, so
 * it must never use the normal lead window.
 */
export function getTrackEndTriggerPoint({
  duration,
  isShortTrack = false,
  triggerAtMediaEnd = false,
  transitionLeadSeconds = DEFAULT_TRANSITION_LEAD_SECONDS,
} = {}) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (triggerAtMediaEnd) return safeDuration;
  if (safeDuration === 0) return 0;

  const effectiveLeadTime = isShortTrack
    ? Math.min(3, safeDuration * 0.15)
    : transitionLeadSeconds;
  return Math.max(safeDuration - effectiveLeadTime, safeDuration * 0.85);
}

/**
 * A break cursor points at the next item to play. Removing an item before that
 * cursor must move it back one slot; removing an item after it must not change
 * it. This is intentionally independent of React state so booth and remote
 * workspace edits use the same rebasing rule.
 */
export function rebaseBreakCursor(cursor, removedIndex) {
  if (!Number.isInteger(cursor) || !Number.isInteger(removedIndex)) return cursor;
  if (removedIndex < 0 || removedIndex >= cursor) {
    return Math.max(0, cursor);
  }
  return Math.max(0, cursor - 1);
}

/**
 * A commercial due at a no-break transition has to run before the incoming
 * song. When there is no commercial, retain the normal outro/song overlap.
 */
export function getCommercialTransitionPlan({
  commercialDue = false,
  announcementsEnabled = false,
  featureArrival = false,
} = {}) {
  return {
    commercialBeforeIncoming: Boolean(commercialDue),
    // Feature shows own their arrival sequence. Let the outgoing send-off
    // finish before the feature intro (and before any due commercial).
    overlapOutro: Boolean(announcementsEnabled && !commercialDue && !featureArrival),
  };
}

export function ownsDeckCrossfade({
  owner,
  currentOwner,
  outgoingDeck,
  activeDeck,
  incomingDeck,
  incomingGeneration,
  deckGenerations,
} = {}) {
  if (owner !== currentOwner) return false;
  if (outgoingDeck !== activeDeck) return false;
  if (incomingDeck !== 'A' && incomingDeck !== 'B') return false;
  return deckGenerations?.[incomingDeck] === incomingGeneration;
}

export function ownsDeckStartup({
  capturedActiveDeck,
  currentActiveDeck,
  crossfadeInProgress = false,
} = {}) {
  return !crossfadeInProgress
    && (capturedActiveDeck === 'A' || capturedActiveDeck === 'B')
    && capturedActiveDeck === currentActiveDeck;
}

export function hasAdvancingPlayback(previous, current, minimumDelta = 0.2) {
  if (!current?.decks || typeof current.decks !== 'object') return false;
  if (current.audioContextState !== 'running') return false;

  for (const deckName of ['A', 'B']) {
    const deck = current.decks[deckName];
    if (!deck?.srcSet || deck.paused || deck.ended) continue;
    if (!Number.isFinite(deck.gain) || deck.gain <= 0.01) continue;

    const time = Number(deck.currentTime);
    if (!Number.isFinite(time)) continue;
    const prior = previous?.decks?.[deckName];
    if (!prior || prior.generation !== deck.generation) {
      if (time > minimumDelta) return true;
      continue;
    }

    const priorTime = Number(prior.currentTime);
    if (Number.isFinite(priorTime) && time - priorTime > minimumDelta) return true;
  }

  return false;
}