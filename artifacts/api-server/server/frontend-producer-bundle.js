// Authentication of frontend producer bytes only. Never extracts/executes a
// downloaded archive, and never treats its verifier or public keys as trusted.
import { createReadStream, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { dirname, join } from 'node:path';
import { authenticateProducer, hashBytes, readProducerEvidence, readTrustPolicy } from './frontend-producer-auth.js';

const SNAPSHOT = 'dist/frontend-producer/';
const PUBLIC = 'dist/public/';
const MAX_ARCHIVE = 512 * 1024 * 1024;
function check(ok, message) {
  if (!ok) {
    const error = new Error(`Frontend producer bundle refused: ${message}`);
    error.code = 'FRONTEND_PRODUCER_AUTH_FAILED';
    throw error;
  }
}
function safePath(name) {
  check(typeof name === 'string' && name && !name.startsWith('/') && !name.includes('\\') &&
    name.split('/').every(part => part && part !== '.' && part !== '..'), 'unsafe inventory/archive path');
  return name;
}
function rows(value) {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length,
    'missing source/boot inventory');
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, sha] of entries) {
    safePath(name);
    check(typeof sha === 'string' && /^[a-f0-9]{64}$/.test(sha), 'invalid inventory digest');
  }
  return new Map(entries);
}
function validateManifest(bytes) {
  let manifest;
  try { manifest = JSON.parse(bytes); } catch { check(false, 'malformed producer manifest'); }
  check(manifest.schema === 1 && manifest.scope === 'frontend-boot-assets' &&
    manifest.build?.command === 'build:homebase' &&
    manifest.build?.config === 'artifacts/dj-booth/homebase-vite.config.js' &&
    manifest.environment && manifest.dependencies && Object.keys(manifest.dependencies).length,
  'unsupported producer manifest');
  const source = rows(manifest.inputs);
  const boot = rows(manifest.bootAssets);
  for (const required of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.gitignore',
    '.replitignore', '.npmrc', 'tsconfig.json', 'tsconfig.base.json',
    'scripts/src/frontend-producer.mjs', 'artifacts/api-server/server/frontend-producer-auth.js',
    'artifacts/dj-booth/package.json', 'artifacts/dj-booth/index.html',
    'artifacts/dj-booth/homebase-vite.config.js']) {
    check(source.has(required), 'missing required producer input');
  }
  check(boot.has('index.html') && [...boot.keys()].some(name => name.startsWith('assets/') && name.endsWith('.js')) &&
    [...boot.keys()].some(name => name.startsWith('assets/') && name.endsWith('.css')),
  'missing required boot assets');
  check([...boot.keys()].every(name => name === 'index.html' || name.startsWith('assets/')),
    'unsupported boot inventory scope');
  return { source, boot };
}
function compare(actual, expected, label) {
  check(actual.size === expected.size && [...expected].every(([name, sha]) => actual.get(name) === sha),
    `${label} missing, extra or changed files`);
}
function inventory(dir, prefix = '') {
  const root = lstatSync(dir);
  check(root.isDirectory() && !root.isSymbolicLink(), 'covered root must be a regular directory');
  const result = new Map();
  for (const entry of readdirSync(dir).sort()) {
    const file = join(dir, entry), name = prefix + entry;
    const stat = lstatSync(file);
    check(!stat.isSymbolicLink(), 'covered file symlink refused');
    if (stat.isDirectory()) for (const row of inventory(file, name + '/')) result.set(...row);
    else {
      check(stat.isFile(), 'covered non-file refused');
      result.set(name, hashBytes(readFileSync(file)));
    }
  }
  return result;
}
export function authenticateFrontendDirectory(dist, trustPolicyPath, applicationRoot = dirname(dist)) {
  const policy = readTrustPolicy(trustPolicyPath, [applicationRoot]);
  const snapshot = join(dist, 'frontend-producer');
  const bytes = readProducerEvidence(join(snapshot, 'manifest.json'), 2 * 1024 * 1024);
  const authenticated = authenticateProducer(bytes, readProducerEvidence(join(snapshot, 'signature.json'), 16384), policy);
  const expected = validateManifest(bytes);
  compare(inventory(join(snapshot, 'source')), expected.source, 'producer source');
  const boot = inventory(join(dist, 'public/assets'), 'assets/');
  boot.set('index.html', hashBytes(readProducerEvidence(join(dist, 'public/index.html'), 2 * 1024 * 1024)));
  compare(boot, expected.boot, 'shipped boot assets');
  return authenticated;
}

