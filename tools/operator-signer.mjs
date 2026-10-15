// Standalone operator-side tool: Node built-ins only, no network and no package install.
// Never run real key creation in Replit. Only public pins/signatures leave this host.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, fstatSync, fsyncSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';

const SCOPE = 'frontend-boot-assets';
const DOMAIN = 'NEON-FRONTEND-PRODUCER-ED25519-V1\0';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function check(ok, message) { if (!ok) throw new Error(message); }
function fields(value, names) {
  check(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...names].sort().join('|'), 'Unsupported request fields');
}
function keyId(publicKey) {
  return 'sha256:' + sha(publicKey.export({ type: 'spki', format: 'der' }));
}
function base64(value, limit) {
  check(typeof value === 'string' && value.length <= Math.ceil(limit / 3) * 4, 'Oversized/invalid request encoding');
  const bytes = Buffer.from(value, 'base64');
  check(bytes.length <= limit && bytes.toString('base64') === value, 'Noncanonical request encoding');
  return bytes;
}
export function validateRequest(request) {
  fields(request, ['schema', 'payload', 'manifestBase64', 'signingBytesBase64']);
  fields(request.payload, ['schema', 'scope', 'algorithm', 'keyId', 'manifestSha256']);
  const p = request.payload;
  check(request.schema === 1 && p.schema === 1 && p.scope === SCOPE && p.algorithm === 'Ed25519' &&
    /^sha256:[a-f0-9]{64}$/.test(p.keyId) && /^[a-f0-9]{64}$/.test(p.manifestSha256), 'Unsupported signing identity/scope');
  const manifestBytes = base64(request.manifestBase64, 2 * 1024 * 1024);
  check(sha(manifestBytes) === p.manifestSha256, 'Manifest digest does not match request');
  const manifest = JSON.parse(manifestBytes);
  fields(manifest, ['schema', 'scope', 'build', 'environment', 'dependencies', 'inputs', 'bootAssets',
    ...(manifest.releaseOrder ? ['releaseOrder'] : [])]);
  if (manifest.releaseOrder) {
    fields(manifest.releaseOrder, ['workspaceId', 'sequence', 'nonce']);
    check(/^[a-f0-9-]{36}$/.test(manifest.releaseOrder.workspaceId) &&
      /^[a-f0-9-]{36}$/.test(manifest.releaseOrder.nonce) &&
      Number.isSafeInteger(manifest.releaseOrder.sequence) && manifest.releaseOrder.sequence > 0,
    'Invalid workspace release order');
    check(Object.hasOwn(manifest.inputs || {}, 'scripts/src/workspace-release-order.mjs'),
      'Missing workspace ordering tool input');
  }
  check(manifest.schema === 1 && manifest.scope === SCOPE &&
    manifest.build?.command === 'build:homebase' &&
    manifest.build?.config === 'artifacts/dj-booth/homebase-vite.config.js',
  'Not a supported frontend release request');
  for (const inventory of [manifest.inputs, manifest.bootAssets]) {
    check(inventory && typeof inventory === 'object' && !Array.isArray(inventory) && Object.keys(inventory).length,
      'Missing frontend inventory');
    for (const [name, digest] of Object.entries(inventory)) {
      check(name && !name.startsWith('/') && !name.includes('\\') &&
        name.split('/').every(part => part && part !== '.' && part !== '..') &&
        /^[a-f0-9]{64}$/.test(digest), 'Unsafe inventory entry');
      check(!/(?:^|\/)(?:\.env[^/]*|music|voiceovers|license-keys\.json)(?:\/|$)|\.(?:pem|key|db|sqlite|sh)$/i.test(name),
        'Private/runtime material cannot be a frontend signing input');
    }
  }
  for (const required of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.gitignore', '.replitignore',
    '.npmrc', 'tsconfig.json', 'tsconfig.base.json', 'scripts/src/frontend-producer.mjs',
    'artifacts/api-server/server/frontend-producer-auth.js', 'artifacts/dj-booth/package.json',
    'artifacts/dj-booth/index.html', 'artifacts/dj-booth/homebase-vite.config.js']) {
    check(Object.hasOwn(manifest.inputs, required), 'Missing required producer input');
  }
  const boot = Object.keys(manifest.bootAssets);
  check(boot.includes('index.html') && boot.some(n => n.startsWith('assets/') && n.endsWith('.js')) &&
    boot.some(n => n.startsWith('assets/') && n.endsWith('.css')) &&
    boot.every(n => n === 'index.html' || n.startsWith('assets/')), 'Incomplete/out-of-scope boot inventory');
  check(manifest.environment && manifest.dependencies && Object.keys(manifest.dependencies).length,
    'Missing build evidence');
  const payload = { schema: 1, scope: SCOPE, algorithm: 'Ed25519', keyId: p.keyId, manifestSha256: p.manifestSha256 };
  const bytes = Buffer.from(DOMAIN + JSON.stringify(payload));
  check(bytes.equals(base64(request.signingBytesBase64, 4096)), 'Signing bytes do not match the supported protocol');
  return { payload, manifest, bytes };
}
export function createEncryptedKey(passphrase) {
  check(typeof passphrase === 'string' && passphrase.length >= 24, 'Use a strong passphrase of at least 24 characters');
  const pair = generateKeyPairSync('ed25519');
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const encryptedPem = pair.privateKey.export({
    type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase,
  });
  return { encryptedPem, publicPem, keyId: keyId(pair.publicKey) };
}
export function signRequest(request, encryptedPem, passphrase) {
  const checked = validateRequest(request);
  const privateKey = unlockKey(encryptedPem, passphrase);
  check(keyId(createPublicKey(privateKey)) === checked.payload.keyId, 'This key does not own the requested fingerprint');
  return { ...checked.payload, signature: sign(null, checked.bytes, privateKey).toString('base64') };
}
// Separate authorization domain. Frontend approval never implies archive approval.
export function validateArchiveSet(request, archives) {
  fields(request, ['schema', 'scope', 'archives']);
  check(request.schema === 1 && request.scope === 'whole-release-archive-set' &&
    Array.isArray(request.archives) && request.archives.length > 0 && request.archives.length <= 2,
  'Unsupported whole-release request');
  const names = new Set(), layouts = new Set(), identities = new Set(), releases = new Set();
  const checked = request.archives.map(row => {
    fields(row, ['filename', 'payload', 'signingBytesBase64']);
    fields(row.payload, ['schema', 'scope', 'algorithm', 'keyId', 'archiveSha256', 'size', 'layout', 'releaseId']);
    const p = row.payload;
    check(p.schema === 1 && p.scope === 'whole-release-archive' && p.algorithm === 'Ed25519' &&
      /^sha256:[a-f0-9]{64}$/.test(p.keyId) && /^[a-f0-9]{64}$/.test(p.archiveSha256) &&
      Number.isSafeInteger(p.size) && p.size > 0 && p.size <= 512 * 1024 * 1024 &&
      ['flat', 'github'].includes(p.layout) && typeof p.releaseId === 'string' &&
      /^[A-Za-z0-9._-]{1,128}$/.test(p.releaseId), 'Unsupported archive identity/scope');
    const expectedName = p.layout === 'flat' ? 'djbooth-flat-release.tar.gz' : 'djbooth-release.tar.gz';
    check(row.filename === expectedName && !names.has(row.filename) && !layouts.has(p.layout),
      'Unexpected/duplicate archive filename or layout');
    names.add(row.filename); layouts.add(p.layout); identities.add(p.keyId); releases.add(p.releaseId);
    const payload = Object.fromEntries(
      ['schema', 'scope', 'algorithm', 'keyId', 'archiveSha256', 'size', 'layout', 'releaseId'].map(name => [name, p[name]]));
    const bytes = Buffer.from('NEON-INSTALLER-RELEASE-ED25519-V1\0' + JSON.stringify(payload));
    check(bytes.equals(base64(row.signingBytesBase64, 4096)), 'Archive signing bytes mismatch');
    const archive = archives?.[row.filename];
    check(Buffer.isBuffer(archive) && archive.length === p.size && sha(archive) === p.archiveSha256,
      'Actual archive bytes do not match the reviewed request');
    return { filename: row.filename, payload, bytes };
  });
  check(identities.size === 1 && releases.size === 1, 'Mixed signing keys or releases are not allowed');
  check(archives && Object.keys(archives).sort().join('|') === [...names].sort().join('|'),
    'Missing/unexpected supplied archives');
  return checked;
}
export function signArchiveSet(request, archives, encryptedPem, passphrase) {
  const checked = validateArchiveSet(request, archives);
  const privateKey = unlockKey(encryptedPem, passphrase);
  check(checked.every(row => keyId(createPublicKey(privateKey)) === row.payload.keyId),
    'This key does not own the requested archive fingerprint');
  return { schema: 1, scope: 'whole-release-signature-set', archives: checked.map(row => ({
    filename: row.filename,
    evidence: { ...row.payload, signature: sign(null, row.bytes, privateKey).toString('base64') },
  })) };
}
export function validateRollbackRequest(request) {
  fields(request, ['schema', 'payload', 'signingBytesBase64']);
  const names = ['schema', 'scope', 'algorithm', 'keyId', 'workspaceId', 'sequence', 'nonce',
    'fromSequence', 'fromManifestSha256', 'targetManifestSha256', 'reason'];
  fields(request.payload, names);
  const p = request.payload;
  check(request.schema === 1 && p.schema === 1 && p.scope === 'frontend-workspace-rollback' &&
    p.algorithm === 'Ed25519' && /^sha256:[a-f0-9]{64}$/.test(p.keyId) &&
    /^[a-f0-9-]{36}$/.test(p.workspaceId) && /^[a-f0-9-]{36}$/.test(p.nonce) &&
    Number.isSafeInteger(p.sequence) && p.sequence > 0 &&
    Number.isSafeInteger(p.fromSequence) && p.fromSequence > 0 &&
    /^[a-f0-9]{64}$/.test(p.fromManifestSha256) && /^[a-f0-9]{64}$/.test(p.targetManifestSha256) &&
    typeof p.reason === 'string' && p.reason.trim().length > 0 && p.reason.length <= 1000,
  'Unsupported explicit rollback request');
  const payload = Object.fromEntries(names.map(n => [n, p[n]]));
  const bytes = Buffer.from('NEON-FRONTEND-ROLLBACK-ED25519-V1\0' + JSON.stringify(payload));
  check(bytes.equals(base64(request.signingBytesBase64, 4096)), 'Rollback signing bytes mismatch');
  return { payload, bytes };
}
export function signRollbackRequest(request, encryptedPem, passphrase) {
  const checked = validateRollbackRequest(request);
  const privateKey = unlockKey(encryptedPem, passphrase);
  check(keyId(createPublicKey(privateKey)) === checked.payload.keyId, 'This key does not own the requested fingerprint');
  return { ...checked.payload, signature: sign(null, checked.bytes, privateKey).toString('base64') };
}
function unlockKey(encryptedPem, passphrase) {
  check(/^-----BEGIN ENCRYPTED PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END ENCRYPTED PRIVATE KEY-----\r?\n?$/.test(String(encryptedPem)),
    'Only an encrypted PKCS8 private key is accepted');
  let privateKey;
  try { privateKey = createPrivateKey({ key: encryptedPem, passphrase }); }
  catch { throw new Error('Could not unlock the encrypted key; check the passphrase'); }
  check(privateKey.asymmetricKeyType === 'ed25519', 'Only an Ed25519 key is accepted');
  return privateKey;
}
function readRegular(file, limit, privateFile = false) {
  const before = lstatSync(file);
  check(before.isFile() && !before.isSymbolicLink(), 'Invalid/symlink/oversized input file');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    check(stat.isFile() && stat.size <= limit && stat.ino === before.ino && stat.dev === before.dev,
      'Invalid/changed/oversized input file');
    if (privateFile && process.platform !== 'win32') {
      check((stat.mode & 0o077) === 0 && stat.uid === process.getuid(), 'Private key must be owner-only (chmod 600)');
    }
    const bytes = readFileSync(fd);
    check(bytes.length <= limit, 'Oversized input file');
    return bytes;
  } finally { closeSync(fd); }
}
function writeNew(file, bytes) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function ensureKeyDirectory(directory) {
  directory = resolve(directory);
  const toolDir = dirname(fileURLToPath(import.meta.url));
  const rel = relative(toolDir, directory);
  check(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel),
    'Keep the key outside the downloaded tool folder');
  for (let current = directory;; current = dirname(current)) {
    check(!existsSync(join(current, '.git')), 'Never create the key inside a Git checkout');
    if (current === dirname(current)) break;
  }
  if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
  const stat = lstatSync(directory);
  check(stat.isDirectory() && !stat.isSymbolicLink(), 'Key directory must not be a symlink');
  if (process.platform !== 'win32') {
    check((stat.mode & 0o077) === 0 && stat.uid === process.getuid(), 'Key directory must be owner-only (chmod 700)');
  }
  return directory;
}
// Recovery writes only inside a newly reserved directory. No recursive copy,
// overwrite, key generation, cleanup/delete, network, or verifier-policy updates.
const BACKUP_FILES = ['private-key.pem', 'public-key.pem', 'fingerprint.txt', 'recovery.json'];
function storagePath(directory) {
  directory = resolve(directory);
  const toolDir = dirname(fileURLToPath(import.meta.url));
  const rel = relative(toolDir, directory);
  check(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel),
    'Keep private storage outside the downloaded tool folder');
  for (let current = directory;; current = dirname(current)) {
    try {
      const stat = lstatSync(current);
      check(stat.isDirectory() && !stat.isSymbolicLink(), 'Storage path must contain only real directories, not symlinks');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    check(!existsSync(join(current, '.git')), 'Never store private material inside a Git checkout');
    if (current === dirname(current)) break;
  }
  return directory;
}
function requireFreshDirectory(directory) {
  directory = storagePath(directory);
  try {
    lstatSync(directory);
    throw new Error('Destination already exists; never overwrite or silently rotate keys. Choose a fresh directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  check(lstatSync(dirname(directory)).isDirectory(), 'Destination parent must already exist');
  return directory;
}
function checkExpectedId(expectedKeyId) {
  check(typeof expectedKeyId === 'string' && /^sha256:[a-f0-9]{64}$/.test(expectedKeyId),
    'Supply --key-id with the independently retained approved public fingerprint');
}
function checkKeyMaterial(encrypted, publicPem, fingerprint, passphrase, expectedKeyId) {
  checkExpectedId(expectedKeyId);
  const privateKey = unlockKey(encrypted, passphrase);
  const publicKey = createPublicKey(privateKey);
  const actualId = keyId(publicKey);
  check(/^-----BEGIN PUBLIC KEY-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END PUBLIC KEY-----\r?\n?$/.test(String(publicPem)),
    'Only one public SPKI key is accepted; no appended material');
  const suppliedPublic = createPublicKey(publicPem);
  check(actualId === expectedKeyId && suppliedPublic.asymmetricKeyType === 'ed25519' &&
    keyId(suppliedPublic) === actualId && fingerprint.toString() === actualId + '\n',
  'Key/backup does not match the independently approved fingerprint');
  return actualId;
}
function writeRecoveryDirectory(directory, files) {
  // mkdir is exclusive even if a second process won the race after preflight.
  mkdirSync(directory, { mode: 0o700 });
  try {
    for (const [name, bytes] of Object.entries(files)) writeNew(join(directory, name), bytes);
    // Detect failed/incomplete media writes before reporting success.
    for (const [name, bytes] of Object.entries(files)) {
      check(readRegular(join(directory, name), 16384).equals(Buffer.from(bytes)), 'Recovery write verification failed');
    }
  } catch {
    throw new Error('Recovery write failed; destination may be incomplete. No existing data was changed. Keep it for inspection and retry in a fresh directory');
  }
}
export function backupEncryptedKey({ directory, backupDirectory, expectedKeyId, passphrase }) {
  checkExpectedId(expectedKeyId);
  const source = storagePath(directory);
  // Source is the local owner-private key folder, not a removable-media copy.
  check(lstatSync(source).isDirectory(), 'Local key directory must already exist');
  ensureKeyDirectory(source);
  const destination = requireFreshDirectory(backupDirectory);
  const encrypted = readRegular(join(source, 'private-key.pem'), 16384, true);
  const publicPem = readRegular(join(source, 'public-key.pem'), 16384);
  const fingerprint = readRegular(join(source, 'fingerprint.txt'), 256);
  const actualId = checkKeyMaterial(encrypted, publicPem, fingerprint, passphrase, expectedKeyId);
  const recovery = { schema: 1, scope: SCOPE, keyId: actualId,
    privateSha256: sha(encrypted), publicSha256: sha(publicPem) };
  writeRecoveryDirectory(destination, {
    'private-key.pem': encrypted, 'public-key.pem': publicPem, 'fingerprint.txt': fingerprint,
    'recovery.json': JSON.stringify(recovery, null, 2) + '\n',
  });
  return { keyId: actualId, directory: destination };
}
export function restoreEncryptedKey({ directory, backupDirectory, expectedKeyId, passphrase }) {
  checkExpectedId(expectedKeyId);
  const destination = requireFreshDirectory(directory);
  const source = storagePath(backupDirectory);
  check(readdirSync(source).sort().join('|') === [...BACKUP_FILES].sort().join('|'),
    'Incomplete/unexpected backup files; restore only a dedicated signer backup');
  // FAT/exFAT may not enforce POSIX permissions; only encrypted bytes are read.
  const encrypted = readRegular(join(source, 'private-key.pem'), 16384);
  const publicPem = readRegular(join(source, 'public-key.pem'), 16384);
  const fingerprint = readRegular(join(source, 'fingerprint.txt'), 256);
  const recovery = JSON.parse(readRegular(join(source, 'recovery.json'), 4096));
  fields(recovery, ['schema', 'scope', 'keyId', 'privateSha256', 'publicSha256']);
  check(recovery.schema === 1 && recovery.scope === SCOPE && recovery.keyId === expectedKeyId &&
    recovery.privateSha256 === sha(encrypted) && recovery.publicSha256 === sha(publicPem),
  'Backup integrity/fingerprint mismatch');
  const actualId = checkKeyMaterial(encrypted, publicPem, fingerprint, passphrase, expectedKeyId);
  check(process.platform !== 'win32', 'Recovery is approved for the Omarchy Linux host only');
  const parent = lstatSync(dirname(destination));
  check(parent.uid === process.getuid() && (parent.mode & 0o022) === 0,
    'Restore parent must be owned by you and not group/world writable');
  writeRecoveryDirectory(destination, {
    'private-key.pem': encrypted, 'public-key.pem': publicPem, 'fingerprint.txt': fingerprint,
    // Local public export only, NOT an independently approved verifier policy.
    'trust-policy.json': JSON.stringify({
      schema: 1, scope: SCOPE, keys: [{ keyId: actualId, publicKey: publicPem.toString(), status: 'active' }],
    }, null, 2) + '\n',
  });
  ensureKeyDirectory(destination);
  readRegular(join(destination, 'private-key.pem'), 16384, true);
  return { keyId: actualId, directory: destination };
}
async function hiddenPrompt(label) {
  check(process.stdin.isTTY && process.stdin.setRawMode, 'Use an interactive terminal on your own computer');
  emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdout.write(label);
  return await new Promise((resolvePrompt, reject) => {
    let text = '';
    const finish = (error) => {
      process.stdin.off('keypress', handler);
      process.stdin.setRawMode(wasRaw); process.stdin.pause(); process.stdout.write('\n');
      if (error) reject(error); else resolvePrompt(text);
    };
    const handler = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('Cancelled'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { text = text.slice(0, -1); return; }
      if (str && !key.ctrl && !key.meta && !str.includes('\x1b') && text.length + str.length <= 1024) text += str;
    };
    process.stdin.on('keypress', handler);
  });
}
async function approve(message, token = 'SIGN') {
  check(process.stdin.isTTY, 'Signing requires an operator at an interactive terminal');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { check((await rl.question(message)).trim() === token, 'Operation not approved'); }
  finally { rl.close(); }
}
async function main(args) {
  const [command, ...rest] = args;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    check(['--directory', '--request', '--output', '--backup-directory', '--key-id', '--archives-directory'].includes(rest[i]) && rest[i + 1] &&
      !options[rest[i]], 'Invalid/duplicate option');
    options[rest[i]] = rest[i] === '--key-id' ? rest[i + 1] : resolve(rest[i + 1]);
  }
  const directory = options['--directory'] || join(homedir(), '.neon-release-signing');
  check(['backup', 'restore'].includes(command) || (!options['--backup-directory'] && !options['--key-id']),
    'Recovery options are only valid for backup/restore');
  check(command === 'sign-release' || !options['--archives-directory'],
    'Archive options are only valid for sign-release');
  if (command === 'create-key') {
    check(!process.env.REPL_ID && !process.env.REPLIT_DEV_DOMAIN, 'Create the real key on your own computer, NOT Replit');
    check(!options['--request'] && !options['--output'], 'Unsupported key-creation options');
    const dir = ensureKeyDirectory(directory);
    for (const name of ['private-key.pem', 'public-key.pem', 'trust-policy.json', 'fingerprint.txt']) {
      check(!existsSync(join(dir, name)), 'Key files already exist; never overwrite or silently rotate them');
    }
    const passphrase = await hiddenPrompt('Bitwarden passphrase (hidden; 24+ characters, random 32 recommended): ');
    check(passphrase === await hiddenPrompt('Confirm passphrase (hidden): '), 'Passphrases do not match');
    const key = createEncryptedKey(passphrase);
    writeNew(join(dir, 'private-key.pem'), key.encryptedPem);
    writeNew(join(dir, 'public-key.pem'), key.publicPem);
    writeNew(join(dir, 'trust-policy.json'), JSON.stringify({
      schema: 1, scope: SCOPE, keys: [{ keyId: key.keyId, publicKey: key.publicPem, status: 'active' }],
    }, null, 2) + '\n');
    writeNew(join(dir, 'fingerprint.txt'), key.keyId + '\n');
    console.log('Encrypted key created locally. Keep private-key.pem and its passphrase here.');
    console.log('Local key folder: ' + dir);
    console.log('Public fingerprint: ' + key.keyId);
    console.log('Only public-key.pem, trust-policy.json and fingerprint.txt may be sent to Replit.');
  } else if (command === 'backup' || command === 'restore') {
    check(!process.env.REPL_ID && !process.env.REPLIT_DEV_DOMAIN, 'Use your trusted local computer, NOT Replit');
    check(process.platform === 'linux', 'Recovery is approved for the Omarchy Linux host only');
    check(options['--backup-directory'] && !options['--request'] && !options['--output'],
      'Use backup/restore --backup-directory <dedicated-USB-folder> --key-id <approved-fingerprint>');
    checkExpectedId(options['--key-id']);
    const backupDirectory = options['--backup-directory'];
    requireFreshDirectory(command === 'backup' ? backupDirectory : directory);
    console.log('Approved fingerprint: ' + options['--key-id']);
    console.log('Local key folder: ' + resolve(directory));
    console.log('Dedicated USB backup folder: ' + backupDirectory);
    console.log('No overwrite, key rotation, network transfer, or verifier-policy changes.');
    await approve(`Confirm the mounted USB and paths; type ${command.toUpperCase()} to authorize: `, command.toUpperCase());
    const passphrase = await hiddenPrompt('Existing key passphrase (hidden): ');
    const result = (command === 'backup' ? backupEncryptedKey : restoreEncryptedKey)({
      directory, backupDirectory, expectedKeyId: options['--key-id'], passphrase,
    });
    console.log('Verified same-key ' + command + ': ' + result.keyId);
    console.log('Saved in: ' + result.directory);
    console.log(command === 'backup' ? 'Safely eject and disconnect the USB. Keep the passphrase separately in Bitwarden.' :
      'Local key restored. Existing independent public pins/status remain authoritative; no release was authorized.');
  } else if (command === 'sign-release') {
    check(!process.env.REPL_ID && !process.env.REPLIT_DEV_DOMAIN, 'Sign the real release on your own computer, NOT Replit');
    check(options['--request'] && options['--output'] && options['--archives-directory'],
      'Use sign-release --request <request.json> --archives-directory <download-folder> --output <public-signatures.json>');
    check(!existsSync(options['--output']), 'Signature output already exists; choose a fresh file');
    const request = JSON.parse(readRegular(options['--request'], 16384));
    // Validate names before constructing paths; never read a request-chosen path.
    fields(request, ['schema', 'scope', 'archives']);
    check(Array.isArray(request.archives) && request.archives.length > 0 && request.archives.length <= 2,
      'Invalid archive list');
    const archives = {};
    for (const row of request.archives) {
      check(['djbooth-flat-release.tar.gz', 'djbooth-release.tar.gz'].includes(row?.filename),
        'Unsafe archive filename');
      archives[row.filename] = readRegular(join(options['--archives-directory'], row.filename), 512 * 1024 * 1024);
    }
    const checked = validateArchiveSet(request, archives);
    console.log('WHOLE RELEASE: server, support scripts, dependency manifests and frontend bytes.');
    console.log('This is a separate authorization, not a frontend-only signature or a unit install.');
    for (const row of checked) {
      console.log(JSON.stringify({ file: row.filename, ...row.payload }));
    }
    await approve('After reviewing the complete release and independent fingerprint, type RELEASE to authorize: ', 'RELEASE');
    const source = storagePath(directory);
    check(existsSync(source), 'Existing local signing directory is required; no key will be created');
    ensureKeyDirectory(source);
    const encrypted = readRegular(join(source, 'private-key.pem'), 16384, true);
    const signatures = signArchiveSet(request, archives, encrypted, await hiddenPrompt('Existing key passphrase (hidden): '));
    writeNew(options['--output'], JSON.stringify(signatures) + '\n');
    console.log('Public whole-release signatures saved. Key files and policies were not changed.');
  } else if (command === 'sign' || command === 'sign-rollback') {
    check(options['--request'] && options['--output'], 'Use sign --request <request.json> --output <signature.json>');
    check(!existsSync(options['--output']), 'Signature output already exists; choose a fresh file');
    const request = JSON.parse(readRegular(options['--request'], 4 * 1024 * 1024));
    const rollback = command === 'sign-rollback';
    const checked = rollback ? validateRollbackRequest(request) : validateRequest(request);
    console.log('FRONTEND ONLY: not backend/support authenticity, installed identity or freshness.');
    console.log('Requested key: ' + checked.payload.keyId);
    if (rollback) {
      console.log('EXPLICIT WORKSPACE ROLLBACK — not a normal frontend approval.');
      console.log('Workspace: ' + checked.payload.workspaceId + '; new authorization sequence: ' + checked.payload.sequence);
      console.log('Current head: ' + checked.payload.fromSequence + ' / ' + checked.payload.fromManifestSha256);
      console.log('Older target manifest: ' + checked.payload.targetManifestSha256);
      console.log('Reason: ' + checked.payload.reason);
      await approve('After independently confirming current head and target, type ROLLBACK to authorize: ', 'ROLLBACK');
    } else {
      console.log('Manifest SHA-256: ' + checked.payload.manifestSha256);
      console.log('Workspace order: ' + JSON.stringify(checked.manifest.releaseOrder || 'legacy, not installable through ordered finalization'));
      console.log(`Covered source files: ${Object.keys(checked.manifest.inputs).length}; boot files: ${Object.keys(checked.manifest.bootAssets).length}`);
      await approve('After reviewing the request/release source, type SIGN to authorize: ');
    }
    const encrypted = readRegular(join(directory, 'private-key.pem'), 16384, true);
    const signature = (rollback ? signRollbackRequest : signRequest)(request, encrypted, await hiddenPrompt('Key passphrase (hidden): '));
    writeNew(options['--output'], JSON.stringify(signature) + '\n');
    console.log('Public signature saved. No private key was exported.');
  } else throw new Error('Usage: operator-signer.mjs create-key [--directory <private-dir>] | sign|sign-rollback --request <request.json> --output <signature.json> | sign-release --request <request.json> --archives-directory <download-folder> --output <public-signatures.json> [--directory <private-dir>] | backup/restore --backup-directory <dedicated-USB-folder> --key-id <approved-fingerprint> [--directory <private-dir>]');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error('Offline signing refused: ' + error.message); process.exitCode = 1; });
}
