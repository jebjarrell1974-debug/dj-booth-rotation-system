import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaylistEditGuard, reconcileAvailablePlaylist, samePlaylist } from './playlistAvailabilitySync.js';

test('clean polling restores a reactivated saved song even when no event arrived', () => {
  const guard = createPlaylistEditGuard();
  const saved = ['Target.wav', 'Safe.wav', 'Unresolved Name'];
  const queried = new Set(saved);
  const blocked = new Set(['Safe.wav', 'Unresolved Name']);
  const removed = reconcileAvailablePlaylist(saved, ['Safe.wav', 'Unresolved Name'],
    queried, blocked, guard.canRestore(guard.capture()));
  assert.deepEqual(removed, ['Safe.wav', 'Unresolved Name']);
  const restored = reconcileAvailablePlaylist(removed, saved, queried, new Set(saved),
    guard.canRestore(guard.capture()));
  assert.deepEqual(restored, saved);
});

test('a delayed clean refetch cannot overwrite a newer addition or reorder, even after its save finishes', () => {
  const guard = createPlaylistEditGuard();
  const beforeFetch = guard.capture();
  const revision = guard.edit();
  guard.acknowledge(revision);
  assert.equal(guard.canRestore(beforeFetch), false);
  const current = ['Added.wav', 'Safe.wav'];
  assert.deepEqual(reconcileAvailablePlaylist(current, ['Target.wav', 'Safe.wav'],
    new Set(['Target.wav', 'Safe.wav']), new Set(['Target.wav', 'Safe.wav']),
    guard.canRestore(beforeFetch)), current);
});

test('pending and failed saves stay locally authoritative; an old save cannot clear newer dirty edits', () => {
  const guard = createPlaylistEditGuard();
  const first = guard.edit();
  const beforeFetch = guard.capture();
  const second = guard.edit();
  guard.acknowledge(first);
  assert.equal(guard.canRestore(beforeFetch), false);
  assert.equal(guard.canRestore(guard.capture()), false);
  guard.acknowledge(second);
  assert.equal(guard.canRestore(guard.capture()), true);
});

test('polling still removes a blocked song from a dirty list without losing unqueried additions or order', () => {
  const guard = createPlaylistEditGuard();
  guard.edit();
  assert.deepEqual(reconcileAvailablePlaylist(
    ['Added During Request.wav', 'Safe.wav', 'Target.wav', 'Unresolved Name'],
    ['Target.wav', 'Safe.wav'], new Set(['Safe.wav', 'Target.wav', 'Unresolved Name']),
    new Set(['Safe.wav', 'Unresolved Name']), guard.canRestore(guard.capture())),
  ['Added During Request.wav', 'Safe.wav', 'Unresolved Name']);
});

test('intentional saved removal is not resurrected by a later clean poll', () => {
  const guard = createPlaylistEditGuard();
  const revision = guard.edit();
  guard.acknowledge(revision);
  const current = ['Safe.wav'];
  assert.deepEqual(reconcileAvailablePlaylist(current, current,
    new Set(['Target.wav', 'Safe.wav']), new Set(['Target.wav', 'Safe.wav']),
    guard.canRestore(guard.capture())), current);
  assert.equal(samePlaylist(current, ['Safe.wav']), true);
  assert.equal(samePlaylist(current, ['Target.wav', 'Safe.wav']), false);
});
