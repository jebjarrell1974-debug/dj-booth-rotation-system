import test from 'node:test';
import assert from 'node:assert/strict';
import {
  duckHoldKey,
  isKnownDuckSession,
  isSupersededDuckHold,
  leaseForDuckAcquire,
  loadReleasedDuckHolds,
  noteDuckSession,
  rememberReleasedDuckHold,
  saveReleasedDuckHolds,
  shouldIgnoreDuckAcquire,
  DUCK_HOLD_PROTECTED_MS,
  DUCK_HOLD_RETENTION_MS,
  DUCK_PROBATION_LEASE_MS,
  MAX_TRACKED_DUCK_CLIENTS,
  MAX_TRACKED_DUCK_SESSIONS,
} from './duckHoldGuard.js';
import { DUCK_LEASE_MS } from './ducking.js';

const key = duckHoldKey('dj-1', 'client-a');
const memoryStorage = () => {
  const map = new Map();
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), map };
};

test('a released hold stays refused long after the lease-id set has aged out', () => {
  const releasedLeases = new Set(['lease-1']);
  const holds = new Map();
  rememberReleasedDuckHold(holds, key, 1, { now: 0 });

  assert.equal(shouldIgnoreDuckAcquire({
    leaseId: 'lease-1', key, holdSeq: 1, releasedLeases, releasedHolds: holds,
  }), 'lease-already-released');

  // The kiosk forgets a lease id after DUCK_LEASE_MS * 2; deliver the same acquire later
  // than that - the case a six-second memory cannot cover.
  releasedLeases.delete('lease-1');
  assert.equal(DUCK_LEASE_MS * 2, 6000);
  assert.equal(shouldIgnoreDuckAcquire({
    leaseId: 'lease-1', key, holdSeq: 1, releasedLeases, releasedHolds: holds,
  }), 'hold-superseded', 'still refused well past the six-second marker');
});

test('the next press is still allowed after the previous hold was released', () => {
  const holds = new Map();
  rememberReleasedDuckHold(holds, key, 4, { now: 0 });
  assert.equal(isSupersededDuckHold(holds, key, 4), true);
  assert.equal(isSupersededDuckHold(holds, key, 3), true, 'older holds are obsolete too');
  assert.equal(isSupersededDuckHold(holds, key, 5), false, 'the new press must go through');
});

test('an out-of-order release never lowers the watermark', () => {
  const holds = new Map();
  rememberReleasedDuckHold(holds, key, 9, { now: 0 });
  rememberReleasedDuckHold(holds, key, 2, { now: 1 });
  assert.equal(holds.get(key).seq, 9);
  assert.equal(isSupersededDuckHold(holds, key, 10), false);
});

test('hold numbers are scoped per actor and per client session', () => {
  const holds = new Map();
  rememberReleasedDuckHold(holds, duckHoldKey('dj-1', 'phone'), 7, { now: 0 });
  assert.equal(isSupersededDuckHold(holds, duckHoldKey('dj-1', 'desktop'), 1), false);
  assert.equal(isSupersededDuckHold(holds, duckHoldKey('dj-2', 'phone'), 1), false);
  assert.equal(isSupersededDuckHold(holds, duckHoldKey('dj-1', 'phone-after-reload'), 1), false);
});

test('a client that sends no hold number falls back to the lease-id guard only', () => {
  const holds = new Map();
  rememberReleasedDuckHold(holds, key, undefined, { now: 0 });
  assert.equal(holds.size, 0);
  assert.equal(isSupersededDuckHold(holds, key, undefined), false);
  assert.equal(shouldIgnoreDuckAcquire({
    leaseId: 'lease-x', key, releasedLeases: new Set(['lease-x']), releasedHolds: holds,
  }), 'lease-already-released');
});

// ---- the two boundaries where the refusal genuinely ends ----

