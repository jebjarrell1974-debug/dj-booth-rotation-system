import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cancelMusicAvailabilityChecks, musicNameKey, playAvailableTrack } from './musicAvailability.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('blocked cached/prepared track never reaches the audio engine', async () => {
  let played = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, 'HEAD');
    assert.equal(options.cache, 'no-store');
    return { ok: false, status: 403 };
  };
  assert.equal(await playAvailableTrack({ playTrack: () => { played++; } }, { url: '/api/music/stream/1', name: 'Song.mp3' }), false);
  assert.equal(played, 0);
});

test('reactivation is checked afresh and restores playback, preserving engine options', async () => {
  let available = false;
  let played = 0;
  globalThis.fetch = async () => ({ ok: available });
  const engine = { playTrack: async (track, fade, options) => {
    assert.equal(options.preparedOwner, 'owned');
    assert.equal(fade, false);
    assert.equal(options.startupSignal.aborted, false);
    played++;
    return true;
  } };
  const track = { url: '/api/music/stream/1', name: 'Song.mp3' };
  assert.equal(await playAvailableTrack(engine, track, false, { preparedOwner: 'owned' }), false);
  available = true;
  assert.equal(await playAvailableTrack(engine, track, false, { preparedOwner: 'owned' }), true);
  assert.equal(played, 1);
});

test('skip or matching deactivate cancels a pending check even when the request ignores abort', async () => {
  let respond;
  let played = 0;
  globalThis.fetch = () => new Promise(resolve => { respond = resolve; });
  const engine = { playTrack: async () => { played++; return true; } };
  const operation = playAvailableTrack(engine, { url: '/api/music/stream/1', name: 'Song.mp3' });
  cancelMusicAvailabilityChecks(engine, 'SONG');
  respond({ ok: true });
  assert.equal(await operation, false);
  assert.equal(played, 0);
});

test('network failure fails closed without throwing into the transition', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal(await playAvailableTrack({ playTrack: () => assert.fail('must not play') }, '/api/music/stream/2'), false);
});

test('unrelated voice/promo URLs retain their existing playback path', async () => {
  globalThis.fetch = () => assert.fail('must not request music availability');
  const engine = { playTrack: async () => true };
  assert.equal(await playAvailableTrack(engine, '/api/promos/1/stream'), true);
  assert.equal(musicNameKey(' SONG.MP3 '), musicNameKey('song'));
});
