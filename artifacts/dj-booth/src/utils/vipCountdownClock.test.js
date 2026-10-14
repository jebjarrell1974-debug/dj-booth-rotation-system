import test from 'node:test';
import assert from 'node:assert/strict';
import { createVipCountdownClock } from './vipCountdown.js';

test('clock corrections cannot make a running countdown increase', () => {
  let wall = 1000000, mono = 0;
  const clock = createVipCountdownClock({ wallNow: () => wall, monotonicNow: () => mono });
  const entry = { expiresAt: wall + 900000, duration: 900000 };
  assert.equal(clock.remaining('A', entry), 900000);
  wall -= 26 * 3600000; mono += 60000;
  assert.equal(clock.remaining('A', { ...entry }), 840000);
  wall += 50 * 3600000; mono += 60000;
  assert.equal(clock.remaining('A', entry), 780000);
});
test('restored skewed expiry is bounded by purchased duration', () => {
  const clock = createVipCountdownClock({ wallNow: () => 0, monotonicNow: () => 0 });
  assert.equal(clock.remaining('A', { expiresAt: 1590 * 60000, duration: 15 * 60000 }), 15 * 60000);
});
test('extension adds to remaining time; string metadata is numeric', () => {
  let mono = 0;
  const clock = createVipCountdownClock({ wallNow: () => 1000000, monotonicNow: () => mono });
  const initial = { expiresAt: '1900000', duration: '900000' };
  assert.equal(clock.remaining('A', initial), 900000);
  mono = 60000;
  const remaining = clock.remaining('A', initial);
  const extended = { expiresAt: 1000000 + remaining + 900000, duration: remaining + 900000 };
  assert.equal(clock.remaining('A', extended), 1740000);
});
test('expiration reaches zero and removed entries can be newly sent', () => {
  let mono = 0;
  const clock = createVipCountdownClock({ wallNow: () => 0, monotonicNow: () => mono });
  const entry = { expiresAt: 60000, duration: 60000 };
  clock.snapshot({ A: entry });
  mono = 60001;
  assert.equal(clock.snapshot({ A: entry }).A, 0);
  clock.snapshot({});
  assert.equal(clock.remaining('A', entry), 60000);
});
