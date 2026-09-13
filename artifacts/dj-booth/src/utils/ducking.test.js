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

test('release is issued without waiting for a slow acquire to be acknowledged', async () => {
  // The lease used to `await commandChain` before sending the release, so letting go
  // could not be transmitted until the acquire had been acknowledged end to end.
  // Measured on 004 that cost 159-420 ms before the request even left the browser.
  const order = [];
  let resolveAcquire;
  const lease = createRemoteDuckLease({
    leaseIdFactory: () => 'session-slow',
    send: async (action) => {
      order.push(action);
      if (action === 'acquireDuck') {
        await new Promise(resolve => { resolveAcquire = resolve; });   // never acknowledged yet
      }
      return { ok: true };
    },
    setTimer: () => 1,
    clearTimer: () => {},
  });

  lease.start();
  lease.stop('pointerup');
  // let microtasks run; the acquire is still un-acknowledged on purpose
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(order, ['acquireDuck', 'releaseDuck'],
    'release went out while the acquire was still in flight, and still went out SECOND');
  resolveAcquire();
});

test('a quick tap cannot invert the order and strand the booth ducked', async () => {
  // The failure mode this guards: if the release were issued before the acquire, the
  // server would give it the lower id, the kiosk would apply release-then-acquire, and
  // the music would stay ducked until the lease expired.
  for (let i = 0; i < 25; i++) {
    const order = [];
    const lease = createRemoteDuckLease({
      leaseIdFactory: () => `tap-${i}`,
      send: async (action) => { order.push(action); return { ok: true }; },
      setTimer: () => 1,
      clearTimer: () => {},
    });
    lease.start();
    lease.stop('pointerup');          // released in the same tick as the press
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['acquireDuck', 'releaseDuck'], `tap ${i} inverted the order`);
  }
});

const tick = () => new Promise(resolve => setImmediate(resolve));

test('release goes out with an unresolved acquire AND a heartbeat already queued', async () => {
  // The exact sequence Replit reproduced: start, let the acquire be sent, queue a
  // heartbeat behind it, then let go. The renewal is waiting for the acquire to be
  // ACKNOWLEDGED, and the release used to be ordered behind whatever was issued last -
  // which by then was that renewal. Letting go sent nothing at all until the kiosk
  // answered the acquire.
  const order = [];
  let acknowledgeAcquire;
  const lease = createRemoteDuckLease({
    leaseIdFactory: () => 'hold-1',
    clientIdFactory: () => 'client-a',
    send: async (action) => {
      order.push(action);
      if (action === 'acquireDuck') {
        await new Promise(resolve => { acknowledgeAcquire = resolve; });
      }
      return { ok: true };
    },
    setTimer: () => 1,
    clearTimer: () => {},
  });

  lease.start();
  await tick();
  assert.deepEqual(order, ['acquireDuck'], 'the acquire was sent and is awaiting an ack');

  lease.heartbeat();                 // queued behind the unacknowledged acquire
  await tick();
  assert.deepEqual(order, ['acquireDuck'], 'the renewal is queued, not sent');

  lease.stop('pointerup');
  await tick();
  await tick();
  assert.deepEqual(order, ['acquireDuck', 'releaseDuck'],
    'the release went out while the acquire was still unacknowledged');

  acknowledgeAcquire();
  await tick();
  await tick();
  await tick();
  assert.deepEqual(order, ['acquireDuck', 'releaseDuck'],
    'the obsolete renewal was cancelled, not replayed after the hold ended');
  assert.equal(lease.getState(), 'idle');
});

test('a renewal queued behind a slow acquire still renews a hold that is still held', async () => {
  const order = [];
  let acknowledgeAcquire;
  const lease = createRemoteDuckLease({
    leaseIdFactory: () => 'hold-2',
    clientIdFactory: () => 'client-a',
    send: async (action) => {
      order.push(action);
      if (action === 'acquireDuck') {
        await new Promise(resolve => { acknowledgeAcquire = resolve; });
      }
      return { ok: true };
    },
    setTimer: () => 1,
    clearTimer: () => {},
  });

  lease.start();
  await tick();
  lease.heartbeat();
  acknowledgeAcquire();
  await tick();
  await tick();
  assert.deepEqual(order, ['acquireDuck', 'renewDuck'], 'the hold is still held, so it renews');
  await lease.stop('pointerup');
  assert.deepEqual(order, ['acquireDuck', 'renewDuck', 'releaseDuck']);
});

test('every duck command of one hold carries the same hold identity', async () => {
  const sent = [];
  const lease = createRemoteDuckLease({
    leaseIdFactory: () => 'hold-3',
    clientIdFactory: () => 'client-a',
    send: async (action, payload) => { sent.push({ action, ...payload }); return { ok: true }; },
    setTimer: () => 1,
    clearTimer: () => {},
  });

  lease.start();
  await tick();
  lease.heartbeat();
  await tick();
  await lease.stop('pointerup');

  assert.deepEqual(sent.map(entry => entry.action), ['acquireDuck', 'renewDuck', 'releaseDuck']);
  for (const entry of sent) {
    assert.equal(entry.clientId, 'client-a');
    assert.equal(entry.holdSeq, 1, 'the release must name the hold it is releasing');
    assert.equal(entry.leaseId, 'hold-3');
  }
});

test('hold numbers increase per press so the kiosk can order them without a clock', async () => {
  const sent = [];
  let press = 0;
  const lease = createRemoteDuckLease({
    leaseIdFactory: () => `hold-${++press}`,
    clientIdFactory: () => 'client-a',
    send: async (action, payload) => { sent.push({ action, ...payload }); return { ok: true }; },
    setTimer: () => 1,
    clearTimer: () => {},
  });

  lease.start();
  await lease.stop('pointerup');
  lease.start();
  await lease.stop('pointerup');

  const acquires = sent.filter(entry => entry.action === 'acquireDuck');
  const releases = sent.filter(entry => entry.action === 'releaseDuck');
  assert.deepEqual(acquires.map(entry => entry.holdSeq), [1, 2]);
  assert.deepEqual(releases.map(entry => entry.holdSeq), [1, 2]);
  assert.equal(lease.getHoldSeq(), 2);
});

test('a failure from a finished hold cannot tear down the next one', async () => {
  const errors = [];
  let failNext = false;
  const lease = createRemoteDuckLease({
    leaseIdFactory: () => 'hold-4',
    clientIdFactory: () => 'client-a',
    send: async (action) => {
      if (action === 'renewDuck' && failNext) throw new Error('renew lost');
      return { ok: true };
    },
    setTimer: () => 1,
    clearTimer: () => {},
    onError: (error, action) => { errors.push(action); },
  });

  lease.start();
  await tick();
  failNext = true;
  const renewed = lease.heartbeat();      // will reject
  await lease.stop('pointerup');          // hold is over before the failure is observed
  await renewed?.catch(() => {});
  await tick();
  assert.deepEqual(errors, [], 'a dead hold must not report errors into the live one');
});

test('letting go never sends a second release, whatever the button does', async () => {
  const order = [];
  const lease = createRemoteDuckLease({
    leaseIdFactory: () => 'hold-5',
    clientIdFactory: () => 'client-a',
    send: async (action) => { order.push(action); return { ok: true }; },
    setTimer: () => 1,
    clearTimer: () => {},
  });

  lease.start();
  const first = lease.stop('pointerup');
  const second = lease.stop('pointercancel');   // pointercancel racing pointerup
  const third = lease.stop('blur');
  await Promise.all([first, second, third]);
  await lease.stop('unmount');                  // after it has already settled
  assert.deepEqual(order, ['acquireDuck', 'releaseDuck']);
});