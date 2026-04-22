#!/bin/bash
HEALTH_URL="http://localhost:3001/__health"
CHECK_INTERVAL=5
SERVER_WAS_DOWN=false
ROTATION_CHECK_COUNTER=0
ROTATION_CHECK_EVERY=30

launch_rotation_display() {
  export DISPLAY=:0
  rm -rf /tmp/chromium-rotation
  bash -c "chromium --kiosk --class=RotationChromium --user-data-dir=/tmp/chromium-rotation \
    --noerrdialogs --disable-session-crashed-bubble \
    --autoplay-policy=no-user-gesture-required \
    http://localhost:3001/RotationDisplay" &
  disown
  echo "$(date): Rotation display launched"
}

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

# Startup kiosk check — autostart desktop entries can fail silently (Singleton locks,
# X session timing, etc). Verify Chromium is running in kiosk mode and launch if not.
if ! pgrep -f "chromium.*kiosk" > /dev/null 2>&1; then
  echo "$(date): Kiosk Chromium not running at startup — launching"
  rm -f ~/.config/chromium/SingletonLock ~/.config/chromium/SingletonCookie ~/.config/chromium/SingletonSocket
  bash -c "until curl -sf $HEALTH_URL > /dev/null 2>&1; do sleep 2; done && chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001" &
else
  echo "$(date): Kiosk Chromium already running at startup"
fi

# Startup rotation display check — ensure crowd-facing display is always running.
# This catches: failed GNOME autostart, server-restart mid-boot, and post-update reboots.
if ! pgrep -f "RotationChromium" > /dev/null 2>&1; then
  echo "$(date): Rotation display not running at startup — launching after server ready"
  bash -c "until curl -sf $HEALTH_URL > /dev/null 2>&1; do sleep 3; done && \
    rm -rf /tmp/chromium-rotation && \
    chromium --kiosk --class=RotationChromium --user-data-dir=/tmp/chromium-rotation \
    --noerrdialogs --disable-session-crashed-bubble \
    --autoplay-policy=no-user-gesture-required \
    http://localhost:3001/RotationDisplay" &
  disown
else
  echo "$(date): Rotation display already running at startup"
fi

while true; do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    if [ "$SERVER_WAS_DOWN" = true ]; then
      echo "$(date): Server recovered — refreshing browser"
      sleep 3
      export DISPLAY=:0
      CHROME_PID=$(pgrep -f "chromium.*kiosk" | head -1)
      if [ -n "$CHROME_PID" ]; then
        xdotool key --clearmodifiers F5 2>/dev/null && echo "$(date): Sent F5 refresh" || {
          echo "$(date): F5 failed, restarting Chrome"
          pkill -f "chromium.*kiosk" 2>/dev/null
          sleep 2
          bash -c "until curl -sf $HEALTH_URL > /dev/null 2>&1; do sleep 2; done && chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001" &
        }
      else
        echo "$(date): Chrome not running, launching"
        rm -f ~/.config/chromium/SingletonLock ~/.config/chromium/SingletonCookie ~/.config/chromium/SingletonSocket
        bash -c "chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001" &
      fi

      # Also relaunch the rotation display after server recovery
      echo "$(date): Server recovered — relaunching rotation display"
      pkill -f "RotationChromium" 2>/dev/null || true
      sleep 1
      launch_rotation_display

      SERVER_WAS_DOWN=false
    fi

    # Periodic rotation display check — every ~30 seconds, ensure it is still running
    ROTATION_CHECK_COUNTER=$((ROTATION_CHECK_COUNTER + 1))
    if [ "$ROTATION_CHECK_COUNTER" -ge "$ROTATION_CHECK_EVERY" ]; then
      ROTATION_CHECK_COUNTER=0
      if ! pgrep -f "RotationChromium" > /dev/null 2>&1; then
        echo "$(date): Rotation display not running — relaunching"
        launch_rotation_display
      fi
    fi

  else
    if [ "$SERVER_WAS_DOWN" = false ]; then
      echo "$(date): Server went down"
      SERVER_WAS_DOWN=true
    fi
  fi
  sleep $CHECK_INTERVAL
done
