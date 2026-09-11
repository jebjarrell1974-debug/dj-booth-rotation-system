import http from 'http';
import { startGenericVoiceoverRefresh } from './generic-voiceover-refresh.js';

const PORT = process.env.PORT || 5000;

let expressApp = null;
let requestCount = 0;

const server = http.createServer((req, res) => {
  requestCount++;
  if (!expressApp) {
    console.log(`🩺 Pre-load request #${requestCount}: ${req.method} ${req.url} → 200 OK`);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>Starting up...</h1></body></html>');
    return;
  }
  expressApp(req, res);
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`⚡ Health responder ready on port ${PORT}, loading full app...`);

  try {
    const startTime = Date.now();
    const { app, initMusicScanner, stopPeriodicScan, stopCheckpoints, closeDatabase } = await import('./index.js');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Full app loaded in ${elapsed}s, switching over...`);

    expressApp = app;
    console.log(`🎵 NEON AI DJ server running on port ${PORT}`);
    initMusicScanner();
    startGenericVoiceoverRefresh();

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
  } catch (err) {
    console.error('❌ Failed to load app:', err);
    process.exit(1);
  }
});
