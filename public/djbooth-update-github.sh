#!/bin/bash
set -e

GITHUB_REPO="${DJBOOTH_GITHUB_REPO:-jebjarrell1974-debug/dj-booth-rotation-system}"
APP_DIR="${DJBOOTH_APP_DIR:-/home/$(whoami)/djbooth}"
SERVICE_NAME="${DJBOOTH_SERVICE:-djbooth}"
BRANCH="${DJBOOTH_BRANCH:-main}"
BACKUP_DIR="${APP_DIR}.backup-$(date +%Y%m%d-%H%M%S)"

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

echo "[1/7] Downloading latest code from GitHub..."
TMPFILE=$(mktemp /tmp/djbooth-update-XXXXXX.tar.gz)
HTTP_CODE=$(curl -sL -w "%{http_code}" -o "$TMPFILE" "https://github.com/${GITHUB_REPO}/archive/refs/heads/${BRANCH}.tar.gz" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: Download failed (HTTP $HTTP_CODE)"
  echo "Check that the repo exists: https://github.com/${GITHUB_REPO}"
  rm -f "$TMPFILE"
  exit 1
fi
FILESIZE=$(stat -c%s "$TMPFILE" 2>/dev/null || stat -f%z "$TMPFILE" 2>/dev/null)
echo "Downloaded: ${FILESIZE} bytes"

echo "[2/7] Backing up current installation..."
if [ -f "$APP_DIR/package.json" ]; then
  cp -r "$APP_DIR" "$BACKUP_DIR"
  echo "Backup: $BACKUP_DIR"
else
  echo "No existing installation found, skipping backup"
fi

echo "[3/7] Extracting update..."
TMPDIR=$(mktemp -d /tmp/djbooth-extract-XXXXXX)
tar xzf "$TMPFILE" -C "$TMPDIR"
rm -f "$TMPFILE"

EXTRACTED_DIR=$(ls -d "$TMPDIR"/*/  | head -1)
if [ -z "$EXTRACTED_DIR" ]; then
  echo "ERROR: No files extracted"
  rm -rf "$TMPDIR"
  exit 1
fi

echo "[4/7] Copying server and config files..."
cp -r "${EXTRACTED_DIR}server" "$APP_DIR/"
cp -r "${EXTRACTED_DIR}public" "$APP_DIR/" 2>/dev/null || true
cp "${EXTRACTED_DIR}package.json" "$APP_DIR/"
cp "${EXTRACTED_DIR}package-lock.json" "$APP_DIR/" 2>/dev/null || true
cp "${EXTRACTED_DIR}vite.config.js" "$APP_DIR/" 2>/dev/null || true
cp "${EXTRACTED_DIR}tailwind.config.js" "$APP_DIR/" 2>/dev/null || true
cp "${EXTRACTED_DIR}postcss.config.js" "$APP_DIR/" 2>/dev/null || true
cp "${EXTRACTED_DIR}index.html" "$APP_DIR/" 2>/dev/null || true

echo "[5/7] Building frontend..."
if [ -d "${EXTRACTED_DIR}src" ]; then
  cp -r "${EXTRACTED_DIR}src" "$APP_DIR/"
fi
cd "$APP_DIR"

npm install --no-audit --no-fund 2>&1 | tail -3
npx vite build 2>&1 | tail -3
npm prune --production 2>&1 | tail -1

rm -rf "$TMPDIR"

for AFILE in /home/$(whoami)/.config/autostart/*.desktop /etc/xdg/lxsession/LXDE-pi/autostart; do
  if [ -f "$AFILE" ] && grep -q "neonaidj-launcher" "$AFILE" 2>/dev/null; then
    sed -i "s|file:///home/[^/]*/neonaidj-launcher.html|http://localhost:3001|g" "$AFILE" 2>/dev/null
    echo "Reverted autostart to direct localhost: $AFILE"
  fi
done

which xdotool >/dev/null 2>&1 || {
  echo "Installing xdotool for browser auto-refresh..."
  sudo apt-get install -y xdotool >/dev/null 2>&1 || true
}

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

echo "[6/7] Restarting service..."
if [ "$DJBOOTH_BOOT_UPDATE" = "1" ]; then
  echo "Running as boot service — skipping restart (systemd will start djbooth next)"
elif systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  export DISPLAY=:0

  sudo systemctl stop djbooth-watchdog 2>/dev/null || true

  echo "Closing browser before restart..."
  pkill -f "chromium" 2>/dev/null || pkill -f "chrome" 2>/dev/null || true
  sleep 2

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
    echo "UPDATE SUCCESSFUL — relaunching browser..."
    echo ""
    bash -c "chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001" &
    disown
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

echo ""
echo "[7/7] Cleaning up..."
rm -rf "$TMPDIR" 2>/dev/null

echo "================================================"
echo "  Update complete!"
echo "================================================"
