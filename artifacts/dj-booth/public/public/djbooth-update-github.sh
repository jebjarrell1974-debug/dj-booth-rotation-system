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

# Helper function used by both launch scripts:
# Detects second monitor, rotates it, returns POS_X POS_Y SCR_W SCR_H
# NOTE: --kiosk ignores --window-position on Linux (known Chromium bug).
# We use --app=URL instead — identical visually, but respects window position.
# After launch we use wmctrl to force fullscreen on the correct monitor.

# Write the rotation display launcher script.
# Uses --app + --window-position (xrandr geometry) + wmctrl fullscreen.
# --kiosk ignores --window-position on Linux (confirmed Chromium bug), so we never use it for the crowd screen.
cat > "$HOME/djbooth-rotation-display.sh" << 'RDEOF'
#!/bin/bash
sleep 20
# Primary display = DJ kiosk. Non-primary (secondary) = crowd rotation TV.
PRIMARY=$(DISPLAY=:0 xrandr --query 2>/dev/null | grep " connected primary" | awk '{print $1}' | head -1)
SECOND=$(DISPLAY=:0 xrandr --query 2>/dev/null | grep " connected" | grep -v primary | awk '{print $1}' | head -1)
if [ -z "$SECOND" ]; then
  echo "No second display found — skipping crowd display launch"
  exit 0
fi
# Preserve existing rotation of crowd TV
SECOND_LINE=$(DISPLAY=:0 xrandr --query 2>/dev/null | grep "^$SECOND connected")
SECOND_ROT=$(echo "$SECOND_LINE" | sed 's/(.*)//' | grep -oE ' (left|right|inverted) ' | tr -d ' ')
[ -n "$SECOND_ROT" ] || SECOND_ROT="right"
DISPLAY=:0 xrandr --output "$SECOND" --rotate "$SECOND_ROT" 2>/dev/null || true
sleep 2
# Detect crowd TV geometry for exact window placement
SECOND_GEOM=$(echo "$SECOND_LINE" | grep -oE '[0-9]+x[0-9]+\+[0-9]+\+[0-9]+')
SECOND_X=$(echo "$SECOND_GEOM" | cut -d+ -f2)
SECOND_Y=$(echo "$SECOND_GEOM" | cut -d+ -f3)
SECOND_W=$(echo "$SECOND_GEOM" | cut -dx -f1)
SECOND_H=$(echo "$SECOND_GEOM" | sed 's/[^x]*x//' | cut -d+ -f1)
rm -rf /tmp/chromium-rotation
# Use --app instead of --kiosk: --kiosk ignores --window-position on Linux (confirmed Chromium bug).
# --app respects --window-position, placing the window on the correct monitor.
# wmctrl then forces it fullscreen on that monitor — no primary swap required.
DISPLAY=:0 chromium \
  --app=http://localhost:3001/RotationDisplay \
  --class=RotationChromium \
  --user-data-dir=/tmp/chromium-rotation \
  --window-position=${SECOND_X:-0},${SECOND_Y:-0} \
  --window-size=${SECOND_W:-1080},${SECOND_H:-1920} \
  --noerrdialogs --disable-session-crashed-bubble \
  --autoplay-policy=no-user-gesture-required \
  --force-device-scale-factor=1 &
sleep 3
DISPLAY=:0 wmctrl -x -r "RotationChromium" -b add,fullscreen 2>/dev/null || true
wait
RDEOF
chmod +x "$HOME/djbooth-rotation-display.sh"

