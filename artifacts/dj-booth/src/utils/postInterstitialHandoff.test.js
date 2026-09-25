import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRecoverPostInterstitialHandoff,
  resolvePostInterstitialHandoff,
} from './postInterstitialHandoff.js';

test('index corrupted to the finished entertainer during a break does not replay her', () => {
  const rotation = ['next', 'third', 'fourth', 'finished'];
  assert.deepEqual(resolvePostInterstitialHandoff(rotation, 'next', 'finished'), {
    dancerId: 'next', index: 0, corrected: false,
  });
});

test('removing the cued entertainer during a break chooses the next live top', () => {
  assert.deepEqual(resolvePostInterstitialHandoff(['third', 'finished'], 'next', 'finished'), {
    dancerId: 'third', index: 0, corrected: false,
  });
});

test('a DJ reorder during the break chooses the new top, not a stale expected ID', () => {
  assert.equal(resolvePostInterstitialHandoff(['third', 'next', 'finished'], 'next', 'finished').dancerId, 'third');
});

test('a stale finished entertainer at the top is bypassed; a one-person set is allowed', () => {
  assert.deepEqual(resolvePostInterstitialHandoff(['finished', 'third', 'next'], 'next', 'finished'), {
    dancerId: 'next', index: 2, corrected: true,
  });
  assert.equal(resolvePostInterstitialHandoff(['finished'], null, 'finished').dancerId, 'finished');
});

test('missing or unregistered dancers are not selected', () => {
  assert.equal(resolvePostInterstitialHandoff(['missing', 'next', 'finished'], 'next', 'finished', ['next', 'finished']).dancerId, 'next');
  assert.equal(resolvePostInterstitialHandoff(['missing'], 'missing', null, []), null);
  assert.equal(resolvePostInterstitialHandoff([], 'next', 'finished'), null);
});

test('an older incoming transition cannot recover over a newer one or restart after Stop', () => {
  assert.equal(canRecoverPostInterstitialHandoff(5, 6, true, ['next']), false);
  assert.equal(canRecoverPostInterstitialHandoff(5, 5, false, ['next']), false);
  assert.equal(canRecoverPostInterstitialHandoff(5, 5, true, []), false);
  assert.equal(canRecoverPostInterstitialHandoff(5, 5, true, ['next']), true);
});