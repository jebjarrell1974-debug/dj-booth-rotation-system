#!/bin/bash
set -e

echo "================================================"
echo "  NEON AI DJ - Pi Kiosk Setup"
echo "================================================"
echo ""

UNIT_USER=$(whoami)
UNIT_HOME=$(eval echo ~$UNIT_USER)
APP_DIR="$UNIT_HOME/djbooth"
GITHUB_REPO="jebjarrell1974-debug/dj-booth-rotation-system"

echo "User: $UNIT_USER"
echo "Home: $UNIT_HOME"
echo "App:  $APP_DIR"
echo ""

echo "[1/8] Installing Tailscale..."
if ! command -v tailscale &> /dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
  echo ""
  echo "================================================"
  echo "  IMPORTANT: Run this now to connect Tailscale:"
  echo "  sudo tailscale up"
  echo ""
  echo "  Authorize it in the browser, then re-run this"
  echo "  script to continue setup."
  echo "================================================"
  exit 0
fi

TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "not connected")
if [ "$TAILSCALE_IP" = "not connected" ] || [ -z "$TAILSCALE_IP" ]; then
  echo ""
  echo "================================================"
  echo "  Tailscale is installed but not connected."
  echo "  Run: sudo tailscale up"
  echo "  Authorize it, then re-run this script."
  echo "================================================"
  exit 0
fi
echo "Tailscale IP: $TAILSCALE_IP"

echo "[2/8] Installing Node.js..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi
echo "Node: $(node --version)"

echo "[3/8] Cloning app from GitHub..."
if [ ! -d "$APP_DIR" ]; then
  cd "$UNIT_HOME"
  git clone "https://github.com/$GITHUB_REPO.git" djbooth
fi
cd "$APP_DIR"

echo "[4/8] Installing dependencies and building..."
npm install --no-audit --no-fund 2>&1 | tail -5
npx vite build 2>&1 | tail -5

echo "[5/8] Setting up environment variables..."
if [ ! -f "$APP_DIR/.env" ]; then
  FLEET_SERVER="http://100.109.73.27:3001"
  echo "Fetching fleet config from homebase..."
  HTTP_CODE=$(curl -sf -o "$APP_DIR/.env" -w "%{http_code}" "$FLEET_SERVER/api/fleet-env" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ] && [ -s "$APP_DIR/.env" ]; then
    echo ".env downloaded from homebase"
  else
    echo "Could not reach homebase for env config."
    echo "Make sure the homebase is running at $FLEET_SERVER"
    echo "You can manually create $APP_DIR/.env later."
    cat > "$APP_DIR/.env" << 'ENVEOF'
PORT=3001
NODE_ENV=production
FLEET_SERVER_URL=http://100.109.73.27:3001
ENVEOF
  fi
else
  echo ".env already exists"
fi

echo "[6/8] Setting up systemd service..."
sudo tee /etc/systemd/system/djbooth.service > /dev/null << EOF
[Unit]
Description=NEON AI DJ Booth
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$UNIT_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
EnvironmentFile=$APP_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable djbooth
sudo systemctl start djbooth
echo "Service started"

echo "[7/8] Setting up kiosk mode and desktop..."
sudo apt install -y chromium 2>/dev/null || true

sudo hostnamectl set-hostname "$UNIT_USER"
grep -q "$UNIT_USER" /etc/hosts || echo "127.0.1.1 $UNIT_USER" | sudo tee -a /etc/hosts > /dev/null

echo "0 8 * * * root /sbin/reboot" | sudo tee /etc/cron.d/daily-reboot > /dev/null

mkdir -p ~/.config/autostart
cat > ~/.config/autostart/djbooth-kiosk.desktop << 'KEOF'
[Desktop Entry]
Type=Application
Name=DJ Booth Kiosk
Exec=bash -c "sleep 10 && chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001"
X-GNOME-Autostart-enabled=true
KEOF

