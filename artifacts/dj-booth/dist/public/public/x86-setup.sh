#!/bin/bash
set -e

echo "================================================"
echo "  NEON AI DJ - x86 Debian Kiosk Setup"
echo "  (Dell OptiPlex / Beelink / Any x86 Debian)"
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

echo "[1/12] Installing Tailscale..."
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

echo "[2/12] Installing Node.js and SSH server..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi
echo "Node: $(node --version)"
sudo apt install -y openssh-server git curl
sudo systemctl enable --now ssh
echo "SSH: $(sudo systemctl is-active ssh)"

echo "[3/12] Installing NoMachine for remote desktop access..."
if ! command -v nxserver &> /dev/null; then
  NM_URL=$(curl -sf "https://www.nomachine.com/download" | \
    grep -oE 'https://download\.nomachine\.com/download/[0-9]+\.[0-9]+/Linux/nomachine_[0-9._]+amd64\.deb' | \
    head -1)
  if [ -z "$NM_URL" ]; then
    echo "⚠ Could not auto-detect NoMachine download URL."
    echo "  Visit https://www.nomachine.com/download to get the .deb link,"
    echo "  then run: wget <url> && sudo dpkg -i nomachine_*.deb"
  else
    echo "Downloading: $NM_URL"
    curl -fL -o /tmp/nomachine.deb "$NM_URL"
    if file /tmp/nomachine.deb | grep -q "Debian binary package"; then
      sudo dpkg -i /tmp/nomachine.deb
      rm -f /tmp/nomachine.deb
      echo "NoMachine installed. Connect via Tailscale ($TAILSCALE_IP) on port 4000"
    else
      echo "⚠ Download was not a valid .deb — skipping NoMachine install."
      echo "  Visit https://www.nomachine.com/download to install manually."
      rm -f /tmp/nomachine.deb
    fi
  fi
else
  echo "NoMachine already installed"
fi

echo "[4/12] Cloning app from GitHub..."
if [ ! -d "$APP_DIR" ]; then
  cd "$UNIT_HOME"
  git clone "https://github.com/$GITHUB_REPO.git" djbooth
fi
cd "$APP_DIR"

echo "[5/12] Installing dependencies and building..."
npm install --no-audit --no-fund 2>&1 | tail -5
npx vite build 2>&1 | tail -5

echo "[6/12] Setting up environment variables..."
if [ ! -f "$APP_DIR/.env" ]; then
  FLEET_SERVER="http://100.109.73.27:3001"
  echo "Fetching fleet config from homebase..."
  HTTP_CODE=$(curl -sf -o "$APP_DIR/.env" -w "%{http_code}" "$FLEET_SERVER/api/fleet-env" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ] && [ -s "$APP_DIR/.env" ]; then
    echo ".env downloaded from homebase"
  else
    echo "Could not reach homebase for env config."
    echo "Make sure the homebase is running at $FLEET_SERVER"
    cat > "$APP_DIR/.env" << 'ENVEOF'
PORT=3001
NODE_ENV=production
FLEET_SERVER_URL=http://100.109.73.27:3001
ENVEOF
  fi
else
  echo ".env already exists"
fi

echo "[7/12] Setting up systemd service..."
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

echo "[8/12] Installing Chromium and setting up kiosk..."
sudo apt install -y chromium 2>/dev/null || sudo apt install -y chromium-browser 2>/dev/null || true

sudo hostnamectl set-hostname "$UNIT_USER"
grep -q "$UNIT_USER" /etc/hosts || echo "127.0.1.1 $UNIT_USER" | sudo tee -a /etc/hosts > /dev/null

mkdir -p ~/.config/autostart
cat > ~/.config/autostart/djbooth-kiosk.desktop << 'KEOF'
[Desktop Entry]
Type=Application
Name=DJ Booth Kiosk
Exec=bash -c "sleep 15 && chromium --kiosk --noerrdialogs --disable-infobars --force-device-scale-factor=1 --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001"
X-GNOME-Autostart-enabled=true
KEOF

mkdir -p ~/Desktop
cat > ~/Desktop/neonaidj.desktop << DEOF
[Desktop Entry]
Type=Application
Name=NEON AI DJ
Comment=Launch DJ Booth
Exec=bash -c "chromium --kiosk --noerrdialogs --disable-infobars --force-device-scale-factor=1 --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001"
Terminal=false
Categories=Audio;
DEOF
chmod +x ~/Desktop/neonaidj.desktop
gio set ~/Desktop/neonaidj.desktop metadata::trusted true 2>/dev/null || true

echo "[9/12] Configuring GNOME for unattended kiosk operation..."
# Disable screen lock and screensaver
gsettings set org.gnome.desktop.screensaver lock-enabled false 2>/dev/null || true
gsettings set org.gnome.desktop.screensaver idle-activation-enabled false 2>/dev/null || true
gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null || true
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' 2>/dev/null || true
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type 'nothing' 2>/dev/null || true
gsettings set org.gnome.mutter auto-maximize false 2>/dev/null || true
gsettings set org.gnome.mutter edge-tiling false 2>/dev/null || true

# Force X11 session (required for xrandr display rotation on second screen)
sudo tee /etc/gdm3/daemon.conf > /dev/null << GDMEOF
[daemon]
AutomaticLoginEnable=True
AutomaticLogin=$UNIT_USER
WaylandEnable=false
GDMEOF
echo "GNOME auto-login + X11 session configured"

# Install xrandr for second display (crowd rotation screen) management
sudo apt install -y x11-xserver-utils 2>/dev/null || true

