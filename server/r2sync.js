import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, createWriteStream } from 'fs';
import { join, basename, extname } from 'path';
import { pipeline } from 'stream/promises';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'neonaidj';

let s3Client = null;

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
    });
  }
  return s3Client;
}

export function isR2Configured() {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
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
    await pipeline(response.Body, ws);

    console.log(`☁️ R2: Downloaded voiceover ${safeName}`);
    return destPath;
  } catch (err) {
    if (err.name !== 'NoSuchKey') {
      console.error(`☁️ R2: Failed to download voiceover ${safeName}: ${err.message}`);
    }
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
    await pipeline(response.Body, ws);

    return destPath;
  } catch (err) {
    if (err.name !== 'NoSuchKey') {
      console.error(`☁️ R2: Failed to download music ${relativePath}: ${err.message}`);
    }
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
  if (!client) return { downloaded: 0, skipped: 0, errors: 0 };

  if (!existsSync(musicDir)) mkdirSync(musicDir, { recursive: true });

  const remoteFiles = await listR2Music();
  let downloaded = 0, skipped = 0, errors = 0;

  console.log(`☁️ R2 music sync: ${remoteFiles.length} files in cloud, checking local...`);

  for (const file of remoteFiles) {
    const localPath = join(musicDir, file.path);
    let force = false;
    if (existsSync(localPath)) {
      const localSize = statSync(localPath).size;
      if (localSize === file.size) {
        skipped++;
        continue;
      }
      force = true;
    }

    const result = await downloadMusicTrack(file.path, musicDir, force);
    if (result) {
      downloaded++;
      if (downloaded % 50 === 0) {
        console.log(`☁️ R2 music sync progress: ${downloaded} downloaded so far...`);
      }
    } else {
      errors++;
    }
  }

  console.log(`☁️ R2 music sync complete: ${downloaded} downloaded, ${skipped} already local, ${errors} errors`);
  return { downloaded, skipped, errors };
}

export async function syncMusicToR2(musicDir) {
  const client = getClient();
  if (!client) return { uploaded: 0, skipped: 0, errors: 0 };

  if (!existsSync(musicDir)) return { uploaded: 0, skipped: 0, errors: 0 };

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
  const remoteFiles = await listR2Music();
  const remoteMap = new Map(remoteFiles.map(f => [f.path, f.size]));

  let uploaded = 0, skipped = 0, errors = 0;

  console.log(`☁️ R2 music upload: ${localFiles.length} local files, ${remoteFiles.length} remote files`);

  for (const relPath of localFiles) {
    const localPath = join(musicDir, relPath);
    const localSize = statSync(localPath).size;

    if (remoteMap.has(relPath) && remoteMap.get(relPath) === localSize) {
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
        Key: `music/${relPath}`,
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

  console.log(`☁️ R2 music upload complete: ${uploaded} uploaded, ${skipped} already remote, ${errors} errors`);
  return { uploaded, skipped, errors };
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
