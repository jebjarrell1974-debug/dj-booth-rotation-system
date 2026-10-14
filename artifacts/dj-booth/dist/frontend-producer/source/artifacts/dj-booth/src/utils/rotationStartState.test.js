import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotationStartState, clearStartingFlag } from './rotationStartState.js';

test('idle offers Start', () => {
  const s = rotationStartState({});
  assert.equal(s.kind, 'idle');
  assert.equal(s.label, 'Start Rotation');
  assert.equal(s.busy, false);
});

test('pressing Start shows immediate local feedback and blocks a second press', () => {
  const s = rotationStartState({ starting: true });
  assert.equal(s.kind, 'starting');
  assert.equal(s.label, 'Starting…');
  assert.equal(s.disabled, true, 'a second press cannot create a duplicate start');
  assert.equal(s.busy, true);
});

test('a local press NEVER shows the rotation as active', () => {
  const s = rotationStartState({ starting: true, isRotationActive: false });
  assert.notEqual(s.kind, 'active');
  assert.doesNotMatch(s.label, /Stop/);
});

test('when the kiosk is waiting for a playback boundary it SAYS so', () => {
  const s = rotationStartState({ rotationPending: true, starting: true });
  assert.equal(s.kind, 'queued');
  assert.match(s.label, /after this song/i);
  assert.match(s.hint, /finishing the song/i);
  assert.notEqual(s.kind, 'active');
});

test('authoritative active state wins over any local flag', () => {
  const s = rotationStartState({ isRotationActive: true, starting: true, rotationPending: true });
  assert.equal(s.kind, 'active');
  assert.equal(s.label, 'Stop Rotation');
});

test('losing the kiosk disables a new start but never claims active', () => {
  const s = rotationStartState({ connected: false });
  assert.equal(s.disabled, true);
  assert.equal(s.kind, 'idle');
});

test('the local starting flag clears on any authoritative outcome', () => {
  assert.equal(clearStartingFlag({}), false, 'nothing has happened yet - keep showing Starting…');
  assert.equal(clearStartingFlag({ isRotationActive: true }), true);
  assert.equal(clearStartingFlag({ rotationPending: true }), true);
  assert.equal(clearStartingFlag({ failed: true }), true, 'confirmed failure recovers the button');
  assert.equal(clearStartingFlag({ connected: false }), true, 'lost connectivity recovers the button');
});