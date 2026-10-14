import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, createReadStream, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import express from 'express';

// Execute the actual product route bodies against real disposable SQLite.
// Fixture authentication is intentionally separate from full-server qualification.
const root = mkdtempSync(join(tmpdir(), 'neon-availability-http-'));
process.env.DB_PATH = join(root, 'fixture.db');
process.env.VOICEOVER_PATH = join(root, 'voiceovers');
const database = await import('./db.js');
const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const app = express();
app.use(express.json());
const authenticate = (req, res, next) => {
  req.session = database.getSession(req.headers.authorization?.replace('Bearer ', ''));
  return req.session ? next() : res.sendStatus(401);
};
const requireDJ = (req, res, next) => req.session.role === 'dj' ? next() : res.sendStatus(403);
const events = [];
const context = vm.createContext({
  ...database, app, authenticate, requireDJ,
  MUSIC_PATH: root, join, existsSync, statSync, createReadStream,
  broadcastSSE: (type, data) => events.push({ type, ...data }),
});
for (const marker of [
  "app.get('/api/playlist'", "app.put('/api/playlist'",
  "app.post('/api/music/availability'", "app.post('/api/music/block'",
  "app.post('/api/music/unblock'", "app.head('/api/music/stream/:id'",
  "app.get('/api/music/stream/:id'",
]) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing product route ${marker}`);
  const tail = source.slice(start);
  const next = tail.slice(1).search(/\napp\.(?:get|post|put|delete|head)\(/);
  assert.ok(next >= 0, `missing route end ${marker}`);
  vm.runInContext(tail.slice(0, next + 1), context);
}
writeFileSync(join(root, 'fixture.mp3'), Buffer.from('synthetic media bytes'));
database.upsertMusicTrack('Fixture.mp3', 'fixture.mp3', 'House', 21, '2026-10-13');
const track = database.getMusicTrackByName('Fixture.mp3');
const dancer = database.createDancer('Synthetic performer', '#fff', '76328');
database.updateDancer(dancer.id, { playlist: ['Fixture.mp3', 'Unknown Saved Name'] });
const dancerToken = database.createSession('dancer', dancer.id);
const djToken = database.createSession('dj');
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function request(path, { token = dancerToken, method = 'GET', body } = {}) {
  return fetch(base + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  database.stopCheckpoints();
  database.closeDatabase();
  rmSync(root, { recursive: true, force: true });
});

test('real playlist, media HEAD/GET and reactivation routes enforce the same deactivation', async () => {
  assert.equal((await request(`/api/music/stream/${track.id}`, { method: 'HEAD' })).status, 200);
  assert.equal((await request('/api/music/block', { method: 'POST', token: djToken, body: { trackName: 'Fixture.mp3' } })).status, 200);
  assert.deepEqual(await (await request('/api/playlist')).json(), { playlist: ['Unknown Saved Name'] });
  const head = await request(`/api/music/stream/${track.id}`, { method: 'HEAD' });
  assert.equal(head.status, 403);
  assert.equal(head.headers.get('cache-control'), 'no-store');
  assert.equal((await request(`/api/music/stream/${track.id}`)).status, 403);
  assert.deepEqual(await (await request('/api/music/availability', {
    method: 'POST', body: { names: ['FIXTURE', 'Unknown Saved Name', 'Unsaved Addition'] },
  })).json(), { names: ['Unknown Saved Name', 'Unsaved Addition'] });
  assert.equal((await request('/api/music/unblock', { method: 'POST', token: djToken, body: { trackName: 'Fixture' } })).status, 200);
  assert.deepEqual(await (await request('/api/playlist')).json(), { playlist: ['Fixture.mp3', 'Unknown Saved Name'] });
  assert.equal((await request(`/api/music/stream/${track.id}`, { method: 'HEAD' })).status, 200);
  assert.equal(await (await request(`/api/music/stream/${track.id}`)).text(), 'synthetic media bytes');
  assert.deepEqual(events.map(event => event.type), ['musicBlocked', 'musicUnblocked']);
});

test('stale playlist saves cannot put a deactivated song back into the visible playlist', async () => {
  database.blockTrack('Fixture');
  const response = await request('/api/playlist', {
    method: 'PUT', body: { playlist: ['Fixture.mp3', 'Unknown Saved Name'] },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { playlist: ['Unknown Saved Name'] });
  assert.deepEqual(await (await request('/api/playlist')).json(), { playlist: ['Unknown Saved Name'] });
});

test('invalid availability input fails explicitly without changing the playlist', async () => {
  assert.equal((await request('/api/music/availability', { method: 'POST', body: { names: [null] } })).status, 400);
});

test('block and unblock reject malformed names without mutations, events or session changes', async () => {
  const beforePlaylist = database.getDancer(dancer.id).playlist;
  const beforeBlocked = database.getBlockedTracks();
  const beforeEvents = events.length;
  const invalidBodies = [
    undefined, null, {}, { trackName: null }, { trackName: { bad: true } },
    { trackName: ['Fixture.mp3'] }, { trackName: 1 }, { trackName: true },
    { trackName: false }, { trackName: '' }, { trackName: ' \t\n' },
  ];
  for (const path of ['/api/music/block', '/api/music/unblock']) {
    for (const body of invalidBodies) {
      const response = await request(path, { method: 'POST', token: djToken, body });
      assert.equal(response.status, 400, `${path}: ${JSON.stringify(body)}`);
      assert.deepEqual(await response.json(), { error: 'trackName must be a non-empty string' });
      assert.deepEqual(database.getBlockedTracks(), beforeBlocked);
      assert.deepEqual(database.getDancer(dancer.id).playlist, beforePlaylist);
      assert.equal(events.length, beforeEvents, 'invalid input must not broadcast an availability change');
      assert.ok(database.getSession(djToken), 'operator session remains valid');
      assert.ok(database.getSession(dancerToken), 'performer session remains valid');
    }
    assert.equal((await request(path, {
      method: 'POST', body: { trackName: 'Fixture.mp3' },
    })).status, 403, 'valid input does not bypass DJ authorization');
  }
});
