import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEDUPE_WINDOW_MS, interpretReceipt, reconcileCommandOutcome } from './commandReconcile.js';

// A controllable clock so the settle window can be exercised without real waiting.
function harness({ lookups = [], byId = [], epoch = 'E1', epochAtSend = 'E1', submittedAgoMs = 1_000 }) {
  let t = 1_000_000;
  const calls = { lookup: 0, byId: 0, epoch: 0 };
  const deps = {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    getServerEpoch: async () => { calls.epoch++; return epoch; },
    lookupByRequestId: async () => {
      const next = lookups[Math.min(calls.lookup, lookups.length - 1)];
      calls.lookup++;
      if (next instanceof Error) throw next;
      return next;
    },
    getReceiptById: async () => {
      const next = byId[Math.min(calls.byId, byId.length - 1)];
      calls.byId++;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { deps, calls, ctx: { serverEpochAtSend: epochAtSend, submittedAt: t - submittedAgoMs, settleMs: 8_000, pollMs: 1_000 } };
}
const rec = (over = {}) => ({ ok: false, queued: true, serverEpoch: 'E1', command: { id: 5, requestId: 'R1', status: 'pending' }, ...over });
const applied = () => ({ ok: true, queued: false, serverEpoch: 'E1', command: { id: 5, requestId: 'R1', status: 'applied' } });

test('LATE APPLICATION: pending then applied inside the settle window resolves as applied', async () => {
  const h = harness({ lookups: [rec(), rec(), applied()] });
  const r = await reconcileCommandOutcome(h.deps, { ...h.ctx, requestId: 'R1', commandId: 5 });
  assert.equal(r.outcome, 'applied');
  assert.equal(r.resolved, true);
  assert.ok(h.calls.lookup >= 3, 'it kept checking rather than trusting the first sample');
});

test('LOST SUBMISSION RESPONSE: no commandId, the requestId lookup still finds the outcome', async () => {
  const h = harness({ lookups: [applied()] });
  const r = await reconcileCommandOutcome(h.deps, { ...h.ctx, requestId: 'R1', commandId: undefined });
  assert.equal(r.outcome, 'applied');
  assert.equal(h.calls.byId, 0, 'must not fall back to a numeric id when a requestId exists');
});

test('SERVER RESTART: a changed epoch is unknown, and nothing is looked up or replayed', async () => {
  const h = harness({ epoch: 'E2', epochAtSend: 'E1', lookups: [applied()] });
  const r = await reconcileCommandOutcome(h.deps, { ...h.ctx, requestId: 'R1', commandId: 5 });
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.reason, 'server-restarted');
  assert.equal(r.resolved, false);
  assert.equal(h.calls.lookup, 0);
});

test('REUSED NUMERIC IDS: a receipt for the same id but a different request is rejected', async () => {
  // after a restart the ids begin again, so id 5 can belong to somebody else entirely
  const foreign = { ok: true, queued: false, serverEpoch: 'E1',
                    command: { id: 5, requestId: 'SOMEONE-ELSE', status: 'applied' } };
  const h = harness({ lookups: [foreign] });
  const r = await reconcileCommandOutcome(h.deps, { ...h.ctx, requestId: 'R1', commandId: 5 });
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.reason, 'identity-mismatch');
});

test('REUSED NUMERIC IDS: a receipt from a different server epoch is rejected', async () => {
  const foreign = { ok: true, queued: false, serverEpoch: 'E9',
                    command: { id: 5, requestId: 'R1', status: 'applied' } };
  const h = harness({ lookups: [foreign], epoch: 'E1', epochAtSend: 'E1' });
  const r = await reconcileCommandOutcome(h.deps, { ...h.ctx, requestId: 'R1' });
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.reason, 'identity-mismatch');
});

test('EXPIRED DE-DUPLICATION: no record and past the window is unknown, never a replay', async () => {
  const h = harness({ lookups: [null], submittedAgoMs: DEDUPE_WINDOW_MS + 1_000 });
  const r = await reconcileCommandOutcome(h.deps, { ...h.ctx, requestId: 'R1' });
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.reason, 'dedupe-expired');
});

test('NO RECORD inside the window stays unknown after the bounded wait', async () => {
  const h = harness({ lookups: [null] });
  const r = await reconcileCommandOutcome(h.deps, { ...h.ctx, requestId: 'R1' });
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.reason, 'no-record');
  assert.equal(r.resolved, false);
});

test('STALLED BODIES: lookup timeouts are retried, then reported unresolved - not failed', async () => {
  const boom = Object.assign(new Error('Request timed out'), { code: 'REQUEST_TIMEOUT', resultUnknown: true });
  const h = harness({ lookups: [boom] });
  const r = await reconcileCommandOutcome(h.deps, { ...h.ctx, requestId: 'R1' });
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.reason, 'unreachable');
  assert.ok(h.calls.lookup > 1, 'it retried while time allowed');
});

test('A STILL-PENDING command ends bounded and unresolved, not silently successful', async () => {
  const h = harness({ lookups: [rec()] });
  const r = await reconcileCommandOutcome(h.deps, { ...h.ctx, requestId: 'R1', commandId: 5 });
  assert.equal(r.outcome, 'pending');
  assert.equal(r.resolved, false);
});

test('an expired command reports failed with the server own reason', () => {
  const r = interpretReceipt({ ok: false, queued: false,
    command: { status: 'expired', error: 'The command expired before the kiosk applied it' } });
  assert.equal(r.outcome, 'failed');
  assert.match(r.error, /expired before the kiosk applied it/);
});

// ---- the wiring itself, not just the policy -------------------------------

test('the API adapter reconciles with GETs ONLY - no POST can create a second command', () => {
  const src = readFileSync(new URL('../api/serverApi.js', import.meta.url), 'utf8');
  const start = src.indexOf('reconcileCommand:');
  assert.ok(start > 0, 'reconcileCommand must exist in serverApi');
  // slice to the next sibling property of the boothApi object
  const rest = src.slice(start + 1);
  const nextProp = rest.search(/\n {2}[A-Za-z_$][\w$]*:/);   // siblings sit at 2 spaces
  const block = src.slice(start, nextProp === -1 ? undefined : start + 1 + nextProp);
  assert.doesNotMatch(block, /method:\s*'POST'/, 'reconciliation must never POST');
  assert.match(block, /by-request\//, 'it must use the read-only actor-scoped lookup');
  assert.match(block, /reconcileCommandOutcome\(/, 'it must call the shared orchestration');
});

test('sendCommand captures the epoch and submission time AT SEND', () => {
  const src = readFileSync(new URL('../api/serverApi.js', import.meta.url), 'utf8');
  const i = src.indexOf('const identity = {');
  assert.ok(i > 0, 'the send-time context must be captured');
  const block = src.slice(i, i + 400);
  assert.match(block, /submittedAt: Date\.now\(\)/);
  assert.match(block, /serverEpochAtSend: options\.stateEpoch/);
});