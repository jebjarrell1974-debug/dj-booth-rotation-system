import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ELEVENLABS_AUTH_CODES,
  buildElevenLabsHttpError,
  elevenLabsKeyFingerprint,
  isElevenLabsAuthFailure,
  isElevenLabsKeyRejected,
  markElevenLabsKeyRejected,
  elevenLabsKeyProbeAllowed,
  noteElevenLabsKeyProbe,
  clearElevenLabsKeyRejection,
  ELEVENLABS_KEY_RETRY_MS,
  planElevenLabsRetry,
  elevenLabsKeyRejectionInfo,
  resetElevenLabsKeyState,
} from './elevenLabsKeyState.js';

// ---- what must NOT be mistaken for a bad credential -----------------------

test('a request timeout (AbortError) is not a credential failure', () => {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  assert.equal(isElevenLabsAuthFailure(err), false);
});

test('an operator/unmount cancellation is not a credential failure', () => {
  const err = new Error('cancelled');
  err.name = 'AbortError';
  assert.equal(isElevenLabsAuthFailure(err), false);
});

test('a network drop is not a credential failure', () => {
  assert.equal(isElevenLabsAuthFailure(new TypeError('Failed to fetch')), false);
});

test('a 429 rate limit is not a credential failure', () => {
  assert.equal(isElevenLabsAuthFailure(buildElevenLabsHttpError(429, {})), false);
});

test('a BARE 403 is a permission failure, not a bad key', () => {
  const err = buildElevenLabsHttpError(403, { detail: { message: 'missing_permissions' } });
  assert.equal(isElevenLabsAuthFailure(err), false);
  assert.doesNotMatch(err.message, /Invalid ElevenLabs API key/);
});

test('a 403 that names a voice permission problem is not a bad key', () => {
  const err = buildElevenLabsHttpError(403, { detail: { status: 'voice_not_allowed' } });
  assert.equal(isElevenLabsAuthFailure(err), false);
});

test('a 500 from the provider is not a bad key', () => {
  assert.equal(isElevenLabsAuthFailure(buildElevenLabsHttpError(500, {})), false);
});

// ---- what MUST be recognised ---------------------------------------------

test('a 401 is a credential failure', () => {
  assert.equal(isElevenLabsAuthFailure(buildElevenLabsHttpError(401, {})), true);
});

test("production's real 400 payload is recognised and its codes survive", () => {
  // The exact shape observed on the booth: HTTP 400, object detail, no .message.
  const err = buildElevenLabsHttpError(400, {
    detail: { type: 'authentication_error', code: 'invalid_api_key' },
  });
  assert.equal(err.providerCode, 'invalid_api_key');
  assert.equal(err.providerType, 'authentication_error');
  assert.equal(isElevenLabsAuthFailure(err), true);
  assert.doesNotMatch(err.message, /\[object Object\]/, 'structured detail must never render as [object Object]');
});

test('a 403 WITH a confirming provider code is a credential failure', () => {
  const err = buildElevenLabsHttpError(403, { detail: { code: 'invalid_api_key' } });
  assert.equal(isElevenLabsAuthFailure(err), true);
});

test('legacy text-only key errors are still recognised', () => {
  assert.equal(isElevenLabsAuthFailure(new Error("api_key must start with 'sk_'")), true);
});

// ---- per-key ledger ------------------------------------------------------

test('blocking one key does not block a different key', () => {
  resetElevenLabsKeyState();
  markElevenLabsKeyRejected('sk_the_bad_one');
  assert.equal(isElevenLabsKeyRejected('sk_the_bad_one'), true);
  assert.equal(isElevenLabsKeyRejected('sk_the_replacement'), false,
    'a pasted replacement key must get a real attempt without a booth restart');
});

test('the ledger stores a fingerprint, never the raw secret', () => {
  const secret = 'sk_super_secret_value_1234567890';
  const fp = elevenLabsKeyFingerprint(secret);
  assert.doesNotMatch(fp, /super_secret/);
  assert.ok(fp.length < secret.length);
});

test('an empty/absent key is never considered rejected', () => {
  resetElevenLabsKeyState();
  assert.equal(isElevenLabsKeyRejected(''), false);
  assert.equal(isElevenLabsKeyRejected(undefined), false);
});

test('the auth-code set covers the provider vocabulary we rely on', () => {
  for (const code of ['invalid_api_key', 'authentication_error', 'missing_api_key']) {
    assert.ok(ELEVENLABS_AUTH_CODES.has(code));
  }
});


// ---- FIX 9a: a rejected key must have a bounded way back -------------------
// Measured in the 004 lab: one transient 401 blocked TTS for the whole session, because
// recovery handed back the SAME (correct) key and nothing would attempt it again.

