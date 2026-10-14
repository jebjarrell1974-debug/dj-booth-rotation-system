import nacl from 'tweetnacl';

const LS_PUBLIC_KEY = 'djbooth_license_public_key';
const LS_TOKEN = 'djbooth_license_token';
const LS_FIRST_TOKEN_AT = 'djbooth_license_first_token_at';
const LS_LAST_CONTACT = 'djbooth_license_last_contact';
const LS_AUTO_COUNTDOWN_AT = 'djbooth_license_auto_countdown_at';
const LS_MANUAL_TOKEN = 'djbooth_license_manual_token';

const DAY_MS = 24 * 60 * 60 * 1000;
export const NO_CONTACT_GRACE_MS = 30 * DAY_MS;
export const COUNTDOWN_MS = 30 * DAY_MS;

const subscribers = new Set();

function notify() {
  const state = getLicenseState();
  for (const fn of subscribers) {
    try { fn(state); } catch {}
  }
}

export function subscribeLicense(fn) {
  subscribers.add(fn);
  fn(getLicenseState());
  return () => subscribers.delete(fn);
}

function base64urlToBytes(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function pemToRawPublicKey(pem) {
  const stripped = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(stripped), c => c.charCodeAt(0));
  return der.slice(der.length - 32);
}

function verifySignature(payloadB64, sigB64, publicKeyPem) {
  try {
    const rawKey = pemToRawPublicKey(publicKeyPem);
    const sig = base64urlToBytes(sigB64);
    const msg = new TextEncoder().encode(payloadB64);
    return nacl.sign.detached.verify(msg, sig, rawKey);
  } catch {
    return false;
  }
}

export function verifyToken(token, publicKeyPem) {
  if (!token || !publicKeyPem) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!verifySignature(payloadB64, sigB64, publicKeyPem)) return null;
  try {
    const json = new TextDecoder().decode(base64urlToBytes(payloadB64));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getDeviceId() {
  return localStorage.getItem('fleet_device_id') || '';
}

export function getStoredPublicKey() {
  return localStorage.getItem(LS_PUBLIC_KEY) || '';
}

export function setStoredPublicKey(pem) {
  if (pem && typeof pem === 'string') {
    localStorage.setItem(LS_PUBLIC_KEY, pem);
  }
}

export function recordHomebaseContact() {
  localStorage.setItem(LS_LAST_CONTACT, String(Date.now()));
}

export function ingestHeartbeatLicense(licenseField) {
  if (!licenseField || typeof licenseField !== 'object') {
    recordHomebaseContact();
    notify();
    return;
  }
  if (licenseField.publicKey) setStoredPublicKey(licenseField.publicKey);
  if (licenseField.token) {
    const pubKey = getStoredPublicKey();
    const verified = verifyToken(licenseField.token, pubKey);
    const expectedDeviceId = getDeviceId();
    if (verified && (!expectedDeviceId || verified.deviceId === expectedDeviceId)) {
      localStorage.setItem(LS_TOKEN, licenseField.token);
      if (!localStorage.getItem(LS_FIRST_TOKEN_AT)) {
        localStorage.setItem(LS_FIRST_TOKEN_AT, String(Date.now()));
      }
      if (verified.status === 'active') {
        localStorage.removeItem(LS_AUTO_COUNTDOWN_AT);
        localStorage.removeItem(LS_MANUAL_TOKEN);
      }
    }
  }
  recordHomebaseContact();
  notify();
}

export function applyManualKey(token) {
  const pubKey = getStoredPublicKey();
  if (!pubKey) {
    return { ok: false, error: 'Device has not yet connected to homebase. Please connect to the internet briefly.' };
  }
  const verified = verifyToken(token, pubKey);
  if (!verified) {
    return { ok: false, error: 'Invalid or corrupted activation key.' };
  }
  const expectedDeviceId = getDeviceId();
  if (expectedDeviceId && verified.deviceId !== expectedDeviceId) {
    return { ok: false, error: 'This activation key is for a different device.' };
  }
  if (verified.expiresAt && verified.expiresAt < Date.now()) {
    return { ok: false, error: 'This activation key has expired.' };
  }
  localStorage.setItem(LS_MANUAL_TOKEN, token);
  localStorage.setItem(LS_TOKEN, token);
  if (!localStorage.getItem(LS_FIRST_TOKEN_AT)) {
    localStorage.setItem(LS_FIRST_TOKEN_AT, String(Date.now()));
  }
  localStorage.removeItem(LS_AUTO_COUNTDOWN_AT);
  notify();
  return { ok: true, expiresAt: verified.expiresAt };
}

export function getLicenseState() {
  let firstTokenAt = parseInt(localStorage.getItem(LS_FIRST_TOKEN_AT) || '0', 10);
  const lastContact = parseInt(localStorage.getItem(LS_LAST_CONTACT) || '0', 10);
  const autoCountdownAt = parseInt(localStorage.getItem(LS_AUTO_COUNTDOWN_AT) || '0', 10);
  const tokenStr = localStorage.getItem(LS_TOKEN) || '';
  const pubKey = getStoredPublicKey();
  const deviceId = getDeviceId();
  const now = Date.now();

  // Tamper-resistant: if device is fleet-registered (has device_id), it has been
  // licensed at least once. Clearing first_token_at alone resets the clock to "now"
  // which still triggers the 30+30 day no-contact lockout — not an indefinite bypass.
  if (!firstTokenAt) {
    if (deviceId) {
      firstTokenAt = now;
      localStorage.setItem(LS_FIRST_TOKEN_AT, String(firstTokenAt));
    } else {
      return { mode: 'free', reason: 'never_licensed' };
    }
  }

  let token = null;
  if (tokenStr && pubKey) {
    token = verifyToken(tokenStr, pubKey);
    const expectedDeviceId = getDeviceId();
    if (token && expectedDeviceId && token.deviceId !== expectedDeviceId) {
      token = null;
    }
  }

  if (token && token.status === 'suspended') {
    return { mode: 'suspended', reason: 'revoked', token };
  }

  if (token && token.status === 'countdown') {
    const remaining = (token.expiresAt || 0) - now;
    if (remaining <= 0) {
      return { mode: 'suspended', reason: 'countdown_expired', token };
    }
    return { mode: 'countdown', remainingMs: remaining, expiresAt: token.expiresAt, token };
  }

  const sinceContact = lastContact ? now - lastContact : 0;
  if (lastContact && sinceContact > NO_CONTACT_GRACE_MS) {
    let countdownStart = autoCountdownAt;
    if (!countdownStart) {
      countdownStart = now;
      localStorage.setItem(LS_AUTO_COUNTDOWN_AT, String(countdownStart));
    }
    const expiresAt = countdownStart + COUNTDOWN_MS;
    const remaining = expiresAt - now;
    if (remaining <= 0) {
      return { mode: 'suspended', reason: 'no_contact', token };
    }
    return { mode: 'countdown', remainingMs: remaining, expiresAt, reason: 'no_contact', token };
  }

  return { mode: 'active', token };
}

export function clearLicenseState() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_FIRST_TOKEN_AT);
  localStorage.removeItem(LS_LAST_CONTACT);
  localStorage.removeItem(LS_AUTO_COUNTDOWN_AT);
  localStorage.removeItem(LS_MANUAL_TOKEN);
  notify();
}

let pollInterval = null;
export function startLicensePolling(intervalMs = 60 * 60 * 1000) {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(notify, intervalMs);
}
