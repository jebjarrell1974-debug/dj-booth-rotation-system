/**
 * VIP time increments, defined ONCE so the desktop remote, the phone remote and the
 * local kiosk cannot drift apart. Each button ADDS to a running total that the operator
 * then confirms - it is not a one-tap fixed-duration submit.
 */
export const VIP_INCREMENT_MINUTES = Object.freeze([10, 15, 30, 60]);
export const MAX_VIP_DURATION_MS = 24 * 60 * 60 * 1000;

export function parseVipDurationMs(value, { max = MAX_VIP_DURATION_MS } = {}) {
  const duration = value;
  if (!Number.isFinite(duration) || !Number.isInteger(duration) || duration <= 0 || duration > max) {
    return null;
  }
  return duration;
}

export function sanitizeVipMap(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    const expiresAt = Number(entry?.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > now;
  }));
}

export const VIP_INCREMENT_OPTIONS = Object.freeze(
  VIP_INCREMENT_MINUTES.map(minutes => Object.freeze({
    minutes,
    ms: minutes * 60 * 1000,
    label: minutes % 60 === 0 && minutes >= 60 ? `+${minutes / 60}h` : `+${minutes}m`,
  })),
);

/** "—" when nothing is staged, else "45m" / "1h" / "1h 10m". */
export function vipTotalLabel(totalMs) {
  const mins = Math.round((Number(totalMs) || 0) / 60000);
  if (mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}