const API_BASE = '/api';

function getToken() {
  return sessionStorage.getItem('djbooth_token');
}

function setToken(token) {
  sessionStorage.setItem('djbooth_token', token);
}

function clearToken() {
  sessionStorage.removeItem('djbooth_token');
  sessionStorage.removeItem('djbooth_role');
  sessionStorage.removeItem('djbooth_dancer_id');
  sessionStorage.removeItem('djbooth_dancer_name');
  sessionStorage.removeItem('djbooth_remote');
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
  return sessionStorage.getItem('djbooth_remote') === 'true';
}

function getSessionInfo() {
  return {
    token: getToken(),
    role: sessionStorage.getItem('djbooth_role'),
    dancerId: sessionStorage.getItem('djbooth_dancer_id'),
    dancerName: sessionStorage.getItem('djbooth_dancer_name'),
  };
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event('djbooth-session-expired'));
    throw new Error('Session expired');
  }
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
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

export const boothApi = {
  getState: () => apiFetch('/booth/state'),
  postState: (state) => apiFetch('/booth/state', { method: 'POST', body: JSON.stringify(state) }),
  sendCommand: (action, payload = {}) => apiFetch('/booth/command', { method: 'POST', body: JSON.stringify({ action, payload }) }),
  getCommands: (since = 0) => apiFetch(`/booth/commands?since=${since}`),
  ackCommands: (upToId) => apiFetch('/booth/commands/ack', { method: 'POST', body: JSON.stringify({ upToId }) }),
};

export function connectBoothSSE(onMessage) {
  const token = getToken();
  if (!token) return null;
  
  const url = `${API_BASE}/booth/events?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  
  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch {}
  };
  
  es.onerror = () => {
    es.close();
    setTimeout(() => {
      const reconnected = connectBoothSSE(onMessage);
      if (reconnected) {
        onMessage({ type: 'reconnected', eventSource: reconnected });
      }
    }, 3000);
  };
  
  return es;
}

export { getToken, setToken, clearToken, setSessionInfo, getSessionInfo, isRemoteMode };
