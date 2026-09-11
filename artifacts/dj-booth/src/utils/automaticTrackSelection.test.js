import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATIC_SELECTION_EXCLUDED_GENRES,
  filterAutomaticTracks,
  filterUnplayedAutomaticTracks,
  isAutomaticSelectionExcluded,
} from './automaticTrackSelection.js';

test('automatic selection excludes both promo folders case-insensitively', () => {
  const tracks = [
    { name: 'regular.mp3', genre: 'House' },
    { name: 'bed.mp3', genre: 'Promo Beds' },
    { name: 'bed-upper.mp3', genre: 'PROMO BEDS' },
    { name: 'promo.mp3', genre: 'Promos' },
    { name: 'promo-upper.mp3', genre: 'PROMOS' },
  ];

  assert.deepEqual(filterAutomaticTracks(tracks), [tracks[0]]);
  assert.equal(isAutomaticSelectionExcluded(tracks[1]), true);
  assert.equal(isAutomaticSelectionExcluded(tracks[2]), true);
  assert.equal(isAutomaticSelectionExcluded(tracks[3]), true);
  assert.equal(isAutomaticSelectionExcluded(tracks[4]), true);
  assert.deepEqual([...AUTOMATIC_SELECTION_EXCLUDED_GENRES], ['Promo Beds', 'Promos']);
});

test('manual/library track metadata remains available to callers', () => {
  const promoBed = { id: 7, name: 'manual-bed.mp3', genre: 'Promo Beds' };
  const manualSelection = [promoBed];
  const automaticPool = filterAutomaticTracks([...manualSelection, { name: 'song.mp3', genre: 'House' }]);

  assert.equal(isAutomaticSelectionExcluded(promoBed), true);
  assert.equal(manualSelection[0], promoBed);
  assert.deepEqual(automaticPool, [{ name: 'song.mp3', genre: 'House' }]);
});

test('automatic fallback treats expired cooldown entries as permanently played', () => {
  const tracks = [
    { name: 'old-play.mp3', genre: 'House' },
    { name: 'never-played.mp3', genre: 'House' },
  ];
  assert.deepEqual(
    filterUnplayedAutomaticTracks(tracks, { 'old-play.mp3': 1 }),
    [tracks[1]],
  );
});

test('automatic fallback returns an empty pool instead of recycling exhausted tracks', () => {
  const tracks = [
    { name: 'one.mp3', genre: 'House' },
    { name: 'two.mp3', genre: 'House' },
  ];
  assert.deepEqual(
    filterUnplayedAutomaticTracks(tracks, new Set(['one.mp3', 'two.mp3'])),
    [],
  );
});
