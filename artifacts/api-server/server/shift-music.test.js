import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createStaffFixtureApp, database, closeStaffFixture } from './test-support/staff-fixture.js';
import { getActiveMusicGenres, filterAutomaticBreakSongs } from '../../dj-booth/src/utils/shiftMusicOptions.js';
import {
  filterAutomaticTracks, filterUnplayedAutomaticTracks, getRecentSongHistory,
} from '../../dj-booth/src/utils/automaticTrackSelection.js';

const serverSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const app = createStaffFixtureApp();
const middleware = serverSource.slice(serverSource.indexOf('function authenticate('), serverSource.indexOf('const DEFAULT_MASTER_PIN'));
const routeStart = serverSource.indexOf("app.post('/api/music/select'");
const routeEnd = serverSource.indexOf("app.post('/api/music/rescan'", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart);
const optionsStart = serverSource.indexOf("app.get('/api/dj-options'");
assert.ok(optionsStart >= 0 && optionsStart < routeStart);
// Actual authenticated product selection route and real SQLite/cooldown logic.
vm.runInNewContext(`${middleware}\n${serverSource.slice(optionsStart, routeEnd)}`, {
  app, ...database, broadcastSSE() {},
});
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const token = database.createSession('dj', null, 'Synthetic GM', 0, 'gm');
const source = readFileSync(new URL('../../dj-booth/src/pages/DJBooth.jsx', import.meta.url), 'utf8');
// The node:test subprocess reporter cannot reliably serialize console messages
// emitted from a VM realm. Assertions and real route/SQLite behavior stay intact.
const vmConsole = { log() {}, warn() {}, error() {} };
function callback(name, text = source) {
  const prefix = `const ${name} = useCallback(`;
  const start = text.indexOf(prefix);
  const end = text.indexOf('\n  }, [', start);
  assert.ok(start >= 0 && end > start, `actual ${name} callback must exist`);
  return `(${text.slice(start + prefix.length, end)}\n  })`;
}
const catalog = [
  { name: 'personal.mp3', genre: 'Personal' },
  { name: 'day-one.mp3', genre: 'Day' }, { name: 'day-two.mp3', genre: 'Day' },
  { name: 'night-one.mp3', genre: 'Night' }, { name: 'night-two.mp3', genre: 'Night' },
];
const options = { musicMode: 'dancer_first', activeGenres: ['Night'], dayShift: {
  enabled: true, startTime: '12:00', endTime: '20:00', genres: ['Day'],
} };
beforeEach(() => {
  database.default.exec('DELETE FROM play_history; DELETE FROM music_tracks;');
  for (const t of catalog) database.upsertMusicTrack(t.name, `/synthetic/${t.name}`, t.genre, 0, '2026-01-01T00:00:00Z');
});
after(async () => { await new Promise(resolve => server.close(resolve)); closeStaffFixture(); });

