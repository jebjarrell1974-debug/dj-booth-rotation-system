import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoothCommandQueue,
  boothWorkspaceSnapshot,
  isPhysicalKioskAddress,
  isPhysicalKioskRequestMetadata,
  isStructuralCommand,
  nextStateRevisions,
  normalizeBoothState,
  validateBoothCommand,
} from './booth-command-policy.js';

test('only explicit normal DJ commands validate', () => {
  assert.equal(validateBoothCommand('skip', {}).ok, true);
  assert.equal(validateBoothCommand('skip', { skipBreaks: true }).ok, true);
  assert.equal(validateBoothCommand('skip', { skipBreaks: 'true' }).ok, false);
  assert.equal(validateBoothCommand('setVolume', { volume: 0 }).ok, true);
  assert.equal(validateBoothCommand('deactivateTrack', {}).ok, false);
  assert.equal(validateBoothCommand('deactivateTrack', { trackName: 'Song A.mp3', pin: '12345' }).ok, true);
  assert.equal(validateBoothCommand('deactivateTrack', { trackName: 'Song A.mp3', pin: '1234' }).ok, false);
  assert.equal(validateBoothCommand('deactivateTrack', { trackName: 'Song A.mp3', pin: 'abcde' }).ok, false);
  assert.equal(isStructuralCommand('deactivateTrack'), false);
  assert.equal(validateBoothCommand('reboot', {}).ok, false);
  assert.equal(validateBoothCommand('setVolume', { volume: 1.01 }).ok, false);
  assert.equal(validateBoothCommand('sendToVip', { dancerId: 4, durationMs: 0 }).ok, false);
  assert.equal(validateBoothCommand('updateRotation', { rotation: [1, 'dancer-2'] }).ok, true);
  assert.equal(validateBoothCommand('updateSongAssignments', { assignments: { 1: ['Song A'] } }).ok, true);
  assert.equal(validateBoothCommand('updateSongAssignments', { assignments: { 1: 'Song A' } }).ok, false);
  assert.equal(validateBoothCommand('saveRotationWorkspace', {
    rotation: [1],
    assignments: { 1: ['Song A'] },
    interstitialSongs: { 'after-1': ['Break A'] },
    manualOverrides: [1],
  }).ok, true);
  assert.equal(validateBoothCommand('saveRotationWorkspace', {
    rotation: [1],
    assignments: { 1: [] },
    interstitialSongs: {},
    manualOverrides: [1],
  }).ok, true);
  assert.equal(validateBoothCommand('setAutoplayQueue', { trackNames: ['Song A'] }).ok, true);
  assert.equal(validateBoothCommand('playFeatureAudio', { dancerId: 1, type: 'intro' }).ok, true);
  assert.equal(validateBoothCommand('placeFeature', { featureId: 1, playPos: 2, audioFlags: {} }).ok, true);
  assert.equal(validateBoothCommand('setMusicEq', { band: 'bass', value: -12 }).ok, true);
});

test('full structural workspace snapshot normalizes assigned song names', () => {
  assert.deepEqual(boothWorkspaceSnapshot({
    rotation: [1, 2],
    rotationSongs: {
      1: [{ name: 'One', url: '/one' }],
      2: [{ file_name: 'Two' }],
      3: [{ filename: 'Three' }],
    },
    interstitialSongs: { 'after-1': ['Break'] },
    dancerVipMap: { 2: { expiresAt: 5000 } },
    placedFeatures: { 2: { chosenSetName: 'Feature Set' } },
  }), {
    rotation: [1, 2],
    rotationSongs: { 1: ['One'], 2: ['Two'], 3: ['Three'] },
    interstitialSongs: { 'after-1': ['Break'] },
    dancerVipMap: { 2: { expiresAt: 5000 } },
    placedFeatures: { 2: { chosenSetName: 'Feature Set' } },
  });
});

