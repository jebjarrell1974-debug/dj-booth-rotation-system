---
name: github-pi-update
description: Push code to GitHub and update Raspberry Pi units via GitHub. Use when deploying changes to Pi hardware, pushing code backups, or when the user asks to update the Pi.
---

# GitHub-Based Pi Update System

Since Replit deployment has a platform-level routing issue (404 on all requests despite server running), we use GitHub as the distribution channel for Pi updates.

## GitHub Repository

- **Repo**: https://github.com/jebjarrell1974-debug/dj-booth-rotation-system
- **Visibility**: Public (so Pis can download without auth tokens)
- **Branch**: main

## Pushing Code to GitHub

Run this from the Replit workspace to push all current files to GitHub:

```bash
cd /home/runner/workspace && node -e "
const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '.local', 'voiceovers', '.cache', '.config', 'attached_assets', '.upm']);
const IGNORE_FILES = new Set(['.env', '.env.local']);
const IGNORE_EXT = new Set(['.db', '.db-wal', '.db-shm', '.log']);

function getAllFiles(dir, base = '') {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) results = results.concat(getAllFiles(path.join(dir, entry.name), relPath));
    } else {
      if (!IGNORE_FILES.has(entry.name) && !IGNORE_EXT.has(path.extname(entry.name))) {
        const stat = fs.statSync(path.join(dir, entry.name));
        if (stat.size < 5 * 1024 * 1024) results.push(relPath);
      }
    }
  }
  return results;
}

async function main() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY ? 'repl ' + process.env.REPL_IDENTITY : process.env.WEB_REPL_RENEWAL ? 'depl ' + process.env.WEB_REPL_RENEWAL : null;
  const resp = await fetch('https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github', { headers: { 'Accept': 'application/json', 'X-Replit-Token': xReplitToken } });
  const data = await resp.json();
  const conn = data.items?.[0];
  const token = conn?.settings?.access_token || conn?.settings?.oauth?.credentials?.access_token;
  const octokit = new Octokit({ auth: token });
  const owner = 'jebjarrell1974-debug', repo = 'dj-booth-rotation-system';

  const { data: ref } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
  const baseSha = ref.object.sha;
  const { data: baseCommit } = await octokit.git.getCommit({ owner, repo, commit_sha: baseSha });

  const files = getAllFiles('.');
  console.log('Pushing ' + files.length + ' files...');
  const tree = [];
  for (const file of files) {
    const content = fs.readFileSync(file);
    const isBinary = content.some(b => b === 0);
    const { data: blob } = await octokit.git.createBlob({ owner, repo, content: content.toString(isBinary ? 'base64' : 'utf8'), encoding: isBinary ? 'base64' : 'utf-8' });
    tree.push({ path: file, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const { data: treeData } = await octokit.git.createTree({ owner, repo, tree, base_tree: baseCommit.tree.sha });
  const { data: commit } = await octokit.git.createCommit({ owner, repo, message: 'COMMIT_MESSAGE_HERE', tree: treeData.sha, parents: [baseSha] });
  await octokit.git.updateRef({ owner, repo, ref: 'heads/main', sha: commit.sha });
  console.log('DONE');
}
main().catch(e => console.error(e.message));
"
```

Replace `COMMIT_MESSAGE_HERE` with a descriptive message.

## Pi Update Commands

### First-time setup (one command on each Pi):

```bash
curl -o ~/djbooth-update.sh https://raw.githubusercontent.com/jebjarrell1974-debug/dj-booth-rotation-system/main/public/djbooth-update-github.sh && chmod +x ~/djbooth-update.sh
```

### To update a Pi:

```bash
~/djbooth-update.sh
```

The script: downloads from GitHub, backs up current install, copies server + config files, builds frontend with Vite, installs dependencies, restarts systemd service, auto-rolls back on failure. Keeps last 3 backups.

## Workflow

1. Make changes in Replit
2. **If ANY frontend file changed (anything in `artifacts/dj-booth/src/` or its config/assets), you MUST rebuild dist before pushing.** The Dell's update script does NOT run Vite — it serves the pre-built `artifacts/dj-booth/dist/public/` straight from GitHub. Skipping this step is the #1 cause of "I pushed the change but the screen didn't update."
3. Push to GitHub (use the script above for source, plus the dist push below if frontend changed)
4. SSH into Pi and run `~/djbooth-update.sh`

