---
name: session-history
description: Complete reference of all decisions, fixes, discoveries, and working configurations from past chat sessions. Read this when starting a new session or migrating to a new Repl.
---

# Session History & Reference

## Critical Rules (Do NOT Break These)
- **AudioEngine.jsx** — NEVER modify audio behavior (crossfade, ducking, volume levels are finalized). The `loadTrack` method accepts both URL strings and FileSystemFileHandle objects.
- **Server default port is 3001** — Pi kiosk browser connects to `localhost:3001`. Do NOT change this default.
- **Pi browser binary is `chromium`** (not `chromium-browser`) on Raspberry Pi OS Bookworm.
- **Database path**: Production uses `/home/runner/data/djbooth.db` (outside project dir to survive republishing). Dev uses `./djbooth.db`. Configurable via `DB_PATH` env var.
- **Default master PIN**: `36669`

## Confirmed Fleet Devices (4 active units — scaling to 50+ within 6 months)

| Unit | Username | Tailscale IP | Role | Club | Notes |
|---|---|---|---|---|---|
| Homebase | `homebase` | `100.95.238.71` | Fleet server + DJ booth | Homebase | Fleet server lives HERE |
| neonaidj001 | `neonaidj001` | `100.115.212.34` | DJ booth | Pony Nation | Music path: `/home/neonaidj001/djbooth/music/` |
| neonaidj002 | `neonaidj002` | unknown | DJ booth | Unknown | Previously missing from records — confirmed Mar 16, 2026 |
| neonaidj003 | `neonaidj003` | `100.81.90.125` | DJ booth | Unknown (needs CLUB_NAME set) | Had 4 crashes Mar 10 — stable since |

**Fleet .env rules:**
- Homebase: `FLEET_SERVER_URL=http://localhost:3001` (reports to itself)
- All venue Pis: `FLEET_SERVER_URL=http://100.95.238.71:3001`
- Fleet dashboard: `http://100.95.238.71:3001/fleet` (any Tailscale device)

**PENDING on neonaidj003:**
- SSH in and set `CLUB_NAME=<correct venue name>` in `~/djbooth/.env`, then `sudo systemctl restart djbooth`
- Run `~/djbooth-update.sh` to pull latest code

**PENDING on all 4 units:**
- Run `~/djbooth-update.sh` to pull latest commit (warm EQ + air band + BPM + lazy pre-cache)
- aubio-tools will auto-install on first update run if not already present

**FUTURE TODO (approved, not yet built):**
- Fix #5: Pre-build dist/ on homebase, ship compiled output to venue Pis instead of
  running `vite build` on the Pi. Add show-active guard to block updates mid-show.

## Architecture Summary

### Development (Replit)
- Express server on port 3001: `PORT=3001 node server/index.js`
- Vite dev server on port 5000: proxies `/api` calls to port 3001
- Workflow: `PORT=3001 node server/index.js & sleep 2 && vite --host 0.0.0.0 --port 5000`

### Production (Pi)
- Express serves both API and built frontend from `dist/public/`
- Runs as systemd service `djbooth` on port 3001
- Music scanned from `MUSIC_PATH` env var (default: `/home/<user>/Desktop/DJ MUSIC`)
- Chromium kiosk auto-starts via `~/.config/autostart/djbooth-kiosk.desktop`

### Pi Hardware Details
- Raspberry Pi 5, Raspberry Pi OS Bookworm
- Username pattern: `neonaidj001`, `neonaidj002`, etc.
- App directory: `/home/<user>/djbooth`
- Data directory: `/home/<user>/data/` (database)
- Music directory: `/home/<user>/Desktop/DJ MUSIC` — **synced to/from R2** (`music/` prefix in bucket). Music IS shared across fleet via R2
- Promo Beds directory: `/home/<user>/Desktop/DJ MUSIC/PROMO BEDS/` — instrumental tracks for AI promo mixing. Synced to R2 like all other music
- Voiceover directory: `/home/<user>/djbooth/voiceovers` (inside app dir, survives updates, R2 syncs to/from here)

