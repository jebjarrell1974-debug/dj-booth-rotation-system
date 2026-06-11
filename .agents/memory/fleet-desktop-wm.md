---
name: Fleet desktop window manager (Openbox vs GNOME)
description: Which WM each unit runs and why it matters for the freeze bug.
---

# Fleet desktop WM state

As of **June 2026**: **both 002 and 003 run Openbox** (minimal WM). GNOME has been **removed from 003** —
the GNOME→Openbox migration that was the freeze fix is **DONE on 003**, not pending. Do not treat the
003 Openbox switch as outstanding work.

**Why it matters:** `gnome-shell` grabs X input on multi-touch gestures, which freezes mouse + touch
(music keeps playing because audio is a separate pipeline — that's the tell it's the desktop layer,
not hardware). Openbox has no gesture handling to grab input, so it doesn't freeze. That's why 002 was
always clean and why 003 was migrated.

If a unit ever freezes again, first confirm the WM with `DISPLAY=:0 wmctrl -m` — it should say
**Openbox**, not GNOME Shell. If it says GNOME Shell, the migration regressed on that unit.
