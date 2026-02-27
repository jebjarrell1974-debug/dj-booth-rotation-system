import { readdirSync, statSync } from 'fs';
import { join, extname, basename, relative } from 'path';
import { bulkUpsertTracks, removeDeletedTracks, setSetting, getMusicTrackCount } from './db.js';

const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma']);

function walkDirectory(dirPath, rootPath, results = []) {
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.warn(`⚠️ MusicScanner: Cannot read directory ${dirPath}: ${err.message}`);
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(fullPath, rootPath, results);
    } else if (entry.isFile()) {
      if (entry.name.startsWith('._') || entry.name.startsWith('.')) continue;
      const ext = extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        const relPath = relative(rootPath, fullPath);
        const parts = relPath.split('/');
        const genre = parts.length > 1 ? parts[0] : '';
        let size = 0;
        let mtime = '';
        try {
          const stat = statSync(fullPath);
          size = stat.size;
          mtime = stat.mtime.toISOString();
        } catch {}
        results.push({
          name: entry.name,
          path: relPath,
          genre,
          size,
          modifiedAt: mtime
        });
      }
    }
  }
  return results;
}

export function scanMusicFolder(musicPath) {
  if (!musicPath) {
    console.log('🎵 MusicScanner: No MUSIC_PATH configured, skipping scan');
    return { added: 0, removed: 0, total: 0 };
  }

  const startTime = Date.now();
  console.log(`🎵 MusicScanner: Scanning ${musicPath}...`);

  const tracks = walkDirectory(musicPath, musicPath);
  const existingPaths = tracks.map(t => t.path);

  bulkUpsertTracks(tracks);
  const removed = removeDeletedTracks(existingPaths) || 0;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  setSetting('last_music_scan', new Date().toISOString());

  const totalInDb = getMusicTrackCount();
  console.log(`🎵 MusicScanner: Found ${tracks.length} tracks, removed ${removed}, total ${totalInDb} in ${elapsed}s`);
  return { added: tracks.length, removed, total: totalInDb };
}

let scanInterval = null;

export function startPeriodicScan(musicPath, intervalMinutes = 5) {
  if (scanInterval) clearInterval(scanInterval);
  scanInterval = setInterval(() => {
    try {
      scanMusicFolder(musicPath);
    } catch (err) {
      console.error('❌ MusicScanner: Periodic scan failed:', err.message);
    }
  }, intervalMinutes * 60 * 1000);
}

export function stopPeriodicScan() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}
