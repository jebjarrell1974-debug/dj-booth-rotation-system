// Trusted workspace control state, never read from a delivered release.
import { constants, openSync, closeSync, fstatSync, fsyncSync, readFileSync,
  writeFileSync, renameSync, unlinkSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, sep, isAbsolute } from 'node:path';
import { randomUUID, createHash, verify } from 'node:crypto';
import { readTrustPolicy, validateTrustPolicy, readProducerEvidence } from '../../artifacts/api-server/server/frontend-producer-auth.js';

const check = (ok, message) => { if (!ok) throw new Error(`Workspace release order refused: ${message}`); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const UUID = /^[a-f0-9-]{36}$/;
const HASH = /^[a-f0-9]{64}$/;
export const ROLLBACK_DOMAIN = 'NEON-FRONTEND-ROLLBACK-ED25519-V1\0';

function controlledPath(file, excludedRoots) {
  check(typeof file === 'string' && isAbsolute(file), 'supply an absolute independent --release-state path');
  const parent = realpathSync(dirname(file));
  check(parent === dirname(file), 'state parent must not contain symlinks');
  for (let dir = parent;; dir = dirname(dir)) {
    const stat = lstatSync(dir);
    check(stat.isDirectory() && !stat.isSymbolicLink() &&
      ((stat.mode & 0o022) === 0 || (stat.uid === 0 && (stat.mode & 0o1000) !== 0)) &&
      (!process.getuid || stat.uid === process.getuid() || stat.uid === 0),
    'state parents must be operator-owned and not group/world writable');
    if (dir === dirname(dir)) break;
  }
  for (const root of excludedRoots) {
    const rel = relative(existsSync(root) ? realpathSync(root) : resolve(root), file);
    check(rel !== '' && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)),
      'state must be outside the workspace and pending delivery');
  }
}
function readState(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    check(stat.isFile() && stat.size <= 8 * 1024 * 1024 && (stat.mode & 0o077) === 0 &&
      (!process.getuid || stat.uid === process.getuid()), 'state must be a bounded owner-only regular file');
    const state = JSON.parse(readFileSync(fd, 'utf8'));
    check(state.schema === 1 && UUID.test(state.workspaceId) && Number.isSafeInteger(state.next) &&
      state.next > 0 && Array.isArray(state.entries) && state.entries.length === state.next - 1,
    'invalid/missing ordering history; never reset it to bypass a refusal');
    for (const [i, e] of state.entries.entries()) {
      check(e.sequence === i + 1 && UUID.test(e.nonce) &&
        ['release', 'rollback'].includes(e.kind) && ['reserved', 'ready', 'applying', 'applied'].includes(e.status),
      'invalid ordering entry');
    }
    check(state.current === null || (HASH.test(state.current.manifestSha256) &&
      state.entries.some(e => e.sequence === state.current.sequence && e.status === 'applied')),
    'invalid installed workspace head');
    return state;
  } finally { closeSync(fd); }
}
function save(file, state) {
  const temp = file + '.' + randomUUID() + '.tmp';
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { writeFileSync(fd, JSON.stringify(state) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temp, file);
  const parent = openSync(dirname(file), constants.O_RDONLY);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
export function initializeReleaseState(file, workspaceRoot) {
  controlledPath(file, [workspaceRoot]);
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, JSON.stringify({ schema: 1, workspaceId: randomUUID(), next: 1, current: null, entries: [] }) + '\n');
    fsyncSync(fd);
  } finally { closeSync(fd); }
}
export function withReleaseState(file, excludedRoots, action) {
  controlledPath(file, excludedRoots);
  const lock = file + '.lock';
  let fd;
  try { fd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { throw new Error('Workspace release order refused: busy/interrupted state lock; inspect before recovery'); }
  try {
    const state = readState(file);
    check(!state.entries.some(e => e.status === 'applying'), 'interrupted installation needs independent reconciliation');
    return action(state, () => save(file, state));
  } finally { closeSync(fd); unlinkSync(lock); }
}
export function reserveRelease(state, persist, kind = 'release') {
  const entry = { sequence: state.next++, nonce: randomUUID(), kind, status: 'reserved' };
  state.entries.push(entry); persist();
  return entry;
}
export function releaseOrder(state, entry) {
  return { workspaceId: state.workspaceId, sequence: entry.sequence, nonce: entry.nonce };
}
export function registerRelease(state, persist, entry, manifestBytes, pending, request) {
  entry.manifestSha256 = sha(manifestBytes);
  entry.pending = resolve(pending);
  entry.request = request ? resolve(request) : null;
  entry.requestSha256 = request ? sha(readProducerEvidence(entry.request, 4 * 1024 * 1024)) : null;
  entry.status = 'ready'; persist();
}
export function assertLatestRelease(state, manifestBytes, pending, rollbackPayload) {
  const entry = state.entries.at(-1);
  check(entry?.status === 'ready', 'latest request is unavailable or already consumed');
  check(entry.manifestSha256 === sha(manifestBytes) && entry.pending === resolve(pending),
    'stale or unregistered approval');
  if (entry.kind === 'release') {
    check(!rollbackPayload, 'rollback approval cannot authorize a normal release');
    check(JSON.stringify(JSON.parse(manifestBytes).releaseOrder) === JSON.stringify(releaseOrder(state, entry)),
      'manifest order does not match independently reserved order');
  } else {
    check(rollbackPayload && JSON.stringify(rollbackPayload) === JSON.stringify(entry.rollbackPayload) &&
      rollbackPayload.fromSequence === state.current?.sequence &&
      rollbackPayload.fromManifestSha256 === state.current?.manifestSha256,
    'separate rollback authorization for the current head is required');
  }
  return entry;
}
export function applyOrderedRelease(state, persist, entry, install) {
  // Persist intent before dist replacement. A crash or failed install blocks
  // further use instead of reopening a replay window.
  entry.status = 'applying'; persist();
  install();
  state.current = { sequence: entry.sequence, manifestSha256: entry.manifestSha256 };
  entry.status = 'applied'; persist();
}
export function rollbackSigningBytes(payload) {
  const names = ['schema', 'scope', 'algorithm', 'keyId', 'workspaceId', 'sequence', 'nonce',
    'fromSequence', 'fromManifestSha256', 'targetManifestSha256', 'reason'];
  check(payload && Object.keys(payload).sort().join('|') === [...names].sort().join('|') &&
    payload.schema === 1 && payload.scope === 'frontend-workspace-rollback' && payload.algorithm === 'Ed25519' &&
    /^sha256:[a-f0-9]{64}$/.test(payload.keyId) && UUID.test(payload.workspaceId) && UUID.test(payload.nonce) &&
    Number.isSafeInteger(payload.sequence) && payload.sequence > 0 &&
    Number.isSafeInteger(payload.fromSequence) && payload.fromSequence > 0 &&
    HASH.test(payload.fromManifestSha256) && HASH.test(payload.targetManifestSha256) &&
    typeof payload.reason === 'string' && payload.reason.trim().length > 0 && payload.reason.length <= 1000,
  'invalid rollback payload');
  return Buffer.from(ROLLBACK_DOMAIN + JSON.stringify(Object.fromEntries(names.map(n => [n, payload[n]]))));
}
export function authenticateRollback(bytes, policyPath, excludedRoots) {
  const evidence = JSON.parse(bytes);
  const { signature, ...payload } = evidence;
  check(String(bytes).trim() === JSON.stringify(evidence), 'noncanonical rollback evidence');
  const signing = rollbackSigningBytes(payload);
  const trusted = validateTrustPolicy(readTrustPolicy(policyPath, excludedRoots)).get(payload.keyId);
  check(trusted?.status === 'active', 'rollback key is not independently active');
  const raw = Buffer.from(signature || '', 'base64');
  check(raw.length === 64 && raw.toString('base64') === signature &&
    verify(null, signing, trusted.key, raw), 'invalid separate rollback signature');
  return payload;
}
export function latestSigningRequest(file, workspaceRoot) {
  return withReleaseState(file, [workspaceRoot], state => {
    const entry = state.entries.at(-1);
    check(entry?.status === 'ready', 'no latest outstanding signing request');
    check(entry.request, 'latest release has no downloadable request');
    const bytes = readProducerEvidence(entry.request, 4 * 1024 * 1024);
    check(sha(bytes) === entry.requestSha256, 'signing request changed after registration');
    const request = JSON.parse(bytes);
    if (entry.kind === 'release') {
      const manifest = Buffer.from(request.manifestBase64, 'base64');
      assertLatestRelease(state, manifest, entry.pending);
      check(JSON.stringify(request.payload) !== undefined &&
        request.payload.manifestSha256 === entry.manifestSha256, 'request digest mismatch');
    } else {
      check(JSON.stringify(request.payload) === JSON.stringify(entry.rollbackPayload),
        'rollback request does not match the ledger');
    }
    return bytes;
  });
}
