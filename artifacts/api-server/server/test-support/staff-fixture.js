// Disposable authentication fixture. Executes the actual product route bodies
// and middleware against real SQLite/bcrypt, never the live unit/database.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import express from 'express';
import { canManageStaff, resolveDjIdentity, validateStaffInput } from '../staff-access.js';
import { isPhysicalKioskRequestMetadata } from '../booth-command-policy.js';

const directory = mkdtempSync(join(tmpdir(), 'neon-staff-fixture-'));
process.env.DB_PATH = join(directory, 'fixture.db');
process.env.VOICEOVER_PATH = join(directory, 'voiceovers');
const database = await import('../db.js');
export const fixtureCodes = { gm: '81357', admin: '92468', dj: '13579', manager: '24680' };
database.setSetting('dj_pin', database.hashPin(fixtureCodes.gm));
database.setSetting('master_pin', fixtureCodes.admin);
database.createStaffAccount('Fixture DJ', 'dj', fixtureCodes.dj);
database.createStaffAccount('Fixture Manager', 'manager', fixtureCodes.manager);
export { database };

export function createStaffFixtureApp() {
  const app = express();
  app.use(express.json());
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const middleware = source.slice(source.indexOf('function authenticate('), source.indexOf('const DEFAULT_MASTER_PIN'));
  const auto = source.slice(source.indexOf("app.post('/api/auth/auto-login'"), source.indexOf('const loginAttempts'));
  const start = source.indexOf("app.post('/api/auth/login'");
  const end = source.indexOf("app.get('/api/dancers'", start);
  if (start < 0 || end <= start) throw new Error('Product auth route boundaries missing');
  const routes = source.slice(start, end);
  if (!middleware || !auto || !routes || !routes.includes("app.put('/api/staff/:id'")) {
    throw new Error('Product route extraction incomplete');
  }
  vm.runInNewContext(`${middleware}\n${auto}\n${routes}`, {
    ...database, app, canManageStaff, resolveDjIdentity, validateStaffInput,
    getMasterPin: () => database.getSetting('master_pin'),
    requirePhysicalKiosk: (req, res, next) => {
      const peer = (req.socket.remoteAddress || '').replace('::ffff:', '');
      if (!isPhysicalKioskRequestMetadata(peer, req.headers.host, req.headers)) {
        return res.status(403).json({ error: 'Physical kiosk only' });
      }
      next();
    },
    DANCER_TIMEOUT_MS: 14_400_000,
    loginAttempts: new Map(), LOGIN_MIN_INTERVAL_MS: 1000,
    console,
  });
  return app;
}

export function closeStaffFixture() {
  database.stopCheckpoints();
  database.closeDatabase();
  rmSync(directory, { recursive: true, force: true });
}

// Minimal non-auth data for a browser-only fixture. These routes are not
// product behavior; staff authentication/CRUD above ARE actual product code.
export function addBrowserFixtureRoutes(app) {
  app.get('/api/boot-status', (req, res) => res.json({ ready: true, elapsed: 1, steps: [] }));
  app.get('/api/settings/client', (req, res) => res.json({}));
  app.get('/api/dj-options', (req, res) => res.json({ musicMode: 'dancer_first', activeGenres: [] }));
  app.get('/api/music/genres', (req, res) => res.json({ genres: [] }));
  app.get('/api/music/tracks', (req, res) => res.json({ tracks: [], total: 0 }));
  app.get('/api/booth/state', (req, res) => res.json({ stateVersion: 1, epoch: 'staff-fixture', rotation: [], dancers: [], isRotationActive: false }));
  app.get('/api/booth/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('event: fixture\ndata: {}\n\n');
    const timer = setInterval(() => res.write(': fixture\n\n'), 10000);
    req.on('close', () => clearInterval(timer));
  });
  app.get('/api/*path', (req, res) => res.json([]));
  app.post('/api/*path', (req, res) => res.json({ ok: true }));
  const publicDir = fileURLToPath(new URL('../../../dj-booth/dist/public/', import.meta.url));
  app.use(express.static(publicDir));
  app.get('/*path', (req, res) => res.sendFile(join(publicDir, 'index.html')));
}
