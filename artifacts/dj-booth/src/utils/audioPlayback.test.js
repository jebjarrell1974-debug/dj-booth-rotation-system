import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCommercialTransitionPlan,
  getTrackEndTriggerPoint,
  hasAdvancingPlayback,
  ownsDeckCrossfade,
  ownsDeckStartup,
  rebaseBreakCursor,
} from './audioPlayback.js';
import { createAnnouncementLifecycle } from './announcementLifecycle.js';

test('premixed media waits for actual end instead of the normal lead window', () => {
  assert.equal(
    getTrackEndTriggerPoint({ duration: 45, triggerAtMediaEnd: true }),
    45,
  );
  assert.equal(
    getTrackEndTriggerPoint({ duration: 45 }),
    38.25,
  );
});

test('legacy bed media-end mode does not arm the safety transition window', () => {
  const duration = 24;
  const mediaEndPoint = getTrackEndTriggerPoint({
    duration,
    triggerAtMediaEnd: true,
  });
  assert.equal(mediaEndPoint, duration);
  assert.notEqual(
    mediaEndPoint,
    getTrackEndTriggerPoint({ duration }),
  );
});

test('short tracks retain their bounded transition lead', () => {
  assert.equal(
    getTrackEndTriggerPoint({ duration: 20, isShortTrack: true }),
    17,
  );
});

test('a due commercial is sequenced before incoming audio', () => {
  assert.deepEqual(
    getCommercialTransitionPlan({ commercialDue: true, announcementsEnabled: true }),
    { commercialBeforeIncoming: true, overlapOutro: false },
  );
});

test('feature arrivals keep the outro completion rule and still admit due commercials', () => {
  assert.deepEqual(
    getCommercialTransitionPlan({
      commercialDue: true,
      announcementsEnabled: true,
      featureArrival: true,
    }),
    { commercialBeforeIncoming: true, overlapOutro: false },
  );
  assert.deepEqual(
    getCommercialTransitionPlan({
      commercialDue: false,
      announcementsEnabled: true,
      featureArrival: true,
    }),
    { commercialBeforeIncoming: false, overlapOutro: false },
  );
});

test('without a commercial the regular outro overlap remains enabled', () => {
  assert.deepEqual(
    getCommercialTransitionPlan({ commercialDue: false, announcementsEnabled: true }),
    { commercialBeforeIncoming: false, overlapOutro: true },
  );
});

test('crossfade completion requires the same owner, active outgoing deck, and incoming generation', () => {
  const base = {
    owner: 12,
    currentOwner: 12,
    outgoingDeck: 'A',
    activeDeck: 'A',
    incomingDeck: 'B',
    incomingGeneration: 7,
    deckGenerations: { A: 4, B: 7 },
  };
  assert.equal(ownsDeckCrossfade(base), true);
  assert.equal(ownsDeckCrossfade({ ...base, currentOwner: 13 }), false);
  assert.equal(ownsDeckCrossfade({ ...base, activeDeck: 'B' }), false);
  assert.equal(ownsDeckCrossfade({
    ...base,
    deckGenerations: { A: 4, B: 8 },
  }), false);
});

test('deck startup aborts when a prior fade changes active ownership during an await', () => {
  assert.equal(ownsDeckStartup({
    capturedActiveDeck: 'A',
    currentActiveDeck: 'A',
    crossfadeInProgress: false,
  }), true);
  assert.equal(ownsDeckStartup({
    capturedActiveDeck: 'A',
    currentActiveDeck: 'B',
    crossfadeInProgress: false,
  }), false);
  assert.equal(ownsDeckStartup({
    capturedActiveDeck: 'A',
    currentActiveDeck: 'A',
    crossfadeInProgress: true,
  }), false);
});

test('watchdog sees real deck progress even when React time updates are delayed', () => {
  const current = {
    audioContextState: 'running',
    decks: {
      A: { generation: 3, srcSet: true, paused: false, ended: false, currentTime: 6.2, gain: 1 },
      B: { generation: 2, srcSet: false, paused: true, ended: false, currentTime: 0, gain: 0 },
    },
  };
  assert.equal(hasAdvancingPlayback(null, current), true);
  assert.equal(hasAdvancingPlayback({
    decks: {
      A: { generation: 3, srcSet: true, paused: false, ended: false, currentTime: 3.1 },
    },
  }, current), true);
  assert.equal(hasAdvancingPlayback({
    decks: {
      A: { generation: 3, srcSet: true, paused: false, ended: false, currentTime: 6.2 },
    },
  }, current), false);
  assert.equal(hasAdvancingPlayback(current, {
    audioContextState: 'running',
    decks: {
      A: { ...current.decks.A, paused: true, currentTime: 6.2 },
    },
  }), false);
  assert.equal(hasAdvancingPlayback(current, {
    ...current,
    audioContextState: 'suspended',
  }), false);
  assert.equal(hasAdvancingPlayback(current, {
    ...current,
    decks: {
      ...current.decks,
      A: { ...current.decks.A, currentTime: 9.4, gain: 0 },
    },
  }), false);
});

test('break cursor rebases only when a removed song was before it', () => {
  assert.equal(rebaseBreakCursor(3, 1), 2);
  assert.equal(rebaseBreakCursor(3, 3), 3);
  assert.equal(rebaseBreakCursor(3, 4), 3);
});

test('a newer announcement settles the prior generation and owns a new duck token', () => {
  const lifecycle = createAnnouncementLifecycle();
  const cancelled = [];
  const first = lifecycle.start(reason => cancelled.push(`first:${reason}`));
  const second = lifecycle.start(reason => cancelled.push(`second:${reason}`));

  assert.deepEqual(cancelled, ['first:superseded']);
  assert.notEqual(first.ownerId, second.ownerId);
  assert.equal(lifecycle.isCurrent(first), false);
  assert.equal(lifecycle.isCurrent(second), true);

  lifecycle.cancelActive('stopped');
  assert.deepEqual(cancelled, ['first:superseded', 'second:stopped']);
  assert.equal(lifecycle.isCurrent(second), false);
});