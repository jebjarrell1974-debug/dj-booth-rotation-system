import { spawn } from 'child_process';
import { join } from 'path';
import { updateTrackLufs, getTracksNeedingAnalysis } from './db.js';

const LUFS_TARGET = -10;
const LUFS_GAIN_MIN = 0.3;
const LUFS_GAIN_MAX = 2.5;
const LUFS_CONCURRENCY = 3;
const BATCH_SIZE = 60;
const INTER_BATCH_DELAY_MS = 150;
const ANALYSIS_TIMEOUT_MS = 300000;

let isRunning = false;
let progressStats = { analyzed: 0, errors: 0, total: 0, startedAt: null };

function analyzeSingleTrack(filePath) {
  return new Promise((resolve) => {
    const args = [
      '-i', filePath,
      '-af', `loudnorm=I=${LUFS_TARGET}:TP=-1:LRA=11:print_format=json`,
      '-f', 'null', '-'
    ];

    let stderr = '';
    let proc;
    try {
      proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (spawnErr) {
      console.warn('⚠️ LUFS: ffmpeg spawn failed:', spawnErr.message);
      return resolve(null);
    }

    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve(null);
    }, ANALYSIS_TIMEOUT_MS);

    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const match = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
        if (!match) return resolve(null);
        const data = JSON.parse(match[0]);
        const lufs = parseFloat(data.input_i);
        if (isNaN(lufs) || lufs < -100 || lufs > 0) return resolve(null);
        const gainDb = LUFS_TARGET - lufs;
        const gainLinear = Math.pow(10, gainDb / 20);
        const gain = Math.max(LUFS_GAIN_MIN, Math.min(LUFS_GAIN_MAX, gainLinear));
        resolve({ lufs, gain });
      } catch {
        resolve(null);
      }
    });

    proc.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

async function processBatch(musicPath) {
  const tracks = getTracksNeedingAnalysis(BATCH_SIZE);
  if (tracks.length === 0) return false;

  const promises = [];
  for (let i = 0; i < tracks.length; i += LUFS_CONCURRENCY) {
    const chunk = tracks.slice(i, i + LUFS_CONCURRENCY);
    await Promise.all(
      chunk.map(async (track) => {
        const filePath = join(musicPath, track.path);
        const result = await analyzeSingleTrack(filePath);
        if (result) {
          updateTrackLufs(track.path, result.lufs, result.gain);
          progressStats.analyzed++;
        } else {
          updateTrackLufs(track.path, null, null);
          progressStats.errors++;
        }
      })
    );
    await new Promise(r => setTimeout(r, INTER_BATCH_DELAY_MS));
  }

  return true;
}

export async function startLufsAnalysis(musicPath) {
  if (!musicPath) return;
  if (isRunning) {
    console.log('🔊 LUFS: Analysis already running, skipping duplicate start');
    return;
  }

  isRunning = true;
  progressStats = { analyzed: 0, errors: 0, total: 0, startedAt: new Date().toISOString() };

  console.log('🔊 LUFS: Background analysis starting (target: ' + LUFS_TARGET + ' LUFS, concurrency: ' + LUFS_CONCURRENCY + ')');

  try {
    while (await processBatch(musicPath)) {
      const { analyzed, errors } = progressStats;
      if ((analyzed + errors) % 300 === 0 && analyzed + errors > 0) {
        console.log(`🔊 LUFS: Progress — ${analyzed} analyzed, ${errors} failed`);
      }
    }
    console.log(`✅ LUFS: Complete — ${progressStats.analyzed} analyzed, ${progressStats.errors} failed`);
  } catch (err) {
    console.error('❌ LUFS: Analysis error:', err.message);
  } finally {
    isRunning = false;
  }
}

export function getLufsAnalysisProgress() {
  return { ...progressStats, isRunning };
}

export function isLufsAnalysisRunning() {
  return isRunning;
}
