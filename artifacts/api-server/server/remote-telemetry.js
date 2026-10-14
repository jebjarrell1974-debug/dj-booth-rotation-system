// Only these fields may be written from a remote browser. Never pass through
// arbitrary client objects (request bodies, URLs, errors or authentication).
import { NORMAL_REMOTE_COMMANDS } from './booth-command-policy.js';
const TYPES = new Set(['remote_heartbeat', 'remote_request', 'remote_command', 'remote_stage_comparison']);
const ENDPOINTS = new Set([
  'music_tracks', 'music_select', 'booth_state', 'booth_command',
  'booth_receipt', 'stage_current', 'other',
]);
const RESULTS = new Set(['ok', 'http', 'network', 'timeout', 'abort', 'parse', 'unknown']);
const OUTCOMES = new Set(['applied', 'rejected', 'unknown']);
const VIEWS = new Set(['phone', 'desktop']);
const HOST_PATTERN = /^[a-zA-Z0-9.:-]{1,120}$/;

function integer(value, max) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max ? value : undefined;
}

export function sanitizeRemoteTelemetry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !TYPES.has(entry.type)) return null;
  const clean = { type: entry.type };
  if (VIEWS.has(entry.view)) clean.view = entry.view;
  for (const key of ['originHost', 'targetHost', 'configuredHost']) {
    if (typeof entry[key] === 'string' && HOST_PATTERN.test(entry[key])) clean[key] = entry[key];
  }
  if (typeof entry.clientId === 'string' && /^[a-zA-Z0-9-]{8,50}$/.test(entry.clientId)) clean.clientId = entry.clientId;
  for (const [key, max] of Object.entries({
    ts: 4_000_000_000_000, status: 599, durationMs: 120_000,
    count: 100_000, total: 1_000_000, stateAgeMs: 86_400_000,
    boothAgeMs: 86_400_000, stateVersion: 2_000_000_000,
    rotationVersion: 2_000_000_000, stageAgeMs: 86_400_000,
    boothIndex: 100_000, stageIndex: 100_000,
    rotationLength: 100_000, stageLength: 100_000,
  })) {
    const value = integer(entry[key], max);
    if (value !== undefined) clean[key] = value;
  }
  if (ENDPOINTS.has(entry.endpoint)) clean.endpoint = entry.endpoint;
  if (RESULTS.has(entry.result)) clean.result = entry.result;
  if (OUTCOMES.has(entry.outcome)) clean.outcome = entry.outcome;
  if (typeof entry.matches === 'boolean') clean.matches = entry.matches;
  if (NORMAL_REMOTE_COMMANDS.has(entry.action)) clean.action = entry.action;
  if (typeof entry.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(entry.requestId)) clean.requestId = entry.requestId;
  return clean;
}

// Prevent an accidentally looping client from filling the unit's disk.
const rates = new Map();
export function allowRemoteTelemetry(ip, count, now = Date.now()) {
  if (rates.size > 512) {
    for (const [key, value] of rates) if (now - value.since > 60_000) rates.delete(key);
  }
  const key = String(ip || 'unknown');
  let rate = rates.get(key);
  if (!rate || now - rate.since >= 60_000) rate = { since: now, count: 0 };
  if (rate.count + count > 240) return false;
  rate.count += count;
  rates.set(key, rate);
  return true;
}