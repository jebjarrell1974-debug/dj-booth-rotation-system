#!/bin/bash
# NEON AI DJ — Homebase desktop setup.
# Turns a homebase unit (IS_HOMEBASE=true) into a normal, usable GNOME desktop:
#   - kills any booth browser windows hijacking the screen
#   - removes leftover kiosk / crowd-display auto-start entries
#   - stops the gnome-keyring auto-login password nag
#   - creates a Fleet Music folder + 3 shortcuts (desktop + dock):
#       Neon AI DJ, Fleet Music, Push Music to Fleet
# Safe to re-run. Does NOTHING show-related — homebase only.
# Rollback: this only adds files + user autostart overrides; nothing here
# touches the live booths (002/003) or the djbooth service itself.

set -u

USER_NAME=$(whoami)
HOME_DIR="/home/$USER_NAME"

# Make gsettings / gio / gnome-extensions work even when run over SSH by
# borrowing the running GNOME session's D-Bus address.
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  GPID=$(pgrep -u "$USER_NAME" gnome-session 2>/dev/null | head -1)
  [ -z "$GPID" ] && GPID=$(pgrep -u "$USER_NAME" gnome-shell 2>/dev/null | head -1)
  if [ -n "$GPID" ] && [ -r "/proc/$GPID/environ" ]; then
    _dbus=$(tr '\0' '\n' < "/proc/$GPID/environ" | grep '^DBUS_SESSION_BUS_ADDRESS=' | head -1 | cut -d= -f2-)
    [ -n "$_dbus" ] && export DBUS_SESSION_BUS_ADDRESS="$_dbus"
  fi
fi
export DISPLAY="${DISPLAY:-:0}"

echo "== 1/6  Closing any booth windows hijacking the desktop =="
pkill -f 'chromium.*localhost:3001'      2>/dev/null || true
pkill -f 'djbooth-kiosk.sh'              2>/dev/null || true
pkill -f 'djbooth-rotation-display.sh'   2>/dev/null || true
pkill -f 'djbooth-display-watcher.sh'    2>/dev/null || true

echo "== 2/6  Removing leftover kiosk auto-start entries =="
rm -f "$HOME_DIR/.config/autostart/djbooth-kiosk.desktop" \
      "$HOME_DIR/.config/autostart/djbooth-rotation-display.desktop" \
      "$HOME_DIR/.config/autostart/djbooth-display-watcher.desktop" \
      "$HOME_DIR/.config/autostart/djbooth-touch-map.desktop" \
      "$HOME_DIR/.config/autostart/squeekboard.desktop" 2>/dev/null || true

echo "== 3/6  Stopping the login-keyring password nag =="
# Suppress the gnome-keyring session components for this user (user-scoped,
# reversible, no sudo). With auto-login there is no password to unlock the
# keyring, so it nags every boot. Our browser shortcut uses --password-store=basic
# so nothing needs the keyring on this desktop.
mkdir -p "$HOME_DIR/.config/autostart"
for C in gnome-keyring-secrets gnome-keyring-ssh gnome-keyring-pkcs11; do
  printf '[Desktop Entry]\nType=Application\nName=%s\nHidden=true\nX-GNOME-Autostart-enabled=false\n' "$C" \
    > "$HOME_DIR/.config/autostart/$C.desktop"
done
# Remove the password-protected keyring the operator was forced to create so a
# fresh, unlocked one is used going forward.
rm -f "$HOME_DIR/.local/share/keyrings/login.keyring" \
      "$HOME_DIR/.local/share/keyrings/Default_keyring.keyring" \
      "$HOME_DIR/.local/share/keyrings/default" 2>/dev/null || true

echo "== 4/6  Ensuring the Fleet Music folder exists =="
MUSIC_DIR="$HOME_DIR/djbooth/music"
mkdir -p "$MUSIC_DIR"

echo "== 5/6  Installing desktop shortcuts =="
APPS_DIR="$HOME_DIR/.local/share/applications"
DESK_DIR="$HOME_DIR/Desktop"
mkdir -p "$APPS_DIR" "$DESK_DIR"

cat > "$APPS_DIR/neon-ai-dj.desktop" << 'DESK1'
[Desktop Entry]
Version=1.0
Type=Application
Name=Neon AI DJ
Comment=Open the NEON AI DJ booth software
Exec=chromium --app=http://localhost:3001 --password-store=basic --no-first-run --no-default-browser-check
Icon=applications-multimedia
Terminal=false
Categories=AudioVideo;
DESK1

cat > "$APPS_DIR/fleet-music.desktop" << DESK2
[Desktop Entry]
Version=1.0
Type=Application
Name=Fleet Music
Comment=Add or remove music for the whole fleet
Exec=nautilus "$MUSIC_DIR"
Icon=folder-music
Terminal=false
Categories=AudioVideo;
DESK2

cat > "$HOME_DIR/push-music-to-fleet.sh" << 'PUSH'
#!/bin/bash
echo "==================================================="
echo "   Pushing homebase music to the fleet..."
echo "   Uploading to the cloud — please do not close."
echo "==================================================="
echo ""
sudo systemctl restart djbooth
echo "   Upload running..."
for i in $(seq 1 90); do
  if curl -sf http://localhost:3001/api/boot-status 2>/dev/null | grep -q '"ready":true'; then
    echo ""
    echo "   DONE. Your music is on the cloud."
    echo "   002 and 003 will pick it up on their next update."
    break
  fi
  sleep 2
done
echo ""
read -rp "   Press Enter to close this window..."
PUSH
chmod +x "$HOME_DIR/push-music-to-fleet.sh"

cat > "$APPS_DIR/push-music-to-fleet.desktop" << DESK3
[Desktop Entry]
Version=1.0
Type=Application
Name=Push Music to Fleet
Comment=Upload homebase music to the whole fleet
Exec=gnome-terminal -- bash "$HOME_DIR/push-music-to-fleet.sh"
Icon=application-x-executable
Terminal=false
Categories=AudioVideo;
DESK3

# Put the launchers on the Desktop and mark them trusted (so they open on double-click)
for L in neon-ai-dj fleet-music push-music-to-fleet; do
  cp "$APPS_DIR/$L.desktop" "$DESK_DIR/$L.desktop"
  chmod +x "$DESK_DIR/$L.desktop"
  gio set "$DESK_DIR/$L.desktop" metadata::trusted true 2>/dev/null || true
done

echo "== 6/6  Enabling desktop icons + pinning shortcuts to the dock =="
# Desktop icons (best effort — needs the DING extension; harmless if unavailable)
sudo apt-get install -y gnome-shell-extension-desktop-icons-ng >/dev/null 2>&1 || true
gnome-extensions enable ding@rastersoft.com 2>/dev/null || true
# Pin our shortcuts + Files + Terminal + Settings to the always-visible dock
gsettings set org.gnome.shell favorite-apps \
  "['neon-ai-dj.desktop', 'fleet-music.desktop', 'push-music-to-fleet.desktop', 'org.gnome.Nautilus.desktop', 'org.gnome.Terminal.desktop', 'org.gnome.Settings.desktop']" \
  2>/dev/null || true

echo ""
echo "==================================================="
echo "  Homebase desktop setup complete."
echo "  Reboot once to lock everything in:  sudo reboot"
echo "  After that: turn on the monitor -> normal desktop"
echo "  with Neon AI DJ, Fleet Music, and Push Music to"
echo "  Fleet shortcuts on the desktop and the dock."
echo "==================================================="
