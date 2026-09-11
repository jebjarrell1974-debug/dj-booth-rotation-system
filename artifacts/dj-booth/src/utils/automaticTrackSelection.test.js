import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATIC_SELECTION_EXCLUDED_GENRES,
  AUTOMATIC_HISTORY_SCOPE,
  fetchAutomaticHistory,
  filterAutomaticTracks,
  filterUnplayedAutomaticTracks,
  hydrateAutomaticHistory,
  isAutomaticSelectionExcluded,
} from './automaticTrackSelection.js';

test('automatic selection excludes promo and DJ-only folders case-insensitively', () => {
  const tracks = [
    { name: 'regular.mp3', genre: 'House' },
    { name: 'bed.mp3', genre: 'Promo Beds' },
    { name: 'bed-upper.mp3', genre: 'PROMO BEDS' },
    { name: 'promo.mp3', genre: 'Promos' },
    { name: 'promo-upper.mp3', genre: 'PROMOS' },
    { name: 'feature.mp3', genre: 'FEATURE' },
    { name: 'dj-only.mp3', genre: 'z dj only' },
  ];

  assert.deepEqual(filterAutomaticTracks(tracks), [tracks[0]]);
  assert.equal(isAutomaticSelectionExcluded(tracks[1]), true);
  assert.equal(isAutomaticSelectionExcluded(tracks[2]), true);
  assert.equal(isAutomaticSelectionExcluded(tracks[3]), true);
  assert.equal(isAutomaticSelectionExcluded(tracks[4]), true);
  assert.equal(isAutomaticSelectionExcluded(tracks[5]), true);
  assert.equal(isAutomaticSelectionExcluded(tracks[6]), true);
  assert.deepEqual(
    [...AUTOMATIC_SELECTION_EXCLUDED_GENRES],
    ['Promo Beds', 'Promos', 'FEATURE', 'Z DJ ONLY'],
  );
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

test('automatic fallback applies all-history and one-shot exclusions case-insensitively', () => {
  const tracks = [
    { name: 'old-song.mp3', genre: 'House' },
    { name: 'in-break.mp3', genre: 'House' },
    { name: 'fresh-song.mp3', genre: 'House' },
    { name: 'promo.mp3', genre: 'Promos' },
    { name: 'dj-only.mp3', genre: 'Z DJ ONLY' },
  ];

  assert.deepEqual(
    filterUnplayedAutomaticTracks(
      tracks,
      { 'OLD-SONG.MP3': 123 },
      new Set(['IN-BREAK.MP3']),
    ),
    [tracks[2]],
  );
});

test('history hydration accepts only a complete all-scope cooldown map', () => {
  assert.deepEqual(
    hydrateAutomaticHistory({
      scope: 'all',
      cooldowns: { 'old-song.mp3': 123 },
    }),
    {
      ready: true,
      scope: AUTOMATIC_HISTORY_SCOPE,
      cooldowns: { 'old-song.mp3': 123 },
      error: null,
    },
  );
  assert.equal(hydrateAutomaticHistory({ cooldowns: {} }).ready, true);
  assert.equal(hydrateAutomaticHistory({ scope: 'recent', cooldowns: {} }).ready, false);
  assert.equal(hydrateAutomaticHistory({ cooldowns: { broken: 0 } }).ready, false);
  assert.equal(hydrateAutomaticHistory({}).ready, false);
  assert.equal(hydrateAutomaticHistory({ cooldowns: {} }, { scope: 'recent' }).ready, false);
});

test('history fetch retries startup/auth failures without returning stale fallback data', async () => {
  let calls = 0;
  const result = await fetchAutomaticHistory({
    retries: 2,
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: calls === 1 ? 503 : 401 };
    },
  });

  assert.equal(calls, 3);
  assert.equal(result.ready, false);
  assert.deepEqual(result.cooldowns, {});
  assert.match(result.error, /401/);
});

test('history fetch marks readiness only after successful all-scope hydration', async () => {
  const result = await fetchAutomaticHistory({
    retries: 1,
    retryDelayMs: 0,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ scope: 'all', cooldowns: { 'played.mp3': 1 } }),
    }),
  });

  assert.equal(result.ready, true);
  assert.equal(result.scope, 'all');
  assert.deepEqual(result.cooldowns, { 'played.mp3': 1 });
  assert.equal(result.attempts, 1);
});
