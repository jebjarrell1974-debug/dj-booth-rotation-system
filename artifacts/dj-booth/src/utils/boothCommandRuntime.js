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