mkdir -p ~/Desktop
cp "$APP_DIR/public/neonaidj-icon.svg" "$UNIT_HOME/neonaidj-icon.svg" 2>/dev/null || true
cat > ~/Desktop/neonaidj.desktop << DEOF
[Desktop Entry]
Type=Application
Name=NEON AI DJ
Comment=Launch DJ Booth
Icon=$UNIT_HOME/neonaidj-icon.svg
Exec=bash -c "chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001"
Terminal=false
Categories=Audio;
DEOF
chmod +x ~/Desktop/neonaidj.desktop
gio set ~/Desktop/neonaidj.desktop metadata::trusted true 2>/dev/null || true

echo "[8/12] Setting up passwordless sudo..."
NOPASSWD_FILE="/etc/sudoers.d/010_${UNIT_USER}-nopasswd"
if [ ! -f "$NOPASSWD_FILE" ]; then
  echo "$UNIT_USER ALL=(ALL) NOPASSWD: ALL" | sudo tee "$NOPASSWD_FILE" > /dev/null
  sudo chmod 0440 "$NOPASSWD_FILE"
  sudo visudo -c -f "$NOPASSWD_FILE" > /dev/null 2>&1 && echo "Passwordless sudo configured" || { sudo rm -f "$NOPASSWD_FILE"; echo "WARNING: sudoers validation failed, skipping"; }
fi

echo "[9/12] Setting up swap file..."
if [ ! -f /swapfile ] && [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 2048 ]; then
  sudo fallocate -l 1G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=1024 2>/dev/null
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null 2>&1
  sudo swapon /swapfile 2>/dev/null
  grep -q '/swapfile' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "1GB swap file created"
else
  echo "Swap already exists or not needed"
fi

echo "[10/12] Setting up browser watchdog..."
WATCHDOG_SRC="$APP_DIR/public/djbooth-watchdog.sh"
WATCHDOG_DEST="$UNIT_HOME/djbooth-watchdog.sh"
if [ -f "$WATCHDOG_SRC" ]; then
  cp "$WATCHDOG_SRC" "$WATCHDOG_DEST"
  chmod +x "$WATCHDOG_DEST"
  if ! systemctl is-enabled djbooth-watchdog 2>/dev/null | grep -q enabled; then
    sudo tee /etc/systemd/system/djbooth-watchdog.service > /dev/null << WEOF
[Unit]
Description=DJ Booth Browser Watchdog
After=graphical.target djbooth.service
Wants=djbooth.service

[Service]
Type=simple
User=$UNIT_USER
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
    echo "Watchdog service installed"
  else
    echo "Watchdog already running"
  fi
fi

echo "[11/12] Setting up network priority (Ethernet=internet, WiFi=local)..."
ETH_CONN=$(nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | grep eth0 | cut -d: -f1)
WIFI_CONN=$(nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | grep wlan0 | cut -d: -f1)
if [ -n "$ETH_CONN" ]; then
  sudo nmcli connection modify "$ETH_CONN" ipv4.route-metric 100 2>/dev/null && echo "Ethernet priority set (metric 100)" || true
fi
if [ -n "$WIFI_CONN" ]; then
  sudo nmcli connection modify "$WIFI_CONN" ipv4.route-metric 600 2>/dev/null && echo "WiFi set to local only (metric 600)" || true
fi

echo "[12/12] Downloading update script..."
curl -o "$UNIT_HOME/djbooth-update.sh" "https://raw.githubusercontent.com/$GITHUB_REPO/main/public/djbooth-update-github.sh" && chmod +x "$UNIT_HOME/djbooth-update.sh"

echo ""
echo "================================================"
echo "  SETUP COMPLETE!"
echo ""
echo "  Unit:       $UNIT_USER"
echo "  Tailscale:  $TAILSCALE_IP"
echo "  Fleet URL:  http://100.109.73.27:3001"
echo "  App URL:    http://localhost:3001"
echo ""
echo "  Reboot to start kiosk mode:"
echo "  sudo reboot"
echo "================================================"
