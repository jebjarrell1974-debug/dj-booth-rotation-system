export function mergeWorkspaceAssignments(
  plannedAssignments = {},
  rotationAssignments = {},
  { active = false } = {},
) {
  // Once a rotation is running, the kiosk queue is authoritative. Planned
  // assignments are a display/editor cache and may still contain the dancer
  // that was just consumed. Re-merging that cache into a live broadcast can
  // turn an automatic pick back into a DJ override on the next remote save.
  if (active) return { ...(rotationAssignments || {}) };

  const merged = { ...plannedAssignments };
  for (const [id, tracks] of Object.entries(rotationAssignments || {})) {
    merged[id] = tracks || [];
  }
  return merged;
}

export function commandIsExpired(command, now = Date.now()) {
  return Number.isFinite(command?.expiresAt) && command.expiresAt <= now;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function acquireStructuralCommitLock({
  command,
  isLocked,
  lock,
  sleep = wait,
  now = Date.now,
}) {
  while (isLocked()) {
    if (commandIsExpired(command, now())) {
      throw new Error('The command expired before the kiosk could commit it');
    }
    await sleep(25);
  }
  // Callers provide synchronous isLocked/lock operations. JavaScript
  // run-to-completion makes the final observation and acquisition atomic.
  lock();
}

// Once execute succeeds, failure to publish is not command failure. Keep the
// command in its claimed/processing state and retry publication before creating
// any terminal receipt. ACK is likewise retried without replaying execution.
export async function runClaimedCommand({
  command,
  execute,
  publish,
  acknowledge,
  sleep = wait,
  retryMs = 500,
}) {
  let result;
  try {
    await execute(command);
  } catch (error) {
    result = { ok: false, error: error?.message || 'Command execution failed' };
  }

  if (!result) {
    let revision;
    for (;;) {
      try {
        revision = await publish();
        break;
      } catch {
        await sleep(retryMs);
      }
    }
    result = {
      ok: true,
      stateVersion: revision.stateVersion,
      rotationVersion: revision.rotationVersion,
    };
  }

  for (;;) {
    try {
      await acknowledge(command.id, result);
      return result;
    } catch {
      await sleep(retryMs);
    }
  }
}

// ---------------------------------------------------------------------------
// Save All ("saveRotationWorkspace") workspace guard.
//
// Save All publishes the operator's whole arrangement, so it must not overwrite a
// NEWER operator edit made between enqueue and execution - while still ignoring the
// automatic picks the kiosk rewrites on its own.
//
// The snapshot it is checked against is stamped by the SERVER at enqueue time. If
// that snapshot is missing a safeguard field, the comparison MUST NOT quietly shrink
// to whatever the snapshot happens to contain: dropping `manualRotationSongs` would
// let a stale save overwrite a newer manual song edit, which is precisely what this
// guard exists to prevent. An incomplete snapshot is therefore REFUSED, and the
// operator is told to refresh and save again.
export const REQUIRED_SAVE_ALL_SNAPSHOT_FIELDS = [
  'rotation',
  'manualRotationSongs',
  'manualRotationSetLengths',
  'manualInterstitialBreaks',
];

const MANUAL_SAVE_GUARD_FIELDS = [
  'rotation', 'dancerVipMap', 'placedFeatures',
  'manualInterstitialBreaks', 'manualRotationSetLengths', 'manualRotationSongs',
];

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// Everything the OPERATOR owns. `manualInterstitialBreaks` is only a map of boolean
// ownership markers, so editing a break that was ALREADY manual changes no marker at
// all - the contents have to be compared separately.
export function manualWorkspaceProjection(workspace) {
  const source = workspace && typeof workspace === 'object' ? workspace : {};
  const out = {};
  for (const field of MANUAL_SAVE_GUARD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) out[field] = source[field];
  }
  const owned = source.manualInterstitialBreaks || {};
  const contents = {};
  for (const [breakKey, isManual] of Object.entries(owned)) {
    // `|| []` keeps an emptied manual break distinct from an absent one.
    if (isManual === true) contents[breakKey] = (source.interstitialSongs || {})[breakKey] || [];
  }
  out.manualBreakContents = contents;
  return out;
}

export function missingSaveAllSnapshotFields(workspace) {
  if (!workspace || typeof workspace !== 'object') return [...REQUIRED_SAVE_ALL_SNAPSHOT_FIELDS];
  return REQUIRED_SAVE_ALL_SNAPSHOT_FIELDS.filter(
    field => !Object.prototype.hasOwnProperty.call(workspace, field),
  );
}

export class IncompleteWorkspaceSnapshotError extends Error {
  constructor(missing) {
    super(`This save was prepared against an incomplete kiosk snapshot (missing: ${missing.join(', ')}). Refresh the remote and save again.`);
    this.name = 'IncompleteWorkspaceSnapshotError';
    this.missingFields = missing;
  }
}

export function assertSaveAllWorkspaceUnchanged(expectedWorkspace, liveWorkspace) {
  const missing = missingSaveAllSnapshotFields(expectedWorkspace);
  if (missing.length > 0) throw new IncompleteWorkspaceSnapshotError(missing);
  if (stableStringify(manualWorkspaceProjection(expectedWorkspace))
      !== stableStringify(manualWorkspaceProjection(liveWorkspace))) {
    throw new Error('The kiosk workspace changed before this command could be applied');
  }
}