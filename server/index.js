import express from 'express';
import compression from 'compression';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, statSync, createReadStream, readdirSync } from 'fs';
import { networkInterfaces } from 'os';
import {
  getSetting, setSetting, hashPin, verifyPin,
  createDancer, getDancer, getDancerByPin, listDancers, updateDancer, deleteDancer,
  createSession, getSession, touchSession, deleteSession, cleanExpiredSessions,
  syncSongs, listSongs,
  saveVoiceover, getVoiceover, getVoiceoverFilePath, listVoiceovers, deleteVoiceover,
  closeDatabase, stopCheckpoints,
  getMusicTracks, getMusicGenres, getMusicTrackById, getMusicTrackByName, getRandomTracks, selectTracksForSet, getMusicTrackCount, getLastScanTime,
  logPlayHistory, getPlayHistory, getPlayHistoryDates, getPlayHistoryStats, cleanOldPlayHistory
} from './db.js';
import { scanMusicFolder, startPeriodicScan, stopPeriodicScan } from './musicScanner.js';
import fleetRoutes from './fleet-routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

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

setInterval(() => cleanExpiredSessions(DANCER_TIMEOUT_MS), 30 * 1000);
setInterval(() => cleanOldPlayHistory(90), 24 * 60 * 60 * 1000);

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
  res.json({ ips, port: PORT });
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

app.get('/api/settings/has-dj-pin', (req, res) => {
  const pin = getSetting('dj_pin');
  res.json({ hasPin: !!pin });
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
  const { name, color, pin } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!pin || pin.length !== 5) return res.status(400).json({ error: '5-digit PIN required' });
  try {
    const dancer = createDancer(name, color, pin);
    const { pin_hash, ...safe } = dancer;
    res.json(safe);
  } catch (err) {
    if (err.message === 'PIN_TAKEN') {
      return res.status(409).json({ error: 'That PIN is already used by another dancer' });
    }
    return res.status(500).json({ error: 'Failed to create dancer' });
  }
});

app.put('/api/dancers/:id', authenticate, requireDJ, (req, res) => {
  const dancer = updateDancer(req.params.id, req.body);
  if (!dancer) return res.status(404).json({ error: 'Dancer not found' });
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
    if (!dancer) return res.status(404).json({ error: 'Dancer not found' });
    return res.json({ playlist: dancer.playlist });
  }
  return res.status(400).json({ error: 'Use dancer session' });
});

app.put('/api/playlist', authenticate, (req, res) => {
  if (req.session.role !== 'dancer') return res.status(403).json({ error: 'Dancer access only' });
  const { playlist } = req.body;
  if (!Array.isArray(playlist)) return res.status(400).json({ error: 'Playlist must be an array' });
  const dancer = updateDancer(req.session.dancer_id, { playlist });
  if (!dancer) return res.status(404).json({ error: 'Dancer not found' });
  res.json({ playlist: dancer.playlist });
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
  res.json({ exists: !!vo, cacheKey: req.params.cacheKey });
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
  const { cache_key, script, type, dancer_name, energy_level, audio_base64 } = req.body;
  if (!cache_key || !type || !audio_base64) {
    return res.status(400).json({ error: 'cache_key, type, and audio_base64 required' });
  }
  try {
    const audioBuffer = Buffer.from(audio_base64, 'base64');
    const result = saveVoiceover(cache_key, audioBuffer, script || null, type, dancer_name || null, parseInt(energy_level) || 3);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Failed to save voiceover:', err.message);
    res.status(500).json({ error: 'Failed to save voiceover' });
  }
});

app.delete('/api/voiceovers/:cacheKey', authenticate, requireDJ, (req, res) => {
  deleteVoiceover(req.params.cacheKey);
  res.json({ ok: true });
});

app.use('/api/fleet', fleetRoutes);

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: Date.now()
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
  const result = getMusicTracks({ page, limit, search, genre });
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
  app.get('/{*splat}', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(200).send('OK');
    }
  });
}

app.use((err, req, res, next) => {
  console.error('Express error:', err.stack || err.message || err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

function initMusicScanner() {
  if (MUSIC_PATH) {
    try {
      scanMusicFolder(MUSIC_PATH);
      startPeriodicScan(MUSIC_PATH, 5);
    } catch (err) {
      console.error('❌ Initial music scan failed:', err.message);
    }
  } else {
    console.log('ℹ️ MUSIC_PATH not set — music catalog will be empty until configured');
  }
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/index.js') || process.argv[1].endsWith('\\index.js')
);

if (isDirectRun) {
  const PORT = process.env.PORT || 3001;
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎵 NEON AI DJ server running on port ${PORT}`);
    initMusicScanner();
  });

  const gracefulShutdown = () => {
    console.log('🛑 Shutting down gracefully...');
    stopPeriodicScan();
    stopCheckpoints();
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

export { app, initMusicScanner, stopPeriodicScan, stopCheckpoints, closeDatabase };
