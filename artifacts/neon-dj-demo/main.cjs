// NEON DJ — desktop demo shell.
// Spawns the existing booth server (api-server) as a child process in demo
// mode (local data dir, no cloud/fleet), waits for it to answer, then opens
// a normal resizable window pointed at it. No kiosk, no fullscreen takeover,
// no system changes: everything lives inside the app folder.
const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DEMO_PORT = 3210;

// Packaged layout (portable folder):
//   <root>/NEON DJ.exe            (electron)
//   <root>/resources/app/         (this file)
//   <root>/booth/server/          (api-server server code)
//   <root>/booth/dist/public/     (built dj-booth UI)
//   <root>/booth/node_modules/    (server deps, win32 prebuilds)
//   <root>/runtime/node.exe       (bundled Node for the server child process)
//   <root>/ffmpeg/ffmpeg.exe
//   <root>/data/                  (db, music, voiceovers — user content)
// Dev layout (Linux validation): stage.mjs builds .demo-stage/ mimicking the
// same shape, and we use the system `node` + system `ffmpeg`.

const isPackaged = app.isPackaged;
const rootDir = isPackaged
  ? path.resolve(path.dirname(app.getPath('exe')))
  : path.resolve(__dirname, '.demo-stage');

const boothDir = path.join(rootDir, 'booth');
const dataDir = path.join(rootDir, 'data');
const runtimeNode = isPackaged
  ? path.join(rootDir, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
  : process.env.NEON_DJ_NODE || 'node';
const ffmpegDir = path.join(rootDir, 'ffmpeg');

let serverProc = null;
let mainWindow = null;
let shuttingDown = false;

function ensureDataDirs() {
  for (const d of ['', 'music', 'voiceovers', 'soundboard', 'diag']) {
    fs.mkdirSync(path.join(dataDir, d), { recursive: true });
  }
}

// API keys come from data/api-keys.txt — the operator pastes them into
// Notepad once instead of typing them into the app. The server seeds its
// settings DB from OPENAI_API_KEY / ELEVENLABS_API_KEY env vars, so passing
// them here means zero in-app key entry.
const KEYS_FILE = () => path.join(dataDir, 'api-keys.txt');
const KEYS_TEMPLATE = `# NEON DJ - paste your API keys after the = signs, then save this file
# and restart NEON DJ. Do not add quotes or spaces.
# When the laptop can reach Home Base (Tailscale), keys sync automatically
# at every start and these lines are updated for you.
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
# Where to sync keys from (Home Base on Tailscale). Leave as-is normally.
HOMEBASE_URL=http://100.64.87.105:3001
`;

function ensureKeysFile() {
  if (!fs.existsSync(KEYS_FILE())) fs.writeFileSync(KEYS_FILE(), KEYS_TEMPLATE);
}

function readApiKeys() {
  const keys = {};
  try {
    for (const line of fs.readFileSync(KEYS_FILE(), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(OPENAI_API_KEY|ELEVENLABS_API_KEY|HOMEBASE_URL)\s*=\s*(\S+)\s*$/);
      if (m) keys[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return keys;
}

// Persist synced keys back into api-keys.txt so an OFFLINE start (convention
// hall with no internet) still has the last keys Home Base handed out.
function writeApiKeys(updates) {
  try {
    let text = fs.existsSync(KEYS_FILE()) ? fs.readFileSync(KEYS_FILE(), 'utf8') : KEYS_TEMPLATE;
    for (const [name, value] of Object.entries(updates)) {
      if (!value) continue;
      const re = new RegExp(`^\\s*${name}\\s*=.*$`, 'm');
      if (re.test(text)) text = text.replace(re, `${name}=${value}`);
      else text += `\n${name}=${value}\n`;
    }
    fs.writeFileSync(KEYS_FILE(), text);
  } catch { /* non-fatal — synced keys still flow in via env this run */ }
}

// ---- Fleet key sync -------------------------------------------------------
// The demo carries the SAME keys as the fleet so a key problem shows up on
// the laptop first (early-warning canary). At every start, if Home Base is
// reachable over Tailscale, adopt its current keys; if not, keep the last
// known ones. Nothing else about the fleet is touched — the demo still has
// no R2/Telegram/fleet env, so it can never join fleet behavior.
const HOMEBASE_TIMEOUT_MS = 5000;
const isValidElKey = (k) => /^sk_[A-Za-z0-9]{16,}$/.test((k || '').trim());

function fetchHomebaseDefaults(baseUrl) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const req = http.get(`${baseUrl.replace(/\/$/, '')}/api/config/defaults`,
        { timeout: HOMEBASE_TIMEOUT_MS }, (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => {
            try { done(JSON.parse(body)); } catch { done(null); }
          });
        });
      req.on('error', () => done(null));
      req.on('timeout', () => { req.destroy(); done(null); });
    } catch { done(null); }
  });
}

