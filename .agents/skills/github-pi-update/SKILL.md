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
2. Push to GitHub (use the script above)
3. SSH into Pi and run `~/djbooth-update.sh`

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