# Write the display trigger watcher script (relaunches crowd display on demand via button)
cat > "$HOME/djbooth-display-watcher.sh" << 'DWEOF'
#!/bin/bash
while true; do
  if [ -f /tmp/djbooth-display-trigger ]; then
    rm -f /tmp/djbooth-display-trigger
    pkill -f "RotationChromium" 2>/dev/null || true
    sleep 1
    # Primary = DJ kiosk, non-primary (secondary) = crowd TV
    SECOND=$(DISPLAY=:0 xrandr --query 2>/dev/null | grep " connected" | grep -v primary | awk '{print $1}' | head -1)
    if [ -n "$SECOND" ]; then
      SECOND_LINE=$(DISPLAY=:0 xrandr --query 2>/dev/null | grep "^$SECOND connected")
      SECOND_ROT=$(echo "$SECOND_LINE" | sed 's/(.*)//' | grep -oE ' (left|right|inverted) ' | tr -d ' ')
      [ -n "$SECOND_ROT" ] || SECOND_ROT="right"
      DISPLAY=:0 xrandr --output "$SECOND" --rotate "$SECOND_ROT" 2>/dev/null || true
      sleep 2
      SECOND_GEOM=$(echo "$SECOND_LINE" | grep -oE '[0-9]+x[0-9]+\+[0-9]+\+[0-9]+')
      SECOND_X=$(echo "$SECOND_GEOM" | cut -d+ -f2)
      SECOND_Y=$(echo "$SECOND_GEOM" | cut -d+ -f3)
      SECOND_W=$(echo "$SECOND_GEOM" | cut -dx -f1)
      SECOND_H=$(echo "$SECOND_GEOM" | sed 's/[^x]*x//' | cut -d+ -f1)
    fi
    rm -rf /tmp/chromium-rotation
    DISPLAY=:0 chromium \
      --app=http://localhost:3001/RotationDisplay \
      --class=RotationChromium \
      --user-data-dir=/tmp/chromium-rotation \
      --window-position=${SECOND_X:-0},${SECOND_Y:-0} \
      --window-size=${SECOND_W:-1080},${SECOND_H:-1920} \
      --noerrdialogs --disable-session-crashed-bubble \
      --autoplay-policy=no-user-gesture-required \
      --force-device-scale-factor=1 &
    sleep 3
    DISPLAY=:0 wmctrl -x -r "RotationChromium" -b add,fullscreen 2>/dev/null || true
    disown
  fi
  sleep 2
done
DWEOF
chmod +x "$HOME/djbooth-display-watcher.sh"

# Kill the old watcher process and restart with new version immediately
pkill -f "djbooth-display-watcher.sh" 2>/dev/null || true
sleep 1
export DISPLAY=:0
bash "$HOME/djbooth-display-watcher.sh" &
disown
echo "Display watcher restarted with primary-swap method"

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
  if [ ! -f "$KIOSK_FILE" ]; then
    cat > "$HOME/djbooth-kiosk.sh" << 'KSEOF'
#!/bin/bash
# Wait for GNOME to settle, clear any stale Chromium singleton locks, then
# wait for the server to be healthy before launching the kiosk window.
sleep 10
rm -f "$HOME/.config/chromium/SingletonLock" \
      "$HOME/.config/chromium/SingletonCookie" \
      "$HOME/.config/chromium/SingletonSocket"
until curl -sf http://localhost:3001/__health > /dev/null 2>&1; do sleep 2; done
exec chromium --kiosk \
  --noerrdialogs --disable-infobars \
  --force-device-scale-factor=1 \
  --autoplay-policy=no-user-gesture-required \
  --disable-background-media-suspend \
  --disable-features=BackgroundMediaSuspend,MediaSessionService \
  --disable-session-crashed-bubble \
  http://localhost:3001
KSEOF
    chmod +x "$HOME/djbooth-kiosk.sh"
    cat > "$KIOSK_FILE" << KDEOF
[Desktop Entry]
Type=Application
Name=DJ Booth Kiosk
Exec=$HOME/djbooth-kiosk.sh
X-GNOME-Autostart-enabled=true
KDEOF
    echo "Kiosk autostart entry created"
  else
    sed -i 's/X-GNOME-Autostart-enabled=false/X-GNOME-Autostart-enabled=true/g' "$KIOSK_FILE"
    echo "Kiosk autostart entry verified"
  fi

  # Patch existing kiosk scripts to add --force-device-scale-factor=1 if missing
  KIOSK_SH="$HOME/djbooth-kiosk.sh"
  if [ -f "$KIOSK_SH" ] && ! grep -q "force-device-scale-factor" "$KIOSK_SH"; then
    sed -i 's/exec chromium --kiosk /exec chromium --kiosk --force-device-scale-factor=1 /g' "$KIOSK_SH"
    echo "Patched djbooth-kiosk.sh with --force-device-scale-factor=1"
  fi
  if [ -f "$KIOSK_FILE" ] && ! grep -q "force-device-scale-factor" "$KIOSK_FILE"; then
    sed -i 's/chromium --kiosk /chromium --kiosk --force-device-scale-factor=1 /g' "$KIOSK_FILE"
    echo "Patched djbooth-kiosk.desktop with --force-device-scale-factor=1"
  fi
fi

# Remove any old labwc config that may exist from previous Pi installations
rm -rf "$HOME/.config/labwc" 2>/dev/null || true

