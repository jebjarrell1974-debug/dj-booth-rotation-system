import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCommandFeedback,
  isConfirmedApplication,
  describeReconciledOutcome,
  noticeForAction,
  labelForAction,
  COMMAND_NOTICES,
  SILENT_SUCCESS_ACTIONS,
  EMPTY_COMMAND_VIEW,
  isUnresolved,
} from './commandFeedback.js';

function harness({ reconcile, maxEntries } = {}) {
  // A controllable clock: banner windows are time-based, so the tests advance time
  // explicitly rather than sleeping.
  const state = { view: EMPTY_COMMAND_VIEW, timers: [], views: [], clock: 1_000_000 };
  const fb = createCommandFeedback({
    onChange: (v) => { state.view = v; state.views.push(v); },
    reconcile,
    noticeMs: 2500,
    errorMs: 6000,
    now: () => state.clock,
    ...(maxEntries == null ? {} : { maxEntries }),
    schedule: (fn, ms) => { state.timers.push({ fn, ms, at: state.clock + ms }); },
  });
  state.fireTimer = (i) => state.timers[i].fn();
  state.fireAllTimers = () => { const t = state.timers.slice(); state.timers.length = 0; t.forEach(x => x.fn()); };
  // advance the clock and fire every timer that has come due
  state.advance = (ms) => {
    state.clock += ms;
    const due = state.timers.filter(t => t.at <= state.clock);
    state.timers = state.timers.filter(t => t.at > state.clock);
    due.forEach(t => t.fn());
  };
  return { state, surface: fb.surface, dismiss: fb.dismiss, dismissAll: fb.dismissAll, snapshot: fb.snapshot };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const unknownError = (requestId) => Object.assign(new Error('no confirmation'), {
  resultUnknown: true, requestId, commandId: 7, serverEpochAtSend: 'epoch-A', submittedAt: 1700,
});

// ---------------------------------------------------------------- basics ----

test('a confirmed receipt shows the action notice', async () => {
  const { state, surface } = harness();
  await surface('addDancerToRotation', Promise.resolve({ ok: true }));
  assert.equal(state.view.kind, 'notice');
  assert.equal(state.view.message, 'Added to rotation.');
  assert.equal(state.view.unresolvedCount, 0);
});

test('the notice clears itself after noticeMs', async () => {
  const { state, surface } = harness();
  await surface('skip', Promise.resolve({ ok: true }));
  assert.equal(state.view.message, 'Skipped.');
  assert.equal(state.timers.length, 1);
  assert.equal(state.timers[0].ms, 2500);
  state.advance(2500);
  assert.equal(state.view.kind, null);
});

test('a resolved-but-unconfirmed result is NEVER reported as success', async () => {
  const { state, surface } = harness();
  await surface('saveRotationWorkspace', Promise.resolve(null));
  assert.equal(state.view.kind, 'error');
  assert.match(state.view.message, /Save All: the kiosk did not confirm/);
});

test('ok:false is not success either', async () => {
  const { state, surface } = harness();
  await surface('sendToVip', Promise.resolve({ ok: false, command: { error: 'nope' } }));
  assert.equal(state.view.kind, 'error');
  assert.match(state.view.message, /Send to VIP: the kiosk did not confirm/);
});

test('an ordinary rejection surfaces the message and still rejects for awaiting callers', async () => {
  const { state, surface } = harness();
  await assert.rejects(
    () => surface('removeDancerFromRotation', Promise.reject(new Error('The kiosk rejected the command'))),
    /The kiosk rejected the command/,
  );
  assert.equal(state.view.kind, 'error');
  assert.match(state.view.message, /Remove from rotation: The kiosk rejected the command/);
});

test('fire-and-forget call sites do not raise an unhandled rejection', async () => {
  const seen = [];
  const onUnhandled = (err) => seen.push(err);
  process.on('unhandledRejection', onUnhandled);
  try {
    const { surface } = harness();
    surface('skip', Promise.reject(new Error('boom')));   // promise deliberately discarded
    await settle(); await settle();
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(seen, []);
});

test('silent-success actions show no notice but DO show errors', async () => {
  const { state, surface } = harness();
  await surface('setVolume', Promise.resolve({ ok: true }));
  assert.equal(state.view.kind, null);
  assert.equal(state.timers.length, 0);
  await assert.rejects(() => surface('setVolume', Promise.reject(new Error('kiosk offline'))));
  assert.equal(state.view.kind, 'error');
  assert.match(state.view.message, /Volume: kiosk offline/);
});

// ------------------------------------------------- unknown-outcome basics ----

test('an unknown outcome shows "checking", then the reconciled result - and reconciles ONCE', async () => {
  const calls = [];
  const held = deferred();
  const { state, surface } = harness({ reconcile: (ctx) => { calls.push(ctx); return held.promise; } });
  await assert.rejects(() => surface('addDancerToRotation', Promise.reject(unknownError('rid-1'))));
  assert.equal(state.view.kind, 'unknown');
  assert.match(state.view.message, /Add to rotation: outcome unknown - checking the kiosk/);
  assert.equal(state.view.requestId, 'rid-1', 'the entry is tied to its originating requestId');
  held.resolve({ outcome: 'applied' });
  await settle(); await settle();
  assert.equal(state.view.kind, 'notice');
  assert.equal(state.view.message, 'Added to rotation.');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { requestId: 'rid-1', commandId: 7, serverEpochAtSend: 'epoch-A', submittedAt: 1700 });
});

test('a reconciled failure is reported as a failure, not as unknown', async () => {
  const { state, surface } = harness({ reconcile: () => Promise.resolve({ outcome: 'failed', error: 'Rotation is empty' }) });
  await assert.rejects(() => surface('startRotation', Promise.reject(unknownError('r'))));
  await settle(); await settle();
  assert.equal(state.view.kind, 'error');
  assert.match(state.view.message, /Start rotation: Rotation is empty/);
});

test('a still-pending command stops with an explicit unresolved message', async () => {
  const { state, surface } = harness({ reconcile: () => Promise.resolve({ outcome: 'pending' }) });
  await assert.rejects(() => surface('skip', Promise.reject(unknownError('r'))));
  await settle(); await settle();
  assert.match(state.view.message, /Still queued at the kiosk when checking stopped/);
});

test('a reconciliation that itself fails does not claim an outcome', async () => {
  const { state, surface } = harness({ reconcile: () => Promise.reject(new Error('offline')) });
  await assert.rejects(() => surface('swapPromo', Promise.reject(unknownError('r'))));
  await settle(); await settle();
  assert.equal(state.view.kind, 'error');
  assert.match(state.view.message, /Could not confirm whether this action was applied/);
});

test('a missing record stays UNKNOWN - it is never reported as "nothing was applied"', async () => {
  const { state, surface } = harness({ reconcile: () => Promise.resolve({ outcome: 'unknown', reason: 'no-record' }) });
  await assert.rejects(() => surface('addDancerToRotation', Promise.reject(unknownError('r'))));
  await settle(); await settle();
  assert.match(state.view.message, /no record of that request/);
  assert.match(state.view.message, /Could not confirm whether this action was applied/);
  assert.match(state.view.message, /Check the current booth state before trying again/);
});

test('NO unconfirmed reason ever claims non-application or that retrying is safe', () => {
  for (const reason of [undefined, 'no-record', 'unreachable', 'server-restarted', 'identity-mismatch', 'dedupe-expired']) {
    const described = describeReconciledOutcome({ outcome: 'unknown', reason }, 'skip');
    assert.equal(described.kind, 'error', `reason ${reason} must not be a success`);
    assert.doesNotMatch(described.message, /nothing was applied/i, `reason ${reason}`);
    assert.doesNotMatch(described.message, /safe to (try|retry)/i, `reason ${reason}`);
    assert.doesNotMatch(described.message, /was not applied/i, `reason ${reason}`);
    assert.match(described.message, /Could not confirm whether this action was applied/, `reason ${reason}`);
    assert.match(described.message, /Check the current booth state/, `reason ${reason}`);
  }
  const pending = describeReconciledOutcome({ outcome: 'pending' }, 'skip');
  assert.match(pending.message, /Still queued at the kiosk/);
  assert.doesNotMatch(pending.message, /safe to (try|retry)/i);
  assert.equal(describeReconciledOutcome({ outcome: 'applied' }, 'skip').kind, 'notice');
  assert.equal(describeReconciledOutcome({ outcome: 'failed', error: 'nope' }, 'skip').message, 'nope');
});

// =================================================================
// CONCURRENCY. An unresolved outcome belongs to ONE command and may not be
// overwritten or cleared by any other command's success, failure, timer or
// reconciliation completion.
// =================================================================

test('REGRESSION: an unknown VIP survives a successful Add and a successful volume change', async () => {
  // Exactly the sequence Replit reproduced. Every step used to trample the VIP state;
  // the last one erased it outright.
  const vipLookup = deferred();
  const { state, surface, snapshot } = harness({ reconcile: () => vipLookup.promise });

  // 1. VIP times out -> unknown, checking
  await assert.rejects(() => surface('sendToVip', Promise.reject(unknownError('rid-vip'))));
  assert.equal(state.view.kind, 'unknown');
  assert.match(state.view.message, /Send to VIP/);

  // 2. an unrelated Add succeeds - it must NOT hide the VIP check
  await surface('addDancerToRotation', Promise.resolve({ ok: true }));
  assert.equal(state.view.kind, 'unknown', 'a success must not hide an unresolved outcome');
  assert.match(state.view.message, /Send to VIP: outcome unknown/);
  assert.equal(state.view.requestId, 'rid-vip');

  // 3. the VIP lookup comes back with no record -> uncertainty, still about VIP
  vipLookup.resolve({ outcome: 'unknown', reason: 'no-record' });
  await settle(); await settle();
  assert.equal(state.view.kind, 'error');
  assert.match(state.view.message, /^Send to VIP: /);
  assert.match(state.view.message, /no record of that request/);
  assert.match(state.view.message, /Could not confirm whether this action was applied/);

  // 4. an unrelated successful setVolume must NOT clear it
  await surface('setVolume', Promise.resolve({ ok: true }));
  assert.equal(state.view.kind, 'error', 'a silent success must not clear an unresolved outcome');
  assert.match(state.view.message, /Send to VIP/);
  assert.equal(state.view.unresolvedCount, 1);

  // 5. a NON-silent unrelated success must not clear it either
  await surface('skip', Promise.resolve({ ok: true }));
  assert.equal(state.view.kind, 'error');
  assert.match(state.view.message, /Send to VIP/);

  // 6. every expiry window may elapse; none of them owns the VIP entry, and the VIP
  //    uncertainty is retained even once its own banner has gone
  state.advance(6000);
  assert.equal(snapshot().unresolvedCount, 1);
  assert.ok(snapshot().entries.some(e => /Send to VIP/.test(e.message)));
});

test('REGRESSION: only an explicit dismiss of that entry clears an unresolved outcome', async () => {
  const { state, surface, dismiss } = harness({ reconcile: () => Promise.resolve({ outcome: 'unknown', reason: 'no-record' }) });
  await assert.rejects(() => surface('sendToVip', Promise.reject(unknownError('rid-vip'))));
  await settle(); await settle();
  assert.equal(state.view.kind, 'error');
  const vipId = state.view.id;

  await surface('addDancerToRotation', Promise.resolve({ ok: true }));
  await surface('setVolume', Promise.resolve({ ok: true }));
  assert.equal(state.view.id, vipId, 'still showing the VIP entry');

  dismiss(vipId);
  // The VIP uncertainty is gone; the still-live Add notice is what remains, and nothing
  // is unresolved any more.
  assert.equal(state.view.unresolvedCount, 0);
  assert.doesNotMatch(state.view.message || '', /Send to VIP/);
  state.advance(6000);
  assert.equal(state.view.kind, null);
});

test('REGRESSION: two unknown commands whose lookups finish in REVERSE order keep their own outcomes', async () => {
  const lookups = new Map();
  const { state, surface, dismiss, snapshot } = harness({
    reconcile: (ctx) => { const d = deferred(); lookups.set(ctx.requestId, d); return d.promise; },
  });

  await assert.rejects(() => surface('sendToVip', Promise.reject(unknownError('rid-vip'))));
  await assert.rejects(() => surface('saveRotationWorkspace', Promise.reject(unknownError('rid-save'))));
  assert.equal(snapshot().pendingCount, 2);
  // the OLDEST still-checking action is the one shown, and the count says another waits
  assert.match(state.view.message, /Send to VIP: outcome unknown/);
  assert.equal(state.view.extra, '+1 more unconfirmed: Save All');

  // the SECOND command's lookup finishes FIRST, and applies only to itself
  lookups.get('rid-save').resolve({ outcome: 'failed', error: 'workspace changed' });
  await settle(); await settle();
  assert.equal(state.view.kind, 'error');
  assert.match(state.view.message, /Save All: workspace changed/);
  assert.equal(snapshot().pendingCount, 1, 'the VIP lookup is still running');
  // The Save outcome came back as a settled failure, so it is CONFIRMED - known, not
  // uncertain. Only the still-running VIP check counts as unresolved.
  assert.equal(state.view.certainty, 'confirmed');
  assert.equal(snapshot().unresolvedCount, 1);
  assert.equal(snapshot().errorCount, 1, 'the confirmed failure is still on the books');

  // now the FIRST command's lookup finishes - it must land on the VIP entry, not the Save entry
  lookups.get('rid-vip').resolve({ outcome: 'unknown', reason: 'dedupe-expired' });
  await settle(); await settle();
  const all = [];
  for (let i = 0; i < 4; i++) { all.push(state.view); dismiss(state.view.id); }
  const messages = all.filter(Boolean).map(v => v.message);
  assert.ok(messages.some(m => /Save All: workspace changed/.test(m)), 'the Save outcome survived');
  assert.ok(messages.some(m => /Send to VIP: .*no longer holds a record/.test(m)), 'the VIP outcome landed on the VIP entry');
  assert.equal(snapshot().unresolvedCount, 0);
});

test('REGRESSION: an older success timer must not clear a newer notice', async () => {
  const { state, surface } = harness();
  await surface('addDancerToRotation', Promise.resolve({ ok: true }));
  assert.equal(state.view.message, 'Added to rotation.');

  state.advance(500);                       // the newer notice starts half a second later
  await surface('skip', Promise.resolve({ ok: true }));
  assert.equal(state.view.message, 'Skipped.', 'the newer notice is showing');
  assert.equal(state.timers.length, 2);

  // the FIRST command's window ends while the second is still inside its own
  state.advance(2000);
  assert.equal(state.view.kind, 'notice');
  assert.equal(state.view.message, 'Skipped.', 'the newer notice survived the older expiry');

  // and the newer one still expires on its own schedule
  state.advance(500);
  assert.equal(state.view.kind, null);
});

test('REGRESSION: an older unknown-turned-notice timer cannot clear a newer unresolved outcome', async () => {
  const first = deferred();
  const second = deferred();
  const queue = [first, second];
  const { state, surface, snapshot } = harness({ reconcile: () => queue.shift().promise });
  await assert.rejects(() => surface('skip', Promise.reject(unknownError('rid-a'))));
  await assert.rejects(() => surface('sendToVip', Promise.reject(unknownError('rid-b'))));
  // the first resolves as applied -> becomes a notice with its own expiry timer
  first.resolve({ outcome: 'applied' });
  await settle(); await settle();
  // the second resolves as unconfirmed
  second.resolve({ outcome: 'unknown', reason: 'server-restarted' });
  await settle(); await settle();
  assert.equal(state.view.kind, 'error');
  assert.match(state.view.message, /Send to VIP: The booth server restarted/,
    'the older entry turning into a notice did not steal the newer banner');
  // Every window now elapses. The banner goes, but the VIP uncertainty is RETAINED -
  // an older entry's expiry can neither claim nor destroy a newer unresolved record.
  state.advance(6000);
  assert.equal(state.view.kind, null, 'banners expired');
  assert.equal(snapshot().unresolvedCount, 1);
  const kept = snapshot().entries.filter(e => e.unresolved);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].label, 'Send to VIP');
});

