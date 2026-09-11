import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledgeRemoteDrafts,
  createRemoteEditingQueue,
  mergeRemoteBreakWorkspace,
} from './remoteEditingQueue.js';
import { rebaseBreakCursor } from './audioPlayback.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('delayed receipts serialize assignments from two different dancers and carry the applied version', async () => {
  let rotationVersion = 7;
  const calls = [];
  const receipts = [];
  const queue = createRemoteEditingQueue({
    getRotationVersion: () => rotationVersion,
    sendCommand: async (action, payload, options) => {
      calls.push({ action, payload, options });
      const receipt = await new Promise(resolve => receipts.push(resolve));
      rotationVersion = receipt.command.appliedRotationVersion;
      return receipt;
    },
  });

  const first = queue.enqueue(
    'updateSongAssignments',
    { assignments: { dancerA: ['a.mp3'] } },
    { key: 'assignment:dancerA', structural: true },
  );
  const second = queue.enqueue(
    'updateSongAssignments',
    { assignments: { dancerB: ['b.mp3'] } },
    { key: 'assignment:dancerB', structural: true },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.expectedRotationVersion, 7);
  receipts.shift()({ ok: true, command: { appliedRotationVersion: 8 } });
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.expectedRotationVersion, 8);

  receipts.shift()({ ok: true, command: { appliedRotationVersion: 9 } });
  await Promise.all([first, second]);
  assert.equal(queue.expectedRotationVersion, 9);
});

test('refreshes an idle burst from the authoritative version without falling behind a receipt floor', async () => {
  let authoritativeVersion = 7;
  const calls = [];
  const queue = createRemoteEditingQueue({
    getRotationVersion: () => authoritativeVersion,
    sendCommand: async (action, payload, options) => {
      calls.push({ action, payload, options });
      if (action === 'first') return { ok: true, command: { appliedRotationVersion: 8 } };
      return { ok: true, command: { appliedRotationVersion: options.expectedRotationVersion + 1 } };
    },
  });

  await queue.enqueue('first', {}, { structural: true });
  // The receipt is newer than this delayed/stale snapshot. It remains the
  // floor for the next idle burst instead of moving back to 7.
  authoritativeVersion = 7;
  await queue.enqueue('second', {}, { structural: true });
  assert.equal(calls[1].options.expectedRotationVersion, 8);

  // Once an external writer advances the authoritative snapshot, the next
  // idle burst catches up instead of blindly reusing the old receipt.
  authoritativeVersion = 9;
  await queue.enqueue('third', {}, { structural: true });
  assert.equal(calls[2].options.expectedRotationVersion, 9);
});

test('resets the receipt floor when an authoritative server epoch changes', async () => {
  let authority = { rotationVersion: 4, stateEpoch: 'old-server' };
  const calls = [];
  const queue = createRemoteEditingQueue({
    getRotationVersion: () => authority,
    sendCommand: async (action, payload, options) => {
      calls.push({ action, payload, options });
      return { ok: true, command: { appliedRotationVersion: options.expectedRotationVersion + 1 } };
    },
  });

  await queue.enqueue('old-write', {}, { structural: true });
  authority = { rotationVersion: 0, stateEpoch: 'new-server' };
  await queue.enqueue('new-write', {}, { structural: true });
  assert.equal(calls[1].options.expectedRotationVersion, 0);
});

test('restarts a tail enqueued during run finalization so flush cannot strand it', async () => {
  const calls = [];
  let enqueueTail;
  const queue = createRemoteEditingQueue({
    getRotationVersion: () => 1,
    sendCommand: async action => {
      calls.push(action);
      return { ok: true, command: { appliedRotationVersion: 2 } };
    },
  });

  const first = queue.enqueue('first', {}, { structural: true });
  enqueueTail = first.then(() => queue.enqueue('tail', {}, { structural: true }));
  await queue.flush();
  await enqueueTail;
  assert.deepEqual(calls, ['first', 'tail']);
});

test('save acknowledgement removes only drafts that were not edited during save', () => {
  const drafts = {
    dancerA: ['saved.mp3'],
    dancerB: ['newer.mp3'],
  };
  const savedRevisions = { dancerA: 2, dancerB: 4 };
  const currentRevisions = { dancerA: 2, dancerB: 5 };

  assert.deepEqual(
    acknowledgeRemoteDrafts(drafts, savedRevisions, currentRevisions),
    { dancerB: ['newer.mp3'] },
  );
});

test('rapid edits to distinct breaks retain both queues and manual ownership', () => {
  const first = mergeRemoteBreakWorkspace(
    {},
    {},
    { 'after-dancer-a': ['break-a.mp3'] },
    'after-dancer-a',
  );
  const second = mergeRemoteBreakWorkspace(
    first.songs,
    first.manualBreaks,
    { 'after-dancer-b': ['break-b.mp3'] },
    'after-dancer-b',
  );
  const removed = mergeRemoteBreakWorkspace(
    second.songs,
    second.manualBreaks,
    { 'after-dancer-a': [] },
    'after-dancer-a',
  );

  assert.deepEqual(second.songs, {
    'after-dancer-a': ['break-a.mp3'],
    'after-dancer-b': ['break-b.mp3'],
  });
  assert.deepEqual(second.manualBreaks, {
    'after-dancer-a': true,
    'after-dancer-b': true,
  });
  assert.deepEqual(removed.songs, { 'after-dancer-b': ['break-b.mp3'] });
  assert.deepEqual(removed.manualBreaks, { 'after-dancer-b': true });
});

test('coalesced break writes preserve every active-break cursor rebase', async () => {
  const calls = [];
  let releaseBlock;
  const blockReceipt = new Promise(resolve => { releaseBlock = resolve; });
  const queue = createRemoteEditingQueue({
    sendCommand: async (action, payload) => {
      calls.push({ action, payload });
      if (action === 'block') await blockReceipt;
      return { ok: true };
    },
  });

  const block = queue.enqueue('block');
  const first = queue.enqueue('updateInterstitialSongs', {
    interstitialSongs: { 'after-a': ['one.mp3'] },
    manualInterstitialBreaks: { 'after-a': true },
    activeBreakEdit: { breakKey: 'after-a', removedIndex: 1 },
  }, { key: 'interstitial-workspace' });
  const second = queue.enqueue('updateInterstitialSongs', {
    interstitialSongs: { 'after-a': ['two.mp3'] },
    manualInterstitialBreaks: { 'after-a': true },
    activeBreakEdit: { breakKey: 'after-a', removedIndex: 0 },
  }, { key: 'interstitial-workspace' });
  const laterWorkspaceUpdate = queue.enqueue('updateInterstitialSongs', {
    interstitialSongs: { 'after-a': ['final.mp3'] },
    manualInterstitialBreaks: { 'after-a': true },
  }, { key: 'interstitial-workspace' });

  releaseBlock();
  await Promise.all([block, first, second, laterWorkspaceUpdate]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].payload.activeBreakEdits, [
    { breakKey: 'after-a', removedIndex: 1 },
    { breakKey: 'after-a', removedIndex: 0 },
  ]);
  const nextSongIndex = calls[1].payload.activeBreakEdits.reduce(
    (index, edit) => rebaseBreakCursor(index, edit.removedIndex),
    3,
  );
  assert.equal(nextSongIndex, 1, 'both removals rebase the next song instead of skipping it');
});