echo "Display configuration updated"

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
    sudo systemctl start djbooth-watchdog
    echo "Watchdog service installed and started"
  else
    sudo systemctl restart djbooth-watchdog 2>/dev/null || true
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
      echo "UPDATE SUCCESSFUL — relaunching browsers..."

      # Ensure the non-rotated display (DJ kiosk monitor) is primary.
      # If the crowd TV (rotated) is somehow primary, swap it back first.
      _CUR_SEC=$(DISPLAY=:0 xrandr --query 2>/dev/null | grep " connected" | grep -v primary | awk '{print $1}' | head -1)
      _PRI_ROT=$(DISPLAY=:0 xrandr --query 2>/dev/null | grep " connected primary" | sed 's/(.*)//' | grep -oE ' (left|right|inverted) ')
      if [ -n "$_PRI_ROT" ] && [ -n "$_CUR_SEC" ]; then
        echo "Primary was crowd TV (rotated) — correcting to $_CUR_SEC..."
        DISPLAY=:0 xrandr --output "$_CUR_SEC" --primary 2>/dev/null || true
        sleep 2
      fi

      # STEP 1: Launch the DJ kiosk on the primary display.
      # Server is already confirmed up so skip the health-wait loop in djbooth-kiosk.sh.
      rm -f ~/.config/chromium/SingletonLock \
            ~/.config/chromium/SingletonCookie \
            ~/.config/chromium/SingletonSocket
      DISPLAY=:0 chromium --kiosk \
        --noerrdialogs --disable-infobars \
        --force-device-scale-factor=1 \
        --autoplay-policy=no-user-gesture-required \
        --disable-background-media-suspend \
        --disable-features=BackgroundMediaSuspend,MediaSessionService \
        --disable-session-crashed-bubble \
        http://localhost:3001 &
      disown
      echo "DJ kiosk launched on primary display — waiting 15s for it to settle..."

      # STEP 2: Wait for the kiosk to fully open before launching crowd screen.
      # This prevents the kiosk launch from interfering with crowd screen placement.
      sleep 15

      # STEP 3: Launch the crowd screen directly on the non-primary display.
      # Read fresh xrandr geometry — do NOT use any cached values.
      _SECOND=$(DISPLAY=:0 xrandr --query 2>/dev/null | grep " connected" | grep -v primary | awk '{print $1}' | head -1)
      if [ -n "$_SECOND" ]; then
        _SECOND_GEOM=$(DISPLAY=:0 xrandr --query 2>/dev/null | grep "^$_SECOND connected" | grep -oE '[0-9]+x[0-9]+\+[0-9]+\+[0-9]+')
        _SX=$(echo "$_SECOND_GEOM" | cut -d+ -f2)
        _SY=$(echo "$_SECOND_GEOM" | cut -d+ -f3)
        _SW=$(echo "$_SECOND_GEOM" | cut -dx -f1)
        _SH=$(echo "$_SECOND_GEOM" | sed 's/[^x]*x//' | cut -d+ -f1)
        rm -rf /tmp/chromium-rotation
        DISPLAY=:0 chromium \
          --app=http://localhost:3001/RotationDisplay \
          --class=RotationChromium \
          --user-data-dir=/tmp/chromium-rotation \
          --window-position=${_SX:-0},${_SY:-0} \
          --window-size=${_SW:-1080},${_SH:-1920} \
          --noerrdialogs --disable-session-crashed-bubble \
          --autoplay-policy=no-user-gesture-required \
          --force-device-scale-factor=1 &
        disown
        sleep 8
        DISPLAY=:0 wmctrl -x -r "RotationChromium" -b add,fullscreen 2>/dev/null || true
        echo "Crowd screen launched on $_SECOND at ${_SX},${_SY} size ${_SW}x${_SH}"
      else
        echo "WARNING: No second display found — crowd screen not launched"
      fi
    else
      echo "UPDATE SUCCESSFUL — homebase mode, no browser relaunch"
    fi
    CLEANUP_COUNT=$(ls -d "${APP_DIR}.backup-"* 2>/dev/null | head -n -3 | wc -l)
    if [ "$CLEANUP_COUNT" -gt "0" ]; then
      ls -d "${APP_DIR}.backup-"* 2>/dev/null | head -n -3 | xargs rm -rf
      echo "Cleaned up $CLEANUP_COUNT old backups (kept last 3)"
    fi
    sudo systemctl start djbooth-watchdog 2>/dev/null || true
  else
    echo ""
    echo "WARNING: Service failed to start. Rolling back..."
    rm -rf "$APP_DIR"
    mv "$BACKUP_DIR" "$APP_DIR"
    sudo systemctl restart "$SERVICE_NAME"
    echo "Rolled back to previous version"
    bash -c "until curl -sf http://localhost:3001/__health > /dev/null 2>&1; do sleep 2; done && chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001" &
    disown
    sudo systemctl start djbooth-watchdog 2>/dev/null || true
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