test('a dismissed entry is never resurrected by a late reconciliation', async () => {
  const held = deferred();
  const { state, surface, dismiss, snapshot } = harness({ reconcile: () => held.promise });
  await assert.rejects(() => surface('sendToVip', Promise.reject(unknownError('rid-vip'))));
  const id = state.view.id;
  dismiss(id);
  assert.equal(state.view.kind, null);
  held.resolve({ outcome: 'unknown', reason: 'no-record' });
  await settle(); await settle();
  assert.equal(snapshot().kind, null, 'a dismissed entry stays dismissed');
  assert.equal(snapshot().unresolvedCount, 0);
});

test('a terminal error outranks an in-flight check, and the count reports the rest', async () => {
  const held = deferred();
  const { state, surface, snapshot } = harness({ reconcile: () => held.promise });
  await assert.rejects(() => surface('sendToVip', Promise.reject(unknownError('rid-vip'))));
  await assert.rejects(() => surface('skip', Promise.reject(new Error('kiosk refused'))));
  assert.equal(state.view.kind, 'error');
  assert.match(state.view.message, /Skip: kiosk refused/);
  assert.equal(state.view.extra, '+1 more unconfirmed: Send to VIP',
    'the hidden uncertain action is named, so it stays answerable from the banner');
  assert.equal(state.view.certainty, 'confirmed', 'a kiosk refusal is a known outcome');
  assert.equal(snapshot().pendingCount, 1);
  assert.equal(snapshot().errorCount, 1);
  // Only the VIP check is unresolved; the refusal is an answer, even though both are red.
  assert.equal(snapshot().unresolvedCount, 1);
});