## GitHub Backup System
- **Repo**: https://github.com/jebjarrell1974-debug/dj-booth-rotation-system (PUBLIC)
- **Push method**: Uses Replit GitHub integration + @octokit/rest API (can't use git commands directly in Replit)
- **Pi update**: `~/djbooth-update.sh` — downloads from GitHub, builds, restarts service
- **First-time Pi setup**: `curl -o ~/djbooth-update.sh https://raw.githubusercontent.com/jebjarrell1974-debug/dj-booth-rotation-system/main/public/djbooth-update-github.sh && chmod +x ~/djbooth-update.sh`
- See `github-pi-update` skill for full push script

## Replit Deployment Issue (UNRESOLVED)
- Every deployment returns 404 even though server starts and healthcheck passes internally
- Tested with: autoscale, VM, minimal 1-line server, multiple port configs
- Root cause: Replit platform-level routing issue, not application code
- The `.replit` file must have ONLY ONE `[[ports]]` entry — multiple entries break deployment
- Replit container takes 6+ seconds cold start, exceeding 5-second healthcheck timeout
- **Workaround**: Using GitHub as distribution channel instead of Replit deployment
- **Fix**: Create a fresh Repl (clean deployment state) or contact Replit Support

---

## Mar 11, 2026 — Session 40 (Stale Pre-Pick Bug Fix — commit `8b28779`)

### Root Cause Discovered: rotationSongs persisted in localStorage
**Bug**: `rotationSongs` (pre-picked songs for each dancer) was saved to and loaded from `localStorage`. On every fresh rotation start, `beginRotation` checked `rotationSongsRef.current` and if it found songs there (from a previous session), it used them directly — no playlist check, no cooldown check, no server call. This caused dancers to play random library songs from the previous session instead of their current playlist songs.

**Evidence from logs**: LILY's first set played `05-Twista So Sexy` and `07-Jagged Edge Let's Get Married` — neither of which are in her 7-song playlist. After that set, `getDancerTracks` was called fresh (stale songs consumed) and correctly returned playlist songs.

**Fix**: In `startRotation` (before the `isPlaying` check so it covers both immediate-start and pending-start paths):
```javascript
rotationSongsRef.current = {};
setRotationSongs({});
```
This clears stale pre-picks so `beginRotation` always calls `getDancerTracks` fresh for every dancer at rotation start.

**File**: `src/pages/DJBooth.jsx` — `startRotation` function (lines ~1716-1720)

**Commit**: `8b28779` — "Fix: clear stale localStorage pre-picks on rotation start"

**All 4 units need `~/djbooth-update.sh`** to pull this fix.

---

## CURRENT STATUS (as of Session 45 — March 19, 2026) — READ THIS FIRST

### What is working
- Fleet heartbeat: 1-min interval, 3-min offline timeout, homebase is the fleet server
- Play history pipeline: `djbooth_token` stored in `localStorage` (not `sessionStorage`), survives reboots
- Voiceover system: 5-variation, true-random (V11), stale IDB auto-cleanup on load, generic fallbacks
- **Variant no-repeat rules (Session 45)**: outro→intro transition never shares same variant number; intro and outro within one dancer's set always use different numbers
- **Corruption guard (Session 45)**: `validateAudioBlob()` decode-validates before caching (3 attempts); playback failure auto-purges IDB + server entry and regenerates
- All 4 units report to homebase fleet server (`100.95.238.71:3001`)
- LUFS background analyzer: runs at boot (5s delay), FFmpeg analysis-only, -10 LUFS club target, 3 concurrent, stores in DB
- Fleet manifest enriched with `auto_gain` values; venue Pis get gain values on next sync
- AudioEngine: pre-populated gain cache from server values (skips 10s browser analysis when gain available)
- Playlist panel orange cooldown: dancer's personal playlist now shows orange icon+text for recently played songs; cooldown is **6 hours** (updated from 4h in Session 44)
- Watchdog smart recovery: tries current dancer's playlist first, logs failed songs to `playback_errors` table
- **Boot update confirmed working on neonaidj001**: `@reboot` cron fires `DJBOOTH_BOOT_UPDATE=1 ~/djbooth-update.sh >> ~/djbooth-boot.log 2>&1` — confirmed running on two separate reboots (log shows "Running as boot service" both times)
- **HDMI-2 rotation display confirmed working on neonaidj001**: `chromium --kiosk --class=RotationChromium` + labwc windowRule `MoveToOutput HDMI-A-2` — confirmed window appears on HDMI-2
- **labwc autostart** auto-launches rotation display 8 seconds after boot and runs watcher for "Open Display" button
- **Fleet music deletion sync (Session 44)**: homebase deletions propagate to all Pis on next R2 sync; purge skips if R2 returns zero files (safety guard)
- **Break song queue controls (Session 44)**: "Up Next" break song panel has ↑/↓ move, ↻ swap, ✕ remove per song
- **WiFi IP display (Session 44)**: Configuration page highlights WiFi IP in blue labeled "WiFi — use this for iPad"

### Boot Update Mechanism (CONFIRMED WORKING — DO NOT CHANGE)
**Belt + suspenders on every venue Pi:**
1. **`djbooth-update.service`** (systemd) — `After=network.target`, `StandardOutput=journal`, `TimeoutStartSec=600`
   - Check: `systemctl status djbooth-update` / `journalctl -u djbooth-update --no-pager | tail -20`
2. **`@reboot` cron** (backup) — fires 45s after boot, writes to `~/djbooth-boot.log`
   - Check: `sudo cat ~/djbooth-boot.log` — look for fresh timestamp and "Update complete!"
   - Log owned by root (cron runs as root on some Pi configs) — always use `sudo cat`
- Both installed automatically by running `~/djbooth-update.sh` on the Pi
- **Key marker in log**: `Running as boot service — skipping restart` = cron fired correctly
- **`$USER` is empty in cron context** — script uses `$(whoami)` instead (fixed commit `c45371c`)
- **Homebase skips boot service setup**: `IS_HOMEBASE=true` in env skips the service/cron install — homebase does NOT auto-update on boot

### HDMI-2 Rotation Display (CONFIRMED WORKING — DO NOT CHANGE)
- **labwc window rule**: `~/.config/labwc/rc.xml` — `<windowRule identifier="RotationChromium">` + `<action name="MoveToOutput" output="HDMI-A-2"/>` + `<action name="Maximize"/>`
- **Chromium class**: `--class=RotationChromium` sets Wayland app_id correctly (verified via WAYLAND_DEBUG=1)
- **Critical**: chromium MUST be launched from within the Wayland session (terminal on Pi desktop, or labwc autostart) — server process has no Wayland access and cannot launch it directly
- **labwc autostart** (`~/.config/labwc/autostart`):
  ```bash
  wlr-randr --output HDMI-A-2 --transform 90 &
  sleep 8
  rm -rf /tmp/chromium-rotation
  chromium --kiosk --class=RotationChromium --user-data-dir=/tmp/chromium-rotation --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required http://localhost:3001/RotationDisplay &
  (while true; do
    if [ -f /tmp/djbooth-display-trigger ]; then
      rm -f /tmp/djbooth-display-trigger
      pkill -f "RotationChromium" 2>/dev/null || true
      sleep 1
      rm -rf /tmp/chromium-rotation
      chromium --kiosk --class=RotationChromium --user-data-dir=/tmp/chromium-rotation --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required http://localhost:3001/RotationDisplay &
      disown
    fi
    sleep 2
  done) &
  ```
- **"Open Display" button**: `POST /api/display/launch` → server writes `/tmp/djbooth-display-trigger` → watcher detects → re-launches chromium on HDMI-2
- **Manual launch from terminal** (if needed): `pkill -f RotationChromium 2>/dev/null; sleep 1; rm -rf /tmp/chromium-rotation; chromium --kiosk --class=RotationChromium --user-data-dir=/tmp/chromium-rotation --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required http://localhost:3001/RotationDisplay &`

### New API endpoints
- `GET /api/music/lufs-status` — returns `{ total, analyzed, withGain, pending, isRunning, progress }` (requires auth)
- `POST /api/music/analyze` — manually triggers LUFS background analysis (requires DJ auth)
- `POST /api/display/launch` — writes `/tmp/djbooth-display-trigger` to signal watcher (requires auth)

### AudioEngine notes (CRITICAL — do not change behavior)
- `AUTO_GAIN_TARGET_LUFS = -10` (changed from -14; -10 is club standard)
- `loadTrack` accepts `{ url, name, auto_gain }` — if `auto_gain` present, pre-populates `autoGainCacheRef` so `analyzeTrackLoudness` returns immediately from cache; no 10s fetch+analyze
- Log line: `🔊 AutoGain: pre-loaded server gain=X.XXx for SONGNAME`

### Outstanding TODOs
- **neonaidj003**: SSH in, set `CLUB_NAME=<venue name>` in `~/djbooth/.env`, then `sudo systemctl restart djbooth`
- **neonaidj001**: Set `DEVICE_ID=neonaidj001` in `~/djbooth/.env` (fleet heartbeat identification)
- **neonaidj002**: Tailscale IP still unknown — check fleet dashboard
- **Homebase-aware update script**: Skip Chrome kill/relaunch when `IS_HOMEBASE=true` in env
- **USB SSD music library on homebase**: Mount 1TB exFAT SSD at fixed path, update homebase `MUSIC_PATH`
- **Venue Pi fleet error key**: Each venue Pi needs `FLEET_DEVICE_KEY=<api key from registration>` in `~/djbooth/.env`
- **Commercial ducking bug (DEFERRED)**: Post-commercial intro block uses `autoDuck: false` — should be `autoDuck: true`. One-line fix in `DJBooth.jsx` post-commercial intro `playAnnouncement` call. User deferred.
- **Fleet WiFi static IP plan**: Same SSID/subnet across all venues; static `192.168.88.100` on each Pi's `wlan0` via `/etc/dhcpcd.conf`. iPad enters IP once, works everywhere. Not yet implemented.
- **All venue Pis need `~/djbooth-update.sh`** to pull Sessions 44+45 fixes

### Context Reset Prevention
- **ALWAYS** keep this SKILL.md updated at the end of every session
- **ALWAYS** push changes to GitHub before session ends (commit ID + short description)
- If context is lost, the scratchpad at the top of the next session summary + this file is the full recovery source

---

## Mar 19, 2026 — Session 45 (Voiceover Variant Rules + Corruption Guard)

### Feature: Variant No-Repeat Rules (commit `48480e9`)
**Two new rules enforced in `getNextVariationNum` in `AnnouncementSystem.jsx`:**

**Rule 1 — No matching numbers across transitions:**
After outro v3 plays, the next intro (regardless of dancer) cannot be v3. And vice versa — after an intro plays, the immediately following outro avoids the same number.

**Rule 2 — No matching numbers within one set:**
When Dancer A's intro is picked as v2, her outro for that same set cannot be v2.

**Implementation:**
- Added `lastPlayedTypeVariantRef = useRef({ intro: 0, outro: 0, round2: 0 })` — tracks last played variant number per type globally
- Added `currentSetIntroVariantRef = useRef({})` — tracks intro variant per dancer name for current set
- `getNextVariationNum` builds an `avoid` Set (last-for-this-key + cross-type + set-pairing), picks randomly from remaining candidates; fallback to just avoiding direct repeat if pool empties
- `lastPlayedTypeVariantRef[type]` updated on every pick; `currentSetIntroVariantRef[dancerName]` set on every intro pick
- **File**: `src/components/dj/AnnouncementSystem.jsx`

### Feature: Voiceover Corruption Guard (commit `80bccdd`)
**Root cause:** ElevenLabs occasionally returns a corrupted audio blob (bad header / truncated). Once cached, the same broken file plays every time, producing a "backward/slow" audio artifact. User had to manually delete files during the show.

**Option 2 — Decode validation before caching:**
- Added `validateAudioBlob(blob)` at module level: checks `blob.size >= 5000` then runs `AudioContext.decodeAudioData()`. Closes context in `finally`. Returns true/false.
- After `generateAudio(script)`, loops up to 3 attempts: if blob fails validation, logs warning and calls `generateAudio` again. After 3 failures, throws (existing fallback chain handles it). Only a passing blob reaches `cacheToIndexedDB` / `saveToServer`.
- **Pi CPU impact**: negligible — only runs during new generation (already a 1–5s API wait), takes ~50–200ms, temporary ~3–4MB peak RAM.

**Option 3 — Auto-purge and regenerate on playback failure:**
- Added `deleteFromIndexedDB(key)` at module level: opens IDB readwrite transaction, deletes entry by key, resolves on complete or error.
- In `playAnnouncement`, wrapped `onPlay?.(result.url, audioOptions)` in inner try/catch. On failure: constructs `cacheKey`, calls `deleteFromIndexedDB(cacheKey)` + `DELETE /api/voiceovers/:cacheKey` (fire-and-forget), then regenerates via `getOrGenerateAnnouncement` and plays fresh. If retry also fails, logs and skips silently — music continues.
- **Pi CPU impact**: zero in normal path (try/catch has no cost unless thrown). On corrupt-file recovery, brief network + generation overhead — acceptable since it's error recovery.

**Files**: `src/components/dj/AnnouncementSystem.jsx` only

---

## Mar 19, 2026 — Session 44 (Break Song Controls + Commercial Fix + Cooldown + Fleet Sync + WiFi Display)

### Feature: Break Song Queue Controls (commit `fc9c93c`)
- "Up Next" break song panel now has per-song buttons: ↑ move up, ↓ move down, ↻ swap with random, ✕ remove
- **File**: UI component handling the break song queue in DJBooth

### Fix: Commercial Stop Bug (commit `57ddd30`)
- **Bug**: Commercial counter wasn't advancing every dancer transition — it only triggered when `isCommercialDue()` returned true inside `handleSkip` / `handleTrackEnd`, so skipped commercials didn't clear properly
- **Fix**: Removed `isCommercialDue()` guard in both handlers — counter now increments on every dancer transition. Skip list clears itself correctly.
- **File**: `src/pages/DJBooth.jsx`

### Fix: 6-Hour Cooldown + Random Fallback (commit `343082e`)
- Cooldown updated from 4 → 6 hours in all 5 places in the codebase
- When a dancer's playlist is fully on cooldown (all songs played within last 6h), server now picks random library songs respecting the active genre folder instead of replaying cooldown tracks
- **File**: `src/pages/DJBooth.jsx`, `server/db.js` (cooldown threshold)

### Feature: Fleet Music Deletion Sync (commit `a4b687a`)
- Added `deleteMusicTrackByPath(path)` to `server/db.js`
- `syncMusicFromR2` in `server/r2sync.js` now purges local files that are no longer in R2 — with safety guard: purge is skipped entirely if R2 returns zero files (prevents wiping library on R2 API failure)
- Homebase deletions now propagate to all venue Pis on next sync or reboot
- **Files**: `server/db.js`, `server/r2sync.js`

### Feature: WiFi IP Display (commit `f55b987`)
- Configuration page "Remote Connection" section now identifies network interfaces by type:
  - `wlan*` → highlighted blue, labeled "WiFi — use this for iPad"
  - `eth*` / `en*` → labeled "Ethernet"
  - Tailscale range → labeled "Tailscale"
- **File**: `src/pages/Configuration.jsx`

---

## Mar 16, 2026 — Session 43 (Boot Update + HDMI-2 Display — CONFIRMED WORKING)

### Boot Update — Confirmed Working
- Replaced broken `djbooth-boot.service` (never installed) with belt+suspenders approach
- `djbooth-update.service` (systemd, `After=network.target`, `StandardOutput=journal`) + `@reboot` cron backup
- Cron writes to `~/djbooth-boot.log` — confirmed firing on two separate reboots on neonaidj001
- Fixed `$USER` empty in cron context → now uses `$(whoami)` throughout (commit `c45371c`)
- Both installed by running `~/djbooth-update.sh` once on the Pi

### HDMI-2 Rotation Display — Confirmed Working
- `chromium --kiosk --class=RotationChromium` + labwc `MoveToOutput HDMI-A-2` window rule confirmed working
- labwc autostart fires 8 seconds after boot to auto-launch rotation display on HDMI-2
- Watcher loop in labwc autostart handles "Open Display" button via `/tmp/djbooth-display-trigger`
- Server writes trigger file → watcher detects within 2s → re-launches chromium on HDMI-2
- Key insight: chromium must be launched FROM the Wayland session — server process cannot do it

### Commits This Session
- `367a968` — trigger-file display launch approach
- `6172efe` — restore auto-launch on boot + watcher
- `69d803` — belt+suspenders boot update (service + cron)
- `c45371c` — fix $USER empty in cron context (use whoami)

---

## Mar 15, 2026 — Session 41 (LUFS Normalization + Playlist Cooldown Color — COMPLETE)

### Feature: Server-Side LUFS Normalization
**Problem**: AudioEngine did 10-second RMS analysis per song targeting -14 LUFS (streaming standard). Club systems need -10 LUFS and full-track analysis for accuracy.

**Solution**: `server/lufsAnalyzer.js` — new background FFmpeg analysis pipeline.
- FFmpeg analysis-only pass (no file modification): `ffmpeg -i input.mp3 -af loudnorm=I=-10:TP=-1:LRA=11:print_format=json -f null -`
- Parses `input_i` (integrated LUFS) from JSON stderr output
- Calculates `gain = clamp(10^((−10 − lufs) / 20), 0.3, 2.5)`
- Runs 3 songs concurrently (nice to system), 150ms delay between batches
- Auto-triggers 5 seconds after boot music scan; tracks marked `lufs_analyzed=1` so they're never reprocessed
- Progress endpoint: `GET /api/music/lufs-status`; manual trigger: `POST /api/music/analyze`

**DB changes** (`server/db.js`):
- New columns: `music_tracks.lufs REAL`, `music_tracks.auto_gain REAL`, `music_tracks.lufs_analyzed INTEGER DEFAULT 0`
- New functions: `updateTrackLufs(path, lufs, gain)`, `getTracksNeedingAnalysis(limit)`, `getLufsStats()`, `getTrackAutoGains(filenames)`
- All track selection queries (`getRandomTracks`, `selectTracksForSet`) now include `auto_gain` in SELECT

**Fleet manifest** (`server/fleet-routes.js`): enriches each entry with `auto_gain` from main DB by matching `fleet_music.filename = music_tracks.name`. Venue Pis get gain values transparently.

**AudioEngine** (`src/components/dj/AudioEngine.jsx`):
- `AUTO_GAIN_TARGET_LUFS`: -14 → -10 (club standard)
- `loadTrack`: when input is `{ url, name, auto_gain }`, pre-populates `autoGainCacheRef.current.set(url, gain)` — `analyzeTrackLoudness` cache-hits immediately, skipping the 10s fetch+analyze

### Fix: Playlist Panel Orange Cooldown Color
**Problem**: Dancer's personal playlist panel in RotationPlaylistManager always showed purple icon + white text regardless of cooldown status. Genre folders panel already had orange for recently played songs.

**Fix**: Added `onCool` check to `playlistSongs.map` render block (line ~791 in RotationPlaylistManager.jsx). Same pattern as the genre folders panel: `!!(songCooldowns[songName] && (Date.now() - songCooldowns[songName]) < FOUR_HOURS_MS)`.
- Icon: `text-[#a855f7]` → `text-orange-400` when `onCool`
- Text: `text-white` → `text-orange-300` when `onCool`
- **File**: `src/components/dj/RotationPlaylistManager.jsx`

### GitHub
- Commit: `29f3332` — "LUFS normalization + playlist cooldown orange + session notes (V11, true-random varNum, watchdog errors)"
- 142 files pushed

---

## Mar 15, 2026 — Session 42 (Rotation Display / Audio Mismatch Fix + Fleet Error Forwarding — COMPLETE)

### Bug: Song Playing Did Not Match Rotation Display
**Symptom**: Header showed "09 - Rhythm Track - Got Money" playing, but SAGE's rotation slot still showed "01 Black Dog.wma" as if that were playing. No console errors.

**Root cause (two bugs working together)**:

1. **No codec check before loading** (`AudioEngine.jsx`): The server can stream any file regardless of format. When "01 Black Dog.wma" was assigned to SAGE, `inactiveDeck.load()` succeeded (server delivered the bytes), but the browser (Chromium/Linux) silently entered an error state on `play()` because WMA codec is unsupported. No `onerror` handler was attached to the music deck elements, so the error was swallowed. `ontimeupdate` never fired. After 5 seconds the watchdog triggered.

2. **Watchdog didn't update rotation display** (`DJBooth.jsx`): The watchdog successfully recovered by playing a random track via `audioEngineRef.current.playTrack(...)`. It updated `lastAudioActivityRef`, `isPlayingRef`, and called `recordSongPlayed` — but it had no equivalent of `updateRotationUI`, so `rotationSongs` state was never updated. The display stayed stuck on the original (failed) assignment.

### Fix A — AudioEngine codec check (before load)
**File**: `src/components/dj/AudioEngine.jsx` — inside `playTrack`, immediately after `loadTrack` resolves:
```js
const CODEC_MAP = { mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg',
  flac:'audio/flac', m4a:'audio/mp4', aac:'audio/aac',
  wma:'audio/x-ms-wma', opus:'audio/ogg; codecs=opus' };
const urlExt = (trackData.url.split('?')[0].split('.').pop() || '').toLowerCase();
const codecMime = CODEC_MAP[urlExt];
if (codecMime) {
  const probe = new Audio();
  if (probe.canPlayType(codecMime) === '') {
    // releaseLock, return false — DJBooth fallback logic handles cleanly
  }
}
```
`canPlayType` returns `''` (falsy) = definitely unsupported. Now WMA fails fast and cleanly, triggering the existing fallback chain which DOES call `updateRotationUI`.

### Fix B — Watchdog rotation display update
**File**: `src/pages/DJBooth.jsx` — watchdog's inner try block:
Added `updateWatchdogRotationUI(recoveredTrack)` helper defined once, called after `recovered = true` in all three recovery branches (dancer playlist, server random, local pool). Updates `rotationSongsRef` and calls `setRotationSongs` so the card in the UI shows the actual playing track.

### Fix C — Fleet error forwarding from venue Pis
**File**: `server/index.js` — `POST /api/playback-errors`:
If `FLEET_DEVICE_KEY` and `FLEET_SERVER_URL` env vars are set AND `IS_HOMEBASE !== 'true'`, the server async-POSTs to homebase's `POST /fleet/logs` with the error as a structured log entry. Completely fire-and-forget — doesn't affect the local response.

**Required per-venue Pi setup** (one-time): Add `FLEET_DEVICE_KEY=<api key from device registration>` to `~/djbooth/.env` on each venue Pi. The key is in homebase's fleet dashboard device list.

### GitHub
- Commit: `9bbe34d` — "Fix rotation display mismatch + codec check + fleet error forwarding"
- 142 files pushed
- **All 4 units need `~/djbooth-update.sh`** to pull Sessions 41+42

---

## Mar 11, 2026 — Sessions 37-39 (Play History Fix + OpenAI Rate Limit + Song Selection Rewrite — COMPLETE)

### Session 37: Play History Fix (commit `9e4021f`)
**Root cause**: `recordSongPlayed` silently skipped when `sessionStorage` (wiped on reboot) had no token.
**Fix**: Changed `djbooth_token` from `sessionStorage` → `localStorage` across 13 files. Genre now passed to `recordSongPlayed`. Server `play_history` table now populates correctly after reboots.

### Session 38: OpenAI Rate Limit Fix (commit `09b579a`)
**Root cause**: 8-variation cold-start generated 8 variations × multiple dancers simultaneously, hitting 30k TPM limit.
**Fix**: All pre-cache delays increased (1.5s/2s → 6s), `preCacheAll` serialized (batch size 3→1). Cold-start ~$1.17 GPT-4.1, one-time only.
**Note**: Alert storm on neonaidj003 was caused by old 5-min heartbeat vs 3-min timeout. Fixed by running `~/djbooth-update.sh`.

### Session 39: Song Selection Rewrite (commit `823af94`)
Four root causes fixed — see CURRENT STATUS above for full details.

---

## Mar 11, 2026 — Session 36 (8-Variation / L4-Lock Voiceover Refactor — COMPLETE)

### What Changed
Rewrote the voiceover caching system in `AnnouncementSystem.jsx` to replace the 5-level energy system with a flat 8-variation round-robin system, all locked to energy level 4.

### Constants Added (top of file)
```js
const NUM_VARIATIONS = 8;
const LOCKED_LEVEL = 4;
```

### New Key Format
- **New**: `{type}-{dancerName}-var{N}-V10-C{clubSuffix}` where N = 1–8
- **Legacy (backward-compat)**: `{type}-{dancerName}-L4-V10-C{clubSuffix}` — checked as fallback when var1 has no cache hit

### New Functions Added
- **`variationCounterRef`** — `useRef({})` keyed by `"type-dancerName[-nextDancerName]"`, values 1–8 cycling
- **`getNextVariationNum(type, dancerName, nextDancerName)`** — increments counter and returns next slot, resets on app restart

### Renamed / Rewritten Functions
| Old | New | Change |
|---|---|---|
| `findCachedAtAnyLevel` | `findCachedAtAnyVariation` | Loops var1–var8 + legacy L4 key instead of L1–L5 |
| `getOrGenerateAnnouncement(type, name, next, energyLevel, round)` | `getOrGenerateAnnouncement(type, name, next, varNum, round)` | Takes varNum, locked to LOCKED_LEVEL, legacy migration on var1 |

### Updated Functions
- **`playAnnouncement`** — calls `getNextVariationNum` before fetch/generate
- **`getAnnouncementUrl`** (in useImperativeHandle) — same, uses `getNextVariationNum`
- **`preCacheDancer`** — loops all 8 variations × 3 types = 24 jobs per dancer
- **`preCacheUpcoming`** — loops all 8 variations × 4 types per dancer
- **`preCacheForRotationStart`** — `makeJobs` builds 8 variations per type per dancer
- **`preCacheAll`** — full 8-variation job list for all rotation dancers
- **UI badge** — shows fixed "L4" using `ENERGY_LEVELS[LOCKED_LEVEL]` color (removed `currentLevel`/`levelInfo` from render)
- **`isCached` check in Quick Announce buttons** — uses var1 as indicator
- **Import** — removed unused `getCurrentEnergyLevel` from energyLevels import

### Legacy Migration
When `varNum === 1` and no cache hit found, checks old `{type}-{dancerName}-L4-V10-C{clubSuffix}` key in both IndexedDB and server. If found, saves it as var1 (migrates seamlessly, no regeneration needed).

### Fallback Chain (unchanged in order, updated naming)
1. Custom recording (Voice Studio) — always wins
2. IndexedDB session cache for this varNum
3. Server disk cache for this varNum
4. **NEW**: Legacy L4 key (var1 only) — migrates old cached files
5. Fresh AI generation (OpenAI script → ElevenLabs TTS), locked to L4 prompts
6. Any cached variation for same dancer (`findCachedAtAnyVariation`)
7. Any cached variation for `_GENERIC_` dancer
8. Pre-recorded generic voiceover from fleet.db

### GitHub
- Committed: `1683d25` — "8-variation/L4-lock voiceover refactor: round-robin var1-8, legacy L4 migration, fixed energy badge"
- 138 files pushed, `.replit`/`sed3CnVAv`/`zipFile.zip`/`music/` excluded

### Fleet Status at End of Session
- neonaidj001 at `100.115.212.34` — on commit `4416038`, needs `~/djbooth-update.sh`
- neonaidj003 at `100.81.90.125` — on commit `4416038`, needs `~/djbooth-update.sh`
- Homebase at `100.95.238.71` — needs `~/djbooth-update.sh`

### TODO: Set CLUB_NAME on neonaidj003
- Fleet dashboard shows "Unknown" club name for neonaidj003
- SSH into neonaidj003 and add `CLUB_NAME=` to `~/djbooth/.env`, then `sudo systemctl restart djbooth`
- Confirm the correct club name with user first

### TODO: Investigate neonaidj003 Crash Logs
- 4 crashes on March 10 afternoon: 1:59pm, 3:49pm, 4:32pm, 5:24pm (all EST)
- `djbooth.service: Failed with result 'exit-code'` — Node.js process crashed, systemd auto-restarted each time
- Device has been stable since (9h+ uptime, 0 errors as of March 11)
- Likely cause: memory spike or unhandled error during voiceover generation under real gig load
- **Diagnosis command** (run on neonaidj003 next SSH session):
  ```bash
  journalctl -u djbooth --since "2026-03-10 13:00:00" --until "2026-03-10 18:00:00" | tail -50
  ```
- The `withRetry` wrapper added in commit `4416038` should help prevent recurrence

---

## Mar 10, 2026 — Session 35 (HDMI-2 Display Placement — IN PROGRESS)

### Problem: Rotation display window opens on HDMI-1 instead of HDMI-2
- **Setup**: Pi 5, Bookworm, labwc 0.9.2 (switched from Wayfire). HDMI-A-1 = main kiosk (1920×1080 at 0,0). HDMI-A-2 = rotation display TV (1080×1920, transform 90° CCW, logical position 1920,0).
- **Root cause of original failures**: Wayfire has an unfixable bug — cross-output window placement never works. Switched to labwc which has proper MoveToOutput support.

### What was tried this session
1. **labwc rc.xml windowRule** with `identifier="neon-dj-display"` + `<action name="MoveToOutput" output="HDMI-A-2"/>` + `<action name="Maximize"/>` — CONFIRMED app_id is correct (`neon-dj-display` verified via `WAYLAND_DEBUG=1`). Rule fires correctly for test window (went to HDMI-2) but NOT for the actual display browser.
2. **`--user-data-dir=/home/.../chromium-display`** — first tried with existing state. Suspected profile saved HDMI-1 position and restored it.
3. **`--user-data-dir=/tmp/chromium-display`** (always fresh, cleared on reboot) — still went to HDMI-1.
4. **`--ozone-platform=x11 --window-position=1920,0 --window-size=1080,1920`** — tried last, result unknown (user took a break).

### Current state of Pi files
- `~/.config/labwc/rc.xml`: Has `<windowRule identifier="neon-dj-display">` with MoveToOutput HDMI-A-2 + Maximize
- `~/.config/labwc/autostart`: Runs `wlr-randr --output HDMI-A-2 --transform 90` for display rotation
- `~/.config/autostart/djbooth-display.desktop`: Uses `/tmp/chromium-display` as user-data-dir (latest version)
- Kiosk desktop: `~/.config/autostart/djbooth-kiosk.desktop` (separate --class=neon-dj-kiosk instance)
- **No display browser is currently running** (killed before break)

### Key confirmed facts
- `--class=neon-dj-display` correctly sets Wayland app_id to `"neon-dj-display"` (proven via WAYLAND_DEBUG=1)
- labwc MoveToOutput rule DOES fire for test instances — test window (PID 3120, `--user-data-dir=/tmp/chromium-test`, `--app=about:blank`) correctly went to HDMI-2
- Same rule does NOT fire (or is overridden) for actual display browser with real URL `http://localhost:3001/RotationDisplay`
- The difference between working test and failing real browser: the URL. Test used `about:blank`; real uses actual localhost URL.

### Next steps to try (in order of likelihood)
1. **Verify `--ozone-platform=x11 --window-position=1920,0` works** (was the last command given, result unknown):
   ```bash
   pkill -f "RotationDisplay" 2>/dev/null; pkill -f "chromium-display" 2>/dev/null; sleep 1; chromium --ozone-platform=x11 --app=http://localhost:3001/RotationDisplay --window-position=1920,0 --window-size=1080,1920 --user-data-dir=/tmp/chromium-display --no-first-run --noerrdialogs --disable-infobars --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required &
   ```
2. **Try cursor-position approach**: In labwc, new windows open on the output where the cursor is. Move cursor to HDMI-A-2 first, THEN launch Chromium. Need to check if `ydotool` or `wlrctl` is installed: `which ydotool wlrctl`.
3. **Try `--kiosk` instead of `--app`** with X11 mode: `chromium --ozone-platform=x11 --kiosk --window-position=1920,0 http://localhost:3001/RotationDisplay`
4. **Try `cage`**: Cage is a single-window kiosk compositor. Run `cage -d -r -- chromium --kiosk http://localhost:3001/RotationDisplay` with `WAYLAND_DISPLAY` pointed to HDMI-A-2. But requires cage to be installed (`sudo apt install cage`).
5. **Check `wlr-output-management` protocol**: Use `wlrctl` to move the window AFTER it opens on HDMI-1.

### Display browser launch command (current best attempt)
```bash
chromium --ozone-platform=x11 --app=http://localhost:3001/RotationDisplay --window-position=1920,0 --window-size=1080,1920 --user-data-dir=/tmp/chromium-display --no-first-run --noerrdialogs --disable-infobars --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required
```

### Desktop file (current)
```ini
[Desktop Entry]
Type=Application
Name=NEON AI DJ Rotation Display
Exec=bash -c 'until curl -sf http://localhost:3001/__health > /dev/null 2>&1; do sleep 2; done && sleep 2 && chromium --app=http://localhost:3001/RotationDisplay --class=neon-dj-display --user-data-dir=/tmp/chromium-display --no-first-run --noerrdialogs --disable-infobars --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required'
X-GNOME-Autostart-enabled=true
```
**Note**: Desktop file still uses native Wayland (no --ozone-platform=x11). If X11 approach works in manual test, update desktop file to match.

---

## Mar 8, 2026 — Session 34 (Commercial Ordering Fix + Dual-Song Boot Fix)

### Bug Fix: Commercial plays AFTER outro, not before
- **Problem**: Commercial was playing before outro voiceover — wrong order
- **Fix**: In `handleSkip` and `handleTrackEnd`, check `isCommercialDue()` first. If commercial coming: play standalone outro → commercial → next track → standalone intro. If no commercial: use combined `transition` announcement (outro+intro in one) as before
- **4 transition points in DJBooth.jsx**: 2 fixed (handleSkip direct, handleTrackEnd direct), 1 OK as-is (after break songs — no outro needed)
- **Commit**: `b7a81a2`

### Bug Fix: Playback lock prevents dual songs on boot (v1 — mutex, didn't fully fix)
- Added `playTrackLockRef` mutex to AudioEngine's `playTrack` — serializes concurrent calls so only one track loads at a time
- **Commit**: `afbfd5e`
- **Problem**: Mutex waits then ALSO plays — both songs still end up on separate decks

### Bug Fix: Dual-song boot — block-and-skip + diagnostics (v2)
- Changed `playTrackLockRef` from wait-then-play to block-and-skip: second concurrent call returns false instead of waiting
- Added dual-deck monitor: 2s interval checks if both decks are playing simultaneously, logs `🚨 DUAL-DECK ALERT`
- Added deck state diagnostics: logs A/B paused/src state before and after each playTrack call
- User confirmed: two different songs overlap simultaneously on Pi kiosk boot
- Console shows only ONE `PlayTrack` log — second audio source is unidentified
- **Commit**: `1d47282`

### Feature: Folder Lock shows actual picks + tap-to-reroll
- When Folder Lock mode changes, all non-DJ-overridden assignments are cleared and re-picked under new mode
- `rerollSong()` in RotationPlaylistManager: tap a folder-locked song to re-roll it from the same folders, excluding all other assigned songs
- Visual: shuffle icon (amber) on folder-locked songs, hover highlight, currently-playing song cannot be re-rolled
- **Files**: `src/components/dj/RotationPlaylistManager.jsx`

### Feature: Dirty word filter for dancers
- Songs with "dirty" (case-insensitive) in filename hidden from DancerView, stripped on playlist save, blocked on addSong
- Server-side: `getMusicTracks` `excludeDirty` flag auto-set for dancer sessions
- DJ/Manager can still see and assign dirty songs
- **Files**: `server/db.js`, `server/index.js`, `src/pages/DancerView.jsx`
- **Commit**: `3a82ec4`

### Bug Fix: Commercial voiceover pipeline
- Commercials now call `audioEngineRef.current.playAnnouncement()` directly instead of going through AnnouncementSystem's generation pipeline
- **Commit**: `6f6333e`

## Mar 8, 2026 — Session 33 (Fleet Play History + Generic Voiceover Fallbacks)

### Feature: Fleet Play History
- Each Pi sends recent play history (songs played since last heartbeat) in heartbeat payload
- Fleet server stores in `fleet_play_history` table (90-day retention, auto-cleanup)
- Deduplication via UNIQUE constraint on (device_id, track_name, played_at) + INSERT OR IGNORE
- `lastPlayHistorySyncTime` persisted to `settings` table so no data lost across reboots
- Limit raised from 100 to 500 rows per heartbeat (more than enough for 5-min intervals)
- Fleet dashboard device detail modal has "Play History" tab with date picker + chronological song list
- **Files**: `server/heartbeat-client.js`, `server/fleet-monitor.js`, `server/fleet-db.js`, `server/fleet-routes.js`, `src/api/fleetApi.js`, `src/pages/FleetDashboard.jsx`

### Feature: Generic Voiceover Fallbacks (Last Resort — No Internet)
- 40 pre-recorded generic voiceovers stored in fleet.db `voice_recordings` table under `__generic__`
- 10 variations each for: intro, round2, outro, transition
- **Fallback chain** (in order):
  1. Cached voiceover for this entertainer (IndexedDB + server)
  2. Fresh AI-generated (OpenAI script → ElevenLabs TTS) — requires internet
  3. Cached version at different energy level for same entertainer
  4. Generic AI-generated cached version
  5. **Pre-recorded generic voiceover** — absolute last resort, zero internet needed
- `checkGenericRecording()` in AnnouncementSystem.jsx cycles round-robin through variations
- Cached in IndexedDB after first fetch so they work fully offline
- Generation script: `server/generate-generic-voiceovers.js` (one-time, requires ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID env vars)
- **Files**: `src/components/dj/AnnouncementSystem.jsx`, `server/generate-generic-voiceovers.js`, `server/fleet-db.js`

### Sales Pitch Added to replit.md
- Full sales pitch section with key selling points for club owners
- Covers: AI voice, 5-layer redundancy, fleet management, iPad remote, promo system, cost tracking, reliability, voice studio
- Pricing: $400–$1,000/month per location

## Mar 7, 2026 — Session 27 (Fleet Command Buttons + Scroll Fix + USB SSD Plan)

### Feature: Fleet Remote Command Buttons
- **Added**: Update, Restart, Sync, Reboot buttons on every DeviceCard in `/fleet` page
- **PIN authentication**: PIN input bar at top of fleet page, saved in localStorage (`fleet_pin`), sent with every command
- **Command flow**: Buttons POST to `/api/monitor/command/:deviceId/:action` with PIN → server queues command → Pi picks up on next heartbeat poll
- **UX**: Spinner on button while pending, clears immediately on error (invalid PIN, network fail), clears after timeout on success. Reboot shows confirmation dialog
- **Disabled**: Buttons disabled for offline devices
- **Toast notifications**: Success/error feedback at bottom of screen
- **Bulk actions**: `handleUpdateAll` and `handleSyncAll` functions defined (not yet wired to UI buttons)
- **Files**: `src/pages/FleetDashboard.jsx`

### Fix: Fleet Page Scrolling on iPhone Safari
- **Problem**: Fleet page wouldn't scroll on iPhone — content below fold was unreachable
- **Root cause**: Global CSS (`src/index.css`) sets `overflow: hidden` on html, body, and `#root` for the DJ booth. Fleet page was trapped inside this non-scrollable container
- **Failed approaches**: CSS class (`fleet-page`) overriding html/body overflow — didn't work on iOS Safari. `h-screen flex flex-col` with `flex-1 overflow-y-auto` inner container — also didn't scroll
- **Working fix**: `fixed inset-0 overflow-y-auto` on outer container — takes element completely out of document flow (same technique as DeviceDetailModal which always scrolled). Header/PIN bar use `sticky` positioning
- **Button sizing**: Added `.fleet-compact` CSS class to unset `min-height: 44px` / `min-width: 44px` on fleet page buttons (command buttons need to be compact)
- **Files**: `src/pages/FleetDashboard.jsx`, `src/index.css`

### Pushed to GitHub
- Commit: "Fleet Command Center: remote command buttons, PIN auth, scroll fix"
- Homebase needs `~/djbooth-update.sh` to pull changes

### TODO: Next Session (Move Fleet Server to Homebase Pi)
- **Goal**: Homebase Pi becomes the fleet server instead of Replit — always on, no sleeping
- **Why**: Replit dev environment sleeps when idle, causing false offline alerts every 20-30 min overnight
- **Architecture**: Homebase already runs the same Express server with fleet monitoring code. DJ booth routes (`/api/dancers`, etc.) and fleet routes (`/api/fleet/*`, `/api/monitor/*`) use separate namespaces on the same port 3001 — zero conflicts
- **Steps**:
  1. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` env vars on homebase Pi (currently only on Replit)
  2. Set `FLEET_SERVER_URL=http://localhost:3001` on homebase so it reports to itself
  3. Set `FLEET_SERVER_URL=http://100.95.238.71:3001` on Pony Nation Pi (Tailscale IP of homebase)
  4. Copy `fleet.db` from Replit to homebase OR let it build fresh as devices check in (generic voiceovers would need to be copied or regenerated)
  5. Verify fleet dashboard works at `http://100.95.238.71:3001/fleet` from iPad
  6. Remove/unset `FLEET_SERVER_URL` on Replit (optional — stops sending heartbeats to nowhere)
- **No code changes needed** — all configuration
- **Load impact**: Negligible — one heartbeat POST every 5 min per device
- **Bonus**: Fleet dashboard accessible from any device on Tailscale network

### TODO: Next Session (USB SSD Music Library)
- **Goal**: Use 1TB USB 3.2 SSD as homebase music library instead of SD card
- **Why**: User DJs on other computers, wants to move SSD between them to add music, then plug back into homebase Pi
- **Plan**: 
  1. Get drive UUID via `lsblk` and `sudo blkid`
  2. Create `/etc/fstab` entry with UUID so drive always mounts to same path (e.g., `/mnt/music-ssd`)
  3. Update homebase's `MUSIC_PATH` env var to point to the SSD mount
  4. R2 sync will distribute new music from homebase SSD to all fleet Pis automatically
- **Key requirement**: Must mount to same path every time regardless of USB port
- **Filesystem**: exFAT — user uses Windows, Mac, and Linux computers for DJing. exFAT works natively on all three. Always safely eject before unplugging
- **Pi exFAT support**: May need `sudo apt install exfatprogs` on homebase if not already installed
- **R2 music reset**: Wipe the `music/` prefix in R2 bucket and re-upload fresh from the USB SSD. Most filenames will be the same so dancer playlists won't be affected
- **IMPORTANT**: Only change `MUSIC_PATH` on homebase — do NOT change it on any fleet Pis. Fleet units keep their existing music path. Only homebase reads from the USB SSD

### TODO: Next Session (Homebase-Aware Update Script)
- **Goal**: Update script should skip Chrome kill/relaunch on homebase
- **How**: Check `IS_HOMEBASE=true` env var in `djbooth-update-github.sh`, skip kiosk browser restart if set
- **File**: `public/djbooth-update-github.sh`

### Investigation: Homebase Random Reboot
- Homebase rebooted unexpectedly. No crontab found (`sudo crontab -l` returned empty)
- Need to check `last reboot`, `journalctl --list-boots`, and `journalctl -b -1 -n 30` for cause
- Possible causes: power blip, overheating, kernel panic

---

## Mar 4, 2026 — Session 20 Changes

### New Features

#### AI Promo Creator
- **Purpose**: Generate radio-quality event promo commercials directly from the DJ booth
- **Pipeline**: Event form → AI script (OpenAI/Replit LLM) → ElevenLabs TTS voiceover → fetch instrumental from PROMO BEDS folder → OfflineAudioContext stereo mixing with voice activity detection + music ducking → preview/download/save as type 'promo'
- **Prompt architecture**: "Design It Like a Track, Not an Ad" — section-based timing (First Impact → Build → Info Drop → Peak Escalation → CTA → Hard Out), energy arcs per vibe, controlled chaos density, 3 runtime modes: Short Burst (15s, 35-55 words), Standard Spot (30s, 65-90 words), Extended Hype (60s, 120-165 words)
- **4 vibes**: Hype (explosive, chaos max), Party (fun, building), Classy (smooth, controlled), Chill (laid-back, low chaos)
- **Audio mixer**: Stereo WAV output, music ducks to 6% during speech (0.3s attack, 0.5s release), 0.8s fade-in, 2.5s fade-out, 1.2s voice delay before speech starts
- **Music beds**: From "PROMO BEDS" folder in music library (`/home/<user>/Desktop/DJ MUSIC/PROMO BEDS/`). Genre query is case-insensitive (`COLLATE NOCASE`). Synced across fleet via R2 like all music
- **UI**: ManualAnnouncementPlayer has tabbed interface ("Create Promo" | "Upload"). 5-step progress bar. Script editable before remixing. "New Bed" picks different instrumental
- **Files**: `src/utils/promoGenerator.js`, `src/utils/audioMixer.js`, `src/components/dj/ManualAnnouncementPlayer.jsx`

#### Commercial Frequency Setting
- **Purpose**: Schedule how often promos play during rotation
- **UI**: "Commercials" dropdown on Options page below Energy Level — Off / Every Set / Every Other Set / Every 3rd Set
- **Storage**: `localStorage` key `neonaidj_commercial_freq` (values: 'off', '1', '2', '3')
- **Logic**: `commercialCounterRef` in DJBooth increments on every entertainer transition. `playCommercialIfDue()` checks modulo frequency, fetches random promo/manual from `/api/voiceovers`, plays via `audioEngineRef.playAnnouncement()`. Integrated into all 4 transition paths (handleSkip direct, handleSkip post-interstitial, handleTrackEnd direct, handleTrackEnd post-interstitial)
- **Files**: `src/components/dj/DJOptions.jsx`, `src/pages/DJBooth.jsx`

### Bug Fixes
- **Music search bypasses genre filter**: All 4 music browser views (RotationPlaylistManager, PlaylistEditor, RemoteView, DancerView) now ignore genre filtering when a search query is active. PlaylistEditor genre pills replaced with compact dropdown
- **ElevenLabs all-caps pronunciation**: All-caps names (AVA, GIGI, MIMI) were spelled out letter-by-letter. Pre-TTS conversion now lowercases 2+ letter all-caps words to title case. Pronunciation map regex uses `/gi` flag
- **Genre query case-insensitive**: `getMusicTracks()` in `server/db.js` uses `COLLATE NOCASE` for genre matching. Ensures folder names like "PROMO BEDS" match regardless of case

### R2 Sync Reminder
- **Music IS synced to R2** via `syncMusicToR2()` and `syncMusicFromR2()` in `server/r2sync.js`
- Music files use `music/` prefix in R2 bucket
- PROMO BEDS instrumentals sync across fleet automatically like all other music
- Voiceovers sync separately from voiceovers directory

## Feb 27, 2026 — Session 3 Changes

### New Features
- **DJ Options Panel** (`src/components/dj/DJOptions.jsx`): Music mode selection (Dancer First / Folders Only) + active genre/folder checkboxes. Saved server-side via `/api/dj-options`, broadcast via SSE `djOptions` event.
- **Options Tab in iPad Remote**: `RemoteView.jsx` now has an Options tab embedding full `DJOptions` component. DJ can change music mode and genres from iPad.
- **Genre Filtering in RotationPlaylistManager**: `filterByGenres()` helper filters filler tracks and track browser by active genres. In "Folders Only" mode, dancer playlists skipped entirely.
- **Pre-Cache on Save All**: Hitting Save All on rotation panel triggers `preCacheDancer` for every dancer in rotation. Staggered 2s apart. Safe to call repeatedly (cached announcements are skipped).

### Bug Fixes
- **Folder Names Showing as "(Root folder)"**: `DJOptions.jsx` referenced `g.genre` but SQL returned `genre as name`. Fixed all references to `g.name`.
- **Songs Repeating Too Often**: Dancer playlist songs now respect 4-hour cooldown. When all playlist songs on cooldown, filler comes from full catalog (not just same genre). Random filler also respects 4-hour cooldown.

### Cooldown Changes
- `COOLDOWN_MS` changed from 5 hours → 4 hours in `DJBooth.jsx`
- Dancer playlist songs now filtered by cooldown — previously played every set regardless
- Filler tracks: tries active genre folders first, falls back to full catalog if not enough off-cooldown songs
- All songs (playlist + filler) subject to same 4-hour anti-repeat window

### New/Modified Files
| File | Change |
|---|---|
| `src/components/dj/DJOptions.jsx` | NEW — DJ Options panel component |
| `src/components/dj/RemoteView.jsx` | Added Options tab, `djOptions`/`onOptionsChange` props |
| `src/components/dj/RotationPlaylistManager.jsx` | Added `filterByGenres()`, genre filtering, `djOptions` prop |
| `src/pages/DJBooth.jsx` | DJ Options state/SSE, pre-cache on Save All, cooldown overhaul in `getDancerTracks`, 4-hour cooldown |
| `server/index.js` | Added `/api/dj-options` GET/POST endpoints, SSE `djOptions` broadcast |
| `server/db.js` | `getRandomTracks()` accepts genre filter param |

## Feb 27, 2026 — Session 2 Changes

### Bug Fixes
- **Dancer View White Screen**: `DancerView.jsx` crashed when genre fetch failed because playlist + genres were in one `Promise.all()`. Fixed by separating them — genre failure is silently caught.
- **Playlist Songs Erased**: `onAutoSavePlaylist`/`onSaveAll` in `DJBooth.jsx` replaced dancer playlists with just the current rotation songs. Fixed by merging new songs into existing playlist (deduped with `includes()` check).

### Audio Tuning
- **Duck Transition**: Changed `DUCK_TRANSITION` from `2.5` to `4.5` seconds in `AudioEngine.jsx` for gentler announcement fades. Only the constant changed — no logic modified.

### New Feature: iPad Remote View
- New component: `src/components/dj/RemoteView.jsx`
- `DJBooth.jsx` early-returns `<RemoteView>` when `remoteMode=true`
- Landscape split-panel: left (now playing + controls), right (rotation/dancers tabs)
- All touch targets 44px+, optimized for handheld iPad
- Uses existing SSE + `boothApi.sendCommand` — no server changes needed
- CSS in `src/index.css` (`.remote-view` class)

### Other Changes
- Rotation buttons added to Dancer Roster cards (green +Add / red -In Rotation)
- Removed "Add to rotation" section from Rotation tab (redundant)
- Dancer phone music catalog now uses server `musicApi` with genre filters + search + pagination

## Key Fixes & Discoveries

### Port Configuration
- `.replit` must have exactly ONE `[[ports]]` entry for deployment
- Multiple `[[ports]]` entries cause all deployments to fail with 404
- The port 3001 entry auto-regenerates when dev server starts — must be manually removed before publishing
- `server/boot.cjs` exists for fast port binding in deployment (CommonJS, binds instantly before ESM loads)

### Server-Side Music Migration (COMPLETED)
- All File System Access API removed from frontend
- Music served via SQLite catalog (`music_tracks` table) + HTTP streaming
- `server/musicScanner.js` scans folder, indexes tracks, extracts genre from directory structure
- API endpoints: `/api/music/tracks`, `/api/music/genres`, `/api/music/stream/:id`, `/api/music/random`, etc.
- Supports Range requests for seeking
- Periodic rescan every 5 minutes

### Kiosk Exit Button (ADDED)
- "Exit Kiosk Mode" button in DJBooth.jsx Settings modal
- Calls `POST /api/kiosk/exit` with DJ auth
- Red styling, positioned at bottom of Settings modal

---

## NEON AI DJ — Complete Pi Setup Checklist

Follow these steps in order when setting up a new Raspberry Pi. Replace `USERNAME` with the Pi's actual username (e.g., `neonaidj001`). Replace `CLUBNAME` with the actual club name.

### Step 1: Install Raspberry Pi OS
- Flash **Raspberry Pi OS Bookworm (64-bit)** to SD card (or NVMe for fleet units)
- Set username to `neonaidj###` (e.g., `neonaidj001`, `neonaidj002`)
- Enable SSH during setup
- Connect to club WiFi

### Step 2: Install Node.js 22
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
```
Verify: `node --version` should show v22.x

### Step 3: Create directories
```bash
mkdir -p ~/djbooth ~/data ~/Desktop/"DJ MUSIC"
```

### Step 4: Download the update script
```bash
curl -o ~/djbooth-update.sh https://raw.githubusercontent.com/jebjarrell1974-debug/dj-booth-rotation-system/main/public/djbooth-update-github.sh && chmod +x ~/djbooth-update.sh
```

### Step 5: Run the first update
Downloads all code from GitHub, builds frontend, installs dependencies.
```bash
~/djbooth-update.sh
```

### Step 6: Create the systemd service
Replace `USERNAME` below with the Pi's username.
```bash
sudo tee /etc/systemd/system/djbooth.service > /dev/null << 'EOF'
[Unit]
Description=DJ Booth Rotation System
After=network.target

[Service]
Type=simple
User=USERNAME
WorkingDirectory=/home/USERNAME/djbooth
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DB_PATH=/home/USERNAME/data/djbooth.db
Environment="MUSIC_PATH=/home/USERNAME/Desktop/DJ MUSIC"
Environment="VOICEOVER_PATH=/home/USERNAME/djbooth/voiceovers"
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable djbooth.service
```

### Step 7: Add cloud sync + monitoring credentials
Replace `USERNAME`, `DEVICEID`, and `CLUBNAME` below.
```bash
sudo mkdir -p /etc/systemd/system/djbooth.service.d
sudo bash -c 'cat > /etc/systemd/system/djbooth.service.d/override.conf << EOF
[Service]
Environment=R2_ACCOUNT_ID=bb98a67dc31c28d8f39a55429bccb759
Environment=R2_ACCESS_KEY_ID=aff9bfa35cb78f2df9a749922c12acdf
Environment=R2_SECRET_ACCESS_KEY=5d16cff7dea0d46a32a5ddab9e24cf8a6e94ac3c65521f59339b605f50c152d0
Environment=R2_BUCKET_NAME=neonaidj
Environment=TELEGRAM_BOT_TOKEN=8771923747:AAEu6Nmym30ri1CyWhxSXl62QSvhkacvXVA
Environment=TELEGRAM_CHAT_ID=8567217273
Environment=FLEET_SERVER_URL=http://100.95.238.71:3001
Environment=DEVICE_ID=DEVICEID
Environment="CLUB_NAME=CLUBNAME"
EOF'
sudo systemctl daemon-reload
```
Note: `FLEET_SERVER_URL` points to the fleet monitor server running on homebase (Tailscale IP `100.95.238.71`). This is the always-on Pi that monitors all fleet devices and sends Telegram alerts when a device goes offline. If the fleet monitor moves to a different machine, update this IP.

### Step 8: Enable remote admin commands (Fleet Command Center)
Allow the djbooth server to restart its service and reboot the Pi remotely via the Fleet Command Center dashboard. Replace `USERNAME`.
```bash
sudo bash -c 'cat > /etc/sudoers.d/djbooth << EOF
USERNAME ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart djbooth, /usr/bin/systemctl stop djbooth, /usr/bin/systemctl start djbooth, /usr/sbin/reboot
EOF'
```

### Step 9: Create the auto-update service
Pulls latest code from GitHub on boot. Runs independently — does NOT block the app from starting. Replace `USERNAME`.
```bash
sudo tee /etc/systemd/system/djbooth-update.service > /dev/null << 'EOF'
[Unit]
Description=NEON AI DJ Auto-Update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=USERNAME
WorkingDirectory=/home/USERNAME/djbooth
Environment=DJBOOTH_BOOT_UPDATE=1
ExecStart=/home/USERNAME/djbooth-update.sh
TimeoutStartSec=300
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable djbooth-update.service
```
**CRITICAL**: Do NOT add `Before=djbooth.service` — that would block the app from starting until the update finishes (up to 5 minutes), which breaks offline/no-internet boot.

### Step 10: Set up Chromium kiosk autostart
Opens fullscreen browser to the app on every boot. Waits for server to be ready before launching.
```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/djbooth-kiosk.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=NEON AI DJ Kiosk
Exec=bash -c 'until curl -sf http://localhost:3001/__health > /dev/null 2>&1; do sleep 2; done && chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001'
X-GNOME-Autostart-enabled=true
EOF
```

### Step 11: Create desktop shortcut (optional)
For manually launching the app from the desktop.
```bash
cat > ~/Desktop/DJBooth.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=NEON AI DJ
Exec=chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001
Icon=audio-headphones
Terminal=false
EOF
chmod +x ~/Desktop/DJBooth.desktop
```

### Step 12: Enable VNC remote desktop access (TigerVNC)
Raspberry Pi OS Trixie uses Wayland, so the built-in RealVNC server doesn't work properly. Use TigerVNC's scraping server instead.
```bash
sudo apt install -y tigervnc-scraping-server
mkdir -p ~/.vnc
tigervncpasswd ~/.vnc/passwd
```
Enter your VNC password twice (e.g. `neon2026`), say `n` to view-only.

To start VNC manually:
```bash
killall x0vncserver x0tigervncserver 2>/dev/null
rm -f ~/.vnc/*.pid /tmp/.X*-lock
x0vncserver -display :0 -rfbauth ~/.vnc/passwd -rfbport 5901 -localhost no &
```
Connect from any device with Tailscale using a VNC viewer app at `TAILSCALE_IP:5901` (e.g. `100.115.212.34:5901`). Leave username blank, enter your VNC password.

To make VNC **start automatically on every boot** (so the Remote button in Fleet Dashboard always works):
```bash
cat > ~/.config/autostart/vnc-server.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=VNC Server
Exec=bash -c 'sleep 5 && killall x0vncserver 2>/dev/null; x0vncserver -display :0 -rfbauth ~/.vnc/passwd -rfbport 5901 -localhost no'
X-GNOME-Autostart-enabled=true
EOF
```
This waits 5 seconds after desktop loads (to let the display settle), then starts VNC. Resource impact is negligible — ~1-2% CPU at idle, 10-30MB RAM. Only does real work when someone is actively connected.

Once VNC is set up and the Pi's Tailscale IP is reporting via heartbeat, the **Fleet Command Center will automatically show a "Remote" button** on that device's card. Tap it and RealVNC Viewer opens directly connected to that Pi's screen. No manual IP entry needed.

Note: Uses port 5901 (not 5900) to avoid conflicts with the built-in RealVNC service. Disable the built-in RealVNC to prevent conflicts:
```bash
sudo systemctl stop vncserver-x11-serviced
sudo systemctl disable vncserver-x11-serviced
```

### Step 13: Configure Wi-Fi for iPad remote (or disable Wi-Fi)
If the Pi uses a separate Wi-Fi network for iPad remote control (no internet on that network), set route metrics so ethernet always handles internet traffic:
```bash
sudo nmcli connection modify "WIFI_CONNECTION_NAME" ipv4.route-metric 600
sudo nmcli connection modify "Wired connection 1" ipv4.route-metric 100
```
Replace `WIFI_CONNECTION_NAME` with the actual Wi-Fi SSID (e.g., `ShowclubVIP`). The update script also sets these automatically on every update.

If the Pi does NOT use Wi-Fi at all, disable it to prevent authentication popups from freezing the kiosk:
```bash
sudo nmcli radio wifi off
```
To re-enable Wi-Fi later if needed: `sudo nmcli radio wifi on`

### Step 14: Disable screen blanking
Keeps the Pi screen on all night (no sleep/screensaver).
```bash
sudo raspi-config nonint do_blanking 1
```

### Step 15: Set timezone and daily reboot
Set the Pi to Central time and schedule a daily reboot at 8:30 AM to keep things fresh.
```bash
sudo timedatectl set-timezone America/Chicago
(sudo crontab -l 2>/dev/null; echo "30 8 * * * /sbin/reboot") | sudo crontab -
```
Verify: `sudo crontab -l` should show the reboot line. `timedatectl` should show `America/Chicago`.

### Step 16: Copy music files
Copy music to `/home/USERNAME/Desktop/DJ MUSIC/`
- Put songs in subfolders — folder names become genre categories (e.g., `Pop/`, `Hip Hop/`, `FEATURE/`)
- Songs in the `FEATURE/` folder play to completion (no 3-minute cap)

### Step 17: Start the app and verify
```bash
sudo systemctl start djbooth && sudo journalctl -u djbooth --no-pager -n 20
```
You should see:
- Music scanner finding tracks
- Telegram fleet monitoring active
- Heartbeat client active
- R2 cloud sync downloading/uploading voiceovers

### Step 18: Configure the app in the browser
- Open `http://localhost:3001` on the Pi
- Go to Configuration (master PIN: `36669`)
- Set club name, ElevenLabs API key, OpenAI API key, voice ID
- These settings are stored in the browser's localStorage on each Pi

### Step 19: Reboot and verify full boot sequence
```bash
sudo reboot
```
After reboot: auto-update runs → app starts → boot screen shows progress → Chromium opens → login page appears.

### Troubleshooting
- **Node version mismatch** (`ERR_DLOPEN_FAILED`): Run `cd ~/djbooth && rm -rf node_modules && npm install`
- **nvm users**: If Node is installed via nvm, update `ExecStart` in the service file to use the nvm path: `/home/USERNAME/.nvm/versions/node/vXX.XX.X/bin/node`
- **Check logs**: `sudo journalctl -u djbooth --no-pager -n 30`
- **Check service status**: `sudo systemctl status djbooth`
- **Manual update**: `~/djbooth-update.sh`
- **Restart service**: `sudo systemctl restart djbooth`

---

## Fleet Monitor Server Setup (on HOMEBASE)

The fleet monitor is a standalone lightweight Node.js script that runs on a separate always-on Pi called "HOMEBASE" (hostname: raspberrypi, Tailscale IP `100.70.172.8`). It does NOT run the full DJ Booth app — it only receives heartbeats from fleet Pi units and sends Telegram alerts when devices go offline.

### Setup Steps

**Step 1: Create directory and download the script**
```bash
mkdir -p ~/fleet-monitor
curl -sL "https://raw.githubusercontent.com/jebjarrell1974-debug/dj-booth-rotation-system/main/public/fleet-monitor-standalone.js" -o ~/fleet-monitor/monitor.js
```

**Step 2: Test it manually**
```bash
TELEGRAM_BOT_TOKEN="8771923747:AAEu6Nmym30ri1CyWhxSXl62QSvhkacvXVA" \
TELEGRAM_CHAT_ID="8567217273" \
node ~/fleet-monitor/monitor.js
```
You should see the "Fleet Monitor Started" banner and receive a Telegram message. Press `Ctrl+C` to stop.

**Step 3: Create the systemd service**
Replace `USERNAME` with the Pi's username (e.g., `jebjarrell`). Also replace the Node path if needed — run `which node` to find it.
```bash
sudo tee /etc/systemd/system/fleet-monitor.service > /dev/null << 'EOF'
[Unit]
Description=NEON AI DJ Fleet Monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/USERNAME/fleet-monitor
ExecStart=/home/USERNAME/.nvm/versions/node/v22.22.0/bin/node /home/USERNAME/fleet-monitor/monitor.js
Restart=always
RestartSec=10
Environment=TELEGRAM_BOT_TOKEN=8771923747:AAEu6Nmym30ri1CyWhxSXl62QSvhkacvXVA
Environment=TELEGRAM_CHAT_ID=8567217273
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable fleet-monitor
sudo systemctl start fleet-monitor
```

**Step 4: Verify**
```bash
journalctl -u fleet-monitor --no-pager -n 15
```
Should show "Fleet Monitor Started" with port 3001 and Telegram active.

### Updating the Fleet Monitor (CRITICAL PATH INFO)
The fleet-monitor service runs from `~/fleet-monitor/monitor.js` and `~/fleet-monitor/fleet-dashboard.html` — **NOT** from `~/djbooth/public/`. The source files in the repo are `public/fleet-monitor-standalone.js` and `public/fleet-dashboard.html`. After pulling updates, you must COPY them to the correct location:

```bash
cd ~/djbooth && git pull && cp public/fleet-monitor-standalone.js ~/fleet-monitor/monitor.js && cp public/fleet-dashboard.html ~/fleet-monitor/fleet-dashboard.html && sudo systemctl restart fleet-monitor
```

**DO NOT** just update `~/djbooth/public/` — the fleet-monitor service will not see those changes.

### Important Notes
- If `djbooth` service was previously running on this Pi, stop and disable it first: `sudo systemctl stop djbooth && sudo systemctl disable djbooth`
- If Node is installed via system package instead of nvm, use `/usr/bin/node` for ExecStart
- Do NOT include `User=` in the service file if the username causes 217/USER errors — omitting it runs as root
- The monitor checks every 5 minutes. If a device misses 2 heartbeats (10 min), it sends a Telegram alert
- When a device recovers, it sends a recovery notification
- Status endpoint: `GET http://100.70.172.8:3001/api/monitor/status`
- Test Telegram: `POST http://100.70.172.8:3001/api/monitor/test-telegram`

### Current Fleet Monitor Host
- **Pi**: HOMEBASE (hostname: raspberrypi)
- **Tailscale IP**: `100.70.172.8`
- **Username**: `jebjarrell`
- **Node path**: `/home/jebjarrell/.nvm/versions/node/v22.22.0/bin/node`
- **Port**: 3001

---

## Session 25 — Mar 5, 2026 (Song Repeat Fix + Transition Gap Fix + Voice Quality Overhaul)

### Fix: Song Repeat Reduction
- **Problem**: Same songs heard multiple times within the same hour despite 4-hour client-side cooldown
- **Root causes**: Server `getRandomTracks` used pure `ORDER BY RANDOM()` with no play-history awareness; `playFallbackTrack` and watchdog recovery sent no cooldown excludes; local fallback ignored cooldowns when pool was small
- **Fixes**: Server-side `getRandomTracks` now LEFT JOINs `play_history` (8-hour window), prioritizes unplayed songs, then least-recently-played. `playFallbackTrack` and watchdog recovery pass cooldown excludes. Local fallback sorts by least-recently-played. Added `idx_play_history_track_name` index
- **Files**: `server/db.js`, `src/pages/DJBooth.jsx`

### Fix: Music Pause During Dancer Transitions
- **Problem**: Audible gap between intro announcement and new dancer's song
- **Root cause**: Three transition paths played announcement FIRST, waited for completion, THEN started next song
- **Fix**: All three paths now match `beginRotation` pattern: start new track FIRST → duck → play announcement over ducked song → unduck
- **File**: `src/pages/DJBooth.jsx`

### Fix: Music Playing Under Commercial
- **Problem**: Previous song audible underneath commercial playback during ~500ms network fetch
- **Fix**: Moved `pauseAll()` + `playingCommercialRef.current = true` to immediately after confirming promos exist — before audio blob fetch
- **File**: `src/pages/DJBooth.jsx`

### Improvement: Voice Announcement Quality Overhaul
- **TTS model**: Switched from `eleven_turbo_v2_5` to `eleven_multilingual_v2`. Same cost ($0.00003/char)
- **Voice settings**: Speed 0.95-1.02 (was 0.85-0.90), Style 0.10-0.25 (was 0.15-0.35), Stability/similarity_boost slightly reduced
- **System prompt completely rewritten**: Persona "veteran strip club DJ with twenty years on the mic" (was "AI voice engine"). Removed contradictory instructions. Simplified from rule-heavy to conversational guidance. Better examples
- **ManualAnnouncementPlayer**: Also updated to `eleven_multilingual_v2` with matching voice settings
- **All old model references removed**: `eleven_turbo_v2_5` no longer referenced anywhere in codebase
- **Cache key**: V4 (forces full regeneration of all cached voiceovers)
- **Files**: `src/utils/energyLevels.js`, `src/components/dj/AnnouncementSystem.jsx`, `src/components/dj/ManualAnnouncementPlayer.jsx`, `src/utils/apiCostTracker.js`

### Change: Default Script Model to GPT-4.1
- **Previous default**: `auto` (built-in Replit LLM)
- **New default**: `gpt-4.1` — best at following nuanced creative voice instructions
- **Where**: `src/components/apiConfig.jsx` — both `DEFAULTS.scriptModel` and `readFromStorage()` fallback
- **Available models**: auto, gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini (Configuration page)
- **Note**: Existing Pi localStorage values preserved. New installs default to GPT-4.1

### Fix: Auto-Select Songs for Dancers Without Playlists
- **Problem**: Dancers with no pre-selected songs fell through to `playFallbackTrack` immediately
- **Fix**: `handleSkip` and `handleTrackEnd` now call `getDancerTracks()` to auto-select random songs when `rotationSongsRef` is empty
- **File**: `src/pages/DJBooth.jsx`

### ElevenLabs Voice Settings Reference (V4)
```
Level 1 (Chill):   stability=0.78, similarity=0.82, style=0.10, speed=0.95
Level 2 (Warm):    stability=0.70, similarity=0.80, style=0.15, speed=0.97
Level 3 (Mid):     stability=0.62, similarity=0.78, style=0.20, speed=1.00
Level 4 (High):    stability=0.55, similarity=0.78, style=0.25, speed=1.02
Level 5 (Closing): stability=0.72, similarity=0.82, style=0.12, speed=0.97
Promo TTS:         stability=0.62, similarity=0.78, style=0.20, speed=1.00
```

---

## Session 24 — Mar 5, 2026

### Fix: White Screen During Updates
- **Problem**: Chrome kiosk showed "This site can't be reached" for ~30 seconds during service restarts because Chrome was still open when the server went down
- **Solution**: Update script (`djbooth-update-github.sh`) now: stops watchdog → kills Chrome → restarts service → waits for health check → relaunches Chrome → restarts watchdog
- **Watchdog service** (`djbooth-watchdog.sh`): New systemd service `djbooth-watchdog` that pings server every 5 seconds. If server goes down and comes back, it auto-refreshes Chrome via `xdotool key F5` (for unexpected crashes, not updates). Installed automatically by update script. Requires `xdotool` package (auto-installed)
- **Race condition**: Update script stops watchdog before restart sequence to prevent both trying to relaunch Chrome simultaneously
- **Failed approaches**: Tried iframe-based launcher page (`neonaidj-launcher.html`) — broke localStorage, audio, and cookies due to file:// → http://localhost cross-origin restrictions. Removed entirely

### Fix: Wi-Fi Overriding Ethernet for Internet
- **Problem**: Pi has ethernet (internet) AND Wi-Fi (local iPad remote network, no internet). Default Linux routing gave Wi-Fi priority, breaking all API calls (OpenAI, ElevenLabs)
- **Root cause confirmed**: User verified "everything went back to normal the second I removed the wifi connections"
- **Solution**: NetworkManager route metrics — `nmcli connection modify` sets ethernet to metric 100 (priority), Wi-Fi to metric 600 (local only)
- **Persistence**: Update script now auto-configures route metrics on every update via nmcli
- **Pi network**: Ethernet `10.1.10.41` (internet), Wi-Fi `172.21.33.107` (ShowclubVIP network for iPad remote)
- **Pi Wi-Fi connections**: ShowclubVIP (active), Buydances, Jeb, Panda (saved but not active)

### Fix: Playlist Saves Silent Failures
- **Problem**: When entertainers added songs to their playlist on their phones, saves could fail silently — the song appeared in the list but never reached the database
- **Solution**: Added `saveStatus` state to DancerView.jsx — shows "Saving..." (yellow), "Saved" (green), or "Save failed!" (red) next to "My Playlist" header
- **File**: `src/pages/DancerView.jsx`

### Fix: Rotation Songs Lost on Page Refresh
- **Problem**: Songs assigned to entertainers for the current rotation were stored in memory only. If the DJ Booth page refreshed (during an update), all assignments were lost
- **Solution**: `rotationSongs` state now persists to `localStorage` (key `djbooth_rotation_songs`) via useEffect. Loaded from localStorage on mount. Cleared when rotation is stopped
- **File**: `src/pages/DJBooth.jsx`

### Cleanup
- Removed `public/neonaidj-launcher.html` (broken iframe launcher)
- Removed unused `/api/proxy/openai` and `/api/proxy/elevenlabs` server endpoints (were added then reverted)
- Update script reverts any autostart entries still pointing to launcher back to `http://localhost:3001`

### Files Modified
- `server/index.js` — removed proxy endpoints
- `src/pages/DancerView.jsx` — save status feedback
- `src/pages/DJBooth.jsx` — rotation songs localStorage persistence
- `public/djbooth-update-github.sh` — kill Chrome before restart, watchdog stop/start, Wi-Fi routing, launcher revert
- `public/djbooth-watchdog.sh` — NEW: watchdog script for auto-refresh on server recovery
- Removed: `public/neonaidj-launcher.html`

---

## Session 23 — Mar 4-5, 2026

### Feature: Enhanced Fleet Command Center Dashboard
Added six new metrics to the standalone fleet dashboard (homebase) for comprehensive monitoring of all Pi units:

1. **API Costs (30d)** — Per-unit ElevenLabs + OpenAI cost tracking with fleet total in summary bar. Breakdown: Total / ElevenLabs / OpenAI + call count. Data comes from `api_usage` SQLite table on each Pi
2. **Memory Usage** — RAM percentage with color warnings (yellow >75%, red >90%). Uses `os.freemem()`/`os.totalmem()`
3. **Service Uptime** — How long `djbooth.service` has been running. Uses `systemctl show` to get ActiveEnterTimestamp. Catches service crashes vs system reboots
4. **Active Entertainers** — Count of entertainers currently in rotation (`liveBoothState.rotation.length`)
5. **Error Count** — Running count of `console.error()` calls since service start. Wraps native console.error
6. **Network Quality** — Pings Google DNS (8.8.8.8) 3 times, shows avg latency + signal bars (4-bar green = Excellent <30ms, 3-bar green = Good <60ms, 2-bar yellow = Fair <100ms, 1-bar red = Poor >100ms, all red = No Internet)
7. **Last Update** — When the Pi last ran `git pull` (from `.git/FETCH_HEAD` mtime). Shows "Today", "Yesterday", "3d ago"

Summary bar now shows: Devices | Online | Offline | Voiceovers | Entertainers | API Costs (30d)

### Key Fix: Fleet Monitor HTML Caching
- **Problem**: Fleet monitor standalone server (`fleet-monitor-standalone.js`) read `fleet-dashboard.html` once at startup and cached in memory. Updating the HTML file had no effect until service restart
- **Fix**: Changed to read HTML fresh on every request via `getDashboardHtml()` function. Also added `Cache-Control: no-cache, no-store` header

### CRITICAL DISCOVERY: Fleet Monitor File Paths
- Fleet monitor service runs from `~/fleet-monitor/monitor.js` and reads `~/fleet-monitor/fleet-dashboard.html`
- This is a **separate directory** from `~/djbooth/public/` where the repo source lives
- The service file (`/etc/systemd/system/fleet-monitor.service`) has `ExecStart` pointing to `~/fleet-monitor/monitor.js`
- Updating `~/djbooth/public/` has NO EFFECT on the running fleet monitor
- **Correct update procedure** (on homebase):
```bash
cd ~/djbooth && git pull && cp public/fleet-monitor-standalone.js ~/fleet-monitor/monitor.js && cp public/fleet-dashboard.html ~/fleet-monitor/fleet-dashboard.html && sudo systemctl restart fleet-monitor
```

### Files Modified
- `server/heartbeat-client.js` — Added `getMemoryInfo()`, `getServiceUptime()`, `getLastUpdateTime()`, `getNetworkLatency()` collectors + all new payload fields
- `server/index.js` — Added `errorCounter` (wraps console.error), `activeEntertainers` from rotation state, passed to heartbeat callback
- `public/fleet-monitor-standalone.js` — Store all new fields from heartbeat + serve HTML fresh on each request (no caching)
- `public/fleet-dashboard.html` — Summary cards (Entertainers, API Costs), device card stat rows (Memory, Service, Entertainers, Errors, Last Update, Network with signal bars), helper functions (`formatNetwork`, `memClass`, `formatLastUpdate`)

---

## Session 21 — Mar 4, 2026

### Feature: Remote Break Songs & Commercial Markers
- Remote tablet (RemoteView.jsx) now shows interactive break song slots between entertainers in the rotation list
- Each break song shows individually with music icon + X to remove
- When a track is selected from music list, dashed "Add as break song" button appears between entertainers
- Commercial break markers (amber) appear based on commercial frequency with X to skip
- Skipped commercials synced to Pi via `skipCommercial` command; Pi broadcasts skipped list back in live state
- New commands: `updateInterstitialSongs`, `skipCommercial`
- `commercialFreq` and `skippedCommercials` now broadcast in live booth state

### Feature: Commercial Shuffle Rotation
- Replaced random promo selection with Fisher-Yates shuffle — all promos play before any repeats
- `promoShuffleRef` tracks queue; reshuffles when empty or promo list changes
- File: `src/pages/DJBooth.jsx`

### Feature: Deactivate Song on Remote Tablet
- Red "Deactivate Song" button in left controls column of RemoteView (below Voice Volume)
- PIN entry modal with numpad; on 5th digit sends `deactivateTrack` command with PIN + track name
- DJBooth verifies PIN via `/api/auth/login`, uses returned token for `/api/music/block`, then skips
- Shows "Deactivate Sent" confirmation for 1.5s before auto-closing
- New command: `deactivateTrack`

### Fix: Club Name "the" Prefix in Announcements
- Added CLUB NAME USAGE RULE to prompt — treats club name as proper noun, never prefix with "the"
- Rule placed right after SYSTEM_PROMPT (2nd position) for maximum AI compliance
- Suggests compound phrases: "Pony Nation", "Pony family", "here at Pony"
- File: `src/utils/energyLevels.js`

### Fix: Commercial Music Bed Volume Fluctuation
- `detectVoiceActivity()` was splitting speech into tiny regions, causing rapid duck/unduck cycles
- Added region merging with 0.8s gap — adjacent regions merge into one continuous duck
- Fixed duck timing to avoid conflicts with initial music fade-in
- Existing promos keep old audio; regenerate for fix to apply
- File: `src/utils/audioMixer.js`

### Fix: Voice Shouting Name on Final Mention
- Added DELIVERY RULE to intro prompt — final name mention smooth/confident, not shouted
- No exclamation marks on final name mention
- Examples updated: "Coming to the stage, the one and only ${name}."
- File: `src/utils/energyLevels.js`

### Fix: VIP Spelled Out as Letters
- All-caps name fix was converting VIP→Vip, read as word by TTS
- Added `SPELL_OUT` exception set: VIP, DJ, MC, ATM, ID, etc.
- These convert to "V.I.P.", "D.J." with dots so TTS reads as individual letters
- File: `src/components/dj/AnnouncementSystem.jsx`

### Fix: Server State Relay Missing New Fields (CRITICAL LESSON)
- Remote tablet couldn't see break songs or commercial markers — Pi was sending them but server dropped them
- `server/index.js` POST `/api/booth/state` constructs `liveBoothState` with a WHITELIST of fields
- **RULE**: When adding ANY new field to the Pi→remote broadcast in DJBooth.jsx, MUST ALSO add it to the server relay whitelist in `server/index.js` (POST `/api/booth/state` handler ~line 571)
- Added: `interstitialSongs`, `commercialFreq`, `skippedCommercials`
- File: `server/index.js`

### Fix: Remote Playlist Dropdown Not Alphabetical + Songs Not Loading
- Playlists sorted alphabetically: `.sort((a, b) => a.name.localeCompare(b.name))`
- ID comparison fix: `String(d.id) === String(musicSource)` (HTML select values are always strings)
- File: `src/components/dj/RemoteView.jsx`

### Feature: Break Song Swap on Remote
- Tap existing break song → highlights cyan with "tap song to swap" label
- Purple banner above library: "Tap a song to replace break song"
- Tap library song → replaces the break song, sends update to Pi
- State: `selectedBreakSong` = `{ breakKey, index }`
- File: `src/components/dj/RemoteView.jsx`

### Fix: Broadcast Dependency Array
- `interstitialSongsState` was missing from broadcast useEffect dependency array
- Changes to break songs weren't triggering re-broadcast to remote
- File: `src/pages/DJBooth.jsx`

---

## Critical Architecture Notes

### Server State Relay Whitelist
The server (`server/index.js`) acts as a relay between the Pi's DJBooth and the remote tablet. The POST `/api/booth/state` endpoint constructs `liveBoothState` with an explicit whitelist of fields. **Any new field added to the broadcast in DJBooth.jsx MUST also be added to this whitelist or the remote tablet will never see it.** This has caused bugs before — always check both files when adding new broadcast fields.

### Broadcast Dependency Array
The broadcast useEffect in DJBooth.jsx has a dependency array that controls when state is re-sent to the server. **Any new state variable included in the broadcast payload MUST also be added to this dependency array** or changes won't trigger re-broadcasts.

---

## User Preferences & Style
- Nightclub dark theme: neon cyan (#00d4ff), blue secondary (#2563eb)
- Deep navy-black backgrounds (#08081a, #0d0d1f), blue-tinged borders (#1e293b)
- Neon dancer color palette
- Minimize CPU/GPU usage for Pi hardware
- User is non-technical — give clear terminal commands, avoid jargon
- User gets frustrated with repeated failures — be efficient, don't ask unnecessary questions
- Push to GitHub at end of each working session

## Key Files
| File | Purpose |
|---|---|
| `server/index.js` | Express server, all API endpoints, static file serving |
| `server/boot.cjs` | Fast CommonJS entry point for deployment (binds port before ESM loads) |
| `server/db.js` | SQLite database setup and queries |
| `server/musicScanner.js` | Recursive music folder scanner, SQLite indexing |
| `server/r2sync.js` | Cloudflare R2 cloud sync (voiceovers + music) |
| `server/fleet-monitor.js` | Fleet monitoring server + Telegram alerts |
| `server/heartbeat-client.js` | Pi heartbeat client (sends status every 5 min) |
| `src/pages/DJBooth.jsx` | Main DJ control panel (very large file) |
| `src/components/dj/AudioEngine.jsx` | Audio playback engine (DO NOT MODIFY behavior) |
| `src/components/BootScreen.jsx` | Boot progress screen shown during startup |
| `src/pages/DancerView.jsx` | Dancer-facing mobile view |
| `src/pages/Landing.jsx` | PIN login page |
| `src/pages/Configuration.jsx` | Venue configuration page |
| `src/components/dj/RemoteView.jsx` | iPad-optimized remote control view (landscape, touch-friendly) |
| `src/components/dj/DJOptions.jsx` | DJ Options panel — music mode + genre/folder selection |
| `src/components/dj/AnnouncementSystem.jsx` | Voice announcement generation (ElevenLabs TTS, pronunciation map, caching) |
| `src/utils/energyLevels.js` | Announcement prompts, energy levels, shift types, club name rules |
| `server/generate-generic-voiceovers.js` | One-time script to generate 40 generic fallback voiceovers via ElevenLabs |
| `src/utils/promoGenerator.js` | AI promo script generation (OpenAI/Replit LLM) |
| `src/utils/audioMixer.js` | OfflineAudioContext mixing for promo voice+music, WAV encoding |
| `src/api/serverApi.js` | Client-side API wrapper |
| `public/djbooth-update-github.sh` | Pi update script (GitHub-based) |
| `replit.md` | Project documentation (always loaded into agent memory) |
| `server/bpmAnalyzer.js` | BPM background analysis — ffprobe tag first, aubio fallback, normalizes 70-175 BPM range |
| `server/lufsAnalyzer.js` | LUFS background analysis — FFmpeg loudnorm, -10 LUFS target |

## External Services
- **ElevenLabs TTS**: Voice announcements (API key stored in browser localStorage per Pi)
- **OpenAI**: Announcement script generation (API key stored in browser localStorage per Pi)
- **GitHub**: Code backup and Pi update distribution (Replit integration, @octokit/rest)
- **Cloudflare R2**: Cloud storage for voiceovers + music sync across fleet
- **Telegram**: Fleet monitoring alerts via @NEONAIDJ_bot
