import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoothCommandQueue,
  isPhysicalKioskAddress,
  isStructuralCommand,
  nextStateRevisions,
  normalizeBoothState,
  validateBoothCommand,
} from './booth-command-policy.js';

test('only explicit normal DJ commands validate', () => {
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
});

test('structural commands and state revisions are distinct', () => {
  assert.equal(isStructuralCommand('moveInRotation'), true);
  assert.equal(isStructuralCommand('setVolume'), false);
  const previous = { stateVersion: 7, rotationVersion: 3, rotation: [1], rotationSongs: { 1: ['a'] } };
  assert.deepEqual(nextStateRevisions(previous, { rotation: [1], rotationSongs: { 1: ['a'] } }), { stateVersion: 8, rotationVersion: 3 });
  assert.deepEqual(nextStateRevisions(previous, { rotation: [2], rotationSongs: { 1: ['a'] } }), { stateVersion: 8, rotationVersion: 4 });
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

test('kiosk locality uses the socket peer rather than forwarded headers', () => {
  const selfIps = new Set(['127.0.0.1', '192.168.1.50']);
  assert.equal(isPhysicalKioskAddress('::ffff:127.0.0.1', selfIps), true);
  assert.equal(isPhysicalKioskAddress('192.168.1.50', selfIps), true);
  assert.equal(isPhysicalKioskAddress('192.168.1.88', selfIps), false);
  assert.equal(isPhysicalKioskAddress('', selfIps), false);
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
  queue.acknowledgeThrough(command.id);
  queue.acknowledgeThrough(command.id);
  assert.deepEqual(queue.pendingSince(0, 1002), []);
});