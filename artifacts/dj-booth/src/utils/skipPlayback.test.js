import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canCommitAssignmentRefill,
  planSkipAdvance,
  remoteSkipPayload,
  songNumberAfterPlayback,
} from './skipPlayback.js';

test('small song skip advances a three-song set one song at a time', () => {
  const first = planSkipAdvance({
    currentSongNumber: 1,
    songsPerSet: 3,
    trackCount: 3,
  });
  assert.deepEqual(first, {
    accepted: true,
    kind: 'song',
    trackIndex: 1,
    songNumber: 2,
  });

  const second = planSkipAdvance({
    currentSongNumber: first.songNumber,
    songsPerSet: 3,
    trackCount: 3,
  });
  assert.deepEqual(second, {
    accepted: true,
    kind: 'song',
    trackIndex: 2,
    songNumber: 3,
  });

  assert.equal(
    planSkipAdvance({
      currentSongNumber: second.songNumber,
      songsPerSet: 3,
      trackCount: 3,
    }).kind,
    'entertainer',
  );
});

test('a short live queue still advances within the configured set', () => {
  assert.deepEqual(
    planSkipAdvance({
      currentSongNumber: 2,
      songsPerSet: 3,
      trackCount: 1,
    }),
    {
      accepted: true,
      kind: 'song',
      trackIndex: 2,
      songNumber: 3,
    },
  );
});

test('Next Entertainer explicitly skips the whole set', () => {
  assert.deepEqual(
    planSkipAdvance({
      skipBreaks: true,
      currentSongNumber: 1,
      songsPerSet: 3,
      trackCount: 3,
    }),
    { accepted: true, kind: 'entertainer' },
  );
});

test('remote song and entertainer controls carry distinct intent', () => {
  assert.deepEqual(remoteSkipPayload(false), {});
  assert.deepEqual(remoteSkipPayload(true), { skipBreaks: true });
});

test('a locked skip is rejected without changing the song number', () => {
  assert.deepEqual(
    planSkipAdvance({
      skipLocked: true,
      currentSongNumber: 2,
      songsPerSet: 3,
      trackCount: 3,
    }),
    { accepted: false, kind: 'locked', songNumber: 2 },
  );
});

test('an async refill commits only against the assignment version it observed', () => {
  assert.equal(canCommitAssignmentRefill(7, 7), true);
  assert.equal(canCommitAssignmentRefill(7, 8), false);
});

test('failed playback retains the current song number', () => {
  assert.equal(songNumberAfterPlayback(1, 2, true), 2);
  assert.equal(songNumberAfterPlayback(1, 2, false), 1);
});

test('a successful intentional automatic fallback advances the song number', () => {
  assert.equal(songNumberAfterPlayback(2, 3, true), 3);
});