// Stream a GNU/ustar archive into hashes, not the filesystem. Only regular files
// and directories are supported; GNU long-name records are bounded. Refuse PAX,
// links, devices, duplicate entries, corrupt headers and unsupported size encodings.
async function archiveRecords(file) {
  check(statSync(file).size <= MAX_ARCHIVE, 'compressed archive exceeds limit');
  const input = createReadStream(file);
  const gzip = createGunzip();
  input.on('error', error => gzip.destroy(error));
  input.pipe(gzip);
  const iterator = gzip[Symbol.asyncIterator]();
  let buffer = Buffer.alloc(0), consumed = 0;
  const take = async (n, eof = false) => {
    while (buffer.length < n) {
      const next = await iterator.next();
      if (next.done) { check(eof && buffer.length === 0, 'truncated archive'); return null; }
      buffer = Buffer.concat([buffer, next.value]);
      consumed += next.value.length;
      check(consumed <= MAX_ARCHIVE, 'expanded archive exceeds limit');
    }
    const value = buffer.subarray(0, n);
    buffer = buffer.subarray(n);
    return value;
  };
  const number = field => {
    check((field[0] & 0x80) === 0, 'unsupported tar number encoding');
    const text = field.toString('ascii').replace(/\0/g, '').trim();
    check(/^[0-7]+$/.test(text), 'invalid tar number');
    const value = parseInt(text, 8);
    check(Number.isSafeInteger(value) && value <= MAX_ARCHIVE, 'tar number exceeds limit');
    return value;
  };
  const string = field => field.toString('utf8').split('\0')[0];
  const records = new Map(), content = new Map(), seen = new Set();
  let longName = null;
  try {
    while (true) {
      const header = await take(512);
      if (header.every(byte => byte === 0)) {
        check(!longName, 'dangling long-name record');
        const end = await take(512);
        check(end.every(byte => byte === 0), 'invalid archive end');
        while (true) {
          const tail = await take(512, true);
          if (!tail) break;
          check(tail.every(byte => byte === 0), 'nonzero archive trailer');
        }
        return { records, content };
      }
      const sum = [...header].reduce((total, byte, i) => total + (i >= 148 && i < 156 ? 32 : byte), 0);
      check(sum === number(header.subarray(148, 156)), 'tar header checksum mismatch');
      const size = number(header.subarray(124, 136));
      const type = String.fromCharCode(header[156]);
      const magic = string(header.subarray(257, 263));
      check(magic === 'ustar' || magic === 'ustar ', 'unsupported tar format');
      let name = string(header.subarray(0, 100));
      if (magic === 'ustar') {
        const prefix = string(header.subarray(345, 500));
        if (prefix) name = prefix + '/' + name;
      }
      const isLong = type === 'L';
      if (isLong) check(!longName && size > 0 && size <= 4096, 'invalid long-name record');
      else {
        name = longName || name; longName = null;
        name = name.replace(/^(?:\.\/)+/, '').replace(/\/$/, '');
        safePath(name);
        check(!seen.has(name) && seen.size < 100000, 'duplicate/excessive archive entries');
        seen.add(name);
        check(['0', '\0', '5'].includes(type), 'archive links/devices/PAX records are unsupported');
        check(type !== '5' || size === 0, 'directory contains data');
      }
      const capture = isLong || [SNAPSHOT + 'manifest.json', SNAPSHOT + 'signature.json'].includes(name);
      const limit = name.endsWith('signature.json') ? 16384 : 2 * 1024 * 1024;
      if (capture && !isLong) check(size <= limit, 'oversized signed evidence');
      const chunks = [], hash = createHash('sha256');
      for (let remaining = size; remaining > 0;) {
        const chunk = await take(Math.min(remaining, 65536));
        hash.update(chunk); if (capture) chunks.push(chunk);
        remaining -= chunk.length;
      }
      if (size % 512) await take(512 - (size % 512));
      if (isLong) longName = string(Buffer.concat(chunks));
      else if (type !== '5') {
        records.set(name, hash.digest('hex'));
        if (capture) content.set(name, Buffer.concat(chunks));
      }
    }
  } finally {
    input.destroy(); gzip.destroy();
  }
}
export async function authenticateFrontendArchive(file, trustPolicyPath, applicationRoot) {
  try {
    const policy = readTrustPolicy(trustPolicyPath, [applicationRoot]);
    const { records, content } = await archiveRecords(file);
    const bytes = content.get(SNAPSHOT + 'manifest.json');
    check(bytes, 'missing producer manifest');
    const authenticated = authenticateProducer(bytes, content.get(SNAPSHOT + 'signature.json'), policy);
    const expected = validateManifest(bytes);
    const source = new Map(), boot = new Map();
    for (const [name, sha] of records) {
      if (name.startsWith(SNAPSHOT + 'source/')) source.set(name.slice((SNAPSHOT + 'source/').length), sha);
      if (name === PUBLIC + 'index.html' || name.startsWith(PUBLIC + 'assets/')) boot.set(name.slice(PUBLIC.length), sha);
    }
    compare(source, expected.source, 'archive producer source');
    compare(boot, expected.boot, 'archive boot assets');
    return authenticated;
  } catch (error) {
    if (error.code === 'FRONTEND_PRODUCER_AUTH_FAILED') throw error;
    check(false, 'archive is unreadable, malformed or truncated');
  }
}
