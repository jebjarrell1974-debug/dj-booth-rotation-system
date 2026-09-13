/**
 * Decides whether a duck acquire that reaches the kiosk is still wanted.
 *
 * Why identity and not a timer. The remote sends the release without waiting for its
 * acquire to be acknowledged, so the two requests are briefly in flight together and can
 * reach the server in either order. If the acquire is applied after the release, the music
 * stays ducked with nobody holding the button. The window is worth stating exactly:
 *
 *   * the client's own timeout only stops it WAITING - an aborted request can still be
 *     delivered, so the time between the press and the command arriving at the server is
 *     not bounded by anything the client does;
 *   * once it arrives, the server expires it if the kiosk has not taken it within its
 *     2.5 s TTL, and a claimed command is executed immediately after;
 *   * so an acquire executes at most ~2.75 s after it ARRIVES, but it can arrive at any
 *     time at all - well past any fixed retention window.
 *
 * ⚠️ WHAT IS ACTUALLY GUARANTEED. Every hold from one remote page carries
 * {clientId, holdSeq}, holdSeq increasing per press. The kiosk remembers the highest hold
 * it has RELEASED per (actor, clientId) and refuses anything not newer. That refusal holds
 * **for as long as the kiosk still has that session's record** - which is:
 *
 *   * across a kiosk reload, because the records are persisted (see load/save below);
 *   * until the session has been idle for DUCK_HOLD_RETENTION_MS;
 *   * unless more than MAX_TRACKED_DUCK_CLIENTS other sessions have released holds since,
 *     and this one is no longer fresh enough to be protected from eviction.
 *
 * It is NOT "refused for ever" - the table is deliberately bounded, so a record can be
 * gone. For those boundaries the cost is bounded instead: an acquire from a session the
 * kiosk has never seen is granted a PROBATION lease (DUCK_PROBATION_LEASE_MS) rather than
 * the full one. A real press renews every heartbeat and is upgraded to the full lease
 * immediately; a stale acquire is never renewed, so the music comes back in about two
 * seconds instead of three, with no effect on ordinary holds and no ownership change.
 *
 * ⭐ TWO KINDS OF RECORD, AND ONLY ONE HARD LIMIT.
 *
 *   session markers   {seq: null} - "this kiosk has seen this session". They exist only to
 *                     decide probation, so losing one costs a probation lease and nothing
 *                     else. Their limit (MAX_TRACKED_DUCK_SESSIONS) is therefore HARD:
 *                     oldest first, no protection, pruned on every insertion - including on
 *                     the acquire/renew path, where clients that never release would
 *                     otherwise accumulate for ever.
 *
 *   released marks    {seq: n} - the watermark a refusal depends on. Their limit
 *                     (MAX_TRACKED_DUCK_CLIENTS) is SOFT by design: a mark younger than
 *                     DUCK_HOLD_PROTECTED_MS is never evicted, because it could still be
 *                     needed to refuse a request that is in flight right now. A burst of
 *                     releases inside that window CAN exceed the cap, and that is the
 *                     intended trade - correctness over an exact ceiling. The bound is then
 *                     "one record per session that released within the protection window",
 *                     and everything older is evicted oldest-first.
 *
 * Both kinds are also dropped once idle beyond DUCK_HOLD_RETENTION_MS.
 */

/** Released watermarks. SOFT: fresh ones are never evicted, so a burst may exceed this. */
export const MAX_TRACKED_DUCK_CLIENTS = 64;
/** Session markers. HARD: always evicted oldest-first once over. */
export const MAX_TRACKED_DUCK_SESSIONS = 256;
/** A session idle longer than this is forgotten. */
export const DUCK_HOLD_RETENTION_MS = 6 * 60 * 60 * 1000;
/** A record this fresh is never evicted to make room, even if the table is full. */
export const DUCK_HOLD_PROTECTED_MS = 2 * 60 * 1000;
/** Lease granted to a session the kiosk has no record of. Two heartbeats. */
export const DUCK_PROBATION_LEASE_MS = 2000;
export const DUCK_HOLD_STORAGE_KEY = 'djbooth_released_duck_holds';

export function duckHoldKey(actor, clientId) {
  return `${actor || 'unknown'}|${clientId || ''}`;
}

/** True when this acquire belongs to a hold the operator has already let go of. */
export function isSupersededDuckHold(releasedHolds, key, holdSeq) {
  if (!Number.isInteger(holdSeq)) return false;
  const entry = releasedHolds?.get?.(key);
  const lastReleased = entry?.seq;
  return Number.isInteger(lastReleased) && holdSeq <= lastReleased;
}

/** Has this kiosk seen this remote session at all (even without a release yet)? */
export function isKnownDuckSession(releasedHolds, key) {
  return !!releasedHolds?.get?.(key);
}

/**
 * The whole acquire decision, so the kiosk keeps none of it inline. The lease-id set stays
 * as the exact-match guard for a client that sends no hold number.
 */
export function shouldIgnoreDuckAcquire({
  leaseId, key, holdSeq, releasedLeases, releasedHolds,
} = {}) {
  if (leaseId && releasedLeases?.has?.(leaseId)) return 'lease-already-released';
  if (isSupersededDuckHold(releasedHolds, key, holdSeq)) return 'hold-superseded';
  return null;
}

