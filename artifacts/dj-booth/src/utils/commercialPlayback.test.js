import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommercialSession } from './commercialPlayback.js';

test('a commercial session resolves delayed work exactly once when skipped', async () => {
  const session = createCommercialSession({ mode: 'old' });
  let delayedVoiceStarted = false;
  let resolveDelay;
  const delayedWork = new Promise(resolve => {
    resolveDelay = resolve;
  });
  const delayedOrSkipped = Promise.race([
    delayedWork.then(() => {
      delayedVoiceStarted = true;
    }),
    session.done,
  ]);

  session.cancel();
  await delayedOrSkipped;

  assert.equal(session.finished, true);
  assert.equal(delayedVoiceStarted, false);
  assert.equal(session.finish(), false);
  resolveDelay();
});

test('old bed end does not finish the session before voiceover completes', async () => {
  const session = createCommercialSession({ mode: 'old' });

  assert.equal(session.trackEnded(), false);
  assert.equal(session.finished, false);
  assert.equal(session.voiceFinished, false);

  session.markVoiceStarted();
  assert.equal(session.trackEnded(), false);
  assert.equal(session.finished, false);
});

test('voiceover completion owns old-mode session completion', async () => {
  const session = createCommercialSession({ mode: 'old' });
  session.markVoiceStarted();

  session.completeVoice();

  assert.equal(session.finished, true);
  assert.equal(session.voiceFinished, true);
});

test('new premixed track end finishes its session', () => {
  const session = createCommercialSession({ mode: 'new' });

  assert.equal(session.trackEnded(), true);
  assert.equal(session.finished, true);
});

test('owned cleanup runs once before a subsequently started track', async () => {
  const session = createCommercialSession();
  const playback = [];
  session.registerOwnedStop(() => playback.push('commercial-stopped'));

  session.cancel();
  await session.done;
  playback.push('entertainer-track');

  assert.deepEqual(playback, ['commercial-stopped', 'entertainer-track']);
  assert.equal(session.stopOwned(), false);
  assert.equal(session.finished, true);
});