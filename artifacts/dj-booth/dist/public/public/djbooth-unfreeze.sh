#!/bin/bash
# djbooth-unfreeze.sh
# Manual recovery for the "frozen mouse + touchscreen, music still playing"
# state (gnome-shell holding a stuck X input grab). Safe to run any time —
# does not interrupt music. Trigger from a phone via Tailscale SSH:
#   ssh neonaidj003 'bash ~/djbooth-unfreeze.sh'

export DISPLAY=:0
export XAUTHORITY="$HOME/.Xauthority"

echo "$(date): unfreeze: HUP gnome-shell"
killall -HUP gnome-shell 2>/dev/null

sleep 2

# HUP wipes xrandr state (primary, rotate, pos) — restore it.
if [ -x "$HOME/.djbooth-display-config.sh" ]; then
  echo "$(date): unfreeze: re-applying display config"
  bash "$HOME/.djbooth-display-config.sh" 2>/dev/null
fi

sleep 1

# HUP also drops the touch→monitor mapping. Re-bind to the kiosk output.
# Honor per-unit port override (~/.djbooth-ports) — e.g. 005 kiosk on DisplayPort.
if [ -f "$HOME/.djbooth-ports" ]; then . "$HOME/.djbooth-ports" 2>/dev/null; fi
KIOSK_TARGET="${KIOSK_PORT:-HDMI-2}"
if [ -x /usr/local/bin/djbooth-touch-map.sh ]; then
  echo "$(date): unfreeze: re-mapping touchscreen to $KIOSK_TARGET"
  KIOSK_OUTPUT="$KIOSK_TARGET" /usr/local/bin/djbooth-touch-map.sh manual 2>/dev/null
fi

echo "$(date): unfreeze: done"
