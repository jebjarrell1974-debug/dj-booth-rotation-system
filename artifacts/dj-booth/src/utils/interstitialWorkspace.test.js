import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearInterstitialBreak,
  commitInterstitialWorkspace,
  retainInterstitialQueuesForAutomaticCount,
} from './interstitialWorkspace.js';

const songs20 = Array.from({ length: 20 }, (_, index) => `manual-${index + 1}.mp3`);

test('manual 20-song break survives automatic default zero', () => {
  const committed = commitInterstitialWorkspace(
    { 'after-1': songs20 },
    { markManual: ['after-1'] },
  );
  const retained = retainInterstitialQueuesForAutomaticCount(
    committed.songs,
    committed.manualBreaks,
    0,
  );
  assert.deepEqual(retained.songs['after-1'], songs20);
  assert.equal(retained.manualBreaks['after-1'], true);
});

test('a manual queue added while default is zero remains ordered and owned after reload', () => {
  const committed = commitInterstitialWorkspace(
    { 'after-7': ['one.mp3', 'two.mp3', 'three.mp3'] },
    { markManual: ['after-7'] },
  );
  const reloaded = commitInterstitialWorkspace(
    JSON.parse(JSON.stringify(committed.songs)),
    { manualBreaks: JSON.parse(JSON.stringify(committed.manualBreaks)) },
  );
  assert.deepEqual(reloaded.songs['after-7'], ['one.mp3', 'two.mp3', 'three.mp3']);
  assert.deepEqual(reloaded.manualBreaks, { 'after-7': true });
});

test('completion reset clears only the consumed break ownership and queue', () => {
  const reset = clearInterstitialBreak(
    { 'after-1': ['done.mp3'], 'after-2': songs20 },
    { 'after-1': true, 'after-2': true },
    'after-1',
  );
  assert.equal(reset.songs['after-1'], undefined);
  assert.equal(reset.manualBreaks['after-1'], undefined);
  assert.equal(reset.songs['after-2'].length, 20);
  assert.equal(reset.manualBreaks['after-2'], true);
});

test('automatic default changes preserve queue order and only automatic queues may be dropped', () => {
  const retained = retainInterstitialQueuesForAutomaticCount(
    {
      'after-1': ['manual-a.mp3', 'manual-b.mp3'],
      'after-2': ['automatic-a.mp3', 'automatic-b.mp3'],
    },
    { 'after-1': true },
    0,
  );
  assert.deepEqual(retained.songs, { 'after-1': ['manual-a.mp3', 'manual-b.mp3'] });
  assert.deepEqual(retained.manualBreaks, { 'after-1': true });
});