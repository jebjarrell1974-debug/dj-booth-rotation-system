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
sudo apt-get update -q 2>&1 | tail -3
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -q 2>&1 | tail -5
if [ -f /var/run/reboot-required ]; then
  echo "  System reboot required after package updates. Scheduling reboot for 08:30..."
  sudo shutdown -r 08:30 "Scheduled reboot after system update" 2>/dev/null || true
fi
set -e

echo "[2/8] Downloading latest code from GitHub..."
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

COMMIT_SHA=$(curl -sf --max-time 8 "https://api.github.com/repos/${GITHUB_REPO}/commits/${BRANCH}" 2>/dev/null | grep -o '"sha":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
SHORT_SHA="${COMMIT_SHA:0:7}"
[ -n "$SHORT_SHA" ] && echo "Commit SHA: $SHORT_SHA" || echo "Commit SHA: (unavailable)"

echo "[3/8] Backing up current installation..."
if [ -f "$APP_DIR/package.json" ]; then
  mkdir -p "$BACKUP_DIR"
  rsync -a --exclude='music' --exclude='voiceovers' --exclude='node_modules' "$APP_DIR/" "$BACKUP_DIR/"
  echo "Backup: $BACKUP_DIR (skipped music/voiceovers/node_modules)"
else
  echo "No existing installation found, skipping backup"
fi

echo "[4/8] Extracting update..."
TMPDIR=$(mktemp -d /tmp/djbooth-extract-XXXXXX)
tar xzf "$TMPFILE" -C "$TMPDIR"
rm -f "$TMPFILE"

EXTRACTED_DIR=$(ls -d "$TMPDIR"/*/  | head -1)
if [ -z "$EXTRACTED_DIR" ]; then
  echo "ERROR: No files extracted"
  rm -rf "$TMPDIR"
  exit 1
fi

echo "[5/8] Copying server and config files..."
cp -r "${EXTRACTED_DIR}server" "$APP_DIR/"
cp -r "${EXTRACTED_DIR}public" "$APP_DIR/" 2>/dev/null || true
cp "${EXTRACTED_DIR}package.json" "$APP_DIR/"
cp "${EXTRACTED_DIR}package-lock.json" "$APP_DIR/" 2>/dev/null || true
cp "${EXTRACTED_DIR}vite.config.js" "$APP_DIR/" 2>/dev/null || true
cp "${EXTRACTED_DIR}tailwind.config.js" "$APP_DIR/" 2>/dev/null || true
cp "${EXTRACTED_DIR}postcss.config.js" "$APP_DIR/" 2>/dev/null || true
cp "${EXTRACTED_DIR}index.html" "$APP_DIR/" 2>/dev/null || true

if [ -f "${EXTRACTED_DIR}public/djbooth-update-github.sh" ]; then
  cp "${EXTRACTED_DIR}public/djbooth-update-github.sh" "$HOME/djbooth-update.sh"
  chmod +x "$HOME/djbooth-update.sh"
  echo "Update script self-updated"
  if [ "${DJBOOTH_RESTARTED}" != "1" ]; then
    echo "Re-executing with new script version..."
    DJBOOTH_RESTARTED=1 /bin/bash "$HOME/djbooth-update.sh"
    exit $?
  fi
fi

echo "[4.5/7] Ensuring fleet environment variables..."
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Creating .env with fleet defaults..."
  FLEET_SERVER="http://100.95.238.71:3001"
  echo "Fetching fleet config from homebase..."
  HTTP_CODE=$(curl -sf -o "$ENV_FILE" -w "%{http_code}" "$FLEET_SERVER/api/fleet-env" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ] && [ -s "$ENV_FILE" ]; then
    echo "Fleet .env downloaded from homebase"
  else
    echo "WARNING: Could not reach homebase for env config"
    cat > "$ENV_FILE" << 'ENVEOF'
PORT=3001
NODE_ENV=production
FLEET_SERVER_URL=http://100.95.238.71:3001
ENVEOF
  fi
else
  FLEET_SERVER="http://100.95.238.71:3001"
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
  grep -q "^FLEET_SERVER_URL=" "$ENV_FILE" || echo "FLEET_SERVER_URL=http://100.95.238.71:3001" >> "$ENV_FILE"
fi

echo "[6/8] Building frontend..."
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

which aubio >/dev/null 2>&1 || {
  echo "Installing aubio-tools for BPM detection..."
  sudo apt-get install -y aubio-tools >/dev/null 2>&1 || true
}

echo "[display] Configuring labwc display settings..."
LABWC_DIR="$HOME/.config/labwc"
mkdir -p "$LABWC_DIR"
cat > "$LABWC_DIR/rc.xml" << 'RCEOF'
<?xml version="1.0"?>
<labwc_config>
  <windowRules>
    <windowRule identifier="neon-dj-display" serverDecoration="no"/>
    <windowRule identifier="RotationChromium">
      <action name="MoveToOutput" output="HDMI-A-2"/>
    </windowRule>
  </windowRules>
</labwc_config>
RCEOF
cat > "$LABWC_DIR/autostart" << 'ASEOF'
wlr-randr --output HDMI-A-2 --transform 90 &
(
  for i in $(seq 1 30); do
    if [ -S "/run/user/1000/wayland-0" ] || [ -S "/run/user/1000/wayland-1" ]; then
      break
    fi
    sleep 1
  done
  sleep 3
  rm -rf /tmp/chromium-rotation
  chromium --kiosk --class=RotationChromium --user-data-dir=/tmp/chromium-rotation --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required http://localhost:3001/RotationDisplay &
) &
(while true; do
  if [ -f /tmp/djbooth-display-trigger ]; then
    rm -f /tmp/djbooth-display-trigger
    pkill -f "RotationChromium" 2>/dev/null || true
    sleep 1
    rm -rf /tmp/chromium-rotation
    chromium --kiosk --class=RotationChromium --user-data-dir=/tmp/chromium-rotation --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required http://localhost:3001/RotationDisplay &
    disown
  fi
  sleep 2
done) &
ASEOF
for OLD_LAUNCHER in "$HOME/.config/autostart/djbooth-display.desktop" "$HOME/.config/autostart/neonaidj-rotation-display.desktop"; do
  if [ -f "$OLD_LAUNCHER" ]; then
    sed -i 's/X-GNOME-Autostart-enabled=true/X-GNOME-Autostart-enabled=false/g' "$OLD_LAUNCHER"
    echo "Disabled duplicate launcher: $(basename $OLD_LAUNCHER)"
  fi
done
if [ "$IS_HOMEBASE" != "true" ]; then
  for KIOSK_FILE in "$HOME/.config/autostart/djbooth-kiosk.desktop"; do
    if [ -f "$KIOSK_FILE" ]; then
      sed -i 's/X-GNOME-Autostart-enabled=false/X-GNOME-Autostart-enabled=true/g' "$KIOSK_FILE"
      echo "Ensured kiosk auto-launcher is enabled: $(basename $KIOSK_FILE)"
    fi
  done
fi
labwc --reconfigure 2>/dev/null || true
echo "Display configuration updated"

echo "[boot-update] Setting up boot-time auto-update (service + cron backup)..."
if [ "$IS_HOMEBASE" != "true" ]; then
  BOOT_USER=$(whoami)
  BOOT_HOME="/home/$(whoami)"

  sudo systemctl disable djbooth-boot 2>/dev/null || true
  sudo rm -f /etc/systemd/system/djbooth-boot.service

  sudo tee /etc/systemd/system/djbooth-update.service > /dev/null << BOOTEOF
[Unit]
Description=NEON AI DJ Boot Update
After=network.target

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
TimeoutStartSec=600

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
    echo "Boot update complete — use Open Display button in app to launch rotation screen"
  else
    echo "WARNING: Server did not respond after restart"
  fi
elif systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  export DISPLAY=:0

  sudo systemctl stop djbooth-watchdog 2>/dev/null || true

  if [ "$IS_HOMEBASE" != "true" ]; then
    echo "Closing browser before restart..."
    pkill -f "chromium" 2>/dev/null || pkill -f "chrome" 2>/dev/null || true
    sleep 2
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
      bash -c "chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001" &
      disown
      sleep 2
      rm -rf /tmp/chromium-rotation
      bash -c "chromium --kiosk --class=RotationChromium --user-data-dir=/tmp/chromium-rotation --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required http://localhost:3001/RotationDisplay" &
      disown
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
