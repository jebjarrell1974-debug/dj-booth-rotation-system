// Remote workspace writes are optimistic-lock protected by the kiosk. Keep
// every structural write in one FIFO so a receipt's applied rotation version
// becomes the expected version for the next write, regardless of which
// dancer produced it.

function defer() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function readAppliedRotationVersion(receipt) {
  const value = receipt?.command?.appliedRotationVersion ?? receipt?.appliedRotationVersion;
  return Number.isInteger(value) ? value : null;
}

function readRotationAuthority(value) {
  if (Number.isInteger(value)) {
    return { version: value, epoch: null };
  }
  if (!value || typeof value !== 'object') {
    return { version: undefined, epoch: null };
  }
  const version = value.rotationVersion ?? value.version;
  return {
    version: Number.isInteger(version) ? version : undefined,
    epoch: value.stateEpoch ?? value.serverEpoch ?? value.epoch ?? null,
  };
}

function normalizeBreakSongs(songs) {
  if (!Array.isArray(songs)) return [];
  return songs.filter(Boolean);
}

function readActiveBreakEdits(payload) {
  if (Array.isArray(payload?.activeBreakEdits)) {
    return payload.activeBreakEdits.filter(edit => (
      edit
      && edit.breakKey != null
      && Number.isInteger(edit.removedIndex)
    ));
  }
  return payload?.activeBreakEdit
    && payload.activeBreakEdit.breakKey != null
    && Number.isInteger(payload.activeBreakEdit.removedIndex)
    ? [payload.activeBreakEdit]
    : [];
}

function mergeCoalescedPayload(previousAction, previousPayload, nextAction, nextPayload) {
  if (
    previousAction !== 'updateInterstitialSongs'
    || nextAction !== 'updateInterstitialSongs'
  ) {
    return nextPayload;
  }
  const previousEdits = readActiveBreakEdits(previousPayload);
  const nextEdits = readActiveBreakEdits(nextPayload);
  if (previousEdits.length === 0 && nextEdits.length === 0) return nextPayload;

  const merged = { ...nextPayload };
  // Keep every removal that occurred while this workspace was waiting behind
  // an in-flight command. Each index is relative to the workspace produced by
  // the preceding operation, so the kiosk must apply them in this order.
  merged.activeBreakEdits = [...previousEdits, ...nextEdits];
  delete merged.activeBreakEdit;
  return merged;
}

/**
 * Merge one locally edited break into the latest local workspace.
 *
 * The caller supplies the key that was edited rather than replacing the
 * complete map. This matters when two break editors run before React paints:
 * the second edit must not resurrect an older snapshot and erase the first
 * break's manual ownership marker.
 */
export function mergeRemoteBreakWorkspace(
  currentSongs = {},
  currentManualBreaks = {},
  requestedSongs = {},
  breakKey,
) {
  const songs = Object.fromEntries(
    Object.entries(currentSongs || {})
      .map(([key, value]) => [String(key), normalizeBreakSongs(value)])
      .filter(([, value]) => value.length > 0),
  );
  const manualBreaks = Object.fromEntries(
    Object.entries(currentManualBreaks || {})
      .filter(([, owned]) => owned === true)
      .map(([key]) => [String(key), true]),
  );

  const key = String(breakKey);
  const requested = normalizeBreakSongs(requestedSongs?.[breakKey]);
  if (requested.length > 0) {
    songs[key] = requested;
    manualBreaks[key] = true;
  } else {
    delete songs[key];
    delete manualBreaks[key];
  }

  for (const ownedKey of Object.keys(manualBreaks)) {
    if (!Object.prototype.hasOwnProperty.call(songs, ownedKey)) delete manualBreaks[ownedKey];
  }
  return { songs, manualBreaks };
}

/**
 * Remove only drafts that were unchanged while a save was in flight.
 *
 * Revisions are per dancer instead of one global dirty bit. A save can
 * acknowledge dancer A while preserving a newer edit to dancer B (or a newer
 * replacement for A) made during the request.
 */
export function acknowledgeRemoteDrafts(
  drafts = {},
  savedRevisions = {},
  currentRevisions = {},
) {
  const remaining = { ...(drafts || {}) };
  for (const dancerId of Object.keys(savedRevisions || {})) {
    if (currentRevisions?.[dancerId] === savedRevisions[dancerId]) {
      delete remaining[dancerId];
    }
  }
  return remaining;
}

/**
 * Serialize remote writes. Entries with the same key coalesce while waiting
 * for an earlier write, but an in-flight write is never replaced. Structural
 * entries receive the latest expected rotation version, including versions
 * returned only by the kiosk receipt. A new idle burst refreshes from the
 * authoritative snapshot while retaining a same-epoch receipt floor, so a
 * delayed stale snapshot cannot move the optimistic lock backwards.
 */
