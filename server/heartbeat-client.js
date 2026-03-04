import { execSync } from 'child_process';
import { existsSync, statSync, readdirSync } from 'fs';
import { networkInterfaces, hostname, uptime } from 'os';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const FLEET_SERVER_URL = process.env.FLEET_SERVER_URL || '';

let heartbeatTimer = null;

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
    const df = execSync("df -B1 / | tail -1", { encoding: 'utf8' }).trim().split(/\s+/);
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

function getDeviceId() {
  return process.env.DEVICE_ID || hostname() || 'unknown';
}

async function sendHeartbeat(extraData = {}) {
  if (!FLEET_SERVER_URL) return;

  const ips = getLocalIps();
  const disk = getDiskInfo();
  const musicPath = process.env.MUSIC_PATH || '';
  const voiceoverPath = process.env.VOICEOVER_PATH || process.env.VOICEOVER_DIR || '';

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
  };

  try {
    const res = await fetch(`${FLEET_SERVER_URL}/api/monitor/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      console.log('💓 Heartbeat sent');
    } else {
      console.warn(`💓 Heartbeat failed: ${res.status}`);
    }
  } catch (err) {
    console.warn(`💓 Heartbeat error: ${err.message}`);
  }
}

function startHeartbeat(getExtraData) {
  if (!FLEET_SERVER_URL) {
    console.log('ℹ️ FLEET_SERVER_URL not set — heartbeat disabled');
    return;
  }
  console.log(`💓 Heartbeat client active — reporting to ${FLEET_SERVER_URL} every 5 min`);

  const beat = () => sendHeartbeat(getExtraData ? getExtraData() : {});
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
