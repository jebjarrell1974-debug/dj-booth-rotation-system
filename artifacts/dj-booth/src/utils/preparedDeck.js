/**
 * Small ownership-aware handoff buffer for a dual-deck media player.
 *
 * The controller only ever touches the target deck supplied by getTarget().
 * It never calls play(), changes gain, or changes the active deck.  A prepared
 * entry is therefore safe to build while another deck (including a commercial)
 * owns the audible output.
 */
export function createPreparedDeckController({
  getTarget,
  claimTarget = null,
  waitForReady = null,
  onInvalidate = null,
} = {}) {
  let entry = null;
  let token = 0;
  let disposed = false;

  const normalizeTrack = input => {
    if (typeof input === 'string') {
      return {
        url: input,
        name: decodeURIComponent(input.split('/').pop().split('?')[0]),
      };
    }
    if (!input || typeof input !== 'object' || !input.url) return null;
    return {
      ...input,
      url: String(input.url),
      name: input.name || String(input.url).split('/').pop(),
    };
  };

  const currentTarget = () => {
    try {
      return getTarget?.() || null;
    } catch {
      return null;
    }
  };

  const entryIsCurrent = candidate => (
    !disposed
    && entry === candidate
    && candidate?.deck
    && currentTarget()?.deck === candidate.deck
    && currentTarget()?.deckName === candidate.deckName
    && currentTarget()?.generation === candidate.generation
  );

  const sameTarget = (candidate, target) => (
    !!candidate
    && !!target
    && candidate.deck === target.deck
    && candidate.deckName === target.deckName
    && candidate.generation === target.generation
  );

  const clearMedia = candidate => {
    if (!entryIsCurrent(candidate)) return false;
    // Do not call load() here.  A stale cleanup must not initiate another
    // network load, and src is cleared only while this exact entry owns it.
    try { candidate.deck.pause?.(); } catch {}
    if (candidate.deck.src === candidate.url || candidate.deck.src) {
      try { candidate.deck.src = ''; } catch {}
    }
    return true;
  };

  const invalidate = (criteria = {}) => {
    if (!entry) return false;
    const candidate = entry;
    if (criteria.handle && candidate.token !== criteria.handle.token) return false;
    if (criteria.owner !== undefined && !Object.is(candidate.owner, criteria.owner)) return false;
    if (criteria.deck && candidate.deck !== criteria.deck) return false;
    if (criteria.deckName && candidate.deckName !== criteria.deckName) return false;
    if (criteria.generation != null && candidate.generation !== criteria.generation) return false;
    if (criteria.url && candidate.url !== criteria.url) return false;

    clearMedia(candidate);
    entry = null;
    token++;
    try { onInvalidate?.(candidate); } catch {}
    return true;
  };

  const makeHandle = candidate => ({
    token: candidate.token,
    url: candidate.url,
    name: candidate.name,
    deck: candidate.deckName,
    generation: candidate.generation,
    owner: candidate.owner,
  });

  const prepare = async (input, { owner = null } = {}) => {
    if (disposed) return null;
    const track = normalizeTrack(input);
    if (!track?.url) return null;

    let target = currentTarget();
    if (!target?.deck || target.unsafe) return null;

    if (
      entry
      && entry.url === track.url
      && Object.is(entry.owner, owner)
      && sameTarget(entry, target)
    ) {
      return entry.promise;
    }

    invalidate();
    if (typeof claimTarget === 'function') {
      try { target = claimTarget() || target; } catch { return null; }
    }
    if (!target?.deck || target.unsafe) return null;

    const candidate = {
      ...track,
      token: ++token,
      owner,
      deck: target.deck,
      deckName: target.deckName,
      generation: target.generation,
      ready: false,
      promise: null,
    };
    entry = candidate;

    candidate.promise = (async () => {
      try {
        if (!entryIsCurrent(candidate)) return null;
        // Assigning a new URL is sufficient to replace the inactive deck's
        // old source.  There is deliberately no play(), gain, or active-deck
        // operation in this path.
        candidate.deck.onended = null;
        candidate.deck.ontimeupdate = null;
        candidate.deck.src = candidate.url;
        candidate.deck.load?.();
        if (typeof waitForReady === 'function') {
          await waitForReady(candidate.deck, {
            isCurrent: () => entryIsCurrent(candidate),
          });
        }
        if (!entryIsCurrent(candidate)) return null;
        candidate.ready = true;
        return makeHandle(candidate);
      } catch {
        if (entry === candidate) invalidate({ handle: makeHandle(candidate) });
        return null;
      }
    })();

    return candidate.promise;
  };

  const adopt = ({ url, owner = null } = {}) => {
    if (!entry || !url || entry.url !== url || !Object.is(entry.owner, owner)) return null;
    const target = currentTarget();
    if (!entry.ready || !entryIsCurrent(entry) || !sameTarget(entry, target)) return null;
    const handle = makeHandle(entry);
    entry = null;
    return handle;
  };

  const dispose = () => {
    if (disposed) return;
    invalidate();
    disposed = true;
  };

  return {
    prepare,
    adopt,
    invalidate,
    dispose,
    getCurrent: () => (entry ? makeHandle(entry) : null),
  };
}
