import express from 'express';
import compression from 'compression';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, statSync, createReadStream, readdirSync, unlinkSync } from 'fs';
import { networkInterfaces, hostname } from 'os';
import {
  getSetting, setSetting, hashPin, verifyPin,
  createDancer, getDancer, getDancerByPin, listDancers, updateDancer, deleteDancer, invalidateDancerSessions,
  createSession, getSession, touchSession, deleteSession, cleanExpiredSessions,
  syncSongs, listSongs,
  saveVoiceover, getVoiceover, getVoiceoverFilePath, listVoiceovers, deleteVoiceover, deleteVoiceoversByDancer,
  clearAllVoiceovers, cleanupOrphanedVoiceovers,
  getVoiceoverDirPath,
  closeDatabase, stopCheckpoints,
  getMusicTracks, getMusicGenres, getMusicTrackById, getMusicTrackByName, getRandomTracks, selectTracksForSet, getMusicTrackCount, getLastScanTime, deleteMusicTrackFromDB,
  logPlayHistory, getPlayHistory, getPlayHistoryDates, getPlayHistoryStats, cleanOldPlayHistory, getRecentCooldowns,
  blockTrack, unblockTrack, getBlockedTracks,
  logApiUsage, getApiUsageSummary, getApiUsageByDevice, cleanOldApiUsage,
  exportDancers, importDancers, saveClientSettings, getClientSettings,
  getLufsStats, bulkUpdateTrackAnalysis, getTracksNeedingAnyAnalysis
} from './db.js';
import { startLufsAnalysis, getLufsAnalysisProgress, isLufsAnalysisRunning } from './lufsAnalyzer.js';
import { startBpmAnalysis, isBpmAnalysisRunning } from './bpmAnalyzer.js';
import { createPromoRequest, listPromoRequests } from './fleet-db.js';
import { scanMusicFolder, startPeriodicScan, stopPeriodicScan } from './musicScanner.js';
import fleetRoutes from './fleet-routes.js';
import { isR2Configured, uploadVoiceover, syncVoiceoversFromR2, syncVoiceoversToR2, syncMusicFromR2, syncMusicToR2, getR2Stats, deleteFromR2Music } from './r2sync.js';
import { setupFleetMonitorRoutes, startMonitoring, stopMonitoring } from './fleet-monitor.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

const bootStatus = {
  ready: false,
  startedAt: Date.now(),
  steps: {
    server: { status: 'running', label: 'Starting server' },
    musicScan: { status: 'pending', label: 'Scanning music library', detail: '' },
    voiceoverSync: { status: 'pending', label: 'Syncing voiceovers', detail: '' },
    voiceoverUpload: { status: 'pending', label: 'Uploading voiceovers', detail: '' },
    musicSync: { status: 'pending', label: 'Syncing music from cloud', detail: '' },
    musicUpload: { status: 'pending', label: 'Uploading music to cloud', detail: '' },
  }
};

function updateBootStep(step, status, detail) {
  if (bootStatus.steps[step]) {
    bootStatus.steps[step].status = status;
    if (detail !== undefined) bootStatus.steps[step].detail = detail;
  }
}

if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.url === '/' || req.url === '/__health') {
      console.log(`📥 ${req.method} ${req.url} from ${req.ip}`);
    }
    next();
  });
}

app.use(compression());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '50mb' }));

const DANCER_TIMEOUT_MS = 4 * 60 * 60 * 1000;

let liveBoothState = {
  isRotationActive: false,
  currentDancerIndex: 0,
  currentDancerName: null,
  currentTrack: null,
  currentSongNumber: 0,
  songsPerSet: 3,
  isPlaying: false,
  rotation: [],
  announcementsEnabled: true,
  rotationSongs: {},
  updatedAt: 0,
};

let remoteCommandQueue = [];
let commandIdCounter = 0;
let errorCounter = 0;
const origConsoleError = console.error;
console.error = (...args) => { errorCounter++; origConsoleError.apply(console, args); };

setInterval(() => cleanExpiredSessions(DANCER_TIMEOUT_MS), 30 * 1000);
setInterval(() => cleanOldPlayHistory(90), 24 * 60 * 60 * 1000);
setInterval(() => cleanOldApiUsage(180), 24 * 60 * 60 * 1000);

function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: 'Invalid session' });
  
  if (session.role === 'dancer') {
    const elapsed = Date.now() - session.last_seen;
    if (elapsed > DANCER_TIMEOUT_MS) {
      deleteSession(token);
      return res.status(401).json({ error: 'Session expired' });
    }
    touchSession(token);
  }
  
  req.session = session;
  next();
}

function requireDJ(req, res, next) {
  if (req.session.role !== 'dj') return res.status(403).json({ error: 'DJ access required' });
  next();
}

const DEFAULT_MASTER_PIN = '36669';

function getMasterPin() {
  return getSetting('master_pin') || DEFAULT_MASTER_PIN;
}

app.get('/__health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/api/fleet-env', (req, res) => {
  if (process.env.IS_HOMEBASE !== 'true') {
    return res.status(403).send('Only available on homebase');
  }
  const FLEET_KEYS = [
    'PORT', 'NODE_ENV', 'FLEET_SERVER_URL',
    'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID',
    'OPENAI_API_KEY', 'AUPHONIC_API_KEY',
    'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'
  ];
  const lines = [];
  for (const key of FLEET_KEYS) {
    let val = process.env[key] || '';
    if (key === 'FLEET_SERVER_URL') val = `http://100.95.238.71:3001`;
    if (key === 'PORT') val = '3001';
    if (key === 'NODE_ENV') val = 'production';
    if (val) lines.push(`${key}=${val}`);
  }
  res.type('text/plain').send(lines.join('\n') + '\n');
});

app.get('/api/boot-status', (req, res) => {
  const steps = Object.entries(bootStatus.steps)
    .filter(([, s]) => s.status !== 'skipped')
    .map(([key, s]) => ({ id: key, ...s }));
  res.json({
    ready: bootStatus.ready,
    elapsed: Math.round((Date.now() - bootStatus.startedAt) / 1000),
    steps,
  });
});

app.get('/api/server-info', (req, res) => {
  const nets = networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ interface: name, address: net.address });
      }
    }
  }
  res.json({ ips, port: process.env.PORT || 3001 });
});

app.post('/api/auth/auto-login', (req, res) => {
  const clientIp = req.ip || req.connection?.remoteAddress || '';
  const isLocal = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
  if (!isLocal) {
    return res.status(403).json({ error: 'Auto-login only available from localhost' });
  }
  const token = createSession('dj');
  return res.json({ token, role: 'dj' });
});

app.post('/api/auth/login', (req, res) => {
  const { role, pin } = req.body;
  
  if (!role || !pin || pin.length !== 5) {
    return res.status(400).json({ error: 'Role and 5-digit PIN required' });
  }
  
  if (role === 'dj') {
    const masterPin = getMasterPin();
    const isMaster = pin === masterPin;
    const djPinHash = getSetting('dj_pin');
    if (!djPinHash && !isMaster) {
      return res.status(400).json({ error: 'DJ PIN not set. Please set it in the app first.' });
    }
    if (!isMaster && !verifyPin(pin, djPinHash)) {
      return res.status(401).json({ error: 'Incorrect PIN' });
    }
    const token = createSession('dj');
    return res.json({ token, role: 'dj' });
  }
  
  if (role === 'dancer') {
    const dancer = getDancerByPin(pin);
    if (!dancer) {
      return res.status(401).json({ error: 'Incorrect PIN' });
    }
    const token = createSession('dancer', dancer.id);
    return res.json({ token, role: 'dancer', dancerId: dancer.id, dancerName: dancer.name });
  }
  
  return res.status(400).json({ error: 'Invalid role' });
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  deleteSession(req.headers.authorization.replace('Bearer ', ''));
  res.json({ ok: true });
});

app.get('/api/auth/session', authenticate, (req, res) => {
  const data = { role: req.session.role };
  if (req.session.dancer_id) {
    const dancer = getDancer(req.session.dancer_id);
    if (dancer) {
      data.dancerId = dancer.id;
      data.dancerName = dancer.name;
    }
  }
  res.json(data);
});

app.post('/api/auth/ping', authenticate, (req, res) => {
  res.json({ ok: true });
});