test('BOUNDARY: an evicted session stops being refused - and probation bounds what that costs', () => {
  const holds = new Map();
  const evicted = duckHoldKey('dj-1', 'evicted');
  rememberReleasedDuckHold(holds, evicted, 3, { now: 0 });
  let now = DUCK_HOLD_PROTECTED_MS + 1;
  for (let i = 0; i < MAX_TRACKED_DUCK_CLIENTS + 5; i++) {
    rememberReleasedDuckHold(holds, duckHoldKey('dj-1', `other-${i}`), 1, { now: now++ });
  }
  assert.equal(holds.has(evicted), false, 'the record is gone - the table is bounded');
  assert.equal(isSupersededDuckHold(holds, evicted, 3), false,
    'so a delayed acquire for it is no longer refused: "for ever" was never true');
  assert.equal(isKnownDuckSession(holds, evicted), false);
  assert.equal(leaseForDuckAcquire({ leaseMs: DUCK_LEASE_MS, known: false }), DUCK_PROBATION_LEASE_MS);
  assert.ok(DUCK_PROBATION_LEASE_MS < DUCK_LEASE_MS);
});

test('BOUNDARY: a kiosk reload keeps the watermarks, so a delayed acquire is still refused', () => {
  const storage = memoryStorage();
  const before = new Map();
  rememberReleasedDuckHold(before, key, 5, { now: 1_000 });
  assert.equal(saveReleasedDuckHolds(storage, before), true);
  const after = loadReleasedDuckHolds(storage, { now: 2_000 });
  assert.equal(after.get(key).seq, 5);
  assert.equal(isSupersededDuckHold(after, key, 5), true, 'the released hold is still refused');
  assert.equal(isSupersededDuckHold(after, key, 4), true);
  assert.equal(isSupersededDuckHold(after, key, 6), false, 'the next press still works');
});

test('a session idle beyond the retention window is dropped on load, and is then probationary', () => {
  const storage = memoryStorage();
  const holds = new Map();
  rememberReleasedDuckHold(holds, key, 2, { now: 0 });
  saveReleasedDuckHolds(storage, holds);
  const restored = loadReleasedDuckHolds(storage, { now: DUCK_HOLD_RETENTION_MS + 1 });
  assert.equal(restored.size, 0, 'records do not accumulate for ever');
  assert.equal(isKnownDuckSession(restored, key), false);
  assert.equal(leaseForDuckAcquire({ leaseMs: DUCK_LEASE_MS, known: false }), DUCK_PROBATION_LEASE_MS);
});

test('eviction never takes a released mark that is still fresh (the cap is SOFT)', () => {
  const holds = new Map();
  for (let i = 0; i < MAX_TRACKED_DUCK_CLIENTS + 10; i++) {
    rememberReleasedDuckHold(holds, duckHoldKey('dj-1', `fresh-${i}`), 1, { now: 10 });
  }
  assert.ok(holds.size > MAX_TRACKED_DUCK_CLIENTS,
    'the cap is exceeded rather than dropping something that could still be in flight');
  for (let i = 0; i < MAX_TRACKED_DUCK_CLIENTS + 10; i++) {
    assert.equal(isSupersededDuckHold(holds, duckHoldKey('dj-1', `fresh-${i}`), 1), true);
  }
});

test('an ordinary hold is never probationary twice', () => {
  const holds = new Map();
  assert.equal(isKnownDuckSession(holds, key), false);
  assert.equal(leaseForDuckAcquire({ leaseMs: DUCK_LEASE_MS, known: false }), DUCK_PROBATION_LEASE_MS);
  noteDuckSession(holds, key, { now: 0 });
  assert.equal(isKnownDuckSession(holds, key), true);
  assert.equal(leaseForDuckAcquire({ leaseMs: DUCK_LEASE_MS, known: true }), DUCK_LEASE_MS,
    'the renewal and every later press get the full lease');
  rememberReleasedDuckHold(holds, key, 1, { now: 1 });
  assert.equal(leaseForDuckAcquire({ leaseMs: DUCK_LEASE_MS, known: isKnownDuckSession(holds, key) }), DUCK_LEASE_MS);
});

test('storage that throws cannot break ducking', () => {
  const hostile = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(loadReleasedDuckHolds(hostile).size, 0);
  assert.equal(saveReleasedDuckHolds(hostile, new Map([[key, { seq: 1, at: 0 }]])), false);
  assert.equal(loadReleasedDuckHolds({ getItem: () => 'not json' }).size, 0);
});

