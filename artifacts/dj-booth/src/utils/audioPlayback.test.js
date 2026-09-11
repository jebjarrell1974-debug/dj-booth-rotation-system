import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCommercialTransitionPlan,
  getTrackEndTriggerPoint,
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