app.post('/api/settings/dj-pin', authenticate, requireDJ, (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length !== 5) return res.status(400).json({ error: '5-digit PIN required' });
  setSetting('dj_pin', hashPin(pin));
  res.json({ ok: true });
});

app.get('/api/settings/master-pin', authenticate, requireDJ, (req, res) => {
  res.json({ pin: getMasterPin() });
});

app.post('/api/settings/master-pin', authenticate, requireDJ, (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length !== 5) return res.status(400).json({ error: '5-digit PIN required' });
  setSetting('master_pin', pin);
  res.json({ ok: true });
});

app.post('/api/settings/dj-pin/init', (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length !== 5) return res.status(400).json({ error: '5-digit PIN required' });
  const existing = getSetting('dj_pin');
  if (existing) {
    if (pin === getMasterPin() || verifyPin(pin, existing)) {
      const token = createSession('dj');
      return res.json({ ok: true, token, role: 'dj' });
    }
    return res.status(400).json({ error: 'DJ PIN already set' });
  }
  setSetting('dj_pin', hashPin(pin));
  const token = createSession('dj');
  res.json({ ok: true, token, role: 'dj' });
});

app.post('/api/fleet/auto-auth', (req, res) => {
  const token = createSession('dj');
  res.json({ ok: true, token, role: 'dj' });
});

app.get('/api/settings/has-dj-pin', (req, res) => {
  const pin = getSetting('dj_pin');
  res.json({ hasPin: !!pin });
});

app.get('/api/config/defaults', (req, res) => {
  const defaults = {};
  if (process.env.OPENAI_API_KEY) defaults.openaiApiKey = process.env.OPENAI_API_KEY;
  if (process.env.ELEVENLABS_API_KEY) defaults.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
  if (process.env.ELEVENLABS_VOICE_ID) defaults.elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;
  if (process.env.SCRIPT_MODEL) defaults.scriptModel = process.env.SCRIPT_MODEL;
  try {
    const stored = getClientSettings();
    const keyMap = {
      djbooth_openai_key: 'openaiApiKey',
      djbooth_elevenlabs_key: 'elevenLabsApiKey',
      djbooth_elevenlabs_voice_id: 'elevenLabsVoiceId',
      djbooth_script_model: 'scriptModel',
      djbooth_club_name: 'clubName',
      djbooth_club_open_hour: 'clubOpenHour',
      djbooth_club_close_hour: 'clubCloseHour',
      djbooth_energy_override: 'energyOverride',
      djbooth_announcements_enabled: 'announcementsEnabled',
      djbooth_club_specials: 'clubSpecials',
    };
    for (const [storageKey, configKey] of Object.entries(keyMap)) {
      if (stored[storageKey] && !defaults[configKey]) {
        defaults[configKey] = stored[storageKey];
      }
    }
  } catch {}
  res.json(defaults);
});

const CONFIG_KEYS = [
  'openaiApiKey', 'elevenLabsApiKey', 'elevenLabsVoiceId',
  'announcementsEnabled', 'clubName', 'clubOpenHour', 'clubCloseHour', 'energyOverride'
];

app.get('/api/config', authenticate, requireDJ, (req, res) => {
  const config = {};
  for (const key of CONFIG_KEYS) {
    const val = getSetting('config_' + key);
    if (val !== null) config[key] = val;
  }
  res.json(config);
});

app.put('/api/config', authenticate, requireDJ, (req, res) => {
  const updates = req.body;
  for (const key of CONFIG_KEYS) {
    if (updates[key] !== undefined) {
      setSetting('config_' + key, String(updates[key]));
    }
  }
  res.json({ ok: true });
});

app.get('/api/dancers', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    const session = getSession(token);
    if (!session) return res.status(401).json({ error: 'Invalid session' });
    if (session.role === 'dancer') {
      const elapsed = Date.now() - session.last_seen;
      if (elapsed > DANCER_TIMEOUT_MS) {
        deleteSession(token);
        return res.status(401).json({ error: 'Session expired' });
      }
      touchSession(token);
    }
  }
  const dancers = listDancers();
  const safe = dancers.map(({ pin_hash, ...rest }) => rest);
  res.json(safe);
});

app.post('/api/dancers', authenticate, requireDJ, (req, res) => {
  const { name, color, pin, phonetic_name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!pin || pin.length !== 5) return res.status(400).json({ error: '5-digit PIN required' });
  try {
    let dancer = createDancer(name, color, pin);
    if (phonetic_name) {
      dancer = updateDancer(dancer.id, { phonetic_name });
    }
    const { pin_hash, ...safe } = dancer;
    res.json(safe);
  } catch (err) {
    if (err.message === 'PIN_TAKEN') {
      return res.status(409).json({ error: 'That PIN is already used by another entertainer' });
    }
    return res.status(500).json({ error: 'Failed to create entertainer' });
  }
});

app.put('/api/dancers/:id', authenticate, requireDJ, (req, res) => {
  const dancer = updateDancer(req.params.id, req.body);
  if (!dancer) return res.status(404).json({ error: 'Entertainer not found' });
  if (req.body.pin !== undefined) {
    invalidateDancerSessions(req.params.id);
  }
  const { pin_hash, ...safe } = dancer;
  res.json(safe);
});

app.delete('/api/dancers/:id', authenticate, requireDJ, (req, res) => {
  deleteDancer(req.params.id);
  res.json({ ok: true });
});

app.get('/api/playlist', authenticate, (req, res) => {
  if (req.session.role === 'dancer') {
    const dancer = getDancer(req.session.dancer_id);
    if (!dancer) return res.status(404).json({ error: 'Entertainer not found' });
    return res.json({ playlist: dancer.playlist });
  }
  return res.status(400).json({ error: 'Use entertainer session' });
});

app.put('/api/playlist', authenticate, (req, res) => {
  if (req.session.role !== 'dancer') return res.status(403).json({ error: 'Entertainer access only' });
  const { playlist } = req.body;
  if (!Array.isArray(playlist)) return res.status(400).json({ error: 'Playlist must be an array' });
  const cleanPlaylist = playlist.filter(name => !/dirty/i.test(name));
  const dancer = updateDancer(req.session.dancer_id, { playlist: cleanPlaylist });
  if (!dancer) return res.status(404).json({ error: 'Entertainer not found' });
  res.json({ playlist: dancer.playlist });
});