### Rebuilding the frontend dist (REQUIRED for any frontend change)

Server-only changes (`artifacts/api-server/`) → skip this section.

Frontend changes (`artifacts/dj-booth/src/`, vite configs, public assets, index.html) → run these:

```bash
cd /home/runner/workspace/artifacts/dj-booth && npx vite build --config homebase-vite.config.js
```

Use `homebase-vite.config.js`, NOT `vite.config.ts`. The Replit config requires PORT/BASE_PATH env vars and produces a build with the wrong base path for the Dell.

Then push the rebuilt dist to GitHub (replaces stale hashed asset files):

```bash
cd /home/runner/workspace/artifacts/api-server && node -e "
const { Octokit } = require('@octokit/rest');
const fs = require('fs'); const path = require('path');
const ROOT = '/home/runner/workspace';
function walk(dir, base = '') {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(abs, rel));
    else out.push({ rel, abs });
  }
  return out;
}
async function main() {
  const o = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const owner = 'jebjarrell1974-debug', repo = 'dj-booth-rotation-system';
  const distPrefix = 'artifacts/dj-booth/dist';
  const { data: ref } = await o.git.getRef({ owner, repo, ref: 'heads/main' });
  const baseSha = ref.object.sha;
  const { data: baseCommit } = await o.git.getCommit({ owner, repo, commit_sha: baseSha });
  const { data: fullTree } = await o.git.getTree({ owner, repo, tree_sha: baseCommit.tree.sha, recursive: 'true' });
  const existing = fullTree.tree.filter(t => t.type === 'blob' && t.path.startsWith(distPrefix + '/')).map(t => t.path);
  const local = walk(ROOT + '/artifacts/dj-booth/dist').map(f => ({ ...f, ghPath: distPrefix + '/' + f.rel }));
  const localSet = new Set(local.map(f => f.ghPath));
  const tree = [];
  for (const f of local) {
    const c = fs.readFileSync(f.abs);
    const bin = c.some(b => b === 0) || /\\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf)\$/i.test(f.abs);
    const { data: blob } = await o.git.createBlob({ owner, repo, content: bin ? c.toString('base64') : c.toString('utf8'), encoding: bin ? 'base64' : 'utf-8' });
    tree.push({ path: f.ghPath, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (const p of existing) if (!localSet.has(p)) tree.push({ path: p, mode: '100644', type: 'blob', sha: null });
  const { data: nt } = await o.git.createTree({ owner, repo, tree, base_tree: baseCommit.tree.sha });
  const { data: nc } = await o.git.createCommit({ owner, repo, message: 'COMMIT_MESSAGE_HERE', tree: nt.sha, parents: [baseSha] });
  await o.git.updateRef({ owner, repo, ref: 'heads/main', sha: nc.sha });
  console.log('DONE', nc.sha);
}
main().catch(e => { console.error(e.message); process.exit(1); });
"
```

Replace `COMMIT_MESSAGE_HERE`. This script uploads all files in the local dist, deletes orphaned hashed assets in GitHub (so they don't pile up), and is safe to re-run.

### Quick decision table

| Files you changed | Rebuild dist? | Push to GitHub? |
|---|---|---|
| `artifacts/api-server/**`             | No  | Yes (source) |
| `artifacts/dj-booth/src/**`           | YES | Yes (source + dist) |
| `artifacts/dj-booth/index.html`       | YES | Yes (source + dist) |
| `artifacts/dj-booth/*.config.*`       | YES | Yes (source + dist) |
| `artifacts/dj-booth/public/**`        | YES | Yes (source + dist) |
| Pi shell scripts / autostart configs  | No  | Yes (source)    |

## Environment Variables (on Pi)

| Variable | Default | Purpose |
|---|---|---|
| `DJBOOTH_GITHUB_REPO` | `jebjarrell1974-debug/dj-booth-rotation-system` | GitHub repo |
| `DJBOOTH_APP_DIR` | `/home/<user>/djbooth` | Local app directory |
| `DJBOOTH_SERVICE` | `djbooth` | Systemd service name |
| `DJBOOTH_BRANCH` | `main` | Git branch to pull |

## Important Notes

- GitHub repo must stay **public** for Pis to download without auth
- Push to GitHub at end of each working session
- The update script is at `public/djbooth-update-github.sh` in the project
- Replit deployment is broken at the platform level (persistent 404) — use GitHub instead
