import test from 'node:test';
import assert from 'node:assert/strict';
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