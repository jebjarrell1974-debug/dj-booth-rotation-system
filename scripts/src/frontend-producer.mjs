// Release-only tooling. Never reads installation source copies or contacts fleet services.
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir, arch, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  authenticateProducer, readProducerEvidence, readTrustPolicy, signingBytes, signingPayload,
} from '../../artifacts/api-server/server/frontend-producer-auth.js';
import {
  withReleaseState, initializeReleaseState, reserveRelease, releaseOrder, registerRelease,
  assertLatestRelease, applyOrderedRelease, rollbackSigningBytes, authenticateRollback,
} from './workspace-release-order.mjs';

export const APP = 'artifacts/dj-booth';
const TOOL = 'scripts/src/frontend-producer.mjs';
const AUTH = 'artifacts/api-server/server/frontend-producer-auth.js';
const ORDER = 'scripts/src/workspace-release-order.mjs';
const CONFIG = `${APP}/homebase-vite.config.js`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT_INPUTS = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  '.gitignore', '.replitignore', '.npmrc', 'tsconfig.json', 'tsconfig.base.json'];
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|json|css|html|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|wav|mp3)$/i;
const FORBIDDEN = /(?:^|\/)(?:\.env[^/]*|node_modules|dist|\.git|music|voiceovers|soundboard|license-keys\.json|maintenance)(?:\/|$)|\.(?:db(?:-wal|-shm)?|sqlite3?|sh|pem|key)$/i;
const SECRET = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{40,})|(?:_authToken|_password)\s*[=:]|https?:\/\/[^/\s:@]+:[^/\s@]+@/;
const digest = data => createHash('sha256').update(data).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const assert = (ok, message) => { if (!ok) throw new Error(message); };

function safePath(name) {
  assert(typeof name === 'string' && name && !name.includes('\\') &&
    !name.startsWith('/') && name.split('/').every(p => p && p !== '.' && p !== '..'),
  `Unsafe path: ${name}`);
  return name;
}

export function filesIn(dir, prefix = '') {
  assert(lstatSync(dir).isDirectory() && !lstatSync(dir).isSymbolicLink(), 'Source/public root must be a regular directory');
  const files = [];
  for (const entry of readdirSync(dir).sort()) {
    const name = prefix ? `${prefix}/${entry}` : entry;
    const info = lstatSync(join(dir, entry));
    assert(!info.isSymbolicLink(), `Symlink refused: ${name}`);
    if (info.isDirectory()) files.push(...filesIn(join(dir, entry), name));
    else {
      assert(info.isFile(), `Non-file refused: ${name}`);
      files.push(name);
    }
  }
  return files;
}

export function inventory(dir) {
  return Object.fromEntries(filesIn(dir).sort().map(name => [name, digest(readFileSync(join(dir, name)))]));
}

