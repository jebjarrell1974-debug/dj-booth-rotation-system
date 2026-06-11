---
name: Stale self-updating updater loop
description: Why a unit with disabled auto-update fails every update run identically, and the one-line fix to break the loop.
---

# Stale `~/djbooth-update.sh` cannot fix itself

**Symptom:** A unit whose auto-update was disabled (left on an old code/script version) runs `bash ~/djbooth-update.sh` and it FAILS — and re-running fails *identically* every time. Tell-tale: the run is missing all the hardening log lines (`Using homebase-package.json`, `Removed preinstall guard`, `All critical packages verified present`, `Pre-built frontend already in place`, `[openbox]/[display] labwc`) and instead hits the pnpm preinstall guard (`Use pnpm instead`) → npm install aborts → it prunes runtime packages (notably `express`/`vite`) → service fails to start → auto-rollback.

**Root cause:** The *self-update-of-self* logic (download the latest updater from GitHub raw, overwrite `$HOME/djbooth-update.sh`, re-exec) was added to the script LATER. An OLD local copy predates it, so it downloads only the new *app tarball* and keeps running its own stale build logic on it. It never replaces itself → the loop never breaks by re-running.

**Fix (break the loop manually):** curl the current updater straight from GitHub raw over the local copy, then run it:
```
curl -fsSL "https://raw.githubusercontent.com/jebjarrell1974-debug/dj-booth-rotation-system/main/artifacts/dj-booth/public/public/djbooth-update-github.sh" -o ~/djbooth-update.sh && chmod +x ~/djbooth-update.sh
```
Confirm it's the right one with `wc -l ~/djbooth-update.sh` (current hardened version was ~1252 lines) before running `DJBOOTH_SKIP_HOMEBASE=1 bash ~/djbooth-update.sh`. Once the correct script is in place its own self-update + re-exec works (you'll see `Update script self-updated from GitHub` → `Re-executing with new script version...` → it restarts from [1/8]; this is NORMAL and good).

**While recovering, if the failed runs already pruned express** (booth down / crash-loop), restore in place without a wipe:
```
cd ~/djbooth && NODE_ENV=development npm install --legacy-peer-deps && sudo systemctl restart djbooth && sleep 8 && curl -sf http://localhost:3001/__health && echo BOOTH_OK || echo STILL_DOWN
```

**Why this matters / tradeoff:** Keeping a unit on manual-only auto-update (the 003 protected-unit policy) is what causes this drift. If a unit is left manual, it must be updated manually every so often (after a clean night on 002) or it drifts so far that the on-disk updater can't self-heal and you're stuck doing the manual curl above at 3 AM.
