import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeManualSongList } from './rotationAssignments.js';
import { reconcileManualEditorAssignments, restoreManualEditorEdits, editorCommandContext,
  manualEditorStatus, recoverManualEditorEdit } from './rotationEditorSync.js';

test('a remount restores the failed/pending edit without accepting an older saved list', () => {
  const restored = restoreManualEditorEdits({
    dirtyOverrides: ['upcoming'],
    pendingEdits: { upcoming: { revision: 3, songs: ['edited'], acknowledged: false } },
  });
  const previous = { upcoming: ['edited'] };
  const result = reconcileManualEditorAssignments(previous, {
    assignments: { upcoming: ['old'] },
    dirtyIds: restored.dirtyIds, pendingEdits: restored.pendingEdits,
  });
  assert.equal(result.assignments, previous);
  assert.ok(result.dirtyIds.has('upcoming'));
  assert.equal(restored.revisions.upcoming, 3);
});

test('a receipt confirmed before remount still awaits its matching ordered snapshot', () => {
  const restored = restoreManualEditorEdits({
    dirtyOverrides: ['upcoming'],
    pendingEdits: { upcoming: { revision: 4, songs: ['saved'], acknowledged: true } },
  });
  const previous = { upcoming: ['saved'] };
  const result = reconcileManualEditorAssignments(previous, {
    assignments: { upcoming: ['saved'] },
    dirtyIds: restored.dirtyIds, pendingEdits: restored.pendingEdits,
  });
  assert.equal(result.assignments, previous);
  assert.equal(result.dirtyIds.size, 0);
});

test('legacy or malformed snapshots cannot create acknowledged dirty edits', () => {
  const legacy = restoreManualEditorEdits({ overrides: ['upcoming'] });
  assert.equal(legacy.dirtyIds.size, 0);
  for (const edit of [null, { songs: [], revision: -1 }, { songs: [], revision: '2' }]) {
    assert.equal(restoreManualEditorEdits({
      dirtyOverrides: ['upcoming'], pendingEdits: { upcoming: edit },
    }).dirtyIds.size, 0);
  }
});

test('an acknowledged kiosk editor follows another control replacing its saved set', () => {
  const result = reconcileManualEditorAssignments({ upcoming: ['old-a', 'old-b'] }, {
    assignments: { upcoming: [{ name: 'new-a' }, { name: 'new-b' }, { name: 'new-c' }] },
    manualLengths: { upcoming: 3 },
  });
  assert.deepEqual(result.assignments.upcoming, ['new-a', 'new-b', 'new-c']);
});

test('manual shortening and removing the last song are authoritative, not auto-refill requests', () => {
  const previous = { upcoming: ['a', 'b', 'c'] };
  for (const songs of [['c'], []]) {
    const result = reconcileManualEditorAssignments(previous, {
      assignments: { upcoming: songs }, manualLengths: { upcoming: songs.length },
    });
    assert.deepEqual(result.assignments.upcoming, songs);
  }
  assert.deepEqual(previous.upcoming, ['a', 'b', 'c']);
});

test('a consumed saved ledger still follows the active manual list', () => {
  const result = reconcileManualEditorAssignments({ playing: ['old'] }, {
    activeAssignments: { playing: [{ name: 'one' }, { name: 'two' }, { name: 'three' }] },
    manualLengths: { playing: 3 },
  });
  assert.deepEqual(result.assignments.playing, ['one', 'two', 'three']);
});

test('absent active/published data is not treated as an empty manual set', () => {
  const previous = { playing: ['one', 'two'] };
  assert.equal(reconcileManualEditorAssignments(previous, {
    manualLengths: { playing: 2 },
  }).assignments, previous);
});

test('a declared zero-length set clears the display even with no pending saved ledger', () => {
  const result = reconcileManualEditorAssignments({ playing: ['old'] }, {
    manualLengths: { playing: 0 },
  });
  assert.deepEqual(result.assignments.playing, []);
});

test('an unacknowledged edit survives even a matching snapshot', () => {
  const previous = { upcoming: ['edit'] };
  const result = reconcileManualEditorAssignments(previous, {
    assignments: { upcoming: ['edit'] }, dirtyIds: new Set(['upcoming']),
    pendingEdits: { upcoming: { revision: 1, songs: ['edit'], acknowledged: false } },
  });
  assert.equal(result.assignments, previous);
  assert.ok(result.dirtyIds.has('upcoming'));
  assert.ok(result.pendingEdits.upcoming);
});