export function sameInventory(actual, expected, label) {
  assert(expected && Object.keys(expected).length, `Missing ${label} inventory`);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} mismatch (missing, extra or changed files)`);
}

// Package sources are preserved in full (including unimported Tailwind scan inputs).
// TypeScript references and workspace dependencies are traversed, not guessed from imports.
export function collectInputs(root) {
  const inputs = new Set(ROOT_INPUTS.concat([CONFIG, `${APP}/index.html`, TOOL, AUTH, ORDER]));
  const configs = new Set();
  const packages = new Set();
  const known = new Map();
  for (const category of ['lib', 'artifacts']) {
    for (const entry of readdirSync(join(root, category))) {
      const dir = `${category}/${entry}`;
      if (existsSync(join(root, dir, 'package.json'))) {
        known.set(json(join(root, dir, 'package.json')).name, dir);
      }
    }
  }
  const addTree = (dir, publicAssets = false) => {
    if (!existsSync(join(root, dir))) return;
    for (const file of filesIn(join(root, dir))) {
      const name = `${dir}/${file}`;
      if (FORBIDDEN.test(name) || !SOURCE_EXT.test(file)) {
        assert(publicAssets, `Unsupported source input: ${name}`);
        continue;
      }
      inputs.add(name);
    }
  };
  const addConfig = name => {
    name = safePath(name);
    if (configs.has(name)) return;
    configs.add(name);
    inputs.add(name);
    const config = json(join(root, name));
    if (config.extends) {
      assert(typeof config.extends === 'string' && config.extends.startsWith('.'),
        `Unsupported tsconfig extends: ${name}`);
      const extended = relative(root, resolve(root, dirname(name), config.extends)).split(sep).join('/');
      addConfig(extended.endsWith('.json') ? extended : `${extended}.json`);
    }
    for (const ref of config.references || []) {
      const dir = relative(root, resolve(root, dirname(name), ref.path)).split(sep).join('/');
      addPackage(dir);
    }
  };
  const addPackage = dir => {
    safePath(dir);
    assert(dir === APP || /^lib\/[^/]+$/.test(dir), `Unsupported frontend package: ${dir}`);
    if (packages.has(dir)) return;
    packages.add(dir);
    const manifest = json(join(root, dir, 'package.json'));
    inputs.add(`${dir}/package.json`);
    addTree(`${dir}/src`);
    if (existsSync(join(root, dir, 'tsconfig.json'))) addConfig(`${dir}/tsconfig.json`);
    for (const [name, version] of Object.entries({
      ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies,
    })) {
      if (known.has(name)) addPackage(known.get(name));
      else assert(!String(version).startsWith('workspace:'), `Missing workspace package ${name}`);
      assert(!/^(?:file:|link:)/.test(version), `Unsupported local dependency ${name}`);
    }
  };
  addConfig('tsconfig.json');
  addPackage(APP);
  addTree(`${APP}/public`, true);
  for (const name of inputs) {
    safePath(name);
    assert(!FORBIDDEN.test(name), `Forbidden input: ${name}`);
    let component = root;
    for (const part of name.split('/')) {
      component = join(component, part);
      assert(!lstatSync(component).isSymbolicLink(), `Symlink refused: ${name}`);
    }
    assert(lstatSync(join(root, name)).isFile() && !lstatSync(join(root, name)).isSymbolicLink(),
      `Input is not a regular file: ${name}`);
    assert(!SECRET.test(readFileSync(join(root, name), 'utf8')), `Potential credential in ${name}; refusing snapshot`);
  }
  return [...inputs].sort();
}

function copyInputs(root, dest, inputs) {
  for (const name of inputs) {
    mkdirSync(dirname(join(dest, name)), { recursive: true });
    cpSync(join(root, name), join(dest, name));
  }
}

function cleanEnv() {
  // Do not pass operator secrets into dependency lifecycle scripts or Vite.
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, CI: 'true', NODE_ENV: 'production', DJBOOTH_PRODUCER_BUILD: '1' };
}

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd, env: cleanEnv(), encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
  });
  assert(!result.error && result.status === 0, `${command} ${args.join(' ')} failed${capture ? `: ${result.stderr}` : ''}`);
  return result.stdout?.trim();
}

function environment() {
  return { node: process.version, pnpm: run('pnpm', ['--version'], ROOT, true),
    platform: platform(), arch: arch() };
}

function dependencies(tree) {
  const store = join(tree, 'node_modules/.pnpm');
  const result = {};
  for (const dir of readdirSync(store).sort()) {
    const modules = join(store, dir, 'node_modules');
    if (!existsSync(modules)) continue;
    for (const name of readdirSync(modules).sort()) {
      const names = name.startsWith('@')
        ? readdirSync(join(modules, name)).sort().map(sub => `${name}/${sub}`) : [name];
      for (const pkg of names) {
        const file = join(modules, pkg, 'package.json');
        if (!existsSync(file) || lstatSync(join(modules, pkg)).isSymbolicLink()) continue;
        const data = json(file);
        result[`${dir}/${pkg}`] = { name: data.name, version: data.version,
          manifestSha256: digest(readFileSync(file)) };
      }
    }
  }
  assert(Object.keys(result).length > 0, 'No dependency version evidence');
  return result;
}

function build(tree, offline) {
  run('pnpm', ['install', '--frozen-lockfile', '--prod=false', ...(offline ? ['--offline'] : [])], tree);
  const evidence = dependencies(tree);
  run('pnpm', ['--filter', '@workspace/dj-booth', 'exec', 'vite', 'build',
    '--config', 'homebase-vite.config.js'], tree);
  return evidence;
}

function assertUnchanged(tree, inputs) {
  for (const [name, sha] of Object.entries(inputs)) {
    assert(digest(readFileSync(join(tree, name))) === sha, `Build mutated input ${name}`);
  }
}

export function bootInventory(publicDir) {
  assert(existsSync(join(publicDir, 'index.html')), 'Missing boot entry index.html');
  const all = inventory(publicDir);
  const entries = Object.fromEntries(Object.entries(all).filter(([name]) =>
    name === 'index.html' || name.startsWith('assets/')));
  assert(Object.keys(entries).some(name => name.endsWith('.js')), 'Missing boot JavaScript assets');
  assert(Object.keys(entries).some(name => name.endsWith('.css')), 'Missing boot CSS assets');
  const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["']\/(assets\/[^"'?#]+)(?:[?#][^"']*)?["']/g)) {
    assert(entries[match[1]], `Missing referenced boot asset ${match[1]}`);
  }
  return entries;
}

export function validateSnapshot(snapshot, publicDir) {
  const manifest = json(join(snapshot, 'manifest.json'));
  assert(manifest.schema === 1 && manifest.scope === 'frontend-boot-assets' &&
    manifest.build?.config === CONFIG && manifest.build?.command === 'build:homebase',
  'Unsupported producer provenance');
  const source = join(snapshot, 'source');
  sameInventory(inventory(source), manifest.inputs, 'Producer source');
  // Recompute required coverage: a manifest with deleted rows is not evidence.
  const required = collectInputs(source);
  assert(JSON.stringify(required) === JSON.stringify(Object.keys(manifest.inputs)),
    'Producer source closure mismatch');
  sameInventory(bootInventory(publicDir), manifest.bootAssets, 'Shipped boot assets');
  assert(manifest.environment && manifest.dependencies && Object.keys(manifest.dependencies).length,
    'Missing build-tool/dependency evidence');
  return manifest;
}

export function authenticateSnapshot(snapshot, publicDir, trustPolicyPath) {
  const policy = readTrustPolicy(trustPolicyPath, [dirname(dirname(snapshot))]);
  const authenticated = authenticateProducer(readProducerEvidence(join(snapshot, 'manifest.json'), 2 * 1024 * 1024),
    readProducerEvidence(join(snapshot, 'signature.json'), 16384), policy);
  // No dependency installation or delivered code execution before authentication.
  validateSnapshot(snapshot, publicDir);
  return authenticated;
}

export function verifySnapshot(snapshot, publicDir, offline = false, trustPolicyPath) {
  const authenticated = authenticateSnapshot(snapshot, publicDir, trustPolicyPath);
  const manifest = validateSnapshot(snapshot, publicDir);
  assert(JSON.stringify(environment()) === JSON.stringify(manifest.environment),
    'Unsupported build environment; use the recorded Node/pnpm/platform/architecture');
  const temp = mkdtempSync(join(tmpdir(), 'djbooth-reconstruct-'));
  try {
    cpSync(join(snapshot, 'source'), temp, { recursive: true });
    const evidence = build(temp, offline);
    assertUnchanged(temp, manifest.inputs);
    assert(JSON.stringify(evidence) === JSON.stringify(manifest.dependencies), 'Dependency evidence mismatch');
    sameInventory(bootInventory(join(temp, APP, 'dist/public')), manifest.bootAssets, 'Reconstructed boot assets');
    return { verified: true, ...authenticated };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function requestProducerSignature(manifestBytes, signing, policy, cwd) {
  const payload = signingPayload(manifestBytes, signing.keyId);
  const signer = spawnSync(signing.executable, [], {
    cwd, env: cleanEnv(), encoding: 'utf8', timeout: 30000, maxBuffer: 16384,
    input: JSON.stringify({ schema: 1, payload,
      manifestBase64: manifestBytes.toString('base64'),
      signingBytesBase64: signingBytes(payload).toString('base64') }) + '\n',
  });
  assert(!signer.error && signer.status === 0 && signer.stdout, 'External producer signer failed');
  const signatureBytes = Buffer.from(signer.stdout.trim());
  authenticateProducer(manifestBytes, signatureBytes, policy);
  return signatureBytes;
}

export function producerSigningRequest(manifestBytes, keyId) {
  const payload = signingPayload(manifestBytes, keyId);
  return { schema: 1, payload, manifestBase64: manifestBytes.toString('base64'),
    signingBytesBase64: signingBytes(payload).toString('base64') };
}

export function carryCurrentSupport(supportDir, outputPublic) {
  const signedBoot = bootInventory(outputPublic);
  filesIn(supportDir); // Trusted checkout only; refuse links/non-regular entries.
  cpSync(supportDir, outputPublic, { recursive: true });
  sameInventory(bootInventory(outputPublic), signedBoot, 'Support overlay changed signed boot assets');
}

function installVerified(output, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const staged = `${destination}.producer-staging`;
  const old = `${destination}.producer-previous`;
  assert(!existsSync(staged), `Staging path exists: ${staged}`);
  assert(!existsSync(old), `Backup path exists: ${old}`);
  try {
    cpSync(output, staged, { recursive: true });
    const hadOld = existsSync(destination);
    if (hadOld) renameSync(destination, old);
    try { renameSync(staged, destination); }
    catch (error) { if (hadOld) renameSync(old, destination); throw error; }
    if (hadOld) rmSync(old, { recursive: true, force: true });
  } finally { rmSync(staged, { recursive: true, force: true }); }
}

export function finalizePrepared(pending, destination, signatureFile, trustPolicyPath, offline = false, ordering = {}) {
  const root = ordering.root || ROOT;
  return withReleaseState(ordering.statePath, [root, pending, dirname(destination)], (state, persist) =>
    finalizeOrdered(pending, destination, signatureFile, trustPolicyPath, offline, ordering, root, state, persist));
}

function currentFrontendInputs(root) {
  return Object.fromEntries(collectInputs(root).map(name => [name, digest(readFileSync(join(root, name)))]));
}

function finalizeOrdered(pending, destination, signatureFile, trustPolicyPath, offline, ordering, root, state, persist) {
  const prepared = join(pending, 'dist');
  const snapshot = join(prepared, 'frontend-producer');
  const policy = readTrustPolicy(trustPolicyPath, [pending, dirname(destination)]);
  const manifestBytes = readProducerEvidence(join(snapshot, 'manifest.json'), 2 * 1024 * 1024);
  const signature = readProducerEvidence(signatureFile, 16384);
  const authenticated = authenticateProducer(manifestBytes, signature, policy);
  const rollback = ordering.rollbackSignature
    ? authenticateRollback(readProducerEvidence(ordering.rollbackSignature, 16384), trustPolicyPath, [pending, dirname(destination)])
    : undefined;
  const entry = assertLatestRelease(state, manifestBytes, pending, rollback);
  const checkSource = () => {
    if (!rollback) sameInventory(currentFrontendInputs(root), JSON.parse(manifestBytes).inputs,
      'Current workspace frontend (approval is stale; prepare a new release or explicitly authorize rollback)');
  };
  checkSource();
  validateSnapshot(snapshot, join(prepared, 'public'));
  assert(!existsSync(join(snapshot, 'signature.json')), 'Prepared tree must be unsigned; use a fresh preparation');
  const temp = mkdtempSync(join(tmpdir(), 'djbooth-finalize-'));
  try {
    const output = join(temp, 'delivery');
    cpSync(prepared, output, { recursive: true });
    writeFileSync(join(output, 'frontend-producer/signature.json'), signature);
    verifySnapshot(join(output, 'frontend-producer'), join(output, 'public'), offline, trustPolicyPath);
    // A manual approval may span another workspace merge. Never roll back
    // out-of-scope maintenance scripts to the versions frozen before approval.
    // Take these only from the separately trusted current workspace, not the
    // delivery, and refuse any collision with authenticated boot assets.
    carryCurrentSupport(join(dirname(destination), 'public'), join(output, 'public'));
    // Recheck the current pin immediately before installing; retirement while a
    // reconstruction ran must not silently authorize the replacement.
    authenticateSnapshot(join(output, 'frontend-producer'), join(output, 'public'), trustPolicyPath);
    checkSource();
    const currentRollback = rollback ? authenticateRollback(readProducerEvidence(ordering.rollbackSignature, 16384),
      trustPolicyPath, [pending, dirname(destination)]) : undefined;
    if (rollback) assert(JSON.stringify(currentRollback) === JSON.stringify(rollback),
      'Rollback authorization changed during reconstruction');
    assertLatestRelease(state, manifestBytes, pending, currentRollback);
    applyOrderedRelease(state, persist, entry, () => installVerified(output, destination));
    return { verified: true, ...authenticated, destination };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

export function release(root, destination, offline = false, signing = {}) {
  assert(!Object.keys(process.env).some(name => name.startsWith('VITE_')),
    'VITE_* environment overrides are unsupported; use checked-in frontend configuration');
  const policy = readTrustPolicy(signing.trustPolicyPath, [dirname(destination)]);
  const allowed = policy.keys.find(key => key.keyId === signing.keyId && key.status === 'active');
  assert(allowed, 'Release signing requires an active independently pinned key');
  return withReleaseState(signing.statePath, [root, dirname(destination), ...(signing.prepareOutput ? [signing.prepareOutput] : [])],
    (state, persist) => releaseOrdered(root, destination, offline, signing, state, persist, policy));
}

function releaseOrdered(root, destination, offline, signing, state, persist, policy) {
  if (signing.prepareOutput) {
    assert(resolve(signing.prepareOutput) === signing.prepareOutput && !existsSync(signing.prepareOutput),
      'Preparation requires a fresh absolute output directory');
    const rel = relative(resolve(root), signing.prepareOutput);
    assert(rel !== '' && rel !== APP && !rel.startsWith(APP + sep),
      'Preparation must not overwrite the application tree');
    const targetRel = relative(resolve(signing.prepareOutput), resolve(destination));
    assert(targetRel === '..' || targetRel.startsWith('..' + sep),
      'Preparation must not contain the installed distribution');
    readTrustPolicy(signing.trustPolicyPath, [signing.prepareOutput]);
  } else {
    assert(typeof signing.executable === 'string' && resolve(signing.executable) === signing.executable,
      'An absolute external signer executable is required');
  }
  const temp = mkdtempSync(join(tmpdir(), 'djbooth-producer-'));
  try {
    const entry = reserveRelease(state, persist);
    const tree = join(temp, 'tree');
    const inputs = collectInputs(root);
    copyInputs(root, tree, inputs);
    const before = inventory(tree);
    const evidence = build(tree, offline);
    // Install/build may not mutate any producer input.
    assertUnchanged(tree, before);
    const output = join(temp, 'delivery');
    mkdirSync(output);
    cpSync(join(tree, APP, 'dist/public'), join(output, 'public'), { recursive: true });
    const snapshot = join(output, 'frontend-producer');
    mkdirSync(snapshot);
    copyInputs(tree, join(snapshot, 'source'), inputs);
    writeJson(join(snapshot, 'manifest.json'), {
      schema: 1, scope: 'frontend-boot-assets',
      releaseOrder: releaseOrder(state, entry),
      build: { command: 'build:homebase', config: CONFIG },
      environment: environment(), dependencies: evidence,
      inputs: before, bootAssets: bootInventory(join(output, 'public')),
    });
    const manifestBytes = readFileSync(join(snapshot, 'manifest.json'));
    if (signing.prepareOutput) {
      // Save inert evidence only. No authentication/reproducibility claim and
      // no replacement of the working dist before operator signing.
      cpSync(join(root, APP, 'public'), join(output, 'public'), { recursive: true });
      validateSnapshot(snapshot, join(output, 'public'));
      mkdirSync(signing.prepareOutput, { recursive: true, mode: 0o700 });
      try {
        cpSync(output, join(signing.prepareOutput, 'dist'), { recursive: true });
        writeFileSync(join(signing.prepareOutput, 'request.json'),
          JSON.stringify(producerSigningRequest(manifestBytes, signing.keyId)) + '\n', { mode: 0o600 });
        registerRelease(state, persist, entry, manifestBytes, signing.prepareOutput, join(signing.prepareOutput, 'request.json'));
      } catch (error) { rmSync(signing.prepareOutput, { recursive: true, force: true }); throw error; }
      return { prepared: true, authenticated: false, verified: false,
        request: join(signing.prepareOutput, 'request.json'), keyId: signing.keyId };
    }
    const signatureBytes = requestProducerSignature(manifestBytes, signing, policy, temp);
    writeFileSync(join(snapshot, 'signature.json'), signatureBytes);
    verifySnapshot(snapshot, join(output, 'public'), offline, signing.trustPolicyPath);
    // Existing maintenance/support delivery is unchanged, but is explicitly outside
    // frontend provenance and NEVER included in the saved producer source.
    cpSync(join(root, APP, 'public'), join(output, 'public'), { recursive: true });
    authenticateSnapshot(snapshot, join(output, 'public'), signing.trustPolicyPath);
    sameInventory(currentFrontendInputs(root), before, 'Current workspace frontend');
    registerRelease(state, persist, entry, manifestBytes, output, null);
    assertLatestRelease(state, manifestBytes, output);
    applyOrderedRelease(state, persist, entry, () => installVerified(output, destination));
    return { verified: true, authenticated: true, keyId: signing.keyId,
      scope: 'frontend-boot-assets', destination };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function prepareRollback(pending, signatureFile, requestFile, trustPolicyPath, statePath, keyId, reason, root = ROOT) {
  return withReleaseState(statePath, [root, pending], (state, persist) => {
    const bytes = readProducerEvidence(join(pending, 'dist/frontend-producer/manifest.json'), 2 * 1024 * 1024);
    const policy = readTrustPolicy(trustPolicyPath, [root, pending]);
    authenticateProducer(bytes, readProducerEvidence(signatureFile, 16384), policy);
    validateSnapshot(join(pending, 'dist/frontend-producer'), join(pending, 'dist/public'));
    assert(state.current && state.entries.some(e => e.kind === 'release' &&
      e.manifestSha256 === digest(bytes)), 'Rollback target must be a workspace-registered release');
    assert(policy.keys.some(k => k.keyId === keyId && k.status === 'active'), 'Rollback requires an active independent signing key');
    assert(!existsSync(requestFile), 'Rollback request output must be fresh');
    const sequence = state.next;
    const payload = { schema: 1, scope: 'frontend-workspace-rollback', algorithm: 'Ed25519', keyId,
      workspaceId: state.workspaceId, sequence, nonce: '00000000-0000-0000-0000-000000000000',
      fromSequence: state.current.sequence, fromManifestSha256: state.current.manifestSha256,
      targetManifestSha256: digest(bytes), reason };
    rollbackSigningBytes(payload); // Validate before consuming a sequence.
    const entry = reserveRelease(state, persist, 'rollback');
    payload.nonce = entry.nonce;
    const request = { schema: 1, payload, signingBytesBase64: rollbackSigningBytes(payload).toString('base64') };
    writeFileSync(requestFile, JSON.stringify(request) + '\n', { flag: 'wx', mode: 0o600 });
    entry.rollbackPayload = payload;
    registerRelease(state, persist, entry, bytes, pending, requestFile);
    return { request: requestFile, scope: payload.scope, sequence: entry.sequence };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const offline = args.includes('--offline');
    const options = {};
    const positional = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--offline') continue;
      if (['--trust-policy', '--signer-executable', '--signing-key-id', '--signature', '--output',
        '--release-state', '--rollback-signature', '--reason'].includes(args[i])) {
        const name = args[i];
        assert(!options[name] && args[i + 1] && !args[i + 1].startsWith('--'), `Invalid/duplicate ${name}`);
        options[name] = args[++i];
      } else {
        assert(!args[i].startsWith('--'), `Unknown option ${args[i]}`);
        positional.push(args[i]);
      }
    }
    const trustPolicyPath = resolve(options['--trust-policy'] || join(ROOT, 'config/frontend-producer-trust.json'));
    const statePath = options['--release-state'] || process.env.FRONTEND_RELEASE_STATE;
    assert(!options['--rollback-signature'] || command === 'finalize', 'Rollback signature is only valid for finalize');
    assert(!options['--reason'] || command === 'prepare-rollback', 'Reason is only valid for prepare-rollback');
    if (command === 'init-order' && !positional.length) {
      assert(Object.keys(options).every(k => k === '--release-state') && !offline,
        'Init-order accepts only --release-state; requires separate operator approval');
      initializeReleaseState(statePath, ROOT);
      console.log(JSON.stringify({ initialized: true, statePath }));
    } else if (command === 'prepare-rollback' && positional.length === 1) {
      assert(options['--signature'] && options['--output'] && options['--reason'] && options['--signing-key-id'] &&
        !options['--signer-executable'] && !offline, 'Prepare-rollback requires target signature, fresh output, key ID and reason');
      console.log(JSON.stringify(prepareRollback(resolve(positional[0]), resolve(options['--signature']),
        resolve(options['--output']), trustPolicyPath, statePath, options['--signing-key-id'], options['--reason'])));
    } else if (command === 'build' && !positional.length) {
      assert(!options['--output'] && !options['--signature'], 'Build does not accept preparation/signature-file options');
      console.log(JSON.stringify(release(ROOT, join(ROOT, APP, 'dist'), offline, {
        trustPolicyPath, executable: options['--signer-executable'], keyId: options['--signing-key-id'], statePath,
      })));
    } else if (command === 'prepare' && !positional.length) {
      assert(options['--output'] && !options['--signature'] && !options['--signer-executable'],
        'Prepare requires --output and does not accept a signature or signer executable');
      console.log(JSON.stringify(release(ROOT, join(ROOT, APP, 'dist'), offline, {
        trustPolicyPath, keyId: options['--signing-key-id'], prepareOutput: resolve(options['--output']), statePath,
      })));
    } else if (command === 'finalize' && positional.length === 1) {
      assert(options['--signature'] && !options['--output'] && !options['--signer-executable'] && !options['--signing-key-id'],
        'Finalize requires --signature and does not accept signer/output options');
      console.log(JSON.stringify(finalizePrepared(resolve(positional[0]), join(ROOT, APP, 'dist'),
        resolve(options['--signature']), trustPolicyPath, offline,
        { statePath, rollbackSignature: options['--rollback-signature'] && resolve(options['--rollback-signature']) })));
    } else if (['verify', 'authenticate'].includes(command) && positional.length === 1) {
      assert(!options['--signer-executable'] && !options['--signing-key-id'] && !options['--signature'] && !options['--output'],
        'Verifier does not accept signer/output options');
      const dist = resolve(positional[0]);
      console.log(JSON.stringify(command === 'authenticate'
        ? authenticateSnapshot(join(dist, 'frontend-producer'), join(dist, 'public'), trustPolicyPath)
        : verifySnapshot(join(dist, 'frontend-producer'), join(dist, 'public'), offline, trustPolicyPath)));
    } else throw new Error('Usage: frontend-producer.mjs init-order --release-state <independent-state> | build|prepare --release-state <independent-state> --trust-policy <external-policy> --signing-key-id <fingerprint> [--signer-executable <absolute-path> | --output <fresh-dir>] | finalize <prepared-dir> --signature <signature.json> --release-state <independent-state> --trust-policy <external-policy> [--rollback-signature <separate-approval.json>] | prepare-rollback <prepared-dir> --signature <original-signature.json> --output <fresh-request.json> --reason <reason> --signing-key-id <fingerprint> --release-state <independent-state> --trust-policy <external-policy> | verify|authenticate <dist> --trust-policy <external-policy> [--offline]');
  } catch (error) {
    console.error(`Frontend producer refused: ${error.message}`);
    process.exitCode = 1;
  }
}
