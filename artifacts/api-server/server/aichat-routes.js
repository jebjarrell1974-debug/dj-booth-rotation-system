// AI Chat / Custom GPT integration for NEON AI DJ.
//
// Mounts read-only fleet-monitoring tools at /aichat/* for an external
// AI client (OpenAI Custom GPT, Claude connector, etc.). Designed to be
// reached over a Cloudflare Tunnel; gated by a shared bearer token.
//
// All endpoints are READ-ONLY. No state changes, no fleet commands.
// Future write capabilities (restart/update/etc.) will live in a
// separate gated module — never add them here.

import express from 'express';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  getRecentHeartbeats,
  getErrorLogs,
  getFleetPlayHistory,
  getFleetPlayHistoryDates,
  listDevices,
  getDevice,
  updateDeviceStatuses,
} from './fleet-db.js';
import { getClientSettings, getAuditLog } from './db.js';

const router = express.Router();

// ─── Bearer-token auth ────────────────────────────────────────────────────────
// Token sources in priority order:
//   1. AICHAT_TOKEN env var (handy for dev/curl)
//   2. ~/.djbooth-aichat-token dotfile (production on homebase)
// Server fail-closes if neither is present — every request 401s.

function loadAichatToken() {
  if (process.env.AICHAT_TOKEN && process.env.AICHAT_TOKEN.trim()) {
    return process.env.AICHAT_TOKEN.trim();
  }
  const tokenPath = join(homedir(), '.djbooth-aichat-token');
  if (existsSync(tokenPath)) {
    try {
      const t = readFileSync(tokenPath, 'utf8').trim();
      if (t) return t;
    } catch (_e) {
      // fall through
    }
  }
  return null;
}

const AICHAT_TOKEN = loadAichatToken();

function requireBearer(req, res, next) {
  if (!AICHAT_TOKEN) {
    return res.status(503).json({
      error:
        'aichat disabled — no token configured. Set AICHAT_TOKEN env or write ~/.djbooth-aichat-token',
    });
  }
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1].trim() !== AICHAT_TOKEN) {
    return res.status(401).json({ error: 'invalid bearer token' });
  }
  next();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveDevice(deviceIdOrName) {
  if (!deviceIdOrName) return null;
  const idNum = Number(deviceIdOrName);
  if (Number.isInteger(idNum) && idNum > 0) {
    const d = getDevice(idNum);
    if (d) return d;
  }
  const all = listDevices();
  const lower = String(deviceIdOrName).toLowerCase();
  return (
    all.find((d) => String(d.device_name).toLowerCase() === lower) ||
    all.find((d) => String(d.club_name || '').toLowerCase() === lower) ||
    null
  );
}

