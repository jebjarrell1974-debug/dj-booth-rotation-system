import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, createWriteStream, unlinkSync } from 'fs';
import { join, basename, extname } from 'path';
import { pipeline } from 'stream/promises';
import { hostname } from 'os';

// ---- Per-device Promos namespacing -----------------------------------------
// Promos (commercials) are venue-specific — each Dell unit's commercials must
// stay isolated. Other genres remain shared fleet-wide.
//
// On disk (every unit): music/Promos/<file>.mp3                  (unchanged)
// In R2:                 music/Promos__<deviceId>/<file>.mp3     (namespaced)
//
// "homebase" does not run promos at this time; it neither uploads nor
// downloads any Promos. When homebase is upgraded to a Dell unit we'll
// revisit.
function getDeviceId() {
  const raw = (process.env.DEVICE_ID || hostname() || 'unknown').toLowerCase();
  // Strict allowlist: only a-z, 0-9, '-', max 32 chars. Anything else
  // (slashes, dots, whitespace, control chars) is stripped. Falls back
  // to 'unknown' if nothing usable remains. This prevents R2 keyspace
  // injection / namespace collision via malformed hostnames.
  const cleaned = raw.replace(/[^a-z0-9-]/g, '').slice(0, 32);
  return cleaned || 'unknown';
}
function isHomebase() {
  return getDeviceId().includes('homebase');
}
function ownPromosPrefix() {
  return `Promos__${getDeviceId()}/`;
}
// Returns: { kind: 'own'|'foreign'|'legacy'|'other', localRelPath, r2Key }
// - 'own'     : R2 key is this device's namespaced promos → maps to local Promos/<file>
// - 'foreign' : R2 key is some other device's namespaced promos → ignore
// - 'legacy'  : R2 key is plain "Promos/<file>" from before namespacing → ignore
//               (we will not touch local promos based on legacy R2 entries)
// - 'other'   : non-promo music path → unchanged
function classifyR2Path(r2RelPath) {
  if (r2RelPath.startsWith('Promos__')) {
    if (r2RelPath.startsWith(ownPromosPrefix())) {
      return { kind: 'own', localRelPath: 'Promos/' + r2RelPath.slice(ownPromosPrefix().length), r2Key: r2RelPath };
    }
    return { kind: 'foreign', localRelPath: null, r2Key: r2RelPath };
  }
  if (r2RelPath.startsWith('Promos/')) {
    return { kind: 'legacy', localRelPath: null, r2Key: r2RelPath };
  }
  return { kind: 'other', localRelPath: r2RelPath, r2Key: r2RelPath };
}
// Convert a LOCAL relative path to the R2 key we should upload it under.
// Returns null if the file should NOT be uploaded (e.g. homebase trying to
// upload a Promos/ file that shouldn't exist there in the first place).
function localToR2Key(localRelPath) {
  if (localRelPath.startsWith('Promos/')) {
    if (isHomebase()) return null;
    return ownPromosPrefix() + localRelPath.slice('Promos/'.length);
  }
  return localRelPath;
}

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'neonaidj';

let s3Client = null;

const DOWNLOAD_TIMEOUT_MS = 60000;
const REQUEST_TIMEOUT_MS = 30000;

function getClient() {
  if (!s3Client) {
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      return null;
    }
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
      maxAttempts: 3,
      requestHandler: {
        requestTimeout: REQUEST_TIMEOUT_MS,
        connectionTimeout: REQUEST_TIMEOUT_MS,
      },
    });
  }
  return s3Client;
}

async function pipelineWithTimeout(source, dest, timeoutMs = DOWNLOAD_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await pipeline(source, dest, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function isR2Configured() {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

export async function deleteFromR2Music(relativePath) {
  const client = getClient();
  if (!client) return false;
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `music/${relativePath}`,
    }));
    console.log(`☁️ R2: Deleted music/${relativePath}`);
    return true;
  } catch (err) {
    console.error(`☁️ R2: Failed to delete music/${relativePath}: ${err.message}`);
    return false;
  }
}

