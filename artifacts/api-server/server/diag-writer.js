import { existsSync, mkdirSync, appendFileSync, readdirSync, readFileSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DIAG_DIR = process.env.DIAG_LOG_PATH || join(homedir(), 'djbooth', 'diag');
const RETENTION_DAYS = 30;
const MAX_ENTRY_BYTES = 4096;

let dirReady = false;
function ensureDir() {
  if (dirReady) return true;
  try {
    if (!existsSync(DIAG_DIR)) mkdirSync(DIAG_DIR, { recursive: true });
    dirReady = true;
    return true;
  } catch (err) {
    console.error('[diag-writer] mkdir failed:', err.message);
    return false;
  }
}

function dateStamp(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentLogFile() {
  return join(DIAG_DIR, `diag-${dateStamp()}.jsonl`);
}

let lastRetentionRun = 0;
function runRetentionMaybe() {
  const now = Date.now();
  if (now - lastRetentionRun < 6 * 60 * 60 * 1000) return;
  lastRetentionRun = now;
  try {
    const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = readdirSync(DIAG_DIR);
    for (const f of files) {
      if (!f.startsWith('diag-') || !f.endsWith('.jsonl')) continue;
      const p = join(DIAG_DIR, f);
      try {
        const s = statSync(p);
        if (s.mtimeMs < cutoff) unlinkSync(p);
      } catch {}
    }
  } catch {}
}

export function appendDiagEntry(entry, sourceMeta = {}) {
  if (!ensureDir()) return false;
  const enriched = {
    ts: entry.ts || Date.now(),
    serverTs: Date.now(),
    type: entry.type || 'unknown',
    ...sourceMeta,
    ...entry,
  };
  let line;
  try {
    line = JSON.stringify(enriched);
  } catch {
    return false;
  }
  if (line.length > MAX_ENTRY_BYTES) line = line.slice(0, MAX_ENTRY_BYTES) + '"}';
  try {
    appendFileSync(currentLogFile(), line + '\n');
    runRetentionMaybe();
    return true;
  } catch (err) {
    console.error('[diag-writer] append failed:', err.message);
    return false;
  }
}

export function appendDiagBatch(entries, sourceMeta = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  if (!ensureDir()) return 0;
  let count = 0;
  const lines = [];
  const serverTs = Date.now();
  for (const entry of entries) {
    const enriched = {
      ts: entry.ts || serverTs,
      serverTs,
      type: entry.type || 'unknown',
      ...sourceMeta,
      ...entry,
    };
    try {
      let line = JSON.stringify(enriched);
      if (line.length > MAX_ENTRY_BYTES) line = line.slice(0, MAX_ENTRY_BYTES) + '"}';
      lines.push(line);
      count++;
    } catch {}
  }
  if (lines.length === 0) return 0;
  try {
    appendFileSync(currentLogFile(), lines.join('\n') + '\n');
    runRetentionMaybe();
    return count;
  } catch (err) {
    console.error('[diag-writer] batch append failed:', err.message);
    return 0;
  }
}

export function readRecentDiag(maxLines = 500) {
  if (!ensureDir()) return [];
  let files;
  try {
    files = readdirSync(DIAG_DIR)
      .filter(f => f.startsWith('diag-') && f.endsWith('.jsonl'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const content = readFileSync(join(DIAG_DIR, f), 'utf8');
      const lines = content.split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        out.push(lines[i]);
        if (out.length >= maxLines) return out.reverse();
      }
    } catch {}
  }
  return out.reverse();
}

export function getDiagDir() {
  return DIAG_DIR;
}
