const http = require('http');
const PORT = process.env.PORT || 5000;

let expressApp = null;

const server = http.createServer((req, res) => {
  if (expressApp) return expressApp(req, res);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body><h1>Starting up...</h1></body></html>');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Health responder ready on port ${PORT}, loading full app...`);

  import('./index.js').then(({ app, initMusicScanner, stopPeriodicScan, stopCheckpoints, closeDatabase }) => {
    expressApp = app;
    console.log(`🎵 DJ Booth API server running on port ${PORT}`);
    initMusicScanner();

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
  }).catch(err => {
    console.error('❌ Failed to load app:', err);
    process.exit(1);
  });
});
