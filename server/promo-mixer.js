import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getMusicTracks, getSetting } from './db.js';
import { scanMusicFolder } from './musicScanner.js';
import { trackError } from './error-tracker.js';

const mixStatus = new Map();

export function getMixStatus(cacheKey) {
  return mixStatus.get(cacheKey) || null;
}

export function getAllMixStatuses() {
  return Object.fromEntries(mixStatus);
}

function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', () => {
      const dur = parseFloat(out.trim());
      if (isNaN(dur) || dur <= 0) reject(new Error('Could not read audio duration'));
      else resolve(dur);
    });
    proc.on('error', reject);
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
    });
    proc.on('error', reject);
  });
}

export async function mixPromoFile(voiceFilePath, bedFilePath, outputPath) {
  const voiceDur = await getAudioDuration(voiceFilePath);
  const introSec = 9;
  const outroSec = 5;
  const fadeSec = 2;
  const totalDur = introSec + voiceDur + outroSec;
  const fadeStart = Math.max(0, totalDur - fadeSec);
  const duckVol = 0.12;
  const voiceStartMs = introSec * 1000;

  const filter = [
    `[0:a]apad=pad_dur=${totalDur},atrim=0:${totalDur},asetpts=PTS-STARTPTS[bed_raw]`,
    `[bed_raw]volume=enable='between(t,${introSec},${introSec + voiceDur})':volume=${duckVol}:eval=frame,afade=t=out:st=${fadeStart}:d=${fadeSec}[bed_proc]`,
    `[1:a]adelay=${voiceStartMs}|${voiceStartMs}[voice_del]`,
    `[bed_proc][voice_del]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`
  ].join(';');

  await runFfmpeg([
    '-y',
    '-i', bedFilePath,
    '-i', voiceFilePath,
    '-filter_complex', filter,
    '-map', '[out]',
    '-b:a', '192k',
    '-ar', '44100',
    outputPath
  ]);
}

export async function processPromo(cacheKey, voiceFilePath, promoName) {
  if (mixStatus.get(cacheKey)?.status === 'processing') return;
  mixStatus.set(cacheKey, { status: 'processing', startedAt: Date.now() });

  try {
    const musicPath = getSetting('music_path');
    if (!musicPath || !existsSync(musicPath)) {
      throw new Error('Music path not configured');
    }

    const { tracks: beds } = getMusicTracks({ genre: 'Promo Beds', limit: 200 });
    if (!beds || beds.length === 0) {
      throw new Error('No Promo Beds tracks in library');
    }
    const bed = beds[Math.floor(Math.random() * beds.length)];
    const bedFilePath = join(musicPath, bed.path);
    if (!existsSync(bedFilePath)) {
      throw new Error(`Promo Bed file missing: ${bedFilePath}`);
    }

    const promosDir = join(musicPath, 'Promos');
    if (!existsSync(promosDir)) mkdirSync(promosDir, { recursive: true });

    const safeKey = cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputPath = join(promosDir, `${safeKey}.mp3`);

    console.log(`📺 Mixing promo: "${promoName}" over bed "${bed.name}"`);
    await mixPromoFile(voiceFilePath, bedFilePath, outputPath);

    scanMusicFolder(musicPath);

    mixStatus.set(cacheKey, { status: 'done', outputPath, completedAt: Date.now() });
    console.log(`📺 Promo ready: ${outputPath}`);
    return outputPath;
  } catch (err) {
    console.error(`📺 Promo mix failed [${cacheKey}]:`, err.message);
    mixStatus.set(cacheKey, { status: 'error', error: err.message });
    trackError('promo_mix_failed', err.message, { component: 'promo-mixer', extra: { cacheKey, promoName } });
    throw err;
  }
}

export async function convertAllExistingPromos(listVoiceovers, getVoiceoverFilePath) {
  const all = listVoiceovers();
  const promos = all.filter(v => v.type === 'promo' || v.type === 'manual');
  console.log(`📺 Converting ${promos.length} existing promos to pre-mixed MP3...`);
  let success = 0, failed = 0, skipped = 0;
  for (const promo of promos) {
    const existing = mixStatus.get(promo.cache_key);
    if (existing?.status === 'done') { skipped++; continue; }
    try {
      const voiceFilePath = getVoiceoverFilePath(promo.cache_key);
      if (!voiceFilePath) { failed++; continue; }
      await processPromo(promo.cache_key, voiceFilePath, promo.dancer_name || promo.cache_key);
      success++;
    } catch { failed++; }
  }
  console.log(`📺 Conversion complete — ${success} done, ${failed} failed, ${skipped} already done`);
  return { success, failed, skipped, total: promos.length };
}