export async function uploadVoiceover(cacheKey, filePath, clubName = null) {
  const client = getClient();
  if (!client) return null;

  try {
    const fileBuffer = readFileSync(filePath);
    const fileName = basename(filePath);
    const key = `voiceovers/${fileName}`;

    const metadata = { cacheKey };
    if (clubName) metadata.clubName = clubName;

    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: 'audio/mpeg',
      Metadata: metadata,
    }));

    console.log(`☁️ R2: Uploaded voiceover ${fileName}${clubName ? ` (club: ${clubName})` : ''}`);
    return key;
  } catch (err) {
    console.error(`☁️ R2: Failed to upload voiceover: ${err.message}`);
    return null;
  }
}

function extractClubFromFilename(fileName) {
  const match = fileName.match(/-C([a-zA-Z0-9]+)(?:\.|$|-S)/);
  if (match) return match[1].toLowerCase();
  const endMatch = fileName.replace(/\.mp3$/i, '').match(/-C([a-zA-Z0-9]+)$/);
  if (endMatch) return endMatch[1].toLowerCase();
  return null;
}

function normalizeClubName(name) {
  if (!name) return '';
  return name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function sanitizePath(p) {
  const normalized = p.replace(/\\/g, '/').split('/').filter(seg => seg !== '..' && seg !== '.' && seg !== '').join('/');
  if (!normalized || normalized.startsWith('/')) return null;
  return normalized;
}

export async function downloadVoiceover(fileName, destDir, force = false) {
  const client = getClient();
  if (!client) return null;

  const safeName = sanitizePath(fileName);
  if (!safeName || safeName.includes('/')) return null;

  try {
    const key = `voiceovers/${safeName}`;
    const destPath = join(destDir, safeName);

    if (existsSync(destPath) && !force) return destPath;

    const response = await client.send(new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    }));

    const ws = createWriteStream(destPath);
    await pipelineWithTimeout(response.Body, ws);

    return destPath;
  } catch (err) {
    if (err.name !== 'NoSuchKey') {
      console.error(`☁️ R2: Failed to download voiceover ${safeName}: ${err.message}`);
    }
    try { if (existsSync(join(destDir, safeName))) unlinkSync(join(destDir, safeName)); } catch {}
    return null;
  }
}

export async function listR2Voiceovers() {
  const client = getClient();
  if (!client) return [];

  try {
    const files = [];
    let continuationToken = undefined;

    do {
      const response = await client.send(new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: 'voiceovers/',
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }));

      if (response.Contents) {
        for (const obj of response.Contents) {
          const name = obj.Key.replace('voiceovers/', '');
          if (name) files.push({ name, size: obj.Size, lastModified: obj.LastModified });
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return files;
  } catch (err) {
    console.error(`☁️ R2: Failed to list voiceovers: ${err.message}`);
    return [];
  }
}

export async function syncVoiceoversFromR2(voiceoverDir, currentClubName = '') {
  const client = getClient();
  if (!client) return { downloaded: 0, skipped: 0, errors: 0, clubFiltered: 0 };

  if (!existsSync(voiceoverDir)) mkdirSync(voiceoverDir, { recursive: true });

  const remoteFiles = await listR2Voiceovers();
  const normalizedClub = normalizeClubName(currentClubName);
  let downloaded = 0, skipped = 0, errors = 0, clubFiltered = 0;

  console.log(`☁️ R2 voiceover sync: ${remoteFiles.length} files in cloud, checking local...`);

  for (const file of remoteFiles) {
    const fileClub = extractClubFromFilename(file.name);
    if (fileClub && normalizedClub && fileClub !== normalizedClub) {
      clubFiltered++;
      continue;
    }

    const localPath = join(voiceoverDir, file.name);
    let force = false;
    if (existsSync(localPath)) {
      const localSize = statSync(localPath).size;
      if (localSize === file.size) {
        skipped++;
        continue;
      }
      force = true;
    }

    const result = await downloadVoiceover(file.name, voiceoverDir, force);
    if (result) {
      downloaded++;
      if (downloaded % 100 === 0) {
        console.log(`☁️ R2 voiceover sync progress: ${downloaded} downloaded, ${skipped} skipped, ${errors} errors so far...`);
      }
    } else {
      errors++;
    }
  }

  if (clubFiltered > 0) {
    console.log(`☁️ R2 voiceover sync: ${downloaded} downloaded, ${skipped} already local, ${clubFiltered} other-club skipped, ${errors} errors`);
  } else {
    console.log(`☁️ R2 voiceover sync: ${downloaded} downloaded, ${skipped} already local, ${errors} errors`);
  }
  return { downloaded, skipped, errors, clubFiltered };
}

export async function syncVoiceoversToR2(voiceoverDir) {
  const client = getClient();
  if (!client) return { uploaded: 0, skipped: 0, errors: 0 };

  if (!existsSync(voiceoverDir)) return { uploaded: 0, skipped: 0, errors: 0 };

  const localFiles = readdirSync(voiceoverDir).filter(f => extname(f).toLowerCase() === '.mp3');
  const remoteFiles = await listR2Voiceovers();
  const remoteMap = new Map(remoteFiles.map(f => [f.name, f.size]));

  let uploaded = 0, skipped = 0, errors = 0;

  console.log(`☁️ R2 voiceover upload: ${localFiles.length} local files, ${remoteFiles.length} remote files`);

  for (const fileName of localFiles) {
    const localPath = join(voiceoverDir, fileName);
    const localSize = statSync(localPath).size;

    if (remoteMap.has(fileName) && remoteMap.get(fileName) === localSize) {
      skipped++;
      continue;
    }

    try {
      const fileBuffer = readFileSync(localPath);
      const fileClub = extractClubFromFilename(fileName);
      const metadata = {};
      if (fileClub) metadata.clubName = fileClub;
      await client.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: `voiceovers/${fileName}`,
        Body: fileBuffer,
        ContentType: 'audio/mpeg',
        Metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      }));
      uploaded++;
      if (uploaded % 50 === 0) {
        console.log(`☁️ R2 voiceover upload progress: ${uploaded} uploaded so far...`);
      }
    } catch (err) {
      console.error(`☁️ R2: Failed to upload ${fileName}: ${err.message}`);
      errors++;
    }
  }

  console.log(`☁️ R2 voiceover upload: ${uploaded} uploaded, ${skipped} already remote, ${errors} errors`);
  return { uploaded, skipped, errors };
}

