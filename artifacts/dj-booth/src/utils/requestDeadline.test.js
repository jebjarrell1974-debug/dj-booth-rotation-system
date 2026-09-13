import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestTimeoutError, withRequestDeadline } from './requestDeadline.js';

// A fake timer pair so each test can prove the timer was cleared exactly once.
function fakeTimers() {
  const state = { set: 0, cleared: 0, fns: new Map(), id: 0 };
  return {
    state,
    setTimeoutImpl(fn, ms) { state.set++; const id = ++state.id; state.fns.set(id, fn); return id; },
    clearTimeoutImpl(id) { state.cleared++; state.fns.delete(id); },
    fire() { for (const fn of [...state.fns.values()]) fn(); },
  };
}
const never = () => new Promise(() => {});

test('a stalled BODY still times out, even though headers arrived immediately', async () => {
  const t = fakeTimers();
  const op = withRequestDeadline(
    { timeoutMs: 50, label: '/booth/state', setTimeoutImpl: t.setTimeoutImpl, clearTimeoutImpl: t.clearTimeoutImpl },
    async (signal) => {
      // headers are already here...
      const res = { ok: true, status: 200, json: () => never() };   // ...body never completes
      await new Promise(r => setImmediate(r));
      signal.addEventListener('abort', () => {}, { once: true });
      return await Promise.race([
        res.json(),
        new Promise((_, rej) => signal.addEventListener('abort',
          () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })),
      ]);
    },
  );
  await new Promise(r => setImmediate(r));
  t.fire();                                    // the deadline elapses
  await assert.rejects(op, (e) => e instanceof RequestTimeoutError && e.code === 'REQUEST_TIMEOUT');
});

test('an ERROR response with a stalled body also times out', async () => {
  const t = fakeTimers();
  const op = withRequestDeadline(
    { timeoutMs: 50, label: '/booth/command', setTimeoutImpl: t.setTimeoutImpl, clearTimeoutImpl: t.clearTimeoutImpl },
    async (signal) => {
      const res = { ok: false, status: 500, json: () => never() };  // error body never completes
      if (!res.ok) {
        return await Promise.race([
          res.json(),
          new Promise((_, rej) => signal.addEventListener('abort',
            () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })),
        ]);
      }
    },
  );
  await new Promise(r => setImmediate(r));
  t.fire();
  await assert.rejects(op, (e) => e.code === 'REQUEST_TIMEOUT');
});

test('a timeout is flagged resultUnknown, never "not applied"', async () => {
  const t = fakeTimers();
  const op = withRequestDeadline(
    { timeoutMs: 10, label: 'x', setTimeoutImpl: t.setTimeoutImpl, clearTimeoutImpl: t.clearTimeoutImpl },
    async (signal) => await new Promise((_, rej) =>
      signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })), { once: true })),
  );
  await new Promise(r => setImmediate(r));
  t.fire();
  await assert.rejects(op, (e) => e.resultUnknown === true);
});

test('the timer is cleared after a SUCCESSFUL operation', async () => {
  const t = fakeTimers();
  const value = await withRequestDeadline(
    { timeoutMs: 1000, setTimeoutImpl: t.setTimeoutImpl, clearTimeoutImpl: t.clearTimeoutImpl },
    async () => ({ ok: true }),
  );
  assert.deepEqual(value, { ok: true });
  assert.equal(t.state.set, 1);
  assert.equal(t.state.cleared, 1, 'timer must be cleared exactly once');
});

test('the timer is cleared after a FAILED operation', async () => {
  const t = fakeTimers();
  await assert.rejects(withRequestDeadline(
    { timeoutMs: 1000, setTimeoutImpl: t.setTimeoutImpl, clearTimeoutImpl: t.clearTimeoutImpl },
    async () => { throw new Error('boom'); },
  ), /boom/);
  assert.equal(t.state.cleared, 1);
});

test('caller cancellation aborts the operation and is not reported as a timeout', async () => {
  const t = fakeTimers();
  const caller = new AbortController();
  const op = withRequestDeadline(
    { timeoutMs: 10_000, signal: caller.signal, setTimeoutImpl: t.setTimeoutImpl, clearTimeoutImpl: t.clearTimeoutImpl },
    async (signal) => await new Promise((_, rej) =>
      signal.addEventListener('abort', () => rej(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true })),
  );
  await new Promise(r => setImmediate(r));
  caller.abort();
  await assert.rejects(op, (e) => e.name === 'AbortError' && !(e instanceof RequestTimeoutError));
  assert.equal(t.state.cleared, 1, 'the deadline timer must not be left running');
});

test('an already-aborted caller signal aborts immediately', async () => {
  const caller = new AbortController();
  caller.abort();
  await assert.rejects(withRequestDeadline({ timeoutMs: 1000, signal: caller.signal }, async (signal) => {
    assert.equal(signal.aborted, true);
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  }), (e) => e.name === 'AbortError');
});

test('timeoutMs of 0 means no deadline and sets no timer', async () => {
  const t = fakeTimers();
  const v = await withRequestDeadline(
    { timeoutMs: 0, setTimeoutImpl: t.setTimeoutImpl, clearTimeoutImpl: t.clearTimeoutImpl },
    async () => 'done',
  );
  assert.equal(v, 'done');
  assert.equal(t.state.set, 0);
});