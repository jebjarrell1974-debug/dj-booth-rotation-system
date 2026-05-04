# NEON AI DJ — Nightclub Entertainment Operations Network

## Overview
NEON AI DJ (Nightclub Entertainment Entertainment Operations Network — Automated Intelligent Disc Jockey) is a React-based application designed to automate dancer rotations, manage music playback, and generate dynamic voice announcements in nightclubs. It targets x86 mini PC hardware running Debian Linux to streamline club operations and enhance atmosphere through intelligent automation. Key capabilities include seamless music transitions, automated set management, engaging announcements tailored to club events, and a comprehensive fleet management system for centralized control, remote monitoring, updates, and content synchronization across multiple deployed units. The system aims to provide a reliable, autonomous entertainment solution for demanding nightclub environments, featuring human-sounding voice announcements, built-in redundancy for offline operation, and a fleet management dashboard for multi-location businesses.

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
- **ALWAYS ask before making ANY changes** — describe exactly what you plan to change and why, wait for explicit approval, THEN implement. This applies to every single file edit, terminal command on the Dell unit, and code change — no exceptions, even for "obvious" fixes.
- **NEVER tell the user to delete files on a Dell unit** — if disk space is needed, ask what they want to remove
- **NEVER push files that don't belong on Dell units** — no attached_assets, no .local/state, no sample music, no database files
- **NEVER modify Dell unit service files, environment variables, or database paths** without explicit user approval
- **GitHub push must ALWAYS exclude**: attached_assets, .local, music, voiceovers, .db/.db-wal/.db-shm, node_modules, dist, .cache, .config, .upm
- **API keys are in browser localStorage on each Dell unit** — code updates should NEVER affect them, but disk corruption can wipe them
- **Music path on neonaidj001 Dell**: `/home/neonaidj001/djbooth/music/` — set in systemd service file, DO NOT CHANGE
- **Music is synced to/from R2** — even if files are lost locally, R2 has the backup and will re-download on service restart
- R2 boot sync (voiceovers + music) runs on every boot — this is intentional for morning reboots
- Replit should NOT have a music path set — no local music folder needed here
- **Before any GitHub push**: verify the file list does NOT contain screenshots, music files, database files, or Replit internal state files
- **Test impact on Dell unit before pushing**: consider what the update script will do with every change

## System Architecture
The application is built with React 18, Vite, and TailwindCSS for the frontend, utilizing Radix UI primitives and shadcn/ui for styling. The UI/UX features a dark nightclub theme with neon cyan and blue accents, optimized for low-power device performance. State is managed using `localStorage` for entities and `IndexedDB` for fast session caching of voiceover audio. React Query handles data fetching and caching, and React Router v6 manages client-side routing. Configuration settings are stored in the browser's `localStorage` on each Dell unit.

Music tracks are indexed server-side in a SQLite `music_tracks` table. A background FFmpeg LUFS analysis process (`server/lufsAnalyzer.js`) analyzes tracks at boot, storing `lufs` and `auto_gain` values. A custom dual-deck audio engine provides seamless music playback with equal-power crossfading, audio ducking, auto-gain loudness normalization, a brick-wall limiter, and sophisticated announcement overlays, including beat-matched crossfading and a 3-band EQ. Voice announcements are dynamically generated using ElevenLabs TTS and OpenAI, adapting to club energy levels and operating hours.

The backend is an Express + SQLite server running on port 3001, managing dancer data and PIN authentication. `GET /api/auth/connection-info` reports `{isLocalhost}` based on the request's source IP vs the host machine's full set of interface IPs (loopback + LAN + Tailscale); the dancer phone/tablet song-preview UI in `DancerView` requires BOTH a non-loopback client hostname AND a `false` from this endpoint before exposing preview controls (fail-closed). This guarantees the booth kiosk — even if launched against the machine's own LAN IP — can never trigger preview audio through the club PA. Critical state persists to `localStorage` for crash recovery. Features include a 4-hour song cooldown, configurable songs-per-set, interstitial break songs, genre filtering, a Playback Watchdog for audio recovery, and an Autoplay Queue for music when no entertainers are present. The `DJBooth` component remains persistently mounted to preserve the audio engine state.

A fleet management system enables centralized control of multiple Dell units, supporting device registration, heartbeat monitoring (including hardware health), error log collection, voiceover sharing, music manifest tracking, app update distribution, and sync coordination via Cloudflare R2. An admin dashboard provides an overview of device health, API cost tracking, a master voiceover library, and sync history. A venue-side sync client handles scheduled closed-hours synchronization. Voice recording via the Voice Studio includes Auphonic API integration. System updates are managed via `djbooth-update.sh` with optimized backup procedures. Display configuration uses `xrandr` based on port names (HDMI-1 for crowd, HDMI-2 for DJ kiosk) and `~/.djbooth-display-config.sh` for per-unit rotation persistence, avoiding orientation-based detection. The kiosk uses `chromium --app` with `wmctrl` for reliable display on non-primary monitors.

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
- **Auphonic API**: Automatic audio post-processing
- **Telegram**: Notification service for fleet monitoring alerts
- **@aws-sdk/client-s3**: AWS SDK for R2 integration
- **FFmpeg**: Audio processing (LUFS analysis, promo mixing, voice stitching)
- **Chromium**: Kiosk browser
- **x11-xserver-utils (xrandr)**: Display rotation and remote screen control
- **xinput**: Touchscreen mapping
- **git**: Version hash display (non-critical)
- **aubio-tools (aubio)**: BPM detection
- **curl**: Update script downloads
- **wmctrl**: Window management for Chromium kiosk on Linux
- **PipeWire**: Audio management on Linux