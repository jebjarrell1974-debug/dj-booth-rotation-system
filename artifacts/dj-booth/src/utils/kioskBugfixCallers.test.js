import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { safeRotationReorder } from './safeRotationReorder.js';
import { createCommercialSession } from './commercialPlayback.js';

const booth = readFileSync(new URL('../pages/DJBooth.jsx', import.meta.url), 'utf8');
const dancerView = readFileSync(new URL('../pages/DancerView.jsx', import.meta.url), 'utf8');

test('executed booth drag callback preserves the set and never dispatches a skip', () => {
  const match = booth.match(/onDancerDragReorder=\{([\s\S]*?)\n                \}\}/);
  assert.ok(match, 'actual booth callback found');
  for (const remoteMode of [false, true]) {
    const writes = [];
    const cursor = { dancerId: 'B', generation: 9, songNumber: 2, setLength: 4 };
    const rotationRef = { current: ['A', 'B', 'C', 'D'] };
    const currentDancerIndexRef = { current: 1 };
    const context = {
      safeRotationReorder, remoteMode, activeSetCursorRef: { current: cursor },
      rotationRef, currentDancerIndexRef, transitionInProgressRef: { current: false },
      rotationAssignmentVersionRef: { current: 0 },
      remoteRotationDraftRef: { current: null }, remoteRotationRevisionRef: { current: 0 },
      toast: { error: message => assert.fail(message) },
      setRotation: value => writes.push(['rotation', value]),
      setCurrentDancerIndex: value => writes.push(['index', value]),
      updateStageState: (...values) => writes.push(['stage', ...values]),
      sendBoothCommand: (...values) => writes.push(['command', ...values]),
      handleSkipRef: { current: () => assert.fail('reorder must never skip') },
    };
    const callback = vm.runInNewContext(`(${match[1]}})`, context);
    assert.deepEqual(callback(['D', 'A', 'B', 'C'], 'A', 'D', () => {}, 'D', 0), ['A', 'B', 'D', 'C']);
    assert.deepEqual(cursor, { dancerId: 'B', generation: 9, songNumber: 2, setLength: 4 });
    if (!remoteMode) assert.equal(currentDancerIndexRef.current, 1);
    else {
      assert.equal(writes[0][0], 'command');
      assert.equal(writes[0][1], 'saveRotation');
      assert.deepEqual(writes[0][2].rotation, ['A', 'B', 'D', 'C']);
    }
  }
});

test('actual touchscreen row handler does not start drag from a delete button', () => {
  const match = dancerView.match(/const handleTouchStart = useCallback\(([\s\S]*?)\n  \}, \[\]\);/);
  assert.ok(match);
  const state = { current: {} };
  const callback = vm.runInNewContext(`(${match[1]}})`, {
    touchState: state, setTimeout: () => assert.fail('delete tap started drag'),
  });
  callback({ target: { closest: selector => selector === 'button' } }, 0);
  assert.deepEqual(state.current, {});
});

test('actual kiosk SSE handler cancels only the matching deactivated/deleted ad', async () => {
  const callbacks = [...booth.matchAll(/const es = connectBoothSSE\(([\s\S]*?)\n    \}\);/g)];
  const match = callbacks.find(item => item[1].includes("data.type === 'command'"));
  assert.ok(match);
  const session = createCommercialSession({ mode: 'new' });
  session.promoTrackId = 5;
  let stopped = 0;
  session.registerOwnedStop(() => { stopped++; });
  const callback = vm.runInNewContext(`(${match[1]}})`, {
    active: true, commercialSessionRef: { current: session },
    commercialEndResolverRef: { current: () => session.cancel() },
  });
  callback({ type: 'promoChanged', id: 6, cancelPlayback: true });
  callback({ type: 'promoChanged', id: 5, cancelPlayback: false });
  assert.equal(session.finished, false);
  callback({ type: 'promoChanged', id: '5', cancelPlayback: true });
  await session.done;
  assert.equal(stopped, 1);
  assert.equal(session.finished, true);
});

test('playlist transport carries the captured entertainer token into deferred saves', () => {
  const source = readFileSync(new URL('../api/serverApi.js', import.meta.url), 'utf8');
  const match = source.match(/export const playlistApi = (\{[\s\S]*?\n\});/);
  assert.ok(match);
  let request;
  const api = vm.runInNewContext(`(${match[1]})`, {
    apiFetch: (path, options) => { request = { path, options }; },
  });
  api.update(['retained'], { token: 'fixture-entertainer-token' });
  assert.equal(request.options.authToken, 'fixture-entertainer-token');
  assert.deepEqual(JSON.parse(request.options.body), { playlist: ['retained'] });
});

test('actual polling fallback cancels blocked/missing ads without an SSE event', async () => {
  const match = booth.match(/const validateActivePromo = (async \(\) => \{[\s\S]*?)\n    \};/);
  assert.ok(match);
  for (const promos of [[{ id: 5, blocked: 0 }], [{ id: 5, blocked: 1 }], []]) {
    const session = createCommercialSession();
    session.promoTrackId = 5;
    const callback = vm.runInNewContext(`(${match[1]}})`, {
      inFlight: false, disposed: false, commercialSessionRef: { current: session },
      localStorage: { getItem: () => 'fixture-dj-token' },
      AbortSignal: { timeout: () => undefined },
      fetch: async () => ({ ok: true, json: async () => promos }),
      invalidateCommercialPreparation: owner => assert.equal(owner, session),
      console,
    });
    await callback();
    assert.equal(session.finished, !promos.length || !!promos[0].blocked);
  }
});

test('late ad media handles are stopped if cancellation occurred during startup', () => {
  for (const [kind, stopMethod] of [['Deck', 'stopOwnedDeck'], ['Voice', 'stopOwnedVoice']]) {
    const match = booth.match(new RegExp(`capture${kind}: (handle => \\{[\\s\\S]*?)\\n          \\},`));
    assert.ok(match);
    const handle = { generation: 7 };
    let stopped;
    const callback = vm.runInNewContext(`(${match[1]}})`, {
      session: { finished: true },
      audioEngineRef: { current: { [stopMethod]: value => { stopped = value; } } },
    });
    callback(handle);
    assert.equal(stopped, handle);
  }
});

test('actual Deactivate caller accepts the playing ad during a transition without replacing performer music', async () => {
  const match = booth.match(/const deactivateAndReplace = useCallback\((async \(trackName, authToken\) => \{[\s\S]*?)\n  \}, \[/);
  assert.ok(match);
  const session = createCommercialSession();
  session.promoTrackName = 'Fixture Ad';
  let stopped = 0, blocked;
  session.registerOwnedStop(() => { stopped++; });
  const callback = vm.runInNewContext(`(${match[1]}})`, {
    commercialSessionRef: { current: session }, playingCommercialRef: { current: true },
    transitionInProgressRef: { current: true },
    activeSetCursorRef: { current: { dancerId: 'A', setLength: 4 } },
    currentSongNumberRef: { current: 2 }, currentTrackRef: { current: 'Fixture Ad' },
    isRotationActiveRef: { current: true },
    localStorage: { getItem: () => 'fixture-dj-token' },
    fetch: async (url, options) => { blocked = JSON.parse(options.body).trackName; return { ok: true }; },
    invalidateCommercialPreparation: owner => assert.equal(owner, session),
  });
  const result = await callback('Fixture Ad');
  assert.equal(result.ok, true);
  assert.equal(blocked, 'Fixture Ad');
  assert.equal(stopped, 1);
  assert.equal(session.finished, true);
});
