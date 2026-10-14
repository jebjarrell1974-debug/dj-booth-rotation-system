// Executed only from a whole-release authenticated candidate. Built-ins only.
import { lstatSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function check(ok, message) { if (!ok) throw new Error(`Runtime dependency lock refused: ${message}`); }
function readJSON(file) {
  const stat = lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16 * 1024 * 1024,
    'missing, linked or oversized manifest');
  return JSON.parse(readFileSync(file, 'utf8'));
}
const declarations = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
export function validateRuntimeLock(packageFile, lockFile) {
  const pkg = readJSON(packageFile), lock = readJSON(lockFile);
  check(lock.lockfileVersion === 3 && lock.packages && typeof lock.packages === 'object',
    'an npm v3 package lock is required');
  const root = lock.packages[''];
  check(root && root.name === pkg.name && root.version === pkg.version &&
    lock.name === pkg.name && lock.version === pkg.version, 'package identity mismatch');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    check(declarations(pkg[field]) === declarations(root[field]), `${field} mismatch`);
  }
  check(!pkg.bundledDependencies && !pkg.bundleDependencies, 'untracked bundled dependencies');
  const entries = Object.entries(lock.packages).filter(([name]) => name);
  check(entries.length > 0, 'empty dependency inventory');
  for (const [name, row] of entries) {
    check(name.startsWith('node_modules/') && !name.includes('\\') &&
      name.split('/').every(part => part && part !== '.' && part !== '..'),
    'unsafe dependency path');
    check(row && !row.link && typeof row.version === 'string' && row.version.length > 0,
      'unlocked or local dependency');
    if (row.inBundle === true) {
      // npm records bundled files without separate URLs: the enclosing tarball
      // integrity covers them. Require a real, independently checked ancestor.
      let parent = name;
      do {
        const boundary = parent.lastIndexOf('/node_modules/');
        parent = boundary < 0 ? '' : parent.slice(0, boundary);
      }
      while (parent && lock.packages[parent]?.inBundle === true);
      check(parent && lock.packages[parent]?.integrity && lock.packages[parent]?.resolved,
        'bundled dependency without a locked enclosing artifact');
      continue;
    }
    let url;
    try { url = new URL(row.resolved); } catch { check(false, 'missing registry artifact URL'); }
    check(url.protocol === 'https:' && !url.username && !url.password, 'non-HTTPS or credentialed dependency URL');
    const match = /^(sha512|sha256)-([A-Za-z0-9+/]+={0,2})$/.exec(row.integrity || '');
    check(match && Buffer.from(match[2], 'base64').length === (match[1] === 'sha512' ? 64 : 32) &&
      Buffer.from(match[2], 'base64').toString('base64') === match[2],
    'missing/noncanonical package integrity');
  }
  return { locked: true, packages: entries.length };
}
export function nativeHeaderDirectory() {
  check(process.platform === 'linux', 'native rebuild qualification is Linux-only');
  const wanted = process.versions.node.split('.').map(Number);
  for (const [file, directory] of [
    ['/usr/include/node/node_version.h', '/usr'],
    ['/usr/include/nodejs/src/node_version.h', '/usr/include/nodejs'],
  ]) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const actual = ['MAJOR', 'MINOR', 'PATCH'].map(part =>
      Number(new RegExp(`^#define NODE_${part}_VERSION\\s+(\\d+)`, 'm').exec(text)?.[1]));
    if (actual.every((part, i) => part === wanted[i])) return directory;
  }
  throw new Error('Matching trusted OS Node headers are required; no network header/prebuilt-binary fallback');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, pkg, lock, ...extra] = process.argv.slice(2);
    if (command === 'verify' && pkg && lock && !extra.length) {
      console.log(JSON.stringify(validateRuntimeLock(pkg, lock)));
    } else if (command === 'headers' && !pkg && !lock) {
      console.log(nativeHeaderDirectory());
    } else throw new Error('Usage: runtime-lock.mjs verify package.json package-lock.json | headers');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
