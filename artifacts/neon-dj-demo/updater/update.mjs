// NEON DJ demo updater — pulls the SAME code the fleet units run (GitHub main)
// and swaps it into the demo, touching NOTHING personal:
//   REPLACED: booth/server, booth/dist/public, this updater
//   UNTOUCHED: data/ (database, API keys, music, voiceovers), booth/node_modules,
//              runtime/, the Electron shell
// The demo stays OUT of the fleet: fleet/telegram/R2 behavior is controlled by
// environment settings the demo simply doesn't have, and this updater never adds them.
//
// Run via "Update NEON DJ.cmd" (uses the bundled runtime\node.exe). Close the
// demo window first — the updater refuses to run while the demo is open.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = 'jebjarrell1974-debug/dj-booth-rotation-system';
const BRANCH = 'main';
const DEMO_PORT = 3210;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(HERE, '..');            // demo root (folder with NEON DJ.exe)
const BOOTH = path.join(BASE, 'booth');

const log = (m) => console.log(m);
const die = (m) => { console.error('\n[X] ' + m); process.exit(1); };

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

async function assertDemoClosed() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    await fetch(`http://127.0.0.1:${DEMO_PORT}/api/boot-status`, { signal: ctrl.signal });
    clearTimeout(t);
    die('The demo appears to be RUNNING. Close the NEON DJ window first, then run this update again.');
  } catch { /* connection refused = demo closed = good */ }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) die(`Download failed (${res.status}) from ${url} — check your internet connection and try again.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100000) die('Downloaded file is suspiciously small — aborting, nothing was changed.');
  fs.writeFileSync(dest, buf);
  return buf.length;
}

function extract(zip, into) {
  fs.mkdirSync(into, { recursive: true });
  const attempts = [
    ['tar', ['-xf', zip, '-C', into]],                       // Windows 10+ bsdtar
    ['powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${into}' -Force`]],
    ['unzip', ['-q', '-o', zip, '-d', into]],                // Linux validation
  ];
  let done = false;
  for (const [cmd, args] of attempts) {
    try {
      execFileSync(cmd, args, { stdio: 'pipe' });
      if (fs.readdirSync(into).length > 0) { done = true; break; }
    } catch { /* try next */ }
  }
  if (!done) die('Could not unpack the download — aborting, nothing was changed.');
}

function swapIn(srcDir, liveDir, label) {
  const prev = liveDir + '.prev';
  rmrf(prev);
  if (fs.existsSync(liveDir)) fs.renameSync(liveDir, prev);   // keep one rollback copy
  fs.mkdirSync(path.dirname(liveDir), { recursive: true });
  fs.cpSync(srcDir, liveDir, { recursive: true });
  log(`  [ok] ${label} updated (previous version kept at ${path.basename(prev)})`);
  return prev;
}

function rollback(liveDir) {
  const prev = liveDir + '.prev';
  if (fs.existsSync(prev)) { rmrf(liveDir); fs.renameSync(prev, liveDir); }
}

(async () => {
  log('NEON DJ demo updater');
  log('====================');
  if (!fs.existsSync(BOOTH)) die(`Cannot find the demo's booth folder at ${BOOTH} — run this from inside the demo folder.`);
  await assertDemoClosed();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neondj-update-'));
  const zip = path.join(tmp, 'repo.zip');
  log('Downloading the latest fleet code...');
  const bytes = await download(`https://codeload.github.com/${REPO}/zip/refs/heads/${BRANCH}`, zip);
  log(`  [ok] ${(bytes / 1048576).toFixed(1)} MB`);

  log('Unpacking...');
  const ex = path.join(tmp, 'x');
  extract(zip, ex);
  const rootName = fs.readdirSync(ex).find(d => fs.statSync(path.join(ex, d)).isDirectory());
  if (!rootName) die('Unpack failed — aborting, nothing was changed.');
  const root = path.join(ex, rootName);

  const newServer = path.join(root, 'artifacts/api-server/server');
  const newDist = path.join(root, 'artifacts/dj-booth/dist/public');
  const newUpdater = path.join(root, 'artifacts/neon-dj-demo/updater');
  if (!fs.existsSync(path.join(newServer, 'index.js'))) die('Downloaded code is missing the server — aborting, nothing was changed.');
  if (!fs.existsSync(path.join(newDist, 'index.html'))) die('Downloaded code is missing the booth screen — aborting, nothing was changed.');

  // Dependency safety: if the new server needs a package this bundle doesn't
  // have, a blind update would leave the demo unable to start. Refuse instead.
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/api-server/package.json'), 'utf8'));
    const missing = Object.keys(pkg.dependencies || {})
      .filter(d => !fs.existsSync(path.join(BOOTH, 'node_modules', d)));
    if (missing.length) {
      die(`This update needs new components (${missing.join(', ')}) that this demo bundle doesn't carry.\n` +
          '    The demo needs a fresh bundle from the workshop — nothing was changed.');
    }
  } catch (e) { if (e && e.message && e.message.includes('nothing was changed')) throw e; }

  log('Installing (music, keys, and settings are untouched)...');
  const liveServer = path.join(BOOTH, 'server');
  const liveDist = path.join(BOOTH, 'dist/public');
  try {
    swapIn(newServer, liveServer, 'Booth server');
    swapIn(newDist, liveDist, 'Booth screen');
  } catch (e) {
    rollback(liveServer); rollback(liveDist);
    die('Install failed midway — rolled back to the previous version. Error: ' + e.message);
  }

  // Self-update the updater (new copy takes effect next run)
  try {
    if (fs.existsSync(path.join(newUpdater, 'update.mjs'))) {
      fs.copyFileSync(path.join(newUpdater, 'update.mjs'), path.join(HERE, 'update.mjs.new'));
      // Windows allows renaming over an already-read script file
      fs.renameSync(path.join(HERE, 'update.mjs.new'), path.join(HERE, 'update.mjs'));
    }
  } catch { /* non-fatal */ }

  rmrf(tmp);
  log('');
  log('=========================================');
  log('  UPDATE COMPLETE — demo matches the fleet');
  log('  Start NEON DJ normally. Keys, music, and');
  log('  settings are exactly as you left them.');
  log('=========================================');
})().catch(e => die(e.message || String(e)));
