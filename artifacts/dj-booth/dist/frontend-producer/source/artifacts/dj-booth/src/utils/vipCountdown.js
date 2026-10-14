export function createVipRemainingSnapshot(vipMap, now = Date.now()) {
  if (!vipMap || typeof vipMap !== 'object' || Array.isArray(vipMap)) return {};
  return Object.fromEntries(Object.entries(vipMap).map(([id, entry]) => [
    String(id),
    Math.max(0, Number(entry?.expiresAt) - now),
  ]).filter(([, remainingMs]) => Number.isFinite(remainingMs) && remainingMs > 0));
}

export function decayVipRemaining(remainingMs, receivedAt, monotonicNow) {
  const remaining = Number(remainingMs);
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.max(0, remaining - Math.max(0, Number(monotonicNow) - Number(receivedAt)));
}

// Wall-clock corrections must not extend a running VIP countdown. Seed once
// from expiry, bounded by the time actually purchased, then use elapsed time.
export function createVipCountdownClock({
  wallNow = () => Date.now(),
  monotonicNow = () => performance.now(),
} = {}) {
  const anchors = new Map();
  const remaining = (id, entry) => {
    const expiry = Number(entry?.expiresAt);
    const duration = Number(entry?.duration);
    if (!Number.isFinite(expiry)) return 0;
    const key = `${expiry}|${duration}`;
    let anchor = anchors.get(String(id));
    if (!anchor || anchor.key !== key) {
      const wallRemaining = Math.max(0, expiry - wallNow());
      anchor = {
        key,
        at: monotonicNow(),
        ms: Number.isFinite(duration) && duration > 0
          ? Math.min(duration, wallRemaining)
          : wallRemaining,
      };
      anchors.set(String(id), anchor);
    }
    return decayVipRemaining(anchor.ms, anchor.at, monotonicNow());
  };
  return {
    remaining,
    snapshot(map) {
      const entries = Object.entries(map || {});
      const ids = new Set(entries.map(([id]) => String(id)));
      for (const id of anchors.keys()) if (!ids.has(id)) anchors.delete(id);
      return Object.fromEntries(entries.map(([id, entry]) => [id, remaining(id, entry)]));
    },
  };
}