export function createRemoteEditingQueue({
  sendCommand,
  getRotationVersion,
} = {}) {
  if (typeof sendCommand !== 'function') throw new TypeError('sendCommand is required');

  const pending = [];
  const entriesByKey = new Map();
  let running = false;
  let drainPromise = null;
  let activeEntry = null;
  let expectedRotationVersion;
  let hasExpectedRotationVersion = false;
  let expectedEpoch = null;
  let receiptFloorVersion;

  const readCurrentRotationAuthority = () => {
    const value = typeof getRotationVersion === 'function' ? getRotationVersion() : undefined;
    return readRotationAuthority(value);
  };

  const refreshIdleBaseline = () => {
    const current = readCurrentRotationAuthority();
    if (current.epoch != null && expectedEpoch != null && current.epoch !== expectedEpoch) {
      // A restarted kiosk starts a new revision sequence. Do not carry the
      // previous process's receipt floor into the new epoch.
      expectedRotationVersion = current.version;
      expectedEpoch = current.epoch;
      receiptFloorVersion = current.version;
      hasExpectedRotationVersion = true;
      return expectedRotationVersion;
    }

    if (current.version != null) {
      expectedRotationVersion = expectedRotationVersion == null
        ? current.version
        : Math.max(expectedRotationVersion, current.version);
      if (receiptFloorVersion != null) {
        expectedRotationVersion = Math.max(expectedRotationVersion, receiptFloorVersion);
      }
      if (expectedEpoch == null && current.epoch != null) expectedEpoch = current.epoch;
    } else if (!hasExpectedRotationVersion) {
      expectedRotationVersion = undefined;
    }
    hasExpectedRotationVersion = true;
    return expectedRotationVersion;
  };

  const ensureExpectedRotationVersion = () => {
    if (!hasExpectedRotationVersion) refreshIdleBaseline();
    return expectedRotationVersion;
  };

  const run = async () => {
    while (pending.length > 0) {
      const entry = pending.shift();
      entry.started = true;
      activeEntry = entry;
      if (entry.key && entriesByKey.get(entry.key) === entry) {
        entriesByKey.delete(entry.key);
      }

      try {
        const options = { ...entry.options };
        if (entry.structural) {
          options.expectedRotationVersion = ensureExpectedRotationVersion();
        }
        const result = await sendCommand(entry.action, entry.payload, options);
        if (entry.structural) {
          const applied = readAppliedRotationVersion(result);
          if (applied != null) {
            expectedRotationVersion = applied;
            const receiptAuthority = readRotationAuthority(result);
            const receiptEpoch = result?.command?.stateEpoch
              ?? result?.stateEpoch
              ?? receiptAuthority.epoch
              ?? expectedEpoch;
            if (receiptEpoch != null && expectedEpoch != null && receiptEpoch !== expectedEpoch) {
              receiptFloorVersion = applied;
            } else {
              receiptFloorVersion = receiptFloorVersion == null
                ? applied
                : Math.max(receiptFloorVersion, applied);
            }
            if (receiptEpoch != null) expectedEpoch = receiptEpoch;
          } else {
            // A rejected/failed transport must not make the next command use
            // an old receipt. The next live snapshot is the authoritative
            // recovery point.
            const current = readCurrentRotationAuthority();
            if (current.epoch != null && expectedEpoch != null && current.epoch !== expectedEpoch) {
              expectedRotationVersion = current.version;
              expectedEpoch = current.epoch;
              receiptFloorVersion = current.version;
            } else if (current.version != null) {
              expectedRotationVersion = expectedRotationVersion == null
                ? current.version
                : Math.max(expectedRotationVersion, current.version);
            }
          }
          hasExpectedRotationVersion = true;
        }
        activeEntry = null;
        entry.resolve(result);
      } catch (error) {
        if (entry.structural) {
          const current = readCurrentRotationAuthority();
          if (current.epoch != null && expectedEpoch != null && current.epoch !== expectedEpoch) {
            expectedRotationVersion = current.version;
            expectedEpoch = current.epoch;
            receiptFloorVersion = current.version;
          } else if (current.version != null) {
            expectedRotationVersion = expectedRotationVersion == null
              ? current.version
              : Math.max(expectedRotationVersion, current.version);
          }
          hasExpectedRotationVersion = true;
        }
        activeEntry = null;
        entry.reject(error);
      }
    }
  };

  const start = () => {
    if (running) return;
    running = true;
    drainPromise = run().finally(() => {
      running = false;
      drainPromise = null;
      // A promise continuation can enqueue after run() observes an empty
      // queue but before this finally callback runs. Restart the tail so it
      // cannot strand pending work (and so flush can observe it).
      if (pending.length > 0) start();
    });
  };

  const enqueue = (
    action,
    payload = {},
    {
      key = null,
      structural = false,
      ...options
    } = {},
  ) => {
    if (!activeEntry && pending.length === 0 && structural) {
      // Every idle burst gets a fresh authoritative baseline. Keep the
      // highest same-epoch receipt as a floor so a delayed stale snapshot
      // cannot move the next optimistic lock backwards.
      refreshIdleBaseline();
    }
    const existing = key ? entriesByKey.get(String(key)) : null;
    if (existing && !existing.started) {
      const previousAction = existing.action;
      const previousPayload = existing.payload;
      existing.action = action;
      existing.payload = mergeCoalescedPayload(
        previousAction,
        previousPayload,
        action,
        payload,
      );
      existing.structural = structural;
      existing.options = options;
      return existing.promise;
    }

    const deferred = defer();
    const entry = {
      action,
      payload,
      key: key ? String(key) : null,
      structural,
      options,
      started: false,
      ...deferred,
    };
    pending.push(entry);
    if (entry.key) entriesByKey.set(entry.key, entry);
    start();
    return entry.promise;
  };

  const flush = async () => {
    do {
      if (!running && pending.length > 0) start();
      if (drainPromise) await drainPromise;
    } while (running || pending.length > 0);
  };

  return {
    enqueue,
    flush,
    get expectedRotationVersion() {
      return hasExpectedRotationVersion ? expectedRotationVersion : readCurrentRotationAuthority().version;
    },
  };
}
