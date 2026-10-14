// Revalidate server music even when AudioEngine already holds a decoded/prepared
// copy. Never let cache contents override the current deactivation flag.
const pending = new WeakMap();

export function musicNameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\.(mp3|wav|flac|m4a|aac|ogg|opus|wma|aiff)$/i, '');
}

export function cancelMusicAvailabilityChecks(engine, name = null) {
  for (const controller of pending.get(engine) || []) {
    if (name === null || controller.trackName === musicNameKey(name)) controller.abort();
  }
}

export async function musicStreamAvailable(url, { signal } = {}) {
  if (typeof url !== 'string' || !/\/api\/music\/stream\/\d+(?:[?#]|$)/.test(url)) return true;
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal });
    return response.ok && !signal?.aborted;
  } catch {
    return false;
  }
}

export async function playAvailableTrack(engine, track, crossfade = true, options = {}) {
  if (!engine?.playTrack) return false;
  const controller = new AbortController();
  controller.trackName = musicNameKey(track?.name);
  const abort = () => controller.abort();
  if (options.startupSignal?.aborted) return false;
  options.startupSignal?.addEventListener('abort', abort, { once: true });
  const checks = pending.get(engine) || new Set();
  pending.set(engine, checks);
  checks.add(controller);
  const timeout = setTimeout(abort, 3000);
  try {
    const url = typeof track === 'string' ? track : track?.url;
    if (!await musicStreamAvailable(url, { signal: controller.signal }) || controller.signal.aborted) return false;
    clearTimeout(timeout);
    return await engine.playTrack(track, crossfade, { ...options, startupSignal: controller.signal });
  } finally {
    clearTimeout(timeout);
    options.startupSignal?.removeEventListener('abort', abort);
    checks.delete(controller);
  }
}
