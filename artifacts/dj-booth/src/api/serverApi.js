import { reconcileCommandOutcome } from '@/utils/commandReconcile';
import { withRequestDeadline } from '@/utils/requestDeadline';
import { runBoothCommand } from '@/utils/boothCommandFlow';
import {
  noteRemoteBoothState, recordRemoteTelemetry, shouldRecordRemoteFailure,
  startRemoteTelemetry as startTelemetry,
} from '@/utils/remoteTelemetry';

function telemetryEndpoint(path) {
  if (path.startsWith('/music/tracks')) return 'music_tracks';
  if (path.startsWith('/music/select')) return 'music_select';
  if (path === '/booth/state') return 'booth_state';
  if (path === '/booth/command') return 'booth_command';
  if (path.startsWith('/booth/commands/')) return 'booth_receipt';
  return 'other';
}

function telemetryFailure(error) {
  if (Number.isInteger(error?.status)) return 'http';
  if (error?.code === 'REQUEST_TIMEOUT' || error?.code === 'BOOTH_COMMAND_TIMEOUT') return 'timeout';
  if (error?.name === 'AbortError') return 'abort';
  if (error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT') return 'timeout';
  if (error instanceof SyntaxError) return 'parse';
  return 'network';
}

export function startRemoteTelemetry(view) {
  if (!isRemoteMode()) return () => {};
  const getContext = () => {
    const apiBase = getApiBase();
    let targetHost = 'unknown';
    let configuredHost = 'unset';
    try { targetHost = new URL(apiBase, window.location.href).hostname; } catch {}
    try {
      const configured = getBoothIp();
      if (configured) configuredHost = new URL(
        /^https?:\/\//i.test(configured) ? configured : `http://${configured}`,
      ).hostname;
    } catch {}
    return {
      view: isPhoneRemoteMode() ? 'phone' : view,
      originHost: window.location.hostname, targetHost, configuredHost,
    };
  };
  return startTelemetry({
    getContext,
    compareStage: async (booth) => {
      const { originHost, targetHost } = getContext();
      if (originHost !== targetHost || Date.now() - booth.receivedAt > 15_000) return null;
      const response = await fetch('/api/stage/current', {
        cache: 'no-store', signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error('Stage unavailable');
      const stage = await response.json();
      const boothId = booth.rotation[booth.currentDancerIndex];
      const stageId = stage?.rotation_order?.[stage?.current_dancer_index];
      return {
        matches: boothId != null && stageId != null && String(boothId) === String(stageId),
        boothIndex: booth.currentDancerIndex, stageIndex: stage?.current_dancer_index,
        rotationLength: booth.rotation.length, stageLength: stage?.rotation_order?.length,
        stageAgeMs: Number.isFinite(stage?.syncedAt)
          ? Math.min(Math.max(0, Date.now() - stage.syncedAt), 86_400_000) : undefined,
        rotationVersion: Number.isSafeInteger(booth.rotationVersion) ? booth.rotationVersion : undefined,
      };
    },
    // Same origin, not getApiBase(): if the saved target is wrong, 005 must
    // still receive the remote's report when the browser can reach its page.
    send: async (entries) => {
      const res = await fetch('/api/diag/remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`Diagnostics HTTP ${res.status}`);
    },
  });
}

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

// Separate, target-scoped browser-session drafts. Never use kiosk planning
// localStorage for remote editor recovery.
export function rotationEditorSessionKey() {
  return `neonaidj_remote_rotation_edits:${getApiBase()}`;
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

const DJ_PATHS = ['/booth/', '/settings/', '/auth/', '/dancers', '/rotation', '/health', '/admin/', '/staff', '/audit/', '/dj-options'];

// A browser fetch has no default timeout. On a half-open connection - an AP roam, a
// NAT idle-drop, a router reboot, a wedged server socket - the promise can stay pending
// for minutes or forever. Every caller here runs on a 1 s poll cadence, so an unbounded
// request is what turns a brief network event into a stuck booth.
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;

async function apiFetch(path, options = {}) {
  const isDJPath = DJ_PATHS.some(p => path.startsWith(p));
  const usingOverride = !!_tokenOverride && !isDJPath;
  const token = options.authToken ?? ((usingOverride ? _tokenOverride : null) || getToken());
  const { authToken, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, signal: callerSignal, ...fetchOptions } = options;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // The deadline covers the ENTIRE operation - headers, body and parse. `fetch`
  // resolving only means headers arrived; a stalled body would otherwise hang forever
  // with the timer already cleared.
  const start = Date.now();
  const endpoint = telemetryEndpoint(path);
  try {
  const result = await withRequestDeadline({ timeoutMs, signal: callerSignal, label: path }, async (signal) => {
  const res = await fetch(`${getApiBase()}${path}`, { ...fetchOptions, headers, signal });
  
  // A rejected new login is not evidence that the existing session expired.
  // Switching identities must retain the current operator when a code is wrong.
  const submittingCredentials = path === '/auth/login' || path === '/settings/dj-pin/init';
  if (res.status === 401 && !submittingCredentials) {
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
    const expired = new Error('Session expired');
    expired.status = 401;          // the server answered; this is not a transport failure
    throw expired;
  }
  
  if (!res.ok) {
    // Read inside the deadline: an error body can stall exactly like a success body.
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    const error = new Error(err.error || 'Request failed');
    error.status = res.status;
    error.details = err;
    throw error;
  }
  
  return await res.json();
  });
  if (endpoint === 'booth_state') noteRemoteBoothState(result?.state ?? result);
  if (endpoint === 'music_tracks' || endpoint === 'music_select') {
    recordRemoteTelemetry('remote_request', {
      endpoint, result: 'ok', durationMs: Math.min(Date.now() - start, 120_000),
      count: Array.isArray(result?.tracks) ? result.tracks.length : 0,
      total: Number.isSafeInteger(result?.total) ? result.total : undefined,
    });
  }
  return result;
  } catch (error) {
    const result = telemetryFailure(error);
    if (shouldRecordRemoteFailure(endpoint, result)) {
      recordRemoteTelemetry('remote_request', {
        endpoint, result, status: error?.status,
        durationMs: Math.min(Date.now() - start, 120_000),
      });
    }
    throw error;
  }
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
  get: (options = {}) => apiFetch('/playlist', options),
  update: (playlist, { token } = {}) => apiFetch('/playlist', {
    method: 'PUT', body: JSON.stringify({ playlist }), authToken: token,
  }),
};

export const staffApi = {
  list: () => apiFetch('/staff'),
  create: data => apiFetch('/staff', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => apiFetch(`/staff/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: id => apiFetch(`/staff/${id}`, { method: 'DELETE' }),
  audit: () => apiFetch('/audit/log?limit=40'),
};

export const songsApi = {
  list: () => apiFetch('/songs'),
  sync: (songs) => apiFetch('/songs/sync', { method: 'POST', body: JSON.stringify({ songs }) }),
};

export const musicApi = {
  availableNames: (names, options = {}) => apiFetch('/music/availability', { ...options, method: 'POST', body: JSON.stringify({ names }) }),
  getTracks: ({ page = 1, limit = 100, search = '', genre = '' } = {}, options = {}) =>
    apiFetch(`/music/tracks?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&genre=${encodeURIComponent(genre)}`, options),
  getGenres: () => apiFetch('/music/genres'),
  selectTracks: ({ count = 2, excludeNames = [], genres = [], dancerPlaylist = [], strictPlaylist = false, automatic = false } = {}) =>
    apiFetch('/music/select', {
      method: 'POST',
      body: JSON.stringify({ count, excludeNames, genres, dancerPlaylist, strictPlaylist, automatic }),
    }),
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
  postState: (state) => {
    // State is a publication from the physical kiosk, never a remote editor
    // write. Keep this guard at the transport boundary as well as in the
    // publisher effect so a legacy/accidental caller cannot reset booth state.
    if (isRemoteMode()) {
      return Promise.reject(new Error('Only the physical kiosk may publish booth state'));
    }
    return apiFetch('/booth/state', { method: 'POST', body: JSON.stringify(state) });
  },
  getCommand: (commandId, options = {}) => apiFetch(`/booth/command/${commandId}`, options),

    // Find out what actually happened to a command whose outcome is unknown.
    //
    // READ ONLY. Discovering an outcome must never be able to create a second command,
    // so there is no POST here at all - the server exposes an actor-scoped lookup by the
    // original requestId for exactly this purpose. A missing record or a restarted
    // server stays "unknown"; nothing is ever replayed.
    reconcileCommand: (context, { timeoutMs = 8_000, settleMs = 20_000 } = {}) =>
      reconcileCommandOutcome({
        lookupByRequestId: async (rid) => {
          try {
            return await apiFetch(`/booth/command/by-request/${encodeURIComponent(rid)}`, { timeoutMs });
          } catch (error) {
            if (error?.status === 404) return null;
            throw error;
          }
        },
        getReceiptById: async (id) => {
          try {
            return await apiFetch(`/booth/command/${id}`, { timeoutMs });
          } catch (error) {
            if (error?.status === 404) return null;
            throw error;
          }
        },
        getServerEpoch: async () => {
          const snapshot = await apiFetch('/booth/state', { timeoutMs });
          return (snapshot?.state ?? snapshot)?.stateEpoch ?? null;
        },
      }, { ...context, settleMs }),
  sendCommand: async (action, payload = {}, options = {}) => {
    const requestId = options.requestId || (
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    // Everything needed to find out what happened if this call does not complete.
    // Captured NOW, at send time - not when recovery starts. The epoch identifies the
    // server instance this command was given to; after a restart nothing it says can
    // be tied back to this submission.
    const identity = {
      requestId, action, payload,
      submittedAt: Date.now(),
      serverEpochAtSend: options.stateEpoch ?? null,
    };
    options.onIdentity?.(identity);
    const started = Date.now();
    try {
    const result = await runBoothCommand({
      submit: () => apiFetch('/booth/command', {
        method: 'POST',
        body: JSON.stringify({
          action,
          payload,
          requestId,
          expectedRotationVersion: options.expectedRotationVersion,
          expectedStateVersion: options.expectedStateVersion,
          nowPlayingGuard: options.nowPlayingGuard,
        }),
      }),
      getReceipt: (commandId, receiptOptions) => boothApi.getCommand(commandId, receiptOptions),
      identity,
      timeoutMs: options.timeoutMs ?? 35_000,
    });
    recordRemoteTelemetry('remote_command', {
      action, requestId, outcome: 'applied',
      durationMs: Math.min(Date.now() - started, 120_000),
    });
    return result;
    } catch (error) {
      recordRemoteTelemetry('remote_command', {
        action, requestId,
        outcome: error?.rejectedByServer ? 'rejected' : 'unknown',
        result: error?.rejectedByServer ? 'unknown' : telemetryFailure(error),
        status: error?.status,
        durationMs: Math.min(Date.now() - started, 120_000),
      });
      throw error;
    }
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
  if (!getToken()) return null;

  // The failure count lives here, across reconnect attempts. Previously it was a local
  // of each call and every reconnect created a fresh closure starting at 0, so the
  // backoff never grew past the first step and the `failCount > 5` session re-check was
  // unreachable - during a long outage the booth re-opened a stream every 3 s forever.
  const state = { failCount: 0, closed: false, timer: null, es: null };

  const open = () => {
    if (state.closed) return null;
    const token = getToken();
    if (!token) return null;
    const es = new EventSource(`${getApiBase()}/booth/events?token=${encodeURIComponent(token)}`);
    state.es = es;

    es.onmessage = (event) => {
      try {
        state.failCount = 0;
        onMessage(JSON.parse(event.data));
      } catch {}
    };

    es.onerror = () => {
      es.close();
      if (state.closed) return;
      state.failCount++;
      if (state.failCount > 5) {
        apiFetch('/auth/session').catch(() => {});
        state.failCount = 0;
      }
      const delay = Math.min(3000 * state.failCount, 15000);
      state.timer = setTimeout(() => {
        state.timer = null;
        if (state.closed || !getToken()) return;
        if (open()) onMessage({ type: 'reconnected', eventSource: handle });
      }, delay);
    };
    return es;
  };

  // Returned in place of the raw EventSource so that closing the view also cancels any
  // reconnect already scheduled. Without this, a pending timer reopened a stream for a
  // view that had gone away.
  const handle = {
    get readyState() { return state.es?.readyState ?? 2; },
    close() {
      state.closed = true;
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      state.es?.close();
    },
  };

  return open() ? handle : null;
}

export { getToken, setToken, clearToken, setSessionInfo, getSessionInfo, isRemoteMode, isPhoneRemoteMode, setPhoneRemoteMode, setBoothIp, getBoothIp, setTokenOverride, getTokenOverride };
