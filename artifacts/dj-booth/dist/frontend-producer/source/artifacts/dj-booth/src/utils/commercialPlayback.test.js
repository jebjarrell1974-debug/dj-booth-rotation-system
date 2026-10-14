import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCommercialBedCompletion,
  createCommercialSession,
} from './commercialPlayback.js';

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

test('natural legacy voice completion waits for the owned bed fade before cleanup and next intro', async () => {
  const session = createCommercialSession({ mode: 'old' });
  session.markVoiceStarted();
  let resolveFade;
  let fadeCalls = 0;
  let nextIntroStarted = false;
  const completeVoice = createCommercialBedCompletion({
    session,
    getDeckHandle: () => ({ deck: 'A', generation: 1 }),
    fadeOwnedDeck: () => {
      fadeCalls += 1;
      return new Promise(resolve => { resolveFade = resolve; });
    },
  });

  const completion = completeVoice();
  const repeatedCompletion = completeVoice();
  assert.strictEqual(repeatedCompletion, completion);
  await Promise.resolve();
  assert.equal(session.finished, false);
  assert.equal(fadeCalls, 1);
  assert.equal(nextIntroStarted, false);

  resolveFade();
  await completion;
  await session.done;
  nextIntroStarted = true;
  assert.equal(session.finished, true);
  assert.equal(session.voiceFinished, true);
  assert.equal(nextIntroStarted, true);
});

test('skip during a legacy bed fade prevents late voice completion', async () => {
  const session = createCommercialSession({ mode: 'old' });
  session.markVoiceStarted();
  let resolveFade;
  const completeVoice = createCommercialBedCompletion({
    session,
    getDeckHandle: () => ({ deck: 'A', generation: 2 }),
    fadeOwnedDeck: () => new Promise(resolve => { resolveFade = resolve; }),
  });

  const completion = completeVoice();
  session.cancel();
  resolveFade();

  assert.equal(await completion, false);
  assert.equal(session.finished, true);
  assert.equal(session.voiceFinished, false);
});

test('an already-ended legacy bed completes without scheduling a second fade', async () => {
  const session = createCommercialSession({ mode: 'old' });
  session.markVoiceStarted();
  let fadeCalls = 0;
  const completeVoice = createCommercialBedCompletion({
    session,
    getDeckHandle: () => ({ deck: 'B', generation: 3 }),
    fadeOwnedDeck: () => {
      fadeCalls += 1;
      return Promise.resolve({ status: 'already-ended' });
    },
  });

  await completeVoice();
  await completeVoice();
  assert.equal(fadeCalls, 1);
  assert.equal(session.finished, true);
  assert.equal(session.voiceFinished, true);
});