/**
 * How long to trust an acquire the kiosk cannot vouch for. Ordinary holds are unaffected:
 * the very next renewal carries the full lease.
 */
export function leaseForDuckAcquire({
  leaseMs, known, probationMs = DUCK_PROBATION_LEASE_MS,
} = {}) {
  if (known) return leaseMs;
  return Math.min(leaseMs, probationMs);
}

const oldestFirst = entries => entries.sort((a, b) => a[1].at - b[1].at);

function prune(releasedHolds, { now, maxClients, maxSessions, protectedMs, retentionMs }) {
  for (const [key, entry] of [...releasedHolds]) {
    if (now - entry.at > retentionMs) releasedHolds.delete(key);
  }
  // Session markers: a HARD cap. Dropping one only costs a probation lease, so nothing is
  // protected here - this is what keeps a client that never releases from accumulating.
  const markers = oldestFirst([...releasedHolds].filter(([, e]) => !Number.isInteger(e.seq)));
  for (let i = 0; i < markers.length - maxSessions; i++) releasedHolds.delete(markers[i][0]);

  // Released watermarks: a SOFT cap. A mark that is still fresh could be needed to refuse a
  // request in flight right now, so it is never evicted - the cap is exceeded instead.
  const marks = oldestFirst([...releasedHolds].filter(([, e]) => Number.isInteger(e.seq)));
  const evictable = marks.filter(([, e]) => now - e.at > protectedMs);
  const over = marks.length - maxClients;
  for (let i = 0; i < Math.min(over, evictable.length); i++) releasedHolds.delete(evictable[i][0]);
  return releasedHolds;
}

/** Records that this session exists, so its first acquire is the only probationary one. */
export function noteDuckSession(releasedHolds, key, {
  now = Date.now(),
  maxClients = MAX_TRACKED_DUCK_CLIENTS,
  maxSessions = MAX_TRACKED_DUCK_SESSIONS,
  protectedMs = DUCK_HOLD_PROTECTED_MS,
  retentionMs = DUCK_HOLD_RETENTION_MS,
} = {}) {
  if (!releasedHolds) return releasedHolds;
  const entry = releasedHolds.get(key);
  // A session we already know: refresh its recency, nothing can have grown.
  if (entry) { entry.at = now; return releasedHolds; }
  releasedHolds.set(key, { seq: null, at: now });
  // Pruned on INSERTION, so acquire/renew traffic from clients that never release cannot
  // accumulate. This is the path Replit's 10,000-session simulation exercised.
  return prune(releasedHolds, { now, maxClients, maxSessions, protectedMs, retentionMs });
}

/** Records a released hold. Newest-last insertion order keeps the table its own LRU. */
export function rememberReleasedDuckHold(releasedHolds, key, holdSeq, {
  now = Date.now(),
  maxClients = MAX_TRACKED_DUCK_CLIENTS,
  maxSessions = MAX_TRACKED_DUCK_SESSIONS,
  protectedMs = DUCK_HOLD_PROTECTED_MS,
  retentionMs = DUCK_HOLD_RETENTION_MS,
} = {}) {
  if (!releasedHolds || !Number.isInteger(holdSeq)) return releasedHolds;
  const previous = releasedHolds.get(key);
  const seq = Number.isInteger(previous?.seq) ? Math.max(previous.seq, holdSeq) : holdSeq;
  releasedHolds.delete(key);
  releasedHolds.set(key, { seq, at: now });
  return prune(releasedHolds, { now, maxClients, maxSessions, protectedMs, retentionMs });
}

/**
 * Survives a kiosk reload. One small record per remote session, pruned by age and count on
 * the way in, so this can never grow without bound.
 */
export function loadReleasedDuckHolds(storage, {
  storageKey = DUCK_HOLD_STORAGE_KEY,
  now = Date.now(),
  maxClients = MAX_TRACKED_DUCK_CLIENTS,
  maxSessions = MAX_TRACKED_DUCK_SESSIONS,
  protectedMs = DUCK_HOLD_PROTECTED_MS,
  retentionMs = DUCK_HOLD_RETENTION_MS,
} = {}) {
  const holds = new Map();
  let raw = null;
  try { raw = storage?.getItem?.(storageKey); } catch { return holds; }
  if (!raw) return holds;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { return holds; }
  if (!parsed || typeof parsed !== 'object') return holds;
  const entries = Object.entries(parsed)
    .filter(([, entry]) => entry && Number.isFinite(entry.at))
    .sort((a, b) => a[1].at - b[1].at);          // oldest first, so the Map stays an LRU
  for (const [key, entry] of entries) {
    const seq = Number.isInteger(entry.seq) ? entry.seq : null;
    holds.set(key, { seq, at: entry.at });
  }
  return prune(holds, { now, maxClients, maxSessions, protectedMs, retentionMs });
}

export function saveReleasedDuckHolds(storage, releasedHolds, {
  storageKey = DUCK_HOLD_STORAGE_KEY,
} = {}) {
  if (!storage || !releasedHolds) return false;
  const out = {};
  for (const [key, entry] of releasedHolds) {
    if (Number.isInteger(entry.seq)) out[key] = { seq: entry.seq, at: entry.at };
  }
  try { storage.setItem(storageKey, JSON.stringify(out)); return true; } catch { return false; }
}