test('an acknowledged edit survives old polls until its own ordered list is published', () => {
  const previous = { upcoming: ['new-b', 'new-a'] };
  const options = {
    assignments: { upcoming: ['new-a', 'new-b'] }, dirtyIds: new Set(['upcoming']),
    pendingEdits: { upcoming: {
      revision: 2, songs: ['new-b', 'new-a'], acknowledged: true,
    } },
  };
  const stale = reconcileManualEditorAssignments(previous, options);
  assert.equal(stale.assignments, previous);
  assert.ok(stale.dirtyIds.has('upcoming'));
  const confirmed = reconcileManualEditorAssignments(previous, {
    ...options, assignments: { upcoming: ['new-b', 'new-a'] },
  });
  assert.equal(confirmed.assignments, previous);
  assert.equal(confirmed.dirtyIds.size, 0);
  assert.deepEqual(confirmed.pendingEdits, {});
  const externallyEdited = reconcileManualEditorAssignments(previous, {
    assignments: { upcoming: ['external'] }, ...{
      dirtyIds: confirmed.dirtyIds, pendingEdits: confirmed.pendingEdits,
    },
  });
  assert.deepEqual(externallyEdited.assignments.upcoming, ['external']);
});

test('unchanged manual snapshots converge and automatic assignments remain untouched', () => {
  const previous = { upcoming: ['one'], automatic: ['automatic-pick'] };
  const result = reconcileManualEditorAssignments(previous, {
    assignments: { upcoming: [{ name: 'one' }] },
    activeAssignments: { automatic: ['different-automatic-pick'] },
  });
  assert.equal(result.assignments, previous);
});

// Execute the actual publisher and Save All bodies, rather than reproducing
// their completion ordering in a standalone model.
const source = readFileSync(new URL('../components/dj/RotationPlaylistManager.jsx', import.meta.url), 'utf8');
const syncBody = source.split('  useEffect(() => {\n    const previous = songAssignmentsRef.current;')[1]
  .split('\n  }, [authoritativeManualAssignmentsKey')[0];
const sync = new Function('env', `
  const { songAssignmentsRef, dirtyOverridesRef, pendingManualEditsRef,
    authoritativeManualAssignments, activeRotationSongs, authoritativeManualSetLengths,
    reconcileManualEditorAssignments, setSongAssignments, remoteMode, localStorage,
    djOverridesRef, persistEditorLedger, setManualEditRevision } = env;
  const previous = songAssignmentsRef.current;
  ${syncBody}
`);

test('actual sync effect persists clean metadata without needing a changed song list', () => {
  const assignments = { performer: ['confirmed'] };
  const writes = [];
  let stateWrites = 0;
  const env = {
    songAssignmentsRef: { current: assignments },
    dirtyOverridesRef: { current: new Set(['performer']) },
    pendingManualEditsRef: { current: {
      performer: { revision: 5, songs: ['confirmed'], acknowledged: true },
    } },
    djOverridesRef: { current: new Set(['performer']) },
    authoritativeManualAssignments: assignments,
    activeRotationSongs: assignments, authoritativeManualSetLengths: { performer: 1 },
    reconcileManualEditorAssignments, remoteMode: false,
    setSongAssignments() { stateWrites += 1; },
    localStorage: { setItem(key, value) { writes.push(JSON.parse(value)); } },
    setManualEditRevision() {},
  };
  env.persistEditorLedger = () => env.localStorage.setItem('djbooth_planned_assignments', JSON.stringify({
    dirtyOverrides: [...env.dirtyOverridesRef.current], pendingEdits: env.pendingManualEditsRef.current,
  }));
  sync(env);
  assert.equal(stateWrites, 0);
  assert.equal(env.songAssignmentsRef.current, assignments);
  assert.deepEqual(writes[0].dirtyOverrides, []);
  assert.deepEqual(writes[0].pendingEdits, {});
  assert.equal(restoreManualEditorEdits(writes[0]).dirtyIds.size, 0);
  sync(env);
  assert.equal(writes.length, 1);
});

