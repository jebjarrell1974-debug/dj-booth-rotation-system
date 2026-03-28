import { execSync, spawn } from 'child_process';
import { existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { networkInterfaces, hostname, uptime, freemem, totalmem } from 'os';

const HEARTBEAT_INTERVAL_MS = 1 * 60 * 1000;
const FLEET_SERVER_URL = process.env.FLEET_SERVER_URL || '';

let heartbeatTimer = null;
let lastPlayHistorySyncTime = null;

function executeRemoteCommand(command) {
  const appDir = process.env.APP_DIR || '/home/neonaidj001/djbooth';
  try {
    switch (command) {
      case 'update': {
        console.log('📡 Remote update queued — launching background process (takes 5-10 min)...');
        const homeDir = process.env.HOME || `/home/${process.env.USER || 'pi'}`;
        const updateScript = existsSync(`${homeDir}/djbooth-update.sh`)
          ? `${homeDir}/djbooth-update.sh`
          : `${appDir}/public/djbooth-update-github.sh`;
        const child = spawn('bash', [updateScript], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, HOME: homeDir },
        });
        child.unref();
        console.log(`📡 Update running as background process (PID ${child.pid}) — stamp file will appear when done`);
        break;
      }
      case 'restart':
        console.log('📡 Executing remote restart...');
        execSync('sudo systemctl restart djbooth.service', { timeout: 30000, stdio: 'inherit' });
        break;
      case 'sync':
        console.log('📡 Executing remote sync...');
        execSync(`cd ${appDir} && node server/r2-boot-sync.js`, { timeout: 300000, stdio: 'inherit' });
        break;
      case 'reboot':
        console.log('📡 Executing remote reboot...');
        execSync('sudo reboot', { timeout: 10000, stdio: 'inherit' });
        break;
      default:
        console.warn(`📡 Unknown command: ${command}`);
    }
  } catch (err) {
    console.error(`📡 Command '${command}' failed:`, err.message);
  }
}

function getLocalIps() {
  const nets = networkInterfaces();
  const ips = { local: '', tailscale: '' };
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        if (name.startsWith('tailscale') || net.address.startsWith('100.')) {
          ips.tailscale = net.address;
        } else {
          ips.local = net.address;
        }
      }
    }
  }
  return ips;
}

function getCpuTemp() {
  try {
    const temp = execSync('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null', { encoding: 'utf8' }).trim();
    return (parseInt(temp) / 1000).toFixed(1);
  } catch {
    return null;
  }
}

function getDiskInfo() {
  try {
    const musicPath = process.env.MUSIC_PATH || process.env.HOME || '/';
    const target = existsSync(musicPath) ? musicPath : '/';
    const df = execSync(`df -B1 "${target}" | tail -1`, { encoding: 'utf8' }).trim().split(/\s+/);
    return { total: parseInt(df[1]), free: parseInt(df[3]) };
  } catch {
    return { total: null, free: null };
  }
}

