import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capSongAssignments,
  capSongList,
  fillSongListToLimit,
  normalizeSongsPerSet,
} from './rotationAssignments.js';

test('caps stale assignments to the configured set length', () => {
  const assignments = {
    rylei: ['one.mp3', 'two.mp3', 'three.mp3'],
    lydia: ['four.mp3', 'five.mp3'],
  };

  assert.deepEqual(capSongAssignments(assignments, 2), {
    rylei: ['one.mp3', 'two.mp3'],
    lydia: ['four.mp3', 'five.mp3'],
  });
});

test('keeps the leading tracks and never mutates the original list', () => {
  const songs = [{ name: 'one' }, { name: 'two' }, { name: 'three' }];
  const capped = capSongList(songs, 2);

  assert.deepEqual(capped, songs.slice(0, 2));
  assert.equal(songs.length, 3);
});

test('preserves references when assignments already fit', () => {
  const assignments = { cash: ['one.mp3', 'two.mp3'] };
  assert.equal(capSongAssignments(assignments, 2), assignments);
  assert.equal(capSongList(assignments.cash, 2), assignments.cash);
});

test('allows a larger set length without adding or removing tracks', () => {
  const assignments = { rose: ['one.mp3', 'two.mp3'] };
  assert.equal(capSongAssignments(assignments, 3), assignments);
});

test('growing a set adds exactly the missing number and preserves DJ picks', () => {
  const existing = [{ name: 'picked-one.mp3' }, { name: 'picked-two.mp3' }];
  const candidates = [
    { name: 'picked-two.mp3' },
    { name: 'new-three.mp3' },
    { name: 'unused-four.mp3' },
  ];

  assert.deepEqual(fillSongListToLimit(existing, candidates, 3), [
    { name: 'picked-one.mp3' },
    { name: 'picked-two.mp3' },
    { name: 'new-three.mp3' },
  ]);
});

test('a late async result is capped against the latest set length at commit time', async () => {
  let currentSetLength = 3;
  let releaseResult;
  const delayedResult = new Promise(resolve => {
    releaseResult = resolve;
  });
  let committed;

  const pendingWriter = (async () => {
    const result = await delayedResult;
    committed = capSongAssignments(result, currentSetLength);
  })();

  currentSetLength = 2;
  releaseResult({ rylei: ['one.mp3', 'two.mp3', 'late-three.mp3'] });
  await pendingWriter;

  assert.deepEqual(committed, { rylei: ['one.mp3', 'two.mp3'] });
});

test('a late automatic result cannot replace a newer DJ assignment', async () => {
  let assignmentVersion = 0;
  let rotationSongs = {};
  let releaseAutomaticPick;
  const automaticPick = new Promise(resolve => {
    releaseAutomaticPick = resolve;
  });

  const capturedVersion = assignmentVersion;
  const pendingAutomaticWriter = (async () => {
    const result = await automaticPick;
    if (capturedVersion !== assignmentVersion) return;
    rotationSongs = capSongAssignments(result, 2);
  })();

  assignmentVersion += 1;
  rotationSongs = { rylei: ['dj-one.mp3', 'dj-two.mp3'] };
  releaseAutomaticPick({ rylei: ['auto-one.mp3', 'auto-two.mp3', 'auto-three.mp3'] });
  await pendingAutomaticWriter;

  assert.deepEqual(rotationSongs, { rylei: ['dj-one.mp3', 'dj-two.mp3'] });
});

test('normalizes invalid set lengths safely', () => {
  assert.equal(normalizeSongsPerSet('2'), 2);
  assert.equal(normalizeSongsPerSet(0), 1);
  assert.deepEqual(capSongList(['one', 'two'], 0), ['one']);
});