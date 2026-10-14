import { createStaffFixtureApp, addBrowserFixtureRoutes, closeStaffFixture } from './staff-fixture.js';
const app = createStaffFixtureApp();
addBrowserFixtureRoutes(app);
const server = app.listen(18777, '127.0.0.1', () => console.log('Isolated staff browser fixture ready on 127.0.0.1:18777'));
process.on('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => { closeStaffFixture(); process.exit(0); });
});
