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

LAUNCHER_SRC="$APP_DIR/public/neonaidj-launcher.html"
LAUNCHER_DEST="/home/$(whoami)/neonaidj-launcher.html"
if [ -f "$LAUNCHER_SRC" ]; then
  cp "$LAUNCHER_SRC" "$LAUNCHER_DEST"
  AUTOSTART_DIR="/home/$(whoami)/.config/autostart"
  AUTOSTART_FILE="$AUTOSTART_DIR/chromium-djbooth.desktop"
  if [ -d "$AUTOSTART_DIR" ] && [ -f "$AUTOSTART_FILE" ]; then
    if grep -q "localhost:3001" "$AUTOSTART_FILE" 2>/dev/null; then
      sed -i "s|http://localhost:3001|file://$LAUNCHER_DEST|g" "$AUTOSTART_FILE" 2>/dev/null && \
        echo "Updated Chromium autostart to use launcher page" || true
    fi
  fi
  LXDE_AUTOSTART="/etc/xdg/lxsession/LXDE-pi/autostart"
  if [ -f "$LXDE_AUTOSTART" ] && grep -q "localhost:3001" "$LXDE_AUTOSTART" 2>/dev/null; then
    sudo sed -i "s|http://localhost:3001|file://$LAUNCHER_DEST|g" "$LXDE_AUTOSTART" 2>/dev/null && \
      echo "Updated LXDE autostart to use launcher page" || true
  fi
  echo "Launcher page installed: $LAUNCHER_DEST"
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
  sudo systemctl restart "$SERVICE_NAME"
  sleep 5
  for i in 1 2 3 4 5; do
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
      break
    fi
    echo "Waiting for service to start... ($i)"
    sleep 2
  done
  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo ""
    echo "UPDATE SUCCESSFUL — refreshing browser..."
    echo ""
    export DISPLAY=:0
    xdotool key --clearmodifiers F5 2>/dev/null || \
      xdotool key --clearmodifiers ctrl+r 2>/dev/null || \
      wmctrl -a Chromium 2>/dev/null && xdotool key F5 2>/dev/null || true
    CLEANUP_COUNT=$(ls -d "${APP_DIR}.backup-"* 2>/dev/null | head -n -3 | wc -l)
    if [ "$CLEANUP_COUNT" -gt "0" ]; then
      ls -d "${APP_DIR}.backup-"* 2>/dev/null | head -n -3 | xargs rm -rf
      echo "Cleaned up $CLEANUP_COUNT old backups (kept last 3)"
    fi
  else
    echo ""
    echo "WARNING: Service failed to start. Rolling back..."
    rm -rf "$APP_DIR"
    mv "$BACKUP_DIR" "$APP_DIR"
    sudo systemctl restart "$SERVICE_NAME"
    echo "Rolled back to previous version"
    exit 1
  fi
else
  echo "Service '$SERVICE_NAME' not running - skipping restart"
  echo "Start manually: sudo systemctl start $SERVICE_NAME"
fi

echo ""
echo "[7/7] Cleaning up..."
rm -rf "$TMPDIR" 2>/dev/null

echo "================================================"
echo "  Update complete!"
echo "================================================"
