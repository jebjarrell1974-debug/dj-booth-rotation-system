// R2 update-bundle distribution.
// Homebase (IS_HOMEBASE=true) publishes the app update bundle to R2 so venue units
// can pull updates privately without GitHub. Bundle layout is identical to the
// /api/update/bundle homebase endpoint (flat app dir: server/, dist/, public/, ...).
//
// R2 keys:
//   updates/latest.tar.gz   — the bundle
//   updates/manifest.json   — { commit, sha256, size, publishedAt, layout: 'flat' }
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream, existsSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'neonaidj';

const MANIFEST_KEY = 'updates/manifest.json';
const BUNDLE_PREFIX = 'updates/bundles/';

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

function buildBundleTar(appDir, outFile) {
  return new Promise((resolve, reject) => {
    const includes = ['server', 'dist', 'public', 'package.json', 'package-lock.json',
      'vite.config.js', 'tailwind.config.js', 'postcss.config.js', 'index.html']
      .filter(f => existsSync(join(appDir, f)));
    const tar = spawn('tar', [
      'czf', outFile, '-C', appDir,
      '--exclude=node_modules', '--exclude=music', '--exclude=voiceovers',
      '--exclude=.env', '--exclude=.env.local', '--exclude=.git',
      ...includes,
    ]);
    let stderr = '';
    tar.stderr.on('data', d => { stderr += d.toString(); });
    tar.on('error', reject);
    tar.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited ${code}: ${stderr.trim()}`));
    });
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

// Publish the current app tree as the fleet update bundle.
// Skips the upload when the already-published manifest matches this commit + hash.
export async function publishUpdateBundle({ sha = 'unknown' } = {}) {
  const c = getClient();
  if (!c) return { published: false, reason: 'R2 not configured' };

  const appDir = join(__dirname, '..');
  if (!existsSync(join(appDir, 'dist'))) {
    return { published: false, reason: 'no pre-built dist/ — refusing to publish sourceless bundle' };
  }

  const tmpFile = join(tmpdir(), `djbooth-r2-bundle-${Date.now()}.tar.gz`);
  try {
    await buildBundleTar(appDir, tmpFile);
    const sha256 = await sha256File(tmpFile);
    const size = statSync(tmpFile).size;

    const existing = await fetchUpdateManifest();
    if (existing && existing.sha256 === sha256) {
      return { published: false, reason: 'unchanged', commit: existing.commit, sha256 };
    }

    // Upload the bundle to an immutable content-addressed key first, then publish the
    // manifest pointing at it. Old bundles are never overwritten in place, so a client
    // reading a slightly stale manifest still downloads a consistent, verifiable bundle.
    const bundleKey = `${BUNDLE_PREFIX}${sha256}.tar.gz`;
    await c.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: bundleKey,
      Body: createReadStream(tmpFile),
      ContentLength: size,
      ContentType: 'application/gzip',
    }));
    const manifest = {
      commit: sha,
      sha256,
      size,
      publishedAt: new Date().toISOString(),
      layout: 'flat',
      bundleKey,
    };
    await c.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: MANIFEST_KEY,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    }));
    return { published: true, ...manifest };
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function downloadOnce(c, manifest, destPath) {
  if (!manifest || !manifest.sha256 || !manifest.bundleKey) {
    throw new Error('No usable update manifest published in R2');
  }
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
    throw new Error(`sha256 mismatch: expected ${manifest.sha256}, got ${gotSha}`);
  }
  return { ...manifest, verified: true, dest: destPath };
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
    const fresh = await fetchUpdateManifest();
    if (!fresh) throw firstErr;
    return await downloadOnce(c, fresh, destPath);
  }
}
