// Trusted verifier code. No private key material is loaded by this module.
import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { constants, existsSync, lstatSync, openSync, closeSync, fstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const PRODUCER_SCOPE = 'frontend-boot-assets';
const DOMAIN = 'NEON-FRONTEND-PRODUCER-ED25519-V1\0';
const SHA = /^[a-f0-9]{64}$/;
const KEY_ID = /^sha256:[a-f0-9]{64}$/;
const FIELDS = ['schema', 'scope', 'algorithm', 'keyId', 'manifestSha256', 'signature'];
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
function refuse(message) {
  const error = new Error(`Producer authentication refused: ${message}`);
  error.code = 'FRONTEND_PRODUCER_AUTH_FAILED';
  throw error;
}
function check(ok, message) { if (!ok) refuse(message); }
export function readProducerEvidence(file, maxBytes) {
  const stat = lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxBytes,
    'missing, symlink or oversized evidence file');
  return readFileSync(file);
}
function exactFields(value, fields, label) {
  check(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...fields].sort().join('|'), `unsupported ${label} fields`);
}
function publicKey(pem) {
  check(typeof pem === 'string' && pem.startsWith('-----BEGIN PUBLIC KEY-----') &&
    !pem.includes('PRIVATE KEY'), 'only public SPKI keys are allowed');
  let key;
  try { key = createPublicKey(pem); } catch { refuse('invalid pinned public key'); }
  check(key.asymmetricKeyType === 'ed25519', 'only Ed25519 keys are supported');
  return key;
}
export function publicKeyId(pem) {
  return `sha256:${hashBytes(publicKey(pem).export({ type: 'spki', format: 'der' }))}`;
}
export function validateTrustPolicy(policy) {
  exactFields(policy, ['schema', 'scope', 'keys'], 'trust policy');
  check(policy.schema === 1 && policy.scope === PRODUCER_SCOPE &&
    Array.isArray(policy.keys) && policy.keys.length <= 32, 'unsupported trust policy');
  const keys = new Map();
  for (const entry of policy.keys) {
    exactFields(entry, ['keyId', 'publicKey', 'status'], 'trust key');
    check(KEY_ID.test(entry.keyId) && ['active', 'retired', 'revoked'].includes(entry.status),
      'invalid trust key identity/status');
    check(!keys.has(entry.keyId), 'duplicate trust key');
    check(publicKeyId(entry.publicKey) === entry.keyId, 'pinned key fingerprint mismatch');
    keys.set(entry.keyId, { key: publicKey(entry.publicKey), status: entry.status });
  }
  check([...keys.values()].some(key => key.status === 'active'), 'no active pinned trust keys');
  return keys;
}

// A policy inside the delivery is NOT an independent trust anchor. Read one
// operator-owned regular file once; never use keys claimed by an attestation.
export function readTrustPolicy(file, excludedRoots = []) {
  check(typeof file === 'string' && file.length > 0, 'independent trust policy is required');
  let fd;
  try {
    check(!lstatSync(file).isSymbolicLink(), 'trust policy symlink refused');
    const actual = realpathSync(file);
    for (const root of excludedRoots) {
      const base = existsSync(root) ? realpathSync(root) : resolve(root);
      const rel = relative(base, actual);
      check(rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)),
        'trust policy must be outside the delivery/application tree');
    }
    fd = openSync(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    check(stat.isFile() && stat.size <= 1024 * 1024, 'invalid trust policy file');
    check((stat.mode & 0o022) === 0, 'group/world-writable trust policy refused');
    if (process.getuid) check(stat.uid === 0 || stat.uid === process.getuid(), 'trust policy has an unexpected owner');
    const policy = JSON.parse(readFileSync(fd, 'utf8'));
    validateTrustPolicy(policy);
    return policy;
  } catch (error) {
    if (error.code === 'FRONTEND_PRODUCER_AUTH_FAILED') throw error;
    refuse('trust policy is missing or unreadable/invalid');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function signingPayload(manifestBytes, keyId) {
  check(KEY_ID.test(keyId), 'invalid signing key fingerprint');
  return { schema: 1, scope: PRODUCER_SCOPE, algorithm: 'Ed25519',
    keyId, manifestSha256: hashBytes(manifestBytes) };
}
export function signingBytes(payload) {
  return Buffer.from(DOMAIN + JSON.stringify({
    schema: payload.schema, scope: payload.scope, algorithm: payload.algorithm,
    keyId: payload.keyId, manifestSha256: payload.manifestSha256,
  }));
}
// Useful to an independently managed signer, and ephemeral test keys. Private
// keys are supplied in memory by its caller, never read from disk or environment.
export function signProducerManifest(manifestBytes, keyId, privateKey) {
  const payload = signingPayload(manifestBytes, keyId);
  return { ...payload, signature: sign(null, signingBytes(payload), privateKey).toString('base64') };
}
export function authenticateProducer(manifestBytes, attestationBytes, policy) {
  check(Buffer.byteLength(manifestBytes) <= 2 * 1024 * 1024, 'manifest is too large');
  check(attestationBytes && Buffer.byteLength(attestationBytes) <= 16384, 'missing/oversized signed evidence');
  let evidence;
  try { evidence = JSON.parse(String(attestationBytes)); } catch { refuse('malformed signed evidence'); }
  exactFields(evidence, FIELDS, 'signed evidence');
  // Compact canonical evidence also rejects duplicate JSON keys and ambiguous encodings.
  check(String(attestationBytes).trim() === JSON.stringify(evidence), 'noncanonical/ambiguous signed evidence');
  check(evidence.schema === 1 && evidence.scope === PRODUCER_SCOPE &&
    evidence.algorithm === 'Ed25519' && KEY_ID.test(evidence.keyId) &&
    SHA.test(evidence.manifestSha256), 'unsupported signature schema/scope/algorithm');
  check(evidence.manifestSha256 === hashBytes(manifestBytes), 'signed manifest digest mismatch');
  const trusted = validateTrustPolicy(policy).get(evidence.keyId);
  check(trusted && trusted.status === 'active', 'unknown, retired or revoked signing key');
  check(typeof evidence.signature === 'string', 'invalid signature');
  const signature = Buffer.from(evidence.signature, 'base64');
  check(signature.length === 64 && signature.toString('base64') === evidence.signature, 'invalid signature encoding');
  check(verify(null, signingBytes(evidence), trusted.key, signature), 'invalid producer signature');
  return { authenticated: true, scope: PRODUCER_SCOPE, keyId: evidence.keyId,
    manifestSha256: evidence.manifestSha256 };
}
