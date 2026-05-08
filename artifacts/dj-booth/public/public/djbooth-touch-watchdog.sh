#!/bin/bash
# djbooth-touch-watchdog.sh — preventive X11 touch-input recovery.
#
# THE PROBLEM
# -----------
# Touchscreens on the kiosk freeze regularly (every shift, since day one).
# Symptom: touches do nothing; mouse still works; reboot fixes it temporarily.
# Root cause: gnome-shell / mutter holds a stuck X11 input grab on the
# touchscreen device. The kernel still receives events on /dev/input/eventN
# but X never delivers them to Chromium. `killall -HUP gnome-shell` sometimes
# clears it but is heavy-handed and visible to the user.
#
# THE FIX
# -------
# Cycle the touchscreen device through xinput on a tight cadence:
#   xinput --disable <id>; sleep 0.5; xinput --enable <id>
# This forcibly drops and re-establishes any X grab on JUST that device.
# Music keeps playing, GUI doesn't flicker, ~500ms invisible blip.
# If a dancer happens to be mid-touch, she taps again — same as today.
#
# Vendor-agnostic detection: any device with the "Abs MT Position X" property
# is a touchscreen (ILITEK, Weida, Goodix, eGalax, generic HID — every brand).
# Same detection used by the canonical /usr/local/bin/djbooth-touch-map.sh.
#
# Env overrides:
#   INTERVAL_SEC   — seconds between cycles (default 180 = 3 min)
#   LOG_FILE       — log path (default /tmp/djbooth-touch-watchdog.log)
#   BOOT_GUARD_SEC — wait this long after boot before first cycle (default 120)
#   TOUCH_PATTERN  — case-insensitive xinput name match (legacy escape hatch)

set -uo pipefail

INTERVAL_SEC="${INTERVAL_SEC:-180}"
LOG_FILE="${LOG_FILE:-/tmp/djbooth-touch-watchdog.log}"
BOOT_GUARD_SEC="${BOOT_GUARD_SEC:-120}"
TOUCH_PATTERN="${TOUCH_PATTERN:-}"

export DISPLAY="${DISPLAY:-:0}"
if [ -z "${XAUTHORITY:-}" ] && [ -n "${HOME:-}" ] && [ -f "$HOME/.Xauthority" ]; then
  export XAUTHORITY="$HOME/.Xauthority"
fi

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [$$] $*" >> "$LOG_FILE" 2>/dev/null || true
}

# Boot guard — let the X session, GNOME autostart, and touch-map script settle
# before we start poking input devices. Mirrors djbooth-watchdog.sh pattern.
UPTIME_SEC=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 999)
if [ "$UPTIME_SEC" -lt "$BOOT_GUARD_SEC" ]; then
  WAIT=$((BOOT_GUARD_SEC - UPTIME_SEC))
  log "Boot guard — waiting ${WAIT}s for autostart to complete"
  sleep "$WAIT"
fi

log "=== START (interval=${INTERVAL_SEC}s display=$DISPLAY user=$(whoami)) ==="

