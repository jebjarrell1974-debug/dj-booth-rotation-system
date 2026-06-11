---
name: 002 touchscreen recovery + actual panel identity
description: 002's real touch device, and the two-step recovery when touch breaks after a monitor power-cycle.
---

# 002 touch recovery (and which panel it actually is)

## The panel on 002 is NOT what replit.md says
As of **June 2026**, 002's live touch device is **`Siliconworks SiW HID Touch Controller`**
(xinput id drifts across reboots — was **id=19** this incident). This CONTRADICTS the replit.md
note that calls 002 a "Weida Hi-Tech CoolTouchR" (vendor 2575/0401) and 003 the SiW. Either the
panels were swapped or the note was always wrong.

**Lesson: do NOT auto-detect the touch device by a hardcoded vendor/name.** A `grep -i cooltouchr`
detector returned EMPTY on 002 and wasted a round-trip. Always pull ground truth first:
```
DISPLAY=:0 xinput list
```
and read the actual touch device name + id from the output. Don't assume from replit.md.

## Symptom: monitor accidentally powered off then on → touch broken, mouse fine
Power-cycling the kiosk monitor resets the touchscreen's output mapping (Coordinate Transformation
Matrix). Mouse is unaffected. Two-step recovery:

1. **Kiosk "Rotation Screen" button** (top bar) brings touch back — BUT it leaves touch spanning
   BOTH monitors, so taps land badly offset (operator reported ~3 inches left / ~2 inches down,
   scaled across the whole virtual desktop).
2. **Pin touch to the kiosk monitor** to fix the offset. Get the real id from `xinput list`, then:
   ```
   DISPLAY=:0 xinput map-to-output <id> HDMI-2
   ```
   (HDMI-2 = kiosk monitor on 002. If `unable to find output HDMI-2`, the power-cycle renamed
   outputs — run `DISPLAY=:0 xrandr | grep " connected"` to get the current kiosk output name.)
   Tap lands dead-on after this.

## Why it didn't self-heal (and the fix that landed)
The touch-watchdog (`djbooth-touch-watchdog.sh`, re-maps every 180s) recognizes SiW by name, so it
SHOULD have auto-fixed this — it didn't, consistent with the replit.md note that **002 had been
found WITHOUT the watchdog installed**. **RESOLVED June 6, 2026:** the GitHub update run on 002
installed it — the log showed `Touch watchdog installed/refreshed (cycles every 180s)` plus
`USB autosuspend disabled for Siliconworks SiW touch controller` (the SiW power rule now matches
002's actual panel). So 002's touch now self-heals every 180s. If 002 ever needs manual remaps
again, verify it's still there (`systemctl list-unit-files | grep djbooth`) and reinstall if missing.
