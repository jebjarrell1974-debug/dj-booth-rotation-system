import db from './db.js';
import { randomUUID } from 'crypto';

db.exec(`
  CREATE TABLE IF NOT EXISTS zonepro_units (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    model TEXT NOT NULL DEFAULT 'dbx-zonepro-640m',
    firmware TEXT,
    connect_timeout_ms INTEGER NOT NULL DEFAULT 3000,
    command_timeout_ms INTEGER NOT NULL DEFAULT 3000,
    min_volume_db REAL NOT NULL DEFAULT -80,
    max_volume_db REAL NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 0,
    daily_controls TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_zonepro_units_host_port ON zonepro_units(host, port);
  CREATE TABLE IF NOT EXISTS zonepro_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    configuration TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(unit_id) REFERENCES zonepro_units(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_zonepro_snapshots_unit ON zonepro_snapshots(unit_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS zonepro_plans (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(unit_id) REFERENCES zonepro_units(id) ON DELETE CASCADE
  );
`);

function parseUnit(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, host: row.host, port: row.port, model: row.model,
    firmware: row.firmware, connectTimeoutMs: row.connect_timeout_ms,
    commandTimeoutMs: row.command_timeout_ms, minVolumeDb: row.min_volume_db,
    maxVolumeDb: row.max_volume_db, enabled: !!row.enabled,
    dailyControls: JSON.parse(row.daily_controls || '{}'),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function listZoneProUnits() {
  return db.prepare('SELECT * FROM zonepro_units ORDER BY name').all().map(parseUnit);
}

export function getZoneProUnit(id) {
  return parseUnit(db.prepare('SELECT * FROM zonepro_units WHERE id = ?').get(id));
}

export function saveZoneProUnit(unit) {
  const id = unit.id || randomUUID();
  db.prepare(`INSERT INTO zonepro_units
    (id,name,host,port,model,firmware,connect_timeout_ms,command_timeout_ms,min_volume_db,max_volume_db,enabled,daily_controls,updated_at)
    VALUES (@id,@name,@host,@port,@model,@firmware,@connectTimeoutMs,@commandTimeoutMs,@minVolumeDb,@maxVolumeDb,@enabled,@dailyControls,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,port=excluded.port,model=excluded.model,
    firmware=excluded.firmware,connect_timeout_ms=excluded.connect_timeout_ms,command_timeout_ms=excluded.command_timeout_ms,
    min_volume_db=excluded.min_volume_db,max_volume_db=excluded.max_volume_db,enabled=excluded.enabled,
    daily_controls=excluded.daily_controls,updated_at=datetime('now')`).run({
      id, name: unit.name, host: unit.host, port: unit.port, model: unit.model,
      firmware: unit.firmware || null, connectTimeoutMs: unit.connectTimeoutMs,
      commandTimeoutMs: unit.commandTimeoutMs, minVolumeDb: unit.minVolumeDb,
      maxVolumeDb: unit.maxVolumeDb, enabled: unit.enabled ? 1 : 0,
      dailyControls: JSON.stringify(unit.dailyControls || {}),
    });
  return getZoneProUnit(id);
}

export function saveZoneProSnapshot(unitId, kind, configuration) {
  const result = db.prepare('INSERT INTO zonepro_snapshots (unit_id,kind,configuration) VALUES (?,?,?)')
    .run(unitId, kind, JSON.stringify(configuration));
  return getZoneProSnapshot(Number(result.lastInsertRowid));
}

export function getZoneProSnapshot(id) {
  const row = db.prepare('SELECT * FROM zonepro_snapshots WHERE id = ?').get(id);
  return row ? { id: row.id, unitId: row.unit_id, kind: row.kind, configuration: JSON.parse(row.configuration), createdAt: row.created_at } : null;
}

export function listZoneProSnapshots(unitId, limit = 100) {
  return db.prepare('SELECT * FROM zonepro_snapshots WHERE unit_id = ? ORDER BY id DESC LIMIT ?').all(unitId, limit)
    .map(row => ({ id: row.id, unitId: row.unit_id, kind: row.kind, configuration: JSON.parse(row.configuration), createdAt: row.created_at }));
}

export function getLatestConfirmedZoneProSnapshot(unitId) {
  const row = db.prepare("SELECT * FROM zonepro_snapshots WHERE unit_id = ? AND kind IN ('confirmed-readback','verified') ORDER BY id DESC LIMIT 1").get(unitId);
  return row ? { id: row.id, unitId: row.unit_id, kind: row.kind, configuration: JSON.parse(row.configuration), createdAt: row.created_at } : null;
}

export function saveZoneProPlan(plan, ttlMs = 5 * 60 * 1000) {
  db.prepare('INSERT OR REPLACE INTO zonepro_plans (id,unit_id,plan,state,expires_at) VALUES (?,?,?,?,?)')
    .run(plan.id, plan.unitId, JSON.stringify(plan), 'pending', Date.now() + ttlMs);
}

export function consumeZoneProPlan(id) {
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM zonepro_plans WHERE id = ? AND state = 'pending'").get(id);
    if (!row || row.expires_at < Date.now()) return null;
    db.prepare("UPDATE zonepro_plans SET state = 'consumed' WHERE id = ? AND state = 'pending'").run(id);
    return JSON.parse(row.plan);
  })();
}

export function getPendingZoneProPlan(id) {
  const row = db.prepare("SELECT plan FROM zonepro_plans WHERE id = ? AND state = 'pending' AND expires_at >= ?").get(id, Date.now());
  return row ? JSON.parse(row.plan) : null;
}

export function findPendingZoneProPlan(unitId, predicate) {
  const rows = db.prepare("SELECT plan FROM zonepro_plans WHERE unit_id = ? AND state = 'pending' AND expires_at >= ? ORDER BY created_at DESC")
    .all(unitId, Date.now());
  return rows.map(row => JSON.parse(row.plan)).find(predicate) || null;
}