# Safety net: if the script exits between --disable and --enable (SIGTERM
# from systemctl restart, SIGINT, crash, etc) the touchscreen stays dead
# until next service start. Track the currently-disabled device and force
# re-enable on any exit signal.
CURRENTLY_DISABLED=""
on_exit() {
  if [ -n "$CURRENTLY_DISABLED" ]; then
    log "EXIT TRAP — re-enabling id=$CURRENTLY_DISABLED before exit"
    xinput --enable "$CURRENTLY_DISABLED" 2>>"$LOG_FILE" || true
  fi
  log "=== EXIT ==="
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Touchscreen detection — robust against modern libinput drivers that no longer
# expose the legacy "Abs MT Position X" evdev property. Confirmed empirically
# on Debian 13 / kernel 6.12 / ILITEK ILITEK-TP: that property is absent and
# property-only detection returns ZERO devices.
#
# Detection layers (first match wins per device):
#   1. TOUCH_PATTERN env var      — explicit name match (escape hatch)
#   2. Known touchscreen vendors  — ILITEK, Goodix, Weida, eGalax, ELAN,
#                                    FocalTech, Wacom, Atmel maXTouch,
#                                    HID-multitouch, generic "TouchScreen"
#   3. Legacy MT property check   — "Abs MT Position X" (older systems)
#
# We DELIBERATELY exclude devices whose name contains Mouse/Pointer/Trackpad/
# Touchpad. Vendor mouse-emulation interfaces (e.g. "ILITEK ILITEK-TP Mouse"
# id=13 alongside "ILITEK ILITEK-TP" id=19) share the touch hardware but
# disabling them would kill the mouse cursor fallback used to recover the
# kiosk when touch is broken — which is exactly when we need that fallback.
find_touch_ids() {
  local ids="" id pointer_ids name

  if [ -n "$TOUCH_PATTERN" ]; then
    ids=$(xinput list 2>/dev/null \
      | grep -i "$TOUCH_PATTERN" \
      | grep -oE 'id=[0-9]+' \
      | grep -oE '[0-9]+')
    echo "$ids" | tr -s ' ' '\n' | grep -v '^$'
    return
  fi

  pointer_ids=$(xinput list 2>/dev/null \
    | grep -E 'slave[[:space:]]+pointer' \
    | grep -oE 'id=[0-9]+' \
    | grep -oE '[0-9]+')

  for id in $pointer_ids; do
    name=$(xinput list --name-only "$id" 2>/dev/null)
    # Skip mouse-emulation / pointer / trackpad interfaces — protects mouse fallback.
    echo "$name" | grep -iqE 'Mouse|Pointer|Trackpad|Touchpad' && continue
    # Layer 2: known touchscreen vendor name patterns
    if echo "$name" | grep -iqE 'ILITEK|Goodix|Weida|eGalax|ELAN|FocalTech|Wacom|Atmel.*maXTouch|HID-multitouch|TouchScreen|Touch[[:space:]]*Screen'; then
      ids="$ids $id"
      continue
    fi
    # Layer 3: legacy MT property fallback
    if xinput list-props "$id" 2>/dev/null | grep -q "Abs MT Position X"; then
      ids="$ids $id"
    fi
  done

  echo "$ids" | tr -s ' ' '\n' | grep -v '^$'
}

cycle_device() {
  local dev_id="$1"
  local dev_name
  dev_name=$(xinput list --name-only "$dev_id" 2>/dev/null || echo "<unknown>")

  if ! xinput --disable "$dev_id" 2>>"$LOG_FILE"; then
    log "  FAIL  disable id=$dev_id ($dev_name)"
    return 1
  fi
  CURRENTLY_DISABLED="$dev_id"
  sleep 0.5
  # Tight retry loop on enable — the device MUST come back, even if it takes
  # multiple attempts. Don't let it sit disabled until the next 180s tick.
  local attempt
  for attempt in 1 2 3 4 5; do
    if xinput --enable "$dev_id" 2>>"$LOG_FILE"; then
      CURRENTLY_DISABLED=""
      [ "$attempt" -gt 1 ] && log "  ok    cycled id=$dev_id ($dev_name) [enable took $attempt attempts]" \
                          || log "  ok    cycled id=$dev_id ($dev_name)"
      return 0
    fi
    sleep 1
  done
  log "  CRIT  enable id=$dev_id ($dev_name) failed 5x — device may be disabled until next cycle"
  return 1
}

# Wait for X11 to be ready before the main loop (handles cold-boot race).
WAITED=0
while ! xrandr --query >/dev/null 2>&1; do
  if [ $WAITED -ge 60 ]; then
    log "WARN: X11 not ready after 60s — entering main loop anyway"
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done

while true; do
  DEVICE_IDS=$(find_touch_ids | tr '\n' ' ' | sed 's/[[:space:]]*$//')

  if [ -z "$DEVICE_IDS" ]; then
    log "no touchscreen devices detected — skipping cycle"
  else
    log "cycling devices: $DEVICE_IDS"
    for DEV_ID in $DEVICE_IDS; do
      cycle_device "$DEV_ID"
    done
  fi

  # Trim log if it gets large (>5MB) — keep last 2000 lines
  if [ -f "$LOG_FILE" ]; then
    SIZE=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$SIZE" -gt 5242880 ]; then
      tail -n 2000 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
    fi
  fi

  sleep "$INTERVAL_SEC"
done
