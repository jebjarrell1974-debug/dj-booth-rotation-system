# NEON AI DJ — Nightclub Entertainment Operations Network

## Overview
NEON AI DJ (Nightclub Entertainment Operations Network — Automated Intelligent Disc Jockey) is a React-based application for automating dancer rotations, managing music playback, and generating dynamic voice announcements in nightclubs. It is designed for x86 mini PC hardware (Dell OptiPlex, Beelink Mini S12) running Debian Linux, aiming to streamline club operations and enhance the atmosphere through intelligent automation and responsive design. Key capabilities include seamless music transitions, automated set management, engaging announcements tailored to club hours and event types, and a fleet management system for centralized control, remote monitoring, updates, and content synchronization across multiple deployed units.

The system aims to provide an AI DJ that never sleeps, offering human-sounding voice announcements, built-in redundancy for continuous operation even offline, and a comprehensive fleet management dashboard for multi-location businesses. It includes an iPad remote control, a commercial playback system with auto-generated promos, and per-unit API cost tracking. The project envisions a reliable, autonomous entertainment system built for demanding nightclub environments.

## Fleet Devices (5 active — scaling to 50+ within 6 months)

| Unit | Tailscale IP | Role | Club | Status |
|---|---|---|---|---|
| Homebase | `100.109.73.27` | Fleet server only (no audio output) | Homebase | HP Compaq 8200 Elite (replaced old Pi homebase Mar 2026) |
| neonaidj001 | `100.115.212.34` | DJ booth | Pony Bama | SSH: `neonaidj001@100.115.212.34` — 25,209 tracks, active |
| neonaidj002 | unknown | DJ booth | Rocket City Showgirls | x86 Dell OptiPlex. HDMI-1 = crowd TV (2160x3840+0+0, rotated right). HDMI-2 = DJ kiosk (primary, 1920x1080+3840+0). Screens manually fixed Apr 24 2026 — confirmed correct. Scripts updated to --app+wmctrl. |
| neonaidj003 | `100.81.90.125` | DJ booth | THE PONY EVANSVILLE | x86 Dell OptiPlex. HDMI-1 = crowd TV (720x1280+0+0, rotated left). HDMI-2 = DJ kiosk (primary, 1440x900+720+0). Big client visit Apr 25 2026. Scripts updated to --app+wmctrl. SSH: `neonaidj003@100.81.90.125` |
| neonaidj004 | `100.95.238.71` | DJ booth | THE PONY PENSACOLA | Placeholder Pi — pending hardware upgrade to x86 mini PC |

**Fleet dashboard**: `http://100.109.73.27:3001/fleet`
**Update pipeline**: `DJBOOTH_SKIP_HOMEBASE=1 ~/djbooth-update.sh` to bypass homebase and pull direct from GitHub.

**IMPORTANT — Homebase dead air alerts**: Homebase (HP Compaq) has no audio output and never will. "Dead air logged" warnings from homebase in the fleet dashboard are expected and can be ignored permanently. **FIXED Apr 22 2026**: `fleet-monitor.js` now suppresses dead-air Telegram alerts for any device whose name contains "homebase", so these will no longer spam Telegram.

**IMPORTANT — R2 sync purge behavior**: `syncMusicFromR2` in `server/r2sync.js` deletes local music files that are not present in R2. This is intentional (homebase deletions propagate to fleet) but dangerous if R2 is ever partially populated. **FIXED Apr 22 2026**: A 20% delta safeguard is now in place — if R2 has >20% fewer files than the local library, the purge is skipped entirely and a warning is logged. Never manually delete from R2 without understanding this logic.

## 🔒 LOCKED-IN HARDWARE WIRING — UNIVERSAL ON EVERY NEON AI DJ UNIT (Apr 25 2026)

**THIS IS THE WIRING ON EVERY DELL UNIT THE COMPANY WILL EVER SHIP. NEVER CHANGES.**

| Computer Port | Linux Name (xrandr) | Connected To |
|---|---|---|
| **Native HDMI port** | **HDMI-2** | **DJ KIOSK monitor** |
| **DisplayPort (with HDMI adapter)** | **HDMI-1** | **CROWD-FACING TV** |

Both appear as `HDMI-*` in xrandr because the DisplayPort adapter shows as HDMI to Linux.

**DETECTION RULE — applies to all launcher scripts forever:**
- Crowd display window → goes on **HDMI-1**, with whatever resolution/rotation xrandr reports
- DJ kiosk window → goes on **HDMI-2**, with whatever resolution/rotation xrandr reports
- **NEVER** detect by orientation (landscape vs portrait), size, or `primary` flag — these have all caused incidents (Apr 25 2026 evening: orientation-based logic flipped the screens at boot when xrandr reported a different layout than test-time).

If a unit is wired backwards (rare/never), the fallback in the launcher picks "any connected port that isn't the other one" — but this is purely defensive. Don't rely on it.

---

## ✅ Apr 25, 2026 — Session 49 (port-name screen mapping + per-unit display config) — LOCKED IN

**Two-part permanent fix for screen-flip + rotation-loss on 002 after reboot.**

After Session 48, kiosk + crowd worked at test-time but **flipped at next boot** because xrandr reported different rotation/geometry at boot vs test. The launcher used "W>H = landscape = kiosk" detection, which assigned the wrong monitor to each window.

**Root cause #1**: detecting kiosk-vs-crowd by screen ORIENTATION is fundamentally wrong. Every NEON AI DJ unit has the same physical wiring (see HARDWARE WIRING table above) — orientation varies per venue but port assignment is universal.

**Root cause #2**: xrandr rotation is session-only. Each reboot resets HDMI-1 to its default (landscape) unless something re-applies the rotation. GNOME's monitors.xml works for some setups but is fragile.

**Fix pushed (commits 02f0ad44, 8dbf7d9e)**:

### Part A — Port-name-based screen detection
Both launchers (`djbooth-kiosk.sh` and `djbooth-rotation-display.sh`) now use port name only:
- `djbooth-kiosk.sh` → reads xrandr line for **HDMI-2** → that's the kiosk geometry
- `djbooth-rotation-display.sh` → reads xrandr line for **HDMI-1** → that's the crowd geometry
- Fallback: if expected port doesn't exist (rare), uses any other connected port

No more orientation detection. No more `--primary` swapping. Just port-name lookup.

### Part B — Per-unit display rotation config (`~/.djbooth-display-config.sh`)
Both launchers source `~/.djbooth-display-config.sh` at startup if it exists. This file contains per-unit `xrandr` rotation commands that re-apply on every boot.