test('structural commands and state revisions are distinct', () => {
  assert.equal(isStructuralCommand('moveInRotation'), true);
  assert.equal(isStructuralCommand('setVolume'), false);
  const previous = { stateVersion: 7, rotationVersion: 3, rotation: [1], rotationSongs: { 1: ['a'] } };
  assert.deepEqual(nextStateRevisions(previous, { rotation: [1], rotationSongs: { 1: ['a'] } }), { stateVersion: 8, rotationVersion: 3 });
  assert.deepEqual(nextStateRevisions(previous, { rotation: [2], rotationSongs: { 1: ['a'] } }), { stateVersion: 8, rotationVersion: 4 });
  assert.deepEqual(nextStateRevisions(
    { ...previous, manualRotationSongs: {} },
    { rotation: [1], rotationSongs: { 1: ['a'] }, manualRotationSongs: { 1: ['dj-pick'] } },
  ), { stateVersion: 8, rotationVersion: 4 });
});

test('zero-valued booth state survives normalization', () => {
  const state = normalizeBoothState(
    { stateVersion: 4, rotationVersion: 2, rotation: [], rotationSongs: {} },
    { currentDancerIndex: 0, currentSongNumber: 0, volume: 0, trackTime: 0, breakSongsPerSet: 0 },
    1234,
  );
  assert.equal(state.currentDancerIndex, 0);
  assert.equal(state.currentSongNumber, 0);
  assert.equal(state.volume, 0);
  assert.equal(state.trackTime, 0);
  assert.equal(state.breakSongsPerSet, 0);
  assert.equal(state.updatedAt, 1234);
});

test('duck lease commands accept scoped lease IDs and reject malformed leases', () => {
  assert.equal(validateBoothCommand('acquireDuck', { leaseId: 'session-a', leaseMs: 3000 }).ok, true);
  assert.equal(validateBoothCommand('renewDuck', { leaseId: 'session-a' }).ok, true);
  assert.equal(validateBoothCommand('releaseDuck', { leaseId: 'session-a' }).ok, true);
  assert.equal(validateBoothCommand('releaseDuck', { leaseId: '' }).ok, false);
  assert.equal(validateBoothCommand('renewDuck', { leaseId: 'session-a', leaseMs: 100 }).ok, false);
});

test('kiosk locality uses the socket peer rather than forwarded headers', () => {
  const selfIps = new Set(['127.0.0.1', '192.168.1.50']);
  assert.equal(isPhysicalKioskAddress('::ffff:127.0.0.1', selfIps), true);
  assert.equal(isPhysicalKioskAddress('::1', selfIps), true);
  assert.equal(isPhysicalKioskAddress('192.168.1.50', selfIps), false);
  assert.equal(isPhysicalKioskAddress('192.168.1.88', selfIps), false);
  assert.equal(isPhysicalKioskAddress('', selfIps), false);
});

test('physical privilege also requires a direct loopback Host with no forwarding indicators', () => {
  assert.equal(isPhysicalKioskRequestMetadata('127.0.0.1', 'localhost:3001'), true);
  assert.equal(isPhysicalKioskRequestMetadata('::1', '[::1]:3001'), true);
  assert.equal(isPhysicalKioskRequestMetadata('127.0.0.1', '127.0.0.1'), true);

  assert.equal(
    isPhysicalKioskRequestMetadata('127.0.0.1', 'public-example.replit.dev'),
    false,
  );
  assert.equal(
    isPhysicalKioskRequestMetadata('127.0.0.1', 'localhost:3001', {
      'x-forwarded-host': 'public-example.replit.dev',
    }),
    false,
  );
  assert.equal(
    isPhysicalKioskRequestMetadata('127.0.0.1', 'localhost:3001', {
      forwarded: 'for=203.0.113.10;host=localhost',
    }),
    false,
  );
  assert.equal(
    isPhysicalKioskRequestMetadata('192.168.1.50', 'localhost:3001'),
    false,
  );
});

test('command queue deduplicates request IDs and expires pending work', () => {
  const queue = new BoothCommandQueue({ dedupeTtlMs: 10_000 });
  const first = queue.enqueue('setVolume', { volume: 0 }, { actor: 'dj:a', requestId: 'req-1', ttlMs: 500 }, 1000);
  const duplicate = queue.enqueue('setVolume', { volume: 0 }, { actor: 'dj:a', requestId: 'req-1', ttlMs: 500 }, 1100);
  const otherActor = queue.enqueue('setVolume', { volume: 0 }, { actor: 'dj:b', requestId: 'req-1', ttlMs: 500 }, 1100);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.command.id, first.command.id);
  assert.notEqual(otherActor.command.id, first.command.id);
  assert.deepEqual(queue.pendingSince(0, 1499).map(command => command.id), [first.command.id, otherActor.command.id]);
  assert.deepEqual(queue.pendingSince(0, 1601), []);
});

