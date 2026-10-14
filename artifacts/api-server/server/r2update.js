// R2 update-bundle distribution.
// Homebase (IS_HOMEBASE=true) publishes the app update bundle to R2 so venue units
// can pull updates privately without GitHub. Bundle layout is identical to the
// /api/update/bundle homebase endpoint (flat app dir: server/, dist/, public/, ...).
//
// R2 keys:
//   updates/bundles/<sha256>.tar.gz + .signature.json — immutable signed delivery
//   updates/manifest.json   — { commit, sha256, size, publishedAt, layout: 'flat' }
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir, tmpdir } from 'os';
import { authenticateFrontendArchive } from './frontend-producer-bundle.js';
import { authenticateInstallerArchive, installerRefusal, readApprovedRelease } from './installer-release.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'neonaidj';

const MANIFEST_KEY = 'updates/manifest.json';
const BUNDLE_PREFIX = 'updates/bundles/';
// Provision independently, not from the update archive. The publisher/download
// API never accepts a bundle-supplied key or request-supplied policy path.
const PRODUCER_TRUST_POLICY = join(homedir(), '.config/neon/frontend-producer-trust.json');

let client = null;
function getClient() {
  if (!client) {
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      maxAttempts: 3,
    });
  }
  return client;
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function fetchUpdateManifest() {
  const c = getClient();
  if (!c) return null;
  try {
    const res = await c.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: MANIFEST_KEY }));
    const body = await res.Body.transformToString();
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// Publish only a separately approved whole-release archive, never the live tree.
// Skips the upload when the already-published manifest matches this commit + hash.
export async function publishUpdateBundle({ sha = 'unknown' } = {}) {
  const c = getClient();
  if (!c) return { published: false, reason: 'R2 not configured' };

  const appDir = join(__dirname, '..');
  const release = readApprovedRelease(appDir);
  const temp = mkdtempSync(join(tmpdir(), 'djbooth-r2-approved-'));
  const tmpFile = join(temp, 'bundle.tar.gz');
  try {
    writeFileSync(tmpFile, release.archive, { mode: 0o600 });
    // Bind the same staged bytes we will upload, not just a pre-tar live-tree
    // check. A concurrently changed file/key policy cannot slip into the tar.
    const producer = await authenticateFrontendArchive(tmpFile, PRODUCER_TRUST_POLICY, appDir);
    const sha256 = release.installer.archiveSha256;
    const size = release.archive.length;

    const existing = await fetchUpdateManifest();
    if (existing && existing.sha256 === sha256 && existing.signatureKey === `${BUNDLE_PREFIX}${sha256}.signature.json`) {
      return { published: false, reason: 'unchanged', commit: existing.commit, sha256 };
    }

    // Upload the bundle to an immutable content-addressed key first, then publish the
    // manifest pointing at it. Old bundles are never overwritten in place, so a client
    // reading a slightly stale manifest still downloads a consistent, verifiable bundle.
    const bundleKey = `${BUNDLE_PREFIX}${sha256}.tar.gz`;
    await c.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: bundleKey,
      Body: release.archive,
      ContentLength: size,
      ContentType: 'application/gzip',
    }));
    const signatureKey = `${BUNDLE_PREFIX}${sha256}.signature.json`;
    await c.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME, Key: signatureKey, Body: release.evidence,
      ContentType: 'application/json',
    }));
    const manifest = {
      // Never label a separately staged archive with the live publisher SHA.
      // This remains declared source metadata, not measured installed identity.
      commit: /^[a-f0-9]{40}$/.test(release.installer.releaseId) ? release.installer.releaseId : 'unknown',
      sha256,
      size,
      publishedAt: new Date().toISOString(),
      layout: 'flat',
      bundleKey,
      signatureKey,
    };
    await c.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: MANIFEST_KEY,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    }));
    return { published: true, ...manifest, frontendAuthenticated: true, producer,
      installerAuthenticated: true, installer: release.installer };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export async function downloadOnce(c, manifest, destPath) {
  if (!manifest || !manifest.sha256 || !manifest.bundleKey) {
    throw new Error('No usable update manifest published in R2');
  }
  if (manifest.layout !== 'flat' || !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
      manifest.bundleKey !== `${BUNDLE_PREFIX}${manifest.sha256}.tar.gz` ||
      manifest.signatureKey !== `${BUNDLE_PREFIX}${manifest.sha256}.signature.json`) {
    throw installerRefusal('R2 manifest lacks supported whole-release evidence');
  }
  const signaturePath = destPath + '.signature.json';
  const res = await c.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: manifest.bundleKey }));
  await new Promise((resolve, reject) => {
    const out = createWriteStream(destPath);
    res.Body.pipe(out);
    res.Body.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
  });
  const gotSha = await sha256File(destPath);
  if (gotSha !== manifest.sha256) {
    try { unlinkSync(destPath); } catch {}
    throw installerRefusal(`sha256 mismatch: expected ${manifest.sha256}, got ${gotSha}`);
  }
  try {
    // Missing evidence after a downloaded candidate is a refusal, not a reason
    // to install from a different source. Limit evidence before writing it.
    try {
      const signed = await c.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: manifest.signatureKey }));
      let size = 0;
      const chunks = [];
      for await (const chunk of signed.Body) {
        size += chunk.length;
        if (size > 16384) throw installerRefusal('oversized R2 installer evidence');
        chunks.push(Buffer.from(chunk));
      }
      writeFileSync(signaturePath, Buffer.concat(chunks), { mode: 0o600 });
    } catch (error) { throw installerRefusal(error.message); }
    const installer = authenticateInstallerArchive(destPath, signaturePath, 'flat', join(__dirname, '..'));
    const producer = await authenticateFrontendArchive(destPath, PRODUCER_TRUST_POLICY, join(__dirname, '..'));
    return { ...manifest, verified: true, frontendAuthenticated: true, producer,
      installerAuthenticated: true, installer, dest: destPath };
  } catch (error) {
    try { unlinkSync(destPath); } catch {}
    try { unlinkSync(signaturePath); } catch {}
    throw error;
  }
}

// Download the published bundle to destPath and verify its sha256 against the manifest.
// On failure (mismatch or missing bundle), re-reads the manifest once and retries — this
// safely rides out a publish that lands between our manifest read and bundle download.
export async function downloadUpdateBundle(destPath) {
  const c = getClient();
  if (!c) throw new Error('R2 not configured (missing R2_* env vars)');
  const manifest = await fetchUpdateManifest();
  try {
    return await downloadOnce(c, manifest, destPath);
  } catch (firstErr) {
    if (['FRONTEND_PRODUCER_AUTH_FAILED', 'INSTALLER_AUTH_FAILED'].includes(firstErr.code)) throw firstErr;
    const fresh = await fetchUpdateManifest();
    if (!fresh) throw firstErr;
    return await downloadOnce(c, fresh, destPath);
  }
}
