import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceActiveSet,
  beginActiveSet,
  createActiveSetCursor,
  locateCursorDancer,
  ownsActiveSet,
  planActiveSetTransition,
  remainingVipMs,
} from './activeSetCursor.js';

test('manual two-song set advances without changing ownership', () => {
  const first = beginActiveSet(createActiveSetCursor(), { dancerId: 'manual', setLength: 2 });
  const second = advanceActiveSet(first, 2);
  assert.deepEqual(second, { dancerId: 'manual', songNumber: 2, setLength: 2, generation: 1 });
  assert.equal(locateCursorDancer(second, ['next', 'manual']), 1);
});

test('non-current VIP mutations do not change active-set ownership', () => {
  const cursor = beginActiveSet(createActiveSetCursor(), { dancerId: 'active', setLength: 2 });
  const changedRotation = ['other', 'active'];
  assert.equal(locateCursorDancer(cursor, changedRotation), 1);
  assert.equal(ownsActiveSet(cursor, { dancerId: 'active', generation: cursor.generation }), true);
});

test('stale completion cannot advance a newer dancer cursor', () => {
  const old = beginActiveSet(createActiveSetCursor(), { dancerId: 'old', setLength: 2 });
  const current = beginActiveSet(old, { dancerId: 'new', setLength: 2 });
  assert.equal(advanceActiveSet(current, 2, old.generation), current);
  assert.equal(current.songNumber, 1);
});

test('branch decision stays on the active set until its frozen boundary', () => {
  const cursor = beginActiveSet(createActiveSetCursor(), { dancerId: 'dancer', setLength: 2 });
  assert.deepEqual(planActiveSetTransition(cursor, {
    dancerId: 'dancer', generation: cursor.generation, nextSongNumber: 2,
  }), { kind: 'song', songNumber: 2 });
  assert.deepEqual(planActiveSetTransition(cursor, {
    dancerId: 'dancer', generation: cursor.generation, nextSongNumber: 3,
  }), { kind: 'dancer' });
  assert.deepEqual(planActiveSetTransition(cursor, {
    dancerId: 'dancer', generation: cursor.generation + 1, nextSongNumber: 2,
  }), { kind: 'stale' });
});

test('remote VIP countdown decays from monotonic receipt time', () => {
  assert.equal(remainingVipMs({ remainingMs: 60000 }, 1000, 999999, 1600), 59400);
  assert.equal(remainingVipMs({ remainingMs: 60000 }, 1000, 999999, 70000), 0);
});