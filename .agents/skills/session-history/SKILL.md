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
| Homebase | `neonaidj` | `100.109.73.27` | Fleet server + DJ booth | Homebase | HP Compaq 8200 Elite (Mar 2026). |
| neonaidj001 | `neonaidj001` | `100.115.212.34` | DJ booth | Pony Bama | Music path: `/home/neonaidj001/djbooth/music/` |
| neonaidj002 | `neonaidj002` | `100.84.191.94` | DJ booth | Unassigned | |
| neonaidj003 | `neonaidj003` | `100.81.90.125` | DJ booth | THE PONY EVANSVILLE | Stable. |
| neonaidj004 | `homebase` | `100.95.238.71` | DJ booth | THE PONY PENSECOLA | Converted from old Pi homebase (Mar 2026). Username stays `homebase`. Music path: `/media/homebase/music` (1TB microSD). Tailscale hostname: `neonaidj004`. |

**Fleet .env rules:**
- Homebase: `FLEET_SERVER_URL=http://localhost:3001` (reports to itself)
- All venue Pis: `FLEET_SERVER_URL=http://100.109.73.27:3001` (NEW homebase IP — must update all Pis)
- Fleet dashboard: `http://100.109.73.27:3001/fleet` (any Tailscale device)

**PENDING on neonaidj003:**
- Set `CLUB_NAME=<correct venue name>` in `~/djbooth/.env`, then `sudo systemctl restart djbooth`
- 003's `~/djbooth-update.sh` was manually replaced with new version (Session 46b) — next Update button press will complete correctly

**PENDING on neonaidj001:**
- Set `DEVICE_ID=neonaidj001` in `~/djbooth/.env`
- Update `FLEET_SERVER_URL` from old IP to new homebase: `sed -i 's|FLEET_SERVER_URL=http://100.95.238.71:3001|FLEET_SERVER_URL=http://100.109.73.27:3001|' ~/djbooth/.env && sudo systemctl restart djbooth`
- ~~OLD 7-step script~~ — RESOLVED: Manually updated March 22 with `DJBOOTH_SKIP_HOMEBASE=1 ~/djbooth-update.sh`. New 8-step script now installed.

**PENDING on all units (next reboot or Update button press):**
- Pull Session 46b fixes — fleet Update button now works correctly (background process, no timeout kill)
- Stamp will be written after next successful update (writes "unknown" if GitHub API unavailable)
- aubio-tools will auto-install on first update run if not already present

**Fleet Update button: NOW FIXED (commit `5f37890`)**
- Was silently failing since day one — 2-min `execSync` timeout was killing the script mid-run
- All successful updates on venue Pis were from boot auto-update (systemd), NOT the button
- Button now uses detached `spawn()` — runs fully independent, can never be killed

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

## CRITICAL USER RULE — READ BEFORE EVERY SESSION
- **ALWAYS discuss proposed changes and get EXPLICIT APPROVAL before modifying any code or pushing to GitHub.**
- User runs `DJBOOTH_SKIP_HOMEBASE=1 ~/djbooth-update.sh` after every push. If you push without telling them, they don't know to update and the fix never reaches the device.
- Only push when user explicitly says "push" or "push please."

---

## CURRENT STATUS (as of Session 58 — March 30, 2026) — READ THIS FIRST

### Latest GitHub commit this session:
- **ROLLBACK POINT**: `9326ccf` (Replit checkpoint) — "Add promo management and house announcement features"

### What was built this session (Session 58):

**1. Commercial architecture refactor — `src/pages/DJBooth.jsx`:**
- `playCommercialIfDue` new-mode now uses `playTrack()` on the main deck (not `playAnnouncement`), then awaits the existing `commercialEndResolverRef` promise-blocking mechanism
- `handleTrackEnd` post-commercial restart simplified — removed `commercialModeRef === 'old'` guard; always restarts dancer track with crossfade after commercial resolves

**2. Promo intro extended — `server/promo-mixer.js`:**
- `introSec` bumped from 5 → 9 seconds (full-volume bed intro before voice starts)

**3. DB helpers + server API endpoints — `server/db.js` + `server/index.js`:**
- `listAllPromoTracks()` — returns all `music_tracks` with `genre='Promos'` (including blocked ones)
- `setPromoTrackBlockedById(id, blocked)` — toggles `blocked` field on a promo track
- `deletePromoTrackById(id)` — deletes promo track record + its MP3 file from disk
- `listHouseAnnouncements()` — returns voiceovers with `type='house'`
- `GET /api/house-announcements` — list house announcement voiceovers
- `GET /api/promos` — list all promo tracks (all blocked states)
- `PUT /api/promos/:id/blocked` — toggle blocked `{ blocked: true/false }`
- `DELETE /api/promos/:id` — delete promo track + file

**4. HouseAnnouncementPanel — `src/components/dj/HouseAnnouncementPanel.jsx` (new file):**
- Quick-fire announcement buttons with ElevenLabs TTS generation
- Duck/play via `autoDuck: true`, delete button per announcement
- Preset defaults: No Touching, No Photos, Tip Your Entertainers, Welcome
- Stored as voiceovers with `type='house'`; audio served via `/api/voiceovers/audio/:cacheKey`

**5. DJBooth.jsx — announcements tab:**
- Replaced `ManualAnnouncementPlayer` with `HouseAnnouncementPanel`
- Added `playHouseAnnouncement` case to `executeCommand` (fetches blob, plays with `autoDuck:true`)

**6. RemoteView.jsx — Announce tab:**
- Added `HouseAnnouncementPanel` import + `Megaphone` icon
- Added Announce tab content section (house panel UI)
- Added `{ id: 'announce', icon: Megaphone, label: 'Announce' }` to bottom nav tab bar (between Promos and Options)

**7. VoiceStudio.jsx — promo management UI:**
- `promoTracks` state + `loadPromoTracks()` fetch from `/api/promos`
- Auto-loads when Promos tab is opened
- Promo list shows above "New Promo Request" button when tracks exist
- Each promo: cyan toggle switch (active ↔ blocked) + red trash delete button
- Refresh icon to reload list manually
- `handlePromoToggle()` calls `PUT /api/promos/:id/blocked`
- `handlePromoDelete()` confirms then calls `DELETE /api/promos/:id`

---

## CURRENT STATUS (as of Session 57 — March 29, 2026)

### Latest GitHub commits this session:
- `1341dca` — "break bubble tap-to-add: select break slot to route library taps to addInterstitialSong"
- `b7263fd` — "auto-refresh dancer songs on rotation flip: clear assignments so cooldown songs are replaced"
- `fe0a8f2` — "lock viewport zoom: add user-scalable=no to prevent accidental kiosk zoom"
- **ROLLBACK POINT**: `b7263fd2` — last stable commit of this session.

### What was built this session (Session 57):

**1. Break slot tap-to-add — `src/components/dj/RotationPlaylistManager.jsx`:**
- Added `selectedBreakKey` state (mirrors `selectedDancerId` pattern exactly)
- Break bubble now has a tappable header row (violet "Break" label) — tap to select/deselect
- When a break slot is selected: border turns cyan, header highlights, "tap songs to add" hint appears
- Library track taps route to `addInterstitialSong(selectedBreakKey, trackName)` when break selected
- Selecting a break slot clears dancer selection and vice versa — only one active at a time
- Drag-to-drop for break slots unchanged and still works
- `handleLibraryTrackClick` moved to after `addInterstitialSong` definition (was causing temporal dead zone ReferenceError on first load)
- Toast updated: "Tap an entertainer or break slot to select it"

**2. Auto-refresh dancer songs on rotation flip — `src/components/dj/RotationPlaylistManager.jsx`:**
- Root cause: when a dancer finished their set and dropped to the bottom, `djOverridesRef` was cleared but `songAssignments` kept the old (now-on-cooldown) songs. The auto-assign logic saw songs present and skipped reassignment.
- Fix: in the `localRotation` effect that clears `djOverridesRef`, also call `setSongAssignments` to delete the finished dancer's slot. Auto-assign then picks fresh non-cooldown songs from their playlist immediately.
- Effect: dancers at the bottom of rotation always show fresh, non-orange songs after their set.

