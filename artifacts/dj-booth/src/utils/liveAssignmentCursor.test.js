import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beginActiveSet, createActiveSetCursor, advanceActiveSet, resizeActiveSet } from './activeSetCursor.js';
import { planSkipAdvance } from './skipPlayback.js';
import { capSongAssignmentsPreservingManual, resolveManualSetLength } from './rotationAssignments.js';

// Exercise the actual component commit body, not a separately implemented model.
const source = readFileSync(new URL('../pages/DJBooth.jsx', import.meta.url), 'utf8');
const body = source.split('const commitRotationSongs = useCallback((candidate) => {')[1]
  .split('\n  }, [remoteMode]);')[0];
const commit = new Function('candidate', 'env', `
  const { rotationSongsRef, preserveManualAssignments, songsPerSetRef,
    setRotationSongs, remoteMode, localStorage, isRotationActiveRef,
    activeSetCursorRef, isManualSet, effectiveSongsPerSet, resizeActiveSet } = env;
  ${body}
`);

function fixture({ songNumber = 1, manual = true, active = true, remote = false } = {}) {
  const cursor = advanceActiveSet(beginActiveSet(createActiveSetCursor(), {
    dancerId: 'playing', setLength: 2, generation: 7,
  }), songNumber);
  const env = {
    rotationSongsRef: { current: { playing: [{ name: 'old-one' }, { name: 'old-two' }] } },
    songsPerSetRef: { current: 2 },
    activeSetCursorRef: { current: cursor },
    isRotationActiveRef: { current: active },
    remoteMode: remote,
    localStorage: { setItem() {} },
    setRotationSongs(next) { env.rendered = next; },
    isManualSet: id => manual && id === 'playing',
    resizeActiveSet,
    lengths: { playing: 2 },
  };
  env.preserveManualAssignments = (next, limit) =>
    capSongAssignmentsPreservingManual(next, limit, manual ? ['playing'] : []);
  env.effectiveSongsPerSet = id => resolveManualSetLength(
    env.rotationSongsRef.current, env.lengths, id, 2,
  );
  return env;
}

test('live edit from two songs to one does not leave Skip aimed at a missing manual slot', () => {
  const env = fixture();
  env.lengths.playing = 1;
  commit({ playing: [{ name: 'replacement' }] }, env);
  assert.equal(env.activeSetCursorRef.current.setLength, 1);
  assert.equal(planSkipAdvance({
    currentSongNumber: env.activeSetCursorRef.current.songNumber,
    songsPerSet: env.activeSetCursorRef.current.setLength,
  }).kind, 'entertainer');
  assert.equal(env.activeSetCursorRef.current.songNumber, 1);
  assert.equal(env.activeSetCursorRef.current.generation, 7);
});

test('adding a third manual song while song two plays keeps Skip inside the edited set', () => {
  const env = fixture({ songNumber: 2 });
  env.lengths.playing = 3;
  commit({ playing: [{ name: 'one' }, { name: 'two' }, { name: 'new-three' }] }, env);
  assert.deepEqual(planSkipAdvance({
    currentSongNumber: env.activeSetCursorRef.current.songNumber,
    songsPerSet: env.activeSetCursorRef.current.setLength,
  }), { accepted: true, kind: 'song', trackIndex: 2, songNumber: 3 });
  assert.equal(env.activeSetCursorRef.current.generation, 7);
});

test('shortening below the playing slot does not rewind or interrupt that song', () => {
  const env = fixture({ songNumber: 2 });
  env.lengths.playing = 1;
  commit({ playing: [{ name: 'new-one' }] }, env);
  assert.equal(env.activeSetCursorRef.current.songNumber, 2);
  assert.equal(env.activeSetCursorRef.current.setLength, 2);
});

test('future entertainer edits preserve the current set owner and cursor identity', () => {
  const env = fixture();
  const before = env.activeSetCursorRef.current;
  commit({ ...env.rotationSongsRef.current, upcoming: [{ name: 'future' }] }, env);
  assert.equal(env.activeSetCursorRef.current, before);
});

test('automatic, stopped and remote-only commits do not resize the playing owner', () => {
  for (const options of [{ manual: false }, { active: false }, { remote: true }]) {
    const env = fixture(options);
    const before = env.activeSetCursorRef.current;
    env.lengths.playing = 3;
    commit({ playing: [{ name: 'one' }, { name: 'two' }, { name: 'three' }] }, env);
    assert.equal(env.activeSetCursorRef.current, before);
  }
});

test('a manually cleared active set does not leave a phantom next-song boundary', () => {
  const env = fixture();
  env.lengths.playing = 0;
  commit({ playing: [] }, env);
  assert.equal(env.activeSetCursorRef.current.setLength, 1);
  assert.equal(planSkipAdvance({
    currentSongNumber: 1, songsPerSet: env.activeSetCursorRef.current.setLength,
  }).kind, 'entertainer');
});

const lookupBody = source.split('const resolveTrackByName = useCallback(async (trackName) => {')[1]
  .split('\n  }, []);')[0];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const lookup = new AsyncFunction('trackName', 'env', `
  const { AbortController, localStorage, fetch, setTimeout, clearTimeout } = env;
  ${lookupBody}
`);

test('actual song lookup aborts a stalled request instead of holding Skip indefinitely', async () => {
  let timeoutCallback;
  let timeoutMs;
  let cleared = 0;
  const env = {
    AbortController,
    localStorage: { getItem: () => null },
    setTimeout(fn, ms) { timeoutCallback = fn; timeoutMs = ms; return 123; },
    clearTimeout(id) { assert.equal(id, 123); cleared += 1; },
    fetch(url, { signal }) {
      assert.match(url, /selected%20song/);
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  };
  const pending = lookup('selected song', env);
  assert.equal(timeoutMs, 5000);
  timeoutCallback();
  assert.equal(await pending, null);
  assert.equal(cleared, 1);
});

test('actual song lookup preserves successful resolution and clears its timeout', async () => {
  let cleared = 0;
  const resolved = await lookup('selected song', {
    AbortController,
    localStorage: { getItem: () => null },
    setTimeout() { return 456; },
    clearTimeout(id) { assert.equal(id, 456); cleared += 1; },
    async fetch() {
      return { ok: true, json: async () => ({ id: 12, name: 'selected song' }) };
    },
  });
  assert.deepEqual(resolved, {
    id: 12, name: 'selected song', url: '/api/music/stream/12',
  });
  assert.equal(cleared, 1);
});
