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
- Data directory: `/home/<user>/data/` (database)
- Music directory: `/home/<user>/Desktop/DJ MUSIC`
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
Environment=FLEET_SERVER_URL=http://100.70.172.8:3001
Environment=DEVICE_ID=DEVICEID
Environment="CLUB_NAME=CLUBNAME"
EOF'
sudo systemctl daemon-reload
```
Note: `FLEET_SERVER_URL` points to the fleet monitor server running on "raspberrypi" (Tailscale IP `100.70.172.8`). This is the always-on Pi that monitors all fleet devices and sends Telegram alerts when a device goes offline. If the fleet monitor moves to a different machine, update this IP.

### Step 8: Enable remote admin commands (Fleet Command Center)
Allow the djbooth server to restart its service and reboot the Pi remotely via the Fleet Command Center dashboard. Replace `USERNAME`.
```bash
sudo bash -c 'cat > /etc/sudoers.d/djbooth << EOF
USERNAME ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart djbooth, /usr/bin/systemctl stop djbooth, /usr/bin/systemctl start djbooth, /usr/sbin/reboot
EOF'
```

### Step 9: Create the auto-update service
Pulls latest code from GitHub on every boot before the app starts. Replace `USERNAME`.
```bash
sudo tee /etc/systemd/system/djbooth-update.service > /dev/null << 'EOF'
[Unit]
Description=NEON AI DJ Auto-Update
After=network-online.target
Wants=network-online.target
Before=djbooth.service

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

### Step 9: Set up Chromium kiosk autostart
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

### Step 10: Create desktop shortcut (optional)
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

### Step 11: Enable VNC remote desktop access (TigerVNC)
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

Note: Uses port 5901 (not 5900) to avoid conflicts with the built-in RealVNC service. Disable the built-in RealVNC to prevent conflicts:
```bash
sudo systemctl stop vncserver-x11-serviced
sudo systemctl disable vncserver-x11-serviced
```

### Step 12: Disable Wi-Fi (if using Ethernet)
If the Pi is connected via Ethernet cable, disable Wi-Fi to prevent Wi-Fi authentication popups from freezing the kiosk. The Wayland compositor can hang when these dialogs appear over fullscreen Chromium.
```bash
sudo nmcli radio wifi off
```
To re-enable Wi-Fi later if needed: `sudo nmcli radio wifi on`

### Step 13: Disable screen blanking
Keeps the Pi screen on all night (no sleep/screensaver).
```bash
sudo raspi-config nonint do_blanking 1
```

### Step 14: Set timezone and daily reboot
Set the Pi to Central time and schedule a daily reboot at 8:30 AM to keep things fresh.
```bash
sudo timedatectl set-timezone America/Chicago
(sudo crontab -l 2>/dev/null; echo "30 8 * * * /sbin/reboot") | sudo crontab -
```
Verify: `sudo crontab -l` should show the reboot line. `timedatectl` should show `America/Chicago`.

### Step 15: Copy music files
Copy music to `/home/USERNAME/Desktop/DJ MUSIC/`
- Put songs in subfolders — folder names become genre categories (e.g., `Pop/`, `Hip Hop/`, `FEATURE/`)
- Songs in the `FEATURE/` folder play to completion (no 3-minute cap)

### Step 16: Start the app and verify
```bash
sudo systemctl start djbooth && sudo journalctl -u djbooth --no-pager -n 20
```
You should see:
- Music scanner finding tracks
- Telegram fleet monitoring active
- Heartbeat client active
- R2 cloud sync downloading/uploading voiceovers

### Step 17: Configure the app in the browser
- Open `http://localhost:3001` on the Pi
- Go to Configuration (master PIN: `36669`)
- Set club name, ElevenLabs API key, OpenAI API key, voice ID
- These settings are stored in the browser's localStorage on each Pi

### Step 18: Reboot and verify full boot sequence
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
| `src/api/serverApi.js` | Client-side API wrapper |
| `public/djbooth-update-github.sh` | Pi update script (GitHub-based) |
| `replit.md` | Project documentation (always loaded into agent memory) |

## External Services
- **ElevenLabs TTS**: Voice announcements (API key stored in browser localStorage per Pi)
- **OpenAI**: Announcement script generation (API key stored in browser localStorage per Pi)
- **GitHub**: Code backup and Pi update distribution (Replit integration, @octokit/rest)
- **Cloudflare R2**: Cloud storage for voiceovers + music sync across fleet
- **Telegram**: Fleet monitoring alerts via @NEONAIDJ_bot
