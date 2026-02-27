const API_BASE = '/api/fleet';

function getToken() {
  return sessionStorage.getItem('djbooth_token');
}

async function fleetFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    sessionStorage.clear();
    window.location.href = '/';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }

  return res;
}

export const fleetAdmin = {
  async getDashboardOverview() {
    const res = await fleetFetch('/dashboard/overview');
    return res.json();
  },

  async listDevices() {
    const res = await fleetFetch('/devices');
    return res.json();
  },

  async getDevice(deviceId) {
    const res = await fleetFetch(`/devices/${deviceId}`);
    return res.json();
  },

  async registerDevice(deviceName, clubName) {
    const res = await fleetFetch('/devices/register', {
      method: 'POST',
      body: JSON.stringify({ deviceName, clubName }),
    });
    return res.json();
  },

  async updateDevice(deviceId, data) {
    const res = await fleetFetch(`/devices/${deviceId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deleteDevice(deviceId) {
    const res = await fleetFetch(`/devices/${deviceId}`, { method: 'DELETE' });
    return res.json();
  },

  async getHeartbeats(deviceId, limit = 100) {
    const res = await fleetFetch(`/heartbeats/${deviceId}?limit=${limit}`);
    return res.json();
  },

  async getErrorLogs(deviceId = null, limit = 200) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (deviceId) params.set('deviceId', deviceId);
    const res = await fleetFetch(`/logs?${params}`);
    return res.json();
  },

  async getDeviceLogs(deviceId, limit = 200) {
    const res = await fleetFetch(`/logs/${deviceId}?limit=${limit}`);
    return res.json();
  },

  async getVoiceovers() {
    const res = await fleetFetch('/voiceovers');
    return res.json();
  },

  async getMusic() {
    const res = await fleetFetch('/music');
    return res.json();
  },

  async getSyncHistory(deviceId = null, limit = 50) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (deviceId) params.set('deviceId', deviceId);
    const res = await fleetFetch(`/sync/history?${params}`);
    return res.json();
  },

  async listUpdates() {
    const res = await fleetFetch('/updates');
    return res.json();
  },

  async createUpdate(version, releaseNotes, targetDevices = []) {
    const res = await fleetFetch('/updates/create', {
      method: 'POST',
      body: JSON.stringify({ version, releaseNotes, targetDevices }),
    });
    return res.json();
  },

  async deleteUpdate(id) {
    const res = await fleetFetch(`/updates/${id}`, { method: 'DELETE' });
    return res.json();
  },

  async clearDeviceLogs(deviceId) {
    const res = await fleetFetch(`/logs/clear/${deviceId}`, { method: 'DELETE' });
    return res.json();
  },

  async clearAllLogs() {
    const res = await fleetFetch('/logs/clear', { method: 'DELETE' });
    return res.json();
  },

  async getMusicManifest(deviceId) {
    const res = await fleetFetch(`/music/manifest/${deviceId}`);
    return res.json();
  },
};

export class FleetSyncClient {
  constructor(serverUrl, deviceApiKey) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.apiKey = deviceApiKey;
    this.syncSchedule = { hour: 9, minute: 30, timezone: 'America/Chicago' };
    this.heartbeatInterval = null;
    this.syncCheckInterval = null;
    this.isSyncing = false;
    this.lastSyncTime = 0;
    this.errorBuffer = [];
    this.onSyncStatus = null;
    this.onVoiceoverDownloaded = null;
    this.onSyncTriggered = null;
  }

  async deviceFetch(path, options = {}) {
    const headers = { ...options.headers, 'X-Device-Key': this.apiKey };
    if (!options.headers?.['Content-Type'] && !(options.body instanceof Buffer || options.body instanceof Uint8Array)) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${this.serverUrl}/api/fleet${path}`, { ...options, headers });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `Fleet API error: ${res.status}`);
    }

    return res;
  }

  async sendHeartbeat(systemInfo = {}) {
    try {
      const res = await this.deviceFetch('/heartbeat', {
        method: 'POST',
        body: JSON.stringify(systemInfo),
      });
      const data = await res.json();

      if (data.syncSchedule) {
        this.syncSchedule = data.syncSchedule;
      }

      return data;
    } catch (err) {
      this.bufferError('heartbeat', err.message);
      return null;
    }
  }

  async uploadLogs() {
    if (this.errorBuffer.length === 0) return;

    const logsToSend = [...this.errorBuffer];
    this.errorBuffer = [];

    try {
      await this.deviceFetch('/logs', {
        method: 'POST',
        body: JSON.stringify({ logs: logsToSend }),
      });
    } catch (err) {
      this.errorBuffer.unshift(...logsToSend);
      if (this.errorBuffer.length > 500) {
        this.errorBuffer = this.errorBuffer.slice(0, 500);
      }
    }
  }

  async uploadVoiceover(dancerName, voiceoverType, audioBlob, mimeType = 'audio/mpeg') {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const res = await this.deviceFetch('/voiceovers/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Dancer-Name': dancerName,
          'X-Voiceover-Type': voiceoverType,
          'X-Mime-Type': mimeType,
        },
        body: new Uint8Array(arrayBuffer),
      });
      return res.json();
    } catch (err) {
      this.bufferError('voiceover_upload', `Failed to upload ${dancerName}/${voiceoverType}: ${err.message}`);
      return null;
    }
  }

  async getVoiceoverManifest() {
    try {
      const res = await this.deviceFetch('/voiceovers/manifest');
      return res.json();
    } catch (err) {
      this.bufferError('voiceover_manifest', err.message);
      return [];
    }
  }

  async downloadVoiceover(id) {
    try {
      const res = await this.deviceFetch(`/voiceovers/download/${id}`);
      const blob = await res.blob();
      return {
        blob,
        dancerName: res.headers.get('X-Dancer-Name'),
        voiceoverType: res.headers.get('X-Voiceover-Type'),
        fileHash: res.headers.get('X-File-Hash'),
      };
    } catch (err) {
      this.bufferError('voiceover_download', `Failed to download voiceover ${id}: ${err.message}`);
      return null;
    }
  }

  async checkForUpdates(currentVersion) {
    try {
      const res = await this.deviceFetch(`/updates/check?currentVersion=${currentVersion}`);
      return res.json();
    } catch (err) {
      this.bufferError('update_check', err.message);
      return { updateAvailable: false };
    }
  }

  async startFullSync(localVoiceovers = [], currentVersion = '1.0.0') {
    if (this.isSyncing) return { status: 'already_syncing' };
    this.isSyncing = true;
    this.updateStatus('starting');

    const results = {
      voiceoversUploaded: 0,
      voiceoversDownloaded: 0,
      musicDownloaded: 0,
      updateApplied: null,
      errors: [],
    };

    try {
      this.updateStatus('fetching_manifest');
      const syncData = await this.deviceFetch('/sync/start', { method: 'POST', body: JSON.stringify({}) });
      const manifest = await syncData.json();

      this.updateStatus('uploading_logs');
      await this.uploadLogs();

      this.updateStatus('uploading_voiceovers');
      const serverHashes = new Set(manifest.voiceovers.map(v => v.file_hash));
      for (const local of localVoiceovers) {
        if (!serverHashes.has(local.fileHash)) {
          const uploaded = await this.uploadVoiceover(local.dancerName, local.voiceoverType, local.blob, local.mimeType);
          if (uploaded) results.voiceoversUploaded++;
        }
      }

      this.updateStatus('downloading_voiceovers');
      const localHashes = new Set(localVoiceovers.map(v => v.fileHash));
      for (const remote of manifest.voiceovers) {
        if (!localHashes.has(remote.file_hash)) {
          const downloaded = await this.downloadVoiceover(remote.id || remote.dancer_name);
          if (downloaded && this.onVoiceoverDownloaded) {
            await this.onVoiceoverDownloaded(downloaded);
            results.voiceoversDownloaded++;
          }
        }
      }

      if (manifest.latestUpdate && manifest.latestUpdate.version > currentVersion) {
        this.updateStatus('update_available');
        results.updateAvailable = manifest.latestUpdate;
      }

      this.updateStatus('completing');
      await this.deviceFetch('/sync/complete', {
        method: 'POST',
        body: JSON.stringify(results),
      });

      this.updateStatus('complete');
      this.lastSyncTime = Date.now();
    } catch (err) {
      results.errors.push(err.message);
      this.updateStatus('error');
      this.bufferError('full_sync', err.message);
    } finally {
      this.isSyncing = false;
    }

    return results;
  }

  startHeartbeat(intervalMs = 3 * 60 * 1000, getSystemInfo = () => ({})) {
    this.sendHeartbeat(getSystemInfo());

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat(getSystemInfo());
    }, intervalMs);
  }

  startSyncScheduler() {
    this.syncCheckInterval = setInterval(() => {
      if (this.isSyncing) return;

      const now = new Date();
      const tzTime = new Date(now.toLocaleString('en-US', { timeZone: this.syncSchedule.timezone }));
      const hour = tzTime.getHours();
      const minute = tzTime.getMinutes();

      if (hour === this.syncSchedule.hour && minute === this.syncSchedule.minute) {
        const timeSinceLastSync = Date.now() - this.lastSyncTime;
        if (timeSinceLastSync > 60 * 60 * 1000) {
          if (this.onSyncTriggered) {
            this.onSyncTriggered();
          }
        }
      }
    }, 30 * 1000);
  }

  stop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.syncCheckInterval) clearInterval(this.syncCheckInterval);
  }

  bufferError(component, message, stack = '') {
    this.errorBuffer.push({
      timestamp: Date.now(),
      level: 'error',
      component,
      message,
      stack,
    });
    if (this.errorBuffer.length > 500) {
      this.errorBuffer = this.errorBuffer.slice(-500);
    }
  }

  bufferLog(level, component, message) {
    this.errorBuffer.push({
      timestamp: Date.now(),
      level,
      component,
      message,
    });
  }

  updateStatus(status) {
    if (this.onSyncStatus) {
      this.onSyncStatus(status);
    }
  }
}
