# DJ Booth - Automated Rotation System

## Overview
The DJ Booth project is a React-based application designed to automate dancer rotations, manage music playback, and generate dynamic, context-aware voice announcements in a nightclub environment. It aims to provide a robust, low-power solution suitable for deployment on hardware like a Raspberry Pi, streamlining club operations and enhancing the atmosphere. Key capabilities include seamless music transitions, automated set management, and engaging announcements tailored to club operating hours and event types, focusing on an immersive experience through intelligent automation and responsive design. The project also includes a fleet management system for centralized control of multiple deployed units, enabling remote monitoring, updates, and content synchronization.

## User Preferences
- Nightclub dark theme with electric magenta accent (#e040fb) and violet secondary (#7c3aed)
- Deep navy-black backgrounds (#08081a, #0d0d1f) with purple-tinged borders (#1e1e3a)
- Neon dancer color palette for club atmosphere
- Minimize CPU/GPU usage for local hardware operation
- Do not modify `AudioEngine.jsx` audio behavior (crossfade, ducking, volume levels are finalized). The `loadTrack` method accepts both URL strings and FileSystemFileHandle objects.
- Production database stored at `/home/runner/data/djbooth.db` (outside project directory) to survive republishing. Development uses `./djbooth.db`. Configurable via `DB_PATH` env var.

## System Architecture
The application is built with React 18, Vite, and TailwindCSS for the frontend, using Radix UI primitives with shadcn/ui styling. Data is managed via `localStorage` for entities and `IndexedDB` for fast session caching of voiceover audio. Server-side, voiceovers are stored with SQLite metadata and filesystem MP3 files. State management uses React Query (TanStack Query), and routing is handled by React Router v6.

Configuration settings (API keys, voice ID, club name, hours, energy override) are stored in the browser's localStorage on each Pi. API keys are entered directly in the Settings modal within the DJ Booth and saved immediately. Each Pi gets its own API keys configured individually during setup.

### Music Catalog (Server-Side)
Music tracks are indexed server-side in a SQLite `music_tracks` table via `server/musicScanner.js`. The scanner recursively walks the music folder (configured via `MUSIC_PATH` env var), indexes `.mp3/.wav/.flac/.m4a/.aac/.ogg` files, and extracts genre from the first directory segment. The server performs:
- **Initial scan on startup** and **periodic rescans every 5 minutes**
- **Manual rescan** via `POST /api/music/rescan` (DJ auth required)

The browser fetches paginated track metadata from `GET /api/music/tracks` and streams audio via `GET /api/music/stream/:id` (supports Range requests for seeking). Track objects in the browser have the shape `{id, name, path, genre, url}` where `url = /api/music/stream/${id}`.

**Music API Endpoints:**
- `GET /api/music/tracks?page=1&limit=100&search=&genre=` — paginated track list
- `GET /api/music/genres` — genre list with counts
- `GET /api/music/stream/:id` — audio file streaming with Range support
- `GET /api/music/random?count=3&exclude=` — random track selection
- `GET /api/music/stats` — catalog statistics
- `POST /api/music/rescan` — trigger manual rescan

A custom dual-deck audio engine manages seamless music playback with equal-power crossfading, audio ducking, and sophisticated announcement overlays. The `AudioEngine.jsx` `loadTrack` method accepts both URL strings (for server-streamed tracks) and FileSystemFileHandle objects (legacy support). Voice announcements are dynamically generated using ElevenLabs TTS and OpenAI, incorporating a 5-tier energy level system that adapts to club operating hours. Announcements feature shift-based personalities and can include adult innuendo, with generic fallbacks cached for offline use.

For multi-user environments, an Express + SQLite backend on port 3001 manages shared dancer data and PIN authentication. Dancer-specific features include mobile-optimized playlist management. Performance is optimized for low-power devices like the Raspberry Pi 5 through throttled updates, avoidance of GPU-heavy effects, and memory management. Critical state information is persisted to `localStorage` for crash recovery. The system includes a 5-hour song cooldown, configurable songs-per-set, and supports interstitial "break songs." Track lists are display-capped to prevent performance issues, with genre filtering and debounced search.

The `DJBooth` component remains mounted persistently, hidden via CSS, to preserve audio engine state and rotation progress. Robust production hardening includes SQLite WAL mode, touch-based drag-and-drop, and aggressive cache control. The Playback Watchdog monitors for audio dropouts and attempts automatic recovery using server-fetched random tracks. Transitions use a parallel pre-fetch pattern: announcement audio is fetched/generated concurrently with the duck animation so API latency doesn't extend the ducked period. The flow is: pre-fetch announcement + duck in parallel → wait for both → play announcement over the still-playing ducked current song → swap to next track after announcement → unduck. The voiceover straddles the song transition: ~15 seconds play over the outgoing song's ending, then the track swap happens at ducked volume after the announcement finishes.

Playlist synchronization logic handles DJ overrides versus server changes, with server playlists refetched every 15 seconds. An anti-repeat system uses Fisher-Yates shuffling and LRU sorting. A "DJ Remote Mode" allows remote monitoring via Server-Sent Events (SSE) for real-time updates without polling, with session expiry handling.

Performance optimizations include gzip compression, database indexing, next-dancer track preloading, and a server health endpoint. Voiceover pre-caching runs in batches, and announcement API failures fall back silently.

### Play History
Every song played is logged server-side in the `play_history` SQLite table with track name, dancer name (if in rotation), genre, and timestamp. Logging is fire-and-forget from the client (no latency impact on playback). History older than 90 days is automatically cleaned up daily.

**Play History API Endpoints:**
- `POST /api/history/played` — log a song play (authenticated, fire-and-forget from DJBooth)
- `GET /api/history?date=YYYY-MM-DD&limit=200&offset=0` — get play history, optionally filtered by date (DJ auth required)
- `GET /api/history/dates` — list dates with play counts (last 90 days, DJ auth required)
- `GET /api/history/stats?date=YYYY-MM-DD` — top tracks, dancers, genres stats (DJ auth required)

A fleet management system enables centralized control of multiple deployed Pi units. The server-side module provides device registration, heartbeat monitoring, error log collection, voiceover sharing, music manifest tracking, app update distribution, and sync coordination. The admin dashboard provides an overview, device health, master voiceover library, and sync history. A Pi-side sync client handles scheduled closed-hours synchronization, including uploading new voiceovers and logs, and downloading voiceovers and app updates from other clubs. Music files are bulk-loaded via USB, with the fleet system tracking manifests.

## Replit Deployment
The app deploys as an autoscale target. Vite builds to `dist/public/` (matching `.replit`'s `publicDir` setting). The build command also copies `download.html` and `djbooth-pi-install.tar.gz` from `public/` into `dist/public/`. In production (`NODE_ENV=production`), Express serves static files from `dist/public/` and provides SPA fallback routing. The download page is at `/download` and the Pi install package at `/djbooth-pi-install.tar.gz`.

## Pi Deployment Guide

### Environment Variables
| Variable | Purpose | Default |
|----------|---------|---------|
| `DB_PATH` | SQLite database file location | `./djbooth.db` (dev) or `/home/runner/data/djbooth.db` (prod) |
| `MUSIC_PATH` | Path to music library folder (optional — can also be set from Configuration page) | `./music` (dev) |
| `VOICEOVER_PATH` | Path to voiceover cache folder | Same parent as `DB_PATH` if set, else `./voiceovers` |

API keys (ElevenLabs, OpenAI) are entered in the app's Settings modal on each Pi and saved to localStorage — not environment variables.

The music folder path can be set in two ways: via the `MUSIC_PATH` environment variable, or from the Configuration page's "Music Library" section. The Configuration page setting is stored in the SQLite database and persists across restarts. The env var takes priority if set. When the path is set from the UI, the server immediately scans the folder and starts periodic rescans every 5 minutes.

Each venue should set a unique Master PIN from the Configuration page so that if someone learns the PIN at one club, it won't work at others. The Master PIN is stored in the SQLite database and defaults to `36669` on a fresh install.

### Kiosk Setup Checklist
1. Install Raspberry Pi OS (64-bit, Bookworm or later)
2. Install Node.js 20+, Chromium, and unclutter
3. Copy the app files to `/home/pi/djbooth/`
4. Copy music library to the NVMe SSD (e.g., `/mnt/music/`)
5. Create the systemd service file at `/etc/systemd/system/djbooth.service`:
   ```
   [Unit]
   Description=DJ Booth Rotation System
   After=network.target

   [Service]
   Type=simple
   User=pi
   WorkingDirectory=/home/pi/djbooth
   Environment=NODE_ENV=production
   Environment=DB_PATH=/home/pi/data/djbooth.db
   Environment=MUSIC_PATH=/home/pi/Desktop/DJ MUSIC
   Environment=VOICEOVER_PATH=/home/pi/Desktop/VOICE OVERS FOR AUTO DJ
   ExecStart=/usr/bin/node server/index.js
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```
6. Enable and start: `sudo systemctl enable djbooth && sudo systemctl start djbooth`
7. Set up auto-login and Chromium kiosk mode in `~/.config/autostart/djbooth-kiosk.desktop`:
   ```
   [Desktop Entry]
   Type=Application
   Name=DJ Booth Kiosk
   Exec=chromium-browser --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001
   ```
8. Disable screen blanking: `sudo raspi-config` > Display Options > Screen Blanking > Off
9. Install Tailscale for remote SSH access: `curl -fsSL https://tailscale.com/install.sh | sh`

### Crash Logs & Debugging
Since the app runs as a systemd service, journald captures all output automatically.

**Make logs persist across reboots (one-time setup):**
```bash
sudo mkdir -p /var/log/journal
sudo systemctl restart systemd-journald
```

**Optional: cap log size to prevent filling the SD card:**
Edit `/etc/systemd/journald.conf`, set `SystemMaxUse=200M`, then `sudo systemctl restart systemd-journald`.

**Quick reference:**

| What you want | Command |
|---|---|
| Last 100 lines | `journalctl -u djbooth.service -n 100` |
| Since last reboot | `journalctl -u djbooth.service -b` |
| Previous boot (after crash) | `journalctl -u djbooth.service -b -1` |
| Today's logs | `journalctl -u djbooth.service --since today` |
| Live tail | `journalctl -u djbooth.service -f` |
| Errors only | `journalctl -u djbooth.service -p err` |

The service has `Restart=always` with `RestartSec=5`, so the app auto-restarts after a crash. The journal shows the error output right before each restart.

### Remote Updates (GitHub-Based)
Pi updates are distributed via GitHub (the Replit cloud deployment has a platform-level routing issue). Code is pushed to `https://github.com/jebjarrell1974-debug/dj-booth-rotation-system` (public repo).

**One-time setup on each Pi:**
```bash
curl -o ~/djbooth-update.sh https://raw.githubusercontent.com/jebjarrell1974-debug/dj-booth-rotation-system/main/public/djbooth-update-github.sh && chmod +x ~/djbooth-update.sh
```

**To update at any time (via SSH/Tailscale):**
```bash
~/djbooth-update.sh
```

The script downloads the latest code from GitHub, backs up the current install, copies server + config files, builds the frontend with Vite, installs dependencies, restarts the systemd service, and auto-rolls back if the service fails to start. Old backups are cleaned up (keeps last 3).

**Workflow:** Make changes in Replit → push to GitHub (see `github-pi-update` skill) → SSH into Pi → run `~/djbooth-update.sh`

Environment variables for customization:
- `DJBOOTH_GITHUB_REPO` — GitHub repo (defaults to `jebjarrell1974-debug/dj-booth-rotation-system`)
- `DJBOOTH_APP_DIR` — local app directory (defaults to `/home/<user>/djbooth`)
- `DJBOOTH_SERVICE` — systemd service name (defaults to `djbooth`)
- `DJBOOTH_BRANCH` — Git branch to pull (defaults to `main`)

### Security Notes
- Change the default Master PIN (36669) on every venue from the Configuration page
- The master PIN provides DJ-level access and bypasses local PIN checks
- Dancer PINs are per-venue and stored in the local SQLite database
- Keep Tailscale enabled for remote troubleshooting

## External Dependencies
- **React**: Frontend UI development
- **Vite**: Project build tool
- **TailwindCSS**: Utility-first CSS framework
- **Radix UI**: Unstyled UI component primitives
- **shadcn/ui**: Component styling based on Radix UI
- **React Query (TanStack Query)**: Data fetching, caching, and synchronization
- **React Router v6**: Client-side routing
- **ElevenLabs TTS**: Text-to-Speech API for voice announcements
- **OpenAI**: AI model for generating announcement scripts
- **Express**: Backend web application framework
- **SQLite**: Lightweight database for multi-user dancer data and music catalog
