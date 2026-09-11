import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeDuckGain,
  composeMusicOutputGain,
  createDuckOwnerStore,
  VOICE_DUCK_GAIN,
} from './ducking.js';
import { createRemoteDuckLease } from './duckLease.js';

test('duck owners compose by quietest gain and releasing one preserves another', () => {
  const owners = new Map([
    ['voiceover', { gain: VOICE_DUCK_GAIN }],
    ['manual', { gain: 0.42 }],
  ]);
  assert.equal(composeDuckGain(0.8, owners), VOICE_DUCK_GAIN);
  owners.delete('voiceover');
  assert.equal(composeDuckGain(0.8, owners), 0.42);
  owners.delete('manual');
  assert.equal(composeDuckGain(0.8, owners), 0.8);
});

test('changing the current music volume while held never changes the duck multiplier', () => {
  const store = createDuckOwnerStore();
  store.acquire('manual', { gain: VOICE_DUCK_GAIN });
  const duckGain = store.getTargetGain(1);
  assert.equal(duckGain, VOICE_DUCK_GAIN);
  assert.equal(composeMusicOutputGain(0.8, duckGain), 0.8 * VOICE_DUCK_GAIN);
  assert.equal(composeMusicOutputGain(0.35, duckGain), 0.35 * VOICE_DUCK_GAIN);
  store.release('manual');
  assert.equal(composeMusicOutputGain(0.35, store.getTargetGain(1)), 0.35);
});

test('expired remote owner is removed without affecting another client lease', () => {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const store = createDuckOwnerStore({
    now: () => now,
    setTimer: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimer: id => timers.delete(id),
  });

  store.acquire('remote:client-a:lease-a', { gain: VOICE_DUCK_GAIN, leaseMs: 100 });
  store.acquire('remote:client-b:lease-b', { gain: 0.35, leaseMs: 250 });
  now = 101;
  for (const [id, timer] of [...timers]) {
    if (timer.at <= now) {
      timers.delete(id);
      timer.callback();
    }
  }
  assert.equal(store.has('remote:client-a:lease-a'), false);
  assert.equal(store.has('remote:client-b:lease-b'), true);
  assert.equal(store.getTargetGain(0.8), 0.35);
});

test('remote release is ordered after an in-flight acquire and cancels heartbeats', async () => {
  const calls = [];
  const heartbeatCallbacks = [];
  const lease = createRemoteDuckLease({
    leaseIdFactory: () => 'session-a',
    send: async action => {
      calls.push(action);
      return { ok: true };
    },
    setTimer: callback => {
      heartbeatCallbacks.push(callback);
      return heartbeatCallbacks.length;
    },
    clearTimer: () => {},
  });

  lease.start();
  const released = lease.stop('pointerup');
  await released;
  heartbeatCallbacks[0]?.();
  assert.deepEqual(calls, ['acquireDuck', 'releaseDuck']);
  assert.equal(lease.getState(), 'idle');
});