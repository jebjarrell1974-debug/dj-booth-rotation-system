import { execSync } from 'child_process';
import { existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { networkInterfaces, hostname, uptime, freemem, totalmem } from 'os';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const FLEET_SERVER_URL = process.env.FLEET_SERVER_URL || '';

let heartbeatTimer = null;

function executeRemoteCommand(command) {
  const appDir = process.env.APP_DIR || '/home/neonaidj001/djbooth';
  try {
    switch (command) {
      case 'update':
        console.log('📡 Executing remote update...');
        execSync(`cd ${appDir} && bash public/djbooth-update-github.sh`, { timeout: 120000, stdio: 'inherit' });
        break;
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

function getLastUpdateTime() {
  try {
    const gitDir = process.env.APP_DIR ? `${process.env.APP_DIR}/.git` : '/home/jebjarrell/djbooth/.git';
    if (existsSync(`${gitDir}/FETCH_HEAD`)) {
      const stat = statSync(`${gitDir}/FETCH_HEAD`);
      return stat.mtimeMs;
    }
  } catch {}
  return null;
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
    lastUpdateTime: getLastUpdateTime(),
    activeEntertainers: extraData.activeEntertainers || 0,
    errorCount: extraData.errorCount || 0,
    dancer_names: extraData.dancer_names || [],
    network,
  };

  try {
    const t0 = Date.now();
    const res = await fetch(`${FLEET_SERVER_URL}/api/monitor/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const heartbeatMs = Date.now() - t0;
    if (res.ok) {
      console.log(`💓 Heartbeat sent (${heartbeatMs}ms, ping ${network.pingAvg || '--'}ms)`);
      try {
        const body = await res.json();
        if (body.commands && Array.isArray(body.commands)) {
          for (const cmd of body.commands) {
            console.log(`📡 Received command: ${cmd.command}`);
            executeRemoteCommand(cmd.command);
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
