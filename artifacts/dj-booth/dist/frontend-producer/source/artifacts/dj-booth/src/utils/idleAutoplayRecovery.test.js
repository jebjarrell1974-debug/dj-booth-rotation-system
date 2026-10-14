import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getColdAutoplayStartupDecision,
  getIdleAutoplayStartMode,
  IDLE_AUTOPLAY_START_MODES,
} from './idleAutoplayRecovery.js';

test('manual queue remains playable with AutoFill disabled', () => {
  assert.equal(
    getIdleAutoplayStartMode({ hasQueue: true, autoFillEnabled: false, historyReady: false }),
    IDLE_AUTOPLAY_START_MODES.QUEUE,
  );
});

test('empty AutoFill queue requires hydrated history', () => {
  assert.equal(
    getIdleAutoplayStartMode({ hasQueue: false, autoFillEnabled: true, historyReady: false }),
    IDLE_AUTOPLAY_START_MODES.BLOCKED,
  );
  assert.equal(
    getIdleAutoplayStartMode({ hasQueue: false, autoFillEnabled: true, historyReady: true }),
    IDLE_AUTOPLAY_START_MODES.AUTOFILL,
  );
});

test('pause and live rotation block idle starters', () => {
  assert.equal(
    getIdleAutoplayStartMode({ hasQueue: true, autoFillEnabled: true, historyReady: true, paused: true }),
    IDLE_AUTOPLAY_START_MODES.BLOCKED,
  );
  assert.equal(
    getIdleAutoplayStartMode({ hasQueue: true, autoFillEnabled: true, historyReady: true, rotationActive: true }),
    IDLE_AUTOPLAY_START_MODES.BLOCKED,
  );
});

test('cold startup retries failed playback but holds explicit manual-off state', () => {
  assert.equal(
    getColdAutoplayStartupDecision({
      hasTracks: true,
      startMode: IDLE_AUTOPLAY_START_MODES.AUTOFILL,
      playbackSucceeded: false,
    }),
    'retry',
  );
  assert.equal(
    getColdAutoplayStartupDecision({
      hasTracks: true,
      startMode: IDLE_AUTOPLAY_START_MODES.BLOCKED,
      playbackSucceeded: false,
    }),
    'hold',
  );
  assert.equal(
    getColdAutoplayStartupDecision({
      hasTracks: true,
      startMode: IDLE_AUTOPLAY_START_MODES.QUEUE,
      playbackSucceeded: true,
    }),
    'ready',
  );
});