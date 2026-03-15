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

const readDb = new Database(DB_PATH, { readonly: true });
readDb.pragma('journal_mode = WAL');

export function walCheckpoint() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.error('WAL checkpoint failed:', err.message);
  }
}

export function closeDatabase() {
  try {
    readDb.close();
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
    phonetic_name TEXT DEFAULT '',
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
    modified_at TEXT,
    blocked INTEGER DEFAULT 0,
    blocked_at TEXT
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
  CREATE INDEX IF NOT EXISTS idx_play_history_track_name ON play_history(track_name);

  CREATE TABLE IF NOT EXISTS playback_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_name TEXT,
    dancer_name TEXT,
    reason TEXT,
    occurred_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

try {
  db.prepare("SELECT blocked FROM music_tracks LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE music_tracks ADD COLUMN blocked INTEGER DEFAULT 0");
  db.exec("ALTER TABLE music_tracks ADD COLUMN blocked_at TEXT");
}

try {
  db.prepare("SELECT lufs FROM music_tracks LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE music_tracks ADD COLUMN lufs REAL");
  db.exec("ALTER TABLE music_tracks ADD COLUMN auto_gain REAL");
  db.exec("ALTER TABLE music_tracks ADD COLUMN lufs_analyzed INTEGER DEFAULT 0");
}

try {
  db.prepare("SELECT bpm FROM music_tracks LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE music_tracks ADD COLUMN bpm REAL");
  db.exec("ALTER TABLE music_tracks ADD COLUMN bpm_analyzed INTEGER DEFAULT 0");
}

try {
  db.prepare("SELECT club_name FROM voiceovers LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE voiceovers ADD COLUMN club_name TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_voiceovers_club_name ON voiceovers(club_name)");
}

try {
  db.prepare("SELECT phonetic_name FROM dancers LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE dancers ADD COLUMN phonetic_name TEXT DEFAULT ''");
}

try {
  db.prepare("SELECT day_of_week FROM voiceovers LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE voiceovers ADD COLUMN day_of_week INTEGER");
}

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

export function getVoiceoverDirPath() {
  return VOICEOVER_DIR;
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function exportDancers() {
  const dancers = db.prepare('SELECT * FROM dancers ORDER BY created_date ASC').all();
  return dancers.map(d => ({
    id: d.id,
    name: d.name,
    color: d.color,
    playlist: JSON.parse(d.playlist || '[]'),
    is_active: !!d.is_active,
    phonetic_name: d.phonetic_name || '',
    created_date: d.created_date,
    pin_hash: d.pin_hash,
  }));
}

export function importDancers(dancersArray, { overwrite = false } = {}) {
  if (!Array.isArray(dancersArray) || dancersArray.length === 0) return { imported: 0, skipped: 0 };
  const existing = db.prepare('SELECT id, name FROM dancers').all();
  const existingIds = new Set(existing.map(d => d.id));
  const existingNames = new Set(existing.map(d => d.name.toLowerCase()));

  let imported = 0;
  let skipped = 0;

  const upsert = db.transaction((dancers) => {
    for (const d of dancers) {
      if (!d.name) continue;
      if (overwrite && existingIds.has(d.id)) {
        db.prepare(`UPDATE dancers SET name=?, color=?, pin_hash=?, playlist=?, is_active=?, phonetic_name=? WHERE id=?`)
          .run(d.name, d.color || '#e040fb', d.pin_hash, JSON.stringify(d.playlist || []), d.is_active ? 1 : 0, d.phonetic_name || '', d.id);
        imported++;
      } else if (!existingIds.has(d.id) && !existingNames.has(d.name.toLowerCase())) {
        db.prepare(`INSERT OR IGNORE INTO dancers (id, name, color, pin_hash, playlist, is_active, phonetic_name, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(d.id, d.name, d.color || '#e040fb', d.pin_hash, JSON.stringify(d.playlist || []), d.is_active ? 1 : 0, d.phonetic_name || '', d.created_date || new Date().toISOString());
        imported++;
      } else {
        skipped++;
      }
    }
  });
  upsert(dancersArray);
  return { imported, skipped };
}

export function saveClientSettings(settings) {
  if (!settings || typeof settings !== 'object') return;
  const allowed = [
    'djbooth_openai_key', 'djbooth_elevenlabs_key', 'djbooth_elevenlabs_voice_id',
    'djbooth_announcements_enabled', 'djbooth_club_name', 'djbooth_club_open_hour',
    'djbooth_club_close_hour', 'djbooth_energy_override', 'djbooth_script_model',
    'djbooth_club_specials', 'neonaidj_songs_per_set', 'neonaidj_commercial_freq',
    'djbooth_adult_mode', 'neonaidj_music_mode', 'neonaidj_active_genres',
  ];
  for (const key of allowed) {
    if (settings[key] !== undefined && settings[key] !== null) {
      setSetting(`client_${key}`, String(settings[key]));
    }
  }
}

export function getClientSettings() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'client_%'").all();
  const result = {};
  for (const row of rows) {
    const k = row.key.replace(/^client_/, '');
    result[k] = row.value;
  }
  return result;
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
  try {
    db.exec('ALTER TABLE dancers ADD COLUMN pin_plain TEXT DEFAULT NULL');
  } catch {}
  db.prepare(
    'INSERT INTO dancers (id, name, color, pin_hash, pin_plain) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, color || '#e040fb', pinHash, pin);
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
    try {
      db.exec('ALTER TABLE dancers ADD COLUMN pin_plain TEXT DEFAULT NULL');
    } catch {}
    db.prepare('UPDATE dancers SET pin_plain = ? WHERE id = ?').run(data.pin, id);
  }
  if (data.phonetic_name !== undefined) {
    db.prepare('UPDATE dancers SET phonetic_name = ? WHERE id = ?').run(data.phonetic_name, id);
  }
  return getDancer(id);
}

export function invalidateDancerSessions(dancerId) {
  db.prepare('DELETE FROM sessions WHERE dancer_id = ?').run(dancerId);
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

export function saveVoiceover(cacheKey, audioBuffer, script, type, dancerName, energyLevel, clubName, dayOfWeek) {
  const fileName = cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp3';
  const filePath = join(VOICEOVER_DIR, fileName);
  writeFileSync(filePath, Buffer.from(audioBuffer));
  db.prepare(
    `INSERT OR REPLACE INTO voiceovers (cache_key, file_name, script, type, dancer_name, energy_level, club_name, day_of_week)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(cacheKey, fileName, script || null, type, dancerName || null, energyLevel || 3, clubName || null, dayOfWeek ?? null);
  return { cacheKey, fileName, clubName: clubName || null, dayOfWeek: dayOfWeek ?? null };
}

const VOICEOVER_VALID_AFTER = '2026-03-04';

export function getVoiceover(cacheKey) {
  const row = db.prepare('SELECT * FROM voiceovers WHERE cache_key = ?').get(cacheKey);
  if (!row) return null;
  if (row.created_at && row.created_at < VOICEOVER_VALID_AFTER) {
    db.prepare('DELETE FROM voiceovers WHERE cache_key = ?').run(cacheKey);
    return null;
  }
  const filePath = join(VOICEOVER_DIR, row.file_name);
  if (!existsSync(filePath)) {
    db.prepare('DELETE FROM voiceovers WHERE cache_key = ?').run(cacheKey);
    return null;
  }
  return { ...row, filePath };
}

export function listVoiceovers() {
  return db.prepare('SELECT cache_key, type, dancer_name, energy_level, created_at FROM voiceovers WHERE created_at >= ? ORDER BY created_at DESC').all(VOICEOVER_VALID_AFTER);
}

export function deleteVoiceover(cacheKey) {
  const row = db.prepare('SELECT file_name FROM voiceovers WHERE cache_key = ?').get(cacheKey);
  if (row) {
    const filePath = join(VOICEOVER_DIR, row.file_name);
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch (e) {}
    db.prepare('DELETE FROM voiceovers WHERE cache_key = ?').run(cacheKey);
  }
}

export function deleteVoiceoversByDancer(dancerName) {
  const rows = db.prepare('SELECT file_name FROM voiceovers WHERE dancer_name = ?').all(dancerName);
  let deleted = 0;
  for (const row of rows) {
    const filePath = join(VOICEOVER_DIR, row.file_name);
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch (e) {}
    deleted++;
  }
  db.prepare('DELETE FROM voiceovers WHERE dancer_name = ?').run(dancerName);
  return deleted;
}

export function clearAllVoiceovers() {
  const rows = db.prepare('SELECT file_name FROM voiceovers').all();
  let deleted = 0;
  for (const row of rows) {
    const filePath = join(VOICEOVER_DIR, row.file_name);
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch (e) {}
    deleted++;
  }
  db.prepare('DELETE FROM voiceovers').run();
  return deleted;
}

export function cleanupOrphanedVoiceovers() {
  const rows = db.prepare('SELECT cache_key, file_name FROM voiceovers').all();
  let removed = 0;
  for (const row of rows) {
    const filePath = join(VOICEOVER_DIR, row.file_name);
    if (!existsSync(filePath)) {
      db.prepare('DELETE FROM voiceovers WHERE cache_key = ?').run(row.cache_key);
      removed++;
    }
  }
  return removed;
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

export function blockTrack(trackName) {
  db.prepare("UPDATE music_tracks SET blocked = 1, blocked_at = datetime('now', 'localtime') WHERE name = ?").run(trackName);
}

export function unblockTrack(trackName) {
  db.prepare("UPDATE music_tracks SET blocked = 0, blocked_at = NULL WHERE name = ?").run(trackName);
}

export function getBlockedTracks() {
  return readDb.prepare("SELECT MIN(id) as id, name, MIN(genre) as genre, MIN(blocked_at) as blocked_at FROM music_tracks WHERE blocked = 1 GROUP BY name ORDER BY blocked_at DESC").all();
}

export function getMusicTracks({ page = 1, limit = 100, search = '', genre = '', excludeDirty = false } = {}) {
  let where = ['blocked = 0'];
  let params = [];
  if (excludeDirty) {
    where.push("name NOT LIKE '%dirty%' COLLATE NOCASE");
  }
  if (search) {
    where.push('(name LIKE ? OR path LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (genre) {
    where.push('genre = ? COLLATE NOCASE');
    params.push(genre);
  }
  const whereClause = 'WHERE ' + where.join(' AND ');
  const total = readDb.prepare(`SELECT COUNT(DISTINCT name) as count FROM music_tracks ${whereClause}`).get(...params).count;
  const offset = (page - 1) * limit;
  const tracks = readDb.prepare(`SELECT MIN(id) as id, name, MIN(path) as path, MIN(genre) as genre FROM music_tracks ${whereClause} GROUP BY name ORDER BY name ASC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { tracks, total, page, totalPages: Math.ceil(total / limit) };
}

export function getMusicGenres() {
  return readDb.prepare("SELECT genre as name, COUNT(DISTINCT name) as count FROM music_tracks WHERE genre IS NOT NULL AND genre != '' AND blocked = 0 GROUP BY genre ORDER BY genre ASC").all();
}

export function getMusicTrackById(id) {
  return readDb.prepare('SELECT * FROM music_tracks WHERE id = ?').get(id);
}

export function getMusicTrackByName(name) {
  return readDb.prepare('SELECT * FROM music_tracks WHERE name = ?').get(name);
}

export function deleteMusicTrackFromDB(trackName) {
  db.prepare('DELETE FROM music_tracks WHERE name = ?').run(trackName);
  const dancers = db.prepare('SELECT id, playlist FROM dancers').all();
  for (const dancer of dancers) {
    let playlist = [];
    try { playlist = JSON.parse(dancer.playlist || '[]'); } catch {}
    if (playlist.includes(trackName)) {
      const updated = playlist.filter(n => n !== trackName);
      db.prepare('UPDATE dancers SET playlist = ? WHERE id = ?').run(JSON.stringify(updated), dancer.id);
    }
  }
}

export function getRecentCooldowns(hours = 4) {
  return readDb.prepare(
    `SELECT track_name, MAX(played_at) AS last_played
     FROM play_history
     WHERE played_at > datetime('now', 'localtime', '-' || ? || ' hours')
     GROUP BY track_name`
  ).all(hours);
}

export function getRandomTracks(count = 3, excludeNames = [], genres = []) {
  const recentlyPlayed = readDb.prepare(
    `SELECT track_name FROM play_history
     WHERE played_at > datetime('now', 'localtime', '-4 hours')
     GROUP BY track_name`
  ).all().map(r => r.track_name);

  const allExcluded = [...new Set([...excludeNames, ...recentlyPlayed])];

  const conditions = ['t.blocked = 0'];
  const params = [];

  if (allExcluded.length > 0) {
    conditions.push(`t.name NOT IN (${allExcluded.map(() => '?').join(',')})`);
    params.push(...allExcluded);
  }
  if (genres.length > 0) {
    conditions.push(`t.genre IN (${genres.map(() => '?').join(',')})`);
    params.push(...genres);
  }

  const where = conditions.join(' AND ');
  params.push(count * 4);
  let pool = readDb.prepare(
    `SELECT t.id, t.name, t.path, t.genre, t.auto_gain
     FROM music_tracks t
     WHERE ${where}
     ORDER BY RANDOM()
     LIMIT ?`
  ).all(...params);

  if (pool.length < count) {
    const fallbackConditions = ['t.blocked = 0'];
    const fallbackParams = [];
    const fallbackExcluded = [...new Set([...allExcluded, ...pool.map(t => t.name)])];
    if (fallbackExcluded.length > 0) {
      fallbackConditions.push(`t.name NOT IN (${fallbackExcluded.map(() => '?').join(',')})`);
      fallbackParams.push(...fallbackExcluded);
    }
    if (genres.length > 0) {
      fallbackConditions.push(`t.genre IN (${genres.map(() => '?').join(',')})`);
      fallbackParams.push(...genres);
    }
    const fbWhere = fallbackConditions.join(' AND ');
    fallbackParams.push((count - pool.length) * 4);
    const fallback = readDb.prepare(
      `SELECT t.id, t.name, t.path, t.genre, t.auto_gain,
              h.last_played AS last_played
       FROM music_tracks t
       LEFT JOIN (
         SELECT track_name, MAX(played_at) AS last_played
         FROM play_history
         GROUP BY track_name
       ) h ON t.name = h.track_name
       WHERE ${fbWhere}
       ORDER BY h.last_played ASC NULLS FIRST
       LIMIT ?`
    ).all(...fallbackParams);
    pool = [...pool, ...fallback.map(({ last_played, ...t }) => t)];
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, count);
}

export function selectTracksForSet({ count = 2, excludeNames = [], genres = [], dancerPlaylist = [] } = {}) {
  // When a dancer has a playlist, pick ONLY from that playlist — never random library songs
  if (dancerPlaylist.length > 0) {
    const excludeSet = new Set(excludeNames);

    // Get all songs played in the last 4 hours (server is source of truth for cooldowns)
    const recentlyPlayed4h = new Set(
      readDb.prepare(
        `SELECT track_name FROM play_history
         WHERE played_at > datetime('now', 'localtime', '-4 hours')
         GROUP BY track_name`
      ).all().map(r => r.track_name)
    );

    // Fetch playlist tracks from DB, split into fresh vs on-cooldown
    const freshTracks = [];
    const cooldownTracks = [];
    for (const trackName of dancerPlaylist) {
      if (excludeSet.has(trackName)) continue;
      const track = readDb.prepare(
        `SELECT t.id, t.name, t.path, t.genre, t.auto_gain,
                COALESCE(h.last_played, '1970-01-01') as last_played
         FROM music_tracks t
         LEFT JOIN (SELECT track_name, MAX(played_at) AS last_played FROM play_history GROUP BY track_name) h
         ON t.name = h.track_name
         WHERE t.name = ? AND t.blocked = 0`
      ).get(trackName);
      if (!track) continue;
      if (recentlyPlayed4h.has(trackName)) {
        cooldownTracks.push(track);
      } else {
        freshTracks.push(track);
      }
    }

    // Shuffle fresh songs randomly, then append cooldown songs oldest-played first
    for (let i = freshTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [freshTracks[i], freshTracks[j]] = [freshTracks[j], freshTracks[i]];
    }
    cooldownTracks.sort((a, b) => a.last_played.localeCompare(b.last_played));

    return [...freshTracks, ...cooldownTracks]
      .slice(0, count)
      .map(({ last_played, ...t }) => t);
  }

  // No dancer playlist (break songs, autoplay queue) — random from full library with genre filter
  const usedNames = new Set(excludeNames);
  let filler = getRandomTracks(count, [...usedNames], genres);
  if (filler.length < count && genres.length > 0) {
    const stillExcluded = [...usedNames, ...filler.map(t => t.name)];
    const more = getRandomTracks(count - filler.length, stillExcluded, []);
    filler = [...filler, ...more];
  }
  return filler.slice(0, count);
}

export function getMusicTrackCount() {
  return readDb.prepare('SELECT COUNT(*) as count FROM music_tracks WHERE blocked = 0').get().count;
}

export function updateTrackLufs(path, lufs, autoGain) {
  db.prepare(
    'UPDATE music_tracks SET lufs = ?, auto_gain = ?, lufs_analyzed = 1 WHERE path = ?'
  ).run(lufs, autoGain, path);
}

export function getTracksNeedingAnalysis(limit = 50) {
  return readDb.prepare(
    'SELECT id, path FROM music_tracks WHERE lufs_analyzed = 0 AND blocked = 0 ORDER BY RANDOM() LIMIT ?'
  ).all(limit);
}

export function getLufsStats() {
  const total = readDb.prepare('SELECT COUNT(*) as count FROM music_tracks WHERE blocked = 0').get().count;
  const analyzed = readDb.prepare('SELECT COUNT(*) as count FROM music_tracks WHERE lufs_analyzed = 1 AND blocked = 0').get().count;
  const withGain = readDb.prepare('SELECT COUNT(*) as count FROM music_tracks WHERE auto_gain IS NOT NULL AND blocked = 0').get().count;
  return { total, analyzed, withGain, pending: total - analyzed };
}

export function getTrackAutoGains(filenames) {
  if (!filenames || filenames.length === 0) return {};
  const placeholders = filenames.map(() => '?').join(',');
  const rows = readDb.prepare(
    `SELECT name, auto_gain FROM music_tracks WHERE name IN (${placeholders}) AND auto_gain IS NOT NULL`
  ).all(filenames);
  const result = {};
  for (const row of rows) result[row.name] = row.auto_gain;
  return result;
}

export function updateTrackBpm(path, bpm) {
  db.prepare(
    'UPDATE music_tracks SET bpm = ?, bpm_analyzed = 1 WHERE path = ?'
  ).run(bpm, path);
}

export function getTracksNeedingBpmAnalysis(limit = 50) {
  return readDb.prepare(
    'SELECT id, path FROM music_tracks WHERE bpm_analyzed = 0 AND blocked = 0 ORDER BY RANDOM() LIMIT ?'
  ).all(limit);
}

export function getTrackBpms(filenames) {
  if (!filenames || filenames.length === 0) return {};
  const placeholders = filenames.map(() => '?').join(',');
  const rows = readDb.prepare(
    `SELECT name, bpm FROM music_tracks WHERE name IN (${placeholders}) AND bpm IS NOT NULL`
  ).all(filenames);
  const result = {};
  for (const row of rows) result[row.name] = row.bpm;
  return result;
}

export function getTracksNeedingAnyAnalysis() {
  return readDb.prepare(
    `SELECT name FROM music_tracks
     WHERE (lufs_analyzed = 0 OR bpm_analyzed = 0) AND blocked = 0`
  ).all().map(r => r.name);
}

export function getTrackAnalysisByFilenames(filenames) {
  if (!filenames || filenames.length === 0) return {};
  const placeholders = filenames.map(() => '?').join(',');
  const rows = readDb.prepare(
    `SELECT name, lufs, auto_gain, bpm
     FROM music_tracks
     WHERE name IN (${placeholders})
       AND lufs_analyzed = 1
       AND auto_gain IS NOT NULL
       AND blocked = 0`
  ).all(filenames);
  const result = {};
  for (const row of rows) {
    result[row.name] = { lufs: row.lufs, auto_gain: row.auto_gain, bpm: row.bpm };
  }
  return result;
}

export function bulkUpdateTrackAnalysis(analysisData) {
  const stmt = db.prepare(
    `UPDATE music_tracks
     SET lufs = ?, auto_gain = ?, lufs_analyzed = 1, bpm = ?, bpm_analyzed = 1
     WHERE name = ? AND (lufs_analyzed = 0 OR bpm_analyzed = 0)`
  );
  const bulkUpdate = db.transaction((entries) => {
    let count = 0;
    for (const [name, data] of entries) {
      const info = stmt.run(data.lufs ?? null, data.auto_gain ?? null, data.bpm ?? null, name);
      if (info.changes > 0) count++;
    }
    return count;
  });
  return bulkUpdate(Object.entries(analysisData));
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

db.exec(`
  CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL DEFAULT 'local',
    service TEXT NOT NULL,
    model TEXT DEFAULT '',
    endpoint TEXT DEFAULT '',
    characters INTEGER DEFAULT 0,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    estimated_cost REAL DEFAULT 0,
    context TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_api_usage_device ON api_usage(device_id);
  CREATE INDEX IF NOT EXISTS idx_api_usage_service ON api_usage(service);
  CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage(created_at);
`);

export function logApiUsage({ deviceId, service, model, endpoint, characters, promptTokens, completionTokens, estimatedCost, context }) {
  return db.prepare(`
    INSERT INTO api_usage (device_id, service, model, endpoint, characters, prompt_tokens, completion_tokens, estimated_cost, context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    deviceId || 'local',
    service || 'unknown',
    model || '',
    endpoint || '',
    characters || 0,
    promptTokens || 0,
    completionTokens || 0,
    estimatedCost || 0,
    context || ''
  );
}

export function getApiUsageSummary({ startDate, endDate, deviceId } = {}) {
  let where = '1=1';
  const params = [];
  if (startDate) { where += ' AND created_at >= ?'; params.push(startDate); }
  if (endDate) { where += ' AND created_at <= ?'; params.push(endDate); }
  if (deviceId) { where += ' AND device_id = ?'; params.push(deviceId); }

  const byDevice = db.prepare(`
    SELECT device_id, service,
      SUM(characters) as total_characters,
      SUM(prompt_tokens) as total_prompt_tokens,
      SUM(completion_tokens) as total_completion_tokens,
      SUM(estimated_cost) as total_cost,
      COUNT(*) as call_count
    FROM api_usage WHERE ${where}
    GROUP BY device_id, service
    ORDER BY device_id, service
  `).all(...params);

  const byDay = db.prepare(`
    SELECT date(created_at) as day, device_id, service,
      SUM(estimated_cost) as total_cost,
      COUNT(*) as call_count
    FROM api_usage WHERE ${where}
    GROUP BY day, device_id, service
    ORDER BY day DESC
    LIMIT 90
  `).all(...params);

  const totals = db.prepare(`
    SELECT
      SUM(estimated_cost) as total_cost,
      SUM(characters) as total_characters,
      SUM(prompt_tokens) as total_prompt_tokens,
      SUM(completion_tokens) as total_completion_tokens,
      COUNT(*) as total_calls
    FROM api_usage WHERE ${where}
  `).get(...params);

  return { byDevice, byDay, totals };
}

export function getApiUsageByDevice({ startDate, endDate } = {}) {
  let where = '1=1';
  const params = [];
  if (startDate) { where += ' AND created_at >= ?'; params.push(startDate); }
  if (endDate) { where += ' AND created_at <= ?'; params.push(endDate); }

  return db.prepare(`
    SELECT device_id,
      SUM(CASE WHEN service = 'elevenlabs' THEN estimated_cost ELSE 0 END) as elevenlabs_cost,
      SUM(CASE WHEN service = 'openai' THEN estimated_cost ELSE 0 END) as openai_cost,
      SUM(estimated_cost) as total_cost,
      SUM(CASE WHEN service = 'elevenlabs' THEN 1 ELSE 0 END) as elevenlabs_calls,
      SUM(CASE WHEN service = 'openai' THEN 1 ELSE 0 END) as openai_calls,
      SUM(characters) as total_characters,
      COUNT(*) as total_calls
    FROM api_usage WHERE ${where}
    GROUP BY device_id
    ORDER BY total_cost DESC
  `).all(...params);
}

export function cleanOldApiUsage(daysToKeep = 180) {
  const result = db.prepare(
    `DELETE FROM api_usage WHERE created_at < datetime('now', 'localtime', ?)`
  ).run(`-${daysToKeep} days`);
  return result.changes;
}

export function cleanOldPlayHistory(daysToKeep = 90) {
  const result = db.prepare(
    `DELETE FROM play_history WHERE played_at < datetime('now', 'localtime', ?)`
  ).run(`-${daysToKeep} days`);
  return result.changes;
}

export function getVoiceoverFilePath(cacheKey) {
  const row = db.prepare('SELECT file_name, created_at FROM voiceovers WHERE cache_key = ?').get(cacheKey);
  if (!row) return null;
  if (row.created_at && row.created_at < VOICEOVER_VALID_AFTER) return null;
  const filePath = join(VOICEOVER_DIR, row.file_name);
  if (!existsSync(filePath)) return null;
  return filePath;
}

export default db;