**3. Viewport zoom lock — `index.html`:**
- Added `maximum-scale=1.0, user-scalable=no` to viewport meta tag
- Prevents Ctrl+=/Ctrl+- and pinch-zoom from accidentally shrinking/growing kiosk UI
- Root cause on Pi 003: accidental browser zoom caused right-side content (X and skip buttons) to be cut off. Ctrl+0 resets immediately; this prevents recurrence.

### Session 56 commits (earlier same day, different chat):
- `0132946` — "Fix: pulling current dancer skips next dancer — adjust currentDancerIndex on remove"
- `4071e0f` — "Session 56: wire voice diagnostics into fleet event log"
- `5eea816` — "Session 56: promo-mixer ffmpeg pipeline, continuous music transitions, Promos genre commercial system"
- **ROLLBACK POINT for Session 56**: `bbf3d56`

### What was built this session (Session 56):

**1. Pre-mixed promo MP3 system — `server/promo-mixer.js` (new file):**
- `processPromo(cacheKey, voiceFilePath, promoName)` — ffmpeg mixes ElevenLabs voice + random Promo Beds track → single MP3 saved to `MUSIC_PATH/Promos/cacheKey.mp3`
- Mix formula: 5s full-volume bed intro | voice starts at 5s with bed ducked to 12% | 5s outro | 2s fade out
- Filter chain: `apad` → `atrim` → per-frame `volume` enable expression → `afade` → `adelay` voice → `amix normalize=0`
- `convertAllExistingPromos(listVoiceovers, getVoiceoverFilePath)` — batch convert all existing promos, skips already-done
- `getMixStatus(cacheKey)` / `getAllMixStatuses()` — in-memory Map for status tracking (persists until server restart)
- Guard: `if (mixStatus.get(cacheKey)?.status === 'processing') return;` — no double-mix on rapid saves

**2. server/index.js changes:**
- Import: `import { processPromo, getMixStatus, getAllMixStatuses, convertAllExistingPromos } from './promo-mixer.js';`
- Auto-trigger after `POST /api/voiceovers` save: if type is `promo` or `manual`, calls `processPromo()` in background
- New endpoints:
  - `GET /api/voiceovers/mix-status?cacheKey=X` — single or all mix statuses
  - `POST /api/voiceovers/mix-promo/:cacheKey` — manually trigger mix for one promo
  - `POST /api/voiceovers/convert-all-promos` — batch convert all existing promos (fires and returns immediately)

**3. DJBooth.jsx — continuous music during transitions:**
- `commercialModeRef = useRef(null)` — tracks 'new' or 'old' commercial mode so caller knows whether to restart dancer track
- **`playCommercialIfDue` new-mode**: checks `GET /api/music/tracks?genre=Promos` first. If Promos genre has tracks, picks one via shuffle queue, fetches audio, plays via `playAnnouncement({ autoDuck: false })` — awaits completion. Sets `commercialModeRef.current = 'new'`. Falls through to old system if no Promos tracks.
- **`playCommercialIfDue` old-mode**: sets `commercialModeRef.current = 'old'` then runs existing Promo Beds + voice overlay system unchanged.
- **`handleTrackEnd` new sequence**: `playTrack(nextTrack)` fires IMMEDIATELY (no more dead air gap) → `duck()` → `Promise.all([outroPromise, waitForDuck()])` → outro plays over ducked music → `unduck()` → commercial → if `commercialModeRef='old'`: restart dancer track → `duck()` → intro → `unduck()`
- **`handleSkip` new sequence**: identical to handleTrackEnd above
- `transition_complete` is now logged right after `playTrack` returns (when music starts), not after all announcements

**4. Voice diagnostics wired into fleet event log — `src/components/dj/AnnouncementSystem.jsx`, `src/pages/DJBooth.jsx`, `src/pages/FleetDashboard.jsx`:**
- Added `onVoiceDiag` prop to `AnnouncementSystem` (destructured, added to both `useCallback` dep arrays)
- Both `<AnnouncementSystem>` usages in `DJBooth.jsx` now pass `onVoiceDiag={logDiag}` — events flow into the same rolling 20-entry `diagLog` that already goes to the fleet dashboard
- 7 instrumentation points added in `AnnouncementSystem.jsx`:
  - `voice_blob_invalid` — ElevenLabs returned audio that failed `ctx.decodeAudioData()` after 3 attempts (likely root cause of garbled/backwards speech — corrupt MP3 blob). Logs `{ dancer, voiceType, blobSize }`
  - `voice_blob_retry` — Same validation failure but on attempt 1 or 2 (recovered). Logs `{ dancer, voiceType, attempt, blobSize }`
  - `voice_timeout` — `AbortController` 30s timeout fired on ElevenLabs API call (the "hangs"). Detected via `genError.name === 'AbortError'`. Logs `{ dancer, voiceType }`
  - `voice_generate_fail` — API threw any other error (rate limit, auth, network). Logs `{ dancer, voiceType, error }`
  - `voice_play_fail` — Browser had audio URL but playback threw; auto-purges cache + regenerates. Logs `{ dancer, voiceType, error }`
  - `voice_play_recovered` — Purge + regenerate succeeded. Logs `{ dancer, voiceType }`
  - `voice_play_dead` — Purge + regenerate also failed, voice silently skipped. Logs `{ dancer, voiceType, error }`
  - `voice_skipped` — Outer catch (all recovery exhausted). Logs `{ dancer, voiceType, error }`
  - `voice_fallback_generic` — Last-resort pre-recorded generic voiceover used. Logs `{ dancer, voiceType }`
- `FleetDashboard.jsx` event log updated: new color groups (red = voice errors, yellow = recovered/skipped, orange = generic fallback) and human-readable labels for all 9 new event types

**Structural verification:**
- `playPrefetchedAnnouncement(null)` is safe — guards `if (!audioUrl)` at line 1593
- `outroPromise` starts BEFORE `playTrack` so TTS fetches in parallel with track loading
- Old-mode commercial replaces dancer track with Promo Bed; new-mode commercial plays over dancer track (already ducked)
- Error `catch` blocks still call `unduck()` in both handleTrackEnd and handleSkip
- 148/148 tests pass

### PENDING TO-DO (remaining — Pi-side only, no code changes needed):

#### AWAITING PI SSH (no code push needed — commands ready):
1. **neonaidj001 device name** — SSH to `neonaidj001@100.115.212.34`, run:
   ```bash
   echo "DEVICE_ID=neonaidj001" >> ~/djbooth/.env
   echo "CLUB_NAME=PONY BAMA" >> ~/djbooth/.env
   sudo systemctl restart djbooth
   ```
   Optional: `sudo hostnamectl set-hostname neonaidj001`

2. **neonaidj003 voiceover path** — Code fix already pushed (`c0b6d6f`). Also run on 003:
   ```bash
   echo "VOICEOVER_PATH=/home/neonaidj003/djbooth/voiceovers" >> ~/djbooth/.env
   sudo systemctl restart djbooth
   ```
   If count is still 0 after restart, voiceovers aren't syncing from R2 to 003 (separate investigation).

3. **Telegram on homebase** — SSH to `neonaidj@100.109.73.27`, run:
   ```bash
   echo "TELEGRAM_BOT_TOKEN=8771923747:AAEu6Nmym30ri1CyWhxSXl62QSvhkacvXVA" >> ~/djbooth/.env
   echo "TELEGRAM_CHAT_ID=8567217273" >> ~/djbooth/.env
   sudo systemctl restart djbooth
   ```
   Then test via fleet dashboard → master PIN login → Test Telegram button. Smart alerts (dead air, slow transitions, low cache rate) are already coded and will fire automatically once Telegram is active.