**File contents pattern** (one file per unit, owned by the unit's user):
```bash
#!/bin/bash
# Per-unit display rotation. Sourced by kiosk + crowd launchers at boot.
xrandr --output HDMI-1 --rotate <right|left|normal> 2>/dev/null || true
xrandr --output HDMI-2 --rotate <right|left|normal> 2>/dev/null || true
```

| Unit | HDMI-1 (crowd TV) | HDMI-2 (DJ kiosk) |
|---|---|---|
| **002** | `--rotate right` (portrait) | `--rotate normal` (landscape) |
| **003** | `--rotate left` (portrait) | `--rotate normal` (landscape) |

Setup command for any new unit:
```bash
cat > $HOME/.djbooth-display-config.sh << 'EOF'
#!/bin/bash
xrandr --output HDMI-1 --rotate <ROTATION> 2>/dev/null || true
xrandr --output HDMI-2 --rotate normal 2>/dev/null || true
EOF
chmod +x $HOME/.djbooth-display-config.sh
```

### Why this is locked in (why it won't regress):
1. The persistence file lives in user $HOME — update script never touches it
2. The source-line is hardcoded in both launcher heredocs in `djbooth-update-github.sh` — every future update rewrites the launchers but the source line stays
3. Port-name detection means rotation changes don't affect WHICH monitor gets WHICH content
4. Verified live on 002: rebooted, both screens come up with correct orientation + correct content automatically

**To set up 003 tonight**, run on 003 over SSH:
```bash
cat > $HOME/.djbooth-display-config.sh << 'EOF'
#!/bin/bash
xrandr --output HDMI-1 --rotate left 2>/dev/null || true
xrandr --output HDMI-2 --rotate normal 2>/dev/null || true
EOF
chmod +x $HOME/.djbooth-display-config.sh
~/djbooth-update.sh
```

---

## ✅ Apr 25, 2026 — Session 48 (commit 75a033d1)
**Kiosk launcher rewritten to use --app pattern (same fix already applied to crowd display).**

After the Apr 25 06:25 update on 002, the new launcher scripts wrote correctly to disk but the update didn't actively launch them. Manual recovery confirmed kiosk Chromium PID 51702 was running but **invisible on landscape monitor** — `--kiosk` mode landed it on the wrong monitor.

**Root cause (research-confirmed)**: `--kiosk` on Linux ignores `--window-position` regardless of how primary is set (well-documented Chromium bug; multiple sources: codegenes, vladvasiliu, multibrowse, RPi forums). The crowd display already uses the proven `--app` + `--window-position` + wmctrl-fullscreen workaround — kiosk did not.

**Fix pushed (commit 75a033d1)**:
1. **`~/djbooth-kiosk.sh` rewritten** to use `chromium --app=http://localhost:3001 --class=KioskChromium --user-data-dir=/tmp/chromium-kiosk --window-position=KX,KY --window-size=KW,KH`, then poll for window with wmctrl, remove maximized/fullscreen state, move to exact coords, then re-add fullscreen. Same pattern as crowd display. Detects landscape monitor by orientation (W>H) before launching.
2. **Update script manual mode** (line ~840) replaced inline `chromium --kiosk` with calls to `~/djbooth-kiosk.sh` and `~/djbooth-rotation-display.sh` — single source of truth.
3. **Update script boot fallback** (line ~890) same swap — calls canonical launchers.
4. **Watchdog (`djbooth-watchdog.sh`) rewritten** — calls `~/djbooth-kiosk.sh` instead of inlining `chromium --kiosk`. Detects via `pgrep -f "KioskChromium"` (matches `--class` flag set by launcher).
5. **`djbooth-watchdog` systemd service** now `enable && restart` instead of `start` (handles dead/disabled state from previous updates).
6. Added `xset s off / -dpms / s noblank` to kiosk launcher to prevent screen blanking.

**Verified live on 002 Apr 25 11:05 UTC**: `wmctrl -lG` confirms kiosk window at `3840,0 1920x1080` (HDMI-2 landscape), crowd at `0,0 2160x3840` (HDMI-1 portrait), both fullscreen. Pi can pull this fix via `~/djbooth-update.sh`.

---

## ✅ Apr 25, 2026 — Session 47 (commits a81139d source + d5d1e2a dist)
**Three fixes pushed for tonight's THE PONY EVANSVILLE client visit (003):**
1. **Playlist rule enforced client-side** — `RotationPlaylistManager.jsx` initial-build fallback (lines ~385-407) now uses playlist-only (fresh + cooldown) when dancer has playlist. The songsPerSet effect (lines ~440-540) and `DJBooth.jsx` live `onSongsPerSetChange` (~line 4610) now call `/api/music/select` per dancer instead of falling back to local genre pool. Mirrors server rule in `db.js:750 selectTracksForSet` — when dancer has playlist, NEVER pull from random library.
2. **TOP button** — cyan `ChevronsUp` button on each dancer card (RotationPlaylistManager ~line 1365) splices the dancer to the position right after `currentDancerId` without interrupting the current set. Hidden when dancer is on-stage / already next / rotation length ≤2. `lastMoveToTopTimeRef` cooldown prevents rapid-fire taps.
3. **Bulletproof screen launch** — `djbooth-update-github.sh` rewritten to be orientation-aware: W>H = kiosk landscape, H>W = crowd portrait. Crowd launch waits for app health check, uses wmctrl move-then-fullscreen, and a 60s heartbeat watchdog re-launches if the crowd window dies (only after >180s uptime to avoid boot races). Kiosk script ALWAYS rewritten on update to set primary on the landscape monitor before launch. Single source of truth = `djbooth-rotation-display.sh`.

**Pi update path verified live**: `https://raw.githubusercontent.com/jebjarrell1974-debug/dj-booth-rotation-system/main/artifacts/dj-booth/dist/public/public/djbooth-update-github.sh` (926 lines). 003 has NOT yet pulled — user must run update on 003.

---

## ⚠️ Apr 24–25, 2026 — Incident Log

### ROOT CAUSE FOUND AND FIXED: --kiosk ignores --window-position on Linux
**Confirmed Chromium bug**: `--kiosk` mode on Linux completely ignores `--window-position`. This caused the crowd screen to ALWAYS open on the primary display (DJ kiosk monitor) regardless of position flags, putting both screens on the same monitor.

**The fix (pushed Apr 25 2026)**: All crowd screen launches now use `--app=URL` instead of `--kiosk`, with `--window-position` set to the crowd TV's exact xrandr coordinates, followed by `wmctrl -x -r "RotationChromium" -b add,fullscreen` to force fullscreen on that monitor. No primary swapping needed — no race condition possible.

**Files updated**: `djbooth-update-github.sh` (writes scripts on every update run), `x86-setup.sh` (writes scripts on fresh install). Both now produce identical correct scripts.

### All Dell Unit Display Configuration (CONFIRMED — 002 verified Apr 24 2026)
- **Both outputs show as HDMI-* in xrandr** — Dell OptiPlex uses an HDMI adapter on the DisplayPort, so both appear as HDMI to Linux
- **HDMI-1** = crowd-facing TV (portrait, rotated right on 002 / rotated left on 003), non-primary
- **HDMI-2** = DJ kiosk monitor (landscape, primary)
- **The only reliable rule**: PRIMARY display = DJ kiosk. NON-PRIMARY = crowd TV. Never detect by port name.

**002 confirmed xrandr layout:**
- `HDMI-1 connected 2160x3840+0+0 right` — crowd TV at position 0,0 (big portrait TV)
- `HDMI-2 connected primary 1920x1080+3840+0` — DJ kiosk at position 3840,0

**003 confirmed xrandr layout:**
- `HDMI-1 connected 720x1280+0+0 left` — crowd TV at position 0,0
- `HDMI-2 connected primary 1440x900+720+0` — DJ kiosk at position 720,0

### How djbooth-rotation-display.sh and djbooth-display-watcher.sh work (current — correct)
Both scripts are rewritten fresh by the update script on every update run. They:
1. Read xrandr to find the non-primary display (crowd TV) and its exact geometry (position + size)
2. Launch `chromium --app=http://localhost:3001/RotationDisplay --class=RotationChromium --window-position=X,Y --window-size=W,H`
3. Wait 5 seconds, then `wmctrl -x -r "RotationChromium" -b add,fullscreen`

This places the crowd screen at the crowd TV's exact coordinates and forces it fullscreen there. No primary swap, no race condition, works on any unit regardless of resolution or rotation.

### 002 Status (Apr 24–25, 2026)
- Screens were backwards after earlier update (crowd TV showing kiosk, DJ monitor showing rotation display)
- Manually fixed Apr 24 evening — confirmed working: crowd TV showing rotation display, DJ monitor showing kiosk
- Scripts on disk are now the correct `--app+wmctrl` versions (written by last update run)
- Will survive reboots and future updates
- No `~/relaunch-djbooth.sh` on 002 — the kiosk launcher is `~/djbooth-kiosk.sh`

**If 002 screens go wrong again, run these 3 commands via SSH:**
```bash
# Step 1 — kill everything
export DISPLAY=:0 XAUTHORITY=/home/neonaidj002/.Xauthority && pkill -f chromium 2>/dev/null; sleep 3; rm -f ~/.config/chromium/Singleton*

# Step 2 — set primary and relaunch kiosk
xrandr --output HDMI-2 --primary && bash ~/djbooth-kiosk.sh &

# Step 3 — wait 12 seconds after step 2, then launch crowd screen
rm -rf /tmp/chromium-rotation && chromium --app=http://localhost:3001/RotationDisplay --class=RotationChromium --user-data-dir=/tmp/chromium-rotation --window-position=0,0 --window-size=2160,3840 --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required --force-device-scale-factor=1 & sleep 3 && wmctrl -x -r "RotationChromium" -b add,fullscreen
```

### 003 Status (Apr 25, 2026 — BIG CLIENT NIGHT)
- Installed at THE PONY EVANSVILLE, 300 miles from owner
- Scripts should be correct from last update run (same --app+wmctrl approach)
- Client visiting Apr 25 evening
- **If 003 screens go wrong**, same 3-command fix but use 003 geometry:
  - HDMI-1 (crowd TV) position: 0,0 size: 720x1280
  - HDMI-2 (kiosk) position: 720,0
```bash
# Step 1
export DISPLAY=:0 XAUTHORITY=/home/neonaidj003/.Xauthority && pkill -f chromium 2>/dev/null; sleep 3; rm -f ~/.config/chromium/Singleton*

# Step 2
xrandr --output HDMI-2 --primary && bash ~/djbooth-kiosk.sh &

# Step 3 (wait 12s after step 2)
rm -rf /tmp/chromium-rotation && chromium --app=http://localhost:3001/RotationDisplay --class=RotationChromium --user-data-dir=/tmp/chromium-rotation --window-position=0,0 --window-size=720,1280 --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required --force-device-scale-factor=1 & sleep 3 && wmctrl -x -r "RotationChromium" -b add,fullscreen
```

### Earlier fixes also pushed Apr 24–25 2026
- **npm install now retries up to 3x** and verifies express is findable before proceeding
- **Kiosk primary guard** in update script — if rotated display is somehow primary, swaps it back before kiosk launch
- **Crowd TV rotation preserved** — scripts detect existing rotation from xrandr, never hardcode it

---

## Dell OptiPlex 7010 Micro — Proven Setup (neonaidj003, THE PONY EVANSVILLE, Apr 2026)

This is the complete reference configuration for the Dell unit that is live and working as of April 20, 2026. Use this as the exact template for every new Dell OptiPlex unit. Everything below has been tested and confirmed working on neonaidj003.

---

### REQUIRED SYSTEM PACKAGES (run on every new unit before starting the app)

This is the single most important step. The app spawns these binaries directly — if they are missing, features fail silently or crash. Install all of them before running the update script or starting the service.

✅ **SAFE MID-VENUE** — apt install does not stop or restart any service. Music continues uninterrupted.
```bash
sudo apt update
sudo apt install -y ffmpeg git chromium x11-xserver-utils xinput aubio-tools curl
```

| Package | Binary | Used for | Impact if missing |
|---|---|---|---|
| `ffmpeg` | `ffmpeg`, `ffprobe` | Voice stitching, promo mixing, LUFS analysis, BPM analysis | **CRITICAL** — voice generation fails entirely (`spawn ffprobe ENOENT`) |
| `chromium` | `chromium` | Kiosk browser | **CRITICAL** — no display |
| `x11-xserver-utils` | `xrandr` | Display rotation, remote screen control | Remote display commands fail |
| `xinput` | `xinput` | Touchscreen mapping to correct screen | Touches register on wrong display |
| `git` | `git` | Version hash shown in fleet dashboard | Shows "unknown" — non-fatal |
| `aubio-tools` | `aubio` | BPM detection for tracks without embedded BPM tags | BPM analysis skipped — non-fatal |
| `curl` | `curl` | Update script downloads from GitHub | Update script fails to download |

**Confirmed missing on neonaidj003 at install time: `ffmpeg`/`ffprobe`** — caused all voice generation to fail with `spawn ffprobe ENOENT`. Fixed by `sudo apt install ffmpeg`.

---

## ✅ FIXED Apr 24, 2026 — Promo Regeneration Bug (commit 8672088e)

### Problem
Promos that worked for 1–2 days suddenly played gibberish mid-audio on neonaidj003.

### Root Cause (confirmed)
`AnnouncementSystem.jsx` line 773: when ANY playback error occurs (even a transient audio context hiccup, memory pressure, or 1-second network blip), the recovery logic:
1. Deletes the good file from IndexedDB (local)
2. **Also deletes the good file from the server** (`DELETE /api/voiceovers/:cacheKey`)
3. Regenerates from ElevenLabs
4. If ElevenLabs returns garbled audio during that regeneration, the bad file is saved over the good one permanently

The server delete (step 2) is the mistake. A transient playback error doesn't mean the server file is corrupted — it just means something went wrong locally at that moment.

### The Fix (ready to implement tonight — needs your approval)
Change the recovery path so it:
1. Deletes from IndexedDB only (correct — clears local cache)
2. **Does NOT delete from server** — tries to reload the server copy first
3. Only if the server copy ALSO fails to play → then delete server copy and regenerate

This means a glitch never wipes a good promo file. Only a confirmed-unplayable server file triggers regeneration.

**File to change**: `artifacts/dj-booth/src/components/dj/AnnouncementSystem.jsx` lines 771–783
**Risk**: None — this is strictly safer. Normal generation flow is untouched. Only the error recovery path changes.
**After fix**: rebuild dist, push to GitHub, run update on all units.

---

## ✅ FIXED Apr 24, 2026 — Music Ducks Before Voice is Ready (commit 8672088e)

### Problem
User on 003 reported: music got "really turned down for about 5-8 seconds" before the dancer announcement for Solar actually played, then volume came back normal.

### Root Cause (confirmed)
`AudioEngine.jsx` line 805: `duck()` is called immediately when `playAnnouncement()` is triggered — before the audio file has loaded. The music drops, then `voice.src = audioUrl` and `voice.load()` are called, and the browser sits buffering the file for 5–8 seconds. The crowd hears dead air with ducked music, then the announcement plays.

```
duck()          ← line 805, INSTANT
voice.src = …  ← line 829, starts loading
voice.load()   ← line 830
await play()   ← line 863, plays only after buffering complete (5-8s later)
```

### The Fix (ready to implement tonight — needs your approval)
Reorder the sequence:
1. Set `voice.src` and call `voice.load()` first
2. Wait for `canplay` event (audio is buffered and ready)
3. **Then** `duck()` and immediately `play()` back-to-back

Duck delay is less than 50ms before audio starts — imperceptible. The dead-air gap disappears.

**File to change**: `artifacts/dj-booth/src/components/dj/AudioEngine.jsx` lines 797–869
**Risk**: Very low — only changes the timing of duck vs. load, not the logic of either. Normal playback flow is unchanged.
**After fix**: rebuild dist, push to GitHub, run update on all units.

---

## ✅ FIXED Apr 24, 2026 — Deactivating Song 1 Ends Set Instead of Playing Song 2 (commit 8672088e)

### Problem (reported by 003 during show)
Dancer was on her first song in a 2-song set. DJ deactivated the song. Instead of transitioning with a voiceover to her second song, the system played the outro and ended her entire set. She only got one song.

### Root Cause (confirmed — code traced)
`handleDeactivateConfirm` (line 2817) removes the deactivated track from the dancer's song array:
- Before: `[song1, song2]` (length 2)
- After filter: `[song2]` (length 1)

Then it calls `handleSkip()`, which checks at line 2440:
```javascript
if (songNum < songsPerSet  &&  songNum < tracksRemaining)
if (    1   <      2       &&      1   <        1       )  // FALSE
```
`currentSongNumber` is still 1 (playing song 1), but the array is now length 1. `1 < 1` is false → the system thinks the set is done → outro plays → set ends. Song 2 never plays.

### The Fix (ready to implement tonight — needs your approval)
One line added to `handleDeactivateConfirm`, right before calling `handleSkip`:
```javascript
// Decrement position so handleSkip sees remaining songs correctly
if (currentSongNumberRef.current > 0) {
  currentSongNumberRef.current = currentSongNumberRef.current - 1;
  setCurrentSongNumber(currentSongNumberRef.current);
}
handleSkipRef.current?.();
```
With this: `songNum` becomes 0, array is `[song2]` (length 1), check becomes `0 < 2 && 0 < 1` = TRUE → plays song2 with proper voiceover transition.

Normal end-of-song flow is completely unaffected — this code only runs in the deactivation path.

**File to change**: `artifacts/dj-booth/src/pages/DJBooth.jsx` ~line 2822
**Risk**: None to normal flow. Deactivation now correctly continues the set instead of killing it.
**After fix**: rebuild dist, push to GitHub, run update on all units.

---

## ✅ FIXED Apr 24, 2026 — .Trash-1000 Showing in Music Library (commit 8672088e)

### Problem
The homebase music library is showing a `.Trash-1000 (33)` folder containing 33 deleted songs. These were deleted from the music drive via file manager, which stored them in Linux's drive-local trash folder (`.Trash-1000`) instead of permanently deleting them.

### Root Cause (confirmed)
`musicScanner.js` line 25 correctly skips hidden **files** (names starting with `.`), but line 22–23 recurses into **directories** without any hidden-folder check:

```js
if (entry.isDirectory()) {
  walkDirectory(fullPath, rootPath, results); // ← .Trash-1000 walks right in
} else if (entry.isFile()) {
  if (entry.name.startsWith('.')) continue;  // ← only files are filtered
```

`.Trash-1000` is a directory so it bypasses the filter entirely.

### The Fix (ready to implement tonight — needs your approval)
Two-part fix:

**Part 1 — Code** (one line): Add the same hidden-name check to directories:
```js
if (entry.isDirectory()) {
  if (entry.name.startsWith('.')) continue; // skip .Trash-1000, .DS_Store, etc.
  walkDirectory(fullPath, rootPath, results);
```
This permanently prevents ANY hidden folder (current or future trash, macOS junk, etc.) from appearing in the music library on any venue's drive.

**Part 2 — Homebase cleanup**: SSH to homebase and permanently delete the trash folder:
```bash
rm -rf /path/to/music/drive/.Trash-1000
```
(Need to confirm the exact music drive mount path on homebase first.)

**File to change**: `artifacts/api-server/server/musicScanner.js` line 22
**Risk**: None — only adds a skip for hidden directories. All normal music folders are unaffected.
**After fix**: Server auto-reloads (no rebuild needed for API server), run a manual rescan, confirm `.Trash-1000` is gone.

---

### Bug Fixes Applied Apr 22, 2026 — Deactivated Song Replay (GitHub commit `da5aeed`)

#### Deactivated song still played after being blocked
- **Problem**: A song that the DJ deactivated via the Deactivate button played again on a subsequent dancer's set.
- **Root cause — two holes working together**:
  1. **Stream endpoint had no block check**: `/api/music/stream/:id` called `getMusicTrackById(id)` which is `SELECT * WHERE id = ?` — no `blocked = 0` guard. Any cached stream URL from before deactivation still worked.
  2. **Pre-pick cache not purged**: When `handleDeactivateConfirm` succeeded it called `handleSkipRef.current()` to skip the current song but never scanned `rotationSongsRef.current` to remove the blocked song from upcoming dancers' queued sets. If the song had been pre-picked for Dancer B before the block, it played on Dancer B's set anyway via the unguarded stream URL.
- **Fix 1 (server — `artifacts/api-server/server/index.js`)**: Added `if (track.blocked) return res.status(403).json({ error: 'Track is deactivated' })` immediately after the track lookup in the stream endpoint. Blocks the file at the byte-stream level regardless of how the URL was obtained.
- **Fix 2 (client — `artifacts/dj-booth/src/pages/DJBooth.jsx`)**: After a successful block API call, `handleDeactivateConfirm` now iterates all entries in `rotationSongsRef.current`, filters out every track whose `name` matches the blocked song, and writes the cleaned object back to both `rotationSongsRef` and `setRotationSongs` state. Affected dancers will fetch fresh tracks on their next transition.

---

### Bug Fixes Applied Apr 20, 2026 (all in GitHub, pulled by update script)

#### 1. Promo + Dancer Voiceover Stitching Fix
- **Problem**: "Promo generation failed: Failed to stitch audio parts" and "voice_generate_fail" Telegram alerts — both promos AND dancer voiceovers were failing to generate when the TTS script was more than one chunk long.
- **Root cause**: `POST /api/voiceovers/stitch-chunks` used ffmpeg `-c copy` to concatenate MP3 chunks. MP3 frame alignment is unreliable between separately-encoded chunks — `-c copy` fails when headers/frames don't match.
- **Fix**: Changed the final concat step to re-encode with `libmp3lame -b:a 192k -ar 44100` instead of `-c copy`. Each chunk is still individually trimmed/re-encoded first, then the final concat also re-encodes for a clean output.
- **File**: `artifacts/api-server/server/index.js` (~line 770)
- **Commit**: `ab05f46`

#### 2. RotationDisplay Font Sizes (Crowd-Facing Screen)
- **Problem**: With ~15 entertainers in rotation, names were too large and the list overflowed off screen.
- **Fix**: Reduced font sizes — current performer name: `1.85rem`, rotation list names: `1.4rem` (FIXED_FONT constant), countdown timer: `3rem`.
- **File**: `artifacts/dj-booth/src/pages/RotationDisplay.jsx`
- **Commit**: `99fe558`

#### 3. RotationDisplay Right-Side Cutoff on Any Monitor
- **Problem**: The rotation display was cut off on the right edge. Happened on any monitor that wasn't exactly the build resolution.
- **Root cause**: Outer container used `h-screen` (height only) without setting width. Browser guessed the width incorrectly. No global box-sizing reset, so padding could push content outside the viewport. Letter-spacing on large names added extra width.
- **Fix**:
  - Outer container now uses inline `width: 100vw, height: 100vh, overflow: hidden` instead of Tailwind classes
  - Added CSS reset in `STYLES`: `*, *::before, *::after { box-sizing: border-box; }` and `html, body { margin: 0; padding: 0; width: 100%; overflow: hidden; }`
  - Padding changed from fixed `px-8` to viewport-relative `4vw` so it scales with any screen size
  - Dancer names in the list now have `overflow: hidden, textOverflow: ellipsis, whiteSpace: nowrap` so very long names clip instead of overflowing
- **File**: `artifacts/dj-booth/src/pages/RotationDisplay.jsx`
- **Commit**: `f3b3d4c`

#### 5. ffprobe Not Installed → All Voice Generation Fails (Apr 20, 2026)
- **Problem**: All dancer voiceovers and promos failing with `Stitch chunks failed: spawn ffprobe ENOENT`. Voice generation produced zero audio.
- **Root cause**: `ffprobe` (part of the `ffmpeg` package) was not installed on the Dell. The stitch-chunks endpoint calls `getAudioDuration()` using `ffprobe` to measure each audio chunk before trimming — when `ffprobe` is missing, the whole endpoint crashes before any audio is produced.
- **Immediate fix on Dell**: `sudo apt install ffmpeg -y` — safe to run while live, no service restart needed.
- **Code hardening**: Stitch endpoint now wraps the `getAudioDuration` call in try/catch. If `ffprobe` fails (missing or error), it skips the tail-trim and just re-encodes the chunk for consistent format. Voice generation succeeds even without `ffprobe`, just without the 0.2s tail trim.
- **Telegram alert fix**: Telegram "VOICE FAILURE" alert now shows the actual error reason (`Reason: spawn ffprobe ENOENT`). Previously the `sample.error` field was captured but not included in the alert message — you only saw "VOICE FAILURE" with no cause.
- **File**: `artifacts/api-server/server/index.js` (stitch resilience), `artifacts/api-server/server/fleet-monitor.js` (Telegram fix)
- **Commit**: `b982fe2`
- **Lesson**: `ffmpeg`/`ffprobe` must be listed in the mandatory install step for every new unit. See REQUIRED SYSTEM PACKAGES above.

#### 4. Virtual Keyboard Covering Input Fields
- **Problem**: When filling out forms near the bottom of any tab (especially the Promos section), the virtual keyboard slid up over the input field, hiding what you were typing. Could not see the field.
- **Root cause**: The keyboard's scroll-into-view logic used `window.scrollBy()` — but the DJ Booth uses `overflow-auto` divs inside tabs, not the window, as scroll containers. `window.scrollBy()` had no effect on those containers.
- **Fix**: Complete rewrite of `scrollInputIntoView` in `VirtualKeyboard.jsx`:
  - New `getScrollParent()` function walks up the DOM to find the actual scrollable ancestor div
  - Temporarily adds `paddingBottom` to that container equal to the keyboard height so there's room to scroll
  - Scrolls the container (not window) so the active input sits above the keyboard with clearance
  - On keyboard dismiss: removes the added padding and restores the container to its original state
- **File**: `artifacts/dj-booth/src/components/VirtualKeyboard.jsx`
- **Commit**: `274b92e`

---

### Display Setup (UPDATED Apr 25 2026 — confirmed on 002 and 003)

**The golden rule: PRIMARY display = DJ kiosk. NON-PRIMARY = crowd TV. Always.**

Both Dell outputs appear as `HDMI-*` in xrandr because the DisplayPort uses an HDMI adapter. Never try to detect by port name — always use primary/non-primary.

- **Primary display (HDMI-2)** = DJ kiosk monitor, landscape. `chromium --kiosk http://localhost:3001` opens here automatically because it always opens on primary.
- **Non-primary display (HDMI-1)** = crowd-facing TV, portrait (rotated right on 002, rotated left on 003).
- **Touchscreen** = ILITEK USB touchscreen. Find it with `xinput list | grep -i ILITEK`. Map to the DJ kiosk output: `xinput map-to-output <id> HDMI-2`

**`~/djbooth-kiosk.sh`** — launches the DJ kiosk Chromium on the primary display. Used by GNOME autostart and the update script.

**`~/djbooth-rotation-display.sh`** — launches the crowd TV Chromium using `--app` + exact xrandr position + wmctrl fullscreen. Rewired fresh on every update run. Run this if the crowd screen is blank or wrong.

**`~/djbooth-display-watcher.sh`** — background loop that watches for `/tmp/djbooth-display-trigger` and relaunches the crowd screen when triggered by the update script. Also rewritten fresh on every update run.

### CRITICAL: --kiosk vs --app for the crowd screen
**`--kiosk` ignores `--window-position` on Linux** — confirmed Chromium bug. If you use `--kiosk` for the crowd screen, it ALWAYS opens on the primary display (DJ monitor), no matter what position flags you give it.

**Always use `--app=URL` for the crowd screen**, followed by wmctrl to force fullscreen. Example for 002:
```bash
chromium --app=http://localhost:3001/RotationDisplay \
  --class=RotationChromium \
  --user-data-dir=/tmp/chromium-rotation \
  --window-position=0,0 --window-size=2160,3840 \
  --noerrdialogs --disable-session-crashed-bubble \
  --autoplay-policy=no-user-gesture-required \
  --force-device-scale-factor=1 &
sleep 5 && wmctrl -x -r "RotationChromium" -b add,fullscreen
```

**`--kiosk` is fine for the DJ kiosk** because it opens on the primary display by default — that's exactly what we want.

### If Screens Look Wrong After an Update

**Quickest fix — crowd screen only** (safe mid-venue, music unaffected):
```bash
bash ~/djbooth-rotation-display.sh
```

**Full reset — both screens** (after close only — kills all Chromium, music stops ~15s):
```bash
export DISPLAY=:0 XAUTHORITY=/home/$(whoami)/.Xauthority
pkill -f chromium 2>/dev/null; sleep 3; rm -f ~/.config/chromium/Singleton*
xrandr --output HDMI-2 --primary && bash ~/djbooth-kiosk.sh &
# Wait 12 seconds, then:
bash ~/djbooth-rotation-display.sh
```

### Audio
- USB DAC with S/PDIF digital optical passthrough → venue mixer
- **NEVER set software volume above 1.0** — S/PDIF is a digital passthrough; anything above 1.0 clips hard and sounds distorted. The venue mixer's gain knob is the real volume control.
- Audio managed by **PipeWire**. Use `wpctl`, NOT `pactl` (PulseAudio commands don't work reliably with PipeWire).
- Set volume: `wpctl status` to find the sink ID, then `wpctl set-volume <sink-id> 1.0`

### On-Screen Keyboard (Important — prevents double keyboard)
The app has a full built-in virtual keyboard. Do NOT also run a system on-screen keyboard.
- On first setup, disable system keyboard: 
```bash
mkdir -p ~/.config/autostart
printf '[Desktop Entry]\nHidden=true\n' > ~/.config/autostart/onboard-autostart.desktop
printf '[Desktop Entry]\nHidden=true\n' > ~/.config/autostart/matchbox-keyboard.desktop
gsettings set org.gnome.desktop.a11y.applications screen-keyboard-enabled false 2>/dev/null || true
pkill onboard 2>/dev/null; pkill matchbox-keyboard 2>/dev/null; echo "Done."
```
- If two keyboards ever appear again, run the above block.

### Do NOT Install Watchdog
A watchdog daemon was installed on neonaidj003 earlier and caused a duplicate kiosk crisis — two Chromium windows launched simultaneously and fought each other. The systemd service auto-restart + `~/relaunch-djbooth.sh` is sufficient. Do not install any watchdog/supervisor daemon on these units.

### Update Script
⛔ **RUN AFTER CLOSE ONLY — NOT SAFE MID-VENUE.** The script restarts the djbooth service and kills Chromium, which stops music for ~10–15 seconds and blacks out both screens during restart.
```bash
set -e
echo "📥 Downloading latest from GitHub..."
TMP=$(mktemp -d) && cd "$TMP"
curl -sL https://github.com/jebjarrell1974-debug/dj-booth-rotation-system/archive/refs/heads/main.tar.gz | tar xz
SRC="$TMP/dj-booth-rotation-system-main"
APP="$HOME/djbooth"
echo "💾 Backing up..."
mkdir -p "$APP/.backup"; TS=$(date +%s)
cp -r "$APP/artifacts/dj-booth/dist"     "$APP/.backup/dist-$TS"   2>/dev/null || true
cp -r "$APP/artifacts/api-server/server" "$APP/.backup/server-$TS" 2>/dev/null || true
echo "🚚 Updating frontend..."
rm -rf "$APP/artifacts/dj-booth/dist" && cp -r "$SRC/artifacts/dj-booth/dist" "$APP/artifacts/dj-booth/dist"
echo "🚚 Updating backend..."
rm -rf "$APP/artifacts/api-server/server" && cp -r "$SRC/artifacts/api-server/server" "$APP/artifacts/api-server/server"
echo "🔄 Restarting service..."
sudo systemctl restart djbooth && sleep 4
echo "🖥️  Reloading kiosk..."
pkill -f chromium 2>/dev/null || true
echo "⏳ Waiting for DJ kiosk to come back..."
sleep 8
echo "🎪 Restoring crowd screen..."
~/djbooth-rotation-display.sh &
echo "✅ DONE"
sudo systemctl status djbooth --no-pager | head -10
rm -rf "$TMP"
```
**What this does:**
- Downloads full latest codebase from GitHub as a tarball (no git required)
- Backs up current `dist/` and `server/` to `~/djbooth/.backup/<timestamp>/` before touching anything
- Replaces only: frontend build (`dist/`) and backend code (`server/`)
- Leaves untouched: database, voiceovers, music library, node_modules, configs, API keys
- Restarts the djbooth systemd service
- Kills Chromium so the autostart relaunches it with the fresh frontend
- Interrupts music for ~10–15 seconds — run between sets

**After running this script**, also run `~/djbooth-rotation-display.sh` to restore the crowd screen and touchscreen mapping, since killing Chromium resets them.

### CRITICAL: Frontend Changes Require a Dist Rebuild in Replit First
The Dell update script does NOT run Vite. It downloads and serves the pre-built `dist/` folder directly from GitHub. If only source files (`artifacts/dj-booth/src/`) are changed in Replit and pushed to GitHub without rebuilding `dist/`, the Dell will still show the old frontend even after running the update script.

**Before any GitHub push that includes frontend changes:**
1. In Replit: `cd /home/runner/workspace/artifacts/dj-booth && npx vite build --config homebase-vite.config.js`
2. Push the rebuilt `dist/` to GitHub (see the github-pi-update skill for the exact push script)
3. Then the Dell update script will pick up the new frontend

Use `homebase-vite.config.js`, NOT `vite.config.ts` — the Replit config requires PORT/BASE_PATH env vars that aren't available during a manual build.

This was the root cause of "I pushed it but the screen didn't change" — the dist was stale.

---

## Hardware Upgrade Plan — x86 Mini PC (GMKtec G3 PRO)

**Target hardware**: GMKtec Nucbox G3 PRO
- CPU: Intel Core i3-10110U (2C/4T, 4.1 GHz boost) — NOTE: this is i3-10110U, NOT the N100 discussed earlier
- RAM: 16GB DDR4 dual-channel
- Storage: 512GB M.2 SATA SSD + NVMe expansion slot
- Ports: USB 3.2 ×4, HDMI ×2 (4K@60Hz), 3.5mm audio jack
- Network: WiFi 6, 2.5GbE Ethernet, Bluetooth 5.2
- OS: Ships with Windows 11 Pro — **install Debian 12 Bookworm**

**Audio for x86 units**: Use a **USB audio dongle** (e.g. UGREEN USB Audio Adapter ~$15-20). Do NOT rely on the built-in 3.5mm jack for club use — motherboard audio picks up electrical noise and can cause ground loop hum through the venue PA. USB audio is physically isolated, plug-and-play on Linux, and trivially replaceable.

**App compatibility on x86 Debian**:
- Node.js server, SQLite, R2 sync, all API routes — ✅ zero changes
- React frontend, AudioEngine, Chrome kiosk — ✅ zero changes
- Systemd service setup — ✅ identical commands
- Tailscale VPN — ✅ same install script
- CPU temperature (`/sys/class/thermal/thermal_zone0/temp`) — ✅ works on x86 Linux
- FFmpeg/LUFS analysis — ✅ actually faster on x86 than Pi ARM
- `chromium` package name — ✅ same on Debian x86
- `djbooth-update.sh` update script — ✅ works on any Debian Linux
- **Kiosk display setup** — ⚠️ needs minor update: current script configures `labwc` (Pi 5 Wayland compositor). x86 Debian uses a standard desktop environment. The `pi-setup.sh` script's display/autostart section needs to be updated for x86 before first deployment.
- `wlr-randr` screen rotation — ⚠️ Pi-specific, skip on x86 unless display needs rotation

**Setup process for new x86 unit**:
1. Install Debian 12 Bookworm (wipe Windows)
2. Run modified `pi-setup.sh` (will be updated when hardware arrives)
3. Install Tailscale, connect to fleet
4. Plug in USB audio dongle, set as default ALSA device
5. Run `~/djbooth-update.sh` to pull latest code and configure kiosk

## User Preferences
- Nightclub dark theme with neon cyan accent (#00d4ff) and blue secondary (#2563eb)
- Deep navy-black backgrounds (#08081a, #0d0d1f) with blue-tinged borders (#1e293b)
- Neon dancer color palette for club atmosphere
- App name: "NEON AI DJ" (logo at `/public/neon-ai-dj-logo.jpeg`)
- Minimize CPU/GPU usage for local hardware operation
- Do not modify `AudioEngine.jsx` audio behavior (crossfade, ducking, gain bus architecture are finalized). The `loadTrack` method accepts both URL strings, FileSystemFileHandle objects, AND `{ url, name, auto_gain }` objects — when `auto_gain` is present it pre-populates the gain cache so the 10s analysis is skipped. Voice announcements route through a separate GainNode (`voiceGainRef`) for independent volume boost (default 1.5x / 150%).
- **LUFS target**: `AUTO_GAIN_TARGET_LUFS = -10` (club standard, changed from -14 streaming standard). Server-side FFmpeg analysis stores per-track gain in `music_tracks.auto_gain`; pre-computed values override the browser RMS fallback.
- **Voice cache version**: `CURRENT_VOICE_VERSION = 'V11'` in `AnnouncementSystem.jsx`; `NUM_VARIATIONS = 5`; varNum is now truly random (no back-to-back repeats).
- Production database stored at `/home/runner/data/djbooth.db` (outside project directory) to survive republishing. Development uses `./djbooth.db`. Configurable via `DB_PATH` env var.
- **ALWAYS ask before making ANY changes** — describe exactly what you plan to change and why, wait for explicit approval, THEN implement. This applies to every single file edit, terminal command on the Pi, and code change — no exceptions, even for "obvious" fixes.
- **NEVER tell the user to delete files on a Pi** — if disk space is needed, ask what they want to remove
- **NEVER push files that don't belong on Pis** — no attached_assets, no .local/state, no sample music, no database files
- **NEVER modify Pi service files, environment variables, or database paths** without explicit user approval
- **GitHub push must ALWAYS exclude**: attached_assets, .local, music, voiceovers, .db/.db-wal/.db-shm, node_modules, dist, .cache, .config, .upm
- **API keys are in browser localStorage on each Pi** — code updates should NEVER affect them, but disk corruption can wipe them
- **Music path on Pony Nation Pi**: `/home/neonaidj001/djbooth/music/` — set in systemd service file, DO NOT CHANGE
- **Music is synced to/from R2** — even if files are lost locally, R2 has the backup and will re-download on service restart
- R2 boot sync (voiceovers + music) runs on every boot — this is intentional for Pi morning reboots
- Replit should NOT have a music path set — no local music folder needed here
- **Before any GitHub push**: verify the file list does NOT contain screenshots, music files, database files, or Replit internal state files
- **Test impact on Pi before pushing**: consider what the update script will do with every change

## System Architecture
The application uses React 18, Vite, and TailwindCSS for the frontend, with Radix UI primitives and shadcn/ui styling. UI/UX is designed with a dark nightclub theme featuring neon cyan and blue accents, prioritizing low-power device performance. `localStorage` manages entities, while `IndexedDB` provides fast session caching for voiceover audio. State management uses React Query, and routing is handled by React Router v6. Configuration settings are stored in the browser's `localStorage` on each Pi.

Music tracks are indexed server-side in a SQLite `music_tracks` table, supporting various audio formats and genre extraction. A background FFmpeg LUFS analysis process (`server/lufsAnalyzer.js`) runs at boot — 3 songs in parallel at -10 LUFS (club standard) — storing `lufs` and `auto_gain` values per track. Pre-computed gain values are served in all track API responses and the fleet music manifest, so venue Pis receive gain values without running FFmpeg themselves. The browser's 10-second RMS fallback is preserved for tracks not yet analyzed. A custom dual-deck audio engine manages seamless music playback with equal-power crossfading, audio ducking, auto-gain loudness normalization, a brick-wall limiter, and sophisticated announcement overlays. Beat-matched crossfading adjusts incoming track tempo, and a 3-band EQ is available for music and voice. Voice announcements are dynamically generated using ElevenLabs TTS and OpenAI, adapting to club energy levels (5-tier system) and operating hours.

An Express + SQLite backend on port 3001 manages shared dancer data and PIN authentication, optimized for low-power devices. Critical state persists to `localStorage` for crash recovery. Features include a 4-hour song cooldown, configurable songs-per-set, interstitial break songs, genre filtering, and a Playback Watchdog for audio recovery. The `DJBooth` component remains mounted persistently to preserve audio engine state. An Autoplay Queue feature manages music when no entertainers are present.

A fleet management system enables centralized control of multiple Pi units, providing device registration, heartbeat monitoring (including hardware health metrics like CPU temp and RAM), error log collection, voiceover sharing, music manifest tracking, app update distribution, and sync coordination via Cloudflare R2. An admin dashboard offers an overview of device health, API cost tracking per unit, a master voiceover library, and sync history. A Pi-side sync client handles scheduled closed-hours synchronization. Voice recording functionality is available via the Voice Studio, featuring a record-preview-save workflow and Auphonic API integration for professional post-processing. System updates are managed via `djbooth-update.sh` with optimized backup procedures.

## Announcement System (Current State — March 2026)
- **3 announcement types**: intro, round2, outro (transition type removed)
- **5 variations per type per dancer** (NUM_VARIATIONS = 5)
- **Energy level is always auto** (time-based, 5-tier system) — manual energy override UI removed
- **No club name or day-of-week** in voiceover prompts or cache keys — prompts explicitly instruct "do not mention day/club/time"
- **No club specials** in voiceover prompts — specials are moving to the commercial playback system instead
- **Cache keys**: `{type}-{dancerName}-var{N}-V11` — voice version `V11` (bump if prompt/voice changes)
- **Dancer changeover flow**: outro (outgoing) → commercial (if due) → track starts → intro (incoming) — no overlap
- **Failed generation skip**: `failedGenerationsRef` Set prevents retry storms for the session
- **Pre-cache**: buffers upcoming dancers with all 3 types × 5 variations each (15 voiceovers per dancer)
- **Variant selection rules (Session 45)**:
  - `getNextVariationNum` picks randomly from 1–5, avoiding: last used for that key, cross-transition match (outro→intro or intro→outro), same-set pairing (intro and outro for same dancer's set use different numbers)
  - Tracks: `lastPlayedTypeVariantRef` (global, per type) + `currentSetIntroVariantRef` (per dancer name)
- **Corruption guard (Session 45)**:
  - `validateAudioBlob()` runs `decodeAudioData()` before caching; retries generation up to 3× on failure
  - `deleteFromIndexedDB()` helper removes bad entries; playback failure auto-purges IDB + server and regenerates once
- **ElevenLabs credits**: ~180K remaining this billing cycle; key `6e6ca8...71342`, voice ID `8RV9Jl85RVagCJGw9qhY`
- **Stale IDB cleanup**: `cleanupStaleIDBEntries` auto-purges old cache versions on Pi load
- **Song cooldown**: 6 hours (updated from 4h in Session 44)

## Recent Session Fixes (Sessions 54–55 — March 2026)

### Session 55 (March 28, 2026) — commits `e794a2`, `c5042e9`
- **`djSavedSongsRef` fix**: DJ-manually-saved songs now survive dancer transitions. Dedicated `djSavedSongsRef = useRef({})` stores saves per dancer, consumed once on next transition. Replaces the fragile cooldown-check approach.
- **Fleet audio diagnostics**: Added rolling event log, pre-pick cache tracking, transition timing, and watchdog capture to DJBooth.jsx. Threaded through all 5 layers (DJBooth → liveBoothState → getExtraData → heartbeat → fleet-monitor → FleetDashboard).
- **currentDancer/currentSong null bug fixed**: `getExtraData()` in server/index.js now populates these fields from `liveBoothState`. They were always null before.
- **FleetDashboard Audio Diagnostics panel**: Per-device card shows rotation/audio/voice status badges, last transition duration (color-coded), cache hit rate, dead air watchdog alerts, and scrollable 20-entry event log.

### Session 56 (March 29, 2026) — promo mixer + continuous music
- **Pre-mixed promo MP3 system** (`server/promo-mixer.js`): ffmpeg mixes ElevenLabs voice + random Promo Beds track → single MP3 saved to `MUSIC_PATH/Promos/` (5s full bed intro | voice over ducked bed at 12% | 5s outro + 2s fade out). Auto-triggered on every promo/manual voiceover save. Manual endpoints: `POST /api/voiceovers/mix-promo/:cacheKey`, `POST /api/voiceovers/convert-all-promos`, `GET /api/voiceovers/mix-status`.
- **Continuous music during dancer transitions**: `handleTrackEnd` and `handleSkip` now start the new dancer's track IMMEDIATELY (no dead air), then duck and play outro/intro/commercial over the live music. Track starts → transition_complete logged → duck → outro over music → unduck → commercial → intro over music → unduck.
- **`playCommercialIfDue` two-mode system**: checks `Promos` genre first — if tracks exist, plays the pre-mixed MP3 as an announcement (`autoDuck: false`, music already ducked) via `commercialModeRef='new'`. Falls back to legacy voice-over-bed system (`commercialModeRef='old'`). Old mode restarts the dancer track after commercial finishes.
- **`commercialModeRef`** added to track which commercial mode fired so callers know whether to restart the dancer track.

### PENDING TO-DO (next session):
1. Fix Telegram alerts (broken since homebase migration)
2. Smart Telegram alerts: fire on dead air, slow transitions, low cache hit rate — with full context
3. **INVESTIGATE: False / stale dead air alerts on neonaidj003** — Telegram repeatedly fires "DEAD AIR — 15.7s silence detected, Dancer: AMETHYST, Track: 1982-288 Van Halen Oh Pretty Woman.mp3" every ~10 minutes (seen 2:34, 2:45, 2:55, 2:59 AM) even though that track has not played for at least an hour. Likely causes: (a) dead air watchdog is comparing against a stale `currentTrack` ref that wasn't cleared after the song ended, so it keeps re-alerting on the same frozen state; (b) the heartbeat is sending a cached/old track name instead of the live one; (c) the dead air alert has no cooldown/dedup so fires repeatedly for the same event. **Do NOT change anything until discussed with user.** They flagged this as informational only for now.
4. **MCP server for AI monitoring** — Build a small MCP (Model Context Protocol) server alongside the API that exposes existing endpoints as AI-callable tools. The app is already ~80% ready: `/api/booth/state`, `/api/fleet/logs`, `/api/fleet/heartbeats`, `/api/fleet/play-history`, `/api/audit/log`, and `/api/client-settings` all exist. Read-only tools (`get_booth_state`, `get_diag_log`, `get_play_history`, `get_device_health`, `query_settings`) are safe at any time. Write tool (`send_command` → `update/restart/sync/reboot` via existing `/api/monitor/command/:deviceId/:action`) should be gated and discussed before enabling. Goal: when something goes wrong mid-show, an AI can instantly query live state, logs, and history without any copy-pasting.

## Commercial System (Planned)
- Club specials will work like promos: TTS auto-generated, played over bed track during commercial breaks
- The specials textarea will live in the Commercials section of DJ Options (not yet implemented)

## Critical Architecture Rules (READ FIRST EVERY SESSION)
1. **Server State Relay Whitelist**: When adding ANY new field to the Pi→remote broadcast in `DJBooth.jsx`, MUST ALSO add it to the server relay whitelist in `server/index.js` (POST `/api/booth/state` handler ~line 571). The server drops fields not in its whitelist.
2. **Broadcast Dependency Array**: Any new state variable in the broadcast payload in `DJBooth.jsx` MUST also be added to the useEffect dependency array (~line 822) or changes won't trigger re-broadcasts to the remote.
3. **AudioEngine.jsx**: NEVER modify audio behavior (crossfade, ducking, volume levels are finalized).
4. **Server port**: Always 3001. Do NOT change.
5. **No Suno API**: Music beds from local PROMO BEDS folder only.
6. **UI says "Entertainer" but code says `dancer`**: Do NOT rename variables.
7. **Session history**: Always read `.agents/skills/session-history/SKILL.md` at the start of each session for full context of past decisions, fixes, and architecture.

## Session Notes

### Mar 8, 2026 — Session 34 (Commercial Voiceover Bug Fix + Playback Lock)

#### Bug Fix: Commercial voiceovers now bypass AnnouncementSystem
- **Problem**: `playCommercialIfDue` called DJBooth's `playAnnouncement` wrapper, which: (1) checked `announcementsEnabled` and silently skipped commercials when announcements were off, and (2) passed the blob URL into `getOrGenerateAnnouncement` which treated it as a `type` string and tried to generate audio instead of playing the existing blob
- **Fix**: Commercials now call `audioEngineRef.current.playAnnouncement(voiceoverUrl, { autoDuck: true })` directly, bypassing the AnnouncementSystem entirely since the voiceover audio is already fetched as a blob URL
- **Guard**: Added `audioEngineRef.current` null check before commercial playback — returns false (skips commercial) if AudioEngine isn't ready yet
- **Removed**: `forcePlay` option from DJBooth's `playAnnouncement` wrapper (no longer needed since commercials bypass it entirely)
- **Files**: `src/pages/DJBooth.jsx`
- **Commit**: `6f6333e`

#### Bug Fix: Playback lock prevents dual songs on boot
- **Problem**: On full Pi reboot, two songs would play simultaneously. AudioEngine's `playTrack` had no concurrency guard — two async calls could both load onto separate decks and both end up playing
- **Root cause**: `playTrack` is async (loadTrack → analyzeTrackLoudness → play). During those awaits, a second call could enter the function, get a different deck, and start playing alongside the first
- **Fix**: Added `playTrackLockRef` mutex to AudioEngine's `playTrack`. If a track is already being loaded, the second call waits for the first to finish before proceeding. Lock is released on every exit path (success, error, load failure)
- **No audio behavior changes** — only prevents concurrent track loading
- **Files**: `src/components/dj/AudioEngine.jsx`

#### Bug Fix: Commercial plays AFTER outro, not before
- **Problem**: Commercial was playing before the outro voiceover — wrong order. DJ heard "commercial → outro → next dancer" instead of "outro → commercial → next dancer"
- **Root cause**: In both `handleSkip` and `handleTrackEnd`, `playCommercialIfDue()` was called BEFORE the outro announcement
- **Fix**: Reordered to: (1) check `isCommercialDue()` first, (2) if commercial coming, play outro with duck/unduck, (3) THEN play commercial, (4) then next track + intro
- **Non-commercial transitions unchanged**: When no commercial is due, the combined `transition` announcement (outro+intro in one) still plays as before — no double-outro
- **4 transition points**: 2 fixed (handleSkip direct, handleTrackEnd direct), 1 OK as-is (after break songs — no outro needed), 1 is the definition itself
- **Files**: `src/pages/DJBooth.jsx`
- **Commit**: `b7a81a2`

#### Feature: Folder Lock shows actual system-picked songs + tap-to-reroll
- **Problem**: When Folder Lock was on, rotation panel showed stale playlist songs instead of the actual songs picked from folders
- **Fix 1**: Added `prevMusicModeRef` effect — when music mode changes (dancer_first ↔ folders_only), clears all non-DJ-overridden song assignments so they get re-picked under the new mode
- **Fix 2**: Added `rerollSong()` — when Folder Lock is on, tapping any song row (except currently playing) re-rolls it with a new random pick from the locked folders, excluding all other assigned songs
- **Visual**: Folder Lock songs show a shuffle icon (amber) instead of music icon, with hover highlight. Currently-playing song cannot be re-rolled
- **Files**: `src/components/dj/RotationPlaylistManager.jsx`

#### Feature: Dirty word filter for dancers
- Songs with "dirty" (case-insensitive) anywhere in the filename are hidden from dancers
- **Server**: `getMusicTracks` accepts `excludeDirty` flag, set automatically when session role is `dancer`
- **Playlist save**: Server strips any dirty songs from dancer playlist on PUT `/api/playlist`
- **DancerView**: Client-side `addSong` blocks dirty songs as safety net
- **DJ/Manager**: Full access to all songs including dirty — no filter applied
- **Files**: `server/db.js`, `server/index.js`, `src/pages/DancerView.jsx`
- **Commit**: `3a82ec4`

### Mar 8, 2026 — Session 33 (Fleet Play History + Generic Voiceover Fallbacks)

#### Feature: Generic Voiceover Fallbacks (Last Resort)
- 40 pre-recorded generic voiceovers stored in fleet.db `voice_recordings` table under `__generic__`
- 10 variations each for: intro, round2, outro, transition
- **Fallback chain**: AI-generated → cached at different energy level → generic cached → **pre-recorded generic** (last resort)
- Only used when there's no internet AND nothing was previously generated/cached
- `checkGenericRecording()` in AnnouncementSystem.jsx cycles through variations round-robin
- Cached in IndexedDB after first fetch so they work fully offline
- Generation script: `server/generate-generic-voiceovers.js` (one-time, requires ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID env vars)

#### Feature: Play History in Fleet Dashboard
- Each Pi now sends recent play history (songs played since last heartbeat) in its heartbeat payload
- Fleet server stores all play history in `fleet_play_history` table (90-day retention, auto-cleanup)
- Fleet dashboard device detail modal has new "Play History" tab showing chronological song list
- Date picker dropdown filters by day, shows song count per date
- Each entry shows: time, track name, and entertainer name (if assigned)
- **Pi impact**: Minimal — one extra SQLite query per heartbeat (every 5 min), small JSON payload
- **Files**: `server/heartbeat-client.js` (getRecentPlayHistory + payload), `server/fleet-monitor.js` (storePlayHistory call), `server/fleet-db.js` (fleet_play_history table + helpers), `server/fleet-routes.js` (GET /play-history/:deviceId), `src/api/fleetApi.js` (getPlayHistory method), `src/pages/FleetDashboard.jsx` (Play History tab in DeviceDetailModal)

### Mar 8, 2026 — Session 32 (Simplified Promo System — Auto-Generate + Promo Beds Playback)

#### Promo Auto-Generation on Form Submit
- DJ submits promo request form → app now auto-generates a voiceover immediately:
  1. Builds prompt from form fields (event name, date, time, venue, details, vibe, length)
  2. Calls OpenAI (configured script model) to generate a spoken script
  3. Sends script to ElevenLabs TTS using configured voice clone
  4. Saves audio to voiceovers DB (type='promo') with cache key `promo-auto-{timestamp}-{slug}`
  5. Still sends the request to Voice Studio for manual recording if desired
- Progress toasts show each step (Generating script → Recording voice → Saving)
- File: `src/components/dj/ManualAnnouncementPlayer.jsx`

#### Commercial Playback — Promo Beds + Live Ducking
- `playCommercialIfDue` completely rewritten in DJBooth.jsx
- Old approach: played a pre-mixed promo audio file as a single track
- New approach:
  1. Fetches random track from `Promo Beds` genre folder (`/api/music/tracks?genre=Promo%20Beds&limit=200`)
  2. Plays Promo Beds song via `playTrack()` as a normal track
  3. Waits 9 seconds (intro)
  4. Plays voiceover via `playAnnouncement()` with `autoDuck: true` — leverages existing AudioEngine duck/unduck
  5. Waits 9 seconds (outro) after voiceover finishes
  6. Resolves commercial and transitions to next entertainer
- `stopVoice()` method added to AudioEngine for skip/pause cleanup during commercials
- No pre-mixing needed — all live audio layering
- File: `src/pages/DJBooth.jsx`, `src/components/dj/AudioEngine.jsx`

#### Dead Code Cleanup
- Removed `resolveCommercialTrack()` from DJBooth.jsx
- Removed all `[COMMERCIAL]` interstitial handling from break song resolution (4 blocks in handleSkip/handleTrackEnd)
- Removed `breakHadCommercial` logic
- Removed `commercialTracks` state and `fetchCommercials` from RotationPlaylistManager
- Removed "Commercials" music source dropdown option
- Removed commercials library view JSX (the `musicSource === 'commercials'` section)
- Removed `[COMMERCIAL]` visual styling in break song list items (amber/gold → all violet now)
- Removed `hasManualCommercial` auto-commercial suppression check
- Removed `Tv` icon import from RotationPlaylistManager
- Upload section previously removed from ManualAnnouncementPlayer (blobToBase64, Upload icon, uploading state, handleFileUpload)
- Files: `src/pages/DJBooth.jsx`, `src/components/dj/RotationPlaylistManager.jsx`, `src/components/dj/ManualAnnouncementPlayer.jsx`

### Mar 8, 2026 — Session 30 (Song Selection Logic + Autoplay Queue)

#### Song Selection Logic Improvements
- **Playlist order respected**: Removed `fisherYatesShuffle` on dancer playlists — songs play in assigned order, skipping cooldown songs
- **Pre-pick on rotation flip**: When a dancer finishes and rotates to bottom, their next songs are picked immediately (async, non-blocking)
- **Pre-pick on add**: When an entertainer is added to rotation while active, songs are picked right away
- **3-tier server fallback** in `selectTracksForSet()`: (1) Walk playlist in order, skip cooldown songs → (2) Pick least-recently-played playlist songs even if on cooldown → (3) Random filler from active genres/backup folder
- **Stale pre-pick guards**: All async pre-picks verify rotation is still active and dancer still in rotation before committing
- **Files**: `src/pages/DJBooth.jsx` (getDancerTracks, handleSkip, handleTrackEnd, addToRotation), `server/db.js` (selectTracksForSet)

#### Session 31 Changes

##### No Applause/Noise in Voice Scripts
- Added explicit NEVER DO rules to SYSTEM_PROMPT banning crowd noise requests, applause calls, "give it up", "make some noise", etc.
- Updated all example scripts (intro, outro, transition) to remove applause/cheering language
- Also reinforced in per-type instructions: "Do not ask for applause or cheering"
- Files: `src/utils/energyLevels.js`

##### Skip + Remove Confirmations
- `handleSkip` now shows `window.confirm('Skip this song?')` before executing
- `removeFromRotation` now shows `window.confirm('Remove [name] from the rotation?')` before executing
- Files: `src/pages/DJBooth.jsx`

##### Time-to-Talk Countdown Indicator
- When voice announcements are disabled and rotation is active, countdown flashes + changes color in last 30s
- White → yellow at 30s, yellow → red at 15s, with CSS pulse animation (`talkPulse`)
- Works on both local (`timeDisplayRef`) and remote (`remoteTimeDisplayRef`) timers
- Added `announcementsEnabledRef` to sync state to ref for timer interval access
- Files: `src/pages/DJBooth.jsx`, `src/index.css`

##### Song Cooldown Persistence
- Confirmed: 4-hour cooldown already persists across reboots via SQLite `play_history` table
- Client loads from localStorage + merges with server `/api/history/cooldowns?hours=4` on startup
- No code changes needed — verified working (75+ cooldowns loaded after restart in testing)

##### Voiceover 404 Cleanup
- Added `cleanupStaleIDBEntries()` in `AnnouncementSystem.jsx` that purges old-version cache entries from IndexedDB on load
- Only keeps entries matching current version tag (`V10`)
- Files: `src/components/dj/AnnouncementSystem.jsx`

##### Fleet Console Logs
- `heartbeat-client.js`: Added `getRecentServiceLogs()` — captures last 50 journalctl warning/error lines from `djbooth.service`
- Included as `recentLogs` in heartbeat payload
- `fleet-monitor.js`: Stores `recentLogs` in device memory map
- `fleet-routes.js`: Passes `recentLogs` in dashboard overview response
- `FleetDashboard.jsx`: Collapsible "Service Logs" section per device card with error/warning color coding
- Files: `server/heartbeat-client.js`, `server/fleet-monitor.js`, `server/fleet-routes.js`, `src/pages/FleetDashboard.jsx`

##### Club Specials Staggering
- **Problem**: All club specials were dumped into every outro/transition prompt, making them repetitive and mechanical
- **Fix**: Specials now stagger randomly — one special per announcement, only every 2nd or 3rd announcement (random), rotating through the list in order
- **Counter refs**: `specialsAnnouncementCountRef`, `specialsRotationIndexRef`, `specialsNextTriggerRef` in `AnnouncementSystem.jsx`
- **Prompt updated**: `buildAnnouncementPrompt` in `energyLevels.js` now gets 0 or 1 specials (singular "CLUB SPECIAL" prompt instead of plural)
- **Caching**: Outros/transitions with specials configured skip IndexedDB cache so staggering works (fresh generation each time)
- **Files**: `src/components/dj/AnnouncementSystem.jsx` (getStaggeredSpecial, cache bypass), `src/utils/energyLevels.js` (prompt wording)

##### GitHub Push
- Pushed all Session 31 changes to GitHub: commit `9851155`
- Includes: club specials staggering, no-applause scripts, skip/remove confirmations, talk-time indicator, voiceover 404 cleanup, fleet console logs

#### Autoplay Queue Feature
- **New feature**: When no entertainers are in rotation, a cyan "Autoplay Queue" bubble appears showing the next 10 songs
- **Drag and drop**: DJs can drag songs from the music browser into the queue at any position, reorder within the queue, and remove songs
- **Auto-fill**: System auto-fills queue to 10 songs from active genres; after DJ-picked songs are played, auto-fill continues
- **Playback integration**: `handleTrackEnd` uses autoplay queue when rotation is empty — plays queue songs in order with crossfade
- **Race condition guards**: Fill requests use version tracking and in-flight flag; playback uses mutex to prevent concurrent shifts
- **Visual design**: Cyan theme matching app accent; first song highlighted with play icon; DJ-picked songs vs auto-filled songs visually distinct
- **Files**: `src/pages/DJBooth.jsx` (autoplayQueue state, fillAutoplayQueue, playFromAutoplayQueue), `src/components/dj/RotationPlaylistManager.jsx` (autoplay queue bubble UI)

### Mar 6, 2026 — Session 29 (R2 Boot Sync Fix + Entertainer Roster)

#### R2 Boot Music Sync Fix
- **Problem**: Auto-detect logic (`const defaultMusicPath = join(__dirname, '..', 'music')`) caused Replit to detect the local `./music` folder and download 16GB of music from R2 into Replit on boot
- **Fix**: Removed auto-detect music path — MUSIC_PATH now only comes from `MUSIC_PATH` env var or the `music_path` setting in the database
- **Boot sync kept intact**: Both voiceover and music R2 sync still run on every boot as intended — this is correct behavior for Pi units that reboot each morning
- **Cleanup**: Deleted 16GB of downloaded music files from Replit's `./music/` folder
- **R2 bucket untouched**: No duplicates were created in R2
- **File**: `server/index.js` (removed `defaultMusicPath` auto-detect block)

#### Pony Nation Entertainer Roster (62 Entertainers)
- Added 62 entertainers to `fleet_dancer_roster` table for Voice Studio recording
- Full list: Amelia, Amber, Amor, Anneliese, Avery, Bianca, Blair, Britney, Cameron, Cleo, Crystal, Dakota, Devin, Eliza, Emma, Enchantres, Erica, Fauna, Fendi, Hanna, Isabella, Jamie, Jasmine, Jalese, Jenn, Jules, Kaylani, Kingsley, Kitten, Kristin, Lacie, Lana, Liliah, Lily, Luna, Malia, Mia, Mieka, Milan, Minnie, Minx, Mohana, Morganna, Nadia, Natalia, Nikki, Rachel, Reese, Regina, River, Sage, Sara, Scarlette, Sierra, Simone, Sin, Stacy, Stunna, Tatiana, Valerie, Venom Rose, Yasmine
- Each entertainer gets 4 recording slots in Voice Studio: intro, round2, round3, outro (248 total recordings needed)
- Inserted with `reported_by_devices: ['manual']` since added manually rather than via Pi heartbeat

#### Update Script Fix
- **Problem**: `djbooth-update.sh` backup step used `cp -r` which copied the entire `djbooth/` folder including 25,000 music files — got stuck for ages
- **Fix**: Changed to `rsync -a --exclude='music' --exclude='voiceovers' --exclude='node_modules'` — backup now takes seconds
- **File**: `public/djbooth-update-github.sh` (line 47-48)
- **First-time fix on Pi**: Must download the new script first with `curl` before running update (old script on Pi still has `cp -r`)

#### Boot Sequence & Sync Architecture
- **R2 boot sync (voiceovers + music)** runs automatically every time the app starts — this is correct and intentional
- Pi reboots daily at 8:30 AM → djbooth service starts → R2 sync downloads new voiceovers/music, uploads any locally-created ones
- **Code updates (GitHub)** are currently manual only — run `~/djbooth-update.sh` via SSH
- Code updates do NOT run automatically on reboot (user may want this added later)

#### CRITICAL RULES — NEVER BREAK THESE
- **ALWAYS ask before making ANY changes** — present what you plan to do, wait for approval, then implement
- **NEVER tell the user to delete files on a Pi** — if disk space is needed, ask what they want to remove
- **NEVER push files that don't belong on Pis** — no attached_assets, no .local/state, no sample music, no database files
- **NEVER modify Pi service files, environment variables, or database paths** without explicit user approval
- **GitHub push must ALWAYS exclude**: attached_assets, .local, music, voiceovers, .db/.db-wal/.db-shm, node_modules, dist, .cache, .config, .upm
- **API keys are in browser localStorage on each Pi** — code updates should NEVER affect them, but disk corruption can wipe them
- **Music path on Pony Nation Pi**: `/home/neonaidj001/djbooth/music/` — set in systemd service file, DO NOT CHANGE
- **Music is synced to/from R2** — even if files are lost locally, R2 has the backup and will re-download on service restart
- R2 boot sync (voiceovers + music) runs on every boot — this is intentional for Pi morning reboots
- Replit should NOT have a music path set — no local music folder needed here
- **Before any GitHub push**: verify the file list does NOT contain screenshots, music files, database files, or Replit internal state files
- **Test impact on Pi before pushing**: consider what the update script will do with every change

## System Architecture
The application uses React 18, Vite, and TailwindCSS for the frontend, with Radix UI primitives and shadcn/ui styling. UI/UX is designed with a dark nightclub theme featuring neon cyan and blue accents, prioritizing low-power device performance. `localStorage` manages entities, while `IndexedDB` provides fast session caching for voiceover audio. State management uses React Query, and routing is handled by React Router v6. Configuration settings are stored in the browser's `localStorage` on each Pi.

Music tracks are indexed server-side in a SQLite `music_tracks` table, supporting various audio formats and genre extraction. A custom dual-deck audio engine manages seamless music playback with equal-power crossfading, audio ducking, auto-gain loudness normalization, a brick-wall limiter, and sophisticated announcement overlays. Beat-matched crossfading adjusts incoming track tempo, and a 3-band EQ is available for music and voice. Voice announcements are dynamically generated using ElevenLabs TTS and OpenAI, adapting to club energy levels (5-tier system) and operating hours, featuring unique personalities and optional adult innuendo. Announcements are club-locked based on configurable club names.

An Express + SQLite backend on port 3001 manages shared dancer data and PIN authentication, optimized for low-power devices. Critical state persists to `localStorage` for crash recovery. Features include a 4-hour song cooldown, configurable songs-per-set, interstitial break songs, genre filtering, and a Playback Watchdog for audio recovery. The `DJBooth` component remains mounted persistently to preserve audio engine state. An Autoplay Queue feature manages music when no entertainers are present.

A fleet management system enables centralized control of multiple Pi units, providing device registration, heartbeat monitoring (including hardware health metrics like CPU temp and RAM), error log collection, voiceover sharing, music manifest tracking, app update distribution, and sync coordination via Cloudflare R2. An admin dashboard offers an overview of device health, API cost tracking per unit, a master voiceover library, and sync history. A Pi-side sync client handles scheduled closed-hours synchronization. Voice recording functionality is available via the Voice Studio, featuring a record-preview-save workflow and Auphonic API integration for professional post-processing. System updates are managed via `djbooth-update.sh` with optimized backup procedures.

## Announcement System (Current State — March 2026)
- **3 announcement types**: intro, round2, outro (transition type removed)
- **5 variations per type per dancer** (NUM_VARIATIONS = 5)
- **Energy level is always auto** (time-based, 5-tier system) — manual energy override UI removed
- **No club name or day-of-week** in voiceover prompts or cache keys — prompts explicitly instruct "do not mention day/club/time"
- **No club specials** in voiceover prompts — specials are moving to the commercial playback system instead
- **Cache keys**: `{type}-{dancerName}-L{level}-V{varNum}` — voice version `V11` (changed from V10; bump version again if prompt/voice changes)
- **Dancer changeover flow**: outro (outgoing) → commercial (if due) → track starts → intro (incoming) — no overlap
- **Failed generation skip**: `failedGenerationsRef` Set prevents retry storms for the session
- **Pre-cache**: buffers upcoming dancers with all 3 types × 5 variations each (15 voiceovers per dancer)
- **Variant selection rules (Session 45)**:
  - `getNextVariationNum` picks randomly from 1–5, avoiding: last used for that key, cross-transition match (outro→intro or intro→outro), same-set pairing (intro and outro for same dancer's set use different numbers)
  - Tracks: `lastPlayedTypeVariantRef` (global, per type) + `currentSetIntroVariantRef` (per dancer name)
- **Corruption guard (Session 45)**:
  - `validateAudioBlob()` runs `decodeAudioData()` before caching; retries generation up to 3× on failure
  - `deleteFromIndexedDB()` helper removes bad entries; playback failure auto-purges IDB + server and regenerates once
- **ElevenLabs credits**: ~180K remaining this billing cycle; key `6e6ca8...71342`, voice ID `8RV9Jl85RVagCJGw9qhY`
- **Stale IDB cleanup**: `cleanupStaleIDBEntries` auto-purges old cache versions on Pi load
- **Song cooldown**: 6 hours (updated from 4h in Session 44)

## Commercial System (Planned)
- Club specials will work like promos: TTS auto-generated, played over bed track during commercial breaks
- The specials textarea will live in the Commercials section of DJ Options (not yet implemented)

## External Dependencies
- **React**: Frontend UI development
- **Vite**: Project build tool
- **TailwindCSS**: Utility-first CSS framework
- **Radix UI**: Unstyled UI component primitives
- **shadcn/ui**: Component styling
- **React Query (TanStack Query)**: Data fetching and caching
- **React Router v6**: Client-side routing
- **ElevenLabs TTS**: Text-to-Speech API for voice generation
- **OpenAI**: AI model for announcement script generation
- **Express**: Backend web application framework
- **SQLite**: Database for multi-user dancer data and music catalog
- **Cloudflare R2**: S3-compatible cloud storage for voiceover and music synchronization
- **Auphonic API**: Automatic audio post-processing (noise reduction, EQ, loudness normalization)
- **Telegram**: Notification service for fleet monitoring alerts
- **@aws-sdk/client-s3**: AWS SDK for R2 integration

## Session 46 — April 25, 2026 (THE PONY EVANSVILLE / 003 — big-client-night recovery)

### Incident Timeline
1. Began with screen-assignment fix for 002 and 003 (kiosk vs crowd swapped on portrait TVs).
2. Pushed wmctrl auto-install + sequential window launch into `djbooth-update-github.sh` UPDATE SUCCESSFUL block.
3. 002 ran the new update successfully. 003 only ran the manual recovery block — wmctrl was missing → crowd never went fullscreen.
4. While debugging crowd window on 003 (multiple chromium relaunches via SSH), the **djbooth.service entered a crash-loop**: `Cannot find package 'express'`. Cause: `node_modules/` on 003 was incomplete/missing — likely a prior partial install or rebuild left it broken.
5. Recovery: `cd ~/djbooth && NODE_ENV=development npm install --legacy-peer-deps --no-audit --no-fund` → service started → kiosk login worked → crowd window relaunched + wmctrl fullscreened.

### Key Learnings — write into update script next time
- **`--legacy-peer-deps` is REQUIRED** for `npm install` on the Pis. `@hello-pangea/dnd@17.0.0` declares `peer react@^18.0.0` while project uses `react@18.3.1`. Without the flag, install aborts and node_modules ends up missing/partial. Verify the update script is using this flag everywhere it runs npm install.
- **node_modules integrity check** before `systemctl restart djbooth` would have caught this in 5 seconds: `node -e "require.resolve('express')"` → if it throws, run npm install before restart.
- **wmctrl auto-install** has now been added to the update script's apt section (alongside ffmpeg/xdotool/aubio) — committed this session.
- **Background chromium from SSH is fragile** without `nohup ... & disown` — the kiosk/crowd browsers can die when the SSH session ends. The recovery commands now use nohup+disown explicitly.

### 003 Specifics (Reference)
- User: `neonaidj003`, home: `/home/neonaidj003`, app dir: `/home/neonaidj003/djbooth`
- Tailscale: `neonaidj002-1.tail9b3804.ts.net` (note: 002 hostname even though it's 003 — leftover from setup)
- xrandr layout: HDMI-1 = 720x1280 portrait at 0,0 (CROWD TV), HDMI-2 = 1440x900 primary at 720,0 (KIOSK)
- Crowd-window launch must use `--window-size=720,1280` (NOT 002's 2160x3840)
- XAUTHORITY discovery on 003: `find /run/user -name "Xauthority" 2>/dev/null | head -1` then fall back to `/home/neonaidj003/.Xauthority`

### 002 Specifics (Reference, unchanged)
- xrandr layout: HDMI-1 = 2160x3840 portrait right (CROWD TV), HDMI-2 = 1920x1080 primary at 3840,0 (KIOSK)
- Crowd-window launch uses `--window-size=2160,3840`

### Golden Rules Reaffirmed
- PRIMARY display = kiosk. NON-PRIMARY = crowd. Never detect by HDMI port number.
- Service is systemd `djbooth.service` — survives chromium kills. Browser kills are cosmetic and recoverable.
- Anti-panic invariant for the user: killing chromium windows over SSH **never** touches data, songs, schedules, or settings.

### Remote Recovery Playbook (Pin to Memory)
Crash-loop / "site can't be reached" / login broken on a Pi:
```bash
sudo systemctl status djbooth --no-pager | head -30
sudo journalctl -u djbooth -n 50 --no-pager
# If ERR_MODULE_NOT_FOUND:
cd ~/djbooth && NODE_ENV=development npm install --legacy-peer-deps --no-audit --no-fund
sudo systemctl restart djbooth
```

Crowd screen blank / wrong size / not fullscreen (003 dimensions shown):
```bash
nohup bash -c '
export DISPLAY=:0
export XAUTHORITY=$(find /run/user -name "Xauthority" 2>/dev/null | head -1)
[ -z "$XAUTHORITY" ] && export XAUTHORITY=/home/$(whoami)/.Xauthority
which wmctrl >/dev/null || sudo apt-get install -y wmctrl -q
pkill -f "RotationDisplay\|RotationChromium" 2>/dev/null; sleep 3
rm -rf /tmp/chromium-rotation
nohup chromium --app=http://localhost:3001/RotationDisplay --class=RotationChromium --user-data-dir=/tmp/chromium-rotation --window-position=0,0 --window-size=720,1280 --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required --force-device-scale-factor=1 >/tmp/crowd.log 2>&1 &
sleep 10
wmctrl -x -r "RotationChromium" -e 0,0,0,720,1280
sleep 1
wmctrl -x -r "RotationChromium" -b add,fullscreen
' >/tmp/crowd-recovery.log 2>&1 &
disown
```

Bootstrap a stale Pi to the latest update (skips homebase, fetches script directly from GitHub):
```bash
curl -sf https://raw.githubusercontent.com/jebjarrell1974-debug/dj-booth-rotation-system/main/artifacts/dj-booth/public/public/djbooth-update-github.sh -o ~/djbooth-update.sh && chmod +x ~/djbooth-update.sh && DJBOOTH_SKIP_HOMEBASE=1 ~/djbooth-update.sh 2>&1 | tee ~/update.log
```

### Open Follow-ups (NOT done tonight — for next session)
- Verify `djbooth-update-github.sh` uses `--legacy-peer-deps` on every `npm install` invocation. If not, add it.
- Consider adding a node_modules sanity check (`node -e "require.resolve('express')"`) before `systemctl restart djbooth` in the update script — fail loud, not crash-loop silent.
- 003 has not yet run the new update — only manual recovery. Schedule a calm-day update for 003 to get autostart fixes.
- User explicitly does NOT want anything else touched tonight. No more changes until they say so.
