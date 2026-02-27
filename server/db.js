import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bcrypt from 'bcryptjs';

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getDbPath() {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  if (process.env.REPL_ID && process.env.REPLIT_DEPLOYMENT) {
    const dataDir = '/home/runner/data';
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    return join(dataDir, 'djbooth.db');
  }
  return join(__dirname, '..', 'djbooth.db');
}

const DB_PATH = getDbPath();
console.log(`📂 Database path: ${DB_PATH}`);
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');
db.pragma('synchronous = NORMAL');

export function walCheckpoint() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.error('WAL checkpoint failed:', err.message);
  }
}

export function closeDatabase() {
  try {
    walCheckpoint();
    db.close();
    console.log('🔒 Database closed cleanly');
  } catch (err) {
    console.error('DB close error:', err.message);
  }
}

const checkpointInterval = setInterval(walCheckpoint, 5 * 60 * 1000);

export function stopCheckpoints() {
  clearInterval(checkpointInterval);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dancers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#e040fb',
    pin_hash TEXT NOT NULL,
    playlist TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_date TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    dancer_id TEXT,
    last_seen INTEGER NOT NULL,
    FOREIGN KEY (dancer_id) REFERENCES dancers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS songs (
    name TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS voiceovers (
    cache_key TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    script TEXT,
    type TEXT NOT NULL,
    dancer_name TEXT,
    energy_level INTEGER DEFAULT 3,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_role ON sessions(role);
  CREATE INDEX IF NOT EXISTS idx_sessions_dancer_id ON sessions(dancer_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen);
  CREATE INDEX IF NOT EXISTS idx_voiceovers_dancer_name ON voiceovers(dancer_name);
  CREATE INDEX IF NOT EXISTS idx_voiceovers_type ON voiceovers(type);
  CREATE INDEX IF NOT EXISTS idx_voiceovers_energy_level ON voiceovers(energy_level);
  CREATE INDEX IF NOT EXISTS idx_dancers_is_active ON dancers(is_active);

  CREATE TABLE IF NOT EXISTS music_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    genre TEXT,
    size INTEGER DEFAULT 0,
    modified_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_music_tracks_name ON music_tracks(name);
  CREATE INDEX IF NOT EXISTS idx_music_tracks_genre ON music_tracks(genre);
  CREATE INDEX IF NOT EXISTS idx_music_tracks_path ON music_tracks(path);

  CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_name TEXT NOT NULL,
    dancer_name TEXT,
    played_at TEXT DEFAULT (datetime('now', 'localtime')),
    genre TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at);
  CREATE INDEX IF NOT EXISTS idx_play_history_dancer ON play_history(dancer_name);
`);

function getVoiceoverDir() {
  if (process.env.VOICEOVER_PATH) {
    const dir = process.env.VOICEOVER_PATH;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }
  if (process.env.REPL_ID && process.env.REPLIT_DEPLOYMENT) {
    const dir = '/home/runner/data/voiceovers';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }
  if (process.env.DB_PATH) {
    const dir = join(dirname(process.env.DB_PATH), 'voiceovers');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }
  const dir = join(__dirname, '..', 'voiceovers');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const VOICEOVER_DIR = getVoiceoverDir();
console.log(`🎙️ Voiceover directory: ${VOICEOVER_DIR}`);

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function hashPin(pin) {
  return bcrypt.hashSync(pin, 10);
}

export function verifyPin(pin, hash) {
  return bcrypt.compareSync(pin, hash);
}

export function isPinTaken(pin) {
  const rows = db.prepare('SELECT pin_hash FROM dancers').all();
  return rows.some(r => verifyPin(pin, r.pin_hash));
}

export function createDancer(name, color, pin) {
  if (isPinTaken(pin)) {
    throw new Error('PIN_TAKEN');
  }
  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const pinHash = hashPin(pin);
  db.prepare(
    'INSERT INTO dancers (id, name, color, pin_hash) VALUES (?, ?, ?, ?)'
  ).run(id, name, color || '#e040fb', pinHash);
  return getDancer(id);
}

export function getDancer(id) {
  const row = db.prepare('SELECT * FROM dancers WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, playlist: JSON.parse(row.playlist), is_active: !!row.is_active };
}

export function getDancerByPin(pin) {
  const rows = db.prepare('SELECT * FROM dancers').all();
  for (const row of rows) {
    if (verifyPin(pin, row.pin_hash)) {
      return { ...row, playlist: JSON.parse(row.playlist), is_active: !!row.is_active };
    }
  }
  return null;
}

export function listDancers() {
  const rows = db.prepare('SELECT * FROM dancers ORDER BY created_date ASC').all();
  return rows.map(r => ({ ...r, playlist: JSON.parse(r.playlist), is_active: !!r.is_active }));
}

export function updateDancer(id, data) {
  const dancer = getDancer(id);
  if (!dancer) return null;
  
  if (data.name !== undefined) {
    db.prepare('UPDATE dancers SET name = ? WHERE id = ?').run(data.name, id);
  }
  if (data.color !== undefined) {
    db.prepare('UPDATE dancers SET color = ? WHERE id = ?').run(data.color, id);
  }
  if (data.playlist !== undefined) {
    db.prepare('UPDATE dancers SET playlist = ? WHERE id = ?').run(JSON.stringify(data.playlist), id);
  }
  if (data.is_active !== undefined) {
    db.prepare('UPDATE dancers SET is_active = ? WHERE id = ?').run(data.is_active ? 1 : 0, id);
  }
  if (data.pin !== undefined) {
    db.prepare('UPDATE dancers SET pin_hash = ? WHERE id = ?').run(hashPin(data.pin), id);
  }
  return getDancer(id);
}

export function deleteDancer(id) {
  db.prepare('DELETE FROM sessions WHERE dancer_id = ?').run(id);
  db.prepare('DELETE FROM dancers WHERE id = ?').run(id);
}

export function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 48; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

export function createSession(role, dancerId = null) {
  const token = generateToken();
  db.prepare(
    'INSERT INTO sessions (token, role, dancer_id, last_seen) VALUES (?, ?, ?, ?)'
  ).run(token, role, dancerId, Date.now());
  return token;
}

export function getSession(token) {
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  return row;
}

export function touchSession(token) {
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(Date.now(), token);
}

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function cleanExpiredSessions(maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  db.prepare('DELETE FROM sessions WHERE role = ? AND last_seen < ?').run('dancer', cutoff);
}

export function syncSongs(songNames) {
  const insertStmt = db.prepare('INSERT OR IGNORE INTO songs (name) VALUES (?)');
  const deleteStmt = db.prepare('DELETE FROM songs WHERE name NOT IN (' + songNames.map(() => '?').join(',') + ')');
  
  db.transaction(() => {
    if (songNames.length > 0) {
      deleteStmt.run(...songNames);
      for (const name of songNames) {
        insertStmt.run(name);
      }
    } else {
      db.prepare('DELETE FROM songs').run();
    }
  })();
}

export function listSongs() {
  return db.prepare('SELECT name FROM songs ORDER BY name ASC').all().map(r => r.name);
}

export function saveVoiceover(cacheKey, audioBuffer, script, type, dancerName, energyLevel) {
  const fileName = cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp3';
  const filePath = join(VOICEOVER_DIR, fileName);
  writeFileSync(filePath, Buffer.from(audioBuffer));
  db.prepare(
    `INSERT OR REPLACE INTO voiceovers (cache_key, file_name, script, type, dancer_name, energy_level)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(cacheKey, fileName, script || null, type, dancerName || null, energyLevel || 3);
  return { cacheKey, fileName };
}

export function getVoiceover(cacheKey) {
  const row = db.prepare('SELECT * FROM voiceovers WHERE cache_key = ?').get(cacheKey);
  if (!row) return null;
  const filePath = join(VOICEOVER_DIR, row.file_name);
  if (!existsSync(filePath)) {
    db.prepare('DELETE FROM voiceovers WHERE cache_key = ?').run(cacheKey);
    return null;
  }
  return { ...row, filePath };
}

export function listVoiceovers() {
  return db.prepare('SELECT cache_key, type, dancer_name, energy_level, created_at FROM voiceovers ORDER BY created_at DESC').all();
}

export function deleteVoiceover(cacheKey) {
  const row = db.prepare('SELECT file_name FROM voiceovers WHERE cache_key = ?').get(cacheKey);
  if (row) {
    const filePath = join(VOICEOVER_DIR, row.file_name);
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch (e) {}
    db.prepare('DELETE FROM voiceovers WHERE cache_key = ?').run(cacheKey);
  }
}

export function upsertMusicTrack(name, path, genre, size, modifiedAt) {
  db.prepare(
    'INSERT INTO music_tracks (name, path, genre, size, modified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET name=excluded.name, genre=excluded.genre, size=excluded.size, modified_at=excluded.modified_at'
  ).run(name, path, genre, size, modifiedAt);
}

export function removeDeletedTracks(existingPaths) {
  if (!existingPaths || existingPaths.length === 0) {
    db.prepare('DELETE FROM music_tracks').run();
    return;
  }
  const allTracks = db.prepare('SELECT path FROM music_tracks').all();
  const pathSet = new Set(existingPaths);
  const deletePaths = allTracks.filter(t => !pathSet.has(t.path)).map(t => t.path);
  if (deletePaths.length > 0) {
    const del = db.prepare('DELETE FROM music_tracks WHERE path = ?');
    const txn = db.transaction((paths) => { for (const p of paths) del.run(p); });
    txn(deletePaths);
  }
  return deletePaths.length;
}

export function bulkUpsertTracks(tracksArray) {
  const stmt = db.prepare(
    'INSERT INTO music_tracks (name, path, genre, size, modified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET name=excluded.name, genre=excluded.genre, size=excluded.size, modified_at=excluded.modified_at'
  );
  const txn = db.transaction((tracks) => {
    for (const t of tracks) stmt.run(t.name, t.path, t.genre, t.size, t.modifiedAt);
  });
  txn(tracksArray);
}

export function getMusicTracks({ page = 1, limit = 100, search = '', genre = '' } = {}) {
  let where = [];
  let params = [];
  if (search) {
    where.push('(name LIKE ? OR path LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (genre) {
    where.push('genre = ?');
    params.push(genre);
  }
  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(DISTINCT name) as count FROM music_tracks ${whereClause}`).get(...params).count;
  const offset = (page - 1) * limit;
  const tracks = db.prepare(`SELECT MIN(id) as id, name, MIN(path) as path, MIN(genre) as genre FROM music_tracks ${whereClause} GROUP BY name ORDER BY name ASC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { tracks, total, page, totalPages: Math.ceil(total / limit) };
}

export function getMusicGenres() {
  return db.prepare('SELECT genre as name, COUNT(DISTINCT name) as count FROM music_tracks WHERE genre IS NOT NULL AND genre != \'\' GROUP BY genre ORDER BY genre ASC').all();
}

export function getMusicTrackById(id) {
  return db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(id);
}

export function getMusicTrackByName(name) {
  return db.prepare('SELECT * FROM music_tracks WHERE name = ?').get(name);
}

export function getRandomTracks(count = 3, excludeIds = [], genres = []) {
  const conditions = [];
  const params = [];
  if (excludeIds.length > 0) {
    conditions.push(`id NOT IN (${excludeIds.map(() => '?').join(',')})`);
    params.push(...excludeIds);
  }
  if (genres.length > 0) {
    conditions.push(`genre IN (${genres.map(() => '?').join(',')})`);
    params.push(...genres);
  }
  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
  params.push(count);
  return db.prepare(`SELECT id, name, path, genre FROM music_tracks${where} ORDER BY RANDOM() LIMIT ?`).all(...params);
}

export function getMusicTrackCount() {
  return db.prepare('SELECT COUNT(*) as count FROM music_tracks').get().count;
}

export function getLastScanTime() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('last_music_scan');
  return row ? row.value : null;
}

export function logPlayHistory(trackName, dancerName = null, genre = null) {
  db.prepare(
    'INSERT INTO play_history (track_name, dancer_name, genre) VALUES (?, ?, ?)'
  ).run(trackName, dancerName || null, genre || null);
}

export function getPlayHistory(date = null, limit = 200, offset = 0) {
  if (date) {
    return db.prepare(
      `SELECT id, track_name, dancer_name, played_at, genre FROM play_history
       WHERE date(played_at) = date(?)
       ORDER BY played_at DESC LIMIT ? OFFSET ?`
    ).all(date, limit, offset);
  }
  return db.prepare(
    `SELECT id, track_name, dancer_name, played_at, genre FROM play_history
     ORDER BY played_at DESC LIMIT ? OFFSET ?`
  ).all(limit, offset);
}

export function getPlayHistoryDates() {
  return db.prepare(
    `SELECT date(played_at) as date, COUNT(*) as count
     FROM play_history GROUP BY date(played_at)
     ORDER BY date DESC LIMIT 90`
  ).all();
}

export function getPlayHistoryStats(date = null) {
  const dateFilter = date ? `date(played_at) = date(?)` : null;
  const params = date ? [date] : [];
  const where = dateFilter ? `WHERE ${dateFilter}` : '';
  const dancerWhere = dateFilter
    ? `WHERE ${dateFilter} AND dancer_name IS NOT NULL`
    : `WHERE dancer_name IS NOT NULL`;
  const genreWhere = dateFilter
    ? `WHERE ${dateFilter} AND genre IS NOT NULL`
    : `WHERE genre IS NOT NULL`;
  const total = db.prepare(`SELECT COUNT(*) as count FROM play_history ${where}`).get(...params);
  const topTracks = db.prepare(
    `SELECT track_name, COUNT(*) as plays FROM play_history ${where}
     GROUP BY track_name ORDER BY plays DESC LIMIT 20`
  ).all(...params);
  const topDancers = db.prepare(
    `SELECT dancer_name, COUNT(*) as plays FROM play_history ${dancerWhere}
     GROUP BY dancer_name ORDER BY plays DESC LIMIT 20`
  ).all(...params);
  const topGenres = db.prepare(
    `SELECT genre, COUNT(*) as plays FROM play_history ${genreWhere}
     GROUP BY genre ORDER BY plays DESC LIMIT 20`
  ).all(...params);
  return { total: total.count, topTracks, topDancers, topGenres };
}

export function cleanOldPlayHistory(daysToKeep = 90) {
  const result = db.prepare(
    `DELETE FROM play_history WHERE played_at < datetime('now', 'localtime', ?)`
  ).run(`-${daysToKeep} days`);
  return result.changes;
}

export function getVoiceoverFilePath(cacheKey) {
  const row = db.prepare('SELECT file_name FROM voiceovers WHERE cache_key = ?').get(cacheKey);
  if (!row) return null;
  const filePath = join(VOICEOVER_DIR, row.file_name);
  if (!existsSync(filePath)) return null;
  return filePath;
}

export default db;
