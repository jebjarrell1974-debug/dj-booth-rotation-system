import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_SAVE_ALL_SNAPSHOT_FIELDS,
  assertSaveAllWorkspaceUnchanged,
  missingSaveAllSnapshotFields,
} from './boothCommandRuntime.js';
import {
  acquireStructuralCommitLock,
  commandIsExpired,
  mergeWorkspaceAssignments,
  runClaimedCommand,
} from './boothCommandRuntime.js';
import { applyManualAssignments, filterManualAssignments } from './rotationAssignments.js';

test('canonical assignment merge preserves explicit empty kiosk assignments', () => {
  assert.deepEqual(
    mergeWorkspaceAssignments(
      { dancerA: [{ name: 'stale' }], dancerB: [{ name: 'planned' }] },
      { dancerA: [] },
    ),
    { dancerA: [], dancerB: [{ name: 'planned' }] },
  );
});

test('live assignment merge does not resurrect consumed planned picks', () => {
  assert.deepEqual(
    mergeWorkspaceAssignments(
      { dancerA: [{ name: 'already-played' }], dancerB: [{ name: 'stale-auto-pick' }] },
      { dancerA: [{ name: 'fresh-a' }] },
      { active: true },
    ),
    { dancerA: [{ name: 'fresh-a' }] },
  );
});

test('full workspace save clears an explicit final removal without touching absent dancers', () => {
  assert.deepEqual(
    applyManualAssignments(
      {
        current: [{ name: 'old-manual' }],
        automatic: [{ name: 'fresh-auto' }],
      },
      { current: [] },
      ['current'],
    ),
    {
      current: [],
      automatic: [{ name: 'fresh-auto' }],
    },
  );
});

test('three automatic cycles plus an unrelated save keep overrides one-shot', () => {
  const manualAssignments = { rose: [{ name: 'intentional-repeat' }] };
  const manualFlags = { rose: true };
  let planned = { mira: [{ name: 'auto-1' }], rose: [{ name: 'intentional-repeat' }] };
  let live = { mira: [{ name: 'auto-1' }], rose: [{ name: 'intentional-repeat' }] };

  for (let cycle = 1; cycle <= 3; cycle += 1) {
    // The kiosk consumes the automatic queue and assigns a fresh one.
    live = { mira: [{ name: `auto-${cycle + 1}` }], rose: manualAssignments.rose };
    // A remote editor still has its old display cache and saves an unrelated
    // workspace field. Live assignments must win, and only explicit picks are
    // eligible to be sent back as overrides.
    const broadcast = mergeWorkspaceAssignments(planned, live, { active: true });
    const overrides = filterManualAssignments(broadcast, manualFlags);
    assert.deepEqual(broadcast.mira, live.mira);
    assert.deepEqual(overrides, manualAssignments);
    planned = { ...planned, mira: broadcast.mira };
  }
});

test('applied command retries publication before reporting success and never re-executes', async () => {
  let executions = 0;
  let publications = 0;
  const acknowledgements = [];
  const result = await runClaimedCommand({
    command: { id: 7 },
    execute: async () => { executions += 1; },
    publish: async () => {
      publications += 1;
      if (publications < 3) throw new Error('network down');
      return { stateVersion: 11, rotationVersion: 4 };
    },
    acknowledge: async (id, receipt) => acknowledgements.push({ id, receipt }),
    sleep: async () => {},
  });

  assert.equal(executions, 1);
  assert.equal(publications, 3);
  assert.deepEqual(result, { ok: true, stateVersion: 11, rotationVersion: 4 });
  assert.deepEqual(acknowledgements, [{ id: 7, receipt: result }]);
});

test('acknowledgement retry does not replay execution or publication', async () => {
  let executions = 0;
  let publications = 0;
  let acknowledgements = 0;
  await runClaimedCommand({
    command: { id: 8 },
    execute: async () => { executions += 1; },
    publish: async () => {
      publications += 1;
      return { stateVersion: 12, rotationVersion: 5 };
    },
    acknowledge: async () => {
      acknowledgements += 1;
      if (acknowledgements === 1) throw new Error('transient');
    },
    sleep: async () => {},
  });
  assert.equal(executions, 1);
  assert.equal(publications, 1);
  assert.equal(acknowledgements, 2);
});

test('expired queued commands are identifiable before execution', () => {
  assert.equal(commandIsExpired({ expiresAt: 1000 }, 1000), true);
  assert.equal(commandIsExpired({ expiresAt: 1001 }, 1000), false);
});

test('structural commit waits for a natural transition and acquires before commit', async () => {
  let locked = true;
  let sleeps = 0;
  await acquireStructuralCommitLock({
    command: { expiresAt: 2000 },
    isLocked: () => locked,
    lock: () => { locked = true; },
    now: () => 1000,
    sleep: async () => {
      sleeps += 1;
      locked = false;
    },
  });
  assert.equal(sleeps, 1);
  assert.equal(locked, true);
});

