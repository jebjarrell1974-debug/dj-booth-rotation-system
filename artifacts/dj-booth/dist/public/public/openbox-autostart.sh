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

# Reset hardware (OS) output volume to 80% on every boot.
# Power loss / unclean shutdown can wipe the ALSA mixer back to default. The operator
# wants the USB sound card pinned at 80% every session. The card INDEX drifts across
# units/boots, so detect it by name ("USB Audio") and try the common control names.
USB_CARD=$(aplay -l 2>/dev/null | grep -i 'USB Audio' | head -1 | sed -n 's/^card \([0-9]\+\):.*/\1/p')
if [ -n "$USB_CARD" ]; then
  for CTL in PCM Speaker Master; do
    if amixer -c "$USB_CARD" sset "$CTL" 80% unmute >/dev/null 2>&1; then
      echo "$(date): [openbox-autostart] USB audio card $USB_CARD '$CTL' -> 80%" >> /tmp/openbox-autostart.log
      break
    fi
  done
else
  echo "$(date): [openbox-autostart] no USB audio card found for 80% volume preset" >> /tmp/openbox-autostart.log
fi

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
else
  # Minimal BOOTSTRAP kiosk for a FRESHLY-provisioned unit before the updater has generated
  # the full djbooth-kiosk.sh. Without this, shadowing xdg-autostart would leave a brand-new
  # unit with no main kiosk until its first update + reboot. The updater replaces this with
  # the geometry/touch-aware djbooth-kiosk.sh within ~45s (boot cron); the next reboot then
  # takes the primary branch above. No-op on configured units (002/003) which have kiosk.sh.
  # Backgrounded subshell so the health-wait never stalls the crowd-display launch below.
  # --password-store=basic keeps a gnome-keyring prompt from blocking the bootstrap window.
  echo "$(date): [openbox-autostart] djbooth-kiosk.sh missing — bootstrap Chromium (first-boot fallback)" >> /tmp/openbox-autostart.log
  (
    # Wait for the server to answer (cap ~120s) so we don't land on an error page.
    for i in $(seq 1 60); do curl -sf http://localhost:3001/__health >/dev/null 2>&1 && break; sleep 2; done
    chromium --kiosk --no-first-run --noerrdialogs --disable-infobars \
      --disable-session-crashed-bubble --disable-translate \
      --disable-features=TranslateUI,BackgroundMediaSuspend,MediaSessionService \
      --autoplay-policy=no-user-gesture-required --disable-background-media-suspend \
      --force-device-scale-factor=0.85 --password-store=basic \
      http://localhost:3001 > /tmp/kiosk.log 2>&1
  ) &
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
