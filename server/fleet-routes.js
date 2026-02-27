import express from 'express';
import crypto from 'crypto';
import {
  registerDevice, authenticateDevice, listDevices, getDevice, updateDevice, deleteDevice,
  recordHeartbeat, getRecentHeartbeats,
  recordErrorLog, getErrorLogs,
  uploadVoiceover, listVoiceovers, getVoiceoverManifest, getVoiceoverFile, getVoiceoverByNameType,
  listFleetMusic, getMusicManifest,
  createUpdate, getLatestUpdate, getUpdatePackage,
  recordSync, getSyncHistory,
  updateDeviceStatuses,
  listUpdates, deleteUpdate, clearErrorLogs
} from './fleet-db.js';
import { getSession } from './db.js';

const router = express.Router();

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

function authenticateDeviceMiddleware(req, res, next) {
  const apiKey = req.headers['x-device-key'];
  if (!apiKey) return res.status(401).json({ error: 'Device API key required' });

  const device = authenticateDevice(apiKey);
  if (!device) return res.status(401).json({ error: 'Invalid device API key' });

  req.device = device;
  next();
}

function authenticateFleetAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  const session = getSession(token);
  if (!session || session.role !== 'dj') return res.status(403).json({ error: 'Fleet admin access required' });

  req.session = session;
  next();
}

router.post('/devices/register', authenticateFleetAdmin, (req, res) => {
  const { deviceName, clubName } = req.body;
  if (!deviceName) return res.status(400).json({ error: 'Device name required' });

  try {
    const device = registerDevice(deviceName, clubName || '');
    res.json(device);
  } catch (err) {
    res.status(500).json({ error: 'Failed to register device' });
  }
});

router.get('/devices', authenticateFleetAdmin, (req, res) => {
  updateDeviceStatuses();
  const devices = listDevices();
  const safe = devices.map(({ api_key, ...rest }) => rest);
  res.json(safe);
});

