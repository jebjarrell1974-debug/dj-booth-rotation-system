const APP_VERSION = '1.0.0';
let heartbeatInterval = null;
let deviceApiKey = null;
let fleetServerUrl = null;
let appStartTime = Date.now();

function getMemoryInfo() {
  if (performance.memory) {
    return {
      heapUsed: performance.memory.usedJSHeapSize,
      heapTotal: performance.memory.totalJSHeapSize,
      heapLimit: performance.memory.jsHeapSizeLimit,
      percent: Math.round((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100),
    };
  }
  return { heapUsed: 0, heapTotal: 0, heapLimit: 0, percent: 0 };
}

function getStorageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    return navigator.storage.estimate().then(est => ({
      used: est.usage || 0,
      total: est.quota || 0,
      percent: est.quota ? Math.round(((est.usage || 0) / est.quota) * 100) : 0,
    })).catch(() => ({ used: 0, total: 0, percent: 0 }));
  }
  return Promise.resolve({ used: 0, total: 0, percent: 0 });
}

function getUptimeSeconds() {
  return Math.floor((Date.now() - appStartTime) / 1000);
}

function getActiveDancerCount() {
  try {
    const rotation = JSON.parse(localStorage.getItem('djbooth_rotation') || '[]');
    return Array.isArray(rotation) ? rotation.length : 0;
  } catch {
    return 0;
  }
}

function getIsPlaying() {
  try {
    return localStorage.getItem('djbooth_isPlaying') === 'true';
  } catch {
    return false;
  }
}

async function fetchServerMetrics() {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch {}
  return null;
}

async function collectHealthData() {
  const memory = getMemoryInfo();
  const storage = await getStorageEstimate();
  const serverMetrics = await fetchServerMetrics();

  const healthData = {
    app_version: APP_VERSION,
    memory_percent: memory.percent,
    memory_used_mb: Math.round(memory.heapUsed / (1024 * 1024)),
    memory_total_mb: Math.round(memory.heapLimit / (1024 * 1024)),
    disk_percent: storage.percent,
    disk_used_mb: Math.round(storage.used / (1024 * 1024)),
    uptime_seconds: getUptimeSeconds(),
    active_dancers: getActiveDancerCount(),
    is_playing: getIsPlaying(),
    cpu_percent: 0,
    connection_count: typeof navigator.connection !== 'undefined' ?
      (navigator.connection.downlink || 0) : 0,
    user_agent: navigator.userAgent.slice(0, 200),
  };

  if (serverMetrics) {
    const mem = serverMetrics.memory;
    if (mem) {
      healthData.server_memory_rss_mb = Math.round(mem.rss / (1024 * 1024));
      healthData.server_heap_used_mb = Math.round(mem.heapUsed / (1024 * 1024));
    }
    healthData.server_uptime_seconds = Math.round(serverMetrics.uptime || 0);
  }

  return healthData;
}

async function sendHeartbeat() {
  if (!deviceApiKey || !fleetServerUrl) return null;

  try {
    const healthData = await collectHealthData();
    const res = await fetch(`${fleetServerUrl}/api/fleet/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Key': deviceApiKey,
      },
      body: JSON.stringify(healthData),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      return res.json();
    }
  } catch (err) {
    console.warn('[systemHealth] Heartbeat failed:', err.message);
  }
  return null;
}

export function startHealthMonitoring(config = {}) {
  if (config.deviceApiKey) deviceApiKey = config.deviceApiKey;
  if (config.fleetServerUrl) fleetServerUrl = config.fleetServerUrl;
  if (!deviceApiKey) deviceApiKey = localStorage.getItem('fleet_device_api_key');
  if (!fleetServerUrl) fleetServerUrl = localStorage.getItem('fleet_server_url') || '';

  if (!deviceApiKey || !fleetServerUrl) return;

  if (heartbeatInterval) clearInterval(heartbeatInterval);

  sendHeartbeat();

  const intervalMs = config.intervalMs || 3 * 60 * 1000;
  heartbeatInterval = setInterval(sendHeartbeat, intervalMs);
}

export function stopHealthMonitoring() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

export function configureHealthMonitoring(serverUrl, apiKey) {
  fleetServerUrl = serverUrl;
  deviceApiKey = apiKey;
  localStorage.setItem('fleet_server_url', serverUrl);
  localStorage.setItem('fleet_device_api_key', apiKey);
  startHealthMonitoring({ fleetServerUrl: serverUrl, deviceApiKey: apiKey });
}

export { collectHealthData, sendHeartbeat };