# Write second display launcher script
# Uses --app + wmctrl to open on the crowd TV at its exact xrandr coordinates.
# --kiosk ignores --window-position on Linux, so we never use it for the crowd screen.
cat > "$UNIT_HOME/djbooth-rotation-display.sh" << 'RDEOF'
#!/bin/bash
sleep 20
export DISPLAY=:0
export XAUTHORITY="${XAUTHORITY:-/home/$(whoami)/.Xauthority}"

# Find the non-primary (crowd TV) display and its geometry
SECOND=$(xrandr --query 2>/dev/null | grep " connected" | grep -v primary | awk '{print $1}' | head -1)
GEOM=$(xrandr --query 2>/dev/null | grep "^$SECOND connected" | grep -oE '[0-9]+x[0-9]+\+[0-9]+\+[0-9]+' | head -1)
if [ -n "$GEOM" ]; then
  W=$(echo "$GEOM" | cut -dx -f1)
  H=$(echo "$GEOM" | cut -dx -f2 | cut -d+ -f1)
  X=$(echo "$GEOM" | cut -d+ -f2)
  Y=$(echo "$GEOM" | cut -d+ -f3)
else
  W=1920; H=1080; X=0; Y=0
fi

rm -rf /tmp/chromium-rotation
chromium --app=http://localhost:3001/RotationDisplay \
  --class=RotationChromium \
  --user-data-dir=/tmp/chromium-rotation \
  --window-position=${X},${Y} \
  --window-size=${W},${H} \
  --noerrdialogs --disable-session-crashed-bubble \
  --autoplay-policy=no-user-gesture-required \
  --force-device-scale-factor=1 &
sleep 5
wmctrl -x -r "RotationChromium" -b add,fullscreen 2>/dev/null || true
wait
RDEOF
chmod +x "$UNIT_HOME/djbooth-rotation-display.sh"

# Write display trigger watcher script (relaunches crowd screen when update script fires trigger)
cat > "$UNIT_HOME/djbooth-display-watcher.sh" << 'DWEOF'
#!/bin/bash
export DISPLAY=:0
export XAUTHORITY="${XAUTHORITY:-/home/$(whoami)/.Xauthority}"

launch_rotation() {
  SECOND=$(xrandr --query 2>/dev/null | grep " connected" | grep -v primary | awk '{print $1}' | head -1)
  GEOM=$(xrandr --query 2>/dev/null | grep "^$SECOND connected" | grep -oE '[0-9]+x[0-9]+\+[0-9]+\+[0-9]+' | head -1)
  if [ -n "$GEOM" ]; then
    W=$(echo "$GEOM" | cut -dx -f1)
    H=$(echo "$GEOM" | cut -dx -f2 | cut -d+ -f1)
    X=$(echo "$GEOM" | cut -d+ -f2)
    Y=$(echo "$GEOM" | cut -d+ -f3)
  else
    W=1920; H=1080; X=0; Y=0
  fi
  pkill -f "RotationChromium" 2>/dev/null || true
  sleep 1
  rm -rf /tmp/chromium-rotation
  chromium --app=http://localhost:3001/RotationDisplay \
    --class=RotationChromium \
    --user-data-dir=/tmp/chromium-rotation \
    --window-position=${X},${Y} \
    --window-size=${W},${H} \
    --noerrdialogs --disable-session-crashed-bubble \
    --autoplay-policy=no-user-gesture-required \
    --force-device-scale-factor=1 &
  sleep 5
  wmctrl -x -r "RotationChromium" -b add,fullscreen 2>/dev/null || true
}

while true; do
  if [ -f /tmp/djbooth-display-trigger ]; then
    rm -f /tmp/djbooth-display-trigger
    launch_rotation
  fi
  sleep 2
done
DWEOF
chmod +x "$UNIT_HOME/djbooth-display-watcher.sh"

# GNOME autostart for both second display scripts
cat > "$HOME/.config/autostart/djbooth-rotation-display.desktop" << RDEOF
[Desktop Entry]
Type=Application
Name=DJ Rotation Display
Exec=$UNIT_HOME/djbooth-rotation-display.sh
X-GNOME-Autostart-enabled=true
RDEOF

cat > "$HOME/.config/autostart/djbooth-display-watcher.desktop" << DWEOF
[Desktop Entry]
Type=Application
Name=DJ Display Watcher
Exec=$UNIT_HOME/djbooth-display-watcher.sh
X-GNOME-Autostart-enabled=true
DWEOF
echo "Second display (crowd rotation screen) configured"

echo "[10/12] Setting up passwordless sudo..."
NOPASSWD_FILE="/etc/sudoers.d/010_${UNIT_USER}-nopasswd"
if [ ! -f "$NOPASSWD_FILE" ]; then
  echo "$UNIT_USER ALL=(ALL) NOPASSWD: ALL" | sudo tee "$NOPASSWD_FILE" > /dev/null
  sudo chmod 0440 "$NOPASSWD_FILE"
  sudo visudo -c -f "$NOPASSWD_FILE" > /dev/null 2>&1 && echo "Passwordless sudo configured" || { sudo rm -f "$NOPASSWD_FILE"; echo "WARNING: sudoers validation failed, skipping"; }
fi

echo "[11/12] Setting up browser watchdog..."
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

echo "[12/12] Setting daily reboot and downloading update script..."
echo "0 8 * * * root /sbin/reboot" | sudo tee /etc/cron.d/daily-reboot > /dev/null
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
echo ""
echo "  *** USB AUDIO DONGLE (do this when it arrives) ***"
echo "  Plug in the dongle, then run:"
echo "  pactl list short sinks"
echo "  Find the USB device name, then:"
echo "  pactl set-default-sink <device-name>"
echo "  Add to ~/.bashrc to make it permanent."
echo "================================================"