function safeJson(value, fallback) {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sendInternalError(res, scope, err) {
  console.error(`[aichat] ${scope}:`, err);
  res.status(500).json({ error: 'internal error' });
}

function extractBoothStateFromHeartbeat(hb) {
  if (!hb) return null;
  const extra = safeJson(hb.extra_data, {}) || {};
  return {
    deviceId: hb.device_id,
    capturedAt: hb.created_at,
    isRotationActive: extra.isRotationActive ?? null,
    isPlaying: extra.isPlaying ?? null,
    currentDancerName: extra.currentDancerName ?? null,
    currentSong: extra.currentSong ?? extra.currentTrack ?? null,
    currentSongNumber: extra.currentSongNumber ?? null,
    breakSongIndex: extra.breakSongIndex ?? null,
    breakSongsPerSet: extra.breakSongsPerSet ?? null,
    queue: extra.queue ?? extra.upcomingDancers ?? null,
    audioLevels: extra.audioLevels ?? null,
    lastTransitionMs: extra.lastTransitionMs ?? null,
    cacheHitRate: extra.cacheHitRate ?? null,
  };
}

function trimDiagEvent(row) {
  return {
    id: row.id,
    device_id: row.device_id,
    timestamp: row.created_at || row.timestamp,
    level: row.level || row.severity || 'info',
    message: row.message || row.error_message || row.text || '',
    context: safeJson(row.context, undefined),
  };
}

// ─── Discovery: tool manifest + OpenAPI spec ──────────────────────────────────
// The OpenAPI spec is what an OpenAI Custom GPT Action consumes.
// Served unauthenticated (it contains no secrets) so the Custom GPT
// builder can fetch and validate it. The endpoints it describes still
// require the bearer token.

router.get('/openapi.yaml', (req, res) => {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = `${proto}://${host}`;
  res.setHeader('Content-Type', 'application/yaml');
  res.send(buildOpenApiYaml(baseUrl));
});

router.get('/', requireBearer, (req, res) => {
  res.json({
    service: 'NEON AI DJ — aichat',
    tools: [
      'get_booth_state',
      'get_device_health',
      'get_play_history',
      'get_diag_log',
      'get_audit_log',
      'query_settings',
    ],
  });
});

// ─── Tool: get_booth_state ────────────────────────────────────────────────────
router.get('/booth-state/:deviceId', requireBearer, (req, res) => {
  try {
    const device = resolveDevice(req.params.deviceId);
    if (!device) return res.status(404).json({ error: 'device not found' });
    const heartbeats = getRecentHeartbeats(device.id, 1) || [];
    const state = extractBoothStateFromHeartbeat(heartbeats[0]);
    if (!state) {
      return res.json({
        device: {
          id: device.id,
          name: device.device_name,
          club: device.club_name,
        },
        boothState: null,
        note: 'no heartbeats received yet',
      });
    }
    res.json({
      device: { id: device.id, name: device.device_name, club: device.club_name },
      boothState: state,
    });
  } catch (err) {
    sendInternalError(res, 'booth-state', err);
  }
});

// ─── Tool: get_device_health ──────────────────────────────────────────────────
router.get('/device-health', requireBearer, (req, res) => {
  try {
    updateDeviceStatuses();
    const devices = listDevices();
    const summary = devices.map((d) => {
      const hbList = getRecentHeartbeats(d.id, 1) || [];
      const last = hbList[0] || null;
      return {
        id: d.id,
        name: d.device_name,
        club: d.club_name,
        status: d.status,
        version: d.app_version,
        lastSeen: d.last_seen,
        license: {
          status: d.license_status,
          expiresAt: d.license_expires_at,
        },
        lastHeartbeatAt: last?.created_at ?? null,
        cpuPct: last?.cpu_percent ?? null,
        memPct: last?.memory_percent ?? null,
        diskPct: last?.disk_percent ?? null,
        uptimeSec: last?.uptime_seconds ?? null,
      };
    });
    res.json({ devices: summary, total: summary.length });
  } catch (err) {
    sendInternalError(res, 'device-health (fleet)', err);
  }
});

router.get('/device-health/:deviceId', requireBearer, (req, res) => {
  try {
    const device = resolveDevice(req.params.deviceId);
    if (!device) return res.status(404).json({ error: 'device not found' });
    updateDeviceStatuses();
    const refreshed = getDevice(device.id) || device;
    const hbList = getRecentHeartbeats(refreshed.id, 5) || [];
    res.json({
      device: {
        id: refreshed.id,
        name: refreshed.device_name,
        club: refreshed.club_name,
        status: refreshed.status,
        version: refreshed.app_version,
        lastSeen: refreshed.last_seen,
        license: {
          status: refreshed.license_status,
          expiresAt: refreshed.license_expires_at,
        },
      },
      recentHeartbeats: hbList.map((h) => ({
        at: h.created_at,
        cpuPct: h.cpu_percent,
        memPct: h.memory_percent,
        diskPct: h.disk_percent,
        uptimeSec: h.uptime_seconds,
      })),
    });
  } catch (err) {
    sendInternalError(res, 'device-health (one)', err);
  }
});

// ─── Tool: get_play_history ───────────────────────────────────────────────────
router.get('/play-history/:deviceId', requireBearer, (req, res) => {
  try {
    const device = resolveDevice(req.params.deviceId);
    if (!device) return res.status(404).json({ error: 'device not found' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const date = req.query.date || null;
    const tracks = getFleetPlayHistory(device.id, limit, 0, date) || [];
    const dates = getFleetPlayHistoryDates(device.id) || [];
    res.json({
      device: { id: device.id, name: device.device_name, club: device.club_name },
      date: date,
      availableDates: dates.slice(0, 30),
      count: tracks.length,
      tracks,
    });
  } catch (err) {
    sendInternalError(res, 'play-history', err);
  }
});

// ─── Tool: get_diag_log ───────────────────────────────────────────────────────
router.get('/diag-log/:deviceId', requireBearer, (req, res) => {
  try {
    const device = resolveDevice(req.params.deviceId);
    if (!device) return res.status(404).json({ error: 'device not found' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const sinceMs = req.query.since ? Date.parse(req.query.since) : null;
    const raw = getErrorLogs(device.id, limit) || [];
    const trimmed = raw
      .filter((row) => {
        if (!sinceMs || Number.isNaN(sinceMs)) return true;
        const t = Date.parse(row.created_at || row.timestamp || 0);
        return Number.isFinite(t) && t >= sinceMs;
      })
      .map(trimDiagEvent);
    res.json({
      device: { id: device.id, name: device.device_name, club: device.club_name },
      since: sinceMs ? new Date(sinceMs).toISOString() : null,
      count: trimmed.length,
      events: trimmed,
    });
  } catch (err) {
    sendInternalError(res, 'diag-log', err);
  }
});

// ─── Tool: get_audit_log ──────────────────────────────────────────────────────
router.get('/audit-log', requireBearer, (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 7, 90);
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const entries = getAuditLog({ limit, days }) || [];
    res.json({ days, count: entries.length, entries });
  } catch (err) {
    sendInternalError(res, 'audit-log', err);
  }
});

// ─── Tool: query_settings ─────────────────────────────────────────────────────
router.get('/settings', requireBearer, (req, res) => {
  try {
    res.json(getClientSettings() || {});
  } catch (err) {
    sendInternalError(res, 'settings', err);
  }
});

// ─── OpenAPI spec body ────────────────────────────────────────────────────────

function buildOpenApiYaml(baseUrl) {
  return `openapi: 3.1.0
info:
  title: NEON AI DJ Fleet Monitor
  version: 1.0.0
  description: |
    Read-only tools for monitoring the NEON AI DJ fleet (homebase + venue Dell units).
    Bearer-token authenticated. Safe to call any time — no side effects.
servers:
  - url: ${baseUrl}/aichat
security:
  - bearerAuth: []
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
paths:
  /booth-state/{deviceId}:
    get:
      operationId: get_booth_state
      summary: Get the current booth state of a venue (currently playing track, dancer, queue).
      parameters:
        - name: deviceId
          in: path
          required: true
          schema: { type: string }
          description: Numeric device id, device name (e.g. "neonaidj003"), or club name.
      responses:
        '200': { description: Current booth state derived from the latest heartbeat. }
  /device-health:
    get:
      operationId: get_fleet_health
      summary: Health summary across the entire fleet (last heartbeat, CPU, memory, disk, license).
      responses:
        '200': { description: Health summary array, one entry per device. }
  /device-health/{deviceId}:
    get:
      operationId: get_device_health
      summary: Detailed health for one device (recent heartbeats, license, version).
      parameters:
        - name: deviceId
          in: path
          required: true
          schema: { type: string }
      responses:
        '200': { description: Device health detail. }
  /play-history/{deviceId}:
    get:
      operationId: get_play_history
      summary: Songs played on a device.
      parameters:
        - name: deviceId
          in: path
          required: true
          schema: { type: string }
        - name: date
          in: query
          schema: { type: string, description: "YYYY-MM-DD; omit for most recent." }
        - name: limit
          in: query
          schema: { type: integer, default: 100, maximum: 500 }
      responses:
        '200': { description: Play history with timestamps and entertainer assignments. }
  /diag-log/{deviceId}:
    get:
      operationId: get_diag_log
      summary: Diagnostic event log (errors, dead-air alerts, watchdog fires) for a device.
      parameters:
        - name: deviceId
          in: path
          required: true
          schema: { type: string }
        - name: since
          in: query
          schema: { type: string, description: "ISO timestamp; only events at or after this time." }
        - name: limit
          in: query
          schema: { type: integer, default: 100, maximum: 500 }
      responses:
        '200': { description: Diagnostic events. }
  /audit-log:
    get:
      operationId: get_audit_log
      summary: Cross-fleet audit log of who changed what.
      parameters:
        - name: days
          in: query
          schema: { type: integer, default: 7, maximum: 90 }
        - name: limit
          in: query
          schema: { type: integer, default: 100, maximum: 500 }
      responses:
        '200': { description: Audit log entries. }
  /settings:
    get:
      operationId: query_settings
      summary: Current homebase client settings (rotation, voiceover, promo config).
      responses:
        '200': { description: Settings object. }
`;
}

export default router;
