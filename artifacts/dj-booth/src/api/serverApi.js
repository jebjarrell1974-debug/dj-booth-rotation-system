function getApiBase() {
  const boothTarget = localStorage.getItem('djbooth_booth_ip')?.trim();
  if (!boothTarget) return '/api';

  const targetHost = boothTarget
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/:\d+$/, '');
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const isSameHost = targetHost === currentHost;
  const isReplitHost = /\.(replit\.dev|repl\.co)$/i.test(targetHost);

  if (isSameHost || isReplitHost) return '/api';
  if (boothTarget) return `http://${targetHost}:3001/api`;
  return '/api';
}

function setBoothIp(ip) {
  if (ip) {
    localStorage.setItem('djbooth_booth_ip', ip.trim());
  } else {
    localStorage.removeItem('djbooth_booth_ip');
  }
}

function getBoothIp() {
  return localStorage.getItem('djbooth_booth_ip') || '';
}

function getToken() {
  return localStorage.getItem('djbooth_token');
}

function setToken(token) {
  localStorage.setItem('djbooth_token', token);
}

function clearToken() {
  localStorage.removeItem('djbooth_token');
  sessionStorage.removeItem('djbooth_role');
  sessionStorage.removeItem('djbooth_dancer_id');
  sessionStorage.removeItem('djbooth_dancer_name');
  sessionStorage.removeItem('djbooth_remote');
  sessionStorage.removeItem('djbooth_phone_remote');
}

function setSessionInfo(data) {
  if (data.token) setToken(data.token);
  if (data.role) sessionStorage.setItem('djbooth_role', data.role);
  if (data.dancerId) sessionStorage.setItem('djbooth_dancer_id', data.dancerId);
  if (data.dancerName) sessionStorage.setItem('djbooth_dancer_name', data.dancerName);
  if (data.remote) {
    sessionStorage.setItem('djbooth_remote', 'true');
  } else {
    sessionStorage.removeItem('djbooth_remote');
  }
}

function isRemoteMode() {
  if (sessionStorage.getItem('djbooth_remote') === 'true') return true;
  if (typeof window === 'undefined') return false;

  // Fail closed for audio authority: the physical kiosk loads the app through
  // loopback. Any browser reaching the unit through a LAN IP/hostname is a
  // command-only remote even after a restored tab, direct /DJBooth bookmark,
  // or lost sessionStorage marker. A remote browser must never mount AudioEngine.
  const host = window.location.hostname.toLowerCase();
  return !['localhost', '127.0.0.1', '::1'].includes(host);
}

function isPhoneRemoteMode() {
  return isRemoteMode() && sessionStorage.getItem('djbooth_phone_remote') === 'true';
}

function setPhoneRemoteMode(enabled) {
  if (enabled) sessionStorage.setItem('djbooth_phone_remote', 'true');
  else sessionStorage.removeItem('djbooth_phone_remote');
}

function getSessionInfo() {
  return {
    token: getToken(),
    role: sessionStorage.getItem('djbooth_role'),
    dancerId: sessionStorage.getItem('djbooth_dancer_id'),
    dancerName: sessionStorage.getItem('djbooth_dancer_name'),
  };
}

let _tokenOverride = null;
function setTokenOverride(token) { _tokenOverride = token; }
function getTokenOverride() { return _tokenOverride; }

const DJ_PATHS = ['/booth/', '/settings/', '/auth/', '/dancers', '/rotation', '/health', '/admin/'];

async function apiFetch(path, options = {}) {
  const isDJPath = DJ_PATHS.some(p => path.startsWith(p));
  const usingOverride = !!_tokenOverride && !isDJPath;
  const token = (usingOverride ? _tokenOverride : null) || getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const res = await fetch(`${getApiBase()}${path}`, { ...options, headers });
  
  if (res.status === 401) {
    if (usingOverride) {
      _tokenOverride = null;
      window.dispatchEvent(new Event('djbooth-dancer-session-expired'));
    } else {
      const currentToken = getToken();
      if (currentToken === null || token === currentToken) {
        clearToken();
        window.dispatchEvent(new Event('djbooth-session-expired'));
      }
    }
    throw new Error('Session expired');
  }
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    const error = new Error(err.error || 'Request failed');
    error.status = res.status;
    error.details = err;
    throw error;
  }
  
  return res.json();
}

export const auth = {
  hasDjPin: () => apiFetch('/auth/session').catch(() => null),
  checkDjPinExists: () => apiFetch('/settings/has-dj-pin'),
  initDjPin: (pin) => apiFetch('/settings/dj-pin/init', { method: 'POST', body: JSON.stringify({ pin }) }),
  login: (role, pin) => apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ role, pin }) }),
  logout: () => apiFetch('/auth/logout', { method: 'POST' }).catch(() => {}),
  checkSession: () => apiFetch('/auth/session'),
  ping: () => apiFetch('/auth/ping', { method: 'POST' }),
  changeDjPin: (pin) => apiFetch('/settings/dj-pin', { method: 'POST', body: JSON.stringify({ pin }) }),
};

