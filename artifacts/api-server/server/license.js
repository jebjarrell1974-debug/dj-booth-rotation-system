import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(__dirname, '..', 'license-keys.json');

const COUNTDOWN_DAYS = 30;
const COUNTDOWN_MS = COUNTDOWN_DAYS * 24 * 60 * 60 * 1000;

let cachedKeys = null;

function loadOrGenerateKeys() {
  if (cachedKeys) return cachedKeys;

  const envPriv = process.env.LICENSE_PRIVATE_KEY;
  const envPub = process.env.LICENSE_PUBLIC_KEY;
  if (envPriv && envPub) {
    cachedKeys = { privateKey: envPriv, publicKey: envPub };
    return cachedKeys;
  }

  if (fs.existsSync(KEY_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
      if (data.privateKey && data.publicKey) {
        cachedKeys = data;
        return cachedKeys;
      }
    } catch {}
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  cachedKeys = { privateKey: privPem, publicKey: pubPem };

  try {
    fs.writeFileSync(KEY_FILE, JSON.stringify(cachedKeys, null, 2), { mode: 0o600 });
    console.log('[license] Generated new Ed25519 keypair, saved to license-keys.json');
  } catch (err) {
    console.warn('[license] Failed to persist keypair:', err.message);
  }
  return cachedKeys;
}

export function getPublicKey() {
  return loadOrGenerateKeys().publicKey;
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signLicenseToken(payload) {
  const { privateKey } = loadOrGenerateKeys();
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64url(payloadJson);
  const signature = crypto.sign(null, Buffer.from(payloadB64), privateKey);
  return `${payloadB64}.${base64url(signature)}`;
}

export function verifyLicenseToken(token) {
  try {
    const [payloadB64, sigB64] = token.split('.');
    if (!payloadB64 || !sigB64) return null;
    const { publicKey } = loadOrGenerateKeys();
    const ok = crypto.verify(null, Buffer.from(payloadB64), publicKey, fromBase64url(sigB64));
    if (!ok) return null;
    return JSON.parse(fromBase64url(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
}

export function buildLicensePayload(device, opts = {}) {
  const status = device.license_status || 'active';
  const now = Date.now();

  if (status === 'active') {
    return {
      v: 1,
      deviceId: device.device_id,
      status: 'active',
      issuedAt: now,
      expiresAt: now + COUNTDOWN_MS,
      type: opts.type || 'auto',
    };
  }

  if (status === 'countdown') {
    const expiresAt = device.license_expires_at || (now + COUNTDOWN_MS);
    return {
      v: 1,
      deviceId: device.device_id,
      status: 'countdown',
      issuedAt: now,
      expiresAt,
      initiatedAt: device.license_initiated_at || now,
      type: opts.type || 'auto',
    };
  }

  if (status === 'suspended') {
    return {
      v: 1,
      deviceId: device.device_id,
      status: 'suspended',
      issuedAt: now,
      expiresAt: now,
      type: opts.type || 'auto',
    };
  }

  return null;
}

export function generateManualKey(device) {
  const now = Date.now();
  const payload = {
    v: 1,
    deviceId: device.device_id,
    status: 'active',
    issuedAt: now,
    expiresAt: now + COUNTDOWN_MS,
    type: 'manual',
  };
  return signLicenseToken(payload);
}

export const LICENSE_COUNTDOWN_MS = COUNTDOWN_MS;
export const LICENSE_COUNTDOWN_DAYS = COUNTDOWN_DAYS;
