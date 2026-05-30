#!/bin/bash
# NEON AI DJ — Openbox session autostart
# Runs once when openbox starts the X session.
# Replaces the GNOME XDG autostart .desktop entries (which openbox ignores).
# Single source of truth for kiosk + crowd-display launch.

export DISPLAY=:0
export XAUTHORITY="$HOME/.Xauthority"

# Disable screen blanking / DPMS (kiosk should never sleep)
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true

# Apply per-unit display config (rotation, primary, etc).
# xrandr rotation is session-only, MUST run on every session start.
if [ -x "$HOME/.djbooth-display-config.sh" ]; then
  echo "$(date): [openbox-autostart] Applying ~/.djbooth-display-config.sh" >> /tmp/openbox-autostart.log
  bash "$HOME/.djbooth-display-config.sh" >> /tmp/openbox-autostart.log 2>&1 || true
  sleep 2
fi

# Touchscreen map (backup trigger — kiosk launcher also calls this)
if [ -x /usr/local/bin/djbooth-touch-map.sh ]; then
  /usr/local/bin/djbooth-touch-map.sh autostart >> /tmp/openbox-autostart.log 2>&1 || true
fi

# Launch DJ kiosk
if [ -x "$HOME/djbooth-kiosk.sh" ]; then
  nohup bash "$HOME/djbooth-kiosk.sh" > /tmp/kiosk.log 2>&1 &
  disown
fi

# Launch crowd display
if [ -x "$HOME/djbooth-rotation-display.sh" ]; then
  nohup bash "$HOME/djbooth-rotation-display.sh" > /tmp/djbooth-rotation-display.log 2>&1 &
  disown
fi

# Launch crowd-display heartbeat / trigger watcher
if [ -x "$HOME/djbooth-display-watcher.sh" ]; then
  nohup bash "$HOME/djbooth-display-watcher.sh" > /tmp/djbooth-display-watcher.log 2>&1 &
  disown
fi

echo "$(date): [openbox-autostart] complete" >> /tmp/openbox-autostart.log
