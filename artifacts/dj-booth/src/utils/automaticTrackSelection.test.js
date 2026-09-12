import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATIC_SELECTION_EXCLUDED_GENRES,
  AUTOMATIC_COOLDOWN_MS,
  AUTOMATIC_COOLDOWN_SCOPE,
  AUTOMATIC_HISTORY_SCOPE,
  fetchAutomaticHistory,
  fetchRecentSongHistory,
  filterAutomaticTracks,
  filterUnplayedAutomaticTracks,
  getRecentSongHistory,
  hydrateAutomaticHistory,
  isAutomaticSelectionExcluded,
  isRecentlyPlayed,
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

test('automatic fallback ages out old ledger entries while retaining recent exclusions', () => {
  const now = Date.parse('2026-01-02T12:00:00.000Z');
  const tracks = [
    { name: 'old-play.mp3', genre: 'House' },
    { name: 'recent-play.mp3', genre: 'House' },
    { name: 'never-played.mp3', genre: 'House' },
  ];
  assert.deepEqual(
    filterUnplayedAutomaticTracks(
      tracks,
      {
        'old-play.mp3': now - AUTOMATIC_COOLDOWN_MS - 1,
        'recent-play.mp3': now - AUTOMATIC_COOLDOWN_MS + 1,
      },
      [],
      now,
    ),
    [tracks[0], tracks[2]],
  );
  assert.equal(isRecentlyPlayed('old-play.mp3', { 'old-play.mp3': now - AUTOMATIC_COOLDOWN_MS - 1 }, now), false);
  assert.equal(isRecentlyPlayed('boundary-play.mp3', { 'boundary-play.mp3': now - AUTOMATIC_COOLDOWN_MS }, now), false);
  assert.equal(isRecentlyPlayed('recent-play.mp3', { 'recent-play.mp3': now - AUTOMATIC_COOLDOWN_MS + 1 }, now), true);
  assert.deepEqual(
    getRecentSongHistory(
      {
        'old-play.mp3': now - AUTOMATIC_COOLDOWN_MS - 1,
        'recent-play.mp3': now - AUTOMATIC_COOLDOWN_MS + 1,
      },
      now,
    ),
    { 'recent-play.mp3': now - AUTOMATIC_COOLDOWN_MS + 1 },
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

test('automatic fallback applies recent-history and one-shot exclusions case-insensitively', () => {
  const now = Date.parse('2026-01-02T12:00:00.000Z');
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
      { 'OLD-SONG.MP3': now - AUTOMATIC_COOLDOWN_MS - 1 },
      new Set(['IN-BREAK.MP3']),
      now,
    ),
    [tracks[0], tracks[2]],
  );
});

test('history hydration accepts a complete cooldown map and preserves scope compatibility', () => {
  assert.deepEqual(
    hydrateAutomaticHistory({
      scope: 'all',
      cooldowns: { 'old-song.mp3': 123 },
    }, { scope: 'all' }),
    {
      ready: true,
      scope: 'all',
      cooldowns: { 'old-song.mp3': 123 },
      error: null,
    },
  );
  assert.deepEqual(hydrateAutomaticHistory({ cooldowns: {} }), {
    ready: true,
    scope: AUTOMATIC_COOLDOWN_SCOPE,
    cooldowns: {},
    error: null,
  });
  assert.equal(AUTOMATIC_HISTORY_SCOPE, AUTOMATIC_COOLDOWN_SCOPE);
  assert.equal(hydrateAutomaticHistory({ scope: 'recent', cooldowns: {} }).ready, true);
  assert.equal(hydrateAutomaticHistory({ scope: 'all', cooldowns: {} }).ready, true);
  assert.equal(hydrateAutomaticHistory({ cooldowns: { broken: 0 } }).ready, false);
  assert.equal(hydrateAutomaticHistory({}).ready, false);
  assert.equal(hydrateAutomaticHistory({ cooldowns: {} }, { scope: 'recent' }).ready, true);
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

test('history fetch requests six-hour cooldowns and marks readiness after valid hydration', async () => {
  let endpoint = '';
  const result = await fetchAutomaticHistory({
    retries: 1,
    retryDelayMs: 0,
    fetchImpl: async requestEndpoint => {
      endpoint = requestEndpoint;
      return {
        ok: true,
        json: async () => ({ cooldowns: { 'played.mp3': 1 } }),
      };
    },
  });

  assert.equal(result.ready, true);
  assert.equal(result.scope, AUTOMATIC_COOLDOWN_SCOPE);
  assert.deepEqual(result.cooldowns, { 'played.mp3': 1 });
  assert.equal(result.attempts, 1);
  assert.match(endpoint, /hours=6/);
  assert.equal(fetchRecentSongHistory, fetchAutomaticHistory);
});

test('automatic fallback returns an empty pool when every track is recent', () => {
  const now = Date.parse('2026-01-02T12:00:00.000Z');
  const tracks = [
    { name: 'one.mp3', genre: 'House' },
    { name: 'two.mp3', genre: 'House' },
  ];
  const history = {
    'one.mp3': now - 1,
    'two.mp3': now - AUTOMATIC_COOLDOWN_MS + 1,
  };
  assert.deepEqual(filterUnplayedAutomaticTracks(tracks, history, [], now), []);
});
