// ElevenLabs credential state and error classification.
//
// Extracted from AnnouncementSystem so these rules can be unit-tested. Getting them
// wrong is expensive in both directions: treating a transient failure as a bad key
// silences a booth whose credential is fine, and failing to recognise a genuinely
// rejected key costs a live 30 s TTS attempt - plus a key-recovery retry with its own
// 30 s budget - on EVERY announcement, with the music ducked the whole time.

// Rejected keys are tracked PER KEY, not as one session-wide flag: if the operator
// pastes a replacement key from the remote panel, that new key must get a real attempt
// without a booth restart. Only the key that was actually rejected stays blocked.
// Keys are stored as a short fingerprint, never as the raw secret.
// fingerprint -> { rejectedAt, lastProbeAt }
const rejectedElevenLabsKeys = new Map();

// How long a rejected key stays blocked before it is allowed ONE more attempt.
// A genuinely dead key therefore costs at most one live attempt per window instead of
// one per announcement; a key rejected transiently heals on its own instead of
// silencing the booth until somebody reloads the kiosk.
export const ELEVENLABS_KEY_RETRY_MS = 10 * 60 * 1000;

export function elevenLabsKeyFingerprint(key) {
  const str = String(key || '');
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${str.length}:${(h >>> 0).toString(36)}`;
}

export function isElevenLabsKeyRejected(key) {
  return !!key && rejectedElevenLabsKeys.has(elevenLabsKeyFingerprint(key));
}

export function markElevenLabsKeyRejected(key, now = Date.now()) {
  if (!key) return;
  const fp = elevenLabsKeyFingerprint(key);
  const existing = rejectedElevenLabsKeys.get(fp);
  // Re-rejecting restarts the clock; the first rejection time is kept for diagnostics.
  rejectedElevenLabsKeys.set(fp, {
    rejectedAt: existing?.rejectedAt ?? now,
    lastProbeAt: now,
  });
}

/**
 * May this key be attempted right now?
 *
 * True when it has never been rejected, and true again once the cool-off has elapsed
 * since the last attempt - so a key that was rejected transiently recovers WITHOUT a
 * kiosk reload, while a genuinely dead key is still attempted at most once per window.
 */
export function elevenLabsKeyProbeAllowed(key, now = Date.now()) {
  if (!key) return false;
  const entry = rejectedElevenLabsKeys.get(elevenLabsKeyFingerprint(key));
  if (!entry) return true;
  return (now - entry.lastProbeAt) >= ELEVENLABS_KEY_RETRY_MS;
}

/** Record that the one allowed probe has been spent, so the window restarts. */
export function noteElevenLabsKeyProbe(key, now = Date.now()) {
  if (!key) return;
  const fp = elevenLabsKeyFingerprint(key);
  const entry = rejectedElevenLabsKeys.get(fp);
  if (entry) rejectedElevenLabsKeys.set(fp, { ...entry, lastProbeAt: now });
}

/** The key worked. Forget the rejection entirely - it is good again. */
export function clearElevenLabsKeyRejection(key) {
  if (key) rejectedElevenLabsKeys.delete(elevenLabsKeyFingerprint(key));
}

/**
 * Decide whether a rejected attempt earns ONE more try, and with which key.
 *
 * Bounded by construction:
 *  - `alreadyRejectedBefore` is read from the ledger BEFORE this attempt is marked. A key
 *    that was already blocked cannot buy another immediate retry, so repeated auth
 *    failures can never loop - the second failure in a row returns { retry: false }.
 *  - A DIFFERENT key is judged on its own record, never blocked because its predecessor
 *    was bad, and never retried if it is itself already rejected.
 *  - The caller performs at most one `doTTS` for the returned key and does not consult
 *    this function again for the same announcement.
 */
export function planElevenLabsRetry({
  apiKey,
  freshKey,
  recovered,
  alreadyRejectedBefore,
} = {}) {
  if (!recovered || !freshKey) return { retry: false, reason: 'no-usable-key' };
  const differentKey = freshKey !== apiKey;
  if (differentKey) {
    if (isElevenLabsKeyRejected(freshKey)) return { retry: false, reason: 'replacement-already-rejected' };
    return { retry: true, key: freshKey, reason: 'replacement-key' };
  }
  // Same key back from the server is the NORMAL result of a TRANSIENT 401 - the server's
  // copy is the correct credential. It earns exactly one immediate retry, and only on
  // this key's FIRST rejection.
  if (alreadyRejectedBefore) return { retry: false, reason: 'already-rejected-no-loop' };
  return { retry: true, key: freshKey, reason: 're-pulled-same-key' };
}

/** Diagnostics only: what the ledger currently holds, by fingerprint. */
export function elevenLabsKeyRejectionInfo(key) {
  if (!key) return null;
  return rejectedElevenLabsKeys.get(elevenLabsKeyFingerprint(key)) || null;
}

// Test-only helper; never called by the booth.
export function resetElevenLabsKeyState() {
  rejectedElevenLabsKeys.clear();
}

// Codes/types by which the provider itself confirms the CREDENTIAL is bad.
export const ELEVENLABS_AUTH_CODES = new Set([
  'invalid_api_key', 'authentication_error', 'invalid_api_key_format',
  'missing_api_key', 'unauthorized',
]);

function confirmsBadKey(providerCode, providerType) {
  return ELEVENLABS_AUTH_CODES.has(String(providerCode || '').toLowerCase())
    || ELEVENLABS_AUTH_CODES.has(String(providerType || '').toLowerCase());
}

// ONLY a genuine credential failure may block a key. A timeout, an operator
// cancellation, a network drop and a 429 are all transient - the key is still good.
// Classification reads STRUCTURED fields carried on the error, never a formatted
// message string (which the builder below may have already summarised).
export function isElevenLabsAuthFailure(err) {
  if (!err) return false;
  // Covers both the 30 s timeout abort and an operator/unmount cancellation.
  if (err.name === 'AbortError') return false;
  if (err.httpStatus === 429) return false;                    // rate limited, not auth
  if (err.httpStatus === 401) return true;
  // A bare 403 is NOT proof of a bad key. ElevenLabs also returns 403 for permission,
  // plan and quota problems on a perfectly valid key (missing_permissions, a voice not
  // available to the account, and similar). It counts only when the provider's own
  // code or type confirms the key itself is invalid.
  if (err.httpStatus === 403) return confirmsBadKey(err.providerCode, err.providerType);
  if (confirmsBadKey(err.providerCode, err.providerType)) return true;
  // Legacy text forms produced by this codebase before structured codes existed.
  return /must start with 'sk_'|invalid elevenlabs api key/i.test(err.message || '');
}

// Builds the Error for a non-OK ElevenLabs response, preserving the provider's
// structured codes.
//
// ElevenLabs returns {"detail":{"type":"authentication_error","code":"invalid_api_key"}}
// - an OBJECT with no `.message`. The original `detail?.message || detail` fell through
// to the object itself, which template interpolation rendered as "[object Object]",
// destroying the codes before anything could classify them.
export function buildElevenLabsHttpError(status, errBody) {
  const d = errBody?.detail;
  const providerCode = d?.code ?? errBody?.code ?? null;
  const providerType = d?.type ?? errBody?.type ?? null;
  let detail = '';
  if (typeof d === 'string') detail = d;
  else if (d?.message) detail = d.message;
  else if (d) detail = JSON.stringify(d);
  else if (errBody) detail = JSON.stringify(errBody);

  const authLike = status === 401 || confirmsBadKey(providerCode, providerType);
  let err;
  if (authLike) {
    err = new Error(`Invalid ElevenLabs API key - check settings. ${detail}`);
  } else if (status === 429) {
    err = new Error('Rate limit exceeded. Wait a moment and try again.');
  } else {
    err = new Error(`ElevenLabs error (${status}): ${detail || 'Unknown error'}`);
  }
  err.httpStatus = status;
  err.providerCode = providerCode;
  err.providerType = providerType;
  return err;
}