test('actual remote sync effect never persists kiosk planning state', () => {
  const env = {
    songAssignmentsRef: { current: { performer: ['old'] } },
    dirtyOverridesRef: { current: new Set() }, pendingManualEditsRef: { current: {} },
    djOverridesRef: { current: new Set() },
    authoritativeManualAssignments: { performer: ['remote'] },
    activeRotationSongs: {}, authoritativeManualSetLengths: { performer: 1 },
    reconcileManualEditorAssignments, remoteMode: true,
    setSongAssignments(value) { env.rendered = value; },
    localStorage: { setItem() { assert.fail('A remote must not write kiosk planning state'); } },
    persistEditorLedger() {}, setManualEditRevision() {},
  };
  sync(env);
  assert.deepEqual(env.rendered.performer, ['remote']);
});

const publishBody = source.split('const publishManualAssignment = useCallback((dancerId, songs) => {')[1]
  .split('\n  }, [onAutoSavePlaylist,')[0];
const publish = new Function('dancerId', 'songs', 'env', `
  const { normalizeManualSongList, markDjOverride, manualEditRevisionsRef,
    pendingManualEditsRef, songAssignmentsRef, setSongAssignments,
    onAutoSavePlaylist, setManualEditRevision, toast, remoteMode,
    persistEditorLedger, editorCommandContext } = env;
  ${publishBody}
`);
const saveBody = source.split('const handleSave = async () => {')[1]
  .split('\n  };')[0];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const save = new AsyncFunction('env', `
  const { lastSaveTimeRef, songAssignments, djOverridesRef,
    normalizeManualSongList, normalizeSongList, songsPerSet, appliedPlaylistsRef,
    interstitialSongs, manualEditRevisionsRef, saveGuardRef, onSaveAll,
    localRotation, manualInterstitialBreaksRef, pendingManualEditsRef,
    setManualEditRevision, dirtyOverridesRef, toast, remoteMode, persistEditorLedger, songAssignmentsRef } = env;
  ${saveBody}
`);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function fixture() {
  const env = {
    normalizeManualSongList,
    normalizeSongList: songs => songs,
    manualEditRevisionsRef: { current: {} },
    pendingManualEditsRef: { current: {} },
    songAssignmentsRef: { current: {} },
    dirtyOverridesRef: { current: new Set() },
    djOverridesRef: { current: new Set() },
    appliedPlaylistsRef: { current: {} },
    lastSaveTimeRef: { current: 0 },
    saveGuardRef: { current: 0 },
    manualInterstitialBreaksRef: { current: {} },
    songsPerSet: 2, localRotation: ['performer'], interstitialSongs: {},
    errors: [], successes: [], receipts: [],
    remoteMode: false, persistEditorLedger() {}, editorCommandContext,
    setManualEditRevision() {},
  };
  env.markDjOverride = id => {
    env.dirtyOverridesRef.current.add(id);
    env.djOverridesRef.current.add(id);
  };
  env.setSongAssignments = update => {
    env.songAssignments = update(env.songAssignments || {});
  };
  env.onAutoSavePlaylist = () => {
    const receipt = deferred();
    env.receipts.push(receipt);
    return receipt.promise;
  };
  env.toast = { error: message => env.errors.push(message), success: message => env.successes.push(message) };
  return env;
}

test('actual publisher cannot let an older receipt acknowledge a newer same-performer edit', async () => {
  const env = fixture();
  const old = publish('performer', ['old'], env);
  await Promise.resolve();
  const latest = publish('performer', ['latest'], env);
  await Promise.resolve();
  env.receipts[0].resolve();
  await old;
  assert.equal(env.pendingManualEditsRef.current.performer.acknowledged, false);
  env.receipts[1].resolve();
  await latest;
  assert.equal(env.pendingManualEditsRef.current.performer.acknowledged, true);
  assert.deepEqual(env.songAssignments.performer, ['latest']);
  assert.ok(env.dirtyOverridesRef.current.has('performer'));
});

test('actual publisher retains failed edits and ignores late errors from an older revision', async () => {
  const env = fixture();
  const old = publish('performer', ['old'], env);
  await Promise.resolve();
  const latest = publish('performer', ['latest'], env);
  await Promise.resolve();
  env.receipts[1].reject(new Error('Save failed'));
  await latest;
  env.receipts[0].reject(new Error('Older failure'));
  await old;
  assert.deepEqual(env.errors, ['Playlist outcome unknown. Your edit is kept; use Check save.']);
  assert.deepEqual(env.songAssignments.performer, ['latest']);
  assert.equal(env.pendingManualEditsRef.current.performer.acknowledged, false);
  assert.ok(env.dirtyOverridesRef.current.has('performer'));
});

