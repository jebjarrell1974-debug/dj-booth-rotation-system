import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { join, extname } from 'path';
import { runFfmpeg, getAudioDuration } from './promo-mixer.js';
import { getMusicTracks } from './db.js';
import { trackError } from './error-tracker.js';

const FEATURE_BED_GENRE = 'Promo Beds';

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);
const BED_DUCK_VOL = 0.18;
const BED_LEAD_IN_SEC = 1.5;
const BED_TAIL_INTRO_SEC = 0.8;
const BED_TAIL_OUTRO_SEC = 4.0;
const OUTRO_FADE_SEC = 3.0;

export function listFeatureBeds(musicPath) {
  if (!musicPath) return [];
  const dir = join(musicPath, 'feature-beds');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => AUDIO_EXT.has(extname(f).toLowerCase()))
      .map(f => ({ name: f, path: join(dir, f) }));
  } catch {
    return [];
  }
}

export function listMusicFolders(musicPath) {
  if (!musicPath || !existsSync(musicPath)) return [];
  try {
    return readdirSync(musicPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function listFolderTracks(musicPath, folderName) {
  if (!musicPath || !folderName) return [];
  const dir = join(musicPath, folderName);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => AUDIO_EXT.has(extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function mixFeatureAudio({ voiceFilePath, bedFilePath, outputPath, mode }) {
  const voiceDur = await getAudioDuration(voiceFilePath);
  const isIntro = mode === 'intro';
  const tailSec = isIntro ? BED_TAIL_INTRO_SEC : BED_TAIL_OUTRO_SEC;
  const totalDur = BED_LEAD_IN_SEC + voiceDur + tailSec;
  const voiceStartMs = Math.round(BED_LEAD_IN_SEC * 1000);
  const duckStart = BED_LEAD_IN_SEC;
  const duckEnd = BED_LEAD_IN_SEC + voiceDur;

  const bedChain = [
    `[0:a]apad=pad_dur=${totalDur},atrim=0:${totalDur},asetpts=PTS-STARTPTS[bed_raw]`,
    `[bed_raw]volume=enable='between(t,${duckStart.toFixed(3)},${duckEnd.toFixed(3)})':volume=${BED_DUCK_VOL}:eval=frame[bed_ducked]`,
  ];

  let bedFinalLabel = '[bed_ducked]';
  if (!isIntro) {
    const fadeStart = Math.max(0, totalDur - OUTRO_FADE_SEC);
    bedChain.push(`[bed_ducked]afade=t=out:st=${fadeStart.toFixed(3)}:d=${OUTRO_FADE_SEC}[bed_proc]`);
    bedFinalLabel = '[bed_proc]';
  } else {
    bedChain.push(`[bed_ducked]asetpts=PTS-STARTPTS[bed_proc]`);
    bedFinalLabel = '[bed_proc]';
  }

  const filter = [
    ...bedChain,
    `[1:a]adelay=${voiceStartMs}|${voiceStartMs}[voice_del]`,
    `${bedFinalLabel}[voice_del]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`,
  ].join(';');

  await runFfmpeg([
    '-y',
    '-i', bedFilePath,
    '-i', voiceFilePath,
    '-filter_complex', filter,
    '-map', '[out]',
    '-b:a', '192k',
    '-ar', '44100',
    outputPath,
  ]);
}

export async function produceFeatureAudio({
  musicPath,
  voiceBuffer,
  mode,
  bedFileName,
}) {
  if (!musicPath) throw new Error('MUSIC_PATH not configured');
  if (!voiceBuffer || !voiceBuffer.length) throw new Error('voice audio is empty');
  if (mode !== 'intro' && mode !== 'outro') throw new Error('mode must be intro or outro');

  // Beds now come from the "Promo Beds" music genre (DB), not the music/feature-beds/ folder.
  // A random Promo Bed is chosen for each intro/outro production.
  const { tracks: beds } = getMusicTracks({ genre: FEATURE_BED_GENRE, limit: 200 });
  if (!beds || !beds.length) {
    throw new Error(`No "${FEATURE_BED_GENRE}" tracks in the music library — add beds to the ${FEATURE_BED_GENRE} genre.`);
  }
  let bed = beds[Math.floor(Math.random() * beds.length)];
  if (bedFileName) {
    const found = beds.find(b => b.name === bedFileName || b.path === bedFileName);
    if (found) bed = found;
  }
  const bedFilePath = join(musicPath, bed.path);
  if (!existsSync(bedFilePath)) {
    throw new Error(`Promo Bed file missing on disk: ${bedFilePath}`);
  }

  const tmpDir = '/tmp';
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const voiceTmp = join(tmpDir, `feat_voice_${stamp}.mp3`);
  const outTmp = join(tmpDir, `feat_mixed_${stamp}.mp3`);

  try {
    writeFileSync(voiceTmp, voiceBuffer);
    await mixFeatureAudio({
      voiceFilePath: voiceTmp,
      bedFilePath,
      outputPath: outTmp,
      mode,
    });
    const stat = statSync(outTmp);
    const { readFileSync } = await import('fs');
    const mixedBuffer = readFileSync(outTmp);
    return { mixedBuffer, sizeBytes: stat.size, bedUsed: bed.name };
  } catch (err) {
    trackError('feature_mix_failed', err.message, { component: 'feature-producer', extra: { mode, bedFileName } });
    throw err;
  } finally {
    try { unlinkSync(voiceTmp); } catch {}
    try { unlinkSync(outTmp); } catch {}
  }
}

export function featureCacheKey(dancerId, mode) {
  const safe = String(dancerId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `feature_${mode}_produced_${safe}`;
}

export function ensureFeatureBedsFolder(musicPath) {
  if (!musicPath) return;
  const dir = join(musicPath, 'feature-beds');
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch {}
  }
}