router.get('/devices/:deviceId', authenticateFleetAdmin, (req, res) => {
  const device = getDevice(req.params.deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const { api_key, ...safe } = device;
  res.json(safe);
});

router.put('/devices/:deviceId', authenticateFleetAdmin, (req, res) => {
  const device = updateDevice(req.params.deviceId, req.body);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const { api_key, ...safe } = device;
  res.json(safe);
});

router.delete('/devices/:deviceId', authenticateFleetAdmin, (req, res) => {
  deleteDevice(req.params.deviceId);
  res.json({ ok: true });
});

router.post('/heartbeat', authenticateDeviceMiddleware, (req, res) => {
  try {
    recordHeartbeat(req.device.device_id, req.body);
    const latestUpdate = getLatestUpdate(req.device.device_id);
    res.json({
      ok: true,
      serverTime: Date.now(),
      latestVersion: latestUpdate ? latestUpdate.version : null,
      syncSchedule: {
        hour: req.device.sync_hour,
        minute: req.device.sync_minute,
        timezone: req.device.timezone
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record heartbeat' });
  }
});

router.get('/heartbeats/:deviceId', authenticateFleetAdmin, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const heartbeats = getRecentHeartbeats(req.params.deviceId, limit);
  res.json(heartbeats);
});

router.post('/logs', authenticateDeviceMiddleware, (req, res) => {
  const { logs } = req.body;
  if (!logs || !Array.isArray(logs)) return res.status(400).json({ error: 'Logs array required' });

  try {
    recordErrorLog(req.device.device_id, logs);
    recordSync(req.device.device_id, 'logs', 'upload', 'success', '', logs.length, 0);
    res.json({ ok: true, received: logs.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to store logs' });
  }
});

router.get('/logs', authenticateFleetAdmin, (req, res) => {
  const deviceId = req.query.deviceId || null;
  const limit = parseInt(req.query.limit) || 200;
  const logs = getErrorLogs(deviceId, limit);
  res.json(logs);
});

router.get('/logs/:deviceId', authenticateFleetAdmin, (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const logs = getErrorLogs(req.params.deviceId, limit);
  res.json(logs);
});

router.post('/voiceovers/upload', authenticateDeviceMiddleware, express.raw({ type: 'application/octet-stream', limit: '10mb' }), (req, res) => {
  const dancerName = req.headers['x-dancer-name'];
  const voiceoverType = req.headers['x-voiceover-type'];
  const mimeType = req.headers['x-mime-type'] || 'audio/mpeg';

  if (!dancerName || !voiceoverType) {
    return res.status(400).json({ error: 'x-dancer-name and x-voiceover-type headers required' });
  }

  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ error: 'No file data received' });
  }

  try {
    const fileHash = crypto.createHash('md5').update(req.body).digest('hex');
    const id = uploadVoiceover(dancerName, voiceoverType, req.body, fileHash, mimeType, req.device.device_id);
    recordSync(req.device.device_id, 'voiceover', 'upload', 'success', `${dancerName}/${voiceoverType}`, 1, req.body.length);
    res.json({ ok: true, id, fileHash });
  } catch (err) {
    res.status(500).json({ error: 'Failed to upload voiceover' });
  }
});

router.get('/voiceovers', authenticateFleetAdmin, (req, res) => {
  const voiceovers = listVoiceovers();
  res.json(voiceovers);
});

router.get('/voiceovers/manifest', authenticateDeviceMiddleware, (req, res) => {
  const manifest = getVoiceoverManifest();
  res.json(manifest);
});

router.get('/voiceovers/download/:id', authenticateDeviceMiddleware, (req, res) => {
  const vo = getVoiceoverFile(parseInt(req.params.id));
  if (!vo) return res.status(404).json({ error: 'Voiceover not found' });

  recordSync(req.device.device_id, 'voiceover', 'download', 'success', `${vo.dancer_name}/${vo.voiceover_type}`, 1, vo.file_size);

  res.set('Content-Type', vo.mime_type);
  res.set('Content-Length', vo.file_size);
  res.set('X-Dancer-Name', vo.dancer_name);
  res.set('X-Voiceover-Type', vo.voiceover_type);
  res.set('X-File-Hash', vo.file_hash);
  res.send(vo.file_data);
});

router.get('/voiceovers/download-by-name', authenticateDeviceMiddleware, (req, res) => {
  const { dancerName, voiceoverType } = req.query;
  if (!dancerName || !voiceoverType) return res.status(400).json({ error: 'dancerName and voiceoverType required' });

  const vo = getVoiceoverByNameType(dancerName, voiceoverType);
  if (!vo) return res.status(404).json({ error: 'Voiceover not found' });

  recordSync(req.device.device_id, 'voiceover', 'download', 'success', `${vo.dancer_name}/${vo.voiceover_type}`, 1, vo.file_size);

  res.set('Content-Type', vo.mime_type);
  res.set('Content-Length', vo.file_size);
  res.set('X-Dancer-Name', vo.dancer_name);
  res.set('X-Voiceover-Type', vo.voiceover_type);
  res.set('X-File-Hash', vo.file_hash);
  res.send(vo.file_data);
});

router.get('/music/manifest', authenticateDeviceMiddleware, (req, res) => {
  const manifest = getMusicManifest(req.device.device_id);
  res.json(manifest);
});

router.get('/music', authenticateFleetAdmin, (req, res) => {
  const music = listFleetMusic();
  res.json(music);
});

router.get('/updates/check', authenticateDeviceMiddleware, (req, res) => {
  const currentVersion = req.query.currentVersion || '0.0.0';
  const latest = getLatestUpdate(req.device.device_id);

  if (!latest || latest.version <= currentVersion) {
    return res.json({ updateAvailable: false, currentVersion });
  }

  res.json({
    updateAvailable: true,
    currentVersion,
    newVersion: latest.version,
    releaseNotes: latest.release_notes,
    packageSize: latest.package_size,
    updateId: latest.id
  });
});

router.get('/updates/download/:id', authenticateDeviceMiddleware, (req, res) => {
  const update = getUpdatePackage(parseInt(req.params.id));
  if (!update) return res.status(404).json({ error: 'Update not found' });

  if (!update.package_data) return res.status(404).json({ error: 'No package data available' });

  recordSync(req.device.device_id, 'update', 'download', 'success', `v${update.version}`, 1, update.package_size);

  res.set('Content-Type', 'application/gzip');
  res.set('Content-Length', update.package_size);
  res.set('X-Version', update.version);
  res.send(update.package_data);
});

router.post('/sync/start', authenticateDeviceMiddleware, (req, res) => {
  recordSync(req.device.device_id, 'full', 'both', 'started', 'Sync session initiated');

  const voiceoverManifest = getVoiceoverManifest();
  const musicManifest = getMusicManifest(req.device.device_id);
  const latestUpdate = getLatestUpdate(req.device.device_id);

  res.json({
    ok: true,
    serverTime: Date.now(),
    voiceovers: voiceoverManifest,
    music: musicManifest,
    latestUpdate: latestUpdate ? {
      version: latestUpdate.version,
      releaseNotes: latestUpdate.release_notes,
      packageSize: latestUpdate.package_size,
      updateId: latestUpdate.id
    } : null
  });
});

router.post('/sync/complete', authenticateDeviceMiddleware, (req, res) => {
  const { voiceoversUploaded, voiceoversDownloaded, musicDownloaded, updateApplied, errors } = req.body;
  const status = errors && errors.length > 0 ? 'partial' : 'success';
  const details = [
    voiceoversUploaded ? `${voiceoversUploaded} voiceovers uploaded` : '',
    voiceoversDownloaded ? `${voiceoversDownloaded} voiceovers downloaded` : '',
    musicDownloaded ? `${musicDownloaded} tracks downloaded` : '',
    updateApplied ? `Updated to ${updateApplied}` : '',
  ].filter(Boolean).join(', ');

  recordSync(req.device.device_id, 'full', 'both', status, details || 'No changes');
  res.json({ ok: true });
});

router.get('/sync/history', authenticateFleetAdmin, (req, res) => {
  const deviceId = req.query.deviceId || null;
  const limit = parseInt(req.query.limit) || 50;
  const history = getSyncHistory(deviceId, limit);
  res.json(history);
});

router.get('/dashboard/overview', authenticateFleetAdmin, (req, res) => {
  updateDeviceStatuses();
  const devices = listDevices();
  const voiceovers = listVoiceovers();

  const uniqueDancers = [...new Set(voiceovers.map(v => v.dancer_name))];

  const overview = {
    totalDevices: devices.length,
    onlineDevices: devices.filter(d => d.status === 'online').length,
    offlineDevices: devices.filter(d => d.status === 'offline').length,
    totalVoiceovers: voiceovers.length,
    uniqueDancers: uniqueDancers.length,
    devices: devices.map(({ api_key, ...d }) => ({
      ...d,
      timeSinceHeartbeat: d.last_heartbeat ? Date.now() - d.last_heartbeat : null
    }))
  };

  res.json(overview);
});

router.post('/updates/create', authenticateFleetAdmin, express.json({ limit: '100mb' }), (req, res) => {
  const { version, releaseNotes, targetDevices } = req.body;
  if (!version) return res.status(400).json({ error: 'Version required' });

  try {
    const id = createUpdate(version, releaseNotes || '', null, targetDevices || []);
    res.json({ ok: true, id, version });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: `Version ${version} already exists` });
    }
    res.status(500).json({ error: 'Failed to create update: ' + err.message });
  }
});

router.get('/updates', authenticateFleetAdmin, (req, res) => {
  try {
    res.json(listUpdates());
  } catch (err) {
    res.status(500).json({ error: 'Failed to list updates' });
  }
});

router.delete('/updates/:id', authenticateFleetAdmin, (req, res) => {
  try {
    deleteUpdate(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete update' });
  }
});

router.delete('/logs/clear/:deviceId', authenticateFleetAdmin, (req, res) => {
  try {
    clearErrorLogs(req.params.deviceId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

router.delete('/logs/clear', authenticateFleetAdmin, (req, res) => {
  try {
    clearErrorLogs();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear all logs' });
  }
});

router.get('/music/manifest/:deviceId', authenticateFleetAdmin, (req, res) => {
  const manifest = getMusicManifest(req.params.deviceId);
  res.json(manifest);
});

setInterval(updateDeviceStatuses, 60 * 1000);

export default router;
