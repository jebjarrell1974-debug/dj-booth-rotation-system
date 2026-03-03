import http from 'http';

const PORT = process.env.PORT || 3001;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const devices = new Map();

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

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/monitor/heartbeat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { deviceId } = data;
        if (!deviceId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'deviceId required' }));
          return;
        }

        const now = Date.now();
        const existing = devices.get(deviceId);
        const wasOffline = existing && existing.status === 'offline';

        devices.set(deviceId, {
          name: data.name || deviceId,
          clubName: data.clubName || 'Unknown',
          ip: data.ip || '',
          tailscaleIp: data.tailscaleIp || '',
          cpuTemp: data.cpuTemp || null,
          uptime: data.uptime || null,
          appRunning: data.appRunning !== false,
          trackCount: data.trackCount || 0,
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, timestamp: now }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/monitor/status') {
    const result = [];
    for (const [id, dev] of devices) {
      const ago = Math.round((Date.now() - dev.lastHeartbeat) / 1000);
      result.push({ deviceId: id, ...dev, secondsAgo: ago });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ devices: result, telegramActive: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/monitor/test-telegram') {
    sendTelegram('🧪 <b>Test Alert</b>\nNEON AI DJ fleet monitoring is active!').then(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (req.url === '/' || req.url === '/__health') {
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
  console.log('  NEON AI DJ — Fleet Monitor');
  console.log('================================================');
  console.log(`  Port:     ${PORT}`);
  console.log(`  Telegram: ${TELEGRAM_BOT_TOKEN ? 'Active' : 'NOT CONFIGURED'}`);
  console.log(`  Timeout:  ${HEARTBEAT_TIMEOUT_MS / 60000} min`);
  console.log(`  Check:    every ${CHECK_INTERVAL_MS / 60000} min`);
  console.log('================================================');
  console.log('');
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    sendTelegram('🟢 <b>Fleet Monitor Started</b>\nMonitoring is now active.');
  }
});
