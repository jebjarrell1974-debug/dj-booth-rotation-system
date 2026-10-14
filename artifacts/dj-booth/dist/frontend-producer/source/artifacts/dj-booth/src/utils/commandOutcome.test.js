import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCommandError,
  isAmbiguousAnswer,
  isExplicitCommandRefusal,
  isTransportFailure,
  classifyCommandResponse,
  markUnknownOutcome,
} from './commandOutcome.js';
import { RequestTimeoutError } from './requestDeadline.js';

const httpError = (status, extra = {}) =>
  Object.assign(new Error('Request failed'), { status, ...extra });

test('an explicit, validated refusal is definite', () => {
  for (const status of [400, 401, 403, 404, 409, 422, 428, 429]) {
    assert.equal(isExplicitCommandRefusal(httpError(status)), true, `status ${status}`);
    assert.equal(classifyCommandError(httpError(status)), 'rejected', `status ${status}`);
  }
  // The queue refusing work names itself, so its 5xx is still definite.
  const full = httpError(503, { details: { code: 'BOOTH_COMMAND_QUEUE_FULL' } });
  assert.equal(classifyCommandError(full), 'rejected');
  // And a settled receipt that says failed.
  const settled = Object.assign(new Error('Invalid DJ PIN'), { rejectedByServer: true });
  assert.equal(classifyCommandError(settled), 'rejected');
  assert.equal(settled.resultUnknown, undefined);
});

test('an arbitrary server or gateway status is NOT proof of non-application', () => {
  for (const status of [500, 502, 503, 504, 408]) {
    const error = httpError(status);
    assert.equal(isExplicitCommandRefusal(error), false, `status ${status}`);
    assert.equal(isAmbiguousAnswer(error), true, `status ${status}`);
    assert.equal(classifyCommandError(error, { requestId: 'r1' }), 'unknown', `status ${status}`);
    assert.equal(error.resultUnknown, true);
    assert.equal(error.requestId, 'r1', 'identity is kept for the read-only lookup');
  }
});

test('a response that cannot be parsed is ambiguous, not a failure', () => {
  const broken = new SyntaxError('Unexpected token < in JSON at position 0');
  assert.equal(isAmbiguousAnswer(broken), true);
  assert.equal(classifyCommandError(broken, { requestId: 'r2', action: 'skip' }), 'unknown');
  assert.equal(broken.resultUnknown, true);
  assert.equal(broken.requestId, 'r2');
  assert.equal(broken.action, 'skip');
});

test('⭐ a failure while LOOKING UP a receipt is never a rejection, whatever the status', () => {
  for (const error of [httpError(401), httpError(403), httpError(409), httpError(502),
                       new SyntaxError('bad json'), new TypeError('Failed to fetch')]) {
    const outcome = classifyCommandError(error, { requestId: 'r3', commandId: 77 }, { stage: 'receipt' });
    assert.equal(outcome, 'unknown', `${error.status || error.name} during a receipt lookup`);
    assert.equal(error.resultUnknown, true);
    assert.equal(error.requestId, 'r3');
    assert.equal(error.commandId, 77);
  }
});

test('a transport failure is never a rejection', () => {
  const cases = [
    new TypeError('Failed to fetch'),
    new TypeError('NetworkError when attempting to fetch'),
    new TypeError('Load failed'),
    Object.assign(new Error('aborted'), { name: 'AbortError' }),
    new RequestTimeoutError('/booth/command'),
    Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
  ];
  for (const error of cases) {
    assert.equal(isTransportFailure(error), true, error.message);
    assert.equal(classifyCommandError(error), 'unknown', error.message);
    assert.equal(error.resultUnknown, true, error.message);
  }
});

test('classifying keeps the original identity and never overwrites it', () => {
  const error = new TypeError('Failed to fetch');
  classifyCommandError(error, {
    requestId: 'req-1', action: 'sendToVip', payload: { dancerId: 'd1' },
    submittedAt: 1000, serverEpochAtSend: 'epoch-a',
  });
  assert.equal(error.requestId, 'req-1');
  assert.deepEqual(error.payload, { dancerId: 'd1' });
  markUnknownOutcome(error, { requestId: 'req-LATER', commandId: 42, submittedAt: 9999 });
  assert.equal(error.requestId, 'req-1', 'the original request id is the true one');
  assert.equal(error.submittedAt, 1000);
  assert.equal(error.commandId, 42, 'but a newly-known command id is recorded');
});

test('anything unrecognised stays unknown rather than being called a failure', () => {
  const odd = new RangeError('something unexpected in our own code');
  assert.equal(classifyCommandError(odd, { requestId: 'r4' }), 'unknown');
  assert.equal(odd.resultUnknown, true);
});

test('a response establishes something only if it has the real shape', () => {
  // Valid shapes, from the booth command API.
  assert.equal(classifyCommandResponse({ queued: true, commandId: 17 }, { stage: 'submit' }), 'queued');
  assert.equal(classifyCommandResponse({ queued: false, ok: true, commandId: 5, duplicate: true }), 'applied');
  assert.equal(classifyCommandResponse({ queued: false, ok: false, command: { error: 'nope' } }), 'failed');
  assert.equal(classifyCommandResponse({ queued: true, command: { id: 9 } }, { stage: 'receipt' }), 'queued');
  assert.equal(classifyCommandResponse({ queued: false, ok: true, command: { id: 9 } }, { stage: 'receipt' }), 'applied');
  assert.equal(classifyCommandResponse({ queued: false, ok: false, command: { id: 9, error: 'Invalid DJ PIN' } }, { stage: 'receipt' }), 'failed');

  // Presence is not shape. None of these establish anything.
  const malformed = [
    { commandId: 17 },                       // no queued, no ok
    { command: { id: 17 } },                 // a receipt with neither flag
    { ok: 'false', queued: false },          // a STRING is not a boolean
    { ok: 'true', queued: false },
    { queued: 'true', commandId: 3 },
    { queued: true },                        // queued on a submission with nothing to track
    { queued: true, commandId: '3' },
    { queued: false },                       // terminal with no verdict
    { queued: false, ok: null },
    { queued: false, ok: 1 },
    {}, null, undefined, 'OK', 42, [], { error: 'gateway timeout' },
  ];
  for (const body of malformed) {
    assert.equal(classifyCommandResponse(body, { stage: 'submit' }), 'malformed', JSON.stringify(body));
  }
  // A queued RECEIPT needs no commandId - the caller already knows it.
  assert.equal(classifyCommandResponse({ queued: true }, { stage: 'receipt' }), 'queued');
});