test('a rejected key is blocked immediately, then gets ONE probe after the cool-off', () => {
  resetElevenLabsKeyState();
  const key = 'sk_' + 'a'.repeat(32);
  const t0 = 1_000_000;
  markElevenLabsKeyRejected(key, t0);
  assert.equal(isElevenLabsKeyRejected(key), true);
  assert.equal(elevenLabsKeyProbeAllowed(key, t0), false);
  assert.equal(elevenLabsKeyProbeAllowed(key, t0 + ELEVENLABS_KEY_RETRY_MS - 1), false);
  assert.equal(elevenLabsKeyProbeAllowed(key, t0 + ELEVENLABS_KEY_RETRY_MS), true);
});

test('spending the probe restarts the window - a dead key costs at most one attempt per window', () => {
  resetElevenLabsKeyState();
  const key = 'sk_' + 'b'.repeat(32);
  const t0 = 2_000_000;
  markElevenLabsKeyRejected(key, t0);
  const probeAt = t0 + ELEVENLABS_KEY_RETRY_MS;
  assert.equal(elevenLabsKeyProbeAllowed(key, probeAt), true);
  noteElevenLabsKeyProbe(key, probeAt);
  assert.equal(elevenLabsKeyProbeAllowed(key, probeAt + 1), false);
  assert.equal(elevenLabsKeyProbeAllowed(key, probeAt + ELEVENLABS_KEY_RETRY_MS), true);
});

test('a successful generation clears the rejection outright', () => {
  resetElevenLabsKeyState();
  const key = 'sk_' + 'c'.repeat(32);
  markElevenLabsKeyRejected(key, 3_000_000);
  assert.equal(isElevenLabsKeyRejected(key), true);
  clearElevenLabsKeyRejection(key);
  assert.equal(isElevenLabsKeyRejected(key), false);
  assert.equal(elevenLabsKeyProbeAllowed(key, 3_000_001), true);
});

test('a key that was never rejected is always allowed', () => {
  resetElevenLabsKeyState();
  assert.equal(elevenLabsKeyProbeAllowed('sk_' + 'd'.repeat(32), 1), true);
  assert.equal(elevenLabsKeyProbeAllowed('', 1), false);
  assert.equal(elevenLabsKeyProbeAllowed(null, 1), false);
});

test('blocking one key never blocks a different one', () => {
  resetElevenLabsKeyState();
  const bad = 'sk_' + 'e'.repeat(32);
  const good = 'sk_' + 'f'.repeat(32);
  markElevenLabsKeyRejected(bad, 4_000_000);
  assert.equal(isElevenLabsKeyRejected(good), false);
  assert.equal(elevenLabsKeyProbeAllowed(good, 4_000_001), true);
});

test('re-rejecting restarts the cool-off but keeps the original rejection time', () => {
  resetElevenLabsKeyState();
  const key = 'sk_' + 'g'.repeat(32);
  markElevenLabsKeyRejected(key, 5_000_000);
  const later = 5_000_000 + ELEVENLABS_KEY_RETRY_MS + 500;
  assert.equal(elevenLabsKeyProbeAllowed(key, later), true);
  markElevenLabsKeyRejected(key, later);
  assert.equal(elevenLabsKeyProbeAllowed(key, later + 1), false);
  const info = elevenLabsKeyRejectionInfo(key);
  assert.equal(info.rejectedAt, 5_000_000, 'the first rejection time is kept for diagnostics');
  assert.equal(info.lastProbeAt, later);
});


// ---- FIX 9d: the immediate retry is BOUNDED and cannot loop -----------------

test('the immediate retry happens at most ONCE - a second auth failure does not retry', () => {
  resetElevenLabsKeyState();
  const key = 'sk_' + 'h'.repeat(32);
  // First rejection: the ledger had nothing for this key, so it earns one retry.
  const first = planElevenLabsRetry({ apiKey: key, freshKey: key, recovered: true, alreadyRejectedBefore: false });
  assert.equal(first.retry, true);
  assert.equal(first.key, key);
  assert.equal(first.reason, 're-pulled-same-key');
  // That retry also failed, so the key is now marked. The NEXT attempt reads
  // alreadyRejectedBefore = true and must not retry again.
  markElevenLabsKeyRejected(key, 1000);
  const second = planElevenLabsRetry({ apiKey: key, freshKey: key, recovered: true, alreadyRejectedBefore: true });
  assert.equal(second.retry, false);
  assert.equal(second.reason, 'already-rejected-no-loop');
});

test('repeated auth failures can never loop - 50 rounds yield at most one retry each, never two in a row', () => {
  resetElevenLabsKeyState();
  const key = 'sk_' + 'i'.repeat(32);
  let retries = 0;
  let consecutive = 0;
  for (let round = 0; round < 50; round++) {
    const alreadyRejectedBefore = isElevenLabsKeyRejected(key);
    const plan = planElevenLabsRetry({ apiKey: key, freshKey: key, recovered: true, alreadyRejectedBefore });
    if (plan.retry) { retries++; consecutive++; } else { consecutive = 0; }
    assert.ok(consecutive <= 1, 'never two immediate retries in a row');
    // every attempt - original and retry - ends in a confirmed auth failure
    markElevenLabsKeyRejected(key, 1000 + round);
  }
  assert.equal(retries, 1, 'only the very first rejection ever bought a retry');
});

