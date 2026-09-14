import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCommercialCadenceScheduler,
  routePendingCommercialBoundary,
} from './commercialCadence.js';

function consumeMany(frequency, count) {
  const scheduler = createCommercialCadenceScheduler({
    getFrequency: () => frequency,
  });
  return Array.from({ length: count }, (_, index) => scheduler.consumeBoundary({
    boundaryKey: `boundary-${index + 1}`,
    commercialId: `commercial-after-${index % 4}`,
  }));
}

test('every-other-set cadence advances on every boundary', () => {
  const results = consumeMany('2', 6);

  assert.deepEqual(results.map(result => result.due), [false, true, false, true, false, true]);
  assert.equal(results.at(-1).counter, 6);
});

test('every-third-set cadence advances across consecutive cycles', () => {
  const results = consumeMany('3', 9);

  assert.deepEqual(results.map(result => result.due), [
    false, false, true,
    false, false, true,
    false, false, true,
  ]);
  assert.equal(results.at(-1).counter, 9);
});

test('a skipped due slot consumes its cadence and clears only that slot', () => {
  const scheduler = createCommercialCadenceScheduler({
    getFrequency: () => '2',
  });

  const first = scheduler.consumeBoundary({
    boundaryKey: 'boundary-1',
    commercialId: 'commercial-after-0',
    skippedCommercials: ['commercial-after-0', 'commercial-after-9'],
  });
  const skipped = scheduler.consumeBoundary({
    boundaryKey: 'boundary-2',
    commercialId: 'commercial-after-0',
    skippedCommercials: first.skippedCommercials,
  });

  assert.equal(first.counter, 1);
  assert.equal(first.due, false);
  assert.equal(skipped.counter, 2);
  assert.equal(skipped.due, false);
  assert.equal(skipped.skipped, true);
  assert.deepEqual(skipped.skippedCommercials, ['commercial-after-9']);
});

test('off does not advance or reset the cadence', () => {
  let frequency = '2';
  const scheduler = createCommercialCadenceScheduler({
    getFrequency: () => frequency,
  });

  assert.equal(scheduler.consumeBoundary({ boundaryKey: 'boundary-1' }).counter, 1);
  frequency = 'off';
  const off = scheduler.consumeBoundary({ boundaryKey: 'boundary-2' });
  assert.equal(off.counter, 1);
  assert.equal(off.due, false);

  frequency = '2';
  const resumed = scheduler.consumeBoundary({ boundaryKey: 'boundary-3' });
  assert.equal(resumed.counter, 2);
  assert.equal(resumed.due, true);
});

test('duplicate boundary completion is idempotent', () => {
  const scheduler = createCommercialCadenceScheduler({
    getFrequency: () => '2',
  });

  const first = scheduler.consumeBoundary({
    boundaryKey: 'break-boundary-1',
    commercialId: 'commercial-after-1',
  });
  const duplicate = scheduler.consumeBoundary({
    boundaryKey: 'break-boundary-1',
    commercialId: 'commercial-after-1',
  });

  assert.equal(first.counter, 1);
  assert.equal(duplicate.counter, 1);
  assert.equal(duplicate.due, false);
  assert.equal(duplicate.duplicate, true);
});

test('final and hard interstitial skips forward the one pending boundary', () => {
  for (const path of ['final-break-skip', 'hard-next-entertainer']) {
    const scheduler = createCommercialCadenceScheduler({
      getFrequency: () => '2',
    });

    scheduler.consumeBoundary({
      boundaryKey: `${path}-first`,
      commercialId: 'commercial-after-0',
    });
    const pendingBoundary = scheduler.consumeBoundary({
      boundaryKey: `${path}-opened`,
      commercialId: 'commercial-after-0',
    });
    assert.equal(pendingBoundary.due, true);
    assert.equal(scheduler.counter, 2);

    // These are the two DJBooth caller paths that continue directly from an
    // interstitial into the incoming transition. Neither may consume a second
    // boundary while forwarding the decision that opened the break.
    const incomingRoute = routePendingCommercialBoundary({
      currentSongNumber: 0,
      pendingBoundary,
      fallback: {
        boundaryKey: `${path}-incoming`,
        commercialId: 'commercial-after-1',
      },
      consumeBoundary: args => scheduler.consumeBoundary(args),
    });
    const incomingBoundary = incomingRoute.boundary;

    assert.equal(incomingRoute.route, 'incoming-boundary');
    assert.equal(incomingBoundary, pendingBoundary);
    assert.equal(scheduler.counter, 2);
    assert.equal(incomingBoundary.due, true);

    const nextBoundary = scheduler.consumeBoundary({
      boundaryKey: `${path}-next`,
      commercialId: 'commercial-after-1',
    });
    assert.equal(nextBoundary.counter, 3);
    assert.equal(nextBoundary.due, false);
  }
});

test('song caller stays ordinary when no interstitial boundary is pending', () => {
  const scheduler = createCommercialCadenceScheduler({
    getFrequency: () => '2',
  });
  const pendingBoundary = scheduler.consumeBoundary({
    boundaryKey: 'boundary-1',
    commercialId: 'commercial-after-0',
  });
  let consumeCalls = 0;

  const route = routePendingCommercialBoundary({
    currentSongNumber: 1,
    pendingBoundary,
    fallback: { boundaryKey: 'must-not-consume' },
    consumeBoundary: args => {
      consumeCalls += 1;
      return scheduler.consumeBoundary(args);
    },
  });

  assert.equal(route.route, 'song');
  assert.equal(route.boundary, null);
  assert.equal(consumeCalls, 0);
  assert.equal(scheduler.counter, 1);
});
