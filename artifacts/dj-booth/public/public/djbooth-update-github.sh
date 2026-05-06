#!/bin/bash
set -e

GITHUB_REPO="${DJBOOTH_GITHUB_REPO:-jebjarrell1974-debug/dj-booth-rotation-system}"
APP_DIR="${DJBOOTH_APP_DIR:-/home/$(whoami)/djbooth}"
SERVICE_NAME="${DJBOOTH_SERVICE:-djbooth}"
BRANCH="${DJBOOTH_BRANCH:-main}"
BACKUP_DIR="${APP_DIR}.backup-$(date +%Y%m%d-%H%M%S)"
COMMIT_SHA=""
SHORT_SHA=""
STAMP_FILE="$HOME/.djbooth-last-update"

echo "================================================"
echo "  DJ Booth Auto-Updater (GitHub)"
echo "================================================"
echo ""
echo "Repo:    $GITHUB_REPO"
echo "Branch:  $BRANCH"
echo "App dir: $APP_DIR"
echo "Service: $SERVICE_NAME"
echo ""

if [ -z "$APP_DIR" ] || [ "$APP_DIR" = "/" ]; then
  echo "ERROR: Invalid app directory '$APP_DIR'"
  exit 1
fi
if [ ! -d "$APP_DIR" ]; then
  echo "ERROR: App directory $APP_DIR not found"
  echo "For first-time install, create it first: mkdir -p $APP_DIR"
  exit 1
fi

if [ "$DJBOOTH_BOOT_UPDATE" = "1" ]; then
  echo "Boot mode — waiting for internet access..."
  for i in $(seq 1 60); do
    if curl -sf --max-time 5 https://github.com > /dev/null 2>&1; then
      echo "Internet ready (attempt $i)"
      break
    fi
    sleep 5
  done
fi

echo "[1/8] Checking for OS package updates..."
set +e
if [ "$DJBOOTH_BOOT_UPDATE" = "1" ]; then
  echo "  Boot mode — running OS upgrade..."
  sudo apt-get update -q 2>&1 | tail -3
  sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1 \
    apt-get upgrade -y -q \
    -o Dpkg::Options::="--force-confold" \
    -o Dpkg::Options::="--force-confdef" \
    2>&1 | tail -5
  if [ -f /var/run/reboot-required ]; then
    echo "  System reboot required after package updates. Scheduling reboot for 03:00..."
    sudo shutdown -r 03:00 "Scheduled reboot after system update" 2>/dev/null || true
  fi
else
  echo "  Manual update — skipping OS upgrade to keep the system live"
fi
set -e

echo "[2/8] Fetching latest code..."
TMPFILE=$(mktemp /tmp/djbooth-update-XXXXXX.tar.gz)
USE_HOMEBASE_BUNDLE=false

LOCAL_IS_HOMEBASE=$(grep "^IS_HOMEBASE=" "$APP_DIR/.env" 2>/dev/null | cut -d'=' -f2- || echo "")
HOMEBASE_URL=$(grep "^FLEET_SERVER_URL=" "$APP_DIR/.env" 2>/dev/null | cut -d'=' -f2- || echo "")
HOMEBASE_URL="${HOMEBASE_URL:-http://100.109.73.27:3001}"

if [ "$LOCAL_IS_HOMEBASE" != "true" ] && [ "$DJBOOTH_SKIP_HOMEBASE" != "1" ]; then
  echo "  Trying homebase at $HOMEBASE_URL..."
  VERSION_INFO=$(curl -sf --max-time 8 "$HOMEBASE_URL/api/update/version" 2>/dev/null || echo "")
  if [ -n "$VERSION_INFO" ]; then
    HB_SHA=$(echo "$VERSION_INFO" | grep -o '"sha":"[^"]*"' | cut -d'"' -f4 || echo "")
    HB_PREBUILT=$(echo "$VERSION_INFO" | grep -o '"prebuilt":[^,}]*' | cut -d':' -f2 | tr -d ' ' || echo "false")
    if [ "$HB_PREBUILT" = "true" ]; then
      echo "  Homebase has pre-built bundle (SHA: ${HB_SHA:0:7}) — downloading..."
      HTTP_CODE=$(curl -sL -w "%{http_code}" --max-time 120 \
        -D /tmp/djbooth-bundle-headers.txt \
        -o "$TMPFILE" "$HOMEBASE_URL/api/update/bundle" 2>/dev/null || echo "000")
      if [ "$HTTP_CODE" = "200" ]; then
        COMMIT_SHA=$(grep -i "^x-djbooth-sha:" /tmp/djbooth-bundle-headers.txt 2>/dev/null | cut -d' ' -f2 | tr -d '\r' || echo "$HB_SHA")
        SHORT_SHA="${COMMIT_SHA:0:7}"
        FILESIZE=$(stat -c%s "$TMPFILE" 2>/dev/null || stat -f%z "$TMPFILE" 2>/dev/null)
        echo "  Downloaded from homebase: ${FILESIZE} bytes (SHA: ${SHORT_SHA:-unknown})"
        USE_HOMEBASE_BUNDLE=true
      else
        echo "  Homebase bundle failed (HTTP $HTTP_CODE) — falling back to GitHub..."
        rm -f "$TMPFILE"
        TMPFILE=$(mktemp /tmp/djbooth-update-XXXXXX.tar.gz)
      fi
    else
      echo "  Homebase has no pre-built dist/ — falling back to GitHub..."
    fi
  else
    echo "  Homebase not reachable — falling back to GitHub..."
  fi
fi

