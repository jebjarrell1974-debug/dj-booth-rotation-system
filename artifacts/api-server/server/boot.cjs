const http = require('http');
const PORT = process.env.PORT || 5000;

let expressApp = null;

const server = http.createServer((req, res) => {
  if (req.url === '/__health' || req.url === '/__health/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }
  if (expressApp) return expressApp(req, res);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body><h1>Starting up...</h1></body></html>');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Health responder ready on port ${PORT}, loading full app...`);

  import('./index.js').then(async (mod) => {
    const { app, initMusicScanner, initR2Sync, stopPeriodicScan, stopCheckpoints, closeDatabase } = mod;

    let startMonitoring, stopMonitoring, startHeartbeat, stopHeartbeat;
    try {
      const fm = await import('./fleet-monitor.js');
      startMonitoring = fm.startMonitoring;
      stopMonitoring = fm.stopMonitoring;
    } catch (e) { console.warn('Fleet monitor not available:', e.message); }
    try {
      const hb = await import('./heartbeat-client.js');
      startHeartbeat = hb.startHeartbeat;
      stopHeartbeat = hb.stopHeartbeat;
    } catch (e) { console.warn('Heartbeat client not available:', e.message); }

    expressApp = app;
    console.log(`🎵 NEON AI DJ server running on port ${PORT}`);

    initMusicScanner();

    if (startMonitoring) startMonitoring();
    if (startHeartbeat) {
      const { getMusicTrackCount, getSetting } = await import('./db.js');
      startHeartbeat(() => ({
        trackCount: getMusicTrackCount(),
        clubName: getSetting('club_name') || '',
        version: getSetting('app_version') || '',
      }));
    }

    if (initR2Sync) {
      initR2Sync().catch(err => {
        console.error('☁️ R2 init error:', err.message);
      });
    }

    const gracefulShutdown = () => {
      console.log('🛑 Shutting down gracefully...');
      stopPeriodicScan();
      stopCheckpoints();
      if (stopMonitoring) stopMonitoring();
      if (stopHeartbeat) stopHeartbeat();
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
  }).catch(err => {
    console.error('❌ Failed to load app:', err);
    process.exit(1);
  });
});