test('a replacement key is judged on its own record, and is not retried if already rejected', () => {
  resetElevenLabsKeyState();
  const bad = 'sk_' + 'j'.repeat(32);
  const replacement = 'sk_' + 'k'.repeat(32);
  markElevenLabsKeyRejected(bad, 1000);
  const ok = planElevenLabsRetry({ apiKey: bad, freshKey: replacement, recovered: true, alreadyRejectedBefore: true });
  assert.deepEqual({ retry: ok.retry, key: ok.key, reason: ok.reason },
                   { retry: true, key: replacement, reason: 'replacement-key' });
  markElevenLabsKeyRejected(replacement, 1001);
  const no = planElevenLabsRetry({ apiKey: bad, freshKey: replacement, recovered: true, alreadyRejectedBefore: true });
  assert.equal(no.retry, false);
  assert.equal(no.reason, 'replacement-already-rejected');
});

test('no usable key means no retry', () => {
  resetElevenLabsKeyState();
  const key = 'sk_' + 'l'.repeat(32);
  assert.equal(planElevenLabsRetry({ apiKey: key, freshKey: key, recovered: false, alreadyRejectedBefore: false }).retry, false);
  assert.equal(planElevenLabsRetry({ apiKey: key, freshKey: '', recovered: true, alreadyRejectedBefore: false }).retry, false);
  assert.equal(planElevenLabsRetry({}).retry, false);
});

// ---- transient failures must NEVER mark a key invalid ----------------------

test('429, network, abort and timeout errors are not credential failures and leave the ledger clean', () => {
  resetElevenLabsKeyState();
  const key = 'sk_' + 'm'.repeat(32);
  const transient = [
    Object.assign(new Error('Rate limit exceeded. Wait a moment and try again.'), { httpStatus: 429, providerCode: 'too_many_requests' }),
    Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    new TypeError('Failed to fetch'),
    Object.assign(new Error('network timeout'), { code: 'REQUEST_TIMEOUT' }),
    Object.assign(new Error('ElevenLabs error (500): upstream'), { httpStatus: 500 }),
    Object.assign(new Error('ElevenLabs error (502): bad gateway'), { httpStatus: 502 }),
    Object.assign(new Error('ElevenLabs error (503): unavailable'), { httpStatus: 503 }),
    // a BARE 403 is permission/plan/quota, not a bad credential
    Object.assign(new Error('ElevenLabs error (403): missing_permissions'), { httpStatus: 403, providerCode: 'missing_permissions' }),
  ];
  for (const err of transient) {
    assert.equal(isElevenLabsAuthFailure(err), false, `must not classify as auth failure: ${err.message}`);
    // the booth marks ONLY on a confirmed auth failure
    if (isElevenLabsAuthFailure(err)) markElevenLabsKeyRejected(key);
  }
  assert.equal(isElevenLabsKeyRejected(key), false, 'no transient failure may block a key');
  assert.equal(elevenLabsKeyProbeAllowed(key, Date.now()), true);
});

test('a transient failure does not consume the retry a later REAL rejection is entitled to', () => {
  resetElevenLabsKeyState();
  const key = 'sk_' + 'n'.repeat(32);
  const rateLimited = Object.assign(new Error('Rate limit exceeded'), { httpStatus: 429 });
  if (isElevenLabsAuthFailure(rateLimited)) markElevenLabsKeyRejected(key);
  // later, a genuine 401 arrives - this is still the key's FIRST rejection
  const real = Object.assign(new Error('Invalid ElevenLabs API key'), { httpStatus: 401, providerCode: 'invalid_api_key' });
  assert.equal(isElevenLabsAuthFailure(real), true);
  const alreadyRejectedBefore = isElevenLabsKeyRejected(key);
  assert.equal(alreadyRejectedBefore, false);
  assert.equal(planElevenLabsRetry({ apiKey: key, freshKey: key, recovered: true, alreadyRejectedBefore }).retry, true);
});

test('401 and provider-confirmed 403 DO mark the key', () => {
  resetElevenLabsKeyState();
  const k1 = 'sk_' + 'o'.repeat(32);
  const k2 = 'sk_' + 'p'.repeat(32);
  assert.equal(isElevenLabsAuthFailure(Object.assign(new Error('x'), { httpStatus: 401 })), true);
  assert.equal(isElevenLabsAuthFailure(Object.assign(new Error('x'), { httpStatus: 403, providerCode: 'invalid_api_key' })), true);
  markElevenLabsKeyRejected(k1, 1); markElevenLabsKeyRejected(k2, 1);
  assert.equal(isElevenLabsKeyRejected(k1), true);
  assert.equal(isElevenLabsKeyRejected(k2), true);
});