test('actual Save All completion cannot clear protection for a newer edit', async () => {
  const env = fixture();
  const first = publish('performer', ['first'], env);
  await Promise.resolve();
  const saveReceipt = deferred();
  env.onSaveAll = () => saveReceipt.promise;
  const saving = save(env);
  const latest = publish('performer', ['latest'], env);
  await Promise.resolve();
  saveReceipt.resolve();
  await saving;
  assert.equal(env.pendingManualEditsRef.current.performer.acknowledged, false);
  assert.ok(env.dirtyOverridesRef.current.has('performer'));
  env.receipts[0].resolve();
  env.receipts[1].resolve();
  await Promise.all([first, latest]);
});

test('actual Save All marks only the saved revision acknowledged and awaits snapshot confirmation', async () => {
  const env = fixture();
  const editing = publish('performer', ['saved'], env);
  await Promise.resolve();
  env.onSaveAll = async () => {};
  await save(env);
  assert.equal(env.pendingManualEditsRef.current.performer.acknowledged, true);
  assert.ok(env.dirtyOverridesRef.current.has('performer'));
  env.receipts[0].resolve();
  await editing;
});

test('restored sending status is uncertain, identity is retained without credentials', () => {
  const restored = restoreManualEditorEdits({
    dirtyOverrides: ['p'], pendingEdits: { p: {
      revision: 9, songs: ['b', 'a'], phase: 'sending',
      context: { requestId: 'original', commandId: 5, submittedAt: 1, serverEpochAtSend: 'epoch', token: 'do-not-store' },
    } },
  });
  const edit = restored.pendingEdits.p;
  assert.equal(manualEditorStatus(edit), 'Outcome unknown — edit kept');
  assert.equal(edit.context.requestId, 'original');
  assert.equal(edit.context.token, undefined);
  assert.equal(manualEditorStatus({ ...edit, acknowledged: true }), 'Waiting for confirmation');
  assert.equal(manualEditorStatus(null, true), 'Saved');
});

test('recovery never retries ambiguous observations, including gateway and malformed receipt answers', async () => {
  for (const reconcile of [
    async () => ({ outcome: 'unknown', reason: 'no-record' }),
    async () => ({ outcome: 'unknown', reason: 'server-restarted' }),
    async () => ({ outcome: 'pending' }),
    async () => { throw Object.assign(new Error('gateway'), { status: 502 }); },
    async () => { throw new SyntaxError('malformed'); },
    async () => { throw Object.assign(new Error('receipt auth'), { status: 401 }); },
  ]) {
    const edit = { revision: 1, songs: ['a'], phase: 'unknown', context: { requestId: 'r' } };
    const result = await recoverManualEditorEdit(edit, {
      remoteMode: true, isCurrent: () => true, reconcile,
      retry: () => assert.fail('Unknown outcomes must not be resent'),
    });
    assert.equal(result.phase, 'unknown');
  }
});

test('applied recovery still needs ordered snapshot and cannot acknowledge a newer draft', async () => {
  const edit = { revision: 1, songs: ['b', 'a'], context: { requestId: 'r' } };
  const result = await recoverManualEditorEdit(edit, {
    remoteMode: true, isCurrent: () => true,
    reconcile: async () => ({ outcome: 'applied' }), retry: () => assert.fail('No replay'),
  });
  const pending = { ...edit, ...result };
  assert.ok(reconcileManualEditorAssignments({ p: edit.songs }, {
    assignments: { p: ['a', 'b'] }, dirtyIds: new Set(['p']), pendingEdits: { p: pending },
  }).dirtyIds.has('p'));
  const receipt = deferred();
  let current = true;
  const checking = recoverManualEditorEdit(edit, {
    remoteMode: true, isCurrent: () => current, reconcile: () => receipt.promise,
    retry: () => assert.fail('Older recovery cannot retry'),
  });
  current = false;
  receipt.resolve({ outcome: 'failed' });
  assert.equal(await checking, null);
});