app.get('/api/dancers/export', authenticate, requireDJ, (req, res) => {
  try {
    const dancers = exportDancers();
    const settings = getClientSettings();
    const filename = `dancers-export-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ exported_at: new Date().toISOString(), dancers, settings }, null, 2));
  } catch (err) {
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

app.post('/api/dancers/import', authenticate, requireDJ, (req, res) => {
  try {
    const { dancers, overwrite = false } = req.body;
    if (!Array.isArray(dancers)) return res.status(400).json({ error: 'dancers array required' });
    const result = importDancers(dancers, { overwrite });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

app.post('/api/config/save-to-server', (req, res) => {
  try {
    saveClientSettings(req.body || {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

app.get('/api/songs', authenticate, (req, res) => {
  const songs = listSongs();
  res.json(songs);
});

app.post('/api/songs/sync', authenticate, requireDJ, (req, res) => {
  const { songs } = req.body;
  if (!Array.isArray(songs)) return res.status(400).json({ error: 'Songs must be an array' });
  syncSongs(songs);
  res.json({ ok: true, count: songs.length });
});

app.get('/api/voiceovers', authenticate, requireDJ, (req, res) => {
  const voiceovers = listVoiceovers();
  res.json(voiceovers);
});

app.get('/api/voiceovers/check/:cacheKey', authenticate, (req, res) => {
  const vo = getVoiceover(req.params.cacheKey);
  res.json({ exists: !!vo, cacheKey: req.params.cacheKey, day_of_week: vo?.day_of_week ?? null });
});

app.get('/api/voiceovers/check', authenticate, (req, res) => {
  const keys = req.query.keys;
  if (!keys) return res.json({ cached: {} });
  const keyList = keys.split(',');
  const cached = {};
  for (const key of keyList) {
    cached[key] = !!getVoiceover(key);
  }
  res.json({ cached });
});

app.get('/api/voiceovers/audio/:cacheKey', authenticate, (req, res) => {
  const filePath = getVoiceoverFilePath(req.params.cacheKey);
  if (!filePath) return res.status(404).json({ error: 'Voiceover not found' });
  res.set('Content-Type', 'audio/mpeg');
  res.set('Cache-Control', 'public, max-age=31536000');
  res.sendFile(filePath);
});

app.post('/api/voiceovers', authenticate, requireDJ, (req, res) => {
  const { cache_key, script, type, dancer_name, energy_level, audio_base64, club_name, day_of_week } = req.body;
  if (!cache_key || !type || !audio_base64) {
    return res.status(400).json({ error: 'cache_key, type, and audio_base64 required' });
  }
  try {
    const audioBuffer = Buffer.from(audio_base64, 'base64');
    const parsedDow = (day_of_week !== undefined && day_of_week !== null) ? parseInt(day_of_week) : null;
    const result = saveVoiceover(cache_key, audioBuffer, script || null, type, dancer_name || null, parseInt(energy_level) || 3, club_name || null, Number.isInteger(parsedDow) ? parsedDow : null);
    res.json({ ok: true, ...result });
    if (isR2Configured() && result.fileName) {
      const voiceoverPath = getVoiceoverFilePath(cache_key);
      if (voiceoverPath) uploadVoiceover(cache_key, voiceoverPath, club_name || null).catch(() => {});
    }
  } catch (err) {
    console.error('Failed to save voiceover:', err.message);
    res.status(500).json({ error: 'Failed to save voiceover' });
  }
});

app.delete('/api/voiceovers/dancer/:dancerName', authenticate, requireDJ, (req, res) => {
  const dancerName = decodeURIComponent(req.params.dancerName).trim();
  if (!dancerName) return res.status(400).json({ error: 'Dancer name is required' });
  const count = deleteVoiceoversByDancer(dancerName);
  console.log(`🗑️ Reset voiceovers for "${dancerName}": ${count} removed`);
  res.json({ ok: true, deleted: count });
});

app.delete('/api/voiceovers/:cacheKey', authenticate, requireDJ, (req, res) => {
  deleteVoiceover(req.params.cacheKey);
  res.json({ ok: true });
});

app.post('/api/auphonic/process', authenticate, requireDJ, async (req, res) => {
  const apiKey = process.env.AUPHONIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AUPHONIC_API_KEY not configured' });

  const { audio_base64 } = req.body;
  if (!audio_base64) return res.status(400).json({ error: 'audio_base64 required' });

  try {
    const audioBuffer = Buffer.from(audio_base64, 'base64');
    const boundary = '----AuphonicBoundary' + Date.now();

    const fields = {
      title: 'DJ Voiceover ' + new Date().toISOString(),
      filtering: 'true',
      denoise: 'true',
      denoiseamount: '0',
      dehum: '60',
      leveler: 'true',
      levelerstrength: '70',
      normloudness: 'true',
      loudnesstarget: '-16',
      loudnessmethod: 'dialog',
      maxpeak: '-2',
      action: 'start',
    };

    let body = '';
    for (const [key, val] of Object.entries(fields)) {
      body += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`;
    }
    body += `--${boundary}\r\nContent-Disposition: form-data; name="output_files"; filename="output.json"\r\nContent-Type: application/json\r\n\r\n[{"format":"mp3","bitrate":"192"}]\r\n`;

    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="input_file"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n`;
    const fileFooter = `\r\n--${boundary}--\r\n`;

    const bodyStart = Buffer.from(body + fileHeader, 'utf-8');
    const bodyEnd = Buffer.from(fileFooter, 'utf-8');
    const fullBody = Buffer.concat([bodyStart, audioBuffer, bodyEnd]);

    console.log('🎙️ Auphonic: Uploading audio for processing...');
    const createResp = await fetch('https://auphonic.com/api/simple/productions.json', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: fullBody,
    });

    if (!createResp.ok) {
      const errText = await createResp.text();
      console.error('🎙️ Auphonic create error:', errText);
      return res.status(500).json({ error: 'Auphonic upload failed: ' + createResp.status });
    }

    const createData = await createResp.json();
    const productionUuid = createData.data?.uuid;
    if (!productionUuid) {
      return res.status(500).json({ error: 'No production UUID returned' });
    }

    console.log(`🎙️ Auphonic: Production ${productionUuid} started, polling...`);

    let status = 'Processing';
    let attempts = 0;
    const maxAttempts = 60;
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 3000));
      attempts++;

      const statusResp = await fetch(`https://auphonic.com/api/production/${productionUuid}.json`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!statusResp.ok) continue;
      const statusData = await statusResp.json();
      const statusCode = statusData.data?.status;

      if (statusCode === 3) {
        status = 'Done';
        break;
      } else if (statusCode === 9 || statusCode === 11 || statusCode === 13) {
        console.error('🎙️ Auphonic: Production failed with status', statusCode);
        return res.status(500).json({ error: 'Auphonic processing failed' });
      }
    }

    if (status !== 'Done') {
      return res.status(500).json({ error: 'Auphonic processing timed out' });
    }

    const detailResp = await fetch(`https://auphonic.com/api/production/${productionUuid}.json`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const detailData = await detailResp.json();
    const outputFiles = detailData.data?.output_files || [];
    const mp3File = outputFiles.find(f => f.format === 'mp3') || outputFiles[0];

    if (!mp3File?.download_url) {
      return res.status(500).json({ error: 'No output file from Auphonic' });
    }

    const audioResp = await fetch(mp3File.download_url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!audioResp.ok) {
      return res.status(500).json({ error: 'Failed to download processed audio' });
    }

    const processedBuffer = Buffer.from(await audioResp.arrayBuffer());
    console.log(`🎙️ Auphonic: Done! ${(processedBuffer.length / 1024).toFixed(0)}KB processed audio`);

    const durationSec = parseFloat(detailData.data?.length || 0);
    res.json({
      ok: true,
      audio_base64: processedBuffer.toString('base64'),
      duration_ms: durationSec > 0 ? Math.round(durationSec * 1000) : null,
      content_type: 'audio/mpeg',
    });

    fetch(`https://auphonic.com/api/production/${productionUuid}.json`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }).catch(() => {});

  } catch (err) {
    console.error('🎙️ Auphonic error:', err);
    res.status(500).json({ error: 'Auphonic processing failed: ' + err.message });
  }
});

app.delete('/api/voiceovers', authenticate, requireDJ, (req, res) => {
  const count = clearAllVoiceovers();
  console.log(`🗑️ Cleared all voiceovers: ${count} removed`);
  res.json({ ok: true, deleted: count });
});

app.post('/api/promo-requests', authenticate, (req, res) => {
  try {
    const { event_name, date, time, venue, details, vibe, length } = req.body;
    if (!event_name || !event_name.trim()) {
      return res.status(400).json({ error: 'Event name is required' });
    }
    const result = createPromoRequest({
      event_name: event_name.trim(),
      date: date || null,
      time: time || null,
      venue: venue || null,
      details: details || '',
      vibe: vibe || 'Hype',
      length: length || '30s',
      music_bed: '',
      intro_sfx: '',
      outro_sfx: ''
    });
    res.json({ ok: true, id: result.id });
  } catch (err) {
    console.error('Create promo request error:', err.message);
    res.status(500).json({ error: 'Failed to create promo request' });
  }
});

app.get('/api/promo-requests', authenticate, (req, res) => {
  try {
    const requests = listPromoRequests(req.query.status || null);
    res.json(requests);
  } catch (err) {
    console.error('List promo requests error:', err.message);
    res.status(500).json({ error: 'Failed to list promo requests' });
  }
});

const SERVER_DEVICE_ID = process.env.DEVICE_ID || hostname() || 'local';

