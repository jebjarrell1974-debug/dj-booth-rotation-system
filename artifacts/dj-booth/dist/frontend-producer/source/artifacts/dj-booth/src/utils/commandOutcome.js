/**
 * Did anything actually prove what happened to this command?
 *
 * Three kinds of bad news arrive at the same place and only one of them is evidence:
 *
 *   an explicit refusal   the application judged the command and declined it - a validation
 *                         error, a stale-version conflict, a bad PIN, an expired session, a
 *                         full queue - or a settled receipt that says `failed`. The command
 *                         was NOT applied.
 *   an ambiguous answer   a gateway or server error (502/503/504/500), a response that could
 *                         not be parsed, anything unrecognised. The request may well have
 *                         reached the application and been applied before the answer was
 *                         lost. Nothing is proved.
 *   no answer at all      fetch TypeErrors, aborts, deadline timeouts, socket errors.
 *
 * ⚠️ AND THE STAGE MATTERS AS MUCH AS THE ERROR. A failure while LOOKING UP a receipt says
 * nothing whatever about the command: the kiosk may have applied it a second earlier. A 401
 * or a 502 from the receipt endpoint is a failure to observe, not a rejection. Only the
 * SUBMISSION can produce a refusal, and only a settled receipt body can produce a failure.
 *
 * Everything that is not a recognised refusal is UNKNOWN, reconciled read-only and never
 * replayed. That direction is deliberate: an unknown outcome tells the operator to check the
 * booth, which is never wrong; a false "failed" invites a duplicate.
 */

const TRANSPORT_CODES = new Set(['REQUEST_TIMEOUT', 'BOOTH_COMMAND_TIMEOUT', 'ECONNRESET',
  'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_NETWORK']);

const TRANSPORT_MESSAGES = [
  /failed to fetch/i,          // Chromium
  /networkerror/i,             // Firefox
  /load failed/i,              // Safari
  /network request failed/i,
  /connection (closed|reset|refused|aborted)/i,
  /socket hang up/i,
  /the operation was aborted/i,
];

/**
 * Statuses the booth command API itself returns when it has JUDGED a submission. Each one
 * means the request reached a layer that decided, and the command was not applied.
 * 408 and every 5xx are deliberately absent: they are ambiguous.
 */
const REFUSAL_STATUSES = new Set([400, 401, 403, 404, 405, 409, 415, 422, 428, 429]);

/** Application refusals that arrive with a 5xx for capacity reasons, identified explicitly. */
const REFUSAL_CODES = new Set(['BOOTH_COMMAND_QUEUE_FULL']);

/** The application judged this command and declined it. The only certain non-application. */
export function isExplicitCommandRefusal(error) {
  if (!error) return false;
  if (error.rejectedByServer === true) return true;          // a settled receipt said failed
  const status = error.status;
  if (!Number.isInteger(status)) return false;
  if (REFUSAL_STATUSES.has(status)) return true;
  // A 5xx counts only when the application named the refusal itself.
  return REFUSAL_CODES.has(error.details?.code) || REFUSAL_CODES.has(error.code);
}

/** The request produced no answer at all. Says nothing about whether it was applied. */
export function isTransportFailure(error) {
  if (!error) return false;
  if (isExplicitCommandRefusal(error)) return false;
  if (error.resultUnknown === true) return true;
  if (error.code && TRANSPORT_CODES.has(error.code)) return true;
  if (error.name === 'AbortError' || error.name === 'TimeoutError' ||
      error.name === 'RequestTimeoutError') return true;
  if (error instanceof TypeError) return true;
  const message = String(error.message || '');
  return TRANSPORT_MESSAGES.some(rx => rx.test(message));
}

/** An answer arrived but nothing can be concluded from it. */
export function isAmbiguousAnswer(error) {
  if (!error || isExplicitCommandRefusal(error)) return false;
  if (error instanceof SyntaxError) return true;                       // unparseable body
  if (Number.isInteger(error.status) && error.status >= 500) return true;
  if (error.status === 408) return true;
  return false;
}

/**
 * Marks an error as an unknown outcome and attaches everything needed to FIND OUT what
 * happened without sending anything: the original requestId, the send-time identity and
 * server epoch, and the command id when one is known. Existing fields are never overwritten
 * - the earliest identity is the true one.
 */
export function markUnknownOutcome(error, identity = {}) {
  if (!error || typeof error !== 'object') return error;
  error.resultUnknown = true;
  for (const [key, value] of Object.entries(identity)) {
    if (value === undefined) continue;
    if (error[key] === undefined) error[key] = value;
  }
  return error;
}

/**
 * The whole decision for one caught error.
 *
 * `stage: 'receipt'` is unconditionally unknown - a lookup that fails cannot tell you what
 * the kiosk did. `stage: 'submit'` is a rejection only for an explicit refusal; ambiguity of
 * any kind keeps its identity and stays unknown.
 */
export function classifyCommandError(error, identity = {}, { stage = 'submit' } = {}) {
  if (stage !== 'submit') {
    markUnknownOutcome(error, identity);
    return 'unknown';
  }
  if (isExplicitCommandRefusal(error)) return 'rejected';
  markUnknownOutcome(error, identity);
  return 'unknown';
}

/**
 * What does this response body actually establish?
 *
 * Checking that a recognised property is PRESENT is not enough - presence is not shape. Three
 * bodies that slipped through a presence check, each of which must not decide anything:
 *
 *   {commandId: 17}                 no `queued`, no `ok` - it says nothing at all
 *   {command: {id: 17}}             a receipt with neither flag
 *   {ok: "false", queued: false}    a STRING, which is truthy, so it read as success
 *
 * The real contract, from the booth command API:
 *
 *   queued response    `queued === true`, and on a submission an integer `commandId`,
 *                      because without one the command cannot be tracked;
 *   terminal response  `queued === false` AND a boolean `ok` - true applied, false failed.
 *
 * Anything else is MALFORMED: an ambiguous answer that establishes neither success nor
 * failure, to be treated exactly like no answer at all.
 */
export function classifyCommandResponse(body, { stage = 'submit' } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'malformed';
  if (typeof body.queued !== 'boolean') return 'malformed';
  if (body.queued) {
    // A queued submission must say WHICH command was queued, or it cannot be followed up.
    if (stage === 'submit' && !Number.isInteger(body.commandId)) return 'malformed';
    return 'queued';
  }
  // Terminal: only a real boolean establishes success or failure. "false", 0, null, absent -
  // none of them are the API saying anything.
  if (typeof body.ok !== 'boolean') return 'malformed';
  return body.ok ? 'applied' : 'failed';
}