test('structural commit never acquires after expiring behind a transition', async () => {
  let acquired = false;
  await assert.rejects(
    acquireStructuralCommitLock({
      command: { expiresAt: 1000 },
      isLocked: () => true,
      lock: () => { acquired = true; },
      now: () => 1000,
      sleep: async () => {},
    }),
    /expired/,
  );
  assert.equal(acquired, false);
});

// --------------------------------------------------------------------------
// Save All workspace guard - regression cover for the fail-open bug.
// A snapshot missing `manualRotationSongs` previously had that safeguard DELETED
// from the comparison, which let a stale Save All overwrite a newer manual edit.
// --------------------------------------------------------------------------
const liveWithManualSongs = {
  rotation: ['a', 'b'],
  rotationSongs: { a: ['auto-1.mp3'], b: ['auto-2.mp3'] },
  manualRotationSongs: { a: ['NEWER-manual.mp3'] },
  manualRotationSetLengths: { a: 1 },
  manualInterstitialBreaks: {},
  interstitialSongs: {},
  dancerVipMap: {},
  placedFeatures: {},
};

test('a stamped snapshot missing manualRotationSongs cannot overwrite a newer manual edit', () => {
  // Exactly the fail-open case: everything the old snapshot DOES carry matches the
  // live workspace, and only the missing field would have revealed the newer edit.
  const staleSnapshotWithoutManualSongs = {
    rotation: ['a', 'b'],
    rotationSongs: { a: ['auto-1.mp3'], b: ['auto-2.mp3'] },
    manualRotationSetLengths: { a: 1 },
    manualInterstitialBreaks: {},
    interstitialSongs: {},
    dancerVipMap: {},
    placedFeatures: {},
  };
  assert.deepEqual(missingSaveAllSnapshotFields(staleSnapshotWithoutManualSongs), ['manualRotationSongs']);
  assert.throws(
    () => assertSaveAllWorkspaceUnchanged(staleSnapshotWithoutManualSongs, liveWithManualSongs),
    /incomplete kiosk snapshot/,
    'an incomplete snapshot must be refused, never silently reduced',
  );
  // and it must name the remedy
  assert.throws(() => assertSaveAllWorkspaceUnchanged(staleSnapshotWithoutManualSongs, liveWithManualSongs),
    /Refresh the remote and save again/);
});

test('an incomplete snapshot is refused even when nothing else differs', () => {
  const sameButIncomplete = { ...liveWithManualSongs };
  delete sameButIncomplete.manualRotationSongs;
  assert.throws(
    () => assertSaveAllWorkspaceUnchanged(sameButIncomplete, liveWithManualSongs),
    /incomplete kiosk snapshot/,
  );
});

test('a missing snapshot entirely is refused, listing every required field', () => {
  assert.deepEqual(missingSaveAllSnapshotFields(undefined), REQUIRED_SAVE_ALL_SNAPSHOT_FIELDS);
  assert.throws(() => assertSaveAllWorkspaceUnchanged(undefined, liveWithManualSongs), /incomplete kiosk snapshot/);
});

test('a complete snapshot with newer manual song contents is rejected as changed', () => {
  const stale = { ...liveWithManualSongs, manualRotationSongs: { a: ['older-manual.mp3'] } };
  assert.throws(
    () => assertSaveAllWorkspaceUnchanged(stale, liveWithManualSongs),
    /kiosk workspace changed/,
  );
});

test('an explicit empty manual list is a real edit, not an absent value', () => {
  const cleared = { ...liveWithManualSongs, manualRotationSongs: { a: [] } };
  assert.throws(() => assertSaveAllWorkspaceUnchanged(cleared, liveWithManualSongs), /kiosk workspace changed/);
});

test('an explicit manual set length of 0 is a real edit', () => {
  const zeroed = { ...liveWithManualSongs, manualRotationSetLengths: { a: 0 } };
  assert.throws(() => assertSaveAllWorkspaceUnchanged(zeroed, liveWithManualSongs), /kiosk workspace changed/);
});

test('contents of an ALREADY-manual break are compared, not just the ownership marker', () => {
  const live = {
    ...liveWithManualSongs,
    manualInterstitialBreaks: { 'after-a': true },
    interstitialSongs: { 'after-a': ['NEWER-break.mp3'] },
  };
  const stale = {
    ...live,
    interstitialSongs: { 'after-a': ['older-break.mp3'] },   // marker identical
  };
  assert.deepEqual(stale.manualInterstitialBreaks, live.manualInterstitialBreaks);
  assert.throws(() => assertSaveAllWorkspaceUnchanged(stale, live), /kiosk workspace changed/);
});

test('unrelated AUTOMATIC song churn does not reject Save All', () => {
  const churned = {
    ...liveWithManualSongs,
    rotationSongs: { a: ['auto-CHANGED.mp3'], b: ['auto-ALSO-CHANGED.mp3'] },
    interstitialSongs: { 'auto-break': ['auto-filler.mp3'] },
  };
  assert.doesNotThrow(() => assertSaveAllWorkspaceUnchanged(churned, liveWithManualSongs));
});

test('an identical complete snapshot passes', () => {
  assert.doesNotThrow(() => assertSaveAllWorkspaceUnchanged({ ...liveWithManualSongs }, liveWithManualSongs));
});