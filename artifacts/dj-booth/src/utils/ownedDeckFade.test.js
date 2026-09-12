import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedDeckFadeController } from './ownedDeckFade.js';

function createHarness({ paused = false, ended = false } = {}) {
  let clock = 0;
  let nextFrameId = 0;
  const generations = { A: 1, B: 0 };
  const frames = new Map();
  const gainValues = [];
  const deck = {
    paused,
    ended,
    src: 'bed',
    pauseCalls: 0,
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
  };
  const gain = {
    gain: {
      setValueAtTime(value) {
        gainValues.push(value);
      },
    },
  };
  const replacementGainValues = [];
  const replacementDeck = {
    paused: false,
    ended: false,
    src: 'replacement',
    pauseCalls: 0,
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
  };
  const replacementGain = {
    gain: {
      setValueAtTime(value) {
        replacementGainValues.push(value);
      },
    },
  };
  const controller = createOwnedDeckFadeController({
    getDeck: name => name === 'A' ? deck : replacementDeck,
    getGain: name => name === 'A' ? gain : replacementGain,
    isCurrent: handle => (
      !!handle
      && generations[handle.deck] === handle.generation
    ),
    requestFrame: callback => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: id => frames.delete(id),
    now: () => clock,
  });

  const tick = time => {
    clock = time;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(time));
  };

  return {
    controller,
    deck,
    gainValues,
    replacementDeck,
    replacementGainValues,
    tick,
    setGeneration(value) {
      generations.A = value;
    },
    startReplacementTrack() {
      controller.cancel('new-track');
      generations.B += 1;
      return { deck: 'B', generation: generations.B };
    },
  };
}

test('natural completion smoothly fades and pauses only the owned deck', async () => {
  const harness = createHarness();
  const fade = harness.controller.fade({ deck: 'A', generation: 1 });

  harness.tick(0);
  assert.equal(harness.deck.pauseCalls, 0);
  harness.tick(1000);
  assert.ok(harness.gainValues.some(value => value < 1 && value > 0));
  harness.tick(2000);

  assert.deepEqual(await fade, { status: 'completed' });
  assert.equal(harness.deck.pauseCalls, 1);
  assert.equal(harness.gainValues.at(-1), 0);
});

test('skip during fade cancels immediately and prevents a late pause', async () => {
  const harness = createHarness();
  const fade = harness.controller.fade({ deck: 'A', generation: 1 });
  harness.tick(250);

  assert.equal(harness.controller.cancel('skip'), true);
  assert.deepEqual(await fade, { status: 'cancelled', reason: 'skip' });
  harness.tick(2000);
  assert.equal(harness.deck.pauseCalls, 0);
});

test('repeated natural callbacks reuse one fade and one final pause', async () => {
  const harness = createHarness();
  const first = harness.controller.fade({ deck: 'A', generation: 1 });
  const repeated = harness.controller.fade({ deck: 'A', generation: 1 });

  assert.strictEqual(repeated, first);
  harness.tick(2000);
  await first;
  assert.equal(harness.deck.pauseCalls, 1);
});

test('an already-ended bed does not schedule or alter gain', async () => {
  const harness = createHarness({ paused: true });
  const result = await harness.controller.fade({ deck: 'A', generation: 1 });

  assert.deepEqual(result, { status: 'already-ended' });
  assert.deepEqual(harness.gainValues, []);
  assert.equal(harness.deck.pauseCalls, 0);
});

test('a replacement deck generation is untouched by a late fade callback', async () => {
  const harness = createHarness();
  const fade = harness.controller.fade({ deck: 'A', generation: 1 });
  harness.setGeneration(2);
  harness.tick(2000);

  assert.deepEqual(await fade, { status: 'stale' });
  assert.equal(harness.controller.stopOwnedDeck({ deck: 'A', generation: 1 }), false);
  assert.equal(harness.deck.pauseCalls, 0);
  assert.deepEqual(harness.gainValues, []);
  assert.equal(harness.replacementDeck.pauseCalls, 0);
  assert.deepEqual(harness.replacementGainValues, []);
});

test('integrated replacement playback cancels the bed fade and targeted cleanup leaves the new deck playing', async () => {
  const harness = createHarness();
  const bedHandle = { deck: 'A', generation: 1 };
  const fade = harness.controller.fade(bedHandle);
  const replacementHandle = harness.startReplacementTrack();

  assert.deepEqual(await fade, { status: 'cancelled', reason: 'new-track' });
  assert.equal(harness.controller.stopOwnedDeck(bedHandle), true);
  assert.equal(harness.deck.pauseCalls, 1);
  assert.equal(harness.replacementDeck.pauseCalls, 0);
  assert.equal(harness.replacementDeck.paused, false);
  assert.deepEqual(replacementHandle, { deck: 'B', generation: 1 });
});