app.post('/api/usage/log', (req, res) => {
  try {
    const { service, model, endpoint, characters, promptTokens, completionTokens, estimatedCost, context } = req.body;
    if (!service) return res.status(400).json({ error: 'service is required' });
    logApiUsage({
      deviceId: SERVER_DEVICE_ID,
      service,
      model: model || '',
      endpoint: endpoint || '',
      characters: characters || 0,
      promptTokens: promptTokens || 0,
      completionTokens: completionTokens || 0,
      estimatedCost: estimatedCost || 0,
      context: context || ''
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('API usage log error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usage/summary', authenticate, requireDJ, (req, res) => {
  try {
    const { startDate, endDate, deviceId } = req.query;
    const summary = getApiUsageSummary({ startDate, endDate, deviceId });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usage/by-device', authenticate, requireDJ, (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = getApiUsageByDevice({ startDate, endDate });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usage/device-id', (req, res) => {
  res.json({ deviceId: SERVER_DEVICE_ID });
});

app.get('/api/config/capabilities', (req, res) => {
  res.json({
    isHomebase: process.env.IS_HOMEBASE === 'true',
    hasVoiceStudio: process.env.IS_HOMEBASE === 'true',
    deviceId: SERVER_DEVICE_ID,
  });
});

app.post('/api/playback-errors', authenticate, requireDJ, (req, res) => {
  try {
    const { trackName, dancerName, reason } = req.body;
    db.prepare('INSERT INTO playback_errors (track_name, dancer_name, reason) VALUES (?, ?, ?)').run(
      trackName || null, dancerName || null, reason || 'watchdog_silence'
    );

    // Forward to fleet homebase if this is a venue Pi
    const fleetKey = process.env.FLEET_DEVICE_KEY;
    const fleetUrl = process.env.FLEET_SERVER_URL;
    if (fleetKey && fleetUrl && process.env.IS_HOMEBASE !== 'true') {
      const logMsg = `Playback error: ${trackName || 'unknown'} — ${reason || 'watchdog_silence'}${dancerName ? ` (dancer: ${dancerName})` : ''}`;
      fetch(`${fleetUrl}/fleet/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-key': fleetKey },
        body: JSON.stringify({ logs: [{ level: 'error', message: logMsg, timestamp: new Date().toISOString() }] })
      }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/playback-errors', (req, res) => {
  try {
    const errors = db.prepare('SELECT * FROM playback_errors ORDER BY id DESC LIMIT 100').all();
    res.json({ errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/playback-errors', authenticate, requireDJ, (req, res) => {
  try {
    db.prepare('DELETE FROM playback_errors').run();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/fleet', fleetRoutes);
setupFleetMonitorRoutes(app);

app.get('/fleet-dashboard', (req, res) => {
  const dashPath = join(__dirname, '..', 'public', 'fleet-dashboard.html');
  if (existsSync(dashPath)) {
    res.sendFile(dashPath);
  } else {
    res.status(404).send('Fleet dashboard not found');
  }
});

app.get('/api/r2/status', authenticate, requireDJ, async (req, res) => {
  try {
    const stats = await getR2Stats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/r2/sync/voiceovers', authenticate, requireDJ, async (req, res) => {
  if (!isR2Configured()) return res.status(400).json({ error: 'R2 not configured' });
  const { direction } = req.body;
  const currentClub = getSetting('club_name') || '';
  try {
    const voiceoverDir = getVoiceoverDirPath();
    if (direction === 'upload') {
      const result = await syncVoiceoversToR2(voiceoverDir);
      res.json({ ok: true, ...result });
    } else {
      const result = await syncVoiceoversFromR2(voiceoverDir, currentClub);
      res.json({ ok: true, ...result });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/r2/sync/music', authenticate, requireDJ, async (req, res) => {
  if (!isR2Configured()) return res.status(400).json({ error: 'R2 not configured' });
  const { direction } = req.body;
  try {
    if (!MUSIC_PATH) return res.status(400).json({ error: 'MUSIC_PATH not configured' });
    if (direction === 'upload') {
      const result = await syncMusicToR2(MUSIC_PATH);
      res.json({ ok: true, ...result });
    } else {
      const result = await syncMusicFromR2(MUSIC_PATH);
      res.json({ ok: true, ...result });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/update', async (req, res) => {
  const { pin } = req.body || {};
  if (!pin || pin !== getMasterPin()) {
    return res.status(403).json({ error: 'Invalid PIN' });
  }
  const { spawn } = await import('child_process');
  const home = process.env.HOME || '/home/' + (process.env.USER || 'pi');
  const script = `${home}/djbooth-update.sh`;
  if (!existsSync(script)) {
    return res.status(404).json({ error: 'Update script not found' });
  }
  res.json({ ok: true, message: 'Update started' });
  const child = spawn('bash', [script], { cwd: home, detached: true, stdio: 'ignore' });
  child.unref();
});

let _stageState = null;

app.post('/api/stage/sync', (req, res) => {
  const body = req.body || {};
  if (body.is_active) {
    _stageState = { ...body, syncedAt: Date.now() };
  } else if (body.is_active === false && _stageState) {
    _stageState = null;
  }
  res.json({ ok: true });
});

app.get('/api/stage/current', (req, res) => {
  res.json(_stageState || { empty: true });
});

app.get('/api/system/display-rotation', async (req, res) => {
  try {
    const os = await import('os');
    const fs = await import('fs');
    const wayfireIni = `${os.default.homedir()}/.config/wayfire.ini`;
    let transform = 'normal';
    if (fs.existsSync(wayfireIni)) {
      const content = fs.readFileSync(wayfireIni, 'utf8');
      const sectionMatch = content.match(/\[output:HDMI-A-2\]([\s\S]*?)(?=\n\[|$)/);
      if (sectionMatch) {
        const m = sectionMatch[1].match(/transform\s*=\s*(\S+)/);
        if (m) transform = m[1].trim();
      }
    }
    res.json({ transform });
  } catch (err) {
    res.json({ transform: 'normal' });
  }
});

app.post('/api/system/display-rotation', async (req, res) => {
  const { transform } = req.body || {};
  const validTransforms = ['normal', '90', '180', '270'];
  if (!validTransforms.includes(transform)) {
    return res.status(400).json({ error: 'Invalid transform value' });
  }
  try {
    const os = await import('os');
    const fs = await import('fs');
    const { execSync } = await import('child_process');
    const wayfireIni = `${os.default.homedir()}/.config/wayfire.ini`;
    let content = '';
    if (fs.existsSync(wayfireIni)) content = fs.readFileSync(wayfireIni, 'utf8');
    if (content.includes('[output:HDMI-A-2]')) {
      if (/\[output:HDMI-A-2\][\s\S]*?transform\s*=/.test(content)) {
        content = content.replace(/((?:^|\n)\[output:HDMI-A-2\][\s\S]*?)transform\s*=\s*\S+/, `$1transform = ${transform}`);
      } else {
        content = content.replace('[output:HDMI-A-2]', `[output:HDMI-A-2]\ntransform = ${transform}`);
      }
    } else {
      content += `\n[output:HDMI-A-2]\ntransform = ${transform}\n`;
    }
    fs.writeFileSync(wayfireIni, content);
    try { execSync(`wlr-randr --output HDMI-A-2 --transform ${transform}`, { timeout: 5000 }); } catch {}
    res.json({ ok: true, transform });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/restart', async (req, res) => {
  const { pin } = req.body || {};
  if (!pin || pin !== getMasterPin()) {
    return res.status(403).json({ error: 'Invalid PIN' });
  }
  res.json({ ok: true, message: 'Restarting...' });
  setTimeout(async () => {
    const { spawn } = await import('child_process');
    const child = spawn('sudo', ['systemctl', 'restart', 'djbooth'], { detached: true, stdio: 'ignore' });
    child.unref();
  }, 500);
});

app.post('/api/admin/reboot', async (req, res) => {
  const { pin } = req.body || {};
  if (!pin || pin !== getMasterPin()) {
    return res.status(403).json({ error: 'Invalid PIN' });
  }
  res.json({ ok: true, message: 'Rebooting...' });
  setTimeout(async () => {
    const { spawn } = await import('child_process');
    const child = spawn('sudo', ['reboot'], { detached: true, stdio: 'ignore' });
    child.unref();
  }, 500);
});

app.post('/api/admin/sync', async (req, res) => {
  const { pin } = req.body || {};
  if (!pin || pin !== getMasterPin()) {
    return res.status(403).json({ error: 'Invalid PIN' });
  }
  if (!isR2Configured()) return res.status(400).json({ error: 'R2 not configured' });
  try {
    const voiceoverDir = getVoiceoverDirPath();
    const currentClub = getSetting('club_name') || '';
    const downloaded = await syncVoiceoversFromR2(voiceoverDir, currentClub);
    const uploaded = await syncVoiceoversToR2(voiceoverDir);
    res.json({ ok: true, downloaded, uploaded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', async (req, res) => {
  const os = await import('os');
  const { execSync } = await import('child_process');

  let cpuTemp = null;
  try {
    const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
    cpuTemp = parseFloat(raw) / 1000;
  } catch {}

  let diskFree = null, diskTotal = null;
  try {
    const dfOut = execSync('df -B1 / | tail -1', { timeout: 3000 }).toString().trim();
    const parts = dfOut.split(/\s+/);
    if (parts.length >= 4) {
      diskTotal = parseInt(parts[1], 10);
      diskFree = parseInt(parts[3], 10);
    }
  } catch {}

  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: Date.now(),
    system: {
      cpuTemp,
      memTotal: totalMem,
      memFree: freeMem,
      memPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      diskTotal,
      diskFree,
      diskPercent: (diskTotal && diskFree) ? Math.round(((diskTotal - diskFree) / diskTotal) * 100) : null,
      osUptime: os.uptime(),
      loadAvg: os.loadavg(),
      cpuCount: os.cpus().length,
    }
  });
});

const sseClients = new Set();

app.get('/api/booth/events', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'No token' });
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: 'Invalid session' });
  req.session = session;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('data: {"type":"connected"}\n\n');
  
  const client = { res, role: req.session.role };
  sseClients.add(client);
  
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 30000);
  
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
});

function broadcastSSE(eventType, data) {
  const msg = `data: ${JSON.stringify({ type: eventType, ...data })}\n\n`;
  for (const client of sseClients) {
    try { client.res.write(msg); } catch { sseClients.delete(client); }
  }
}

// Live booth state endpoints
app.post('/api/booth/state', authenticate, requireDJ, (req, res) => {
  const state = req.body;
  liveBoothState = {
    isRotationActive: !!state.isRotationActive,
    currentDancerIndex: state.currentDancerIndex || 0,
    currentDancerName: state.currentDancerName || null,
    currentTrack: state.currentTrack || null,
    currentSongNumber: state.currentSongNumber || 0,
    songsPerSet: state.songsPerSet || 3,
    isPlaying: !!state.isPlaying,
    rotation: state.rotation || [],
    announcementsEnabled: state.announcementsEnabled !== false,
    rotationSongs: state.rotationSongs || {},
    volume: state.volume != null ? state.volume : 0.8,
    voiceGain: state.voiceGain != null ? state.voiceGain : 1.5,
    trackTime: state.trackTime || 0,
    trackDuration: state.trackDuration || 0,
    trackTimeAt: state.trackTimeAt || 0,
    breakSongsPerSet: state.breakSongsPerSet || 0,
    interstitialSongs: state.interstitialSongs || {},
    commercialFreq: state.commercialFreq || 'off',
    commercialCounter: state.commercialCounter || 0,
    promoQueue: state.promoQueue || [],
    availablePromos: state.availablePromos || [],
    skippedCommercials: state.skippedCommercials || [],
    updatedAt: Date.now(),
  };
  broadcastSSE('boothState', { state: liveBoothState });
  res.json({ ok: true });
});

app.get('/api/booth/state', authenticate, (req, res) => {
  res.json(liveBoothState);
});

app.post('/api/booth/command', authenticate, requireDJ, (req, res) => {
  const { action, payload } = req.body;
  if (!action) return res.status(400).json({ error: 'Action required' });
  const cmd = {
    id: ++commandIdCounter,
    action,
    payload: payload || {},
    timestamp: Date.now(),
  };
  remoteCommandQueue.push(cmd);
  if (remoteCommandQueue.length > 50) remoteCommandQueue = remoteCommandQueue.slice(-50);
  broadcastSSE('command', { command: cmd });
  res.json({ ok: true, commandId: cmd.id });
});

app.get('/api/booth/commands', authenticate, requireDJ, (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const pending = remoteCommandQueue.filter(c => c.id > since);
  res.json({ commands: pending });
});

app.post('/api/booth/commands/ack', authenticate, requireDJ, (req, res) => {
  const { upToId } = req.body;
  if (upToId) {
    remoteCommandQueue = remoteCommandQueue.filter(c => c.id > upToId);
  }
  res.json({ ok: true });
});

let MUSIC_PATH = process.env.MUSIC_PATH || getSetting('music_path') || '';
if (!MUSIC_PATH) {
  const homeDir = process.env.HOME || `/home/${process.env.USER || 'pi'}`;
  const appDir = process.cwd();
  const candidates = [
    join(appDir, 'music'),
    join(appDir, 'Music'),
    join(homeDir, 'djbooth', 'music'),
    join(homeDir, 'djbooth', 'Music'),
    join(homeDir, 'music'),
    join(homeDir, 'Music')
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      MUSIC_PATH = candidate;
      setSetting('music_path', candidate);
      console.log(`🎵 Auto-detected music folder: ${candidate}`);
      break;
    }
  }
}

app.get('/api/settings/music-path', authenticate, requireDJ, (req, res) => {
  res.json({
    path: MUSIC_PATH || '',
    totalTracks: getMusicTrackCount(),
    lastScan: getLastScanTime()
  });
});

app.post('/api/settings/music-path', authenticate, requireDJ, (req, res) => {
  const { path: newPath } = req.body;
  if (!newPath || typeof newPath !== 'string' || newPath.trim().length === 0) {
    return res.status(400).json({ error: 'Music path is required' });
  }
  const trimmedPath = newPath.trim();
  if (!existsSync(trimmedPath)) {
    return res.status(400).json({ error: `Folder not found: ${trimmedPath}` });
  }
  const stat = statSync(trimmedPath);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: `Not a directory: ${trimmedPath}` });
  }
  MUSIC_PATH = trimmedPath;
  setSetting('music_path', trimmedPath);
  stopPeriodicScan();
  try {
    const result = scanMusicFolder(trimmedPath);
    startPeriodicScan(trimmedPath, 5);
    res.json({ success: true, ...result, path: trimmedPath });
  } catch (err) {
    res.status(500).json({ error: `Scan failed: ${err.message}` });
  }
});

app.get('/api/music/tracks', authenticate, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 100, 5000);
  const search = req.query.search || '';
  const genre = req.query.genre || '';
  const excludeDirty = req.session.role === 'dancer';
  const result = getMusicTracks({ page, limit, search, genre, excludeDirty });
  const genres = getMusicGenres();
  res.json({ ...result, genres });
});

app.get('/api/music/genres', authenticate, (req, res) => {
  res.json({ genres: getMusicGenres() });
});

app.get('/api/music/stats', authenticate, (req, res) => {
  res.json({
    totalTracks: getMusicTrackCount(),
    genres: getMusicGenres(),
    lastScan: getLastScanTime(),
    musicPath: MUSIC_PATH || '(not configured)'
  });
});

app.get('/api/dj-options', authenticate, requireDJ, (req, res) => {
  const activeGenres = getSetting('dj_active_genres');
  const musicMode = getSetting('dj_music_mode');
  res.json({
    activeGenres: activeGenres ? JSON.parse(activeGenres) : [],
    musicMode: musicMode || 'dancer_first',
  });
});

app.put('/api/dj-options', authenticate, requireDJ, (req, res) => {
  const { activeGenres, musicMode } = req.body;
  if (activeGenres !== undefined) {
    setSetting('dj_active_genres', JSON.stringify(activeGenres));
  }
  if (musicMode !== undefined) {
    setSetting('dj_music_mode', musicMode);
  }
  broadcastSSE('djOptions', {
    activeGenres: activeGenres !== undefined ? activeGenres : JSON.parse(getSetting('dj_active_genres') || '[]'),
    musicMode: musicMode !== undefined ? musicMode : (getSetting('dj_music_mode') || 'dancer_first'),
  });
  res.json({ ok: true });
});

app.get('/api/music/random', authenticate, (req, res) => {
  const count = Math.min(parseInt(req.query.count) || 3, 50);
  const excludeParam = req.query.exclude || '';
  const excludeNames = excludeParam ? excludeParam.split(',').map(s => s.trim()).filter(Boolean) : [];
  const genresParam = req.query.genres || '';
  const genres = genresParam ? genresParam.split(',').map(g => g.trim()).filter(Boolean) : [];
  const tracks = getRandomTracks(count, excludeNames, genres);
  res.json({ tracks });
});

app.get('/api/music/track-by-name/:name', authenticate, (req, res) => {
  const track = getMusicTrackByName(req.params.name);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  res.json(track);
});

app.post('/api/music/select', authenticate, (req, res) => {
  const { count = 2, excludeNames = [], genres = [], dancerPlaylist = [] } = req.body || {};
  try {
    const tracks = selectTracksForSet({
      count: Math.min(count, 20),
      excludeNames: excludeNames || [],
      genres: genres || [],
      dancerPlaylist: dancerPlaylist || []
    });
    res.json({ tracks: tracks.map(t => ({ ...t, url: `/api/music/stream/${t.id}` })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/music/rescan', authenticate, requireDJ, (req, res) => {
  if (!MUSIC_PATH) return res.status(400).json({ error: 'MUSIC_PATH not configured' });
  try {
    const result = scanMusicFolder(MUSIC_PATH, true);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/music/lufs-status', authenticate, (req, res) => {
  const stats = getLufsStats();
  const progress = getLufsAnalysisProgress();
  res.json({ ...stats, isRunning: isLufsAnalysisRunning(), progress });
});

app.post('/api/music/analyze', authenticate, requireDJ, (req, res) => {
  if (!MUSIC_PATH) return res.status(400).json({ error: 'MUSIC_PATH not configured' });
  if (isLufsAnalysisRunning()) return res.json({ ok: true, message: 'Analysis already running' });
  startLufsAnalysis(MUSIC_PATH);
  if (!isBpmAnalysisRunning()) startBpmAnalysis(MUSIC_PATH);
  res.json({ ok: true, message: 'LUFS + BPM analysis started in background' });
});

app.post('/api/music/block', authenticate, requireDJ, (req, res) => {
  const { trackName } = req.body;
  if (!trackName) return res.status(400).json({ error: 'trackName required' });
  try {
    blockTrack(trackName);
    res.json({ success: true, message: `Deactivated: ${trackName}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/music/unblock', authenticate, requireDJ, (req, res) => {
  const { trackName } = req.body;
  if (!trackName) return res.status(400).json({ error: 'trackName required' });
  try {
    unblockTrack(trackName);
    res.json({ success: true, message: `Reactivated: ${trackName}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/music/blocked', authenticate, (req, res) => {
  try {
    const tracks = getBlockedTracks();
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/music/track', authenticate, requireDJ, async (req, res) => {
  const { trackName } = req.body;
  if (!trackName) return res.status(400).json({ error: 'trackName required' });
  try {
    const track = getMusicTrackByName(trackName);
    if (!track) return res.status(404).json({ error: 'Track not found in database' });

    const results = { db: false, local: false, r2: false };

    deleteMusicTrackFromDB(trackName);
    results.db = true;

    if (track.path && existsSync(track.path)) {
      try { unlinkSync(track.path); results.local = true; } catch (e) {
        console.warn(`⚠️ Could not delete local file ${track.path}: ${e.message}`);
      }
    }

    if (isR2Configured()) {
      const MUSIC_PATH = getSetting('music_path');
      let relativePath = track.path;
      if (MUSIC_PATH && relativePath.startsWith(MUSIC_PATH)) {
        relativePath = relativePath.slice(MUSIC_PATH.length).replace(/^\/+/, '');
      } else {
        relativePath = track.path.split('/').pop();
      }
      results.r2 = await deleteFromR2Music(relativePath);
    }

    res.json({ ok: true, trackName, results });
  } catch (err) {
    console.error('❌ Music track delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/history/played', authenticate, (req, res) => {
  const { trackName, dancerName, genre } = req.body;
  if (!trackName) return res.status(400).json({ error: 'trackName required' });
  try {
    logPlayHistory(trackName, dancerName, genre);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/cooldowns', authenticate, requireDJ, (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 4;
    const rows = getRecentCooldowns(hours);
    const cooldowns = {};
    for (const row of rows) {
      cooldowns[row.track_name] = new Date(row.last_played).getTime();
    }
    res.json({ cooldowns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history', authenticate, requireDJ, (req, res) => {
  const { date, limit, offset } = req.query;
  const history = getPlayHistory(date || null, parseInt(limit) || 200, parseInt(offset) || 0);
  res.json({ history });
});

app.get('/api/history/dates', authenticate, requireDJ, (req, res) => {
  const dates = getPlayHistoryDates();
  res.json({ dates });
});

app.get('/api/history/stats', authenticate, requireDJ, (req, res) => {
  const { date } = req.query;
  const stats = getPlayHistoryStats(date || null);
  res.json(stats);
});

app.get('/api/music/ambient', (req, res) => {
  try {
    const tracks = getRandomTracks(1);
    if (!tracks || tracks.length === 0) return res.status(404).json({ error: 'No tracks available' });
    const track = tracks[0];
    res.json({ id: track.id, name: track.name, genre: track.genre, url: `/api/music/stream/${track.id}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get ambient track' });
  }
});

app.get('/api/music/stream/:id', (req, res) => {
  const track = getMusicTrackById(parseInt(req.params.id));
  if (!track || !MUSIC_PATH) return res.status(404).json({ error: 'Track not found' });

  const filePath = join(MUSIC_PATH, track.path);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const stat = statSync(filePath);
  const ext = track.name.split('.').pop().toLowerCase();
  const mimeTypes = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wma: 'audio/x-ms-wma' };
  const contentType = mimeTypes[ext] || 'audio/mpeg';

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (start >= stat.size || end >= stat.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
    });
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(filePath).pipe(res);
  }
});

app.post('/api/kiosk/exit', authenticate, requireDJ, async (req, res) => {
  try {
    const { exec } = await import('child_process');
    exec('pkill -f "chromium.*kiosk" 2>/dev/null; pkill -f "chromium-browser.*kiosk" 2>/dev/null', (err) => {
      if (err && err.code !== 1) {
        console.log('Kiosk exit attempt (may not be in kiosk mode):', err.message);
      }
    });
    res.json({ success: true, message: 'Kiosk exit signal sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/display/launch', authenticate, requireDJ, async (req, res) => {
  try {
    const { spawn, execSync } = await import('child_process');
    const { readdirSync, rmSync, writeFileSync } = await import('fs');
    const os = await import('os');

    console.log('[display/launch] Button pressed — finding Wayland socket...');

    let waylandDisplay = null;
    let runtimeDir = null;

    for (const uid of [1000, 1001, 1002]) {
      const dir = `/run/user/${uid}`;
      try {
        const sockets = readdirSync(dir).filter(f => /^wayland-\d+$/.test(f));
        if (sockets.length > 0) {
          waylandDisplay = sockets.sort()[0];
          runtimeDir = dir;
          console.log(`[display/launch] Found Wayland socket: ${dir}/${waylandDisplay}`);
          break;
        }
      } catch {}
    }

    if (!waylandDisplay) {
      waylandDisplay = 'wayland-1';
      runtimeDir = `/run/user/1000`;
      console.log(`[display/launch] No socket found, defaulting to ${runtimeDir}/${waylandDisplay}`);
    }

    try { execSync('pkill -f RotationChromium 2>/dev/null || true', { stdio: 'ignore' }); } catch {}
    try { writeFileSync('/tmp/djbooth-display-trigger', '1', { mode: 0o644 }); } catch {}

    await new Promise(r => setTimeout(r, 1200));

    try { rmSync('/tmp/chromium-rotation', { recursive: true, force: true }); } catch {}

    const env = {
      ...process.env,
      WAYLAND_DISPLAY: waylandDisplay,
      XDG_RUNTIME_DIR: runtimeDir,
      HOME: os.homedir()
    };

    console.log(`[display/launch] Spawning chromium with WAYLAND_DISPLAY=${waylandDisplay} XDG_RUNTIME_DIR=${runtimeDir}`);

    const proc = spawn('chromium', [
      '--kiosk',
      '--class=RotationChromium',
      '--user-data-dir=/tmp/chromium-rotation',
      '--noerrdialogs',
      '--disable-session-crashed-bubble',
      '--autoplay-policy=no-user-gesture-required',
      'http://localhost:3001/RotationDisplay'
    ], { env, detached: true, stdio: 'ignore' });
    proc.unref();

    console.log(`[display/launch] Chromium spawned (PID ${proc.pid})`);
    res.json({ ok: true, message: 'Rotation display launching', wayland: waylandDisplay, runtimeDir });
  } catch (err) {
    console.error('[display/launch] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/version', async (req, res) => {
  let commitHash = 'unknown';
  try {
    const { execSync } = (await import('child_process'));
    commitHash = execSync('git rev-parse --short HEAD 2>/dev/null').toString().trim() || 'unknown';
  } catch {}
  let version = '0.0.0';
  try {
    const { readFileSync } = await import('fs');
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    version = pkg.version || '0.0.0';
  } catch {}
  res.json({
    version,
    commit: commitHash,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.post('/api/system/update', async (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length !== 5) {
    return res.status(400).json({ error: '5-digit PIN required' });
  }
  const masterPin = getMasterPin();
  const djPinHash = getSetting('dj_pin');
  const isAuthorized = pin === masterPin || (djPinHash && verifyPin(pin, djPinHash));
  if (!isAuthorized) {
    return res.status(401).json({ error: 'Incorrect PIN' });
  }

  const { existsSync: fileExists } = await import('fs');
  const { exec } = await import('child_process');
  const homeDir = process.env.HOME || `/home/${process.env.USER || 'pi'}`;
  const scriptPaths = [
    `${homeDir}/djbooth-update.sh`,
    `${homeDir}/djbooth-update-github.sh`,
  ];
  const script = scriptPaths.find(p => fileExists(p));
  if (!script) {
    return res.status(404).json({ error: 'Update script not found on this device' });
  }

  res.json({ ok: true, message: 'Update started', script });

  setTimeout(() => {
    exec(`bash "${script}" 2>&1`, { timeout: 300000 }, (err, stdout, stderr) => {
      if (err) console.error('Update script error:', err.message);
      if (stdout) console.log('Update output:', stdout.slice(-500));
    });
  }, 1000);
});

app.get('/api/update-bundle', async (req, res) => {
  const { readdirSync: readDir, statSync: statF, readFileSync: readF } = await import('fs');
  const { gzipSync } = await import('zlib');
  const projectRoot = join(__dirname, '..');

  const includeDirs = ['server', 'dist'];
  const includeRootFiles = ['package.json', 'package-lock.json', 'vite.config.js'];

  try {
    const files = [];
    const collectFiles = (dir, prefix) => {
      let entries;
      try { entries = readDir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          collectFiles(fullPath, entryPath);
        } else if (entry.isFile()) {
          files.push({ fullPath, entryPath });
        }
      }
    };

    for (const d of includeDirs) {
      const dirPath = join(projectRoot, d);
      if (existsSync(dirPath)) collectFiles(dirPath, d);
    }
    for (const f of includeRootFiles) {
      const filePath = join(projectRoot, f);
      if (existsSync(filePath)) files.push({ fullPath: filePath, entryPath: f });
    }

    const tarBlocks = [];
    for (const { fullPath, entryPath } of files) {
      try {
        const content = readF(fullPath);
        const nameBytes = Buffer.from(entryPath, 'utf8');
        const header = Buffer.alloc(512, 0);
        nameBytes.copy(header, 0, 0, Math.min(nameBytes.length, 100));
        const stat = statF(fullPath);
        const size = content.length;
        Buffer.from(String(stat.mode & 0o7777).padStart(7, '0') + '\0').copy(header, 100);
        Buffer.from(String(stat.uid || 0).padStart(7, '0') + '\0').copy(header, 108);
        Buffer.from(String(stat.gid || 0).padStart(7, '0') + '\0').copy(header, 116);
        Buffer.from(size.toString(8).padStart(11, '0') + '\0').copy(header, 124);
        Buffer.from(Math.floor(stat.mtime.getTime() / 1000).toString(8).padStart(11, '0') + '\0').copy(header, 136);
        Buffer.from('        ').copy(header, 148);
        header[156] = 48;
        let chksum = 0;
        for (let i = 0; i < 512; i++) chksum += header[i];
        Buffer.from(chksum.toString(8).padStart(6, '0') + '\0 ').copy(header, 148);
        tarBlocks.push(header);
        tarBlocks.push(content);
        const remainder = 512 - (size % 512);
        if (remainder < 512) tarBlocks.push(Buffer.alloc(remainder, 0));
      } catch {}
    }
    tarBlocks.push(Buffer.alloc(1024, 0));
    const gzipped = gzipSync(Buffer.concat(tarBlocks));

    res.set('Content-Type', 'application/gzip');
    res.set('Content-Disposition', 'attachment; filename=djbooth-update.tar.gz');
    res.set('Content-Length', gzipped.length);
    res.send(gzipped);
  } catch (err) {
    console.error('Update bundle creation failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create update bundle' });
  }
});

app.get('/api/download-bundle', async (req, res) => {
  const { readdirSync, statSync, readFileSync } = await import('fs');
  const { createGzip } = await import('zlib');
  const projectRoot = join(__dirname, '..');
  const excludeDirs = new Set(['node_modules', '.git', 'voiceovers', 'attached_assets', '.local', '.cache', '.config', '.upm']);
  const excludeExts = new Set(['.db', '.db-wal', '.db-shm']);

  try {
    const files = [];
    const collectFiles = (dir, prefix) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (excludeDirs.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.replit') continue;
        const fullPath = join(dir, entry.name);
        const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          collectFiles(fullPath, entryPath);
        } else if (entry.isFile()) {
          const ext = entry.name.substring(entry.name.lastIndexOf('.'));
          if (excludeExts.has(ext)) continue;
          files.push({ fullPath, entryPath });
        }
      }
    };
    collectFiles(projectRoot, '');

    const tarBlocks = [];
    for (const { fullPath, entryPath } of files) {
      try {
        const content = readFileSync(fullPath);
        const nameBytes = Buffer.from(entryPath, 'utf8');
        const header = Buffer.alloc(512, 0);
        nameBytes.copy(header, 0, 0, Math.min(nameBytes.length, 100));
        const stat = statSync(fullPath);
        const size = content.length;
        Buffer.from(String(stat.mode & 0o7777).padStart(7, '0') + '\0').copy(header, 100);
        Buffer.from(String(stat.uid || 0).padStart(7, '0') + '\0').copy(header, 108);
        Buffer.from(String(stat.gid || 0).padStart(7, '0') + '\0').copy(header, 116);
        Buffer.from(size.toString(8).padStart(11, '0') + '\0').copy(header, 124);
        Buffer.from(Math.floor(stat.mtime.getTime() / 1000).toString(8).padStart(11, '0') + '\0').copy(header, 136);
        Buffer.from('        ').copy(header, 148);
        header[156] = 48;
        let chksum = 0;
        for (let i = 0; i < 512; i++) chksum += header[i];
        Buffer.from(chksum.toString(8).padStart(6, '0') + '\0 ').copy(header, 148);
        tarBlocks.push(header);
        tarBlocks.push(content);
        const remainder = 512 - (size % 512);
        if (remainder < 512) tarBlocks.push(Buffer.alloc(remainder, 0));
      } catch {}
    }
    tarBlocks.push(Buffer.alloc(1024, 0));
    const tarBuffer = Buffer.concat(tarBlocks);
    const { gzipSync } = await import('zlib');
    const gzipped = gzipSync(tarBuffer);

    res.set('Content-Type', 'application/gzip');
    res.set('Content-Disposition', 'attachment; filename=djbooth-bundle.tar.gz');
    res.set('Content-Length', gzipped.length);
    res.send(gzipped);
  } catch (err) {
    console.error('Bundle creation failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create bundle' });
  }
});

const isProduction = process.env.NODE_ENV === 'production';
const distPath = join(__dirname, '..', 'dist', 'public');

if (isProduction) {
  console.log(`📁 Serving static files from: ${distPath}`);
  console.log(`📁 dist/public exists: ${existsSync(distPath)}`);
  const indexPath = join(distPath, 'index.html');
  console.log(`📁 index.html exists: ${existsSync(indexPath)}`);

  app.use(express.static(distPath, { maxAge: 0, etag: false }));
  app.get('/download', (req, res) => {
    res.sendFile(join(distPath, 'download.html'));
  });
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) {
      res.set('Cache-Control', 'no-cache');
      if (existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
    }
    next();
  });
}

app.use((err, req, res, next) => {
  console.error('Express error:', err.stack || err.message || err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function syncAnalysisFromHomebase() {
  const fleetKey = process.env.FLEET_DEVICE_KEY;
  const fleetUrl = process.env.FLEET_SERVER_URL;
  if (!fleetKey || !fleetUrl || process.env.IS_HOMEBASE === 'true') return;

  try {
    const filenames = getTracksNeedingAnyAnalysis();
    if (filenames.length === 0) {
      console.log('✅ Analysis sync: all tracks already analyzed locally');
      return;
    }
    console.log(`📊 Analysis sync: requesting data for ${filenames.length} unanalyzed tracks from homebase...`);

    const CHUNK_SIZE = 500;
    let totalSynced = 0;
    for (let i = 0; i < filenames.length; i += CHUNK_SIZE) {
      const chunk = filenames.slice(i, i + CHUNK_SIZE);
      const res = await fetch(`${fleetUrl}/fleet/music/analysis-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-key': fleetKey },
        body: JSON.stringify({ filenames: chunk }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) {
        console.warn(`⚠️ Analysis sync chunk failed: ${res.status}`);
        continue;
      }
      const data = await res.json();
      const count = bulkUpdateTrackAnalysis(data);
      totalSynced += count;
    }
    console.log(`✅ Analysis sync: pre-populated ${totalSynced} tracks from homebase — skipping local FFmpeg for those`);
  } catch (err) {
    console.warn(`⚠️ Analysis sync failed (will run local analysis instead): ${err.message}`);
  }
}

function initMusicScanner() {
  if (MUSIC_PATH) {
    try {
      updateBootStep('musicScan', 'running', 'Scanning...');
      const result = scanMusicFolder(MUSIC_PATH);
      const count = getMusicTrackCount();
      updateBootStep('musicScan', 'done', `${count.toLocaleString()} tracks found`);
      startPeriodicScan(MUSIC_PATH, 5);
      setTimeout(async () => {
        await syncAnalysisFromHomebase();
        if (process.env.IS_HOMEBASE === 'true') {
          startLufsAnalysis(MUSIC_PATH);
          setTimeout(() => startBpmAnalysis(MUSIC_PATH), 10000);
        } else {
          console.log('ℹ️ LUFS/BPM: Skipping auto-analysis on venue Pi — synced from homebase');
        }
      }, 5000);
    } catch (err) {
      updateBootStep('musicScan', 'error', err.message);
      console.error('❌ Initial music scan failed:', err.message);
    }
  } else {
    updateBootStep('musicScan', 'skipped');
    console.log('ℹ️ MUSIC_PATH not set — music catalog will be empty until configured');
  }
}

async function initR2Sync() {
  const isDeployment = !!(process.env.REPLIT_DEPLOYMENT);

  if (!isDeployment) {
    const orphaned = cleanupOrphanedVoiceovers();
    if (orphaned > 0) {
      console.log(`🧹 Cleaned up ${orphaned} orphaned voiceover database entries`);
    }
  }

  if (!isR2Configured() || isDeployment) {
    if (isDeployment) {
      console.log('☁️ Skipping R2 sync in cloud deployment (not needed — Pis sync directly)');
    } else {
      console.log('ℹ️ R2 not configured — cloud sync disabled');
    }
    updateBootStep('voiceoverSync', 'skipped');
    updateBootStep('voiceoverUpload', 'skipped');
    updateBootStep('musicSync', 'skipped');
    updateBootStep('musicUpload', 'skipped');
    bootStatus.ready = true;
    return;
  }
  console.log('☁️ R2 cloud sync enabled — starting background sync...');
  try {
    const voiceoverDir = getVoiceoverDirPath();
    const currentClub = getSetting('club_name') || '';
    updateBootStep('voiceoverSync', 'running', 'Downloading...');
    const voResult = await syncVoiceoversFromR2(voiceoverDir, currentClub);
    updateBootStep('voiceoverSync', 'done', `${voResult.downloaded} new, ${voResult.skipped} cached`);
    console.log(`☁️ Voiceover sync: ${voResult.downloaded} new, ${voResult.skipped} cached`);

    updateBootStep('voiceoverUpload', 'running', 'Uploading...');
    const voUpResult = await syncVoiceoversToR2(voiceoverDir);
    updateBootStep('voiceoverUpload', 'done', `${voUpResult.uploaded} shared to cloud`);
    console.log(`☁️ Voiceover upload: ${voUpResult.uploaded} shared to cloud`);
  } catch (err) {
    updateBootStep('voiceoverSync', 'error', err.message);
    updateBootStep('voiceoverUpload', 'error', err.message);
    console.error('☁️ R2 voiceover sync error:', err.message);
  }
  try {
    if (MUSIC_PATH) {
      updateBootStep('musicSync', 'running', 'Downloading...');
      const musicResult = await syncMusicFromR2(MUSIC_PATH);
      updateBootStep('musicSync', 'done', `${musicResult.downloaded} new, ${musicResult.skipped} cached`);
      console.log(`☁️ Music sync: ${musicResult.downloaded} new, ${musicResult.skipped} cached`);
      if (musicResult.downloaded > 0) {
        scanMusicFolder(MUSIC_PATH, true);
      }

      updateBootStep('musicUpload', 'running', 'Uploading...');
      const musicUpResult = await syncMusicToR2(MUSIC_PATH);
      updateBootStep('musicUpload', 'done', `${musicUpResult.uploaded} uploaded, ${musicUpResult.skipped} already in cloud`);
      console.log(`☁️ Music upload: ${musicUpResult.uploaded} uploaded, ${musicUpResult.skipped} already in cloud`);
    } else {
      updateBootStep('musicSync', 'skipped');
      updateBootStep('musicUpload', 'skipped');
    }
  } catch (err) {
    updateBootStep('musicSync', 'error', err.message);
    updateBootStep('musicUpload', 'error', err.message);
    console.error('☁️ R2 music sync error:', err.message);
  } finally {
    bootStatus.ready = true;
  }
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/index.js') || process.argv[1].endsWith('\\index.js')
);

if (isDirectRun) {
  const PORT = process.env.PORT || 3001;
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎵 NEON AI DJ server running on port ${PORT}`);
    updateBootStep('server', 'done', `Port ${PORT}`);
    initMusicScanner();
    startMonitoring();
    startHeartbeat(() => {
      let apiCosts = { total: 0, elevenlabs: 0, openai: 0, calls: 0 };
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        const rows = getApiUsageByDevice({ startDate: thirtyDaysAgo });
        if (rows && rows.length > 0) {
          const row = rows[0];
          apiCosts = {
            total: row.total_cost || 0,
            elevenlabs: row.elevenlabs_cost || 0,
            openai: row.openai_cost || 0,
            calls: row.total_calls || 0,
            characters: row.total_characters || 0,
          };
        }
      } catch {}
      let activeEntertainers = 0;
      let dancer_names = [];
      try {
        activeEntertainers = liveBoothState.rotation?.length || 0;
        const allDancers = listDancers();
        dancer_names = allDancers.map(d => d.name).filter(Boolean);
      } catch {}

      return {
        trackCount: getMusicTrackCount(),
        clubName: getSetting('club_name') || '',
        version: getSetting('app_version') || '',
        apiCosts,
        activeEntertainers,
        errorCount: errorCounter,
        dancer_names,
      };
    });
    initR2Sync().catch(err => {
      console.error('☁️ R2 init error:', err.message);
      bootStatus.ready = true;
    });

    (async () => {
      try {
        const existingDancers = listDancers();
        if (existingDancers.length === 0) {
          const { restoreDancersFromR2, isR2Configured: r2ok } = await import('./r2sync.js');
          if (r2ok()) {
            const deviceId = process.env.DEVICE_ID || hostname();
            console.log(`🔄 Empty dancer table detected — checking R2 for backup (${deviceId})...`);
            const backup = await restoreDancersFromR2(deviceId);
            if (backup && Array.isArray(backup.dancers) && backup.dancers.length > 0) {
              const result = importDancers(backup.dancers, { overwrite: false });
              if (backup.settings) saveClientSettings(backup.settings);
              console.log(`✅ Auto-restored ${result.imported} dancer(s) from R2 backup (backed up ${backup.backed_up_at})`);
            } else {
              console.log('ℹ️ No R2 dancer backup found for this device — starting fresh');
            }
          }
        }
      } catch (err) {
        console.error('⚠️ R2 dancer restore check failed:', err.message);
      }
    })();
  });

  const gracefulShutdown = () => {
    console.log('🛑 Shutting down gracefully...');
    stopPeriodicScan();
    stopCheckpoints();
    stopMonitoring();
    stopHeartbeat();
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    setTimeout(() => {
      console.warn('⚠️ Forced shutdown after timeout');
      closeDatabase();
      process.exit(1);
    }, 5000);
  };
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

export { app, initMusicScanner, stopPeriodicScan, stopCheckpoints, closeDatabase, initR2Sync };
