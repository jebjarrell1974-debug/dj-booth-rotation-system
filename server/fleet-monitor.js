import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const devices = new Map();
let checkInterval = null;

function isTelegramConfigured() {
  return !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
}

async function sendTelegram(message) {
  if (!isTelegramConfigured()) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (err) {
    console.error('Telegram send error:', err.message);
  }
}

function registerHeartbeat(deviceId, data) {
  const now = Date.now();
  const existing = devices.get(deviceId);
  const wasOffline = existing?.status === 'offline';

  devices.set(deviceId, {
    deviceId,
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
    lastHeartbeat: now,
    status: 'online',
    lastError: data.lastError || null,
  });

  if (wasOffline) {
    const dev = devices.get(deviceId);
    const downtime = existing ? Math.round((now - existing.lastHeartbeat) / 60000) : 0;
    sendTelegram(
      `✅ <b>RECOVERED</b>\n` +
      `<b>${dev.name}</b> (${dev.clubName})\n` +
      `Back online after ${downtime} min`
    );
  }
}

function checkDevices() {
  const now = Date.now();
  for (const [id, dev] of devices) {
    if (dev.status === 'online' && (now - dev.lastHeartbeat) > HEARTBEAT_TIMEOUT_MS) {
      dev.status = 'offline';
      const lastSeen = Math.round((now - dev.lastHeartbeat) / 60000);
      sendTelegram(
        `🔴 <b>ALERT</b>\n` +
        `<b>${dev.name}</b> (${dev.clubName})\n` +
        `Offline — last heartbeat ${lastSeen} min ago`
      );
    }
  }
}

function getFleetStatus() {
  const result = [];
  for (const [, dev] of devices) {
    const ago = Math.round((Date.now() - dev.lastHeartbeat) / 1000);
    result.push({ ...dev, secondsAgo: ago });
  }
  return result;
}

function startMonitoring() {
  if (checkInterval) return;
  checkInterval = setInterval(checkDevices, CHECK_INTERVAL_MS);
  if (isTelegramConfigured()) {
    console.log('📱 Telegram fleet monitoring active');
  } else {
    console.log('ℹ️ Telegram not configured — fleet monitoring without alerts');
  }
}

function stopMonitoring() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

function setupFleetMonitorRoutes(app) {
  app.post('/api/fleet/heartbeat', (req, res) => {
    const { deviceId, ...data } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    registerHeartbeat(deviceId, data);
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.get('/api/fleet/status', (req, res) => {
    res.json({ devices: getFleetStatus(), telegramActive: isTelegramConfigured() });
  });

  app.post('/api/fleet/test-telegram', async (req, res) => {
    if (!isTelegramConfigured()) {
      return res.status(400).json({ error: 'Telegram not configured' });
    }
    await sendTelegram('🧪 <b>Test Alert</b>\nNEON AI DJ fleet monitoring is active!');
    res.json({ ok: true, message: 'Test message sent' });
  });

  app.post('/api/fleet/broadcast', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    await sendTelegram(`📢 <b>Broadcast</b>\n${message}`);
    res.json({ ok: true });
  });
}

export { setupFleetMonitorRoutes, startMonitoring, stopMonitoring, sendTelegram, isTelegramConfigured };