function context(hour, opts = options) {
  const requests = [];
  const date = new Date(2026, 9, 12, hour);
  const c = {
    console: vmConsole, AbortSignal,
    localStorage: { getItem: () => token },
    songsPerSetRef: { current: 2 }, djOptionsRef: { current: opts },
    rotationSongsRef: { current: {} }, songHistoryReadyRef: { current: true },
    songCooldownRef: { current: {} },
    getActiveMusicGenres: o => getActiveMusicGenres(o, date),
    filterAutomaticBreakSongs: (names, o, tracks, manual) => filterAutomaticBreakSongs(names, o, tracks, manual, date),
    filterAutomaticTracks, filterUnplayedAutomaticTracks, getRecentSongHistory,
    tracks: catalog, logDiag: () => {},
    fetch: async (path, init) => {
      requests.push(JSON.parse(init.body));
      return fetch(`http://127.0.0.1:${server.address().port}${path}`, init);
    },
    rotationRef: { current: ['synthetic'] }, interstitialMutationVersionRef: { current: 0 },
    interstitialSongsRef: { current: {} }, manualInterstitialBreaksRef: { current: {} },
    playingInterstitialBreakKeyRef: { current: null },
    commitInterstitialWorkspace: (songs) => { c.interstitialSongsRef.current = songs; },
  };
  return { c, requests };
}
for (const [hour, genre] of [[15, 'Day'], [21, 'Night']]) {
  test(`actual dancer callback uses ${genre} when a NONEMPTY personal playlist is on six-hour cooldown`, async () => {
    database.logPlayHistory('personal.mp3', 'Synthetic', 'Personal');
    const { c, requests } = context(hour);
    const result = await vm.runInNewContext(callback('getDancerTracks'), c)({ id: 'synthetic', name: 'Synthetic', playlist: ['personal.mp3'] });
    assert.equal(result.length, 2);
    assert.ok(result.every(t => t.genre === genre));
    assert.deepEqual(requests[0].genres, [genre]);
    assert.deepEqual(requests[0].dancerPlaylist, ['personal.mp3']);
  });
  test(`actual automatic break-prefill callback uses ${genre} and replaces stale other-shift songs`, async () => {
    const { c, requests } = context(hour);
    const otherName = genre === 'Day' ? 'night-one.mp3' : 'day-one.mp3';
    c.interstitialSongsRef.current['after-synthetic'] = [otherName];
    await vm.runInNewContext(callback('autoPopulateBreakSongs'), c)(2);
    const songs = c.interstitialSongsRef.current['after-synthetic'];
    assert.equal(songs.length, 2);
    assert.ok(songs.every(name => catalog.find(t => t.name === name)?.genre === genre));
    assert.deepEqual(requests[0].genres, [genre]);
  });
}
test('personal songs remain first and a partially exhausted set tops up only from Day', async () => {
  const { c } = context(15);
  const result = await vm.runInNewContext(callback('getDancerTracks'), c)({ id: 'synthetic', name: 'Synthetic', playlist: ['personal.mp3'] });
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'personal.mp3');
  assert.equal(result[1].genre, 'Day');
});
test('Folders Only uses Day independently and ignores an otherwise eligible personal playlist', async () => {
  const { c, requests } = context(15, { ...options, musicMode: 'folders_only' });
  const result = await vm.runInNewContext(callback('getDancerTracks'), c)({ id: 'synthetic', name: 'Synthetic', playlist: ['personal.mp3'] });
  assert.equal(result.length, 2);
  assert.ok(result.every(t => t.genre === 'Day'));
  assert.deepEqual(requests[0].dancerPlaylist, []);
});
test('an exhausted Day pool never silently selects Night or repeats cooldown songs', async () => {
  for (const t of catalog.filter(t => ['Personal', 'Day'].includes(t.genre))) database.logPlayHistory(t.name, 'Synthetic', t.genre);
  const { c } = context(15);
  const result = await vm.runInNewContext(callback('getDancerTracks'), c)({ id: 'synthetic', name: 'Synthetic', playlist: ['personal.mp3'] });
  assert.equal(result.length, 0);
});
test('actual automatic break-prefill never alters an explicit DJ queue', async () => {
  const { c, requests } = context(15);
  const manual = ['night-one.mp3', 'personal.mp3'];
  c.interstitialSongsRef.current['after-synthetic'] = manual;
  c.manualInterstitialBreaksRef.current['after-synthetic'] = true;
  await vm.runInNewContext(callback('autoPopulateBreakSongs'), c)(2);
  assert.equal(c.interstitialSongsRef.current['after-synthetic'], manual);
  assert.equal(requests.length, 0);
});
test('actual Options save consumes persisted Day settings and changing Night cannot clobber Day', async () => {
  const text = readFileSync(new URL('../../dj-booth/src/components/dj/DJOptions.jsx', import.meta.url), 'utf8');
  const { c } = context(15);
  let displayed;
  const errors = [];
  const save = vm.runInNewContext(callback('saveOptions', text), {
    console: { ...vmConsole, error: (...args) => errors.push(args.map(String).join(' ')) },
    djOptions: { activeGenres: ['Old Night'], musicMode: 'dancer_first' },
    setSaving() {}, onOptionsChange: result => { displayed = result; },
    djOptionsApi: { update: async body => {
      const response = await c.fetch('/api/dj-options', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 200);
      return response.json();
    } },
  });
  await save({ dayShift: options.dayShift });
  await save({ activeGenres: ['New Night'] });
  assert.deepEqual(errors, []);
  const reloaded = await fetch(`http://127.0.0.1:${server.address().port}/api/dj-options`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(response => response.json());
  assert.deepEqual(displayed.dayShift, options.dayShift);
  assert.deepEqual(reloaded.dayShift, options.dayShift);
  assert.deepEqual(reloaded.activeGenres, ['New Night']);
});
