#!/bin/bash
# djbooth-touch-map.sh — robust ILITEK touchscreen → kiosk monitor mapper.
#
# Maps the touchscreen to the kiosk monitor's xrandr output so touches register
# on the correct physical screen. Idempotent and safe to call repeatedly from
# multiple triggers (kiosk launcher, GNOME autostart, udev hotplug).
#
# CRITICAL DESIGN NOTE: maps by xinput device ID, NOT by name.
# `xinput map-to-output "ILITEK ILITEK-TP" HDMI-2` has been observed to fail
# with "unable to find device" even when `xinput list` clearly lists the
# device with that exact name (xinput name-resolution bug — confirmed live on
# unit 003, Apr 2026). Mapping by numeric ID always works.
#
# Usage: djbooth-touch-map.sh [trigger-label]
#   trigger-label is logged for diagnostics (e.g. kiosk-launch, autostart, udev-input).
#
# Env overrides:
#   KIOSK_OUTPUT   — preferred xrandr output (default HDMI-2; falls back to first
#                    non-rotated connected output, then first connected)
#   TOUCH_PATTERN  — case-insensitive xinput name match (default ILITEK)
#   MAX_WAIT_X     — seconds to wait for X11 to be ready (default 60)
#   MAX_WAIT_DEV   — seconds to wait for touchscreen to appear (default 30)
#
# Exit codes:
#   0  success
#   1  X11 never became ready
#   2  touchscreen device never appeared
#   3  no connected outputs
#   4  could not extract device IDs
#   5  one or more map-to-output calls failed

set -uo pipefail

LOG="/tmp/djbooth-touch.log"
KIOSK_OUTPUT="${KIOSK_OUTPUT:-HDMI-2}"
TOUCH_PATTERN="${TOUCH_PATTERN:-ILITEK}"
MAX_WAIT_X="${MAX_WAIT_X:-60}"
MAX_WAIT_DEV="${MAX_WAIT_DEV:-30}"
TRIGGER="${1:-manual}"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [$$] [$TRIGGER] $*" >> "$LOG" 2>/dev/null || true
}

export DISPLAY="${DISPLAY:-:0}"
if [ -z "${XAUTHORITY:-}" ] && [ -n "${HOME:-}" ] && [ -f "$HOME/.Xauthority" ]; then
  export XAUTHORITY="$HOME/.Xauthority"
fi

log "=== START (DISPLAY=$DISPLAY XAUTHORITY=${XAUTHORITY:-unset} USER=$(whoami)) ==="

# --- Wait for X11 to be ready ----------------------------------------------
WAITED=0
while ! xrandr --query >/dev/null 2>&1; do
  if [ $WAITED -ge $MAX_WAIT_X ]; then
    log "ERROR: X11 not ready after ${MAX_WAIT_X}s — exiting"
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
log "X11 ready (waited ${WAITED}s)"

# --- Wait for touchscreen device(s) to appear in xinput --------------------
WAITED=0
while ! xinput list 2>/dev/null | grep -qi "$TOUCH_PATTERN"; do
  if [ $WAITED -ge $MAX_WAIT_DEV ]; then
    log "ERROR: No '$TOUCH_PATTERN' device found in xinput after ${MAX_WAIT_DEV}s"
    log "xinput list output for diagnostics:"
    xinput list 2>&1 | sed 's/^/  /' >> "$LOG"
    exit 2
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
log "'$TOUCH_PATTERN' device(s) detected (waited ${WAITED}s)"

# --- Auto-detect target output ---------------------------------------------
detect_output() {
  local connected
  connected=$(xrandr --query 2>/dev/null | awk '/ connected/ {print $1}')

  # 1. Use configured KIOSK_OUTPUT if currently connected
  if echo "$connected" | grep -qx "$KIOSK_OUTPUT"; then
    echo "$KIOSK_OUTPUT"
    return
  fi

  # 2. First connected output that is NOT rotated (rotated = crowd display by convention)
  while IFS= read -r out; do
    [ -z "$out" ] && continue
    if ! xrandr --query 2>/dev/null | grep -E "^$out connected" | grep -qE " (left|right|inverted)( |$)"; then
      echo "$out"
      return
    fi
  done <<< "$connected"

  # 3. First connected output (last resort)
  echo "$connected" | head -1
}

OUTPUT=$(detect_output)
if [ -z "$OUTPUT" ]; then
  log "ERROR: No connected outputs detected"
  exit 3
fi
log "Target output: $OUTPUT"

# --- Get all matching device IDs (touch + mouse subsystem both need mapping) -
DEVICE_IDS=$(xinput list 2>/dev/null \
  | grep -i "$TOUCH_PATTERN" \
  | grep -oE 'id=[0-9]+' \
  | grep -oE '[0-9]+')

if [ -z "$DEVICE_IDS" ]; then
  log "ERROR: Could not extract device IDs from xinput list"
  exit 4
fi

# --- Map by ID (NAME-based map-to-output is unreliable on this xinput build) -
SUCCESS=0
FAIL=0
for DEV_ID in $DEVICE_IDS; do
  DEV_NAME=$(xinput list --name-only "$DEV_ID" 2>/dev/null || echo "<unknown>")
  if xinput map-to-output "$DEV_ID" "$OUTPUT" 2>>"$LOG"; then
    log "  mapped id=$DEV_ID ($DEV_NAME) -> $OUTPUT"
    SUCCESS=$((SUCCESS + 1))
  else
    log "  FAIL  id=$DEV_ID ($DEV_NAME) -> $OUTPUT"
    FAIL=$((FAIL + 1))
  fi
done

# --- Verify by reading the Coordinate Transformation Matrix back -----------
for DEV_ID in $DEVICE_IDS; do
  MATRIX=$(xinput list-props "$DEV_ID" 2>/dev/null \
    | grep -i "Coordinate Transformation Matrix" \
    | head -1 \
    | sed 's/^[[:space:]]*//')
  log "  verify id=$DEV_ID: ${MATRIX:-<no matrix property>}"
done

log "=== END (success=$SUCCESS fail=$FAIL output=$OUTPUT) ==="

[ $FAIL -gt 0 ] && exit 5
exit 0