test('acknowledging duplicate SSE and poll delivery removes a command once', () => {
  const queue = new BoothCommandQueue();
  const { command } = queue.enqueue('skip', {}, { actor: 'dj:a', requestId: 'req-2' }, 1000);
  assert.deepEqual(queue.pendingSince(0, 1001).map(item => item.id), [command.id]);
  queue.acknowledge(command.id, { ok: true }, 1001);
  queue.acknowledge(command.id, { ok: true }, 1002);
  assert.deepEqual(queue.pendingSince(0, 1002), []);
  assert.equal(queue.getById(command.id, 1002).status, 'applied');
});

test('acknowledgements are exact and expose applied or failed receipts', () => {
  const queue = new BoothCommandQueue();
  const first = queue.enqueue('skip', {}, { actor: 'dj:a', requestId: 'one' }, 1000).command;
  const second = queue.enqueue('setVolume', { volume: 0.5 }, { actor: 'dj:a', requestId: 'two' }, 1001).command;
  queue.acknowledge(second.id, { ok: true, stateVersion: 9 }, 1010);
  assert.deepEqual(queue.pendingSince(0, 1011).map(item => item.id), [first.id]);
  assert.equal(queue.getById(second.id, 1011).status, 'applied');
  assert.equal(queue.getById(second.id, 1011).appliedStateVersion, 9);
  queue.acknowledge(first.id, { ok: false, error: 'transition in progress' }, 1012);
  assert.equal(queue.getById(first.id, 1013).status, 'failed');
});

test('structural reservations detect concurrent edits at one revision', () => {
  const queue = new BoothCommandQueue();
  const command = queue.enqueue(
    'saveRotation',
    { rotation: [1] },
    { actor: 'dj:a', requestId: 'one', expectedRotationVersion: 4 },
    1000,
  ).command;
  assert.equal(queue.pendingStructuralForVersion(4, 1001)?.id, command.id);
  assert.equal(queue.pendingStructuralForVersion(5, 1001), null);
  queue.acknowledge(command.id, { ok: true }, 1002);
  assert.equal(queue.pendingStructuralForVersion(4, 1003), null);
});

test('claim is atomic, rejects expired work, and keeps structural reservation until receipt', () => {
  const queue = new BoothCommandQueue();
  const claimed = queue.enqueue('updateRotation', { rotation: ['a'] }, {
    expectedRotationVersion: 4,
  }, 1000).command;
  assert.equal(queue.claim(claimed.id, 1001)?.status, 'processing');
  assert.equal(queue.claim(claimed.id, 1002)?.status, 'processing');
  assert.equal(queue.pendingSince(0, 1002).length, 0);
  assert.equal(queue.pendingStructuralForVersion(4, 1002)?.id, claimed.id);
  queue.acknowledge(claimed.id, { ok: true }, 1003);
  assert.equal(queue.pendingStructuralForVersion(4, 1004), null);

  const expired = queue.enqueue('skip', {}, { ttlMs: 10 }, 2000).command;
  assert.equal(queue.claim(expired.id, 2011)?.status, 'expired');
});

test('processing commands remain queued receipts and count against queue capacity', () => {
  const queue = new BoothCommandQueue({ maxSize: 1 });
  const command = queue.enqueue('skip', {}, {}, 1000).command;
  queue.claim(command.id, 1001);
  assert.throws(
    () => queue.enqueue('skip', {}, {}, 1002),
    error => error.code === 'BOOTH_COMMAND_QUEUE_FULL',
  );
  assert.equal(queue.getById(command.id, 1002)?.status, 'processing');
});

test('publication-pending processing work cannot be pruned or deduplicated into replay', () => {
  const queue = new BoothCommandQueue({ dedupeTtlMs: 100 });
  const first = queue.enqueue('skip', {}, {
    actor: 'dj:a',
    requestId: 'same-side-effect',
  }, 1000).command;
  queue.claim(first.id, 1001);

  assert.equal(queue.getById(first.id, 5000)?.status, 'processing');
  const duplicate = queue.enqueue('skip', {}, {
    actor: 'dj:a',
    requestId: 'same-side-effect',
  }, 5000);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.command.id, first.id);
});