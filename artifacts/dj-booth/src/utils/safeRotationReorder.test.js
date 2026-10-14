import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRotationReorder } from './safeRotationReorder.js';

test('dragging last to top queues her after the active performer', () => {
  assert.deepEqual(safeRotationReorder(['C', 'A', 'B'], 'A', 'C', 0), {
    ok: true, rotation: ['A', 'C', 'B'], currentIndex: 0,
  });
});
test('active performer at a nonzero index stays owner', () => {
  assert.deepEqual(safeRotationReorder(['D', 'A', 'B', 'C'], 'B', 'D', 0), {
    ok: true, rotation: ['A', 'B', 'D', 'C'], currentIndex: 1,
  });
});
test('non-top reorder follows the same performer without skipping', () => {
  assert.equal(safeRotationReorder(['C', 'B', 'A'], 'A', 'C', 1).currentIndex, 2);
});
test('reject removing active performer and tolerate string IDs', () => {
  assert.equal(safeRotationReorder([2, 3], 1, 3, 0).ok, false);
  assert.deepEqual(safeRotationReorder([3, 1, 2], '1', '3', 0).rotation, [1, 3, 2]);
});
test('moving the active performer never selects another performer', () => {
  assert.equal(safeRotationReorder(['A', 'B', 'C'], 'A', 'A', 0).currentIndex, 0);
});
