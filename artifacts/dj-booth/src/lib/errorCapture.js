const ERROR_BUFFER_KEY = 'djbooth_error_buffer';
const MAX_BUFFER_SIZE = 200;
const FLUSH_INTERVAL_MS = 3 * 60 * 1000;
const APP_VERSION = '1.0.0';

let errorBuffer = [];
let flushInterval = null;
let deviceApiKey = null;
let fleetServerUrl = null;
let isInitialized = false;

function loadBufferedErrors() {
  try {
    const stored = localStorage.getItem(ERROR_BUFFER_KEY);
    if (stored) {
      errorBuffer = JSON.parse(stored);
      if (!Array.isArray(errorBuffer)) errorBuffer = [];
    }
  } catch {
    errorBuffer = [];
  }
}

function persistBuffer() {
  try {
    const trimmed = errorBuffer.slice(-MAX_BUFFER_SIZE);
    localStorage.setItem(ERROR_BUFFER_KEY, JSON.stringify(trimmed));
  } catch {}
}

function bufferError(level, component, message, stack = '') {
  const entry = {
    timestamp: Date.now(),
    level,
    component,
    message: String(message).slice(0, 2000),
    stack: String(stack || '').slice(0, 4000),
    app_version: APP_VERSION,
  };

  errorBuffer.push(entry);
  if (errorBuffer.length > MAX_BUFFER_SIZE) {
    errorBuffer = errorBuffer.slice(-MAX_BUFFER_SIZE);
  }
  persistBuffer();
}

async function flushErrors() {
  if (!deviceApiKey || !fleetServerUrl || errorBuffer.length === 0) return;

  const toSend = [...errorBuffer];
  errorBuffer = [];
  persistBuffer();

  try {
    const res = await fetch(`${fleetServerUrl}/api/fleet/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Key': deviceApiKey,
      },
      body: JSON.stringify({ logs: toSend }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      errorBuffer.unshift(...toSend);
      if (errorBuffer.length > MAX_BUFFER_SIZE) {
        errorBuffer = errorBuffer.slice(-MAX_BUFFER_SIZE);
      }
      persistBuffer();
    }
  } catch {
    errorBuffer.unshift(...toSend);
    if (errorBuffer.length > MAX_BUFFER_SIZE) {
      errorBuffer = errorBuffer.slice(-MAX_BUFFER_SIZE);
    }
    persistBuffer();
  }
}

function installGlobalHandlers() {
  const origError = console.error;
  const origWarn = console.warn;

  console.error = function (...args) {
    origError.apply(console, args);
    const message = args.map(a => {
      if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    }).join(' ');

    if (!message.includes('[errorCapture]') && !message.includes('ResizeObserver')) {
      bufferError('error', 'console', message);
    }
  };

  console.warn = function (...args) {
    origWarn.apply(console, args);
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    if (message.includes('⚠️ Server health') || message.includes('Preload failed')) {
      bufferError('warn', 'console', message);
    }
  };

  window.addEventListener('error', (event) => {
    bufferError(
      'error',
      'uncaught',
      event.message || 'Unknown error',
      event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    let message = 'Unhandled promise rejection';
    let stack = '';

    if (reason instanceof Error) {
      message = reason.message;
      stack = reason.stack || '';
    } else if (typeof reason === 'string') {
      message = reason;
    } else if (reason) {
      try { message = JSON.stringify(reason); } catch { message = String(reason); }
    }

    bufferError('error', 'unhandledRejection', message, stack);
  });

  window.addEventListener('beforeunload', () => {
    persistBuffer();
  });
}

let credentialCheckInterval = null;

function tryStartFlushing() {
  if (flushInterval) return true;
  if (!deviceApiKey) deviceApiKey = localStorage.getItem('fleet_device_api_key');
  if (!fleetServerUrl) fleetServerUrl = localStorage.getItem('fleet_server_url') || '';
  if (deviceApiKey && fleetServerUrl) {
    flushErrors();
    flushInterval = setInterval(flushErrors, FLUSH_INTERVAL_MS);
    if (credentialCheckInterval) {
      clearInterval(credentialCheckInterval);
      credentialCheckInterval = null;
    }
    return true;
  }
  return false;
}

export function initErrorCapture(config = {}) {
  if (isInitialized) return;
  isInitialized = true;

  if (config.deviceApiKey) deviceApiKey = config.deviceApiKey;
  if (config.fleetServerUrl) fleetServerUrl = config.fleetServerUrl;

  loadBufferedErrors();
  installGlobalHandlers();

  if (!tryStartFlushing()) {
    credentialCheckInterval = setInterval(tryStartFlushing, 30000);
  }

  bufferError('info', 'system', `App started v${APP_VERSION}`);
}

export function configureFleetConnection(serverUrl, apiKey) {
  fleetServerUrl = serverUrl;
  deviceApiKey = apiKey;
  localStorage.setItem('fleet_server_url', serverUrl);
  localStorage.setItem('fleet_device_api_key', apiKey);

  if (flushInterval) clearInterval(flushInterval);
  flushErrors();
  flushInterval = setInterval(flushErrors, FLUSH_INTERVAL_MS);
}

export function logError(component, message, stack) {
  bufferError('error', component, message, stack);
}

export function logWarn(component, message) {
  bufferError('warn', component, message);
}

export function logInfo(component, message) {
  bufferError('info', component, message);
}

export function getBufferedErrorCount() {
  return errorBuffer.length;
}

export function forceFlush() {
  return flushErrors();
}

export function stopErrorCapture() {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  if (credentialCheckInterval) {
    clearInterval(credentialCheckInterval);
    credentialCheckInterval = null;
  }
  persistBuffer();
}