export async function uploadMusicTrack(filePath, relativePath) {
  const client = getClient();
  if (!client) return null;

  try {
    const fileBuffer = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = {
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.wma': 'audio/x-ms-wma',
    }[ext] || 'audio/mpeg';

    const key = `music/${relativePath}`;

    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    }));

    return key;
  } catch (err) {
    console.error(`☁️ R2: Failed to upload music ${relativePath}: ${err.message}`);
    return null;
  }
}

// Download an explicit R2 key to an explicit local destination path. Used for
// per-device Promos where the R2 key (Promos__<device>/foo.mp3) differs from
// the local destination (Promos/foo.mp3).
async function downloadMusicTrackToLocalPath(r2RelPath, destPath) {
  const client = getClient();
  if (!client) return false;
  const safeKey = sanitizePath(r2RelPath);
  if (!safeKey) return false;
  try {
    const destDirPath = join(destPath, '..');
    if (!existsSync(destDirPath)) mkdirSync(destDirPath, { recursive: true });
    const response = await client.send(new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `music/${safeKey}`,
    }));
    const ws = createWriteStream(destPath);
    await pipelineWithTimeout(response.Body, ws);
    return true;
  } catch (err) {
    if (err.name !== 'NoSuchKey') {
      console.error(`☁️ R2: Failed to download promo ${r2RelPath} → ${destPath}: ${err.message}`);
    }
    try { if (existsSync(destPath)) unlinkSync(destPath); } catch {}
    return false;
  }
}

export async function downloadMusicTrack(relativePath, musicDir, force = false) {
  const client = getClient();
  if (!client) return null;

  const safePath = sanitizePath(relativePath);
  if (!safePath) return null;

  try {
    const key = `music/${safePath}`;
    const destPath = join(musicDir, safePath);
    const destDirPath = join(destPath, '..');

    if (existsSync(destPath) && !force) return destPath;

    if (!existsSync(destDirPath)) mkdirSync(destDirPath, { recursive: true });

    const response = await client.send(new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    }));

    const ws = createWriteStream(destPath);
    await pipelineWithTimeout(response.Body, ws);

    return destPath;
  } catch (err) {
    if (err.name !== 'NoSuchKey') {
      console.error(`☁️ R2: Failed to download music ${relativePath}: ${err.message}`);
    }
    try {
      const destPath = join(musicDir, sanitizePath(relativePath) || '');
      if (existsSync(destPath)) unlinkSync(destPath);
    } catch {}
    return null;
  }
}

