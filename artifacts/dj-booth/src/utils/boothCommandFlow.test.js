import test from 'node:test';
import assert from 'node:assert/strict';
import { runBoothCommand } from './boothCommandFlow.js';
import { reconcileCommandOutcome } from './commandReconcile.js';

const IDENTITY = {
  requestId: 'req-7', action: 'sendToVip', payload: { dancerId: 'd1', durationMs: 600000 },
  submittedAt: 1_000, serverEpochAtSend: 'epoch-a',
};
const harness = () => ({ sleep: async () => {}, now: (() => { let t = 0; return () => (t += 50); })() });
const httpError = (status, extra = {}) => Object.assign(new Error('Request failed'), { status, ...extra });
const rejects = promise => promise.then(() => assert.fail('should not resolve'), e => e);

const assertIdentityKept = (error) => {
  assert.equal(error.requestId, 'req-7', 'the original request id survives');
  assert.equal(error.action, 'sendToVip');
  assert.deepEqual(error.payload, IDENTITY.payload);
  assert.equal(error.submittedAt, 1_000);
  assert.equal(error.serverEpochAtSend, 'epoch-a');
};

test('1. the POST is applied but its response is lost: outcome stays UNKNOWN', async () => {
  let submits = 0;
  const error = await rejects(runBoothCommand({
    submit: async () => { submits += 1; throw new TypeError('Failed to fetch'); },
    getReceipt: async () => assert.fail('a lost response must not trigger a receipt lookup'),
    identity: IDENTITY, ...harness(),
  }));
  assert.equal(error.resultUnknown, true);
  assertIdentityKept(error);
  assert.equal(submits, 1, 'never replayed');
});

test('2. the POST never arrived, and the read-only lookup finds no record', async () => {
  let submits = 0;
  const error = await rejects(runBoothCommand({
    submit: async () => { submits += 1; throw new TypeError('Failed to fetch'); },
    getReceipt: async () => assert.fail('no receipt to look up'),
    identity: IDENTITY, ...harness(),
  }));
  let lookups = 0;
  const reconciled = await reconcileCommandOutcome({
    lookupByRequestId: async (requestId) => {
      lookups += 1;
      assert.equal(requestId, 'req-7', 'reconciled by the ORIGINAL request id');
      return null;
    },
    getServerEpoch: async () => 'epoch-a',
    now: () => 2_000, sleep: async () => {},
  }, { requestId: error.requestId, commandId: error.commandId,
       serverEpochAtSend: error.serverEpochAtSend, submittedAt: error.submittedAt, settleMs: 0 });
  assert.equal(reconciled.outcome, 'unknown');
  assert.equal(reconciled.resolved, false);
  assert.equal(submits, 1, 'reconciliation is read-only - nothing was re-sent');
  assert.ok(lookups >= 1);
});

test('3a. a receipt lookup fails, the next one succeeds: the command is APPLIED', async () => {
  const receipts = [
    async () => { throw new TypeError('Failed to fetch'); },
    async () => ({ queued: false, ok: true, command: { id: 12, status: 'applied' } }),
  ];
  let i = 0;
  const result = await runBoothCommand({
    submit: async () => ({ queued: true, commandId: 12 }),
    getReceipt: async () => receipts[i++](),
    identity: IDENTITY, ...harness(),
  });
  assert.equal(result.ok, true);
  assert.equal(i, 2, 'it kept polling instead of giving up');
});

test('3b. every receipt lookup fails until the deadline: UNKNOWN, with the command id', async () => {
  let polls = 0;
  const error = await rejects(runBoothCommand({
    submit: async () => ({ queued: true, commandId: 12 }),
    getReceipt: async () => { polls += 1; throw new TypeError('Failed to fetch'); },
    identity: IDENTITY, timeoutMs: 600, ...harness(),
  }));
  assert.equal(error.resultUnknown, true);
  assert.equal(error.code, 'BOOTH_COMMAND_TIMEOUT');
  assert.equal(error.requestId, 'req-7');
  assert.equal(error.commandId, 12);
  assert.ok(polls > 1, 'it polled until the deadline');
});

test('4a. an explicit, validated refusal is a CONFIRMED failure', async () => {
  for (const status of [400, 403, 409, 428, 429]) {
    const error = await rejects(runBoothCommand({
      submit: async () => { throw httpError(status, { message: 'Rotation has changed' }); },
      getReceipt: async () => assert.fail('no'),
      identity: IDENTITY, ...harness(),
    }));
    assert.equal(error.status, status);
    assert.notEqual(error.resultUnknown, true, `status ${status} must stay a confirmed failure`);
  }
  // A full queue names its own refusal, so its 5xx is definite too.
  const full = await rejects(runBoothCommand({
    submit: async () => { throw httpError(503, { details: { code: 'BOOTH_COMMAND_QUEUE_FULL' } }); },
    getReceipt: async () => assert.fail('no'),
    identity: IDENTITY, ...harness(),
  }));
  assert.notEqual(full.resultUnknown, true);
});