// Returns { elevenLabsApiKey, openaiApiKey } for whatever it managed to sync
// (possibly empty). Also rewrites api-keys.txt so the keys persist offline.
async function syncKeysFromHomebase() {
  const fileKeys = readApiKeys();
  const baseUrl = fileKeys.HOMEBASE_URL || 'http://100.64.87.105:3001';
  const defaults = await fetchHomebaseDefaults(baseUrl);
  const synced = {};
  if (defaults) {
    if (isValidElKey(defaults.elevenLabsApiKey)) synced.elevenLabsApiKey = defaults.elevenLabsApiKey.trim();
    if (defaults.openaiApiKey && String(defaults.openaiApiKey).length > 20) synced.openaiApiKey = String(defaults.openaiApiKey).trim();
    writeApiKeys({
      ELEVENLABS_API_KEY: synced.elevenLabsApiKey,
      OPENAI_API_KEY: synced.openaiApiKey,
    });
    console.log(`[key-sync] Home Base reachable — synced ${Object.keys(synced).length} key(s)`);
  } else {
    console.log('[key-sync] Home Base not reachable — keeping last known keys');
  }
  return synced;
}

// Push synced keys into the demo's own settings DB (same mechanism the fleet
// key drop used), so the STORED values match the fleet too — otherwise an old
// hand-typed key in the demo DB could win for OpenAI (stored-wins precedence).
function saveSyncedKeysLocally(synced) {
  const body = {};
  if (synced.elevenLabsApiKey) body.djbooth_elevenlabs_key = synced.elevenLabsApiKey;
  if (synced.openaiApiKey) body.djbooth_openai_key = synced.openaiApiKey;
  if (!Object.keys(body).length) return Promise.resolve();
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: DEMO_PORT, path: '/api/config/save-to-server',
      method: 'POST', timeout: 5000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', () => resolve());
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.end(data);
  });
}

function serverEnv() {
  const env = {
    // Deliberately NOT inheriting the full parent env: demo mode is defined by
    // the ABSENCE of R2_*, TELEGRAM_*, FLEET_* and friends. Pass through only
    // what the runtime needs.
    PATH: `${ffmpegDir}${path.delimiter}${process.env.PATH || ''}`,
    HOME: process.env.HOME || dataDir,
    USERPROFILE: process.env.USERPROFILE || dataDir,
    SYSTEMROOT: process.env.SYSTEMROOT || process.env.SystemRoot || '',
    TEMP: process.env.TEMP || process.env.TMPDIR || '',
    TMP: process.env.TMP || process.env.TMPDIR || '',
    NODE_ENV: 'production',
    DJBOOTH_DEMO: '1',
    PORT: String(DEMO_PORT),
    DB_PATH: path.join(dataDir, 'neon-dj-demo.db'),
    MUSIC_PATH: path.join(dataDir, 'music'),
    VOICEOVER_PATH: path.join(dataDir, 'voiceovers'),
    SOUNDBOARD_PATH: path.join(dataDir, 'soundboard'),
    DIAG_LOG_PATH: path.join(dataDir, 'diag'),
    DEVICE_ID: 'neon-dj-demo'
  };
  const keys = readApiKeys();
  if (keys.OPENAI_API_KEY) env.OPENAI_API_KEY = keys.OPENAI_API_KEY;
  if (keys.ELEVENLABS_API_KEY) env.ELEVENLABS_API_KEY = keys.ELEVENLABS_API_KEY;
  return env;
}