#### DEFERRED TO FUTURE SESSION:
4. **preloadedTrackRef "optimistic start"** — A `useEffect` at ~line 3234 pre-fetches the next dancer's first track into `preloadedTrackRef`, but transitions ignore it and call `getDancerTracks` fresh. Fix: use preloaded track to start audio immediately, fill rest of set in background. More complex restructuring — deferred.

### Session 55 — What was changed this session

**Song-save revert bug fix — `djSavedSongsRef` (commit `e794a2`) — `src/pages/DJBooth.jsx`:**

Root cause confirmed from Session 54: when a dancer transitions off stage, `handleSkip` and `handleTrackEnd` both call `getDancerTracks` for the pre-pick, which runs with the finished dancer's slot cleared. This was correct. BUT the intermediate fix (commit `d22877`, cooldown-check approach) would fail if ANY pre-picked song was on cooldown — even one cooldown song invalidated the entire DJ save. This made partial saves (DJ changes 1 of 3 songs) silently fall through to random picks.

Final fix: `djSavedSongsRef = useRef({})` — a dedicated ref that stores DJ-manually-saved tracks per dancer. Populated in `onSaveAll` when the DJ saves manual overrides. Consumed once (and deleted from ref) on the next transition for that dancer. Replaces the cooldown check entirely.

Key properties:
- Pre-pick miss → `getDancerTracks` API call (unchanged behavior)
- Pre-pick hit → DJ's exact saved tracks (no cooldown check, no API call)
- Partial saves (DJ changes 1 of 3) → all 3 tracks saved as-is
- Multi-round safety: ref entry deleted after first use — next round goes back to auto-pick
- Cross-dancer isolation: ref indexed by dancerId, no interference
- Last save wins: second Save All just overwrites the ref

Changed in BOTH `handleSkip` and `handleTrackEnd` full dancer transition blocks using `replace_all`.

**Dead air root cause analysis (Pi 003 — user confirmed voice ON):**

With announcements ON, when a dancer's last track ends:
1. Track ends → silence begins
2. `Promise.all([getDancerTracks, prePick])` — if pre-pick cache is invalid, API call fires → 0.5-2s of silence
3. Only AFTER that: outro prefetch begins (sequential, not parallel)
4. `duck()` called → `waitForDuck()` = 300ms settle
5. Outro plays — silence finally ends

So even with voice ON there's a dead air gap = getDancerTracks_time + outro_fetch_time + 300ms settle.
The minimum gap even with perfect pre-cache = just 300ms (duck settle).
The maximum gap = sum of all three sequential waits.

Key discovery: `preloadedTrackRef` (line ~3200 in DJBooth.jsx) pre-fetches and stores the next dancer's first track in memory, but is NEVER read during transitions. Transitions ignore it and call `getDancerTracks` fresh. This is wasted work.

**Fleet audio diagnostics (commit `c5042e9`):**

Added to `src/pages/DJBooth.jsx`:
- 5 new refs: `diagLogRef` (rolling 20 events), `prePickHitsRef`, `prePickMissesRef`, `lastTransitionMsRef`, `lastWatchdogRef`
- `logDiag(type, data)` helper — prepends entry with `{ ts: Date.now(), type, ...data }`, trims to 20
- Events logged:
  - `transition_start` — `{ from, to, trigger }` — fired at start of full dancer transition (both handleSkip and handleTrackEnd)
  - `prepick_hit` — `{ dancer }` — pre-cache was valid, no API call needed
  - `prepick_miss` — `{ dancer }` — pre-cache invalid, getDancerTracks API call triggered (gap source)
  - `track_play` — `{ dancer, track, gapMs }` — track started, gapMs = time since transition_start
  - `track_play_fallback` — `{ dancer, reason }` — no URL, fell back to random
  - `transition_complete` — `{ dancer, durationMs, trigger }` — full duration including announcements
  - `watchdog_fired` — `{ silentMs, dancer, track }` — dead air detected, captures who/what/how long
- `lastWatchdogRef` stores `{ at, silentMs, dancer, track }` for the most recent watchdog fire

Added to `boothApi.postState()` (runs every 2s):
`diagLog`, `prePickHits`, `prePickMisses`, `lastTransitionMs`, `lastWatchdogAt`, `lastWatchdogSilentMs`, `lastWatchdogDancer`, `lastWatchdogTrack`

Added to `server/index.js`:
- New fields in `liveBoothState` defaults
- `/api/booth/state` handler now accepts and stores all new fields
- `getExtraData()` now returns all new fields + **FIXED** `currentDancer`/`currentSong` (were always null before — `getExtraData` never read them from `liveBoothState`)

Added to `server/heartbeat-client.js`:
All new fields forwarded in payload: `isRotationActive`, `isPlaying`, `announcementsEnabled`, `songsPerSet`, `diagLog`, `prePickHits`, `prePickMisses`, `lastTransitionMs`, `lastWatchdogAt`, `lastWatchdogSilentMs`, `lastWatchdogDancer`, `lastWatchdogTrack`

Added to `server/fleet-monitor.js`:
All new fields stored in `devices.set()` in-memory map (no DB schema change needed)

Added to `src/pages/FleetDashboard.jsx`:
- New imports: `Radio`, `Volume2`, `VolumeX`, `Zap` from lucide-react
- "Audio Diagnostics" collapsible panel per device card (only shown when device is online)
- Shows: Rotation On/Off badge, Playing/Silent badge, Voice On/Off badge, Last Transition (green/yellow/red), Cache Hit Rate (green/yellow/red), Songs/Set, dead air alert banner (red, with dancer+track+duration), "No dead air this session" when clean, collapsible event log (20 entries, newest first, color coded by severity)
- Summary line on collapsed header: shows "⚠ Dead air logged" in red when lastWatchdogAt is set

---

## CURRENT STATUS (as of Session 54 — March 27, 2026)

### Latest GitHub commits this session:
- `5ae0cb6` — "Fix: clear finished dancer slot before pre-picking so own songs dont block new selection"
- `61fb632` — "Fix: increase scrollbar width to 14px for touch screen usability"

### Rollback point BEFORE song selection changes: `d1269da11102297beb56dfbbc877b7e39d86e30d`
Use this commit to roll back if the song selection changes cause problems.

### Session 54 — What was changed this session

**Root bug fixed — dancer shows 1 song at bottom after DJ deletes 1 from set:**
The core issue: when `getDancerTracks(finishedDancer)` was called at the flip, `rotationSongsRef.current` still held the finished dancer's old stale pre-pick in their slot. All those songs were included in `assignedNames` (the exclusion list sent to the server), artificially restricting the pool the server could pick from. With a smaller playlist, this caused the server to return only 1 song.

**Fix (commit `5ae0cb6`) — `src/pages/DJBooth.jsx`:**
In BOTH flip locations (handleSkip and handleTrackEnd — identical code, changed with `replace_all`):
```javascript
// Before calling getDancerTracks, clear the finished dancer's stale slot
const scratchSongs = { ...rotationSongsRef.current };
delete scratchSongs[finishedDancerId];
rotationSongsRef.current = scratchSongs;
const existingTracks = scratchSongs[newRotation[newIdx]];
```
This runs before the `Promise.all([getDancerTracks(nextDancer), getDancerTracks(finishedDancer, playingTrackExclude)])` call, so when getDancerTracks reads `rotationSongsRef.current` to build `assignedNames`, the finished dancer's own songs are no longer in the list.

**Other song selection changes made this session (also in current code):**
- `existingTracks.length >= songsPerSetRef.current` (4 spots in DJBooth.jsx) — when a dancer's pre-pick at the bottom has fewer songs than configured (because DJ deleted one), the system throws it away and gets a full fresh set instead of playing a short set
- `playingTrackExclude` added in both flip locations — currently-playing track explicitly excluded from finished dancer's next pre-pick so it can't immediately repeat
- `server/db.js` genre filler — when `freshTracks.length < count` (playlist has some fresh songs but not enough to fill the set), fills remaining slots from general library. Safety net for small playlists.
- All-on-cooldown fallback — when every playlist song is on 4-hour cooldown, falls back to general library instead of replaying cooldown songs

