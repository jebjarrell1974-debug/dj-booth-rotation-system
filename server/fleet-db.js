import db from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS fleet_devices (
    device_id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    club_name TEXT DEFAULT '',
    app_version TEXT DEFAULT '1.0.0',
    last_heartbeat INTEGER DEFAULT 0,
    status TEXT DEFAULT 'offline',
    api_key TEXT NOT NULL,
    sync_hour INTEGER DEFAULT 9,
    sync_minute INTEGER DEFAULT 30,
    timezone TEXT DEFAULT 'America/Chicago',
    registered_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS fleet_heartbeats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    app_version TEXT,
    cpu_percent REAL DEFAULT 0,
    memory_percent REAL DEFAULT 0,
    disk_percent REAL DEFAULT 0,
    uptime_seconds INTEGER DEFAULT 0,
    active_dancers INTEGER DEFAULT 0,
    is_playing INTEGER DEFAULT 0,
    FOREIGN KEY (device_id) REFERENCES fleet_devices(device_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS fleet_error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    level TEXT DEFAULT 'error',
    message TEXT NOT NULL,
    stack TEXT DEFAULT '',
    component TEXT DEFAULT '',
    FOREIGN KEY (device_id) REFERENCES fleet_devices(device_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS fleet_voiceovers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dancer_name TEXT NOT NULL,
    voiceover_type TEXT NOT NULL,
    file_data BLOB NOT NULL,
    file_size INTEGER DEFAULT 0,
    file_hash TEXT NOT NULL,
    mime_type TEXT DEFAULT 'audio/mpeg',
    uploaded_by_device TEXT,
    uploaded_at INTEGER NOT NULL,
    UNIQUE(dancer_name, voiceover_type)
  );

  CREATE TABLE IF NOT EXISTS fleet_music (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    file_hash TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    genre TEXT DEFAULT '',
    target_devices TEXT DEFAULT '[]',
    uploaded_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fleet_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL UNIQUE,
    release_notes TEXT DEFAULT '',
    package_data BLOB,
    package_size INTEGER DEFAULT 0,
    target_devices TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS fleet_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    sync_type TEXT NOT NULL,
    direction TEXT NOT NULL,
    status TEXT DEFAULT 'success',
    details TEXT DEFAULT '',
    items_count INTEGER DEFAULT 0,
    bytes_transferred INTEGER DEFAULT 0,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (device_id) REFERENCES fleet_devices(device_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_heartbeats_device ON fleet_heartbeats(device_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_error_logs_device ON fleet_error_logs(device_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_sync_log_device ON fleet_sync_log(device_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_voiceovers_name ON fleet_voiceovers(dancer_name);
`);

function generateApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'fleet_';
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

export function registerDevice(deviceName, clubName = '') {
  const deviceId = `pi_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const apiKey = generateApiKey();
  db.prepare(`
    INSERT INTO fleet_devices (device_id, device_name, club_name, api_key)
    VALUES (?, ?, ?, ?)
  `).run(deviceId, deviceName, clubName, apiKey);
  return { deviceId, apiKey, deviceName, clubName };
}

export function authenticateDevice(apiKey) {
  return db.prepare('SELECT * FROM fleet_devices WHERE api_key = ?').get(apiKey);
}

export function listDevices() {
  return db.prepare('SELECT * FROM fleet_devices ORDER BY registered_at ASC').all();
}

export function getDevice(deviceId) {
  return db.prepare('SELECT * FROM fleet_devices WHERE device_id = ?').get(deviceId);
}

export function updateDevice(deviceId, data) {
  if (data.device_name !== undefined) {
    db.prepare('UPDATE fleet_devices SET device_name = ? WHERE device_id = ?').run(data.device_name, deviceId);
  }
  if (data.club_name !== undefined) {
    db.prepare('UPDATE fleet_devices SET club_name = ? WHERE device_id = ?').run(data.club_name, deviceId);
  }
  if (data.sync_hour !== undefined && data.sync_minute !== undefined) {
    db.prepare('UPDATE fleet_devices SET sync_hour = ?, sync_minute = ? WHERE device_id = ?')
      .run(data.sync_hour, data.sync_minute, deviceId);
  }
  return getDevice(deviceId);
}

export function deleteDevice(deviceId) {
  db.prepare('DELETE FROM fleet_devices WHERE device_id = ?').run(deviceId);
}

export function recordHeartbeat(deviceId, data) {
  const now = Date.now();
  db.prepare('UPDATE fleet_devices SET last_heartbeat = ?, status = ?, app_version = ? WHERE device_id = ?')
    .run(now, 'online', data.app_version || '1.0.0', deviceId);

  db.prepare(`
    INSERT INTO fleet_heartbeats (device_id, timestamp, app_version, cpu_percent, memory_percent, disk_percent, uptime_seconds, active_dancers, is_playing)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    deviceId, now,
    data.app_version || '1.0.0',
    data.cpu_percent || 0,
    data.memory_percent || 0,
    data.disk_percent || 0,
    data.uptime_seconds || 0,
    data.active_dancers || 0,
    data.is_playing ? 1 : 0
  );

  const cutoff = now - (7 * 24 * 60 * 60 * 1000);
  db.prepare('DELETE FROM fleet_heartbeats WHERE timestamp < ?').run(cutoff);
}

export function getRecentHeartbeats(deviceId, limit = 100) {
  return db.prepare('SELECT * FROM fleet_heartbeats WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(deviceId, limit);
}

export function recordErrorLog(deviceId, logs) {
  const stmt = db.prepare(`
    INSERT INTO fleet_error_logs (device_id, timestamp, level, message, stack, component)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((entries) => {
    for (const entry of entries) {
      stmt.run(
        deviceId,
        entry.timestamp || Date.now(),
        entry.level || 'error',
        entry.message || '',
        entry.stack || '',
        entry.component || ''
      );
    }
  });
  insertMany(Array.isArray(logs) ? logs : [logs]);

  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  db.prepare('DELETE FROM fleet_error_logs WHERE timestamp < ?').run(cutoff);
}

export function getErrorLogs(deviceId, limit = 200) {
  if (deviceId) {
    return db.prepare('SELECT * FROM fleet_error_logs WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(deviceId, limit);
  }
  return db.prepare('SELECT * FROM fleet_error_logs ORDER BY timestamp DESC LIMIT ?').all(limit);
}

export function uploadVoiceover(dancerName, voiceoverType, fileData, fileHash, mimeType, uploadedByDevice) {
  const existing = db.prepare('SELECT id FROM fleet_voiceovers WHERE dancer_name = ? AND voiceover_type = ?')
    .get(dancerName, voiceoverType);

  if (existing) {
    db.prepare(`
      UPDATE fleet_voiceovers SET file_data = ?, file_size = ?, file_hash = ?, mime_type = ?, uploaded_by_device = ?, uploaded_at = ?
      WHERE dancer_name = ? AND voiceover_type = ?
    `).run(fileData, fileData.length, fileHash, mimeType || 'audio/mpeg', uploadedByDevice, Date.now(), dancerName, voiceoverType);
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO fleet_voiceovers (dancer_name, voiceover_type, file_data, file_size, file_hash, mime_type, uploaded_by_device, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(dancerName, voiceoverType, fileData, fileData.length, fileHash, mimeType || 'audio/mpeg', uploadedByDevice, Date.now());
  return result.lastInsertRowid;
}

export function listVoiceovers() {
  return db.prepare(`
    SELECT id, dancer_name, voiceover_type, file_size, file_hash, mime_type, uploaded_by_device, uploaded_at
    FROM fleet_voiceovers ORDER BY dancer_name ASC, voiceover_type ASC
  `).all();
}

export function getVoiceoverManifest() {
  return db.prepare(`
    SELECT dancer_name, voiceover_type, file_hash, file_size FROM fleet_voiceovers
    ORDER BY dancer_name ASC
  `).all();
}

export function getVoiceoverFile(id) {
  return db.prepare('SELECT * FROM fleet_voiceovers WHERE id = ?').get(id);
}

export function getVoiceoverByNameType(dancerName, voiceoverType) {
  return db.prepare('SELECT * FROM fleet_voiceovers WHERE dancer_name = ? AND voiceover_type = ?')
    .get(dancerName, voiceoverType);
}

export function listFleetMusic() {
  return db.prepare(`
    SELECT id, filename, file_hash, file_size, genre, target_devices, uploaded_at
    FROM fleet_music ORDER BY filename ASC
  `).all();
}

export function getMusicManifest(deviceId) {
  const allMusic = db.prepare('SELECT id, filename, file_hash, file_size, genre, target_devices FROM fleet_music').all();
  return allMusic.filter(m => {
    const targets = JSON.parse(m.target_devices || '[]');
    return targets.length === 0 || targets.includes(deviceId) || targets.includes('all');
  });
}

export function createUpdate(version, releaseNotes, packageData, targetDevices = []) {
  const result = db.prepare(`
    INSERT INTO fleet_updates (version, release_notes, package_data, package_size, target_devices, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(version, releaseNotes, packageData, packageData ? packageData.length : 0, JSON.stringify(targetDevices), Date.now());
  return result.lastInsertRowid;
}

export function getLatestUpdate(deviceId) {
  const updates = db.prepare('SELECT id, version, release_notes, package_size, target_devices, created_at FROM fleet_updates WHERE is_active = 1 ORDER BY created_at DESC').all();
  for (const update of updates) {
    const targets = JSON.parse(update.target_devices || '[]');
    if (targets.length === 0 || targets.includes(deviceId) || targets.includes('all')) {
      return update;
    }
  }
  return null;
}

export function getUpdatePackage(updateId) {
  return db.prepare('SELECT * FROM fleet_updates WHERE id = ?').get(updateId);
}

export function recordSync(deviceId, syncType, direction, status, details = '', itemsCount = 0, bytesTransferred = 0) {
  db.prepare(`
    INSERT INTO fleet_sync_log (device_id, sync_type, direction, status, details, items_count, bytes_transferred, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(deviceId, syncType, direction, status, details, itemsCount, bytesTransferred, Date.now());
}

export function getSyncHistory(deviceId, limit = 50) {
  if (deviceId) {
    return db.prepare('SELECT * FROM fleet_sync_log WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(deviceId, limit);
  }
  return db.prepare('SELECT * FROM fleet_sync_log ORDER BY timestamp DESC LIMIT ?').all(limit);
}

export function updateDeviceStatuses() {
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  db.prepare("UPDATE fleet_devices SET status = 'offline' WHERE last_heartbeat < ? AND last_heartbeat > 0")
    .run(fiveMinutesAgo);
}

export function listUpdates(limit = 50) {
  return db.prepare('SELECT id, version, release_notes, package_size, target_devices, created_at, is_active FROM fleet_updates ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function deleteUpdate(id) {
  db.prepare('DELETE FROM fleet_updates WHERE id = ?').run(id);
}

export function clearErrorLogs(deviceId = null) {
  if (deviceId) {
    db.prepare('DELETE FROM fleet_error_logs WHERE device_id = ?').run(deviceId);
  } else {
    db.prepare('DELETE FROM fleet_error_logs').run();
  }
}