test('retry follows reconciliation only after proven non-application', async () => {
  for (const phase of ['unknown', 'rejected']) {
    const events = [];
    await recoverManualEditorEdit({ phase, context: { requestId: 'r' } }, {
      remoteMode: true, isCurrent: () => true,
      reconcile: async () => { events.push('check'); return { outcome: 'failed' }; },
      refreshSnapshot: async () => events.push('snapshot'),
      retry: async () => events.push('serialized-write'),
    });
    assert.deepEqual(events, ['check', 'snapshot', 'serialized-write']);
  }
});

test('a failed snapshot refresh or a newer edit during refresh prevents retry', async () => {
  const edit = { phase: 'rejected', context: { requestId: 'r' } };
  await assert.rejects(recoverManualEditorEdit(edit, {
    remoteMode: true, isCurrent: () => true,
    reconcile: async () => ({ outcome: 'failed' }),
    refreshSnapshot: async () => { throw new TypeError('offline'); },
    retry: () => assert.fail('No retry without fresh authority'),
  }));
  let current = true;
  assert.equal(await recoverManualEditorEdit(edit, {
    remoteMode: true, isCurrent: () => current,
    reconcile: async () => ({ outcome: 'failed' }),
    refreshSnapshot: async () => { current = false; },
    retry: () => assert.fail('No retry for an older revision'),
  }), null);
});

test('actual remote Save All does not replay any unconfirmed set', async () => {
  const env = fixture();
  env.remoteMode = true;
  env.pendingManualEditsRef.current.p = { phase: 'unknown', revision: 1 };
  env.onSaveAll = () => assert.fail('Save All must not replay unknown effects');
  await save(env);
  assert.match(env.errors[0], /Check the unconfirmed sets/);
});

const persistBody = source.split('const persistEditorLedger = useCallback(() => {')[1]
  .split('\n  }, [editorStorage]);')[0];
const persist = new Function('env', `
  const { editorStorage, sessionStorage, localStorage, editorMountedRef,
    songAssignmentsRef, djOverridesRef, dirtyOverridesRef, pendingManualEditsRef,
    window, CustomEvent } = env;
  ${persistBody}
`);

test('actual ledger persists remount metadata in remote session storage, never kiosk storage', () => {
  const env = fixture();
  const records = new Map();
  Object.assign(env, {
    editorStorage: { remote: true, key: 'remote:target' },
    sessionStorage: {
      getItem: key => records.get(key),
      setItem: (key, value) => records.set(key, value),
    },
    localStorage: {
      getItem() { assert.fail('No kiosk reads'); },
      setItem() { assert.fail('No kiosk writes'); },
    },
    editorMountedRef: { current: true },
    window: { dispatchEvent() {} }, CustomEvent: class {},
  });
  env.songAssignmentsRef.current = { p: ['b', 'a'] };
  env.dirtyOverridesRef.current.add('p');
  env.pendingManualEditsRef.current.p = {
    revision: 2, songs: ['b', 'a'], acknowledged: false, phase: 'sending',
    context: { requestId: 'original', submittedAt: 100 },
  };
  persist(env);
  const restored = restoreManualEditorEdits(JSON.parse(records.get('remote:target')));
  assert.equal(restored.pendingEdits.p.phase, 'unknown');
  assert.deepEqual(restored.pendingEdits.p.songs, ['b', 'a']);
  assert.equal(restored.pendingEdits.p.context.requestId, 'original');

  env.editorMountedRef.current = false;
  env.pendingManualEditsRef.current.p.acknowledged = true;
  persist(env);
  assert.equal(JSON.parse(records.get('remote:target')).pendingEdits.p.acknowledged, true);

  const newer = JSON.parse(records.get('remote:target'));
  newer.pendingEdits.p = { revision: 3, songs: ['latest'], acknowledged: false, context: { requestId: 'newer' } };
  newer.assignments.p = ['latest'];
  records.set('remote:target', JSON.stringify(newer));
  persist(env);
  assert.deepEqual(JSON.parse(records.get('remote:target')), newer,
    'A detached completion cannot overwrite the remounted newer revision');

  const clean = { assignments: { p: ['latest'] }, dirtyOverrides: [], pendingEdits: {} };
  records.set('remote:target', JSON.stringify(clean));
  persist(env);
  assert.deepEqual(JSON.parse(records.get('remote:target')), clean,
    'A detached completion cannot resurrect a confirmed dirty marker');
});
