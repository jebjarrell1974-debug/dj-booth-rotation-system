---
name: SiW touch autosuspend udev rule product-ID mismatch
description: The fleet touch-power udev rule targets the wrong USB product ID for 003's actual SiW panel, so it never matches.
---

# SiW touch autosuspend rule does not match 003's panel

On 003 the live Siliconworks SiW touch controller enumerates as USB **vendor 1fd2 / product b101**
(verified 2026-06-07 via `/sys/bus/usb/devices/*/idProduct`). But `97-djbooth-touch-power.rules`
pins `ATTR{idProduct}=="9101"` — so the autosuspend-disable rule **has never matched 003's actual hardware**.
replit.md's stated SiW id of `1fd2:9101` is therefore wrong/incomplete for 003 (the panel reports `b101`).

**Why it matters:** the rule is supposed to force `power/control=on` on every USB (re)connect so power-saving
can't suspend the touch controller. Because the product ID is wrong, on a reconnect the rule won't fire and
`control` could fall back to `auto`. Tonight it happened to read `control=on` anyway (kernel/default), so
autosuspend was NOT the cause of the 22:50 dropout — that was a genuine USB re-enumeration of the controller.

**How to apply:** if 003 touch drops keep happening AND a reconnect ever shows `control=auto`, fix the rule to
also cover `b101` (e.g. add a second rule line or broaden to match vendor 1fd2 across the relevant products),
then `sudo udevadm control --reload && sudo udevadm trigger`. The realistic recurring mitigation remains the
touch-watchdog (recovers within ~3 min once the device reappears). Hardware-level cause = USB re-enumeration;
reseat/replace the USB cable and try a powered/rear USB port if drops continue. Confirm live product ID first —
never assume 9101.
