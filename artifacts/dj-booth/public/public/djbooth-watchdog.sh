#!/bin/bash
HEALTH_URL="http://localhost:3001/__health"
CHECK_INTERVAL=5
SERVER_WAS_DOWN=false

# Wait for boot to complete before starting to monitor.
# Prevents race conditions where the watchdog launches a browser
# at the same time as the autostart desktop files.
UPTIME_SEC=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 999)
if [ "$UPTIME_SEC" -lt 120 ]; then
  WAIT=$((120 - UPTIME_SEC))
  echo "$(date): Boot guard — waiting ${WAIT}s for autostart to complete"
  sleep "$WAIT"
fi
echo "$(date): Watchdog monitoring started"

export DISPLAY=:0
export XAUTHORITY="$HOME/.Xauthority"

# Canonical kiosk launcher — single source of truth.
# Uses --app + --window-position + wmctrl (NOT --kiosk, which ignores window-position on Linux).
KIOSK_LAUNCHER="$HOME/djbooth-kiosk.sh"

launch_kiosk() {
  echo "$(date): launching kiosk via $KIOSK_LAUNCHER"
  rm -f ~/.config/chromium/SingletonLock ~/.config/chromium/SingletonCookie ~/.config/chromium/SingletonSocket
  if [ -x "$KIOSK_LAUNCHER" ]; then
    nohup bash "$KIOSK_LAUNCHER" > /tmp/kiosk.log 2>&1 &
    disown
  else
    echo "$(date): ERROR — $KIOSK_LAUNCHER not found or not executable"
  fi
}

# Startup kiosk check — autostart desktop entries can fail silently (Singleton locks,
# X session timing, etc). Verify the kiosk Chromium is running and launch if not.
# Detect by --class=KioskChromium (set by the launcher script).
if ! pgrep -f "KioskChromium" > /dev/null 2>&1; then
  echo "$(date): Kiosk Chromium not running at startup — waiting for server then launching"
  # Inline subshell (function not visible across bash -c boundary)
  bash -c "
    until curl -sf $HEALTH_URL > /dev/null 2>&1; do sleep 2; done
    rm -f ~/.config/chromium/SingletonLock ~/.config/chromium/SingletonCookie ~/.config/chromium/SingletonSocket
    [ -x '$KIOSK_LAUNCHER' ] && nohup bash '$KIOSK_LAUNCHER' > /tmp/kiosk.log 2>&1 &
  " &
else
  echo "$(date): Kiosk Chromium already running at startup"
fi

# NOTE: The crowd-facing rotation display (RotationDisplay) is handled exclusively
# by the GNOME autostart entry (djbooth-rotation-display.desktop), which calls
# ~/djbooth-rotation-display.sh. That script does the xrandr rotation, calculates
# the correct window position, and launches RotationChromium. Do NOT launch it here —
# launching from a systemd service context races against the GNOME autostart and causes
# duplicate Chromium windows fighting each other (documented incident Apr 2026).

while true; do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    if [ "$SERVER_WAS_DOWN" = true ]; then
      echo "$(date): Server recovered — refreshing browser"
      sleep 3
      export DISPLAY=:0
      KIOSK_PID=$(pgrep -f "KioskChromium" | head -1)
      if [ -n "$KIOSK_PID" ]; then
        # Focus the kiosk window first, then F5
        wmctrl -x -a "KioskChromium" 2>/dev/null || true
        sleep 1
        xdotool key --clearmodifiers F5 2>/dev/null && echo "$(date): Sent F5 refresh" || {
          echo "$(date): F5 failed, restarting kiosk via canonical launcher"
          pkill -f "KioskChromium" 2>/dev/null
          sleep 2
          launch_kiosk
        }
      else
        echo "$(date): Kiosk Chromium not running, launching via canonical launcher"
        launch_kiosk
      fi

      SERVER_WAS_DOWN=false
    fi

  else
    if [ "$SERVER_WAS_DOWN" = false ]; then
      echo "$(date): Server went down"
      SERVER_WAS_DOWN=true
    fi
  fi
  sleep $CHECK_INTERVAL
done