test('every unresolved message names its action so the operator knows which one is uncertain', async () => {
  // Hold each lookup open so the "checking" state is observable rather than collapsing
  // into the settled one within the same microtask turn.
  let held = null;
  const { state, surface, dismissAll } = harness({ reconcile: () => { held = deferred(); return held.promise; } });
  for (const [action, label] of [['sendToVip', 'Send to VIP'], ['saveRotationWorkspace', 'Save All'],
                                 ['swapPromo', 'Swap commercial'], ['setVoiceGain', 'Voice level']]) {
    dismissAll();   // judge each action on its own, not behind a previous one's error
    await assert.rejects(() => surface(action, Promise.reject(unknownError('r-' + action))));
    assert.equal(state.view.kind, 'unknown', `${action} while checking`);
    assert.ok(state.view.message.startsWith(`${label}: `), `${action} -> ${state.view.message}`);
    held.resolve({ outcome: 'unknown', reason: 'no-record' });
    await settle(); await settle();
    // and the settled uncertainty still names it
    assert.equal(state.view.kind, 'error', `${action} after reconciliation`);
    assert.ok(state.view.message.startsWith(`${label}: `), `${action} settled -> ${state.view.message}`);
  }
});

// ------------------------------------------------------------- utilities ----

test('every desktop-remote action has wording and a label, and unknown actions fall back', () => {
  for (const action of [
    'addDancerToRotation', 'removeDancerFromRotation', 'moveInRotation', 'saveRotation',
    'updateSongAssignments', 'saveRotationWorkspace', 'updateInterstitialSongs',
    'startRotation', 'skip', 'sendToVip', 'releaseFromVip', 'swapPromo', 'skipCommercial',
    'setCommercialFreq', 'toggleAnnouncements', 'playHouseAnnouncement', 'playSound',
    'setSongsPerSet', 'setBreakSongsPerSet', 'setAutoplayQueue', 'setAutoplayAutoFill',
    'playFeatureAudio', 'playLibraryTrack', 'deactivateTrack', 'resetDancerVoiceovers',
    'placeFeature', 'cancelFeaturePlacement',
  ]) {
    assert.ok(COMMAND_NOTICES[action], `no notice wording for ${action}`);
    assert.ok(labelForAction(action), `no label for ${action}`);
  }
  assert.equal(noticeForAction('somethingNew'), 'Applied by the kiosk.');
  assert.equal(labelForAction('somethingNew'), 'Something New');
  assert.ok(SILENT_SUCCESS_ACTIONS.has('setVoiceGain'));
});

