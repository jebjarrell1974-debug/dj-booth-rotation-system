import { normalizeManualSongList } from './rotationAssignments.js';

const has = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const same = (left, right) => Array.isArray(left) && Array.isArray(right)
  && left.length === right.length && left.every((name, index) => name === right[index]);

export function restoreManualEditorEdits(saved) {
  const dirtyIds = new Set();
  const pendingEdits = {};
  const revisions = {};
  for (const rawId of Array.isArray(saved?.dirtyOverrides) ? saved.dirtyOverrides : []) {
    const dancerId = String(rawId);
    const edit = saved?.pendingEdits?.[dancerId];
    if (!edit || !Array.isArray(edit.songs) || !Number.isSafeInteger(edit.revision)
        || edit.revision < 1) continue;
    dirtyIds.add(dancerId);
    pendingEdits[dancerId] = {
      revision: edit.revision,
      songs: normalizeManualSongList(edit.songs),
      acknowledged: edit.acknowledged === true,
      phase: edit.acknowledged === true ? 'awaiting' : edit.phase === 'rejected' ? 'rejected' : 'unknown',
      context: editorCommandContext(edit.context),
    };
    revisions[dancerId] = edit.revision;
  }
  return { dirtyIds, pendingEdits, revisions };
}

// Store only reconciliation identity, never auth headers, tokens or payloads.
export function editorCommandContext(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(['requestId', 'commandId', 'submittedAt', 'serverEpochAtSend']
    .filter(key => typeof value[key] === 'string' || typeof value[key] === 'number')
    .map(key => [key, value[key]]));
}

export function manualEditorStatus(edit, saved = false) {
  if (!edit) return saved ? 'Saved' : 'Automatic picks';
  if (edit.acknowledged) return 'Waiting for confirmation';
  if (edit.phase === 'sending') return 'Saving…';
  if (edit.phase === 'rejected') return 'Not applied — edit kept';
  return 'Outcome unknown — edit kept';
}

// Recovery may only replay a proven refusal (or a local idempotent assignment).
// A matching list without acknowledgement cannot release edit protection.
export async function recoverManualEditorEdit(edit, {
  remoteMode, reconcile, refreshSnapshot, retry, isCurrent,
}) {
  if (!isCurrent()) return null;
  if (edit.acknowledged) return { acknowledged: true, phase: 'awaiting' };
  let result = { outcome: 'unknown' };
  if (remoteMode && edit.context?.requestId) {
    try { result = await reconcile(edit.context); } catch { /* observation is not refusal */ }
  }
  if (!isCurrent()) return null;
  if (result?.outcome === 'applied') return { acknowledged: true, phase: 'awaiting' };
  if (result?.outcome === 'pending') return { phase: 'unknown' };
  if (!remoteMode || result?.outcome === 'failed' || edit.phase === 'rejected') {
    await refreshSnapshot?.();
    if (!isCurrent()) return null;
    await retry();
    return null; // retry owns a new revision and its own receipt
  }
  return { phase: 'unknown' };
}

// A command receipt and a snapshot are separate events. Keep an optimistic edit
// protected until BOTH its own receipt succeeds and the published list confirms
// it. Thereafter the editor follows changes made from another control.
export function reconcileManualEditorAssignments(current, {
  assignments = {},
  activeAssignments = {},
  manualLengths = {},
  dirtyIds = new Set(),
  pendingEdits = {},
} = {}) {
  let next = current;
  const dirty = new Set(Array.from(dirtyIds, String));
  const pending = { ...pendingEdits };
  const manualIds = new Set([...Object.keys(assignments), ...Object.keys(manualLengths)]);

  for (const dancerId of manualIds) {
    let published;
    if (has(assignments, dancerId)) published = assignments[dancerId];
    else if (has(activeAssignments, dancerId)) published = activeAssignments[dancerId];
    else if (Number(manualLengths[dancerId]) === 0) published = [];
    else continue; // Missing data is not an instruction to clear a saved set.

    const names = normalizeManualSongList(published);
    const edit = pending[dancerId];
    if (edit?.acknowledged && same(edit.songs, names)) {
      dirty.delete(dancerId);
      delete pending[dancerId];
    }
    if (dirty.has(dancerId) || same(current?.[dancerId], names)) continue;
    if (next === current) next = { ...(current || {}) };
    next[dancerId] = names;
  }

  return { assignments: next, dirtyIds: dirty, pendingEdits: pending };
}
