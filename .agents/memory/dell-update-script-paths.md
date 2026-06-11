---
name: Dell unit update scripts — which is which
description: The repo file named djbooth-update.sh is NOT what runs on units; homebase-skip env var.
---

# Two different "update" scripts — don't confuse them

In `artifacts/dj-booth/public/public/`:
- `djbooth-update.sh` (repo copy) pulls from the **Replit CLOUD deploy** (`/api/update-bundle`). The Replit deployment is broken (platform 404), so this copy is effectively dead.
- `djbooth-update-github.sh` is the real one: pulls from **homebase first, then GitHub fallback**, self-updates from GitHub before any destructive step, auto-rolls back on failure.

**Critical:** on the units, the installed `~/djbooth-update.sh` is actually the **GitHub** script (first-time setup curls `djbooth-update-github.sh` and saves it to that name). So `~/djbooth-update.sh` on a unit == the github updater, even though the repo file with that name is the cloud one. Confirm on a unit with `grep GITHUB_REPO ~/djbooth-update.sh` (present == github updater).

## Skip homebase, pull straight from GitHub
Set `DJBOOTH_SKIP_HOMEBASE=1`. The github updater checks `[ "$DJBOOTH_SKIP_HOMEBASE" != "1" ]` before trying homebase. Bare command (when the user is already SSH'd into the unit):
```
DJBOOTH_SKIP_HOMEBASE=1 bash ~/djbooth-update.sh
```
Watch for a "Downloading from GitHub" line (not "Trying homebase") + "Update complete".

**How to apply:** when the user asks to update a unit "skipping homebase", give the bare `DJBOOTH_SKIP_HOMEBASE=1` form. For a normal update it's just `bash ~/djbooth-update.sh`.