test('only released watermarks are persisted, not bare session markers', () => {
  const storage = memoryStorage();
  const holds = new Map();
  noteDuckSession(holds, key, { now: 0 });
  saveReleasedDuckHolds(storage, holds);
  assert.equal(loadReleasedDuckHolds(storage, { now: 1 }).size, 0, 'nothing to remember yet');
  rememberReleasedDuckHold(holds, key, 1, { now: 0 });
  saveReleasedDuckHolds(storage, holds);
  assert.equal(loadReleasedDuckHolds(storage, { now: 1 }).get(key).seq, 1);
});

// ---- clients that connect and never release ----

test('10,000 acquire/renew-only sessions do NOT accumulate: the marker cap is HARD', () => {
  const holds = new Map();
  let now = 0;
  for (let i = 0; i < 10_000; i++) {
    noteDuckSession(holds, duckHoldKey('dj-1', `ghost-${i}`), { now: now += 1000 });
  }
  assert.ok(holds.size <= MAX_TRACKED_DUCK_SESSIONS,
    `expected at most ${MAX_TRACKED_DUCK_SESSIONS} records, found ${holds.size}`);
  assert.equal(isKnownDuckSession(holds, duckHoldKey('dj-1', 'ghost-9999')), true);
  assert.equal(isKnownDuckSession(holds, duckHoldKey('dj-1', 'ghost-0')), false);
});

test('a released watermark survives a flood of sessions that never release', () => {
  const holds = new Map();
  const real = duckHoldKey('dj-1', 'real-remote');
  rememberReleasedDuckHold(holds, real, 4, { now: 0 });
  let now = 0;
  for (let i = 0; i < 5_000; i++) {
    noteDuckSession(holds, duckHoldKey('dj-1', `ghost-${i}`), { now: now += 1000 });
  }
  assert.equal(isSupersededDuckHold(holds, real, 4), true,
    'evicting markers must never cost a refusal');
  assert.ok(holds.size <= MAX_TRACKED_DUCK_SESSIONS + MAX_TRACKED_DUCK_CLIENTS);
});

test('the two caps are different kinds: markers HARD, watermarks SOFT', () => {
  const markers = new Map();
  for (let i = 0; i < MAX_TRACKED_DUCK_SESSIONS + 50; i++) {
    noteDuckSession(markers, duckHoldKey('dj-1', `m-${i}`), { now: 10 });
  }
  assert.equal(markers.size, MAX_TRACKED_DUCK_SESSIONS, 'hard: exactly the cap');
  const marks = new Map();
  for (let i = 0; i < MAX_TRACKED_DUCK_CLIENTS + 10; i++) {
    rememberReleasedDuckHold(marks, duckHoldKey('dj-1', `w-${i}`), 1, { now: 10 });
  }
  assert.ok(marks.size > MAX_TRACKED_DUCK_CLIENTS, 'soft: the cap is exceeded while fresh');
  rememberReleasedDuckHold(marks, duckHoldKey('dj-1', 'later'), 1,
    { now: 10 + DUCK_HOLD_PROTECTED_MS + 1 });
  assert.ok(marks.size <= MAX_TRACKED_DUCK_CLIENTS + 1,
    'and comes back to the cap as soon as they are no longer fresh');
});

test('a marker for a session that later releases becomes a protected watermark', () => {
  const holds = new Map();
  const key2 = duckHoldKey('dj-1', 'promoted');
  noteDuckSession(holds, key2, { now: 0 });
  assert.equal(Number.isInteger(holds.get(key2).seq), false, 'a marker carries no watermark');
  rememberReleasedDuckHold(holds, key2, 3, { now: 1 });
  assert.equal(holds.get(key2).seq, 3);
  for (let i = 0; i < MAX_TRACKED_DUCK_SESSIONS + 20; i++) {
    noteDuckSession(holds, duckHoldKey('dj-1', `noise-${i}`), { now: 2 });
  }
  assert.equal(isSupersededDuckHold(holds, key2, 3), true, 'marker churn cannot evict it');
});