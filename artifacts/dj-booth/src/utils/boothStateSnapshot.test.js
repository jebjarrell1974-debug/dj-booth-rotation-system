import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptBoothSnapshot, compareBoothSnapshots } from './boothStateSnapshot.js';

test('accepts a newer snapshot, including an explicit stopped empty state', () => {
  const active = {
    stateVersion: 8,
    updatedAt: 800,
    isRotationActive: true,
    isPlaying: true,
    rotation: [42],
    autoplayQueue: [{ name: 'full8' }],
  };
  const stopped = {
    stateVersion: 9,
    updatedAt: 900,
    isRotationActive: false,
    isPlaying: false,
    rotation: [],
    autoplayQueue: [],
  };

  assert.equal(acceptBoothSnapshot(active, stopped), stopped);
  assert.equal(compareBoothSnapshots(stopped, active), 1);
});

test('rejects stale poll and SSE responses regardless of arrival order', () => {
  const current = {
    stateVersion: 12,
    updatedAt: 1200,
    isRotationActive: false,
    rotation: [],
  };
  const stale = {
    stateVersion: 11,
    updatedAt: 1300,
    isRotationActive: true,
    rotation: [42],
  };

  assert.equal(acceptBoothSnapshot(current, stale), current);
  assert.equal(compareBoothSnapshots(stale, current), -1);
});

test('preserves the last confirmed snapshot across disconnects and duplicate events', () => {
  const confirmed = {
    stateVersion: 3,
    updatedAt: 300,
    isRotationActive: true,
    rotation: [7],
  };

  assert.equal(acceptBoothSnapshot(confirmed, null), confirmed);
  assert.equal(acceptBoothSnapshot(confirmed, { ...confirmed }), confirmed);
});

test('uses updatedAt for legacy snapshots that have no stateVersion', () => {
  const current = { updatedAt: 20, isPlaying: true };
  const older = { updatedAt: 19, isPlaying: false };
  const newer = { updatedAt: 21, isPlaying: false };

  assert.equal(acceptBoothSnapshot(current, older), current);
  assert.equal(acceptBoothSnapshot(current, newer), newer);
});

test('holds a restarted server startup default, then accepts the new epoch publication', () => {
  const lastGood = {
    stateEpoch: '1000-kiosk-a',
    stateVersion: 8,
    updatedAt: 1800,
    isRotationActive: true,
    rotation: [42],
  };
  const restartedDefault = {
    stateEpoch: '2000-kiosk-b',
    stateVersion: 0,
    updatedAt: 0,
    isRotationActive: false,
    rotation: [],
  };
  const firstPublication = {
    stateEpoch: '2000-kiosk-b',
    stateVersion: 1,
    updatedAt: 2100,
    isRotationActive: false,
    rotation: [],
  };

  assert.equal(acceptBoothSnapshot(lastGood, restartedDefault), lastGood);
  assert.equal(acceptBoothSnapshot(lastGood, firstPublication), firstPublication);
});

test('a delayed old-epoch response cannot roll back a confirmed new epoch', () => {
  const current = {
    stateEpoch: '2000-kiosk-b',
    stateVersion: 1,
    updatedAt: 2100,
    isRotationActive: false,
    rotation: [],
  };
  const delayedOld = {
    stateEpoch: '1000-kiosk-a',
    stateVersion: 99,
    updatedAt: 2200,
    isRotationActive: true,
    rotation: [42],
  };

  assert.equal(acceptBoothSnapshot(current, delayedOld), current);
  assert.equal(compareBoothSnapshots(delayedOld, current), -1);
});