test('a queued start is not reported as "started"', () => {
  // The kiosk returns ok:true for startRotation even when it defers the start until the
  // current song ends, so this wording must not claim the rotation is running.
  assert.equal(noticeForAction('startRotation'), 'Start sent to the kiosk.');
  assert.doesNotMatch(noticeForAction('startRotation'), /started|running|active/i);
});

test('isConfirmedApplication is strict', () => {
  assert.equal(isConfirmedApplication(undefined), false);
  assert.equal(isConfirmedApplication(null), false);
  assert.equal(isConfirmedApplication({}), false);
  assert.equal(isConfirmedApplication({ ok: 'true' }), false);
  assert.equal(isConfirmedApplication({ ok: true }), true);
});


// =================================================================
// CERTAINTY vs COLOUR. `no-record`, `pending` and `unreachable` are red, but none of
// them is a settled answer. The entry cap may only ever evict outcomes that ARE known.
// =================================================================

test('describeReconciledOutcome separates certainty from banner colour', () => {
  assert.deepEqual(
    ['applied', 'failed', 'pending'].map(o => describeReconciledOutcome({ outcome: o, error: 'x' }, 'skip').certainty),
    ['confirmed', 'confirmed', 'unresolved'],
  );
  for (const reason of [undefined, 'no-record', 'unreachable', 'server-restarted', 'identity-mismatch', 'dedupe-expired']) {
    const d = describeReconciledOutcome({ outcome: 'unknown', reason }, 'skip');
    assert.equal(d.kind, 'error', `reason ${reason} is red`);
    assert.equal(d.certainty, 'unresolved', `reason ${reason} is NOT a settled answer`);
  }
});

