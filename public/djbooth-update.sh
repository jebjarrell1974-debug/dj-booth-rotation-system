#!/bin/bash
set -e

CLOUD_URL="${DJBOOTH_CLOUD_URL:-https://dj-booth-automated-rotation-system-jebjarrell1974.replit.app}"
APP_DIR="${DJBOOTH_APP_DIR:-/home/$(whoami)/djbooth}"
SERVICE_NAME="${DJBOOTH_SERVICE:-djbooth}"
BACKUP_DIR="${APP_DIR}.backup-$(date +%Y%m%d-%H%M%S)"

echo "================================================"
echo "  DJ Booth Auto-Updater"
echo "================================================"
echo ""
echo "Cloud:   $CLOUD_URL"
echo "App dir: $APP_DIR"
echo "Service: $SERVICE_NAME"
echo ""

echo "[1/6] Checking for updates..."
REMOTE_VERSION=$(curl -sf "${CLOUD_URL}/api/version" 2>/dev/null || echo '{}')
echo "Remote: $REMOTE_VERSION"

if [ -z "$APP_DIR" ] || [ "$APP_DIR" = "/" ]; then
  echo "ERROR: Invalid app directory '$APP_DIR'"
  exit 1
fi
if [ ! -d "$APP_DIR" ]; then
  echo "ERROR: App directory $APP_DIR not found"
  exit 1
fi
if [ ! -f "$APP_DIR/package.json" ]; then
  echo "ERROR: $APP_DIR does not look like a DJ Booth installation (no package.json)"
  exit 1
fi

echo "[2/6] Downloading update bundle..."
TMPFILE=$(mktemp /tmp/djbooth-update-XXXXXX.tar.gz)
HTTP_CODE=$(curl -sf -w "%{http_code}" -o "$TMPFILE" "${CLOUD_URL}/api/update-bundle" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: Download failed (HTTP $HTTP_CODE)"
  rm -f "$TMPFILE"
  exit 1
fi
FILESIZE=$(stat -f%z "$TMPFILE" 2>/dev/null || stat -c%s "$TMPFILE" 2>/dev/null)
echo "Downloaded: ${FILESIZE} bytes"

echo "[3/6] Backing up current installation..."
cp -r "$APP_DIR" "$BACKUP_DIR"
echo "Backup: $BACKUP_DIR"

echo "[4/6] Extracting update..."
tar xzf "$TMPFILE" -C "$APP_DIR" --overwrite 2>/dev/null || tar xzf "$TMPFILE" -C "$APP_DIR"
rm -f "$TMPFILE"
echo "Files extracted to $APP_DIR"

echo "[5/6] Installing dependencies..."
cd "$APP_DIR"
if [ -f package.json ]; then
  npm install --production --no-audit --no-fund 2>&1 | tail -3
fi

echo "[6/6] Restarting service..."
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  sudo systemctl restart "$SERVICE_NAME"
  sleep 3
  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo ""
    echo "UPDATE SUCCESSFUL"
    echo ""
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

echo "================================================"
echo "  Update complete!"
echo "================================================"
