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