function startServer() {
  const entry = path.join(boothDir, 'server', 'start.js');
  const logFile = path.join(dataDir, 'server.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  logStream.write(`\n===== NEON DJ demo start ${new Date().toISOString()} =====\n`);
  serverProc = spawn(runtimeNode, [entry], {
    cwd: path.join(boothDir, 'server'),
    env: serverEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  serverProc.stdout.pipe(logStream);
  serverProc.stderr.pipe(logStream);
  serverProc.on('exit', (code) => {
    if (!shuttingDown) {
      dialog.showErrorBox(
        'NEON DJ — server stopped',
        `The background server exited unexpectedly (code ${code}).\nSee data/server.log inside the app folder for details.`
      );
      app.quit();
    }
  });
}

// Resolves only when the full app reports ready — the server's pre-load stub
// answers 200 to everything, so a bare status-code check is not enough.
function waitForReady(timeoutMs = 180000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (serverProc && serverProc.exitCode !== null) {
        return reject(new Error(`server exited during startup (code ${serverProc.exitCode}) — see data/server.log`));
      }
      const req = http.get({ host: '127.0.0.1', port: DEMO_PORT, path: '/api/boot-status', timeout: 2000 }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            // The pre-load stub answers every request with HTML, so valid
            // boot-status JSON means the full app has mounted. (The `ready`
            // flag itself is only set by the R2 sync path, which the
            // start.js entry never invokes — do not wait on it.)
            const parsed = JSON.parse(body);
            if (parsed && Array.isArray(parsed.steps)) return resolve();
          } catch {}
          retry();
        });
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error('server did not become ready in time — see data/server.log'));
      setTimeout(tick, 500);
    };
    tick();
  });
}

// Refuse to start if something else already owns our port — otherwise the
// window could silently attach to a foreign process.
function assertPortFree() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: DEMO_PORT, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      reject(new Error(`Port ${DEMO_PORT} is already in use by another program. Close it (or a previous copy of NEON DJ) and try again.`));
    });
    req.on('error', () => resolve());
    req.on('timeout', () => { req.destroy(); resolve(); });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'NEON DJ',
    backgroundColor: '#08081a',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  // External links (entertainer websites etc.) open in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // Right-click → Cut/Copy/Paste on text fields. Bare Electron shells don't
  // get a context menu at all, which is why paste "never worked" here. This
  // is DEMO-ONLY — the venue kiosks run a completely different shell.
  mainWindow.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const items = [];
    if (params.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
    else items.push({ role: 'copy' });
    Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });
  mainWindow.loadURL(`http://127.0.0.1:${DEMO_PORT}/`);
}

app.whenReady().then(async () => {
  try {
    ensureDataDirs();
    ensureKeysFile();
    // Real Edit menu so clipboard shortcuts work inside the window too.
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'viewMenu' }]));
    await assertPortFree();
    // Sync keys from Home Base BEFORE the server starts so the fresh keys
    // flow in as env (env is authoritative for the ElevenLabs key).
    const synced = await syncKeysFromHomebase();
    startServer();
    await waitForReady();
    await saveSyncedKeysLocally(synced);
    createWindow();
  } catch (err) {
    dialog.showErrorBox('NEON DJ failed to start', String(err && err.message || err));
    app.quit();
  }
});

function stopServer() {
  shuttingDown = true;
  if (serverProc && !serverProc.killed) {
    try { serverProc.kill(); } catch {}
  }
}

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});
app.on('before-quit', stopServer);
process.on('exit', stopServer);
