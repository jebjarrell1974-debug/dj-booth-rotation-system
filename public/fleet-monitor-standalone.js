import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3001;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const devices = new Map();
const commandRateLimit = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 10;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = commandRateLimit.get(ip);
  if (!entry || (now - entry.windowStart) > RATE_LIMIT_WINDOW_MS) {
    commandRateLimit.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return false;
  return true;
}

let dashboardHtml = '';
try {
  const htmlPath = join(__dirname, 'fleet-dashboard.html');
  if (existsSync(htmlPath)) {
    dashboardHtml = readFileSync(htmlPath, 'utf8');
  }
} catch (err) {
  console.error('Failed to load dashboard HTML:', err.message);
}

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' });
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  } catch (err) {
    console.error('Telegram error:', err.message);
  }
}

function checkDevices() {
  const now = Date.now();
  for (const [id, dev] of devices) {
    if (dev.status === 'online' && (now - dev.lastHeartbeat) > HEARTBEAT_TIMEOUT_MS) {
      dev.status = 'offline';
      const lastSeen = Math.round((now - dev.lastHeartbeat) / 60000);
      console.log(`🔴 ${dev.name} (${dev.clubName}) went OFFLINE — last heartbeat ${lastSeen} min ago`);
      sendTelegram(
        `🔴 <b>ALERT</b>\n<b>${dev.name}</b> (${dev.clubName})\nOffline — last heartbeat ${lastSeen} min ago`
      );
    }
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

async function relayCommand(deviceIp, action, pin) {
  const url = `http://${deviceIp}:3001/api/admin/${action}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await resp.json();
    return { ok: resp.ok, status: resp.status, ...data };
  } catch (err) {
    return { ok: false, error: `Failed to reach device: ${err.message}` };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/monitor/heartbeat') {
    const data = await parseBody(req);
    const { deviceId } = data;
    if (!deviceId) return jsonResponse(res, 400, { error: 'deviceId required' });

    const now = Date.now();
    const existing = devices.get(deviceId);
    const wasOffline = existing && existing.status === 'offline';

    devices.set(deviceId, {
      name: data.name || deviceId,
      clubName: data.clubName || 'Unknown',
      ip: data.ip || '',
      tailscaleIp: data.tailscaleIp || '',
      cpuTemp: data.cpuTemp || null,
      diskFree: data.diskFree || null,
      diskTotal: data.diskTotal || null,
      uptime: data.uptime || null,
      appRunning: data.appRunning !== false,
      trackCount: data.trackCount || 0,
      voiceoverCount: data.voiceoverCount || 0,
      currentDancer: data.currentDancer || null,
      currentSong: data.currentSong || null,
      version: data.version || null,
      lastError: data.lastError || null,
      apiCosts: data.apiCosts || null,
      lastHeartbeat: now,
      status: 'online',
    });

    if (wasOffline) {
      const dev = devices.get(deviceId);
      const downtime = existing ? Math.round((now - existing.lastHeartbeat) / 60000) : 0;
      console.log(`✅ ${dev.name} (${dev.clubName}) RECOVERED after ${downtime} min`);
      sendTelegram(
        `✅ <b>RECOVERED</b>\n<b>${dev.name}</b> (${dev.clubName})\nBack online after ${downtime} min`
      );
    } else if (!existing) {
      console.log(`📋 New device registered: ${data.name || deviceId} (${data.clubName || 'Unknown'})`);
    }

    console.log(`💓 Heartbeat from ${data.name || deviceId}`);
    return jsonResponse(res, 200, { ok: true, timestamp: now });
  }

  if (req.method === 'GET' && req.url === '/api/monitor/status') {
    const result = [];
    for (const [id, dev] of devices) {
      const ago = Math.round((Date.now() - dev.lastHeartbeat) / 1000);
      result.push({ deviceId: id, ...dev, secondsAgo: ago });
    }
    return jsonResponse(res, 200, { devices: result, telegramActive: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) });
  }

  if (req.method === 'POST' && req.url === '/api/monitor/test-telegram') {
    await sendTelegram('🧪 <b>Test Alert</b>\nNEON AI DJ fleet monitoring is active!');
    return jsonResponse(res, 200, { ok: true });
  }

  const cmdMatch = req.url?.match(/^\/api\/monitor\/command\/([^/]+)\/(update|restart|reboot|sync)$/);
  if (req.method === 'POST' && cmdMatch) {
    const clientIp = req.socket.remoteAddress || '';
    if (!checkRateLimit(clientIp)) {
      return jsonResponse(res, 429, { error: 'Too many requests. Try again later.' });
    }

    const deviceId = decodeURIComponent(cmdMatch[1]);
    const action = cmdMatch[2];
    const body = await parseBody(req);
    const { pin } = body;

    if (!pin) {
      return jsonResponse(res, 403, { error: 'PIN required' });
    }

    const device = devices.get(deviceId);
    if (!device) {
      return jsonResponse(res, 404, { error: 'Device not found' });
    }

    const targetIp = device.tailscaleIp || device.ip;
    if (!targetIp) {
      return jsonResponse(res, 400, { error: 'No IP address for device' });
    }

    console.log(`🎯 Command: ${action} → ${device.name} (${targetIp})`);
    const result = await relayCommand(targetIp, action, pin);

    if (result.ok) {
      sendTelegram(`🎯 <b>Command Sent</b>\n<b>${action.toUpperCase()}</b> → ${device.name} (${device.clubName})`);
    }

    return jsonResponse(res, result.ok ? 200 : 502, result);
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/dashboard')) {
    if (dashboardHtml) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(dashboardHtml);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('NEON AI DJ Fleet Monitor - Dashboard HTML not found. Place fleet-dashboard.html in same directory.');
    }
    return;
  }

  if (req.url === '/__health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('NEON AI DJ Fleet Monitor - OK');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

setInterval(checkDevices, CHECK_INTERVAL_MS);

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('================================================');
  console.log('  NEON AI DJ — Fleet Command Center');
  console.log('================================================');
  console.log(`  Port:      ${PORT}`);
  console.log(`  Telegram:  ${TELEGRAM_BOT_TOKEN ? 'Active' : 'NOT CONFIGURED'}`);
  console.log(`  Timeout:   ${HEARTBEAT_TIMEOUT_MS / 60000} min`);
  console.log(`  Check:     every ${CHECK_INTERVAL_MS / 60000} min`);
  console.log(`  Dashboard: http://0.0.0.0:${PORT}/`);
  console.log('================================================');
  console.log('');
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    sendTelegram('🟢 <b>Fleet Command Center Started</b>\nMonitoring + dashboard active.');
  }
});
