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

## Architecture Summary

### Development (Replit)
- Express server on port 3001: `PORT=3001 node server/index.js`
- Vite dev server on port 5000: proxies `/api` calls to port 3001
- Workflow: `PORT=3001 node server/index.js & sleep 2 && vite --host 0.0.0.0 --port 5000`

### Production (Pi)
- Express serves both API and built frontend from `dist/public/`
- Runs as systemd service `djbooth` on port 3001
- Music scanned from `MUSIC_PATH` env var (default: `/home/<user>/Desktop/NEONAIDJ MUSIC`)
- Chromium kiosk auto-starts via `~/.config/autostart/djbooth-kiosk.desktop`

### Pi Hardware Details
- Raspberry Pi 5, Raspberry Pi OS Bookworm
- Username pattern: `neonaidj001`, `neonaidj002`, etc.
- App directory: `/home/<user>/djbooth`
- Data directory: `/home/<user>/data/` (database + voiceovers)
- Music directory: `/home/<user>/Desktop/DJ MUSIC`
- Voiceover directory: `/home/<user>/Desktop/VOICE OVERS FOR AUTO DJ`

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

### New Fleet Member Setup Guide (Step-by-Step)

Follow these steps in order when prepping a brand new Raspberry Pi for the fleet.

**1. Install Raspberry Pi OS Bookworm (64-bit)** on the SD card
- Set username to `neonaidj###` (e.g., `neonaidj001`, `neonaidj002`)
- Enable SSH during setup
- Connect to club WiFi

**2. Install Node.js**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**3. Create directories**
```bash
mkdir -p ~/djbooth ~/data ~/Desktop/"DJ MUSIC" ~/Desktop/"VOICE OVERS FOR AUTO DJ"
```

**4. Download the update script**
```bash
curl -o ~/djbooth-update.sh https://raw.githubusercontent.com/jebjarrell1974-debug/dj-booth-rotation-system/main/public/djbooth-update-github.sh && chmod +x ~/djbooth-update.sh
```

**5. Run the first update** (downloads code, builds, installs dependencies)
```bash
~/djbooth-update.sh
```

**6. Create the systemd service** (replace `neonaidj001` with the Pi's username, and fill in R2 keys)
```bash
sudo tee /etc/systemd/system/djbooth.service > /dev/null << 'EOF'
[Unit]
Description=DJ Booth Rotation System
After=network.target

[Service]
Type=simple
User=neonaidj001
WorkingDirectory=/home/neonaidj001/djbooth
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DB_PATH=/home/neonaidj001/data/djbooth.db
Environment=VOICEOVER_DIR=/home/neonaidj001/data/voiceovers
Environment="MUSIC_PATH=/home/neonaidj001/Desktop/DJ MUSIC"
Environment="VOICEOVER_PATH=/home/neonaidj001/Desktop/VOICE OVERS FOR AUTO DJ"
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable djbooth.service
sudo systemctl start djbooth.service
```

**6b. Add R2 cloud sync + fleet monitoring credentials** (override file)
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
Environment=FLEET_SERVER_URL=http://localhost:3001
Environment=DEVICE_ID=neonaidj001
Environment="CLUB_NAME=Club Name Here"
EOF'
sudo systemctl daemon-reload
```

**7. Create the auto-update service** (updates from GitHub on every boot, replace `neonaidj001`)
```bash
sudo tee /etc/systemd/system/djbooth-update.service > /dev/null << 'EOF'
[Unit]
Description=NEON AI DJ Auto-Update
After=network-online.target
Wants=network-online.target
Before=djbooth.service

[Service]
Type=oneshot
User=neonaidj001
WorkingDirectory=/home/neonaidj001/djbooth
ExecStart=/home/neonaidj001/djbooth-update.sh
TimeoutStartSec=300
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable djbooth-update.service
```

**8. Set up kiosk autostart** (Chromium opens fullscreen on boot, replace `neonaidj001`)
```bash
mkdir -p ~/.config/autostart
tee ~/.config/autostart/djbooth-kiosk.desktop > /dev/null << 'EOF'
[Desktop Entry]
Type=Application
Name=DJ Booth Kiosk
Exec=chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001
EOF
```

**9. Create desktop shortcut** (for manual launching)
```bash
tee ~/Desktop/DJBooth.desktop > /dev/null << 'EOF'
[Desktop Entry]
Type=Application
Name=DJ Booth
Comment=Launch DJ Booth Kiosk
Exec=chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001
Icon=chromium
Terminal=false
Categories=AudioVideo;
EOF
chmod +x ~/Desktop/DJBooth.desktop
```

**10. Copy music files** to `/home/<user>/Desktop/DJ MUSIC/`
- Put songs in subfolders — folder names become genre categories (e.g., `Pop/`, `Hip Hop/`, `FEATURE/`)

**11. Update browserslist** (optional, one-time, inside djbooth folder)
```bash
cd ~/djbooth && npx update-browserslist-db@latest
```

**12. Configure the app** in the browser
- Open `http://localhost:3001` on the Pi
- Go to Configuration (master PIN: `36669`)
- Set club name, ElevenLabs API key, OpenAI API key, voice ID
- These are stored in the browser's localStorage on each Pi

**13. Reboot and verify**
```bash
sudo reboot
```
After reboot: auto-update runs, app starts, Chromium opens to the DJ booth.

---

### Pi Systemd Service Template
```ini
[Unit]
Description=DJ Booth Rotation System
After=network.target

[Service]
Type=simple
User=neonaidj001
WorkingDirectory=/home/neonaidj001/djbooth
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DB_PATH=/home/neonaidj001/data/djbooth.db
Environment="MUSIC_PATH=/home/neonaidj001/Desktop/DJ MUSIC"
Environment="VOICEOVER_PATH=/home/neonaidj001/Desktop/VOICE OVERS FOR AUTO DJ"
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

R2 credentials go in a separate override file — see step 6b in the setup guide.

### Pi Kiosk Autostart
```ini
[Desktop Entry]
Type=Application
Name=DJ Booth Kiosk
Exec=chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001
```

### Pi Desktop Shortcut
```ini
[Desktop Entry]
Type=Application
Name=DJ Booth
Comment=Launch DJ Booth Kiosk
Exec=chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001
Icon=chromium
Terminal=false
Categories=AudioVideo;
```

## User Preferences & Style
- Nightclub dark theme: electric magenta (#e040fb), violet secondary (#7c3aed)
- Deep navy-black backgrounds (#08081a, #0d0d1f), purple-tinged borders (#1e1e3a)
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
| `src/pages/DJBooth.jsx` | Main DJ control panel (very large file) |
| `src/components/dj/AudioEngine.jsx` | Audio playback engine (DO NOT MODIFY behavior) |
| `src/pages/DancerView.jsx` | Dancer-facing mobile view |
| `src/pages/Landing.jsx` | PIN login page |
| `src/pages/Configuration.jsx` | Venue configuration page |
| `src/components/dj/RemoteView.jsx` | iPad-optimized remote control view (landscape, touch-friendly) |
| `src/components/dj/DJOptions.jsx` | DJ Options panel — music mode + genre/folder selection |
| `src/api/serverApi.js` | Client-side API wrapper |
| `public/djbooth-update-github.sh` | Pi update script (GitHub-based) |
| `replit.md` | Project documentation (always loaded into agent memory) |

## External Services
- **ElevenLabs TTS**: Voice announcements (API key stored in browser localStorage per Pi)
- **OpenAI**: Announcement script generation (API key stored in browser localStorage per Pi)
- **GitHub**: Code backup and Pi update distribution (Replit integration, @octokit/rest)
