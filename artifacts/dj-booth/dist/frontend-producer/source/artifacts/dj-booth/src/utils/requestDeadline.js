// A deadline that covers a whole request, not just its headers.
//
// `fetch` resolves as soon as the response HEADERS arrive. Clearing the timeout there
// leaves the body read and the JSON parse unguarded, so a server that answers
// immediately and then stalls the body hangs the caller forever - the exact failure the
// timeout exists to prevent. Error responses have the same problem, because their body
// is read to build the error.
//
// The timer is cleared only after the supplied operation has fully settled.

export class RequestTimeoutError extends Error {
  constructor(label) {
    super(`Request timed out: ${label}`);
    this.name = 'RequestTimeoutError';
    this.code = 'REQUEST_TIMEOUT';
    // ⚠️ A timeout is NOT proof the request did not happen. For a state-changing call
    // the server may already have queued, claimed or applied it.
    this.resultUnknown = true;
  }
}

// run(signal) receives a signal that is aborted on the deadline OR on caller
// cancellation, and must pass it to fetch so the body read is aborted too.
export async function withRequestDeadline({ timeoutMs = 0, signal: callerSignal, label = 'request',
  setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}, run) {
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort();

  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }
  const timer = timeoutMs > 0
    ? setTimeoutImpl(() => { timedOut = true; controller.abort(); }, timeoutMs)
    : null;

  try {
    // Awaited here so the deadline stays armed for the body read and the parse.
    return await run(controller.signal);
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError(label);
    throw error;
  } finally {
    if (timer !== null) clearTimeoutImpl(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
  }
}