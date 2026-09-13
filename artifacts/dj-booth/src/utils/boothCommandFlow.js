import {
  classifyCommandError,
  isUsableCommandResponse,
  markUnknownOutcome,
} from './commandOutcome.js';

export const BOOTH_COMMAND_POLL_MS = 250;
export const BOOTH_COMMAND_TIMEOUT_MS = 35_000;

/**
 * Submit one booth command and find out what happened to it.
 *
 * Three endings, kept strictly apart:
 *
 *   applied    a settled receipt said so;
 *   rejected   the application judged the SUBMISSION and declined it, or a settled receipt
 *              says the command failed;
 *   unknown    everything else - no answer, an ambiguous answer, an unreadable answer, or a
 *              receipt that could not be looked up.
 *
 * ⚠️ A failure to OBSERVE is never a failure of the command. Anything that goes wrong while
 * polling for the receipt - a 401, a 502, a dropped connection, a body that will not parse -
 * leaves the loop running until the overall deadline and then reports unknown, carrying the
 * original requestId and the command id. Nothing here ever resubmits.
 */
export async function runBoothCommand({
  submit,
  getReceipt,
  identity = {},
  timeoutMs = BOOTH_COMMAND_TIMEOUT_MS,
  pollMs = BOOTH_COMMAND_POLL_MS,
  now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  let submitted;
  try {
    submitted = await submit();
  } catch (error) {
    classifyCommandError(error, identity, { stage: 'submit' });
    throw error;
  }

  if (!isUsableCommandResponse(submitted)) {
    // The server answered with something this client cannot read. It may well have queued
    // the command first - that is not a refusal.
    const error = new Error('The booth server sent a response this client could not read');
    markUnknownOutcome(error, identity);
    throw error;
  }

  if (!submitted.queued) {
    if (!submitted.ok) {
      const error = new Error(submitted.command?.error || 'The kiosk did not apply the command');
      error.details = submitted;
      error.rejectedByServer = true;
      throw error;
    }
    return submitted;
  }

  const commandId = submitted.commandId;
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await sleep(pollMs);
    // Bound EACH poll by whatever is left of the overall deadline. Checking the clock only
    // between iterations was not enough: a single hung request never returned, so the loop
    // never re-tested the deadline and the caller waited forever.
    const remaining = deadline - now();
    if (remaining <= 0) break;
    let receipt;
    try {
      receipt = await getReceipt(commandId, {
        timeoutMs: Math.max(1_000, Math.min(5_000, remaining)),
      });
    } catch (error) {
      // Failing to look the receipt up proves nothing about the command, whatever the
      // reason. Record what we know and keep polling.
      classifyCommandError(error, { ...identity, commandId }, { stage: 'receipt' });
      continue;
    }
    // A receipt we cannot read is also not an answer.
    if (!isUsableCommandResponse(receipt)) continue;
    if (receipt.queued) continue;
    if (!receipt.ok) {
      // A settled receipt IS the answer: the kiosk or the server judged this command.
      const error = new Error(receipt.command?.error || 'The kiosk rejected the command');
      error.details = receipt;
      error.rejectedByServer = true;
      throw error;
    }
    return receipt;
  }

  // Outcome unknown, NOT "not applied": the command may still be queued, or may have been
  // applied with the receipt lost on the way back.
  const error = new Error('The kiosk did not confirm that the command was applied');
  error.code = 'BOOTH_COMMAND_TIMEOUT';
  markUnknownOutcome(error, { ...identity, commandId });
  throw error;
}