test('4b. a settled receipt that says no is a CONFIRMED failure', async () => {
  const error = await rejects(runBoothCommand({
    submit: async () => ({ queued: true, commandId: 13 }),
    getReceipt: async () => ({ queued: false, ok: false, command: { id: 13, status: 'failed', error: 'Invalid DJ PIN' } }),
    identity: IDENTITY, ...harness(),
  }));
  assert.equal(error.message, 'Invalid DJ PIN');
  assert.equal(error.rejectedByServer, true);
  assert.notEqual(error.resultUnknown, true);
});

test('4c. an immediate non-queued rejection is confirmed too', async () => {
  const error = await rejects(runBoothCommand({
    submit: async () => ({ queued: false, ok: false, command: { error: 'Unknown or disallowed command action' } }),
    getReceipt: async () => assert.fail('no'),
    identity: IDENTITY, ...harness(),
  }));
  assert.equal(error.rejectedByServer, true);
  assert.notEqual(error.resultUnknown, true);
});

// ---- reproduced by Replit: an answer is not the same as a judgement ----

test('R1. the POST throws 502: a gateway error is NOT proof of non-application', async () => {
  let submits = 0;
  const error = await rejects(runBoothCommand({
    submit: async () => { submits += 1; throw httpError(502, { message: 'Bad Gateway' }); },
    getReceipt: async () => assert.fail('no receipt id is known'),
    identity: IDENTITY, ...harness(),
  }));
  assert.equal(error.resultUnknown, true, 'the command may have been queued before the gateway failed');
  assertIdentityKept(error);
  assert.equal(submits, 1, 'never replayed');
});

test('R2. the receipt GET throws 401: a failure to OBSERVE is not a failure of the command', async () => {
  let polls = 0;
  const error = await rejects(runBoothCommand({
    submit: async () => ({ queued: true, commandId: 31 }),
    getReceipt: async () => { polls += 1; throw httpError(401, { message: 'Session expired' }); },
    identity: IDENTITY, timeoutMs: 600, ...harness(),
  }));
  assert.equal(error.resultUnknown, true, 'a 401 on the RECEIPT path says nothing about the command');
  assert.equal(error.requestId, 'req-7', 'the original request id is kept');
  assert.equal(error.commandId, 31, 'and the known command id');
  assert.ok(polls > 1, 'it kept polling rather than declaring failure');

  // The same lookup recovering proves the command was applied all along.
  let attempt = 0;
  const recovered = await runBoothCommand({
    submit: async () => ({ queued: true, commandId: 31 }),
    getReceipt: async () => {
      attempt += 1;
      if (attempt === 1) throw httpError(401, { message: 'Session expired' });
      return { queued: false, ok: true, command: { id: 31, status: 'applied' } };
    },
    identity: IDENTITY, ...harness(),
  });
  assert.equal(recovered.ok, true);
});

test('R3. the POST response will not parse: ambiguous, so UNKNOWN with identity', async () => {
  const error = await rejects(runBoothCommand({
    submit: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
    getReceipt: async () => assert.fail('no'),
    identity: IDENTITY, ...harness(),
  }));
  assert.equal(error.resultUnknown, true);
  assertIdentityKept(error);
});

test('R4. a malformed receipt body is not an answer either', async () => {
  let polls = 0;
  const error = await rejects(runBoothCommand({
    submit: async () => ({ queued: true, commandId: 44 }),
    getReceipt: async () => { polls += 1; return 'Gateway Timeout'; },   // not a command response
    identity: IDENTITY, timeoutMs: 600, ...harness(),
  }));
  assert.equal(error.resultUnknown, true);
  assert.equal(error.commandId, 44);
  assert.ok(polls > 1, 'an unreadable receipt is skipped, not believed');

  // A malformed SUBMISSION response is unknown too - it may have been queued first.
  const submitError = await rejects(runBoothCommand({
    submit: async () => '<html>502 Bad Gateway</html>',
    getReceipt: async () => assert.fail('no'),
    identity: IDENTITY, ...harness(),
  }));
  assert.equal(submitError.resultUnknown, true);
  assertIdentityKept(submitError);
});