test('isUnresolved covers in-flight checks and every red-but-unknown outcome', () => {
  assert.equal(isUnresolved({ kind: 'unknown' }), true);
  assert.equal(isUnresolved({ kind: 'error', certainty: 'unresolved' }), true);
  assert.equal(isUnresolved({ kind: 'error', certainty: 'confirmed' }), false);
  assert.equal(isUnresolved({ kind: 'notice', certainty: 'confirmed' }), false);
  assert.equal(isUnresolved(null), false);
});

test('REGRESSION: an unresolved VIP survives exceeding maxEntries with unrelated failures', async () => {
  // The reproduced gap: no-record is stored as kind:'error', so prune() treated it as a
  // confirmed failure and evicted it once the cap was reached.
  const { state, surface, dismiss, snapshot } = harness({
    maxEntries: 4,
    reconcile: () => Promise.resolve({ outcome: 'unknown', reason: 'no-record' }),
  });
  await assert.rejects(() => surface('sendToVip', Promise.reject(unknownError('rid-vip'))));
  await settle(); await settle();
  assert.equal(state.view.kind, 'error');
  assert.match(state.view.message, /Send to VIP/);
  const vipId = state.view.id;
  assert.equal(snapshot().unresolvedCount, 1);

  // flood well past the cap with CONFIRMED failures from other commands
  const floodIds = [];
  for (let i = 0; i < 12; i++) {
    await assert.rejects(() => surface('skip', Promise.reject(new Error(`refused ${i}`))));
    floodIds.push(state.view.id);
  }
  // the cap shed confirmed failures, never the uncertainty
  assert.equal(snapshot().unresolvedCount, 1, 'the VIP uncertainty was not evicted');
  assert.ok(snapshot().errorCount <= 4 + 1, 'confirmed failures were pruned to the cap');

  // dismiss every surviving confirmed failure
  for (let i = 0; i < 20 && state.view.id !== vipId && state.view.kind; i++) dismiss(state.view.id);

  assert.equal(state.view.id, vipId, 'the original VIP entry is what remains');
  assert.match(state.view.message, /Send to VIP: .*no record of that request/);
  assert.match(state.view.message, /Could not confirm whether this action was applied/);
  assert.equal(state.view.certainty, 'unresolved');
  assert.equal(snapshot().unresolvedCount, 1);
});

