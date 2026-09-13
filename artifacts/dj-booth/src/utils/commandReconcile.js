// Policy for establishing what happened to a command whose outcome is unknown.
//
// A timeout means the outcome is UNKNOWN - the command may be queued, claimed, applied,
// or may never have reached the server. It must never be reported as "not applied", and
// it must never be re-sent under a new requestId: that would defeat the server's
// de-duplication and could apply an operator action twice.

export const DEDUPE_WINDOW_MS = 5 * 60 * 1000;   // server: dedupeTtlMs

// What a receipt tells us. `queued` covers both 'pending' and 'processing'.
export function interpretReceipt(receipt) {
  if (!receipt) return { outcome: 'unknown', reason: 'no-receipt' };
  if (receipt.queued) return { outcome: 'pending', commandId: receipt.commandId ?? receipt.command?.id };
  return {
    outcome: receipt.ok ? 'applied' : 'failed',
    commandId: receipt.commandId ?? receipt.command?.id,
    status: receipt.command?.status,
    error: receipt.command?.error,
  };
}



// ---------------------------------------------------------------------------
// The actual reconciliation path used by the app. `deps` supplies only READ
// operations - there is deliberately no way for this function to submit anything,
// so discovering an outcome can never create a second command.
//
//   deps.lookupByRequestId(requestId) -> { ok, queued, command, serverEpoch } | null (404)
//   deps.getReceiptById(commandId)    -> same shape | null (404)
//   deps.getServerEpoch()             -> string | null
//   deps.now() / deps.sleep(ms)
//
// `context` is captured when the command is SENT, never when recovery starts.
export async function reconcileCommandOutcome(deps, context) {
  const {
    requestId, commandId, serverEpochAtSend, submittedAt,
    settleMs = 20000, dedupeWindowMs = DEDUPE_WINDOW_MS, pollMs = 1000,
  } = context || {};
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)));

  // A restarted server has lost the de-duplication map AND restarted its numeric ids,
  // so nothing it reports can be tied back to the original submission.
  if (serverEpochAtSend && deps.getServerEpoch) {
    let epochNow = null;
    try { epochNow = await deps.getServerEpoch(); } catch { epochNow = null; }
    if (epochNow && epochNow !== serverEpochAtSend) {
      return { outcome: 'unknown', reason: 'server-restarted', resolved: false };
    }
  }

  // Only believe a receipt that is demonstrably OURS.
  const believable = (receipt) => {
    if (!receipt || !receipt.command) return false;
    if (requestId && receipt.command.requestId && receipt.command.requestId !== requestId) return false;
    if (serverEpochAtSend && receipt.serverEpoch && receipt.serverEpoch !== serverEpochAtSend) return false;
    return true;
  };

  const deadline = now() + settleMs;
  let sawRecord = false;
  for (;;) {
    let receipt = null;
    let missing = false;
    try {
      if (requestId && deps.lookupByRequestId) {
        receipt = await deps.lookupByRequestId(requestId);
      } else if (commandId != null && deps.getReceiptById) {
        receipt = await deps.getReceiptById(commandId);
      }
      if (receipt === null) missing = true;
    } catch {
      receipt = null;                  // transport problem: retry while time allows
    }

    if (receipt && believable(receipt)) {
      sawRecord = true;
      const seen = interpretReceipt(receipt);
      if (seen.outcome !== 'pending') return { ...seen, resolved: true };
    } else if (receipt && !believable(receipt)) {
      // A record exists but it is not ours - numeric ids were reused after a restart.
      return { outcome: 'unknown', reason: 'identity-mismatch', resolved: false };
    } else if (missing && (now() - (submittedAt || 0)) >= dedupeWindowMs) {
      return { outcome: 'unknown', reason: 'dedupe-expired', resolved: false };
    }

    if (now() >= deadline) {
      if (sawRecord) return { outcome: 'pending', reason: 'still-in-flight', resolved: false, commandId };
      return { outcome: 'unknown', reason: missing ? 'no-record' : 'unreachable', resolved: false };
    }
    await sleep(pollMs);
  }
}