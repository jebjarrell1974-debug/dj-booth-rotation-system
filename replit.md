# NEON AI DJ — Nightclub Entertainment Operations Network

## Overview
NEON AI DJ (Nightclub Entertainment Operations Network — Automated Intelligent Disc Jockey) is a React-based application for automating dancer rotations, managing music playback, and generating dynamic voice announcements in nightclubs. It is designed as a robust, low-power solution for hardware like the Raspberry Pi, aiming to streamline club operations and enhance the atmosphere through intelligent automation and responsive design. Key capabilities include seamless music transitions, automated set management, engaging announcements tailored to club hours and event types, and a fleet management system for centralized control, remote monitoring, updates, and content synchronization across multiple deployed units.

The system aims to provide an AI DJ that never sleeps, offering human-sounding voice announcements, built-in redundancy for continuous operation even offline, and a comprehensive fleet management dashboard for multi-location businesses. It includes an iPad remote control, a commercial playback system with auto-generated promos, and per-unit API cost tracking. The project envisions a reliable, autonomous entertainment system built for demanding nightclub environments.

## Fleet Devices (3 active — scaling to 50+ within 6 months)

| Unit | Tailscale IP | Role | Club | Status |
|---|---|---|---|---|
| Homebase | `100.95.238.71` | Fleet server + DJ booth | Homebase | Fleet server lives here |
| neonaidj001 | `100.115.212.34` | DJ booth | Pony Nation | Music: `/home/neonaidj001/djbooth/music/` |
| neonaidj003 | `100.81.90.125` | DJ booth | Unknown (needs `CLUB_NAME` set) | Stable since Mar 10 crashes |

**All 3 units need `~/djbooth-update.sh`** to pull latest fixes (Sessions 41+42). Venue Pis also need `FLEET_DEVICE_KEY=<api key>` in `~/djbooth/.env` for fleet error forwarding.

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
- **Cache keys**: `{type}-{dancerName}-L{level}-V{varNum}` — voice version `V11` (changed from V10; bump version again if prompt/voice changes)
- **Dancer changeover flow**: outro (outgoing) → commercial (if due) → track starts → intro (incoming) — no overlap
- **Failed generation skip**: `failedGenerationsRef` Set prevents retry storms for the session
- **Pre-cache**: buffers upcoming dancers with all 3 types × 5 variations each (15 voiceovers per dancer)
- **True random varNum**: `getNextVariationNum` picks randomly from 1–5 with no back-to-back repeats
- **ElevenLabs credits**: ~180K remaining this billing cycle; key `6e6ca8...71342`, voice ID `8RV9Jl85RVagCJGw9qhY`
- **Stale IDB cleanup**: `cleanupStaleIDBEntries` auto-purges old cache versions on Pi load

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