test('REGRESSION: pending and unreachable outcomes survive the same boundary', async () => {
  for (const [reason, pattern] of [[{ outcome: 'pending' }, /Still queued at the kiosk/],
                                   [{ outcome: 'unknown', reason: 'unreachable' }, /Could not reach the kiosk to check/],
                                   [{ outcome: 'unknown', reason: 'server-restarted' }, /booth server restarted/],
                                   [{ outcome: 'unknown', reason: 'dedupe-expired' }, /no longer holds a record/]]) {
    const { state, surface, dismiss, snapshot } = harness({ maxEntries: 3, reconcile: () => Promise.resolve(reason) });
    await assert.rejects(() => surface('saveRotationWorkspace', Promise.reject(unknownError('rid-save'))));
    await settle(); await settle();
    const keepId = state.view.id;
    for (let i = 0; i < 10; i++) {
      await assert.rejects(() => surface('skip', Promise.reject(new Error(`refused ${i}`))));
    }
    assert.equal(snapshot().unresolvedCount, 1, `${JSON.stringify(reason)} survived the cap`);
    for (let i = 0; i < 20 && state.view.id !== keepId && state.view.kind; i++) dismiss(state.view.id);
    assert.equal(state.view.id, keepId);
    assert.match(state.view.message, pattern);
    assert.equal(state.view.certainty, 'unresolved');
  }
});

