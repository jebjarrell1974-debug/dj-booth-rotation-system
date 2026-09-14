import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreparedDeckController } from './preparedDeck.js';

function mockDeck() {
  return {
    src: '',
    paused: true,
    loadCalls: 0,
    playCalls: 0,
    pauseCalls: 0,
    load() { this.loadCalls++; },
    play() { this.playCalls++; this.paused = false; },
    pause() { this.pauseCalls++; this.paused = true; },
  };
}

function targetFor(deck, state) {
  return () => ({
    deck,
    deckName: 'B',
    generation: state.generation,
    unsafe: state.unsafe,
  });
}

test('preparation loads the inactive mock deck once and never plays before ad end', async () => {
  const deck = mockDeck();
  const state = { generation: 1, unsafe: false };
  const prepared = createPreparedDeckController({
    getTarget: targetFor(deck, state),
    waitForReady: async () => {},
  });

  const handle = await prepared.prepare({ url: '/music/next.mp3', name: 'Next' }, { owner: 'ad-1' });

  assert.equal(deck.loadCalls, 1);
  assert.equal(deck.playCalls, 0);
  assert.equal(deck.src, '/music/next.mp3');
  assert.deepEqual(
    { url: handle.url, deck: handle.deck, generation: handle.generation },
    { url: '/music/next.mp3', deck: 'B', generation: 1 },
  );
});

test('a replaced target bypasses the stale preparation and adopts only the replacement', async () => {
  const deck = mockDeck();
  const state = { generation: 1, unsafe: false };
  const readiness = [];
  const prepared = createPreparedDeckController({
    getTarget: targetFor(deck, state),
    claimTarget: () => ({ ...targetFor(deck, state)(), generation: ++state.generation }),
    waitForReady: (_deck, { isCurrent }) => new Promise(resolve => readiness.push({ resolve, isCurrent })),
  });

  const oldPromise = prepared.prepare('/music/old.mp3', { owner: 'ad-1' });
  const newPromise = prepared.prepare('/music/new.mp3', { owner: 'ad-1' });
  assert.equal(deck.loadCalls, 2);

  readiness[0].resolve();
  assert.equal(await oldPromise, null);
  readiness[1].resolve();
  const next = await newPromise;
  assert.equal(next.url, '/music/new.mp3');
  assert.equal(prepared.adopt({ url: '/music/old.mp3', owner: 'ad-1' }), null);
  assert.equal(prepared.adopt({ url: '/music/new.mp3', owner: 'ad-1' }).url, '/music/new.mp3');
  assert.equal(deck.playCalls, 0);
});

test('stale cleanup cannot stop replacement media', async () => {
  const deck = mockDeck();
  const state = { generation: 1, unsafe: false };
  const prepared = createPreparedDeckController({
    getTarget: targetFor(deck, state),
    claimTarget: () => ({ ...targetFor(deck, state)(), generation: ++state.generation }),
    waitForReady: async () => {},
  });

  const old = await prepared.prepare('/music/old.mp3', { owner: 'ad-1' });
  await prepared.prepare('/music/new.mp3', { owner: 'ad-1' });
  assert.equal(deck.src, '/music/new.mp3');
  const pauseCallsBeforeStaleCleanup = deck.pauseCalls;

  assert.equal(prepared.invalidate({ handle: old }), false);
  assert.equal(deck.src, '/music/new.mp3');
  assert.equal(deck.pauseCalls, pauseCallsBeforeStaleCleanup);
  assert.equal(prepared.adopt({ url: '/music/new.mp3', owner: 'other-ad' }), null);
  assert.equal(prepared.adopt({ url: '/music/new.mp3', owner: 'ad-1' }).url, '/music/new.mp3');
});

test('unsafe preparation is bypassed without touching the deck', async () => {
  const deck = mockDeck();
  const state = { generation: 1, unsafe: true };
  const prepared = createPreparedDeckController({
    getTarget: targetFor(deck, state),
    waitForReady: async () => {},
  });

  assert.equal(await prepared.prepare('/music/next.mp3'), null);
  assert.equal(deck.loadCalls, 0);
  assert.equal(deck.src, '');
});

test('a physical ad session can end and adopt the prepared deck without reloading it', async () => {
  const deck = mockDeck();
  const state = { generation: 1, unsafe: false };
  const session = { finished: false };
  const prepared = createPreparedDeckController({
    getTarget: targetFor(deck, state),
    waitForReady: async () => {},
  });

  await prepared.prepare('/music/after-ad.mp3', { owner: session });
  session.finished = true;
  const adopted = prepared.adopt({ url: '/music/after-ad.mp3', owner: session });

  assert.equal(adopted.url, '/music/after-ad.mp3');
  assert.equal(deck.loadCalls, 1);
  assert.equal(deck.playCalls, 0);
});

test('stale cleanup after adoption cannot clear a newer generation', async () => {
  const deck = mockDeck();
  const state = { generation: 1, unsafe: false };
  const prepared = createPreparedDeckController({
    getTarget: targetFor(deck, state),
    claimTarget: () => ({ ...targetFor(deck, state)(), generation: ++state.generation }),
    waitForReady: async () => {},
  });

  const old = await prepared.prepare('/music/old.mp3', { owner: 'ad-1' });
  const adopted = prepared.adopt({ url: '/music/old.mp3', owner: 'ad-1' });
  assert.equal(adopted.url, '/music/old.mp3');

  const replacement = await prepared.prepare('/music/new.mp3', { owner: 'ad-2' });
  assert.equal(replacement.url, '/music/new.mp3');
  assert.equal(prepared.invalidate({ handle: adopted }), false);
  assert.equal(prepared.invalidate({ handle: old }), false);
  assert.equal(deck.src, '/music/new.mp3');
  assert.equal(deck.pauseCalls, 0);
});
