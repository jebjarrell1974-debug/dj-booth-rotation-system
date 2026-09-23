import test from 'node:test';
import assert from 'node:assert/strict';
import { createVipRemainingSnapshot, decayVipRemaining } from './vipCountdown.js';

test('kiosk publishes remaining milliseconds, not an expiry for remotes', () => {
  assert.deepEqual(createVipRemainingSnapshot({
    dancer: { expiresAt: 1_000_000 },
  }, 940_000), { dancer: 60_000 });
});

test('remote countdown uses monotonic receipt elapsed time despite wall-clock skew', () => {
  const snapshot = createVipRemainingSnapshot({ dancer: { expiresAt: 1_000_000 } }, 940_000);
  assert.equal(decayVipRemaining(snapshot.dancer, 500, 1_100), 59_400);
  // The remote's Date.now may be ±56 days; it is deliberately not an input.
  assert.equal(decayVipRemaining(snapshot.dancer, 500, 60_500), 0);
});