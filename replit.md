# NEON AI DJ — Nightclub Entertainment Operations Network

## Overview
NEON AI DJ (Nightclub Entertainment Operations Network — Automated Intelligent Disc Jockey) is a React-based application for automating dancer rotations, managing music playback, and generating dynamic voice announcements in nightclubs. It is designed as a robust, low-power solution for hardware like the Raspberry Pi, aiming to streamline club operations and enhance the atmosphere through intelligent automation and responsive design. Key capabilities include seamless music transitions, automated set management, engaging announcements tailored to club hours and event types, and a fleet management system for centralized control, remote monitoring, updates, and content synchronization across multiple deployed units.

The system aims to provide an AI DJ that never sleeps, offering human-sounding voice announcements, built-in redundancy for continuous operation even offline, and a comprehensive fleet management dashboard for multi-location businesses. It includes an iPad remote control, a commercial playback system with auto-generated promos, and per-unit API cost tracking. The project envisions a reliable, autonomous entertainment system built for demanding nightclub environments.

## Fleet Devices (4 active — scaling to 50+ within 6 months)

| Unit | Tailscale IP | Role | Club | Status |
|---|---|---|---|---|
| Homebase | `100.109.73.27` | Fleet server + DJ booth | Homebase | HP Compaq 8200 Elite (replaced old Pi homebase Mar 2026) |
| neonaidj001 | `100.115.212.34` | DJ booth | Pony Bama | SSH: `neonaidj001@100.115.212.34` |
| neonaidj002 | unknown | DJ booth | Unassigned | Tailscale IP still unknown |
| neonaidj003 | `100.81.90.125` | DJ booth | THE PONY EVANSVILLE | Stable since Mar 10 crashes |

**Fleet dashboard**: `http://100.109.73.27:3001/fleet`
**Update pipeline**: `DJBOOTH_SKIP_HOMEBASE=1 ~/djbooth-update.sh` to bypass homebase and pull direct from GitHub.

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
3. Use `preloadedTrackRef` in transitions: it pre-fetches the next track but is NEVER consumed — transitions ignore it and call the API anyway
4. Convert all existing promos to MP3 via `POST /api/voiceovers/convert-all-promos` on homebase (run once after deploy)

## Recent Session Fixes (Sessions 48–49)
- **Bug 1**: `onDancerDragReorder` callback added to `RotationPlaylistManager`; fires when pos-0 changes during active rotation; DJBooth resets indices to 0 and calls `handleSkip` after 100ms state flush
- **Bug 2/3**: `playingInterstitialBreakKeyRef` stored before rotation flip in both `handleSkip` and `handleTrackEnd`; read in all interstitial branches; cleared on break end and `stopRotation`
- **Bug 4**: `breakSongIndex != null` condition in `RotationDisplay` prevents crowd display flicker on intro / set-start
- **Bug 5**: Post-rotation cached tracks re-validated against `songCooldownRef`; one stale track invalidates the whole cache
- **Custom keyboard**: `VirtualKeyboard.jsx` fully rewritten — NEON theme, 56px keys, 3 layouts + numpad, shift auto-resets, slide-up animation; gated to kiosk (not remote, not tablet)
- **Server cold-start fix**: `liveBoothState` initial object now includes all fields served by `/api/booth/display` (`breakSongIndex: null`, `breakSongsPerSet: 0`, `trackTime: 0`, `trackDuration: 0`, `trackTimeAt: 0`, `volume`, `voiceGain`, `commercialFreq`, `commercialCounter`, `promoQueue`, `availablePromos`, `skippedCommercials`, `interstitialSongs`) — prevents `undefined` fields being silently omitted from JSON before first DJ session posts state
- **Test harness**: 128/128 passing (`node test/test-harness.mjs`) — covers all 5 bugs, keyboard layouts, text cursor manipulation, double-skip during break, `stopRotation` ref cleanup, and live `/api/booth/display` shape verification

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