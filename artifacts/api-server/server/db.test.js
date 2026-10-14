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
  blockTrack, unblockTrack, getBlockedTracks, getMusicTrackById,
  filterDeactivatedFromNames, createDancer, updateDancer, getDancer, listDancers, getMusicTracks,
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

test('deactivated music disappears from saved playlists, lookup and automatic picks until reactivated', () => {
  addTrack('Blocked Song.mp3');
  addTrack('Safe Song.mp3');
  const track = getMusicTrackByName('Blocked Song.mp3');
  const dancer = createDancer('Availability fixture', '#fff', '61839');
  updateDancer(dancer.id, { playlist: ['Blocked Song.mp3', 'Safe Song.mp3', 'Unresolved Name'] });
  blockTrack('BLOCKED SONG');
  assert.equal(getMusicTrackById(track.id), null);
  assert.equal(getMusicTrackByName('Blocked Song.mp3'), null);
  assert.equal(getMusicTrackByName('blocked song'), null);
  assert.equal(getMusicTrackByName('Blocked Song.mp3', { includeBlocked: true }).id, track.id);
  assert.equal(getMusicTrackById(track.id, { includeBlocked: true }).blocked, 1);
  assert.deepEqual(filterDeactivatedFromNames(['BLOCKED SONG', 'Safe Song.mp3', 'Unresolved Name']), ['Safe Song.mp3', 'Unresolved Name']);
  assert.deepEqual(getDancer(dancer.id).playlist, ['Safe Song.mp3', 'Unresolved Name']);
  assert.deepEqual(listDancers().find(row => row.id === dancer.id).playlist, ['Safe Song.mp3', 'Unresolved Name']);
  assert.equal(getMusicTracks().tracks.some(row => row.name === track.name), false);
  assert.equal(getRandomTracks(10).some(row => row.name === track.name), false);
  assert.equal(selectTracksForSet({ count: 2, dancerPlaylist: ['Blocked Song.mp3'], strictPlaylist: true }).length, 0);
  // Rescanning the existing file must not reactivate it.
  addTrack('Blocked Song.mp3');
  assert.equal(getMusicTrackById(track.id), null);
  assert.equal(getBlockedTracks().some(row => row.name === track.name), true);
  unblockTrack('blocked song');
  assert.equal(getMusicTrackById(track.id).name, track.name);
  assert.equal(getMusicTrackByName('Blocked Song').name, track.name);
  assert.deepEqual(getDancer(dancer.id).playlist, ['Blocked Song.mp3', 'Safe Song.mp3', 'Unresolved Name']);
});

test('automatic picks exclude recent global history across dancers and breaks', () => {
  addTrack('dancer-one-song');
  addTrack('break-song');
  addTrack('never-played-song');
  addTrack('older-song');

  logPlayHistory('dancer-one-song', 'Dancer One', 'House');
  logPlayHistory('break-song', null, 'House');
  logPlayHistory('older-song', 'Earlier Dancer', 'House');
  db.prepare(
    "UPDATE play_history SET played_at = datetime('now', 'localtime', '-7 hours') WHERE track_name = ?"
  ).run('older-song');

  const randomAutomatic = getRandomTracks(10, [], ['House'], true);
  assert.deepEqual(names(randomAutomatic).sort(), ['never-played-song', 'older-song']);

  const nextDancer = selectTracksForSet({
    count: 1,
    dancerPlaylist: ['dancer-one-song', 'older-song'],
    automatic: true,
    strictPlaylist: true,
  });
  assert.deepEqual(names(nextDancer), ['older-song']);

  logPlayHistory('older-song', 'Dancer Two', 'House');
  assert.deepEqual(
    selectTracksForSet({
      count: 1,
      dancerPlaylist: ['dancer-one-song', 'older-song'],
      automatic: true,
      strictPlaylist: true,
    }),
    [],
  );
});

test('automatic cooldown excludes the in-window boundary but allows older plays', () => {
  addTrack('just-played-song');
  addTrack('older-song');
  addTrack('never-played-song');
  logPlayHistory('just-played-song', 'Dancer', 'House');
  logPlayHistory('older-song', 'Dancer', 'House');
  db.prepare(`
    UPDATE play_history
    SET played_at = CASE track_name
      WHEN 'just-played-song' THEN datetime('now', 'localtime', '-5 hours', '-59 minutes')
      WHEN 'older-song' THEN datetime('now', 'localtime', '-6 hours', '-1 minutes')
    END
  `).run();

  assert.deepEqual(
    getRecentCooldowns().map(row => row.track_name),
    ['just-played-song'],
  );
  assert.deepEqual(
    names(getRandomTracks(10, [], ['House'], true)).sort(),
    ['never-played-song', 'older-song'],
  );
});

test('older playlist songs stay preferred before eligible folder filler', () => {
  addTrack('playlist-old-song');
  addTrack('playlist-recent-song');
  addTrack('folder-song');
  logPlayHistory('playlist-old-song', 'Earlier Dancer', 'House');
  logPlayHistory('playlist-recent-song', 'Earlier Dancer', 'House');
  db.prepare(
    "UPDATE play_history SET played_at = datetime('now', 'localtime', '-7 hours') WHERE track_name = ?"
  ).run('playlist-old-song');

  const tracks = selectTracksForSet({
    count: 2,
    genres: ['House'],
    dancerPlaylist: ['playlist-recent-song', 'playlist-old-song'],
    automatic: true,
  });
  assert.equal(tracks[0].name, 'playlist-old-song');
  assert.deepEqual(names(tracks).sort(), ['folder-song', 'playlist-old-song']);
});

test('automatic exhaustion does not recycle an in-window play', () => {
  addTrack('only-song');
  logPlayHistory('only-song', 'Earlier Dancer', 'House');

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

test('stale WMA rows are never returned as playable while playlist names remain intact', () => {
  upsertMusicTrack('legacy.wma', '/music/legacy.wma', 'House', 0, '2026-01-01T00:00:00.000Z');

  assert.equal(getMusicTrackByName('legacy.wma'), null);
  assert.deepEqual(
    selectTracksForSet({
      count: 1,
      dancerPlaylist: ['legacy.wma'],
      strictPlaylist: true,
      automatic: true,
    }),
    [],
  );
  assert.equal(db.prepare('SELECT name FROM music_tracks WHERE path = ?').get('/music/legacy.wma').name, 'legacy.wma');
});

test('WMA duplicate cannot shadow a playable track with the same name', () => {
  upsertMusicTrack('same-name.mp3', '/music/same-name.wma', 'House', 0, '2026-01-01T00:00:00.000Z');
  upsertMusicTrack('same-name.mp3', '/music/same-name.mp3', 'House', 0, '2026-01-01T00:00:00.000Z');

  assert.equal(getMusicTrackByName('same-name.mp3').path, '/music/same-name.mp3');
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
  assert.deepEqual(names(getRandomTracks(1, [], ['House'], true)), ['retained-history-song']);
});

test('all-history map includes old plays while recent cooldowns use six hours', () => {
  logPlayHistory('old-song', 'Earlier Dancer', 'House');
  logPlayHistory('recent-song', 'Current Dancer', 'House');
  db.prepare(`
    UPDATE play_history
    SET played_at = CASE track_name
      WHEN 'old-song' THEN datetime('now', 'localtime', '-7 hours')
      ELSE datetime('now', 'localtime')
    END
  `).run();

  assert.deepEqual(
    getAllPlayHistory().map(row => row.track_name).sort(),
    ['old-song', 'recent-song'],
  );
  assert.deepEqual(
    getRecentCooldowns().map(row => row.track_name),
    ['recent-song'],
  );
});
