import { spawn } from 'child_process';
import { join } from 'path';
import { updateTrackBpm, getTracksNeedingBpmAnalysis } from './db.js';

const BPM_CONCURRENCY = 1;
const BATCH_SIZE = 20;
const INTER_BATCH_DELAY_MS = 500;
const ANALYSIS_TIMEOUT_MS = 60000;

let isRunning = false;
let progressStats = { analyzed: 0, errors: 0, skipped: 0, startedAt: null };

function normalizeBpm(bpm) {
  if (!bpm || bpm < 20) return null;
  let b = bpm;
  while (b < 70) b *= 2;
  while (b > 175) b /= 2;
  return Math.round(b * 10) / 10;
}

function readEmbeddedBpmTag(filePath) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format_tags=bpm',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ];
    let output = '';
    let proc;
    try {
      proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return resolve(null);
    }
    proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} resolve(null); }, 8000);
    proc.on('close', () => {
      clearTimeout(timer);
      const val = parseFloat(output.trim());
      if (!isNaN(val) && val > 0) return resolve(normalizeBpm(val));
      resolve(null);
    });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

function detectBpmWithAubio(filePath) {
  return new Promise((resolve) => {
    const args = ['-i', filePath, '-B', '2048', '-H', '512'];
    let output = '';
    let proc;
    try {
      proc = spawn('aubio', ['tempo', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return resolve(null);
    }
    proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
    proc.stderr.on('data', () => {});
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} resolve(null); }, ANALYSIS_TIMEOUT_MS);
    proc.on('close', () => {
      clearTimeout(timer);
      const lines = output.trim().split('\n').filter(Boolean);
      const lastLine = lines[lines.length - 1];
      const val = parseFloat(lastLine);
      if (!isNaN(val) && val > 0) return resolve(normalizeBpm(val));
      resolve(null);
    });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

async function analyzeSingleTrackBpm(filePath) {
  const tagged = await readEmbeddedBpmTag(filePath);
  if (tagged) {
    return tagged;
  }
  const detected = await detectBpmWithAubio(filePath);
  return detected;
}

async function processBatch(musicPath) {
  const tracks = getTracksNeedingBpmAnalysis(BATCH_SIZE);
  if (tracks.length === 0) return false;

  for (let i = 0; i < tracks.length; i += BPM_CONCURRENCY) {
    const chunk = tracks.slice(i, i + BPM_CONCURRENCY);
    await Promise.all(
      chunk.map(async (track) => {
        const filePath = join(musicPath, track.path);
        const bpm = await analyzeSingleTrackBpm(filePath);
        if (bpm) {
          updateTrackBpm(track.path, bpm);
          progressStats.analyzed++;
        } else {
          updateTrackBpm(track.path, null);
          progressStats.errors++;
        }
      })
    );
    await new Promise(r => setTimeout(r, INTER_BATCH_DELAY_MS));
  }

  return true;
}

export async function startBpmAnalysis(musicPath) {
  if (!musicPath) return;
  if (isRunning) {
    console.log('🎵 BPM: Analysis already running, skipping duplicate start');
    return;
  }

  isRunning = true;
  progressStats = { analyzed: 0, errors: 0, skipped: 0, startedAt: new Date().toISOString() };

  console.log('🎵 BPM: Background analysis starting (ffprobe tag → aubio fallback)');

  try {
    while (await processBatch(musicPath)) {
      const { analyzed, errors } = progressStats;
      if ((analyzed + errors) % 200 === 0 && analyzed + errors > 0) {
        console.log(`🎵 BPM: Progress — ${analyzed} analyzed, ${errors} no-bpm`);
      }
    }
    console.log(`✅ BPM: Complete — ${progressStats.analyzed} analyzed, ${progressStats.errors} no-bpm`);
  } catch (err) {
    console.error('❌ BPM: Analysis error:', err.message);
  } finally {
    isRunning = false;
  }
}

export function isBpmAnalysisRunning() {
  return isRunning;
}

export function getBpmAnalysisProgress() {
  return { ...progressStats, isRunning };
}
