import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATIC_SELECTION_EXCLUDED_GENRES,
  filterAutomaticTracks,
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
