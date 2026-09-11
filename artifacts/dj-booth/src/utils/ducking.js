export const VOICE_DUCK_GAIN = 0.18;
export const DUCK_LEASE_MS = 3000;
export const DUCK_HEARTBEAT_MS = 1000;
export const DUCK_COMMAND_TIMEOUT_MS = 4500;

const clampGain = value => Math.max(0.001, Math.min(1, Number.isFinite(value) ? value : 1));

/**
 * Ducking is a multiplier on the music bus, not a replacement for the
 * operator's master volume. The quietest active owner wins so a manual hold
 * cannot cancel a voiceover (and releasing one owner cannot unduck another).
 */
export function composeDuckGain(baseGain = 1, owners = []) {
  const base = clampGain(baseGain);
  const values = owners instanceof Map
    ? [...owners.values()].map(owner => owner?.gain)
    : owners.map(owner => owner?.gain ?? owner);
  const active = values
    .filter(value => Number.isFinite(value))
    .map(clampGain);
  return active.length > 0 ? Math.min(base, ...active) : base;
}

export function composeMusicOutputGain(masterVolume, duckGain) {
  const master = Math.max(0, Math.min(1, Number.isFinite(masterVolume) ? masterVolume : 0));
  return master * clampGain(duckGain);
}

/**
 * Small owner/lease registry used by AudioEngine and by the command-only
 * kiosk path. The injected clock/timer functions make expiry deterministic
 * without changing browser behavior.
 */
export function createDuckOwnerStore({
  onChange = () => {},
  now = () => Date.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = timer => clearTimeout(timer),
} = {}) {
  const owners = new Map();
  const timers = new Map();

  const notify = change => {
    try { onChange(change); } catch {}
  };

  const cancelTimer = ownerId => {
    const timer = timers.get(ownerId);
    if (timer != null) clearTimer(timer);
    timers.delete(ownerId);
  };

  const scheduleExpiry = (ownerId, leaseMs) => {
    cancelTimer(ownerId);
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) return;
    const expiresAt = now() + leaseMs;
    const timer = setTimer(() => {
      const owner = owners.get(ownerId);
      if (!owner || owner.expiresAt > now()) {
        if (owner) scheduleExpiry(ownerId, owner.expiresAt - now());
        return;
      }
      owners.delete(ownerId);
      timers.delete(ownerId);
      notify({ type: 'expired', ownerId, owner, immediate: true });
    }, Math.max(0, leaseMs));
    timers.set(ownerId, timer);
    const owner = owners.get(ownerId);
    if (owner) owner.expiresAt = expiresAt;
  };

  const acquire = (ownerId, {
    gain = VOICE_DUCK_GAIN,
    leaseMs = null,
    immediate = false,
    attackMs,
    releaseMs,
  } = {}) => {
    const id = String(ownerId || '').trim();
    if (!id) throw new Error('A duck owner is required');
    const owner = {
      gain: clampGain(gain),
      expiresAt: null,
    };
    owners.set(id, owner);
    scheduleExpiry(id, leaseMs);
    notify({ type: 'acquired', ownerId: id, owner, immediate, attackMs, releaseMs });
    return id;
  };

  const renew = (ownerId, { leaseMs = DUCK_LEASE_MS } = {}) => {
    const id = String(ownerId || '').trim();
    const owner = owners.get(id);
    if (!owner) return false;
    scheduleExpiry(id, leaseMs);
    notify({ type: 'renewed', ownerId: id, owner });
    return true;
  };

  const release = (ownerId, { immediate = false, releaseMs } = {}) => {
    const id = String(ownerId || '').trim();
    const owner = owners.get(id);
    if (!owner) return false;
    owners.delete(id);
    cancelTimer(id);
    notify({ type: 'released', ownerId: id, owner, immediate, releaseMs });
    return true;
  };

  const clear = ({ notifyChange = false } = {}) => {
    for (const ownerId of owners.keys()) cancelTimer(ownerId);
    owners.clear();
    if (notifyChange) notify({ type: 'cleared' });
  };

  return {
    owners,
    acquire,
    renew,
    release,
    clear,
    getTargetGain: baseGain => composeDuckGain(baseGain, owners),
    has: ownerId => owners.has(String(ownerId || '').trim()),
    size: () => owners.size,
  };
}