export async function listR2Music() {
  const client = getClient();
  if (!client) return [];

  try {
    const files = [];
    let continuationToken = undefined;

    do {
      const response = await client.send(new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: 'music/',
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }));

      if (response.Contents) {
        for (const obj of response.Contents) {
          const path = obj.Key.replace('music/', '');
          if (path) files.push({ path, size: obj.Size, lastModified: obj.LastModified });
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return files;
  } catch (err) {
    console.error(`☁️ R2: Failed to list music: ${err.message}`);
    return [];
  }
}

export async function syncMusicFromR2(musicDir) {
  const client = getClient();
  if (!client) return { downloaded: 0, skipped: 0, errors: 0, purged: 0 };

  if (!existsSync(musicDir)) mkdirSync(musicDir, { recursive: true });

  const remoteFiles = await listR2Music();
  let downloaded = 0, skipped = 0, errors = 0, purged = 0;
  let promoForeignSkipped = 0, promoLegacySkipped = 0, promoHomebaseSkipped = 0;
  const ownPromoLocalPaths = new Set();

  console.log(`☁️ R2 music sync: ${remoteFiles.length} files in cloud, checking local... (deviceId=${getDeviceId()})`);

  for (const file of remoteFiles) {
    const cls = classifyR2Path(file.path);
    if (cls.kind === 'foreign') { promoForeignSkipped++; continue; }
    if (cls.kind === 'legacy') { promoLegacySkipped++; continue; }
    if (cls.kind === 'own' && isHomebase()) { promoHomebaseSkipped++; continue; }

    const targetRelPath = cls.localRelPath;
    if (cls.kind === 'own') ownPromoLocalPaths.add(targetRelPath);
    const localPath = join(musicDir, targetRelPath);
    let force = false;
    if (existsSync(localPath)) {
      const localSize = statSync(localPath).size;
      if (localSize === file.size) {
        skipped++;
        continue;
      }
      force = true;
    }

    // For own-promos we need to download under the namespaced R2 key but write
    // to the un-namespaced local path; downloadMusicTrack uses relativePath as
    // both the R2 key suffix and the destination, so promo downloads need a
    // direct GetObject + write rather than going through downloadMusicTrack.
    let ok = false;
    if (cls.kind === 'own') {
      ok = await downloadMusicTrackToLocalPath(cls.r2Key, localPath);
    } else {
      const result = await downloadMusicTrack(targetRelPath, musicDir, force);
      ok = !!result;
    }
    if (ok) {
      downloaded++;
      if (downloaded % 50 === 0) {
        console.log(`☁️ R2 music sync progress: ${downloaded} downloaded so far...`);
      }
    } else {
      errors++;
    }
  }
  if (promoForeignSkipped || promoLegacySkipped || promoHomebaseSkipped) {
    console.log(`☁️ R2 music sync: promos filtered — foreign=${promoForeignSkipped} legacy=${promoLegacySkipped} homebase=${promoHomebaseSkipped}`);
  }

  // Purge local files that no longer exist in R2 (homebase deletions propagate to fleet)
  if (remoteFiles.length > 0) {
    const r2PathSet = new Set(remoteFiles.map(f => f.path));
    const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac', '.wma']);

    function walkLocal(dir, base = '') {
      let results = [];
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const relPath = base ? `${base}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            results = results.concat(walkLocal(join(dir, entry.name), relPath));
          } else if (AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
            results.push(relPath);
          }
        }
      } catch {}
      return results;
    }

    const localFiles = walkLocal(musicDir);

    // Compute purge-relevant counts: exclude promo entries (own, foreign, legacy)
    // from BOTH sides before the gap check. Otherwise other devices' Promos__*
    // entries inflate remoteCount and let a partial listing of shared-genre
    // files slip past the safety check and wipe valid local non-promo tracks.
    const purgeRelevantRemote = remoteFiles.filter(f =>
      !f.path.startsWith('Promos/') && !f.path.startsWith('Promos__')
    ).length;
    const purgeRelevantLocal = localFiles.filter(relPath =>
      !relPath.startsWith('Promos/')
    ).length;

    // Safety: if R2 has >20% fewer non-promo files than local, skip purge.
    if (purgeRelevantLocal > 0 && purgeRelevantRemote < purgeRelevantLocal * 0.8) {
      console.warn(`⚠️ R2 sync purge SKIPPED: non-promo R2 count ${purgeRelevantRemote} vs local ${purgeRelevantLocal} (>20% gap). Manual review required before purging local files.`);
    } else {
      // Promos/ excluded from purge — they are user-created and irreplaceable; a transient/partial R2 listing
      // must NOT be able to wipe local promos. Promos still sync UP and DOWN, just never purge-deleted.
      const toDelete = localFiles.filter(relPath => !r2PathSet.has(relPath) && !relPath.startsWith('Promos/'));

      if (toDelete.length > 0) {
        let dbMod;
        try { dbMod = await import('./db.js'); } catch {}
        for (const relPath of toDelete) {
          const localPath = join(musicDir, relPath);
          try {
            unlinkSync(localPath);
            console.log(`🗑️ R2 sync purge: deleted local file no longer in R2: ${relPath}`);
            if (dbMod?.deleteMusicTrackByPath) {
              dbMod.deleteMusicTrackByPath(relPath);
            }
            purged++;
          } catch (e) {
            console.warn(`⚠️ R2 sync purge: could not delete ${relPath}: ${e.message}`);
          }
        }
        if (purged > 0) console.log(`🗑️ R2 sync purge complete: ${purged} file(s) removed to match homebase`);
      }
    }
  }

  console.log(`☁️ R2 music sync complete: ${downloaded} downloaded, ${skipped} already local, ${errors} errors, ${purged} purged`);
  return { downloaded, skipped, errors, purged };
}

export async function syncMusicToR2(musicDir, { purgeOrphans = false } = {}) {
  const client = getClient();
  if (!client) return { uploaded: 0, skipped: 0, errors: 0, purged: 0 };

  if (!existsSync(musicDir)) return { uploaded: 0, skipped: 0, errors: 0, purged: 0 };

  const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac', '.wma']);

  function walkLocal(dir, base = '') {
    let results = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results = results.concat(walkLocal(join(dir, entry.name), relPath));
      } else if (AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        results.push(relPath);
      }
    }
    return results;
  }

  const localFiles = walkLocal(musicDir);
  const localSet = new Set(localFiles);
  const remoteFiles = await listR2Music();
  const remoteMap = new Map(remoteFiles.map(f => [f.path, f.size]));

  let uploaded = 0, skipped = 0, errors = 0, purged = 0;

  console.log(`☁️ R2 music upload: ${localFiles.length} local files, ${remoteFiles.length} remote files`);

  let promoUploadSkipped = 0;
  for (const relPath of localFiles) {
    const r2RelPath = localToR2Key(relPath);
    if (r2RelPath === null) {
      promoUploadSkipped++;
      continue;
    }
    const localPath = join(musicDir, relPath);
    const localSize = statSync(localPath).size;

    if (remoteMap.has(r2RelPath) && remoteMap.get(r2RelPath) === localSize) {
      skipped++;
      continue;
    }

    try {
      const fileBuffer = readFileSync(localPath);
      const ext = extname(relPath).toLowerCase();
      const contentType = {
        '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
        '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.wma': 'audio/x-ms-wma',
      }[ext] || 'audio/mpeg';

      await client.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: `music/${r2RelPath}`,
        Body: fileBuffer,
        ContentType: contentType,
      }));
      uploaded++;
      if (uploaded % 50 === 0) {
        console.log(`☁️ R2 music upload progress: ${uploaded} uploaded so far...`);
      }
    } catch (err) {
      console.error(`☁️ R2: Failed to upload ${relPath}: ${err.message}`);
      errors++;
    }
  }
  if (promoUploadSkipped) {
    console.log(`☁️ R2 music upload: ${promoUploadSkipped} promo file(s) skipped (homebase does not upload promos)`);
  }

  // Homebase rewrite: delete R2 files not in local library
  if (purgeOrphans && localFiles.length > 0) {
    // Promos__*/ AND legacy Promos/ excluded from R2 purge:
    //  - homebase library being temporarily incomplete must NOT erase
    //    promos in cloud (which would then propagate back to venues on next pull).
    //  - homebase has no per-device Promos__<device>/ namespace anyway, so it
    //    must never reach in and delete another device's namespaced promos.
    const toDelete = remoteFiles.filter(f =>
      !localSet.has(f.path) &&
      !f.path.startsWith('Promos/') &&
      !f.path.startsWith('Promos__')
    );
    if (toDelete.length > 0) {
      console.log(`☁️ R2 purge: removing ${toDelete.length} R2 file(s) not in homebase library...`);
      for (const f of toDelete) {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: `music/${f.path}` }));
          console.log(`🗑️ R2 purge: deleted music/${f.path}`);
          purged++;
        } catch (err) {
          console.error(`☁️ R2 purge: failed to delete ${f.path}: ${err.message}`);
        }
      }
    }
  }

  console.log(`☁️ R2 music upload complete: ${uploaded} uploaded, ${skipped} already remote, ${errors} errors, ${purged} purged from R2`);
  return { uploaded, skipped, errors, purged };
}

// ─── Soundboard R2 Sync ───────────────────────────────────────────────────────

const SOUNDBOARD_MANIFEST_KEY = 'soundboard/manifest.json';

async function getSoundboardManifest() {
  const client = getClient();
  if (!client) return [];
  try {
    const res = await client.send(new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: SOUNDBOARD_MANIFEST_KEY,
    }));
    const chunks = [];
    for await (const chunk of res.Body) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    if (err.name === 'NoSuchKey') return [];
    console.error('☁️ R2: Failed to read soundboard manifest:', err.message);
    return [];
  }
}

async function putSoundboardManifest(sounds) {
  const client = getClient();
  if (!client) return;
  try {
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: SOUNDBOARD_MANIFEST_KEY,
      Body: JSON.stringify(sounds),
      ContentType: 'application/json',
    }));
  } catch (err) {
    console.error('☁️ R2: Failed to write soundboard manifest:', err.message);
  }
}

export async function uploadSoundboardFile(filePath, fileName, name) {
  const client = getClient();
  if (!client) return false;
  try {
    const fileBuffer = readFileSync(filePath);
    const ext = extname(fileName).toLowerCase();
    const contentType = {
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
    }[ext] || 'audio/mpeg';
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `soundboard/${fileName}`,
      Body: fileBuffer,
      ContentType: contentType,
      Metadata: { soundName: name },
    }));
    console.log(`☁️ R2: Uploaded soundboard/${fileName}`);
    return true;
  } catch (err) {
    console.error(`☁️ R2: Failed to upload soundboard/${fileName}: ${err.message}`);
    return false;
  }
}

export async function deleteSoundboardFileFromR2(fileName) {
  const client = getClient();
  if (!client) return;
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `soundboard/${fileName}`,
    }));
    console.log(`☁️ R2: Deleted soundboard/${fileName}`);
  } catch (err) {
    console.error(`☁️ R2: Failed to delete soundboard/${fileName}: ${err.message}`);
  }
}

export async function syncSoundboardToR2(sounds, soundboardDir) {
  const client = getClient();
  if (!client) return { uploaded: 0, skipped: 0, errors: 0 };
  let uploaded = 0, skipped = 0, errors = 0;

  for (const sound of sounds) {
    const filePath = join(soundboardDir, sound.file_name);
    if (!existsSync(filePath)) { errors++; continue; }
    try {
      const key = `soundboard/${sound.file_name}`;
      let needsUpload = true;
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
        const localSize = statSync(filePath).size;
        if (head.ContentLength === localSize) needsUpload = false;
      } catch {}
      if (!needsUpload) { skipped++; continue; }
      await uploadSoundboardFile(filePath, sound.file_name, sound.name);
      uploaded++;
    } catch (err) {
      console.error(`☁️ R2: soundboard upload error ${sound.file_name}: ${err.message}`);
      errors++;
    }
  }

  await putSoundboardManifest(sounds.map(s => ({ name: s.name, file_name: s.file_name })));
  console.log(`☁️ R2 soundboard upload: ${uploaded} uploaded, ${skipped} already remote, ${errors} errors`);
  return { uploaded, skipped, errors };
}

export async function syncSoundboardFromR2(soundboardDir) {
  const client = getClient();
  if (!client) return { downloaded: 0, skipped: 0, errors: 0, purged: 0, sounds: [] };

  if (!existsSync(soundboardDir)) mkdirSync(soundboardDir, { recursive: true });

  const manifest = await getSoundboardManifest();
  let downloaded = 0, skipped = 0, errors = 0, purged = 0;

  const manifestFileNames = new Set(manifest.map(s => s.file_name));

  for (const sound of manifest) {
    const localPath = join(soundboardDir, sound.file_name);
    if (existsSync(localPath)) {
      try {
        const key = `soundboard/${sound.file_name}`;
        const head = await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
        const localSize = statSync(localPath).size;
        if (head.ContentLength === localSize) { skipped++; continue; }
      } catch {}
    }
    try {
      const res = await client.send(new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: `soundboard/${sound.file_name}`,
      }));
      const ws = createWriteStream(localPath);
      await pipeline(res.Body, ws);
      downloaded++;
      console.log(`☁️ R2: Downloaded soundboard/${sound.file_name}`);
    } catch (err) {
      if (err.name !== 'NoSuchKey') {
        console.error(`☁️ R2: Failed to download soundboard/${sound.file_name}: ${err.message}`);
      }
      errors++;
    }
  }

  // Purge local files no longer in manifest
  if (manifest.length > 0 && existsSync(soundboardDir)) {
    const localFiles = readdirSync(soundboardDir).filter(f => /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(f));
    for (const f of localFiles) {
      if (!manifestFileNames.has(f)) {
        try {
          unlinkSync(join(soundboardDir, f));
          purged++;
          console.log(`🗑️ Soundboard purge: removed ${f} (not in homebase manifest)`);
        } catch {}
      }
    }
  }

  console.log(`☁️ R2 soundboard sync: ${downloaded} downloaded, ${skipped} already local, ${errors} errors, ${purged} purged`);
  return { downloaded, skipped, errors, purged, sounds: manifest };
}

export async function getR2Stats() {
  const client = getClient();
  if (!client) return { configured: false };

  try {
    const voiceovers = await listR2Voiceovers();
    const music = await listR2Music();

    const voiceoverSize = voiceovers.reduce((sum, f) => sum + f.size, 0);
    const musicSize = music.reduce((sum, f) => sum + f.size, 0);

    return {
      configured: true,
      voiceovers: { count: voiceovers.length, sizeBytes: voiceoverSize, sizeMB: Math.round(voiceoverSize / 1024 / 1024) },
      music: { count: music.length, sizeBytes: musicSize, sizeMB: Math.round(musicSize / 1024 / 1024) },
    };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}

export async function backupDancersToR2(deviceId, dancers, settings = {}) {
  const client = getClient();
  if (!client || !deviceId) return false;
  try {
    const payload = JSON.stringify({ device_id: deviceId, backed_up_at: new Date().toISOString(), dancers, settings }, null, 2);
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `dancer-backups/${deviceId}/dancers.json`,
      Body: payload,
      ContentType: 'application/json',
      Metadata: { deviceId, dancerCount: String(dancers.length) },
    }));
    console.log(`☁️ R2: Backed up ${dancers.length} dancer(s) for ${deviceId}`);
    return true;
  } catch (err) {
    console.error(`☁️ R2: Dancer backup failed for ${deviceId}: ${err.message}`);
    return false;
  }
}

export async function restoreDancersFromR2(deviceId) {
  const client = getClient();
  if (!client || !deviceId) return null;
  try {
    const res = await client.send(new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `dancer-backups/${deviceId}/dancers.json`,
    }));
    const chunks = [];
    for await (const chunk of res.Body) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    const data = JSON.parse(text);
    console.log(`☁️ R2: Found dancer backup for ${deviceId} — ${data.dancers?.length || 0} dancer(s)`);
    return data;
  } catch (err) {
    if (err.name !== 'NoSuchKey') console.error(`☁️ R2: Dancer restore failed for ${deviceId}: ${err.message}`);
    return null;
  }
}
