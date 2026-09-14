/**
 * Run optional track work without making playback wait for it.
 *
 * The queue intentionally owns no audio elements. A task may finish after the
 * deck that started it has been replaced; result callbacks therefore belong to
 * the caller, which must perform its own ownership check before touching audio.
 */
export function createBackgroundAnalysisQueue({
  maxConcurrent = 2,
  maxPending = 8,
  onError = () => {},
} = {}) {
  const pending = new Map();
  const waiting = [];
  const concurrency = Number.isFinite(maxConcurrent)
    ? Math.max(1, Math.floor(maxConcurrent))
    : 1;
  const pendingLimit = Number.isFinite(maxPending)
    ? Math.max(1, Math.floor(maxPending))
    : 1;
  let active = 0;

  const releaseEntry = entry => {
    if (!entry.slotReleased) {
      entry.slotReleased = true;
      if (entry.started) active--;
    }
    if (pending.get(entry.key) === entry) pending.delete(entry.key);
    pump();
  };

  const pump = () => {
    while (active < concurrency && waiting.length > 0) {
      const entry = waiting.shift();
      if (!entry || entry.cancelled || pending.get(entry.key) !== entry) continue;

      active++;
      entry.started = true;
      entry.task = Promise.resolve()
        // Defer the first invocation too. Calling an async analyzer directly
        // still runs its synchronous setup before its first await.
        .then(() => (
          entry.cancelled ? undefined : entry.work(entry.controller.signal)
        ))
        .then(result => {
          if (!entry.cancelled) {
            for (const onResult of entry.onResults) {
              try { onResult(result, entry.key); } catch {}
            }
          }
          return result;
        })
        .catch(error => {
          if (!entry.cancelled) {
            try { onError(error, entry.key); } catch {}
          }
          return null;
        })
        .finally(() => {
          releaseEntry(entry);
        });
    }
  };

  const schedule = (key, work, { onResult = null } = {}) => {
    if (!key || typeof work !== 'function') return false;
    const existing = pending.get(key);
    if (existing) {
      if (typeof onResult === 'function' && existing.onResults.length < pendingLimit) {
        existing.onResults.push(onResult);
      }
      return false;
    }
    if (pending.size >= pendingLimit) return false;

    const entry = {
      key,
      work,
      onResults: typeof onResult === 'function' ? [onResult] : [],
      controller: new AbortController(),
      started: false,
      cancelled: false,
      slotReleased: false,
      task: null,
    };
    pending.set(key, entry);
    waiting.push(entry);
    pump();
    return true;
  };

  const clear = () => {
    const entries = [...pending.values()];
    for (const entry of entries) {
      entry.cancelled = true;
      entry.controller.abort();
    }
    for (const entry of entries) {
      if (entry.started) releaseEntry(entry);
    }
    pending.clear();
    waiting.length = 0;
  };

  return {
    schedule,
    clear,
    has: key => pending.has(key),
    size: () => pending.size,
  };
}

/**
 * Normalize the URL used by metadata/cache and the browser media element to
 * one key. Assigning a relative path to HTMLMediaElement.src expands it to an
 * absolute URL, so cache insertion and lookup must use the same representation.
 */
export function normalizeAudioCacheKey(sourceUrl, baseHref = null) {
  const raw = String(sourceUrl || '').trim();
  if (!raw) return '';
  // Preserve the existing object-URL convention while still normalizing the
  // rest of the URL consistently.
  if (/^blob:/i.test(raw)) return raw.slice('blob:'.length);

  try {
    const browserBase = baseHref
      || (typeof globalThis !== 'undefined' ? globalThis.location?.href : null)
      || 'http://localhost/';
    const normalized = new URL(raw, browserBase);
    normalized.hash = '';
    return normalized.href;
  } catch {
    return raw.replace(/^blob:/i, '');
  }
}

export const ANALYSIS_BODY_TIMEOUT_MS = 5000;
export const ANALYSIS_DECODE_TIMEOUT_MS = 5000;
export const ANALYSIS_RENDER_TIMEOUT_MS = 5000;

const createAnalysisTimeoutError = label => {
  const error = new Error(`${label} timed out`);
  error.name = 'TimeoutError';
  return error;
};

const createAnalysisAbortError = () => {
  const error = new Error('Audio analysis was cancelled');
  error.name = 'AbortError';
  return error;
};

/**
 * Bound work which has no native AbortSignal (decodeAudioData and
 * OfflineAudioContext rendering). The underlying browser operation may finish
 * later, but its result is ignored after this promise settles.
 */
export function withAnalysisDeadline(work, {
  signal = null,
  timeoutMs,
  label = 'Audio analysis',
  onTimeout = null,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      signal?.removeEventListener?.('abort', onAbort);
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => finish(createAnalysisAbortError());

    if (signal?.aborted) {
      finish(createAnalysisAbortError());
      return;
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
      timer = setTimeout(() => {
        try { onTimeout?.(); } catch {}
        finish(createAnalysisTimeoutError(label));
      }, timeoutMs);
    }

    Promise.resolve()
      .then(() => (settled ? undefined : work()))
      .then(value => finish(null, value), error => finish(error));
  });
}

export const MEDIA_READY_TIMEOUT_MS = 5000;

const createReadinessAbortError = (message = 'Media readiness was aborted') => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

const getMediaErrorMessage = event => (
  event?.target?.error?.message
  || event?.message
  || 'Media playback failed while waiting for readiness'
);

/**
 * Wait for enough media data to start playback.
 *
 * `isCurrent` is checked at every completion boundary. The owner that starts
 * the wait can abort it when replacing the shared media element, so a stale
 * canplay event cannot start the replacement's audio.
 */
export function waitForMediaReady(media, {
  timeoutMs = MEDIA_READY_TIMEOUT_MS,
  signal = null,
  isCurrent = () => true,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout = null;

    const removeListeners = () => {
      if (!media?.removeEventListener) return;
      media.removeEventListener('canplay', onCanPlay);
      media.removeEventListener('error', onError);
      media.removeEventListener('abort', onMediaAbort);
      signal?.removeEventListener?.('abort', onSignalAbort);
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
    };

    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      removeListeners();
      if (error) reject(error);
      else resolve();
    };

    const ownerIsCurrent = () => {
      try { return isCurrent(); } catch { return false; }
    };

    const onCanPlay = () => {
      if (!ownerIsCurrent()) {
        finish(createReadinessAbortError('Media owner was replaced before readiness'));
        return;
      }
      finish();
    };
    const onError = event => finish(new Error(getMediaErrorMessage(event)));
    const onMediaAbort = () => finish(createReadinessAbortError('Media loading was aborted'));
    const onSignalAbort = () => finish(createReadinessAbortError());

    if (!media || typeof media.addEventListener !== 'function') {
      finish(new Error('Media element is unavailable'));
      return;
    }
    if (signal?.aborted) {
      finish(createReadinessAbortError());
      return;
    }
    if (!ownerIsCurrent()) {
      finish(createReadinessAbortError('Media owner is no longer current'));
      return;
    }
    if (media.readyState >= 3) {
      finish();
      return;
    }

    media.addEventListener('canplay', onCanPlay);
    media.addEventListener('error', onError);
    media.addEventListener('abort', onMediaAbort);
    signal?.addEventListener?.('abort', onSignalAbort, { once: true });
    timeout = setTimeout(() => {
      if (!ownerIsCurrent()) {
        finish(createReadinessAbortError('Media owner was replaced before readiness'));
        return;
      }
      finish(new Error(`Media readiness timed out after ${timeoutMs}ms`));
    }, Math.max(0, timeoutMs));
  });
}