if [ "$USE_HOMEBASE_BUNDLE" = "false" ]; then
  echo "  Downloading from GitHub..."
  HTTP_CODE=$(curl -sL -w "%{http_code}" -o "$TMPFILE" "https://github.com/${GITHUB_REPO}/archive/refs/heads/${BRANCH}.tar.gz" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" != "200" ]; then
    echo "ERROR: Download failed from both homebase and GitHub (HTTP $HTTP_CODE)"
    rm -f "$TMPFILE"
    exit 1
  fi
  FILESIZE=$(stat -c%s "$TMPFILE" 2>/dev/null || stat -f%z "$TMPFILE" 2>/dev/null)
  echo "  Downloaded from GitHub: ${FILESIZE} bytes"
  COMMIT_SHA=$(curl -sf --max-time 8 "https://api.github.com/repos/${GITHUB_REPO}/commits/${BRANCH}" 2>/dev/null | grep -o '"sha":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  SHORT_SHA="${COMMIT_SHA:0:7}"
  [ -n "$SHORT_SHA" ] && echo "  Commit SHA: $SHORT_SHA" || echo "  Commit SHA: (unavailable)"
fi

echo "[3/8] Backing up current installation..."
if [ -f "$APP_DIR/package.json" ]; then
  mkdir -p "$BACKUP_DIR"
  find "$APP_DIR" -maxdepth 1 ! -name "$(basename "$APP_DIR")" \
    ! -name 'music' ! -name 'voiceovers' ! -name 'node_modules' \
    -exec cp -a {} "$BACKUP_DIR/" \;
  echo "Backup: $BACKUP_DIR (skipped music/voiceovers/node_modules)"
else
  echo "No existing installation found, skipping backup"
fi

echo "[4/8] Extracting update..."
TMPDIR=$(mktemp -d /tmp/djbooth-extract-XXXXXX)
tar xzf "$TMPFILE" -C "$TMPDIR"
rm -f "$TMPFILE"

if [ "$USE_HOMEBASE_BUNDLE" = "true" ]; then
  EXTRACTED_DIR="$TMPDIR/"
else
  EXTRACTED_DIR=$(ls -d "$TMPDIR"/*/ | head -1)
fi
if [ -z "$EXTRACTED_DIR" ] || [ ! -d "$EXTRACTED_DIR" ]; then
  echo "ERROR: No files extracted"
  rm -rf "$TMPDIR"
  exit 1
fi

echo "[5/8] Copying server and config files..."
# Detect monorepo layout (artifacts/api-server/server) vs flat layout (server/)
if [ -d "${EXTRACTED_DIR}artifacts/api-server/server" ]; then
  echo "  Detected monorepo layout — copying from artifacts/api-server/"
  API_SRC="${EXTRACTED_DIR}artifacts/api-server"
  cp -r "${API_SRC}/server" "$APP_DIR/"
  # Use homebase-package.json (npm-compatible, no pnpm workspace: refs)
  if [ -f "${API_SRC}/homebase-package.json" ]; then
    cp "${API_SRC}/homebase-package.json" "$APP_DIR/package.json"
    echo "  Using homebase-package.json (npm-compatible)"
  else
    cp "${API_SRC}/package.json" "$APP_DIR/"
  fi
  rm -f "$APP_DIR/package-lock.json"
  # Public scripts (update, watchdog, etc.) live in dj-booth/public/public/
  DJ_SRC="${EXTRACTED_DIR}artifacts/dj-booth"
  cp -r "${DJ_SRC}/public" "$APP_DIR/" 2>/dev/null || true
  cp "${DJ_SRC}/index.html" "$APP_DIR/" 2>/dev/null || true
  # Use the homebase-specific vite config (no Replit PORT/BASE_PATH requirements)
  if [ -f "${DJ_SRC}/homebase-vite.config.js" ]; then
    cp "${DJ_SRC}/homebase-vite.config.js" "$APP_DIR/vite.config.js"
    echo "  Using homebase-vite.config.js (no Replit env var requirements)"
  else
    cp "${DJ_SRC}/vite.config.ts" "$APP_DIR/vite.config.js" 2>/dev/null || true
  fi
  cp "${DJ_SRC}/tailwind.config.js" "$APP_DIR/" 2>/dev/null || true
  cp "${DJ_SRC}/postcss.config.js" "$APP_DIR/" 2>/dev/null || true
else
  echo "  Detected flat layout — copying from root"
  cp -r "${EXTRACTED_DIR}server" "$APP_DIR/"
  cp -r "${EXTRACTED_DIR}public" "$APP_DIR/" 2>/dev/null || true
  cp "${EXTRACTED_DIR}package.json" "$APP_DIR/"
  cp "${EXTRACTED_DIR}package-lock.json" "$APP_DIR/" 2>/dev/null || true
  cp "${EXTRACTED_DIR}vite.config.js" "$APP_DIR/" 2>/dev/null || true
  cp "${EXTRACTED_DIR}tailwind.config.js" "$APP_DIR/" 2>/dev/null || true
  cp "${EXTRACTED_DIR}postcss.config.js" "$APP_DIR/" 2>/dev/null || true
  cp "${EXTRACTED_DIR}index.html" "$APP_DIR/" 2>/dev/null || true
fi

# Check for pre-built dist — monorepo path first, then legacy root path
PREBUILT_DIST=""
if [ -d "${EXTRACTED_DIR}artifacts/dj-booth/dist" ]; then
  PREBUILT_DIST="${EXTRACTED_DIR}artifacts/dj-booth/dist"
elif [ -d "${EXTRACTED_DIR}dist" ]; then
  PREBUILT_DIST="${EXTRACTED_DIR}dist"
fi
if [ -n "$PREBUILT_DIST" ]; then
  cp -r "$PREBUILT_DIST" "$APP_DIR/"
  echo "  Pre-built frontend installed (no vite build required)"
fi

# Self-update: always try GitHub first so the homebase bundle can never serve a stale script.
# Fall back to the bundle only if GitHub is unreachable.
_GH_SCRIPT_URL="https://raw.githubusercontent.com/${GITHUB_REPO}/${BRANCH}/artifacts/dj-booth/public/public/djbooth-update-github.sh"
_GH_SCRIPT_TMP=$(mktemp /tmp/djbooth-self-update-XXXXXX.sh)
_GH_SELF_OK=false
if curl -sf --max-time 15 "$_GH_SCRIPT_URL" -o "$_GH_SCRIPT_TMP" 2>/dev/null && [ -s "$_GH_SCRIPT_TMP" ]; then
  _GH_SELF_OK=true
  echo "Update script fetched from GitHub (latest)"
else
  echo "GitHub unreachable for self-update — falling back to bundle version"
fi

if [ "$_GH_SELF_OK" = "true" ]; then
  cp "$_GH_SCRIPT_TMP" "$HOME/djbooth-update.sh"
  chmod +x "$HOME/djbooth-update.sh"
  rm -f "$_GH_SCRIPT_TMP"
  echo "Update script self-updated from GitHub"
else
  rm -f "$_GH_SCRIPT_TMP"
  UPDATE_SCRIPT_SRC=""
  if [ -f "${EXTRACTED_DIR}artifacts/dj-booth/public/public/djbooth-update-github.sh" ]; then
    UPDATE_SCRIPT_SRC="${EXTRACTED_DIR}artifacts/dj-booth/public/public/djbooth-update-github.sh"
  elif [ -f "${EXTRACTED_DIR}public/djbooth-update-github.sh" ]; then
    UPDATE_SCRIPT_SRC="${EXTRACTED_DIR}public/djbooth-update-github.sh"
  fi
  if [ -n "$UPDATE_SCRIPT_SRC" ]; then
    cp "$UPDATE_SCRIPT_SRC" "$HOME/djbooth-update.sh"
    chmod +x "$HOME/djbooth-update.sh"
    echo "Update script self-updated from bundle (GitHub was unreachable)"
  fi
fi

if [ "${DJBOOTH_RESTARTED}" != "1" ]; then
  echo "Re-executing with new script version..."
  DJBOOTH_RESTARTED=1 /bin/bash "$HOME/djbooth-update.sh"
  exit $?
fi

echo "[4.5/7] Ensuring fleet environment variables..."
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Creating .env with fleet defaults..."
  FLEET_SERVER="http://100.109.73.27:3001"
  echo "Fetching fleet config from homebase..."
  HTTP_CODE=$(curl -sf -o "$ENV_FILE" -w "%{http_code}" "$FLEET_SERVER/api/fleet-env" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ] && [ -s "$ENV_FILE" ]; then
    echo "Fleet .env downloaded from homebase"
  else
    echo "WARNING: Could not reach homebase for env config"
    cat > "$ENV_FILE" << 'ENVEOF'
PORT=3001
NODE_ENV=production
FLEET_SERVER_URL=http://100.109.73.27:3001
ENVEOF
  fi
else
  FLEET_SERVER="http://100.109.73.27:3001"
  FLEET_ENV=$(curl -sf "$FLEET_SERVER/api/fleet-env" 2>/dev/null || echo "")
  if [ -n "$FLEET_ENV" ]; then
    KEYS_TO_CHECK="ELEVENLABS_API_KEY ELEVENLABS_VOICE_ID OPENAI_API_KEY AUPHONIC_API_KEY R2_ACCOUNT_ID R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID"
    for KEY in $KEYS_TO_CHECK; do
      if ! grep -q "^${KEY}=" "$ENV_FILE" 2>/dev/null; then
        VALUE=$(echo "$FLEET_ENV" | grep "^${KEY}=" | head -1)
        if [ -n "$VALUE" ]; then
          echo "$VALUE" >> "$ENV_FILE"
          echo "Added missing key: $KEY"
        fi
      fi
    done
  fi
  grep -q "^NODE_ENV=" "$ENV_FILE" || echo "NODE_ENV=production" >> "$ENV_FILE"
  grep -q "^FLEET_SERVER_URL=" "$ENV_FILE" || echo "FLEET_SERVER_URL=http://100.109.73.27:3001" >> "$ENV_FILE"
fi

echo "[6/8] Building frontend..."
if [ -d "${EXTRACTED_DIR}artifacts/dj-booth/src" ]; then
  cp -r "${EXTRACTED_DIR}artifacts/dj-booth/src" "$APP_DIR/"
elif [ -d "${EXTRACTED_DIR}src" ]; then
  cp -r "${EXTRACTED_DIR}src" "$APP_DIR/"
fi
cd "$APP_DIR"

# Strip any preinstall guard from package.json before npm install.
# The root pnpm workspace package.json has one — defensive removal ensures it
# never ends up in APP_DIR/package.json and blocks npm.
node -e "
  try {
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('package.json','utf8'));
    if (p.scripts && p.scripts.preinstall) {
      delete p.scripts.preinstall;
      fs.writeFileSync('package.json', JSON.stringify(p, null, 2));
      console.log('Removed preinstall guard from package.json');
    }
  } catch(e) {}
" 2>/dev/null || true

echo "  Installing node dependencies..."
set +e
_npm_ok=false
for _npm_try in 1 2 3; do
  # Unset NODE_ENV so npm installs devDependencies (vite, tailwind, etc.)
  # needed for the frontend build. The service itself sets NODE_ENV=production at runtime.
  NODE_ENV=development npm install --no-audit --no-fund --legacy-peer-deps 2>&1 | tail -5
  if node -e "require('express')" 2>/dev/null; then
    _npm_ok=true
    break
  fi
  echo "  express not found after attempt $_npm_try — retrying in 10s..."
  sleep 10
done
set -e
if [ "$_npm_ok" = "false" ]; then
  echo "WARNING: express not found after npm install retries — service will fail to start"
fi
if [ -d "$APP_DIR/dist" ]; then
  echo "  Pre-built frontend already in place — skipping vite build"
else
  echo "  No pre-built dist found — building from source..."
  NODE_ENV=development ./node_modules/.bin/vite build 2>&1 | tail -10
fi
rm -rf "$TMPDIR"

for AFILE in /home/$(whoami)/.config/autostart/*.desktop /etc/xdg/lxsession/LXDE-pi/autostart; do
  if [ -f "$AFILE" ] && grep -q "neonaidj-launcher" "$AFILE" 2>/dev/null; then
    sed -i "s|file:///home/[^/]*/neonaidj-launcher.html|http://localhost:3001|g" "$AFILE" 2>/dev/null
    echo "Reverted autostart to direct localhost: $AFILE"
  fi
done

which ffmpeg >/dev/null 2>&1 || {
  echo "Installing ffmpeg for audio processing (voice gen, LUFS, BPM)..."
  sudo apt-get install -y ffmpeg >/dev/null 2>&1 || true
}

which xdotool >/dev/null 2>&1 || {
  echo "Installing xdotool for browser auto-refresh..."
  sudo apt-get install -y xdotool >/dev/null 2>&1 || true
}

which aubio >/dev/null 2>&1 || {
  echo "Installing aubio-tools for BPM detection..."
  sudo apt-get install -y aubio-tools >/dev/null 2>&1 || true
}

which wmctrl >/dev/null 2>&1 || {
  echo "Installing wmctrl for crowd screen window management..."
  sudo apt-get install -y wmctrl >/dev/null 2>&1 || true
}

if rm -f "$HOME/.config/autostart/squeekboard.desktop" 2>/dev/null; then
  echo "Squeekboard autostart removed (prevents double on-screen keyboard)"
fi

if [ "$IS_HOMEBASE" = "true" ]; then
  echo "[display] Homebase — skipping all display configuration"
else

echo "[display] Configuring x86 second display (crowd rotation screen)..."

# Force X11 session so xrandr works reliably for display rotation
if [ -f /etc/gdm3/daemon.conf ]; then
  if ! grep -q "WaylandEnable=false" /etc/gdm3/daemon.conf; then
    sudo sed -i '/^\[daemon\]/a WaylandEnable=false' /etc/gdm3/daemon.conf 2>/dev/null || true
    echo "X11 session enforced (WaylandEnable=false in gdm3)"
  fi
fi

# Disable GNOME auto-maximize so Chromium --window-position flags are not overridden.
# Without this, GNOME Shell can silently move the Chromium kiosk window to the wrong screen.
gsettings set org.gnome.mutter auto-maximize false 2>/dev/null || true
gsettings set org.gnome.mutter edge-tiling false 2>/dev/null || true
echo "GNOME auto-maximize disabled (prevents window-position override)"

# Install wmctrl for reliable window management across displays
which wmctrl >/dev/null 2>&1 || {
  echo "Installing wmctrl for multi-monitor window management..."
  sudo apt-get install -y wmctrl >/dev/null 2>&1 || true
}

# BULLETPROOF SCREEN LAUNCH (Apr 2026 hardening)
# === HARDWARE WIRING — UNIVERSAL ON EVERY NEON AI DJ UNIT ===
#   Native HDMI port (computer)         -> HDMI-2 in xrandr -> DJ KIOSK monitor
#   DisplayPort with HDMI adapter       -> HDMI-1 in xrandr -> CROWD-FACING TV
# DETECTION RULE: PORT NAME ONLY. Never orientation, never size, never primary flag.

# Write the rotation display launcher script (HDMI-1 = crowd, port-based).
cat > "$HOME/djbooth-rotation-display.sh" << 'RDEOF'
#!/bin/bash
# Self-install wmctrl if missing (belt + suspenders with update script)
which wmctrl >/dev/null 2>&1 || sudo apt-get install -y wmctrl >/dev/null 2>&1 || true

# Wait for GNOME session to settle
sleep 15

# Apply per-unit display config (rotation, primary, etc) — survives reboots.
# Each unit creates ~/.djbooth-display-config.sh once during setup with its
# specific xrandr commands (rotation right/left, etc). xrandr rotation is
# session-only, so this MUST run on every boot before reading geometry.
if [ -x "$HOME/.djbooth-display-config.sh" ]; then
  echo "$(date): [crowd-display] Applying ~/.djbooth-display-config.sh"
  DISPLAY=:0 bash "$HOME/.djbooth-display-config.sh" 2>/dev/null || true
  sleep 2
fi

# Wait for the API server to be healthy BEFORE launching the crowd display.
echo "$(date): [crowd-display] Waiting for server health..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:3001/__health > /dev/null 2>&1; then
    echo "$(date): [crowd-display] Server healthy after ${i}s"
    break
  fi
  sleep 1
done

# CROWD = HDMI-1 (DisplayPort-with-adapter). Read its current geometry from xrandr.
CROWD_PORT="HDMI-1"
CROWD_GEOM=$(DISPLAY=:0 xrandr --query 2>/dev/null | grep "^${CROWD_PORT} connected" | grep -oE '[0-9]+x[0-9]+\+[0-9]+\+[0-9]+' | head -1)

# Fallback: if HDMI-1 doesn't exist (rare hardware variation), use any connected port that isn't HDMI-2.
if [ -z "$CROWD_GEOM" ]; then
  CROWD_PORT=$(DISPLAY=:0 xrandr --query 2>/dev/null | grep " connected" | awk '{print $1}' | grep -v "^HDMI-2$" | head -1)
  if [ -n "$CROWD_PORT" ]; then
    CROWD_GEOM=$(DISPLAY=:0 xrandr --query 2>/dev/null | grep "^${CROWD_PORT} connected" | grep -oE '[0-9]+x[0-9]+\+[0-9]+\+[0-9]+' | head -1)
  fi
fi

if [ -z "$CROWD_GEOM" ]; then
  echo "$(date): [crowd-display] No display found for crowd — exiting"
  exit 0
fi

CROWD_W=$(echo "$CROWD_GEOM" | cut -dx -f1)
CROWD_H=$(echo "$CROWD_GEOM" | sed 's/[^x]*x//' | cut -d+ -f1)
CROWD_X=$(echo "$CROWD_GEOM" | cut -d+ -f2)
CROWD_Y=$(echo "$CROWD_GEOM" | cut -d+ -f3)
echo "$(date): [crowd-display] $CROWD_PORT at ${CROWD_X},${CROWD_Y} ${CROWD_W}x${CROWD_H}"

# Kill any prior crowd Chromium and clean its profile lock
pkill -f "RotationChromium" 2>/dev/null || true
sleep 1
rm -rf /tmp/chromium-rotation

# Launch crowd Chromium app on HDMI-1's geometry.
# --app respects --window-position (--kiosk does not on Linux — confirmed Chromium bug).
DISPLAY=:0 chromium \
  --app=http://localhost:3001/RotationDisplay \
  --class=RotationChromium \
  --user-data-dir=/tmp/chromium-rotation \
  --window-position=${CROWD_X},${CROWD_Y} \
  --window-size=${CROWD_W},${CROWD_H} \
  --noerrdialogs --disable-session-crashed-bubble \
  --autoplay-policy=no-user-gesture-required \
  --force-device-scale-factor=1 &

# After launch: wait for window to appear, MOVE it to crowd geometry, then fullscreen.
# (Just calling fullscreen without moving first will fullscreen on whatever monitor it opened on.)
for i in $(seq 1 10); do
  sleep 1
  if DISPLAY=:0 wmctrl -lx 2>/dev/null | grep -q -i "rotationchromium"; then
    DISPLAY=:0 wmctrl -x -r "RotationChromium" -e 0,${CROWD_X},${CROWD_Y},${CROWD_W},${CROWD_H} 2>/dev/null || true
    sleep 1
    DISPLAY=:0 wmctrl -x -r "RotationChromium" -b add,fullscreen 2>/dev/null || true
    echo "$(date): [crowd-display] launched and positioned at ${CROWD_X},${CROWD_Y} ${CROWD_W}x${CROWD_H}"
    break
  fi
done

wait
RDEOF
chmod +x "$HOME/djbooth-rotation-display.sh"

# Display trigger watcher + crowd-display heartbeat watchdog.
# Single source of truth for relaunch — calls the launcher script above.
cat > "$HOME/djbooth-display-watcher.sh" << 'DWEOF'
#!/bin/bash
# This script:
#   1. Watches /tmp/djbooth-display-trigger and relaunches crowd display on demand (DJ button).
#   2. Heartbeat-monitors RotationChromium every 60s — auto-relaunches if missing.
which wmctrl >/dev/null 2>&1 || sudo apt-get install -y wmctrl >/dev/null 2>&1 || true

LAST_HEARTBEAT=0
HEARTBEAT_INTERVAL=60

while true; do
  RELAUNCH=false

  # Trigger file (DJ pressed the relaunch button)
  if [ -f /tmp/djbooth-display-trigger ]; then
    rm -f /tmp/djbooth-display-trigger
    RELAUNCH=true
    echo "$(date): [watcher] Trigger file — relaunching crowd display"
  fi

  # Heartbeat: check every 60s. Only relaunch after boot has settled (>3min uptime).
  NOW=$(date +%s)
  if [ $((NOW - LAST_HEARTBEAT)) -ge $HEARTBEAT_INTERVAL ]; then
    LAST_HEARTBEAT=$NOW
    UPTIME_SEC=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 999)
    if [ "$UPTIME_SEC" -gt 180 ] && ! pgrep -f "RotationChromium" > /dev/null 2>&1; then
      echo "$(date): [watcher] RotationChromium not running — auto-relaunch"
      RELAUNCH=true
    fi
  fi

  if [ "$RELAUNCH" = true ]; then
    pkill -f "RotationChromium" 2>/dev/null || true
    sleep 1
    if [ -x "$HOME/djbooth-rotation-display.sh" ]; then
      nohup bash "$HOME/djbooth-rotation-display.sh" > /tmp/djbooth-rotation-display.log 2>&1 &
      disown
    fi
  fi

  sleep 2
done
DWEOF
chmod +x "$HOME/djbooth-display-watcher.sh"

# Kill the old watcher process and restart with new version immediately
pkill -f "djbooth-display-watcher.sh" 2>/dev/null || true
sleep 1
export DISPLAY=:0
nohup bash "$HOME/djbooth-display-watcher.sh" > /tmp/djbooth-display-watcher.log 2>&1 &
disown
echo "Display watcher restarted (HDMI-1=crowd, HDMI-2=kiosk + heartbeat)"

# GNOME autostart entries for second display and trigger watcher
mkdir -p "$HOME/.config/autostart"
if [ "$IS_HOMEBASE" != "true" ]; then
  cat > "$HOME/.config/autostart/djbooth-rotation-display.desktop" << RDEOF
[Desktop Entry]
Type=Application
Name=DJ Rotation Display
Exec=$HOME/djbooth-rotation-display.sh
X-GNOME-Autostart-enabled=true
RDEOF

  cat > "$HOME/.config/autostart/djbooth-display-watcher.desktop" << DWEOF
[Desktop Entry]
Type=Application
Name=DJ Display Watcher
Exec=$HOME/djbooth-display-watcher.sh
X-GNOME-Autostart-enabled=true
DWEOF
  echo "Second display autostart entries configured"

  KIOSK_FILE="$HOME/.config/autostart/djbooth-kiosk.desktop"

  # ALWAYS rewrite the kiosk script to the latest bulletproof version.
  # Uses --app + --window-position + wmctrl (NOT --kiosk) because --kiosk on Linux
  # ignores --window-position and lands on whatever monitor Chromium picks
  # (confirmed Chromium bug — same fix used for crowd display, vladvasiliu, multibrowse, etc).
  cat > "$HOME/djbooth-kiosk.sh" << 'KSEOF'
#!/bin/bash
# Wait for GNOME to settle
sleep 10

export DISPLAY=:0
export XAUTHORITY="$HOME/.Xauthority"

# Disable screen blanking (kiosk should never sleep)
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true

# Apply per-unit display config (rotation, primary, etc) — survives reboots.
# xrandr rotation is session-only, so this MUST run on every boot before reading geometry.
if [ -x "$HOME/.djbooth-display-config.sh" ]; then
  echo "$(date): [kiosk] Applying ~/.djbooth-display-config.sh"
  bash "$HOME/.djbooth-display-config.sh" 2>/dev/null || true
  sleep 2
fi

# Clear stale Chromium singleton locks
rm -f "$HOME/.config/chromium/SingletonLock" \
      "$HOME/.config/chromium/SingletonCookie" \
      "$HOME/.config/chromium/SingletonSocket"

# KIOSK = HDMI-2 (native HDMI port on the computer). Read its current geometry from xrandr.
# Hardware convention: native HDMI -> DJ kiosk monitor on every NEON AI DJ unit.
KIOSK_MON="HDMI-2"; KX=0; KY=0; KW=1920; KH=1080
KIOSK_GEOM=$(xrandr --query 2>/dev/null | grep "^${KIOSK_MON} connected" | grep -oE '[0-9]+x[0-9]+\+[0-9]+\+[0-9]+' | head -1)

# Fallback: if HDMI-2 doesn't exist, use any connected port that isn't HDMI-1.
if [ -z "$KIOSK_GEOM" ]; then
  KIOSK_MON=$(xrandr --query 2>/dev/null | grep " connected" | awk '{print $1}' | grep -v "^HDMI-1$" | head -1)
  if [ -n "$KIOSK_MON" ]; then
    KIOSK_GEOM=$(xrandr --query 2>/dev/null | grep "^${KIOSK_MON} connected" | grep -oE '[0-9]+x[0-9]+\+[0-9]+\+[0-9]+' | head -1)
  fi
fi

if [ -n "$KIOSK_GEOM" ]; then
  KW=$(echo "$KIOSK_GEOM" | cut -dx -f1)
  KH=$(echo "$KIOSK_GEOM" | sed 's/[^x]*x//' | cut -d+ -f1)
  KX=$(echo "$KIOSK_GEOM" | cut -d+ -f2)
  KY=$(echo "$KIOSK_GEOM" | cut -d+ -f3)
  echo "$(date): [kiosk] $KIOSK_MON at ${KX},${KY} ${KW}x${KH}"
else
  echo "$(date): [kiosk] WARNING: No KIOSK display found — using fallback 0,0 1920x1080"
fi

# Map ILITEK touchscreen to the kiosk monitor (PRIMARY trigger).
# Placed AFTER KIOSK_MON detection so we hard-bind the touch mapping to the
# exact xrandr output Chromium will be positioned on. Without this call,
# touches can land on the wrong physical screen and feel completely dead to
# the DJ. Idempotent — safe to re-run on every kiosk launch.
# Mapping is by xinput device ID (mapping by NAME has been observed to fail
# on some xinput builds even when the device is listed).
if [ -x /usr/local/bin/djbooth-touch-map.sh ]; then
  echo "$(date): [kiosk] Mapping touchscreen to ${KIOSK_MON:-auto-detect}"
  KIOSK_OUTPUT="${KIOSK_MON:-HDMI-2}" /usr/local/bin/djbooth-touch-map.sh kiosk-launch 2>/dev/null || true
fi

# Wait for the server to be healthy before launching
echo "$(date): [kiosk] Waiting for server health..."
until curl -sf http://localhost:3001/__health > /dev/null 2>&1; do sleep 2; done

# Kill any prior kiosk Chromium and wipe its profile lock (separate profile prevents tab-stealing)
pkill -f "KioskChromium" 2>/dev/null || true
sleep 1
rm -rf /tmp/chromium-kiosk

# Launch with --app (respects --window-position; --kiosk does NOT on Linux — confirmed bug)
chromium \
  --app=http://localhost:3001 \
  --class=KioskChromium \
  --user-data-dir=/tmp/chromium-kiosk \
  --window-position=${KX},${KY} \
  --window-size=${KW},${KH} \
  --no-first-run --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble --disable-translate \
  --disable-features=TranslateUI,BackgroundMediaSuspend,MediaSessionService \
  --autoplay-policy=no-user-gesture-required \
  --disable-background-media-suspend \
  --force-device-scale-factor=1 &

# Poll for window, then move + fullscreen.
# Just calling fullscreen would fullscreen on whatever monitor it opened on — must move first.
for i in $(seq 1 20); do
  sleep 1
  if wmctrl -lx 2>/dev/null | grep -q -i "kioskchromium"; then
    wmctrl -x -r "KioskChromium" -b remove,maximized_vert,maximized_horz,fullscreen 2>/dev/null || true
    sleep 1
    wmctrl -x -r "KioskChromium" -e 0,${KX},${KY},${KW},${KH} 2>/dev/null || true
    sleep 1
    wmctrl -x -r "KioskChromium" -b add,fullscreen 2>/dev/null || true
    echo "$(date): [kiosk] Positioned at ${KX},${KY} ${KW}x${KH} fullscreen"
    break
  fi
done

wait
KSEOF
  chmod +x "$HOME/djbooth-kiosk.sh"

  # Always rewrite the autostart desktop entry too
  cat > "$KIOSK_FILE" << KDEOF
[Desktop Entry]
Type=Application
Name=DJ Booth Kiosk
Exec=$HOME/djbooth-kiosk.sh
X-GNOME-Autostart-enabled=true
KDEOF
  echo "Kiosk autostart entry refreshed (HDMI-2 = kiosk by port name)"
fi

# Remove any old labwc config that may exist from previous Pi installations
rm -rf "$HOME/.config/labwc" 2>/dev/null || true

echo "Display configuration updated"

# ─── Install canonical ILITEK touchscreen mapper ──────────────────────────────
# /usr/local/bin/djbooth-touch-map.sh is the single source of truth for mapping
# the touchscreen to the kiosk monitor. Called from FOUR independent triggers
# so any one is enough to keep touch working:
#   1. Inside ~/djbooth-kiosk.sh  (PRIMARY — runs every X session start)
#   2. GNOME autostart .desktop   (BACKUP if kiosk launcher path changes)
#   3. udev rule on input add     (HOTPLUG — touchscreen unplug/replug)
#   4. udev rule on DRM change    (HOTPLUG — monitor unplug/replug)
# Mapping is by xinput device ID — mapping by NAME has been observed to
# silently fail on Debian's xinput build even when the device is listed.
TOUCH_MAP_SRC="$APP_DIR/public/public/djbooth-touch-map.sh"
if [ -f "$TOUCH_MAP_SRC" ]; then
  sudo cp "$TOUCH_MAP_SRC" /usr/local/bin/djbooth-touch-map.sh
  sudo chmod +x /usr/local/bin/djbooth-touch-map.sh
  echo "Touchscreen mapper installed: /usr/local/bin/djbooth-touch-map.sh"

  # GNOME autostart entry — backup trigger in case the kiosk launcher path
  # is ever changed without updating the inline call.
  mkdir -p "$HOME/.config/autostart"
  cat > "$HOME/.config/autostart/djbooth-touch-map.desktop" << TMEOF
[Desktop Entry]
Type=Application
Name=DJ Booth Touchscreen Mapper
Exec=/usr/local/bin/djbooth-touch-map.sh autostart
X-GNOME-Autostart-enabled=true
TMEOF
  echo "Touchscreen mapper autostart entry installed"
else
  echo "WARNING: $TOUCH_MAP_SRC not found — touchscreen mapper NOT installed"
fi

# ─── udev rules: re-apply display config + touch mapping on monitor hotplug ───
# Monitors power-cycling wipes xrandr rotation and touch-to-output mapping.
# These rules trigger on every DRM card change so the unit self-heals.
# Baked into the update script — every NEON AI DJ unit gets identical behavior.

UDEV_USER=$(whoami)
UDEV_HOME="/home/$UDEV_USER"

sudo tee /etc/udev/rules.d/95-djbooth-monitor-hotplug.rules > /dev/null << HOTEOF
ACTION=="change", SUBSYSTEM=="drm", KERNEL=="card[0-9]*", \\
  RUN+="/bin/su $UDEV_USER -c 'DISPLAY=:0 XAUTHORITY=$UDEV_HOME/.Xauthority bash $UDEV_HOME/.djbooth-display-config.sh >> /tmp/djbooth-hotplug.log 2>&1'"
HOTEOF

sudo tee /etc/udev/rules.d/96-djbooth-touch-map.rules > /dev/null << TOUCHEOF
# Re-map ILITEK touchscreen to the kiosk monitor on USB hotplug or DRM change.
# Calls /usr/local/bin/djbooth-touch-map.sh — the canonical mapper script
# (ID-based, idempotent, logs to /tmp/djbooth-touch.log). Primary trigger is
# the kiosk launcher; this udev rule is a safety net for genuine USB
# unplug/replug events during operation.
#
# IMPORTANT: previous version of this rule used inline xinput-by-name lookups,
# which silently failed because xinput map-to-output by NAME is unreliable on
# Debian's xinput build (confirmed live on unit 003, Apr 2026 — the device was
# listed but map-to-output returned "unable to find device"). The new script
# maps by numeric ID instead, which always works.
ACTION=="change", SUBSYSTEM=="drm", KERNEL=="card[0-9]*", \\
  RUN+="/bin/su $UDEV_USER -c 'sleep 2 && DISPLAY=:0 XAUTHORITY=$UDEV_HOME/.Xauthority HOME=$UDEV_HOME /usr/local/bin/djbooth-touch-map.sh udev-drm'"
ACTION=="add", SUBSYSTEM=="input", ENV{ID_INPUT_TOUCHSCREEN}=="1", \\
  RUN+="/bin/su $UDEV_USER -c 'sleep 2 && DISPLAY=:0 XAUTHORITY=$UDEV_HOME/.Xauthority HOME=$UDEV_HOME /usr/local/bin/djbooth-touch-map.sh udev-input'"
TOUCHEOF

sudo udevadm control --reload-rules 2>/dev/null || true
sudo udevadm trigger --subsystem-match=drm 2>/dev/null || true
echo "udev rules installed: 95-djbooth-monitor-hotplug + 96-djbooth-touch-map (self-healing on power-cycle)"

fi # end IS_HOMEBASE display skip

echo "[boot-update] Setting up boot-time auto-update (service + cron backup)..."
if [ "$IS_HOMEBASE" != "true" ]; then
  BOOT_USER=$(whoami)
  BOOT_HOME="/home/$(whoami)"

  sudo systemctl disable djbooth-boot 2>/dev/null || true
  sudo rm -f /etc/systemd/system/djbooth-boot.service

  sudo tee /etc/systemd/system/djbooth-update.service > /dev/null << BOOTEOF
[Unit]
Description=NEON AI DJ Boot Update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$BOOT_USER
WorkingDirectory=$BOOT_HOME/djbooth
Environment=DJBOOTH_BOOT_UPDATE=1
Environment=HOME=$BOOT_HOME
ExecStart=/bin/bash $BOOT_HOME/djbooth-update.sh
RemainAfterExit=yes
StandardOutput=journal
StandardError=journal
TimeoutStartSec=1800

[Install]
WantedBy=multi-user.target
BOOTEOF
  sudo systemctl daemon-reload
  sudo systemctl enable djbooth-update.service 2>/dev/null || true
  echo "Boot update service installed: djbooth-update.service"

  (crontab -l 2>/dev/null | grep -v "djbooth-update.sh") | crontab - 2>/dev/null || true
  (crontab -l 2>/dev/null; echo "@reboot sleep 45 && DJBOOTH_BOOT_UPDATE=1 /bin/bash $BOOT_HOME/djbooth-update.sh >> $BOOT_HOME/djbooth-boot.log 2>&1") | crontab -
  echo "Boot update cron installed (backup — writes to ~/djbooth-boot.log)"
  echo "Belt + suspenders: both service and cron will attempt update on every reboot."
else
  echo "Homebase — skipping boot service setup"
fi

WATCHDOG_SRC="$APP_DIR/public/djbooth-watchdog.sh"
WATCHDOG_DEST="/home/$(whoami)/djbooth-watchdog.sh"
if [ -f "$WATCHDOG_SRC" ]; then
  cp "$WATCHDOG_SRC" "$WATCHDOG_DEST"
  chmod +x "$WATCHDOG_DEST"

  WATCHDOG_ENABLED=$(systemctl is-enabled djbooth-watchdog 2>/dev/null || echo "not-found")
  if [ "$WATCHDOG_ENABLED" != "enabled" ]; then
    WATCHDOG_USER=$(whoami)
    sudo tee /etc/systemd/system/djbooth-watchdog.service > /dev/null << WEOF
[Unit]
Description=DJ Booth Browser Watchdog
After=graphical.target djbooth.service
Wants=djbooth.service

[Service]
Type=simple
User=$WATCHDOG_USER
Environment=DISPLAY=:0
ExecStart=/bin/bash $WATCHDOG_DEST
Restart=always
RestartSec=10

[Install]
WantedBy=graphical.target
WEOF
    sudo systemctl daemon-reload
    sudo systemctl enable djbooth-watchdog
    sudo systemctl start --no-block djbooth-watchdog
    echo "Watchdog service installed and started"
  else
    sudo systemctl restart --no-block djbooth-watchdog 2>/dev/null || true
    echo "Watchdog service updated"
  fi
fi

CURRENT_USER=$(whoami)
NOPASSWD_FILE="/etc/sudoers.d/010_${CURRENT_USER}-nopasswd"
if [ ! -f "$NOPASSWD_FILE" ]; then
  echo "Configuring passwordless sudo for $CURRENT_USER..."
  echo "$CURRENT_USER ALL=(ALL) NOPASSWD: ALL" | sudo tee "$NOPASSWD_FILE" > /dev/null
  sudo chmod 0440 "$NOPASSWD_FILE"
  sudo visudo -c -f "$NOPASSWD_FILE" > /dev/null 2>&1 && \
    echo "Passwordless sudo configured" || \
    { sudo rm -f "$NOPASSWD_FILE"; echo "WARNING: sudoers validation failed, skipping"; }
fi

if [ ! -f /swapfile ] && [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 2048 ]; then
  echo "Setting up 1GB swap file for build stability..."
  sudo fallocate -l 1G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=1024 2>/dev/null
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null 2>&1
  sudo swapon /swapfile 2>/dev/null
  if ! grep -q '/swapfile' /etc/fstab 2>/dev/null; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  fi
  echo "Swap file created and activated"
fi

echo "[7/8] Restarting service..."
if [ "$DJBOOTH_BOOT_UPDATE" = "1" ]; then
  echo "Running as boot service — updating and restarting djbooth..."
  sudo systemctl restart "$SERVICE_NAME"
  echo "Waiting for server to be ready..."
  for i in $(seq 1 40); do
    if curl -sf http://localhost:3001/__health > /dev/null 2>&1; then
      echo "Server is up (attempt $i)"
      break
    fi
    sleep 3
  done
  if curl -sf http://localhost:3001/__health > /dev/null 2>&1; then
    echo "Boot update complete — server is healthy"
    # Signal the display watcher to reload the crowd screen.
    # ~/djbooth-rotation-display.sh (launched by GNOME autostart) is the authoritative
    # launch path — it does xrandr rotation + correct window positioning from xrandr geometry.
    # Launching Chromium directly here (without that script) skips the rotation step and
    # races against the GNOME autostart, causing duplicate windows. Touch the trigger file
    # instead so the watcher gracefully relaunches via the correct script.
    touch /tmp/djbooth-display-trigger
    echo "Display trigger set — crowd screen will reload via djbooth-display-watcher"
  else
    echo "WARNING: Server did not respond after restart — attempting direct browser launch as fallback"
    # Safety net: if boot update ran but browsers never launched (e.g. polkit dialog blocked startup),
    # launch them directly here rather than leaving the screens blank.
    export DISPLAY=:0
    pkill -f "chromium" 2>/dev/null || true
    sleep 2
    rm -f "$HOME/.config/chromium/SingletonLock" \
          "$HOME/.config/chromium/SingletonCookie" \
          "$HOME/.config/chromium/SingletonSocket"
    if [ -x "$HOME/djbooth-kiosk.sh" ]; then
      bash "$HOME/djbooth-kiosk.sh" &
      disown
      echo "DJ kiosk launch triggered"
    fi
    # Restart or start the display watcher, then signal it
    pkill -f "djbooth-display-watcher.sh" 2>/dev/null || true
    sleep 1
    if [ -x "$HOME/djbooth-display-watcher.sh" ]; then
      bash "$HOME/djbooth-display-watcher.sh" &
      disown
      sleep 2
      touch /tmp/djbooth-display-trigger
      echo "Display watcher restarted and crowd screen trigger set"
    fi
  fi
elif systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  export DISPLAY=:0

  sudo systemctl stop djbooth-watchdog 2>/dev/null || true

  if [ "$IS_HOMEBASE" != "true" ]; then
    echo "Closing browser before restart..."
    pkill -f "chromium" 2>/dev/null || pkill -f "chrome" 2>/dev/null || true
    sleep 2
    rm -f ~/.config/chromium/SingletonLock ~/.config/chromium/SingletonCookie ~/.config/chromium/SingletonSocket
  else
    echo "Homebase mode — skipping browser kill"
  fi

  sudo systemctl restart "$SERVICE_NAME"

  echo "Waiting for server to be ready..."
  for i in $(seq 1 30); do
    if curl -sf http://localhost:3001/__health > /dev/null 2>&1; then
      echo "Server is up (attempt $i)"
      break
    fi
    sleep 2
  done

  if curl -sf http://localhost:3001/__health > /dev/null 2>&1; then
    echo ""
    echo ""
    if [ "$IS_HOMEBASE" != "true" ]; then
      echo "UPDATE SUCCESSFUL — relaunching browsers via canonical launchers..."

      # Must export DISPLAY and XAUTHORITY so Chromium can reach the X server
      # when this script is run from an SSH session (no display env inherited).
      export DISPLAY=:0
      export XAUTHORITY="/home/$(whoami)/.Xauthority"

      # Kill all chromium and clear stale singleton locks ONCE — both launcher scripts
      # would do this individually, but we centralize here to avoid double-kill races.
      pkill -f chromium 2>/dev/null || true
      sleep 2
      rm -f ~/.config/chromium/SingletonLock \
            ~/.config/chromium/SingletonCookie \
            ~/.config/chromium/SingletonSocket
      rm -rf /tmp/chromium-kiosk /tmp/chromium-rotation

      # STEP 1: Launch DJ kiosk via canonical launcher (--app + window-position + wmctrl).
      # Single source of truth — same script used by GNOME autostart and watchdog.
      if [ -x "$HOME/djbooth-kiosk.sh" ]; then
        nohup bash "$HOME/djbooth-kiosk.sh" > /tmp/kiosk.log 2>&1 &
        disown
        echo "DJ kiosk launch triggered via $HOME/djbooth-kiosk.sh — waiting 20s for it to settle..."
        sleep 20
      else
        echo "ERROR: $HOME/djbooth-kiosk.sh missing — cannot launch kiosk"
      fi

      # STEP 2: Launch crowd display via canonical launcher.
      # The launcher detects the portrait monitor, applies rotation, and positions correctly.
      if [ -x "$HOME/djbooth-rotation-display.sh" ]; then
        nohup bash "$HOME/djbooth-rotation-display.sh" > /tmp/djbooth-rotation-display.log 2>&1 &
        disown
        echo "Crowd display launch triggered via $HOME/djbooth-rotation-display.sh"
      else
        echo "WARNING: $HOME/djbooth-rotation-display.sh missing — crowd screen not launched"
      fi
    else
      echo "UPDATE SUCCESSFUL — homebase mode, no browser relaunch"
    fi
    CLEANUP_COUNT=$(ls -d "${APP_DIR}.backup-"* 2>/dev/null | head -n -3 | wc -l)
    if [ "$CLEANUP_COUNT" -gt "0" ]; then
      ls -d "${APP_DIR}.backup-"* 2>/dev/null | head -n -3 | xargs rm -rf
      echo "Cleaned up $CLEANUP_COUNT old backups (kept last 3)"
    fi
    sudo systemctl enable djbooth-watchdog 2>/dev/null || true
    sudo systemctl restart --no-block djbooth-watchdog 2>/dev/null || true
  else
    echo ""
    echo "WARNING: Service failed to start. Rolling back..."
    rm -rf "$APP_DIR"
    mv "$BACKUP_DIR" "$APP_DIR"
    sudo systemctl restart "$SERVICE_NAME"
    echo "Rolled back to previous version — relaunching browsers via canonical launchers"
    export DISPLAY=:0
    export XAUTHORITY="/home/$(whoami)/.Xauthority"
    pkill -f chromium 2>/dev/null || true
    sleep 2
    rm -f ~/.config/chromium/SingletonLock ~/.config/chromium/SingletonCookie ~/.config/chromium/SingletonSocket
    rm -rf /tmp/chromium-kiosk /tmp/chromium-rotation
    if [ -x "$HOME/djbooth-kiosk.sh" ]; then
      nohup bash "$HOME/djbooth-kiosk.sh" > /tmp/kiosk.log 2>&1 &
      disown
      sleep 20
    fi
    if [ -x "$HOME/djbooth-rotation-display.sh" ]; then
      nohup bash "$HOME/djbooth-rotation-display.sh" > /tmp/djbooth-rotation-display.log 2>&1 &
      disown
    fi
    sudo systemctl enable djbooth-watchdog 2>/dev/null || true
    sudo systemctl restart --no-block djbooth-watchdog 2>/dev/null || true
    exit 1
  fi
else
  echo "Service '$SERVICE_NAME' not running - skipping restart"
  echo "Start manually: sudo systemctl start $SERVICE_NAME"
fi

ETH_CONN=$(nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | grep eth0 | cut -d: -f1)
WIFI_CONN=$(nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | grep wlan0 | cut -d: -f1)
if [ -n "$ETH_CONN" ]; then
  sudo nmcli connection modify "$ETH_CONN" ipv4.route-metric 100 2>/dev/null && \
    echo "Ethernet ($ETH_CONN) route metric set to 100 (priority)" || true
fi
if [ -n "$WIFI_CONN" ]; then
  sudo nmcli connection modify "$WIFI_CONN" ipv4.route-metric 600 2>/dev/null && \
    echo "Wi-Fi ($WIFI_CONN) route metric set to 600 (local only)" || true
fi

IS_HOMEBASE_VAL=$(grep "^IS_HOMEBASE=" "$APP_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '[:space:]')
if [ "$IS_HOMEBASE_VAL" != "true" ] && [ -n "$WIFI_CONN" ]; then
  CURRENT_IP=$(nmcli -g IP4.ADDRESS connection show "$WIFI_CONN" 2>/dev/null | head -1)
  if [ "$CURRENT_IP" != "192.168.88.100/24" ]; then
    sudo nmcli connection modify "$WIFI_CONN" \
      ipv4.method manual \
      ipv4.addresses "192.168.88.100/24" \
      ipv4.gateway "" \
      ipv4.dns "" \
      ipv4.route-metric 600 2>/dev/null && \
    sudo nmcli connection up "$WIFI_CONN" 2>/dev/null && \
      echo "Wi-Fi static IP set: 192.168.88.100 (iPad remote access)" || \
      echo "Wi-Fi static IP: could not apply (WiFi may not be connected)"
  else
    echo "Wi-Fi static IP already set: 192.168.88.100"
  fi
fi

STAMP_TS=$(date -u +%s)000
STAMP_SHA="${COMMIT_SHA:-unknown}"
SHORT_STAMP="${SHORT_SHA:-unknown}"
printf '%s|%s\n' "$STAMP_SHA" "$STAMP_TS" > "$STAMP_FILE"
echo "✓ Update stamped — ${SHORT_STAMP} at $(date '+%Y-%m-%d %H:%M')"

echo ""
echo "[8/8] Cleaning up..."
rm -rf "$TMPDIR" 2>/dev/null

echo "================================================"
echo "  Update complete!"
echo "================================================"
