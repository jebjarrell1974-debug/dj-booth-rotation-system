import { readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { bulkUpsertTracks, removeDeletedTracks, setSetting, getMusicTrackCount } from './db.js';

const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma']);

let lastScanPaths = null;
let lastScanSizes = null;
let lastTopLevelCount = -1;

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

function quickDirectoryCheck(musicPath) {
  try {
    const entries = readdirSync(musicPath, { withFileTypes: true });
    let topLevelCount = 0;
    for (const entry of entries) {
      if (entry.isDirectory() || (entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase()))) {
        topLevelCount++;
      }
    }
    return topLevelCount;
  } catch {
    return -1;
  }
}

export function scanMusicFolder(musicPath, forceFullScan = false) {
  if (!musicPath) {
    console.log('🎵 MusicScanner: No MUSIC_PATH configured, skipping scan');
    return { added: 0, removed: 0, total: 0, skipped: false };
  }

  if (!forceFullScan && lastScanPaths) {
    const topLevelCount = quickDirectoryCheck(musicPath);
    if (topLevelCount >= 0 && topLevelCount === lastTopLevelCount && lastScanPaths.size === getMusicTrackCount()) {
      console.log(`🎵 MusicScanner: Quick check — no changes detected (${lastScanPaths.size} tracks), skipping full scan`);
      setSetting('last_music_scan', new Date().toISOString());
      return { added: 0, removed: 0, total: lastScanPaths.size, skipped: true };
    }
  }

  const startTime = Date.now();
  console.log(`🎵 MusicScanner: ${forceFullScan ? 'Full' : 'Incremental'} scan of ${musicPath}...`);

  const tracks = walkDirectory(musicPath, musicPath);
  const currentPaths = new Set(tracks.map(t => t.path));
  const currentSizes = new Map(tracks.map(t => [t.path, t.size]));

  let changedTracks = tracks;
  if (!forceFullScan && lastScanPaths && lastScanSizes) {
    changedTracks = tracks.filter(t => {
      if (!lastScanPaths.has(t.path)) return true;
      if (lastScanSizes.get(t.path) !== t.size) return true;
      return false;
    });
    const removedPaths = [];
    for (const oldPath of lastScanPaths) {
      if (!currentPaths.has(oldPath)) removedPaths.push(oldPath);
    }
    if (changedTracks.length === 0 && removedPaths.length === 0) {
      console.log(`🎵 MusicScanner: No changes detected in ${tracks.length} tracks (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
      lastScanPaths = currentPaths;
      lastScanSizes = currentSizes;
      setSetting('last_music_scan', new Date().toISOString());
      return { added: 0, removed: 0, total: tracks.length, skipped: false };
    }
    console.log(`🎵 MusicScanner: ${changedTracks.length} changed/new, ${removedPaths.length} removed`);
  }

  if (changedTracks.length > 0) {
    bulkUpsertTracks(changedTracks);
  }
  const existingPaths = tracks.map(t => t.path);
  const removed = removeDeletedTracks(existingPaths) || 0;

  lastScanPaths = currentPaths;
  lastScanSizes = currentSizes;
  lastTopLevelCount = quickDirectoryCheck(musicPath);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  setSetting('last_music_scan', new Date().toISOString());

  const totalInDb = getMusicTrackCount();
  console.log(`🎵 MusicScanner: Upserted ${changedTracks.length}, removed ${removed}, total ${totalInDb} in ${elapsed}s`);
  return { added: changedTracks.length, removed, total: totalInDb };
}

let scanInterval = null;

export function startPeriodicScan(musicPath, intervalMinutes = 30) {
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
