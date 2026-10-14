const OFF = 'off';

function parseFrequency(value) {
  if (value === OFF) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeCounter(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Count completed entertainer boundaries, not songs or break-song endings.
 *
 * The frequency is read for every boundary so switching commercials on/off
 * does not reset the already accumulated cadence. A boundary key makes the
 * operation idempotent when an interstitial completion is observed by more
 * than one transition path.
 */
export function createCommercialCadenceScheduler({
  initialCounter = 0,
  getFrequency = () => OFF,
} = {}) {
  let counter = normalizeCounter(initialCounter);
  let lastBoundaryKey = null;
  let lastResult = {
    counter,
    due: false,
    skipped: false,
    commercialId: null,
    skippedCommercials: [],
  };

  const consumeBoundary = ({
    boundaryKey = null,
    commercialId = null,
    skippedCommercials = [],
  } = {}) => {
    if (boundaryKey != null && boundaryKey === lastBoundaryKey) {
      return { ...lastResult, duplicate: true };
    }

    if (boundaryKey != null) lastBoundaryKey = boundaryKey;
    const frequency = parseFrequency(getFrequency());
    if (!frequency) {
      lastResult = {
        counter,
        due: false,
        skipped: false,
        commercialId,
        skippedCommercials: [...skippedCommercials],
      };
      return { ...lastResult, duplicate: false };
    }

    counter += 1;
    const reachesCadence = counter % frequency === 0;
    const skipped = reachesCadence && skippedCommercials.includes(commercialId);
    lastResult = {
      counter,
      due: reachesCadence && !skipped,
      skipped,
      commercialId,
      skippedCommercials: skipped
        ? skippedCommercials.filter(id => id !== commercialId)
        : [...skippedCommercials],
    };
    return { ...lastResult, duplicate: false };
  };

  return {
    consumeBoundary,
    get counter() {
      return counter;
    },
    get lastBoundaryKey() {
      return lastBoundaryKey;
    },
  };
}

/**
 * Finish an interstitial through the boundary that opened it. A final
 * break-song skip and a hard "next entertainer" skip both continue into the
 * same incoming transition, so neither path may consume a second boundary.
 */
export function takeCommercialBoundary({
  pendingBoundary = null,
  fallback = {},
  consumeBoundary,
} = {}) {
  if (pendingBoundary) return pendingBoundary;
  if (typeof consumeBoundary !== 'function') {
    throw new TypeError('takeCommercialBoundary requires consumeBoundary');
  }
  return consumeBoundary(fallback);
}

// An immediate manual handoff advances the cadence but cannot play an ad
// before the selected entertainer. Carry due ads to subsequent ordinary
// boundaries in FIFO order, retaining each ad's original slot identity.
export function routeDeferredCommercialBoundary(
  boundary, queued = [], { defer = false, pending = false } = {},
) {
  const next = [...queued];
  if (defer) {
    if (boundary.due) {
      if (pending) next.unshift(boundary);
      else next.push(boundary);
    }
    return { boundary: { ...boundary, due: false }, queued: next };
  }
  const earlier = next.shift();
  if (earlier) {
    if (boundary.due) next.push(boundary);
    return { boundary: earlier, queued: next };
  }
  return { boundary, queued: next };
}

/**
 * The ordinary song-skip planner treats song zero as an in-set song. When a
 * final interstitial skip has already opened a pending boundary, callers must
 * route that decision before entering that song branch instead.
 */
export function routePendingCommercialBoundary({
  currentSongNumber,
  pendingBoundary = null,
  fallback = {},
  consumeBoundary,
} = {}) {
  if (currentSongNumber !== 0 || !pendingBoundary) {
    return { route: 'song', boundary: null };
  }
  return {
    route: 'incoming-boundary',
    boundary: takeCommercialBoundary({
      pendingBoundary,
      fallback,
      consumeBoundary,
    }),
  };
}
