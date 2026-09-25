import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceBlockedCurrentSlot } from './deactivationSet.js';

test('first song is replaced in place without moving the reserved second song', () => {
  assert.deepEqual(
    replaceBlockedCurrentSlot([{ name: 'blocked' }, { name: 'second' }], 'blocked', 0, { name: 'fresh' }),
    [{ name: 'fresh' }, { name: 'second' }],
  );
});

test('failed fresh pick leaves first slot empty, never promotes song two', () => {
  const tracks = replaceBlockedCurrentSlot([{ name: 'blocked' }, { name: 'second' }], 'blocked', 0, null);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0], undefined);
  assert.equal(tracks[1].name, 'second');
});

test('second song replacement preserves first and does not reuse a blocked duplicate', () => {
  assert.deepEqual(
    replaceBlockedCurrentSlot([{ name: 'first' }, { name: 'blocked' }, { name: 'blocked' }], 'blocked', 1, { name: 'fresh' }),
    [{ name: 'first' }, { name: 'fresh' }, undefined],
  );
});