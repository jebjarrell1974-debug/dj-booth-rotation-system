import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimPlaybackOwnership,
  createPlaybackOwnership,
  excludeFailedPlaybackTrack,
  ownsPlaybackOperation,
  shouldHoldSkipTransition,
  transitionRecoveryAction,
  watchdogRecoveryOutcome,
} from './playbackOwnership.js';

test('a newer explicit operation supersedes an older recovery token', () => {
  const state = createPlaybackOwnership();
  const recovery = claimPlaybackOwnership(state, 'watchdog-recovery');
  const skip = claimPlaybackOwnership(state, 'explicit-skip');

  assert.equal(ownsPlaybackOperation(state, recovery), false);
  assert.equal(ownsPlaybackOperation(state, skip), true);
  assert.equal(skip.generation, recovery.generation + 1);
});

test('ownership remains deterministic across unrelated token checks', () => {
  const state = createPlaybackOwnership();
  const token = claimPlaybackOwnership(state, 'skip-song');

  assert.equal(ownsPlaybackOperation(state, token), true);
  assert.equal(ownsPlaybackOperation(state, { generation: token.generation, owner: 'skip-song' }), false);
});

test('an explicit skip supersedes recovery while startup is still awaited', async () => {
  const state = createPlaybackOwnership();
  let releaseStartup;
  const startup = new Promise(resolve => { releaseStartup = resolve; });
  const recovery = claimPlaybackOwnership(state, 'watchdog-recovery');
  const staleResult = startup.then(() => ownsPlaybackOperation(state, recovery));

  const skip = claimPlaybackOwnership(state, 'explicit-skip-song');
  releaseStartup();

  assert.equal(await staleResult, false);
  assert.equal(ownsPlaybackOperation(state, skip), true);
});

test('failed recovery track is excluded even when it is the only candidate', () => {
  const candidates = [
    { name: 'Stuck Song.mp3', url: '/stuck' },
    { name: 'Safe Song.mp3', url: '/safe' },
  ];

  assert.deepEqual(
    excludeFailedPlaybackTrack(candidates, 'stuck song'),
    [{ name: 'Safe Song.mp3', url: '/safe' }],
  );
  assert.deepEqual(excludeFailedPlaybackTrack([candidates[0]], 'stuck song'), []);
});

test('idle skips do not claim a transition lock', () => {
  assert.equal(shouldHoldSkipTransition({ rotationActive: false, rotationCount: 0 }), false);
  assert.equal(shouldHoldSkipTransition({ rotationActive: true, rotationCount: 2 }), true);
});

test('a manual recovery failure still reaches escalation while stale recovery does not', () => {
  assert.equal(watchdogRecoveryOutcome({ owns: true, recovered: false }), 'failed');
  assert.equal(watchdogRecoveryOutcome({ owns: false, recovered: false }), 'stale');
});

test('exhausted transition fallback leaves the deck untouched', () => {
  assert.equal(transitionRecoveryAction(false), 'leave-deck');
  assert.notEqual(transitionRecoveryAction(false), 'resume');
  assert.notEqual(transitionRecoveryAction(false), 'replay');
});