export const dancersApi = {
  list: () => apiFetch('/dancers'),
  create: (data) => apiFetch('/dancers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => apiFetch(`/dancers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id) => apiFetch(`/dancers/${id}`, { method: 'DELETE' }),
};

export const playlistApi = {
  get: () => apiFetch('/playlist'),
  update: (playlist) => apiFetch('/playlist', { method: 'PUT', body: JSON.stringify({ playlist }) }),
};

export const songsApi = {
  list: () => apiFetch('/songs'),
  sync: (songs) => apiFetch('/songs/sync', { method: 'POST', body: JSON.stringify({ songs }) }),
};

export const musicApi = {
  getTracks: ({ page = 1, limit = 100, search = '', genre = '' } = {}) =>
    apiFetch(`/music/tracks?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&genre=${encodeURIComponent(genre)}`),
  getGenres: () => apiFetch('/music/genres'),
};

export const djOptionsApi = {
  get: () => apiFetch('/dj-options'),
  update: (options) => apiFetch('/dj-options', { method: 'PUT', body: JSON.stringify(options) }),
};

export const zoneProApi = {
  getStatus: () => apiFetch("/zonepro/status"),
  getSettings: () => apiFetch("/zonepro/settings"),
  saveSettings: (settings) => apiFetch("/zonepro/settings", { method: "POST", body: JSON.stringify(settings) }),
  discover: () => apiFetch("/zonepro/discover", { method: "POST" }),
  testConnection: () => apiFetch("/zonepro/test", { method: "POST" }),
  readConfiguration: () => apiFetch("/zonepro/read", { method: "POST" }),
  planConfiguration: (configuration, expectedRevision, current) => apiFetch("/zonepro/plan", { method: "POST", body: JSON.stringify({ configuration, expectedRevision, current }) }),
  applyConfiguration: ({ planId, confirmationToken }) => apiFetch("/zonepro/apply", { method: "POST", body: JSON.stringify({ planId, confirmationToken }) }),
  listSnapshots: () => apiFetch("/zonepro/snapshots"),
  importSnapshot: (snapshot) => apiFetch("/zonepro/snapshots/import", { method: "POST", body: JSON.stringify(snapshot) }),
  restoreSnapshot: ({ snapshotId, planId, confirmationToken }) => apiFetch(`/zonepro/snapshots/${snapshotId}/restore`, { method: "POST", body: JSON.stringify({ planId, confirmationToken }) }),
  control: ({ zoneId, action, value, requestId }) => apiFetch("/zonepro/control", { method: "POST", body: JSON.stringify({ zoneId, action, value, requestId }) }),
};

export const boothApi = {
  getState: () => apiFetch('/booth/state'),
  postState: (state) => apiFetch('/booth/state', { method: 'POST', body: JSON.stringify(state) }),
  getCommand: (commandId) => apiFetch(`/booth/command/${commandId}`),
  sendCommand: async (action, payload = {}, options = {}) => {
    const requestId = options.requestId || (
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const submitted = await apiFetch('/booth/command', {
      method: 'POST',
      body: JSON.stringify({
        action,
        payload,
        requestId,
        expectedRotationVersion: options.expectedRotationVersion,
        expectedStateVersion: options.expectedStateVersion,
        nowPlayingGuard: options.nowPlayingGuard,
      }),
    });
    if (!submitted.queued) {
      if (!submitted.ok) throw new Error(submitted.command?.error || 'The kiosk did not apply the command');
      return submitted;
    }

    const timeoutMs = options.timeoutMs ?? 35_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const receipt = await boothApi.getCommand(submitted.commandId);
      if (receipt.queued) continue;
      if (!receipt.ok) {
        const error = new Error(receipt.command?.error || 'The kiosk rejected the command');
        error.details = receipt;
        throw error;
      }
      return receipt;
    }
    const error = new Error('The kiosk did not confirm that the command was applied');
    error.code = 'BOOTH_COMMAND_TIMEOUT';
    throw error;
  },
  getCommands: (since = 0) => apiFetch(`/booth/commands?since=${since}`),
  claimCommand: (commandId) => apiFetch('/booth/commands/claim', {
    method: 'POST',
    body: JSON.stringify({ commandId }),
  }),
  ackCommand: (commandId, result = {}) => apiFetch('/booth/commands/ack', {
    method: 'POST',
    body: JSON.stringify({ commandId, ...result }),
  }),
  ackCommands: (upToId) => apiFetch('/booth/commands/ack', {
    method: 'POST',
    body: JSON.stringify({ commandId: upToId }),
  }),
};

export function connectBoothSSE(onMessage) {
  const token = getToken();
  if (!token) return null;
  
  const url = `${getApiBase()}/booth/events?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  let failCount = 0;
  
  es.onmessage = (event) => {
    try {
      failCount = 0;
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch {}
  };
  
  es.onerror = () => {
    es.close();
    failCount++;
    if (failCount > 5) {
      apiFetch('/auth/session').catch(() => {});
      failCount = 0;
    }
    const delay = Math.min(3000 * failCount, 15000);
    setTimeout(() => {
      if (!getToken()) return;
      const reconnected = connectBoothSSE(onMessage);
      if (reconnected) {
        onMessage({ type: 'reconnected', eventSource: reconnected });
      }
    }, delay);
  };
  
  return es;
}

export { getToken, setToken, clearToken, setSessionInfo, getSessionInfo, isRemoteMode, isPhoneRemoteMode, setPhoneRemoteMode, setBoothIp, getBoothIp, setTokenOverride, getTokenOverride };
