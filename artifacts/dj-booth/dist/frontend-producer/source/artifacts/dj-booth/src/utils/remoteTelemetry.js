// Continuous, privacy-limited diagnostics for the staff remote. The reporting
// transport is supplied by serverApi and deliberately uses the page's origin,
// not the configured booth target (which may be the source of the failure).
const STORAGE_KEY = 'djbooth_remote_telemetry_pending';
const ID_KEY = 'djbooth_remote_telemetry_id';
const MAX_PENDING = 150;
let active = false;
let queue = [];
let loaded = false;
let sending = false;
let interval = null;
let retryTimer = null;
let nextRetryAt = 0;
let transport = null;
let context = null;
let stageProbe = null;
let lastStateSuccess = 0;
let lastBoothUpdate = 0;
let lastStateVersion = null;
let lastRotationVersion = null;
let lastBoothSnapshot = null;
let lastStateReport = 0;
const lastFailure = new Map();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(stored)) queue = stored.slice(-MAX_PENDING);
  } catch { queue = []; }
}

function persist() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue)); } catch {}
}

function clientId() {
  try {
    let id = sessionStorage.getItem(ID_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || `remote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch { return 'remote-unknown'; }
}

async function flush() {
  if (!active || sending || queue.length === 0 || !transport || Date.now() < nextRetryAt) return;
  sending = true;
  const batch = queue.slice(0, 25);
  try {
    await transport(batch);
    queue = queue.filter(entry => !batch.includes(entry));
    nextRetryAt = 0;
    persist();
  } catch {
    // A wrong target or Wi-Fi interruption must not lose the evidence. Keep
    // the bounded queue until the same-origin server becomes reachable again.
    nextRetryAt = Date.now() + 30_000;
  } finally {
    sending = false;
    if (queue.length > 0 && active && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        flush();
      }, 30_000);
    }
  }
}

export function recordRemoteTelemetry(type, fields = {}) {
  if (!active) return;
  load();
  queue.push({
    ...context(),
    ...fields,
    type,
    ts: Date.now(),
    clientId: clientId(),
  });
  if (queue.length > MAX_PENDING) queue = queue.slice(-MAX_PENDING);
  persist();
  if (queue.length >= 10 || type === 'remote_command') void flush();
}

export function noteRemoteBoothState(state) {
  if (!active) return;
  const now = Date.now();
  lastStateSuccess = now;
  lastBoothUpdate = Number(state?.updatedAt) || 0;
  lastStateVersion = Number.isSafeInteger(state?.stateVersion) ? state.stateVersion : null;
  lastRotationVersion = Number.isSafeInteger(state?.rotationVersion) ? state.rotationVersion : null;
  lastBoothSnapshot = state?.isRotationActive && Array.isArray(state.rotation)
    ? {
      rotation: state.rotation,
      currentDancerIndex: state.currentDancerIndex,
      rotationVersion: state.rotationVersion,
      receivedAt: now,
    }
    : null;
  // Polling is frequent; record a successful snapshot only once per minute.
  if (now - lastStateReport >= 60_000) {
    lastStateReport = now;
    recordRemoteTelemetry('remote_request', {
      endpoint: 'booth_state', result: 'ok',
      stateVersion: lastStateVersion, rotationVersion: lastRotationVersion,
    });
  }
}

export function shouldRecordRemoteFailure(endpoint, result, now = Date.now()) {
  const key = `${endpoint}:${result}`;
  const previous = lastFailure.get(key) || 0;
  if (now - previous < 15_000) return false;
  lastFailure.set(key, now);
  return true;
}

export function startRemoteTelemetry({ send, getContext, compareStage }) {
  load();
  transport = send;
  context = getContext;
  stageProbe = compareStage;
  active = true;
  const heartbeat = () => {
    const now = Date.now();
    recordRemoteTelemetry('remote_heartbeat', {
      stateAgeMs: lastStateSuccess ? Math.min(now - lastStateSuccess, 86_400_000) : undefined,
      boothAgeMs: lastBoothUpdate ? Math.min(Math.max(0, now - lastBoothUpdate), 86_400_000) : undefined,
      stateVersion: lastStateVersion,
      rotationVersion: lastRotationVersion,
    });
    void flush();
    if (lastBoothSnapshot && stageProbe) {
      void stageProbe(lastBoothSnapshot).then(comparison => {
        if (comparison) recordRemoteTelemetry('remote_stage_comparison', comparison);
      }).catch(() => {
        if (shouldRecordRemoteFailure('stage_current', 'network')) {
          recordRemoteTelemetry('remote_request', { endpoint: 'stage_current', result: 'network' });
        }
      });
    }
  };
  heartbeat();
  interval = setInterval(heartbeat, 60_000);
  return () => {
    active = false;
    clearInterval(interval);
    clearTimeout(retryTimer);
    interval = null;
    retryTimer = null;
  };
}