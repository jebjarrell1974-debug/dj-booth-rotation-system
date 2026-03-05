#!/bin/bash
HEALTH_URL="http://localhost:3001/__health"
CHECK_INTERVAL=5
SERVER_WAS_DOWN=false

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
        bash -c "chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --disable-background-media-suspend --disable-features=BackgroundMediaSuspend,MediaSessionService --disable-session-crashed-bubble http://localhost:3001" &
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
