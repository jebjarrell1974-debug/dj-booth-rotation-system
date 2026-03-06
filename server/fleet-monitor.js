import db from './db.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const devices = new Map();
const pendingCommands = new Map();
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

function ensureDeviceInDb(deviceId, data) {
  try {
    const existing = db.prepare('SELECT device_id FROM fleet_devices WHERE device_id = ?').get(deviceId);
    if (!existing) {
      const apiKey = 'auto_' + deviceId + '_' + Date.now().toString(36);
      db.prepare(`
        INSERT INTO fleet_devices (device_id, device_name, club_name, api_key, status, last_heartbeat)
        VALUES (?, ?, ?, ?, 'online', ?)
      `).run(deviceId, data.name || deviceId, data.clubName || '', apiKey, Date.now());
      console.log(`📋 Auto-registered fleet device: ${deviceId}`);
    }
  } catch (err) {
    console.error('Fleet DB auto-register error:', err.message);
  }
}

function recordHeartbeatInDb(deviceId, data) {
  try {
    const now = Date.now();
    db.prepare('UPDATE fleet_devices SET last_heartbeat = ?, status = ?, app_version = ?, club_name = ? WHERE device_id = ?')
      .run(now, 'online', data.version || '1.0.0', data.clubName || '', deviceId);

    const diskPercent = (data.diskTotal && data.diskFree)
      ? Math.round(((data.diskTotal - data.diskFree) / data.diskTotal) * 100)
      : 0;

    db.prepare(`
      INSERT INTO fleet_heartbeats (device_id, timestamp, app_version, cpu_percent, memory_percent, disk_percent, uptime_seconds, active_dancers, is_playing)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deviceId, now,
      data.version || '1.0.0',
      data.cpuTemp ? parseFloat(data.cpuTemp) : 0,
      0,
      diskPercent,
      data.uptime || 0,
      0,
      0
    );

    const cutoff = now - (7 * 24 * 60 * 60 * 1000);
    db.prepare('DELETE FROM fleet_heartbeats WHERE timestamp < ?').run(cutoff);
  } catch (err) {
    console.error('Fleet DB heartbeat error:', err.message);
  }
}

async function registerHeartbeat(deviceId, data) {
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
    apiCosts: data.apiCosts || null,
    memFree: data.memFree || null,
    memTotal: data.memTotal || null,
    memPct: data.memPct || null,
    serviceUptime: data.serviceUptime || null,
    lastUpdateTime: data.lastUpdateTime || null,
    activeEntertainers: data.activeEntertainers || 0,
    errorCount: data.errorCount || 0,
    network: data.network || null,
  });

  if (data.dancer_names && Array.isArray(data.dancer_names)) {
    try {
      const { upsertDancerRoster } = await import('./fleet-db.js');
      for (const name of data.dancer_names) {
        if (name && typeof name === 'string') {
          upsertDancerRoster(name.trim(), deviceId);
        }
      }
    } catch {}
  }

  ensureDeviceInDb(deviceId, data);
  recordHeartbeatInDb(deviceId, data);

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
      try {
        db.prepare("UPDATE fleet_devices SET status = 'offline' WHERE device_id = ?").run(id);
      } catch {}
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

function loadDevicesFromDb() {
  try {
    const rows = db.prepare('SELECT * FROM fleet_devices').all();
    const now = Date.now();
    for (const row of rows) {
      if (!devices.has(row.device_id)) {
        const lastHb = row.last_heartbeat || (now - HEARTBEAT_TIMEOUT_MS - 60000);
        devices.set(row.device_id, {
          deviceId: row.device_id,
          name: row.device_name || row.device_id,
          clubName: row.club_name || 'Unknown',
          ip: '',
          tailscaleIp: '',
          cpuTemp: null,
          diskFree: null,
          diskTotal: null,
          uptime: null,
          appRunning: false,
          trackCount: 0,
          voiceoverCount: 0,
          currentDancer: null,
          currentSong: null,
          version: null,
          lastHeartbeat: lastHb,
          status: (now - lastHb) > HEARTBEAT_TIMEOUT_MS ? 'offline' : row.status || 'offline',
          lastError: null,
        });
      }
    }
    if (rows.length > 0) {
      console.log(`📋 Loaded ${rows.length} fleet device(s) from database`);
    }
  } catch (err) {
    console.error('Fleet DB load error:', err.message);
  }
}

function startMonitoring() {
  if (checkInterval) return;
  loadDevicesFromDb();
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
  app.post('/api/monitor/heartbeat', async (req, res) => {
    const { deviceId, ...data } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    await registerHeartbeat(deviceId, data);
    const pending = pendingCommands.get(deviceId);
    if (pending && pending.length > 0) {
      const cmds = [...pending];
      pendingCommands.delete(deviceId);
      return res.json({ ok: true, timestamp: Date.now(), commands: cmds });
    }
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.get('/api/monitor/status', (req, res) => {
    res.json({ devices: getFleetStatus(), telegramActive: isTelegramConfigured() });
  });

  app.post('/api/monitor/test-telegram', async (req, res) => {
    if (!isTelegramConfigured()) {
      return res.status(400).json({ error: 'Telegram not configured' });
    }
    await sendTelegram('🧪 <b>Test Alert</b>\nNEON AI DJ fleet monitoring is active!');
    res.json({ ok: true, message: 'Test message sent' });
  });

  app.post('/api/monitor/broadcast', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    await sendTelegram(`📢 <b>Broadcast</b>\n${message}`);
    res.json({ ok: true });
  });

  app.post('/api/monitor/command/:deviceId/:action', (req, res) => {
    const { deviceId, action } = req.params;
    const { pin } = req.body || {};
    if (!deviceId || !action) return res.status(400).json({ error: 'deviceId and action required' });
    const masterPin = process.env.MASTER_PIN || '36669';
    if (pin !== masterPin) return res.status(403).json({ error: 'Invalid PIN' });
    const validCommands = ['update', 'restart', 'sync', 'reboot'];
    if (!validCommands.includes(action)) return res.status(400).json({ error: 'Invalid command' });
    if (!pendingCommands.has(deviceId)) pendingCommands.set(deviceId, []);
    pendingCommands.get(deviceId).push({ command: action, timestamp: Date.now() });
    res.json({ ok: true, queued: action });
  });
}

export { setupFleetMonitorRoutes, startMonitoring, stopMonitoring, sendTelegram, isTelegramConfigured, getFleetStatus };