function countFiles(dir, ext) {
  if (!dir || !existsSync(dir)) return 0;
  try {
    let count = 0;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (!ext || entry.name.endsWith(ext))) count++;
      if (entry.isDirectory()) {
        count += countFiles(`${dir}/${entry.name}`, ext);
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function getMemoryInfo() {
  const free = freemem();
  const total = totalmem();
  if (!total || total <= 0) return { free: null, total: null, used: null, pct: null };
  return { free, total, used: total - free, pct: Math.round(((total - free) / total) * 100) };
}

function getServiceUptime() {
  try {
    const out = execSync('systemctl show djbooth.service --property=ActiveEnterTimestamp --no-pager 2>/dev/null', { encoding: 'utf8' }).trim();
    const match = out.match(/ActiveEnterTimestamp=(.+)/);
    if (match && match[1] && match[1] !== '') {
      const started = new Date(match[1]).getTime();
      if (!isNaN(started)) return Math.round((Date.now() - started) / 1000);
    }
  } catch {}
  return null;
}

function getLastSuccessfulUpdate() {
  try {
    const stampFile = process.env.HOME
      ? `${process.env.HOME}/.djbooth-last-update`
      : `/home/${process.env.USER || 'pi'}/.djbooth-last-update`;
    if (existsSync(stampFile)) {
      const raw = readFileSync(stampFile, 'utf8').trim();
      const [sha, tsStr] = raw.split('|');
      const ts = parseInt(tsStr, 10);
      return {
        lastUpdateTime: isNaN(ts) ? null : ts,
        lastUpdateCommit: sha ? sha.slice(0, 7) : null,
      };
    }
  } catch {}
  return { lastUpdateTime: null, lastUpdateCommit: null };
}

function getNetworkLatency() {
  try {
    const out = execSync('ping -c 3 -W 2 8.8.8.8 2>/dev/null', { encoding: 'utf8', timeout: 8000 });
    const match = out.match(/rtt min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/);
    if (match) {
      return {
        pingMin: parseFloat(match[1]),
        pingAvg: parseFloat(match[2]),
        pingMax: parseFloat(match[3]),
        pingJitter: parseFloat(match[4]),
        pingOk: true,
      };
    }
    const lossMatch = out.match(/(\d+)% packet loss/);
    return { pingMin: null, pingAvg: null, pingMax: null, pingJitter: null, pingOk: false, packetLoss: lossMatch ? parseInt(lossMatch[1]) : 100 };
  } catch {
    return { pingMin: null, pingAvg: null, pingMax: null, pingJitter: null, pingOk: false, packetLoss: 100 };
  }
}

function getRecentServiceLogs() {
  try {
    const out = execSync(
      'journalctl -u djbooth.service --no-pager -n 200 -p warning --output=short-iso 2>/dev/null || true',
      { timeout: 5000, encoding: 'utf8' }
    );
    const lines = out.trim().split('\n').filter(l => l.trim() && !l.startsWith('--'));
    return lines.slice(-50);
  } catch {
    return [];
  }
}

async function getRecentPlayHistory() {
  try {
    const { default: db } = await import('./db.js');
    if (!lastPlayHistorySyncTime) {
      try {
        const saved = db.prepare("SELECT value FROM settings WHERE key = 'last_play_history_sync'").get();
        if (saved) lastPlayHistorySyncTime = saved.value;
      } catch {}
    }
    const since = lastPlayHistorySyncTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');
    const rows = db.prepare(
      `SELECT track_name, dancer_name, genre, played_at FROM play_history
       WHERE played_at > ? ORDER BY played_at ASC LIMIT 500`
    ).all(since);
    return rows;
  } catch {
    return [];
  }
}

async function getDancerBackupPayload() {
  try {
    const { exportDancers, getClientSettings } = await import('./db.js');
    const dancers = exportDancers();
    const settings = getClientSettings();
    return { dancers, settings };
  } catch {
    return { dancers: [], settings: {} };
  }
}

function getDeviceId() {
  return process.env.DEVICE_ID || hostname() || 'unknown';
}

async function sendHeartbeat(extraData = {}) {
  if (!FLEET_SERVER_URL) return;

  const ips = getLocalIps();
  const disk = getDiskInfo();
  const musicPath = process.env.MUSIC_PATH || '';
  const voiceoverPath = process.env.VOICEOVER_PATH || process.env.VOICEOVER_DIR || '';

  const memory = getMemoryInfo();
  const network = getNetworkLatency();

  const recentPlays = await getRecentPlayHistory();
  const dancerBackup = await getDancerBackupPayload();

  const payload = {
    deviceId: getDeviceId(),
    name: getDeviceId(),
    clubName: extraData.clubName || process.env.CLUB_NAME || '',
    ip: ips.local,
    tailscaleIp: ips.tailscale,
    cpuTemp: getCpuTemp(),
    diskFree: disk.free,
    diskTotal: disk.total,
    uptime: Math.round(uptime()),
    appRunning: true,
    trackCount: extraData.trackCount || 0,
    voiceoverCount: countFiles(voiceoverPath, '.mp3'),
    currentDancer: extraData.currentDancer || null,
    currentSong: extraData.currentSong || null,
    version: extraData.version || null,
    lastError: extraData.lastError || null,
    apiCosts: extraData.apiCosts || null,
    memFree: memory.free,
    memTotal: memory.total,
    memPct: memory.pct,
    serviceUptime: getServiceUptime(),
    ...getLastSuccessfulUpdate(),
    activeEntertainers: extraData.activeEntertainers || 0,
    errorCount: extraData.errorCount || 0,
    dancer_names: extraData.dancer_names || [],
    network,
    recentLogs: getRecentServiceLogs(),
    recentPlays,
    dancerBackup: {
      dancers: dancerBackup.dancers,
      settings: dancerBackup.settings,
    },
    isRotationActive: extraData.isRotationActive || false,
    isPlaying: extraData.isPlaying || false,
    announcementsEnabled: extraData.announcementsEnabled !== false,
    songsPerSet: extraData.songsPerSet || 3,
    diagLog: extraData.diagLog || [],
    prePickHits: extraData.prePickHits || 0,
    prePickMisses: extraData.prePickMisses || 0,
    lastTransitionMs: extraData.lastTransitionMs ?? null,
    lastWatchdogAt: extraData.lastWatchdogAt ?? null,
    lastWatchdogSilentMs: extraData.lastWatchdogSilentMs ?? null,
    lastWatchdogDancer: extraData.lastWatchdogDancer ?? null,
    lastWatchdogTrack: extraData.lastWatchdogTrack ?? null,
  };

  try {
    const t0 = Date.now();
    const res = await fetch(`${FLEET_SERVER_URL}/api/monitor/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const heartbeatMs = Date.now() - t0;
    if (res.ok) {
      if (recentPlays.length > 0) {
        lastPlayHistorySyncTime = recentPlays[recentPlays.length - 1].played_at;
        try {
          const { default: db } = await import('./db.js');
          db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_play_history_sync', ?)").run(lastPlayHistorySyncTime);
        } catch {}
      }
      console.log(`💓 Heartbeat sent (${heartbeatMs}ms, ping ${network.pingAvg || '--'}ms, ${recentPlays.length} plays)`);
      try {
        const body = await res.json();
        if (body.commands && Array.isArray(body.commands)) {
          for (const cmd of body.commands) {
            console.log(`📡 Received command: ${cmd.command}`);
            if (cmd.command === 'restore_dancers' && cmd.data) {
              try {
                const { importDancers, saveClientSettings } = await import('./db.js');
                if (cmd.data.dancers && Array.isArray(cmd.data.dancers)) {
                  const result = importDancers(cmd.data.dancers, { overwrite: false });
                  console.log(`📡 Dancer restore: imported ${result.imported}, skipped ${result.skipped}`);
                }
                if (cmd.data.settings && typeof cmd.data.settings === 'object') {
                  saveClientSettings(cmd.data.settings);
                  console.log('📡 Client settings restored from backup');
                }
              } catch (err) {
                console.error('📡 restore_dancers failed:', err.message);
              }
            } else {
              executeRemoteCommand(cmd.command);
            }
          }
        }
      } catch {}
    } else {
      console.warn(`💓 Heartbeat failed: ${res.status}`);
    }
  } catch (err) {
    console.warn(`💓 Heartbeat error: ${err.message}`);
  }
}

let lastR2DancerBackup = 0;
const R2_DANCER_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function maybeBackupDancersToR2() {
  const now = Date.now();
  if (now - lastR2DancerBackup < R2_DANCER_BACKUP_INTERVAL_MS) return;
  try {
    const { backupDancersToR2 } = await import('./r2sync.js');
    const { exportDancers, getClientSettings } = await import('./db.js');
    const deviceId = getDeviceId();
    const dancers = exportDancers();
    if (dancers.length === 0) return;
    const settings = getClientSettings();
    const ok = await backupDancersToR2(deviceId, dancers, settings);
    if (ok) lastR2DancerBackup = now;
  } catch {}
}

function startHeartbeat(getExtraData) {
  if (!FLEET_SERVER_URL) {
    console.log('ℹ️ FLEET_SERVER_URL not set — heartbeat disabled');
    return;
  }
  console.log(`💓 Heartbeat client active — reporting to ${FLEET_SERVER_URL} every 5 min`);

  const beat = async () => {
    await sendHeartbeat(getExtraData ? getExtraData() : {});
    maybeBackupDancersToR2().catch(() => {});
  };
  beat();
  heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export { startHeartbeat, stopHeartbeat, sendHeartbeat };