test('an in-flight check is never evicted by the cap either', async () => {
  const held = deferred();
  const { state, surface, snapshot } = harness({ maxEntries: 2, reconcile: () => held.promise });
  await assert.rejects(() => surface('sendToVip', Promise.reject(unknownError('rid-vip'))));
  for (let i = 0; i < 8; i++) {
    await assert.rejects(() => surface('skip', Promise.reject(new Error(`refused ${i}`))));
  }
  assert.equal(snapshot().pendingCount, 1, 'the running lookup was not pruned away');
  held.resolve({ outcome: 'applied' });
  await settle(); await settle();
  assert.equal(snapshot().pendingCount, 0);
  assert.equal(snapshot().unresolvedCount, 0, 'a positively resolved outcome is no longer unresolved');
});

test('confirmed failures ARE prunable, so the cap still bounds ordinary churn', async () => {
  const { surface, snapshot } = harness({ maxEntries: 3 });
  for (let i = 0; i < 25; i++) {
    await assert.rejects(() => surface('skip', Promise.reject(new Error(`refused ${i}`))));
  }
  assert.ok(snapshot().errorCount <= 4, `expected the cap to hold, got ${snapshot().errorCount}`);
  assert.equal(snapshot().unresolvedCount, 0);
});

test('a positively resolved outcome stops being unresolved and becomes prunable', async () => {
  const held = deferred();
  const { state, surface, snapshot } = harness({ maxEntries: 3, reconcile: () => held.promise });
  await assert.rejects(() => surface('sendToVip', Promise.reject(unknownError('rid-vip'))));
  held.resolve({ outcome: 'failed', error: 'the kiosk refused it' });
  await settle(); await settle();
  assert.equal(state.view.certainty, 'confirmed', 'a settled receipt is a real answer');
  assert.equal(snapshot().unresolvedCount, 0);
  for (let i = 0; i < 12; i++) {
    await assert.rejects(() => surface('skip', Promise.reject(new Error(`refused ${i}`))));
  }
  assert.ok(snapshot().errorCount <= 4, 'it prunes like any other confirmed failure');
});


// =================================================================
// The banner is TEMPORARY. The record of an unconfirmed action is NOT.
// =================================================================

test('a routine success banner clears itself after noticeMs', async () => {
  const { state, surface } = harness();
  await surface('addDancerToRotation', Promise.resolve({ ok: true }));
  assert.equal(state.view.kind, 'notice');
  state.advance(2500);
  assert.equal(state.view.kind, null, 'banner gone');
  assert.equal(state.view.entries.length, 0, 'nothing to retain for a confirmed success');
});

test('a CONFIRMED failure banner clears itself without any Dismiss click', async () => {
  const { state, surface } = harness();
  await assert.rejects(() => surface('skip', Promise.reject(new Error('kiosk refused'))));
  assert.equal(state.view.kind, 'error');
  state.advance(2500);
  assert.equal(state.view.kind, 'error', 'errors get a longer read than successes');
  state.advance(3500);
  assert.equal(state.view.kind, null, 'error banner expired on its own - no permanent red bar');
  assert.equal(state.view.unresolvedCount, 0);
  assert.equal(state.view.entries.length, 0, 'a known failure needs no retained record');
});

