import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  closeSync,
  existsSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GENERATOR_PATH = join(__dirname, 'generate-generic-voiceovers.js');
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'djbooth.db');
const LOCK_PATH = `${DB_PATH}.regular-generic-refresh.lock`;
const LOCK_MAX_AGE_MS = 30 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 15 * 60 * 1000;
let refreshChild = null;

function releaseLock() {
  try {
    if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
  } catch (err) {
    console.error(`⚠️ Could not release generic voiceover refresh lock: ${err.message}`);
  }
}

function acquireLock() {
  try {
    const fd = openSync(LOCK_PATH, 'wx');
    writeFileSync(fd, `${process.pid}\n${Date.now()}\n`);
    closeSync(fd);
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') {
      console.error(`⚠️ Could not acquire generic voiceover refresh lock: ${err.message}`);
      return false;
    }

    try {
      if (Date.now() - statSync(LOCK_PATH).mtimeMs > LOCK_MAX_AGE_MS) {
        unlinkSync(LOCK_PATH);
        return acquireLock();
      }
    } catch {}
    return false;
  }
}

// Only the production fleet service may spend ElevenLabs credits at boot.
// Replit/local development and ad-hoc server runs must never generate paid
// audio merely by importing or booting the API server.
export function startGenericVoiceoverRefresh() {
  if (process.env.NODE_ENV !== 'production') return null;
  if (process.env.DISABLE_GENERIC_VOICEOVER_REFRESH === '1') return null;
  if (refreshChild && refreshChild.exitCode === null) return refreshChild.pid;
  if (!acquireLock()) {
    console.log('ℹ️ Generic voiceover startup refresh already running; skipping overlap');
    return null;
  }

  try {
    const child = spawn(process.execPath, [GENERATOR_PATH, '--startup'], {
      env: process.env,
      stdio: 'inherit',
    });
    refreshChild = child;

    const timeout = setTimeout(() => {
      console.error(`❌ Generic voiceover startup refresh exceeded ${REFRESH_TIMEOUT_MS / 60000} minutes; stopping it`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 5000).unref();
    }, REFRESH_TIMEOUT_MS);
    timeout.unref();

    child.once('error', (err) => {
      clearTimeout(timeout);
      console.error(`❌ Generic voiceover startup refresh failed to start: ${err.message}`);
      refreshChild = null;
      releaseLock();
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      refreshChild = null;
      releaseLock();
      if (code === 0) {
        console.log('✅ Generic voiceover startup refresh completed');
      } else {
        console.error(`❌ Generic voiceover startup refresh exited with ${code ?? `signal ${signal}`}`);
      }
    });
    return child.pid;
  } catch (err) {
    refreshChild = null;
    releaseLock();
    console.error(`❌ Generic voiceover startup refresh failed: ${err.message}`);
    return null;
  }
}