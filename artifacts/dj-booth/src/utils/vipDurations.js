/**
 * VIP time increments, defined ONCE so the desktop remote, the phone remote and the
 * local kiosk cannot drift apart. Each button ADDS to a running total that the operator
 * then confirms - it is not a one-tap fixed-duration submit.
 */
export const VIP_INCREMENT_MINUTES = Object.freeze([10, 15, 30, 60]);

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