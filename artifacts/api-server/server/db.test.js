import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Keep the suite isolated from the checked-in/live database.  DB_PATH must be
// set before db.js is imported because it opens the database at module load.
const testDir = mkdtempSync(join(tmpdir(), 'djbooth-db-selection-'));
process.env.DB_PATH = join(testDir, 'selection-test.db');
process.env.VOICEOVER_PATH = join(testDir, 'voiceovers');

const {
  default: db,
  closeDatabase,
  getAllPlayHistory,
  getRecentCooldowns,
  getMusicTrackByName,
  getRandomTracks,
  logPlayHistory,
  selectTracksForSet,
  cleanOldPlayHistory,
  stopCheckpoints,
  upsertMusicTrack,
} = await import('./db.js');

function addTrack(name, genre = 'House') {
  upsertMusicTrack(name, `/isolated/${name}`, genre, 0, '2026-01-01T00:00:00.000Z');
}

function names(tracks) {
  return tracks.map(track => track.name);
}

beforeEach(() => {
  db.exec('DELETE FROM play_history; DELETE FROM music_tracks;');
});

after(() => {
  stopCheckpoints();
  closeDatabase();
  rmSync(testDir, { recursive: true, force: true });
});

test('automatic picks exclude the persisted global history across dancers and breaks', () => {
  addTrack('dancer-one-song');
  addTrack('break-song');
  addTrack('never-played-song');

  logPlayHistory('dancer-one-song', 'Dancer One', 'House');
  logPlayHistory('break-song', null, 'House');

  const randomAutomatic = getRandomTracks(10, [], ['House'], true);
  assert.deepEqual(names(randomAutomatic), ['never-played-song']);

  const nextDancer = selectTracksForSet({
    count: 1,
    dancerPlaylist: ['dancer-one-song', 'never-played-song'],
    automatic: true,
    strictPlaylist: true,
  });
  assert.deepEqual(names(nextDancer), ['never-played-song']);

  logPlayHistory('never-played-song', 'Dancer Two', 'House');
  assert.deepEqual(
    selectTracksForSet({
      count: 1,
      dancerPlaylist: ['dancer-one-song', 'never-played-song'],
      automatic: true,
      strictPlaylist: true,
    }),
    [],
  );
});

test('automatic exhaustion returns no repeat instead of recycling an old play', () => {
  addTrack('only-song');
  logPlayHistory('only-song', 'Earlier Dancer', 'House');
  db.prepare(
    "UPDATE play_history SET played_at = datetime('now', 'localtime', '-365 days')"
  ).run();

  assert.deepEqual(getRandomTracks(1, [], ['House'], true), []);
  assert.deepEqual(
    selectTracksForSet({
      count: 1,
      genres: ['House'],
      dancerPlaylist: ['only-song'],
      automatic: true,
    }),
    [],
  );
});

test('explicit manual selection and library lookup may repeat played tracks', () => {
  addTrack('manual-repeat');
  logPlayHistory('manual-repeat', 'Dancer', 'House');

  const manualSet = selectTracksForSet({
    count: 1,
    dancerPlaylist: ['manual-repeat'],
    automatic: false,
    strictPlaylist: true,
  });
  assert.deepEqual(names(manualSet), ['manual-repeat']);
  assert.deepEqual(names(getRandomTracks(1, [], ['House'], false)), ['manual-repeat']);
  assert.equal(getMusicTrackByName('manual-repeat').name, 'manual-repeat');
});

test('play history cleanup preserves the durable no-repeat ledger', () => {
  addTrack('retained-history-song');
  logPlayHistory('retained-history-song', 'Dancer', 'House');
  db.prepare(
    "UPDATE play_history SET played_at = datetime('now', 'localtime', '-365 days')"
  ).run();

  assert.equal(cleanOldPlayHistory(1), 0);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM play_history WHERE track_name = ?')
      .get('retained-history-song').count,
    1,
  );
  assert.deepEqual(getRandomTracks(1, [], ['House'], true), []);
});

test('all-history map includes old plays while recent cooldowns keep their legacy window', () => {
  logPlayHistory('old-song', 'Earlier Dancer', 'House');
  logPlayHistory('recent-song', 'Current Dancer', 'House');
  db.prepare(`
    UPDATE play_history
    SET played_at = CASE track_name
      WHEN 'old-song' THEN datetime('now', 'localtime', '-365 days')
      ELSE datetime('now', 'localtime')
    END
  `).run();

  assert.deepEqual(
    getAllPlayHistory().map(row => row.track_name).sort(),
    ['old-song', 'recent-song'],
  );
  assert.deepEqual(
    getRecentCooldowns(4).map(row => row.track_name),
    ['recent-song'],
  );
});