test('REGRESSION: an UNRESOLVED outcome survives its banner expiring', async () => {
  // The banner must be allowed to auto-clear, but the record of an action whose
  // outcome was never established has to remain findable.
  const { state, surface, snapshot } = harness({
    reconcile: () => Promise.resolve({ outcome: 'unknown', reason: 'no-record' }),
  });
  await assert.rejects(() => surface('sendToVip', Promise.reject(unknownError('rid-vip'))));
  await settle(); await settle();
  assert.equal(state.view.kind, 'error');
  const vipId = state.view.id;

  state.advance(6000);
  assert.equal(state.view.kind, null, 'the banner cleared itself');
  assert.equal(state.view.unresolvedCount, 1, 'but the uncertainty is still counted');
  const retained = state.view.entries.find(e => e.id === vipId);
  assert.ok(retained, 'and still listed in the details');
  assert.equal(retained.unresolved, true);
  assert.equal(retained.label, 'Send to VIP', 'the operator can see WHICH action is uncertain');
  assert.match(retained.message, /Could not confirm whether this action was applied/);

  // and it is still there after unrelated traffic
  await surface('setVolume', Promise.resolve({ ok: true }));
  await surface('skip', Promise.resolve({ ok: true }));
  state.advance(6000);
  assert.equal(snapshot().unresolvedCount, 1);
  assert.ok(snapshot().entries.some(e => e.id === vipId));
});

test('the details list distinguishes confirmed failure from could-not-confirm', async () => {
  const { state, surface, snapshot } = harness({
    reconcile: () => Promise.resolve({ outcome: 'unknown', reason: 'unreachable' }),
  });
  await assert.rejects(() => surface('sendToVip', Promise.reject(unknownError('r1'))));
  await settle(); await settle();
  await assert.rejects(() => surface('skip', Promise.reject(new Error('kiosk refused'))));
  const byLabel = Object.fromEntries(snapshot().entries.map(e => [e.label, e]));
  assert.equal(byLabel['Send to VIP'].certainty, 'unresolved');
  assert.equal(byLabel['Send to VIP'].unresolved, true);
  assert.equal(byLabel['Skip'].certainty, 'confirmed');
  assert.equal(byLabel['Skip'].unresolved, false);
});

test('an in-flight check is not hidden by a banner timer while it is still checking', async () => {
  const held = deferred();
  const { state, surface } = harness({ reconcile: () => held.promise });
  await assert.rejects(() => surface('saveRotationWorkspace', Promise.reject(unknownError('r'))));
  assert.equal(state.view.kind, 'unknown');
  state.advance(20000);
  assert.equal(state.view.kind, 'unknown', 'still checking, still shown');
  held.resolve({ outcome: 'applied' });
  await settle(); await settle();
  assert.equal(state.view.kind, 'notice');
});

test('repeated volume nudges produce no banner noise at all', async () => {
  const { state, surface } = harness();
  for (let i = 0; i < 6; i++) await surface('setVolume', Promise.resolve({ ok: true }));
  assert.equal(state.view.kind, null);
  assert.equal(state.view.entries.length, 0);
  assert.equal(state.timers.length, 0, 'not even a timer was scheduled');
});

test('a transport failure surfaces as UNRESOLVED on the remote and survives banner expiry', async () => {
  // Exactly what the connection layer produces: the browser's own "Failed to fetch" run
  // through the real classifier. It carries no HTTP status, so nothing about it says the
  // command was rejected.
  const { classifyCommandError } = await import('./commandOutcome.js');
  const dropped = new TypeError('Failed to fetch');
  const outcome = classifyCommandError(dropped, {
    requestId: 'req-drop', action: 'sendToVip', submittedAt: 1, serverEpochAtSend: 'epoch-a',
  });
  assert.equal(outcome, 'unknown');

  const { state, surface } = harness({
    reconcile: async () => ({ outcome: 'unknown', reason: 'no-record', resolved: false }),
  });
  await assert.rejects(() => surface('sendToVip', Promise.reject(dropped)));
  await settle(); await settle();

  const entry = state.view.entries.find(e => e.action === 'sendToVip');
  assert.ok(entry, 'the dropped command has its own entry');
  assert.equal(entry.unresolved, true, 'a dropped connection is never a confirmed failure');
  assert.match(entry.message, /could not confirm whether this action was applied/i);
  assert.doesNotMatch(entry.message, /nothing was applied|safe to (try|retry)|was not applied/i);

  // Banners clear themselves; the uncertainty must not clear with them.
  state.advance(60_000);
  const after = state.view.entries.find(e => e.action === 'sendToVip');
  assert.ok(after && after.unresolved, 'still unresolved long after the banner went');
  assert.equal(state.view.unresolvedCount, 1);

  // And an unrelated success cannot bury it.
  await surface('setVolume', Promise.resolve({ ok: true }));
  assert.equal(state.view.unresolvedCount, 1, 'still counted');
});