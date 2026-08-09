// Assembles the portable Windows demo folder + ZIP, entirely from Linux.
// No wine, no installers. Output: dist-demo/NEON-DJ-Demo-win64.zip
//
// Folder layout produced (see main.cjs for how it is consumed):
//   NEON DJ/
//     NEON DJ.exe + electron runtime files
//     resources/app/{main.cjs,package.json}
//     booth/{server,dist/public,node_modules,package.json}
//     runtime/node.exe
//     ffmpeg/ffmpeg.exe
//     README.txt
import { execSync } from 'child_process';
import { mkdirSync, rmSync, cpSync, writeFileSync, existsSync, readFileSync, renameSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DL = path.join(__dirname, 'downloads');
const OUT = path.join(__dirname, 'dist-demo');
const APPDIR = path.join(OUT, 'NEON DJ');

const ELECTRON_VERSION = JSON.parse(readFileSync(path.join(__dirname, 'node_modules/electron/package.json'), 'utf8')).version;
// MUST match the Node that runs `npm install` below — prebuild-install picks
// the native-module ABI from the RUNNING node, not from any target flag.
// Mismatch = better-sqlite3 refuses to load on the laptop and the server dies.
const NODE_VERSION = process.version.slice(1);

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

function download(url, dest) {
  if (existsSync(dest)) { console.log('cached:', path.basename(dest)); return; }
  console.log('downloading:', url);
  sh(`curl -fL --retry 3 -o '${dest}.part' '${url}' && mv '${dest}.part' '${dest}'`);
}

mkdirSync(DL, { recursive: true });
rmSync(APPDIR, { recursive: true, force: true });
mkdirSync(APPDIR, { recursive: true });

// ---- 1. Electron win32-x64 ----
const electronZip = path.join(DL, `electron-v${ELECTRON_VERSION}-win32-x64.zip`);
download(`https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-win32-x64.zip`, electronZip);
sh(`unzip -q -o '${electronZip}' -d '${APPDIR}'`);
renameSync(path.join(APPDIR, 'electron.exe'), path.join(APPDIR, 'NEON DJ.exe'));
rmSync(path.join(APPDIR, 'resources', 'default_app.asar'), { force: true });

// ---- 2. Shell app ----
const appRes = path.join(APPDIR, 'resources', 'app');
mkdirSync(appRes, { recursive: true });
cpSync(path.join(__dirname, 'main.cjs'), path.join(appRes, 'main.cjs'));
writeFileSync(path.join(appRes, 'package.json'), JSON.stringify({ name: 'neon-dj-demo', version: '1.0.0', main: 'main.cjs' }, null, 2));

// ---- 3. Booth server + UI dist ----
const booth = path.join(APPDIR, 'booth');
mkdirSync(booth, { recursive: true });
cpSync(path.join(ROOT, 'artifacts/api-server/server'), path.join(booth, 'server'), { recursive: true });
cpSync(path.join(ROOT, 'artifacts/dj-booth/dist/public'), path.join(booth, 'dist/public'), { recursive: true });
writeFileSync(path.join(booth, 'package.json'), JSON.stringify({ name: 'neon-dj-demo-booth', type: 'module', private: true }, null, 2));

// Updater: one double-click pulls the same GitHub code the fleet runs
cpSync(path.join(__dirname, 'updater', 'update.mjs'), path.join(APPDIR, 'updater', 'update.mjs'));
cpSync(path.join(__dirname, 'updater', 'Update-NEON-DJ.cmd'), path.join(APPDIR, 'Update NEON DJ.cmd'));

// ---- 4. Windows node_modules for the server (win32-x64 prebuilds, no compile) ----
const nmStage = path.join(DL, 'win-node-modules');
const apiPkg = JSON.parse(readFileSync(path.join(ROOT, 'artifacts/api-server/package.json'), 'utf8'));
const NEEDED = ['express', 'compression', 'better-sqlite3', 'bcryptjs', '@aws-sdk/client-s3'];
const deps = Object.fromEntries(NEEDED.map(d => [d, apiPkg.dependencies[d]]));
const stampFile = path.join(nmStage, '.deps.json');
const depsJson = JSON.stringify({ node: process.version, deps });
if (!existsSync(stampFile) || readFileSync(stampFile, 'utf8') !== depsJson) {
  rmSync(nmStage, { recursive: true, force: true });
  mkdirSync(nmStage, { recursive: true });
  writeFileSync(path.join(nmStage, 'package.json'), JSON.stringify({ name: 'booth-win-deps', private: true, dependencies: deps }, null, 2));
  sh(`npm install --omit=dev --no-audit --no-fund --force`, {
    cwd: nmStage,
    env: {
      ...process.env,
      npm_config_platform: 'win32',
      npm_config_arch: 'x64',
      npm_config_os: 'win32',
      npm_config_cpu: 'x64',
      npm_config_build_from_source: 'false'
    }
  });
  writeFileSync(stampFile, depsJson);
}
// Sanity: better-sqlite3 must contain a Windows binary, not a Linux one.
const bsDir = path.join(nmStage, 'node_modules/better-sqlite3');
const found = execSync(`find '${bsDir}' -name '*.node' | head -5`).toString().trim();
if (!found) throw new Error('better-sqlite3: no prebuilt .node binary found — Windows prebuild download failed');
const fileInfo = execSync(`file ${found.split('\n').map(f => `'${f}'`).join(' ')}`).toString();
if (!/PE32\+|MS Windows/.test(fileInfo)) throw new Error(`better-sqlite3 binary is not a Windows PE:\n${fileInfo}`);
console.log('better-sqlite3 win binary OK:', fileInfo.trim());
cpSync(path.join(nmStage, 'node_modules'), path.join(booth, 'node_modules'), { recursive: true });

// ---- 5. Node.js runtime for Windows ----
const nodeZip = path.join(DL, `node-v${NODE_VERSION}-win-x64.zip`);
download(`https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`, nodeZip);
const nodeTmp = path.join(DL, 'node-unzip');
rmSync(nodeTmp, { recursive: true, force: true });
sh(`unzip -q '${nodeZip}' -d '${nodeTmp}'`);
mkdirSync(path.join(APPDIR, 'runtime'), { recursive: true });
cpSync(path.join(nodeTmp, `node-v${NODE_VERSION}-win-x64`, 'node.exe'), path.join(APPDIR, 'runtime', 'node.exe'));

// ---- 6. FFmpeg for Windows (BtbN static build, ffmpeg.exe + ffprobe.exe only) ----
const ffZip = path.join(DL, 'ffmpeg-win64.zip');
download('https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip', ffZip);
const ffTmp = path.join(DL, 'ffmpeg-unzip');
rmSync(ffTmp, { recursive: true, force: true });
sh(`unzip -q '${ffZip}' -d '${ffTmp}'`);
const ffRoot = path.join(ffTmp, readdirSync(ffTmp)[0], 'bin');
mkdirSync(path.join(APPDIR, 'ffmpeg'), { recursive: true });
cpSync(path.join(ffRoot, 'ffmpeg.exe'), path.join(APPDIR, 'ffmpeg', 'ffmpeg.exe'));
cpSync(path.join(ffRoot, 'ffprobe.exe'), path.join(APPDIR, 'ffmpeg', 'ffprobe.exe'));

// ---- 7. README ----
writeFileSync(path.join(APPDIR, 'README.txt'), `NEON DJ — Portable Demo
=======================

1. Keep this whole folder together (do not move individual files out of it).
2. Double-click "NEON DJ.exe" to start. First start takes a few seconds.
3. Make a desktop shortcut: right-click "NEON DJ.exe" -> Send to -> Desktop.
4. Your music: drop MP3 folders into  data\\music  (one folder per genre),
   then use the rescan button in the Library tab.
5. Your OpenAI + ElevenLabs keys: open  data\\api-keys.txt  in Notepad
   (the file appears after the first launch), paste each key after its
   = sign, save, and restart NEON DJ. No typing inside the app needed.
   The keys never leave this folder.
6. Everything the app writes stays inside the "data" folder. To uninstall,
   delete this folder. To back up the demo, copy this folder.

If the app will not start, check  data\\server.log  for details.
`);

// ---- 8. Zip ----
mkdirSync(OUT, { recursive: true });
const zipPath = path.join(OUT, 'NEON-DJ-Demo-win64.zip');
rmSync(zipPath, { force: true });
sh(`cd '${OUT}' && zip -q -r 'NEON-DJ-Demo-win64.zip' 'NEON DJ'`);
console.log('\nDONE:', zipPath);
sh(`du -sh '${APPDIR}' '${zipPath}'`);