**Scrollbar — touch-friendly (commit `61fb632`) — `src/Layout.jsx`:**
- Width: `8px` → `14px` (applies globally to all scrollable areas via `::-webkit-scrollbar`)
- Thumb: more visible blue-gray `#3a4a6b`, rounded corners, 2px border gap from track
- Hover: turns cyan `#00d4ff`
- One file change covers entire app — confirmed no other scrollbar CSS overrides exist anywhere

### Song selection rules — current state (all implemented):
1. Pick songs from dancer's assigned playlist first (fresh = not played in last 4 hours)
2. 4-hour cooldown — server AND client both set to 4 hours
3. All playlist songs on cooldown → fall back to general library (genre folder if active genres set)
4. Partial fresh set (fewer fresh songs than songsPerSet) → fill remaining slots from general library
5. Manual DJ selection always bypasses cooldown; play IS logged to history
6. At every rotation flip, if dancer's pre-pick has fewer songs than songsPerSet → get fresh full set

### Session 53 — What was changed this session

**Kiosk inactivity timeout behavior changed (App.jsx):**
- OLD: 3-min timeout → full-screen PIN pad overlay on top of DJBooth
- NEW: 3-min timeout → 30-sec countdown warning → navigate to `/` (landing page)
- Music/rotation/voiceovers keep playing via `PersistentDJBooth` (DJBooth stays mounted, hidden)
- Timer pauses while on landing page (won't re-fire until DJ logs back in and returns to DJBooth)
- Session stays alive underneath — no token destruction — DJBooth API calls keep working
- Countdown overlay now says "Returning to login screen / Tap anywhere to stay active"

**RotationDisplay — Break Song display (RotationDisplay.jsx):**
- During a break, "BREAK SONG" now appears in big white h1 where the dancer name normally shows
- Uses same `current-name` class (neon glow, pulse animation) as dancer name
- Layout: "Break" label → "BREAK SONG" h1 → break dots → countdown timer
- Next dancer still shows correctly in "Up Next" section below

**Display Screen Timer toggle (DJOptions.jsx + RotationDisplay.jsx):**
- New toggle in Options tab: between Commercials and Music Selection Mode sections
- Stored in `localStorage` key `djbooth_display_countdown` (default: true = show)
- RotationDisplay reads on mount, listens for `djbooth_display_countdown_changed` event + `storage` event
- Toggling updates the crowd display live without reload

**Exit Kiosk Mode moved (DJOptions.jsx → Configuration.jsx):**
- Removed from Options tab entirely (was accessible to any logged-in DJ — too easy to hit accidentally)
- Now lives only in Configuration page, behind master PIN
- Already existed in Configuration — just removed from Options

### Latest GitHub commit before session 52: `a44c7c5` — "Fix: restore lock overlay so music never stops on kiosk timeout; fix landing page buttons; fix DancerView exit; fix rotation restart index"

### Update pipeline — HOW IT WORKS (confirmed, do not second-guess)
1. Code changes are made in Replit → **Replit automatically syncs every commit to GitHub** (live connection, no manual push needed for normal changes)
2. User updates homebase by running `~/djbooth-update.sh` on homebase — pulls latest from GitHub — user does this nightly
3. Venue Pis reboot at 8:30 AM and pull from homebase automatically — confirmed working
- **github-pi-update skill** (explicit full-tree push): Only needed when a large structural change must be force-synced or the auto-sync is suspected to have missed something. NOT required for normal session work.
- **Why 003 had old 3-button landing page on March 25**: 003's 8:30 AM auto-update ran before the user had updated homebase that day. When 003 rebooted, homebase hadn't yet pulled the `c5ed6c4` fix. Next reboot will get correct code.
- **Rule**: After making significant fixes, remind user to update homebase so tomorrow's Pi reboots get the latest.

### Session 52 — What was fixed / built (GitHub commit `a44c7c5`)

**Kiosk lock overlay restored (App.jsx — CRITICAL):**
- `KioskLockManager` was navigating to `/` on inactivity timeout, unmounting DJBooth and killing music
- This was a regression introduced in commit `46df0c8` (March 21) that undid the Session 48 critical fix
- Restored: timeout now shows a full-screen PIN pad overlay on top of DJBooth
- DJBooth stays mounted, music/rotation/voiceovers keep playing behind the lock screen
- DJ enters any valid DJ PIN to unlock — no session destruction, no navigation
- `PersistentDJBooth` component already kept DJBooth alive; lock overlay just needed to not navigate away

**Landing page buttons — correct behavior (Landing.jsx):**
- Kiosk (localhost): shows "NEON AI DJ" + "Entertainer" only
- Remote/iPad (non-localhost): shows "DJ / Manager Remote" + "Entertainer" only
- `isLocalDevice` = `window.location.hostname === 'localhost' || '127.0.0.1'`
- 003 was showing old code (all 3 buttons) because it hadn't updated from GitHub since March 22

**DancerView exit fix (DancerView.jsx):**
- Inactivity timeout and manual logout both navigate to `/` (landing page) instead of `/DJBooth`
- Applies to both `isDancerSession` path and fallback path

**Rotation restart index fix (DJBooth.jsx):**
- `stopRotation()` resets `currentDancerIndex` to 0
- Restart always begins from position 0 of whatever order the DJ has arranged

### Action needed after this session
- User: run `~/djbooth-update.sh` on homebase to pull `a44c7c5` from GitHub
- Then force update on 003 when venue goes dark: `~/djbooth-update.sh`
- 001 also needs update when accessible

### Latest GitHub commit: `e0b5bac` (March 22) — SUPERSEDED by `a44c7c5` above

### Fleet Dashboard correct URL (UPDATED)
- **OLD (retired):** `100.95.238.71:3001/fleet` — DO NOT USE
- **NEW (correct):** `http://100.109.73.27:3001/fleet`

### Session 51 — What was fixed / built

**Boot update fix (commit `e0b5bac`):**
- Root cause confirmed: `djbooth-update.service` was using `After=network.target` which only means the NIC is up, NOT that internet is available. Service fired immediately at boot, hit GitHub before internet was ready, got `HTTP 000`, and failed every reboot.
- Fix: Changed to `After=network-online.target` + `Wants=network-online.target` in the systemd service definition inside `public/djbooth-update-github.sh`.
- The new script also has a built-in 5-minute internet wait loop when `DJBOOTH_BOOT_UPDATE=1` — belt + suspenders.
- **neonaidj001**: Manually updated March 22 using `DJBOOTH_SKIP_HOMEBASE=1 ~/djbooth-update.sh`. Now has new 8-step script and new service file. Tomorrow's 8:30 AM reboot is first real test.
- **neonaidj003 + all future units**: Will get fix automatically on next update run.

**neonaidj001 FLEET_SERVER_URL still wrong (PENDING):**
- Still pointing at old retired homebase `100.95.238.71`. Causes heartbeat timeouts every minute.
- Fix command (run on neonaidj001):
  ```bash
  sed -i 's|FLEET_SERVER_URL=http://100.95.238.71:3001|FLEET_SERVER_URL=http://100.109.73.27:3001|' ~/djbooth/.env && sudo systemctl restart djbooth
  ```

**UI readability improvements (commits `b441a00`):**
- Song names in rotation cards: `text-xs` → `text-sm` (matches dancer name size)
- Break song names: `text-xs` → `text-sm`
- Upcoming queue song names: `text-xs` → `text-sm`
- Music library track color: `text-gray-300` → `text-[#E0E0E0]` (softer, less glare)
- Song previews under dancer names in live rotation: `text-xs text-gray-500` → `text-sm text-gray-400`
- Research basis: off-white `#E0E0E0` on dark bg reduces eye strain vs pure white; 14px minimum for extended use

**Button hardening (commits from Session 51):**
- Reroll button: in-flight lock per slot, spinner icon, ignores rapid clicks
- Voice ON/OFF toggle: 1-second cooldown
- Break song Swap: 1-second cooldown

### Session 50 — What was built (all on GitHub)
- **"Rotation Screen" button**: Renamed from "Open Display" in DJBooth.jsx. Changed from gray outline to `bg-[#00d4ff] hover:bg-[#00a3cc] text-black font-semibold` — matches Save All button color. Stands out clearly in the top bar at all times.
- **RotationDisplay natural stacking**: Names render at their fixed 5.5rem size, stacking naturally from top. With a full roster (~7-10+ names) they fill the screen. With fewer names, dark background fills the rest — no stretching, no redistribution. `flex-1` on the outer container still ensures the dark background covers the full screen edge-to-edge.
- **Confirmed behavior**: The dark background always fills 100% of the display (h-screen). Names fill as much space as the roster warrants. No browser chrome, no white gaps.
- **Confirmed scrolling**: Display polls every 5 seconds. When DJ advances rotation, screen updates within 5 seconds — new current name at top, list below shifts up automatically. No continuous scroll animation, clean snap updates.
- **Max names shown**: Currently capped at 10. If the roster is large and 10 names don't fill the screen, cap can be raised.

### Session 49 — What was built (all on GitHub)
- **Staff Accounts feature**: Named DJ/Manager accounts with individual PINs. Created/deleted in Configuration (master PIN only). Full CRUD: `GET/POST/DELETE /api/staff` all behind `requireMaster` middleware.
- **Activity Audit Log**: Every login, logout, skip, and break toggle gets recorded with staff name + role + timestamp. Master-gated `GET /api/audit/log` and `GET /api/audit/log.csv`. Auto-cleaned to 30 days / 1000 entries.
- **Named login flow**: Login checks (1) master PIN → `staffName=Master, isMaster=true`; (2) named staff account → `staffName=Alex, staffRole=dj`; (3) legacy `dj_pin` hash → backward compat fallback. All 3 paths still use `role=dj` so all existing `requireDJ` middleware keeps working.
- **DB additions**: `staff_accounts` table (id, name, role, pin plaintext, created_at), `audit_log` table (id, staff_name, staff_role, action, details, created_at), `staff_role` and `staff_name` columns on `sessions` table (all try/catch ALTER TABLE — safe migration).
- **`createSession` signature updated**: `createSession(role, dancerId=null, staffName=null, isMaster=0, staffRole=null)` — all call sites updated.
- **AuthContext.jsx**: Added `staffName`, `staffRole`, `isMaster` state. Populated from login response and session check. Exposed in context value.
- **Configuration.jsx**: Two new sections added (master-PIN gated): **Staff Accounts** (add form with name/role/PIN, color-coded list with delete) and **Activity Log** (scrollable table with day-range filter, refresh, CSV download icon). Icons: Users, ClipboardList, ShieldCheck.
- **DJBooth.jsx**: Module-level `auditEvent(action, details)` fire-and-forget helper. Called on: `skip_song` (after debounce in handleSkip), `break_mode_on` / `break_mode_off` (in onBreakSongsPerSetChange, only on toggle change). Never await — never blocks audio.
- **Cleanup**: `setInterval(() => cleanOldAuditLog(30), ...)` added to server startup. `isStaffPinTaken()` prevents duplicate PINs. Master PIN itself can't be used as a staff PIN.

### Session 58 — Mar 29, 2026 (commit `23531bc`)

**Save All immediately refreshes crowd RotationDisplay** (`6a948c4`):
- RotationDisplay polls `/api/stage/current` which reads `_stageState` (in-memory, only updated by `POST /api/stage/sync`). `onSaveAll` already chains through `localEntities.Stage.update → syncStageToServer` but that's slow/async.
- Fix: added a direct fire-and-forget `POST /api/stage/sync` at the top of `onSaveAll` in DJBooth.jsx, immediately after setting `rotationRef.current = newRotation`. Display now updates within 1 second of pressing Save All instead of waiting for the DB mutation chain.

**Skip Dancer button + rotation display fixes** (`db6ddbc`):
- New orange SkipForward button appears on the active dancer's card in RotationPlaylistManager, only while rotation is running and only on the CURRENT dancer (index === currentDancerIndex). Yellow SkipForward on all other cards is unchanged.
- Pressing the orange button: sets currentSongNumber to 999, calls handleSkip → end-of-set path triggers → she moves to bottom of rotation, song count resets to 0, break songs play if queued, next dancer gets full intro.
- Top Skip button is completely untouched (still skips songs within a set).
- `removeFromRotation` index bug fixed: when removing the current dancer (index 0), old code did `(0-1+n)%n = n-1` (wrapping to last dancer). Fixed to `Math.min(removedIdx, newRotation.length-1)` when removing the current dancer, `currentDancerIndex - 1` when removing a dancer before the current one.
- `handleSkip` mid-set path: added `updateStageState(idx, rot)` + fire-and-forget `POST /api/stage/sync` before announcement so crowd display updates immediately instead of staying on the removed/skipped dancer.

**Promos folder excluded from R2 sync** (`92755d3`):
- Promos are venue-specific (mixed locally via ffmpeg from ElevenLabs voice + Promo Beds). They must NOT sync across units — a Pony Evansville promo should never play at Pony Bama.
- Each Pi creates and manages its own `Promos/` folder entirely locally.
- `syncMusicFromR2`: skips `Promos/` downloads; also protects local `Promos/` files from being purged (purge step now excludes `Promos/` from toDelete list).
- `syncMusicToR2`: skips `Promos/` uploads; orphan-purge step also skips `Promos/` so homebase never deletes venue promos from R2 if any exist there.
- The batch-convert task (`POST /api/voiceovers/convert-all-promos`) should be run on EACH Pi individually, NOT on homebase. Homebase has no access to venue-specific promo audio files.

**Dancer-add race condition during AI announcements** (`23531bc`) — 4 locations fixed:
- Root cause: `addToRotation` called `setRotation(newRotation)` but never updated `rotationRef.current`. All transition end-of-async code reads the ref, so added dancers were invisible to display/DB saves.
- **Fix 1**: `addToRotation` now sets `rotationRef.current = newRotation` alongside `setRotation`.
- **Fix 2**: Post-interstitial path (handleTrackEnd, after break songs complete) was calling `setRotation(newRotation)` AFTER the intro announcement — stale snapshot erased DJ additions made during the announcement. Changed to read `rotationRef.current` (live) after announcement finishes.
- **Fix 3**: handleSkip break path — auto-select fetch (`/api/music/select`, up to 5s) ran before the rotation flip. Flip used `[...rot]` (captured pre-fetch) so DJ additions during the fetch were dropped. Changed `flippedRotation` to build from `[...rotationRef.current]`.
- **Fix 4**: handleTrackEnd break path — same pattern as Fix 3, same fix applied.

### Session 48 — What was fixed (all on GitHub, neonaidj001 partially updated)
- **Open Display button** (`8053c79`): Server now writes `/tmp/djbooth-display-trigger` instead of trying to spawn Chromium directly. Button shows toast feedback.
- **labwc autostart watcher loop** (Pi-side only, not code): neonaidj001 autostart file was missing the watcher loop. Rewrote `~/.config/labwc/autostart` with full block (pkill swayidle/swaylock + wlr-randr + Chromium launch + watcher loop). **neonaidj003 needs same fix before Monday.**
- **swayidle/swaylock disabled** (Pi-side, neonaidj001): OS-level screen locker was killing audio when screen timed out. Killed and permanently disabled via autostart. **neonaidj003 needs same fix.**
- **Kiosk lock overlay** (`b90d955`): CRITICAL FIX — lock screen now shows as an overlay instead of logging out and navigating away. Music, rotation, and voiceovers continue playing behind the locked screen. Unlock by entering 5-digit DJ PIN. No session destruction on lock.
- **Homebase NOT yet updated for Session 48**: Use `DJBOOTH_SKIP_HOMEBASE=1 ~/djbooth-update.sh` on homebase to pull direct from GitHub. **User commits to updating homebase every night** — venue Pis reboot at 8:30 AM daily and pull from homebase, so nightly homebase update ensures all Pis get latest code every morning automatically.

### Update command — bypass homebase, go direct to GitHub
```
DJBOOTH_SKIP_HOMEBASE=1 ~/djbooth-update.sh
```
Via SSH: `ssh neonaidj001@100.115.212.34 "DJBOOTH_SKIP_HOMEBASE=1 ~/djbooth-update.sh"`
Use this any time homebase is behind on updates.

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
- **Verified update tracking (Session 46)**: Update script stamps `~/.djbooth-last-update` (SHA|timestamp) only on verified success. Fleet dashboard shows actual time + green ✓ / orange ✗ / gray per device based on SHA comparison to homebase. Activated by running `~/djbooth-update.sh` once on each Pi.
- **Pre-picked songs display fix (Session 47)**: Upcoming dancer cards in rotation panel now show auto-picked songs correctly after a dancer transition. commit `8cdd522`
- **Reset Voiceover full clear fix (Session 47)**: Reset Voiceover button now clears both server files/DB AND browser IndexedDB cache — old audio can no longer replay in the same session. commit `a3f6c38`
- **Open Display button fix (Session 48)**: `POST /api/display/launch` now correctly writes `/tmp/djbooth-display-trigger` instead of trying to spawn Chromium from the server process (which has no Wayland access and silently failed). Button now shows toast success/error. commit `8053c79`
- **Energy level removed (Session 48)**: All user-facing energy level UI removed — buttons, header badge, config display, help entry, announcement panel L4 badge. Internal voice system still runs at locked level 4.
- **Remote touch improvements (Session 48)**: All button tap targets enlarged for iPad landscape use — volume +/−, announce toggle, deactivate song, songs/break buttons, energy buttons, rotation move/remove, bottom nav, library rows, add-to-rotation, break slots.
- **Countdown timer on RotationDisplay (Session 48)**: Live track countdown (updated every second via ref) + animated break dot indicators (cyan/done/upcoming) added to RotationDisplay.jsx.
- **Kiosk lock overlay (Session 48)**: CRITICAL — lock screen no longer logs out and navigates away (which killed music). Now shows a full-screen overlay. DJ booth stays mounted, music/rotation/voiceovers keep playing behind it. Unlock with 5-digit DJ PIN via `/api/auth/login`. commit `b90d955`
- **labwc autostart watcher loop confirmed on neonaidj001 (Session 48)**: Open Display button confirmed working after adding watcher loop to autostart. swayidle/swaylock confirmed killing audio — disabled permanently in autostart. neonaidj003 needs same autostart fix before field deployment.
- **Staff Accounts + Audit Log (Session 49)**: Named DJ/Manager accounts with individual PINs. Activity log records all logins, logouts, skips, break toggles. Master-gated in Configuration. Backward-compatible with legacy `dj_pin`. commit `3786125`

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
- `GET /api/staff` — list all staff accounts (requires master PIN session)
- `POST /api/staff` — create staff account `{name, role, pin}` (requires master PIN session)
- `DELETE /api/staff/:id` — delete staff account (requires master PIN session)
- `GET /api/audit/log?days=30&limit=200` — get audit log entries (requires master PIN session)
- `GET /api/audit/log.csv?days=30` — download audit log as CSV file (requires master PIN session)
- `POST /api/audit/event` — fire-and-forget audit event `{action, details?}` (requires DJ auth)

### AudioEngine notes (CRITICAL — do not change behavior)
- `AUTO_GAIN_TARGET_LUFS = -10` (changed from -14; -10 is club standard)
- `loadTrack` accepts `{ url, name, auto_gain }` — if `auto_gain` present, pre-populates `autoGainCacheRef` so `analyzeTrackLoudness` returns immediately from cache; no 10s fetch+analyze
- Log line: `🔊 AutoGain: pre-loaded server gain=X.XXx for SONGNAME`

### ~~Raspberry Pi Connect — CANCELLED, DO NOT INSTALL~~

**Decision (Session 50):** Do NOT install Raspberry Pi Connect on any fleet Pi. Researched and compared against Tailscale — Tailscale wins for this fleet in every category:
- Pi Connect conflicts with Tailscale (gray screen bug when both run simultaneously)
- Pi Connect is Pi-only — can't join laptop, phone, or iPad to the same network
- Pi Connect organizational fleet plan costs $0.50/device/month — scales badly to 50+ Pis
- Tailscale already running on all Pis, already handles SSH, fleet heartbeats, fleet dashboard — free for up to 100 devices
- Everything Pi Connect would offer, Tailscale already does better for this setup

**Use Tailscale SSH for all remote access.** Do not install rpi-connect.

---

### Outstanding TODOs

**Immediate — after 4 AM set:**
- **neonaidj001 — pull Session 48 code** (kiosk lock overlay, swayidle fix, countdown timer, display trigger): `DJBOOTH_SKIP_HOMEBASE=1 ~/djbooth-update.sh` — bypasses homebase (which hasn't updated yet), goes straight to GitHub. Pi-side autostart already fixed tonight (swayidle disabled, watcher loop added). Just needs the code update.
- **Homebase — pull Session 48 code**: SSH in and run `DJBOOTH_SKIP_HOMEBASE=1 ~/djbooth-update.sh` on homebase itself, OR use the Fleet dashboard Update button once homebase is accessible. Latest commit is `b90d955`.
- ~~**Verify Open Display works on neonaidj001**~~ — DONE ✓ (Session 48). Watcher loop was missing from autostart. Started manually, rewrote `~/.config/labwc/autostart`. Open Display button confirmed working. swayidle confirmed causing audio loss — disabled.
- **neonaidj001**: Set `DEVICE_ID=neonaidj001` in `~/djbooth/.env` (fleet heartbeat identification)
- **neonaidj002**: Tailscale IP still unknown — check fleet dashboard
- **Fleet WiFi static IP plan**: Same SSID/subnet across all venues; static `192.168.88.100` on each Pi's `wlan0` via `/etc/dhcpcd.conf`. iPad enters IP once, works everywhere. Not yet implemented.

**neonaidj003 — Full pre-field checklist (must complete before Monday deployment):**
- [ ] Run `~/djbooth-update.sh` — pull all latest code
- [ ] Set `CLUB_NAME=<venue name>` in `~/djbooth/.env`, then `sudo systemctl restart djbooth`
- [ ] Set `DEVICE_ID=neonaidj003` in `~/djbooth/.env` (confirm it's there or add it)
- [ ] Set `FLEET_DEVICE_KEY=<api key>` in `~/djbooth/.env` so it reports to fleet correctly
- [ ] Confirm `djbooth` systemd service starts clean: `systemctl status djbooth`
- [ ] Confirm boot auto-update fires: reboot, then `sudo cat ~/djbooth-boot.log` — look for fresh timestamp and "Update complete!"
- [ ] Fix labwc autostart — run the full one-paste block from Session 48 notes. Fixes TWO confirmed issues: (1) watcher loop missing — Open Display button did nothing, (2) swayidle/swaylock running — screen timeout kills audio (CRITICAL). Confirmed on neonaidj001. neonaidj003 almost certainly has both problems.
- [ ] Start watcher manually after fixing autostart (or reboot to let autostart fire it)
- [ ] Confirm HDMI-2 rotation display loads automatically after reboot (8s after desktop loads)
- [ ] Verify `ps aux | grep djbooth-display-trigger` shows watcher loop running
- [ ] Press Open Display button from DJ booth — confirm green toast + display fires on HDMI-2
- [ ] Log in as DJ, run a test rotation with at least 2 entertainers, verify music plays and announcements fire
- [ ] Check fleet dashboard from homebase — confirm neonaidj003 shows as online and heartbeat is current
- [ ] Add at least one entertainer, run Save All, verify voiceover pre-generation completes without error
- [ ] Verify music library loads (rescan from Configuration if needed)
- [ ] Test iPad remote: connect to neonaidj003 IP, confirm live state syncs and controls work

**Future / lower priority:**
- **R2 music write lockdown (APPROVED, not yet built)**: Create two separate Cloudflare R2 API tokens. Homebase token: full read/write to entire bucket (music + voiceovers). Venue Pi token: read-only on `music/` prefix, read/write on `voiceovers/` only. This enforces at the credential level that only homebase can add/modify music in R2. Venue Pis update script must also be changed to never upload to `music/` prefix. Voiceover sharing continues unchanged.
- **Playlist song mismatch investigation (NEEDS DIAGNOSIS — Mar 22 show)**: Some dancers played random library songs instead of playlist songs on first rotation. Other dancers worked correctly. Music drive confirmed intact — all songs present. Root cause unknown. To diagnose: SSH neonaidj001, run `sqlite3 ~/data/djbooth.db "SELECT name FROM music_tracks WHERE name LIKE '%<partial song name>%';"` to compare against broken dancer's playlist entries. May be case mismatch, encoding difference, or extra whitespace in stored names.
- **Commercial ducking bug (DEFERRED)**: Post-commercial intro block uses `autoDuck: false` → should be `autoDuck: true`. One-line fix in `DJBooth.jsx` post-commercial intro `playAnnouncement` call. User deferred.
- **19" kiosk touchscreen**: General touch target treatment still needed (separate from iPad remote, lower priority).
- **Multi-language announcements (WAY down the road)**: ElevenLabs `eleven_multilingual_v2` already supports it — same voice speaks Spanish/French/etc. if you send it text in that language. Script writer also supports it. Work needed: language field in config, thread it into prompt builder, update cache keys to include language, rewrite English-specific slang phrases into target-language equivalents. Technical lift is low; cultural accuracy is the real investment.
- **Multi-stage support (discussed Session 48 — way down the road)**: One audio feed, one music system — all stages dance to whatever main stage is playing. Main stage gets full treatment (intro, round 2/3, outro) unchanged. Satellite stages only need a short "come to the stage" call announcement timed to fire during main stage round 2. What to build: (1) satellite dancer queue alongside main rotation with stage label per slot, (2) "satellite call" announcement type — short directional ElevenLabs voiceover, no hype build-up, (3) auto-trigger when main stage hits round 2 (or manual tap), (4) satellite stage cards on HDMI-2 rotation display below main stage countdown. Main stage system needs zero changes — satellite layer is purely additive. Complexity: medium. Hardest part is the queue management UI, not the announcements or triggers.
- **Homebase-aware update script**: Skip Chrome kill/relaunch when `IS_HOMEBASE=true` in env
- **USB SSD music library on homebase**: Mount 1TB exFAT SSD at fixed path, update homebase `MUSIC_PATH`
- **Venue Pi fleet error key**: Each venue Pi needs `FLEET_DEVICE_KEY=<api key from registration>` in `~/djbooth/.env`
- **R2 voiceover gap**: Reset Voiceover now clears local + IndexedDB but NOT R2. On next boot, R2 sync may re-download cleared voiceovers. Low priority; full fix would delete from R2 in the reset endpoint

### Context Reset Prevention
- **ALWAYS** keep this SKILL.md updated at the end of every session
- **ALWAYS** push changes to GitHub before session ends (commit ID + short description)
- If context is lost, the scratchpad at the top of the next session summary + this file is the full recovery source

---

## Mar 21, 2026 — Session 49 (Staff Accounts + Audit Log — commit `3786125`)

### Feature: Named Staff Accounts (DJ / Manager)

**What it does:** Instead of one shared DJ PIN, each staff member has their own named account. Login with their PIN → their name shows in the audit log. Master PIN always works and grants `is_master=1` access.

**Login priority order:**
1. Master PIN → `staffName=Master`, `staffRole=master`, `isMaster=true`
2. Named staff account PIN → `staffName=Alex`, `staffRole=dj|manager`, `isMaster=false`
3. Legacy `dj_pin` setting (hashed bcrypt) → `staffName=Staff`, `staffRole=dj` — backward compat fallback

All three paths set `role=dj` in the session — all existing `requireDJ` middleware keeps working unchanged.

**DB changes (safe try/catch ALTER TABLE — no migration needed):**
- NEW `staff_accounts` table: `id, name, role TEXT ('dj'|'manager'), pin TEXT (plaintext), created_at`
- NEW `audit_log` table: `id, staff_name, staff_role, action, details, created_at`
- `sessions` table: added `staff_name TEXT DEFAULT NULL`, `is_master INTEGER DEFAULT 0`, `staff_role TEXT DEFAULT NULL`
- `createSession` new signature: `createSession(role, dancerId=null, staffName=null, isMaster=0, staffRole=null)`

**New server functions (db.js):** `createStaffAccount`, `listStaffAccounts`, `deleteStaffAccount`, `getStaffAccountByPin`, `isStaffPinTaken`, `createAuditEntry`, `getAuditLog`, `getAuditLogCsv`, `cleanOldAuditLog`

**New server middleware:** `requireMaster` — checks `req.session.is_master`, returns 403 if not. `writeAudit(req, action, details)` — pulls name/role from session, writes to audit_log, never throws.

**Audit events currently logged:** `login`, `logout`, `staff_created`, `staff_deleted`, `skip_song`, `break_mode_on`, `break_mode_off`. DJBooth calls `POST /api/audit/event` fire-and-forget (never awaited — never blocks audio).

**AuthContext changes:** `staffName`, `staffRole`, `isMaster` state added. Populated from login response, session check response, and session-expired event. Exposed in context value.

**Configuration.jsx changes:** Two new cards (inside master PIN gate):
- **Staff Accounts**: Name + role dropdown + PIN input form. List of existing accounts with role badge (cyan=dj, yellow=manager), delete button. Prevents duplicate PINs, prevents using master PIN.
- **Activity Log**: Scrollable table (max-h-80), day-range selector (7/30), refresh button, CSV download link. Columns: time (Mon DD HH:MM), staff name (color by role), action + details.

**DJBooth.jsx:** Module-level `auditEvent(action, details)` helper — grabs token from localStorage, fires POST, swallows errors. Called at: `handleSkip` (after 2s debounce check), `onBreakSongsPerSetChange` (on toggle change only, not every increment).

**Cleanup:** `setInterval(() => cleanOldAuditLog(30), 24h)` added. CSV filename uses today's ISO date. Staff PIN uniqueness enforced server-side with `isStaffPinTaken()`.

---

## Mar 20, 2026 — Session 47 (Rotation Panel Display + Voiceover Reset + Fleet Ops)

### Fix 1: Pre-Picked Songs Not Showing in Rotation Panel (commit `8cdd522`)

**Bug:** Upcoming dancer cards showed "No songs assigned" even when songs were auto-picked and visible in console.

**Root cause:** `djOverridesRef` in `RotationPlaylistManager.jsx` is a Set that gets populated whenever the DJ manually drags/assigns a song to a dancer. Once a dancer's ID is in this set, the sync from `activeRotationSongs` → `songAssignments` (the display source) is permanently skipped for that dancer — even on their NEXT rotation set. The set was never cleared between sets.

**Fix:** Added `useEffect` in `RotationPlaylistManager.jsx` that watches `currentDancerIndex`. When the index changes (dancer transition), it reads the PREVIOUS dancer's ID from `localRotation[prevDancerIndexRef.current]`, removes them from `djOverridesRef`, then updates `prevDancerIndexRef`. This clears the flag after each set finishes so auto-picks show correctly next time.

```javascript
// New ref + effect added to RotationPlaylistManager.jsx
const prevDancerIndexRef = React.useRef(currentDancerIndex);

useEffect(() => {
  if (!isRotationActive) return;
  if (prevDancerIndexRef.current !== currentDancerIndex && localRotation && localRotation.length > 0) {
    const finishedId = String(localRotation[prevDancerIndexRef.current]);
    if (finishedId) djOverridesRef.current.delete(finishedId);
  }
  prevDancerIndexRef.current = currentDancerIndex;
}, [currentDancerIndex, isRotationActive]);
```

**Files:** `src/components/dj/RotationPlaylistManager.jsx`

---

### Fix 2: Reset Voiceover Button Not Clearing Same Session (commit `a3f6c38`)

**Bug:** After pressing Reset Voiceover on a dancer's card, pressing Queue Announcements would still play the OLD voiceover in the same session.

**Root cause:** Voiceovers are cached in TWO places:
1. Server filesystem + database — cleared by Reset button ✓
2. Browser IndexedDB (`djAnnouncementsDB` / `announcements` store) — NOT cleared by Reset button ✗

`AnnouncementSystem.jsx` checks IndexedDB first when playing announcements (`findCachedAtAnyVariation` → `getCachedFromIndexedDB`). If the audio blob is there, it serves it directly without asking the server. So the reset appeared to work but the browser still had the audio cached.

**Fix:** Added `clearDancerFromIndexedDB()` function to `DancerRoster.jsx` that opens the same IndexedDB, gets all keys, filters to those containing the dancer's name (keys are formatted as `${type}-${dancerName}-var${n}-v${version}`), and deletes them. Called inside `resetVoiceoversForDancer` after the server API call.

**Key note:** Reset still does NOT delete from R2 (Cloudflare). On next boot, R2 sync could re-download voiceovers if they were previously uploaded. This is a future fix; the same-session problem is now resolved.

**Files:** `src/components/dj/DancerRoster.jsx`

---

### Fleet Operations Clarified This Session

**Update chain:**
- Code pushed to GitHub from Replit
- Homebase pulls from GitHub via Update button in Fleet Command dashboard (queues command → heartbeat-client picks it up → runs `~/djbooth-update.sh`)
- Venue Pis pull pre-built bundle from homebase via Update button OR reboot (auto-update on boot)
- **Homebase does NOT auto-update on reboot** (`IS_HOMEBASE=true` skips boot service setup — by design)
- **Venue Pis (001/002/003) DO auto-update on every reboot** (systemd `djbooth-update.service` + `@reboot` cron)

**Bypass homebase for direct GitHub update (venue Pi terminal):**
```
DJBOOTH_SKIP_HOMEBASE=1 ~/djbooth-update.sh
```
Use when homebase hasn't updated yet but you need the fix immediately. Takes 3–5 min on Pi (builds frontend itself).

**SSH from phone to Pi (when VNC fails):**
- Install **Termius** app (iPhone App Store, free)
- Make sure Tailscale is connected on phone
- Connect: host `100.95.238.71`, port `22`, username `homebase`, Pi password
- Run `~/djbooth-update.sh` once connected

---

## Mar 19, 2026 — Session 46b (Fleet Update Reliability — Three Root Cause Fixes)

### Root Cause Analysis: Why the Fleet Dashboard "Update" Button Was Silently Failing

**Discovered by investigating why 003's stamp file never appeared after repeated Update button presses.**

#### Bug 1 — 2-minute timeout on the Update command (CRITICAL, commit `5f37890`)
`heartbeat-client.js` `executeRemoteCommand('update')` used `execSync()` with `timeout: 120000` (2 minutes). The full update script takes 5–10 minutes (apt-get, npm install, vite build). Node's `execSync` sends SIGKILL to the child process when the timeout fires — the update script dies mid-run, silently. **Every fleet dashboard Update button press was failing this way.** Updates that DID happen on venue Pis came from the boot auto-update via systemd (600s timeout), not the button.

**Fix:** Changed to `spawn()` with `detached: true` + `child.unref()`. The update script now runs as a fully independent background process that can never be killed by the heartbeat client. Falls back to `public/djbooth-update-github.sh` if `~/djbooth-update.sh` doesn't exist.

#### Bug 2 — GitHub API rate limit blocks stamp write (commit `5f37890`)
The stamp-writing code was guarded by `if [ -n "$COMMIT_SHA" ]`. GitHub's unauthenticated API allows 60 req/hr per IP — when rate-limited, the SHA fetch returns empty and the stamp is silently skipped. Every update completed but left no stamp.

**Fix:** Removed the guard. Stamp is always written. `COMMIT_SHA` defaults to "unknown" if API fails: `STAMP_SHA="${COMMIT_SHA:-unknown}"`.

#### Bug 3 — Dashboard had no state for "unknown" SHA (commit `5f37890`)
`renderUpdateStatus()` only handled: no SHA (unverified), known SHA matching homebase, known SHA not matching. "unknown" SHA would fall through to the orange ✗ mismatch display.

**Fix:** Added explicit `sha === 'unknown'` branch — shows timestamp + gray `✓ (SHA unavailable)` with tooltip explaining GitHub API was unavailable. Correct signal: update happened, exact version unverifiable.

### What IS reliable vs what was broken
- **Boot auto-update (systemd `djbooth-update.service`)** — always worked correctly, 600s timeout, confirmed working ✓
- **Fleet dashboard Update button** — was broken since day one due to 2-minute timeout ✗ → now fixed ✓
- **Stamp writing** — was broken when GitHub API unavailable ✗ → now always writes ✓

### One-time Pi action still needed for 003
003 had the OLD `~/djbooth-update.sh` (7-step, no self-update logic). It was manually replaced via `cp ~/djbooth/public/djbooth-update-github.sh ~/djbooth-update.sh` and run once. 003 now has the correct new script installed. Next reboot or next Update button press will use the new script end-to-end.

---

## Mar 19, 2026 — Session 46 (Fleet Verified Update Tracking)

### Feature: Verified Last-Update Stamp + Fleet Dashboard SHA Comparison (commit `c5388a7`)

**Problem:** Fleet dashboard "Last Update" field read `.git/FETCH_HEAD` mtime — but Pis don't use git at all (tarball download). Field always returned null. No reliable way to know if a Pi actually updated.

**Update script (`public/djbooth-update-github.sh`):**
- After successful tarball download, queries GitHub API for the exact commit SHA: `curl .../commits/main` → parses first `"sha"` field
- At the very end of the script — after the successful health check, before "[8/8] Cleaning up" — writes `~/.djbooth-last-update` in format `FULLSHA|EPOCH_MS_TIMESTAMP`
- Stamp is only written when the script reaches that point; the rollback path (`exit 1`) never reaches it, so a failed update leaves the old (correct) stamp intact
- One-time activation: run `~/djbooth-update.sh` once on each Pi including homebase

**Heartbeat client (`server/heartbeat-client.js`):**
- Replaced `getLastUpdateTime()` (which read non-existent `.git/FETCH_HEAD`) with `getLastSuccessfulUpdate()`
- Reads `$HOME/.djbooth-last-update`, parses SHA and timestamp
- Heartbeat payload now sends both `lastUpdateTime` (epoch ms) and `lastUpdateCommit` (7-char short SHA) via spread

**Fleet monitor (`server/fleet-monitor.js`):**
- Added `lastUpdateCommit` field to in-memory device store
- Added `fs` import (`existsSync`, `readFileSync`)
- `/api/monitor/status` now reads homebase's own `~/.djbooth-last-update` and includes `currentCommitSha` (7-char) in response JSON for all clients to compare against

**Fleet dashboard (`public/fleet-dashboard.html`):**
- `fetchStatus` stores `currentCommitSha` from response
- `formatLastUpdate` rewritten to show actual time: "Today 10:42 PM", "Yesterday 9:15 AM", "Mar 18 9:15 AM" (was just "Today" / "Yesterday" / "3d ago")
- New `renderUpdateStatus(d)` function replaces the plain timestamp in the Last Update row:
  - **Green ✓ `abc1234`** — Pi's SHA matches homebase SHA (confirmed current)
  - **Orange ✗ `def5678`** — Pi's SHA differs from homebase (needs update)
  - **Gray `abc1234`** — homebase has no stamp yet (can't compare)
  - **Gray "(unverified)"** — Pi has no stamp file yet (hasn't run new script once)

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
