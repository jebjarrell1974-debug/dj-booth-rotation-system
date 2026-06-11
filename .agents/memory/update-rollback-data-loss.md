---
name: Update rollback data loss (backup-skip vs rollback-preserve)
description: Why a failed Pi update kept wiping the entire music library, and the invariant that prevents it.
---

# Update rollback must preserve what the backup excluded

**Rule:** When a backup/snapshot step deliberately EXCLUDES large directories (e.g.
music, voiceovers, node_modules) to keep the backup small, any rollback/restore that
does `rm -rf <app_dir>` followed by `mv <backup> <app_dir>` MUST first carry those
excluded directories across into the backup — and must be FAIL-CLOSED: if an excluded
dir cannot be moved to safety, ABORT the destructive `rm` and leave the live install
fully intact (reverting any partial moves).

**Why:** On the NEON AI DJ Dell units, the updater backed up everything except
music/voiceovers/node_modules (too large). On a failed-to-start update it ran
`rm -rf "$APP_DIR"; mv "$BACKUP_DIR" "$APP_DIR"` — deleting the live ~25,000-song music
library (plus voiceovers/node_modules) and restoring a backup that never had them,
forcing a multi-hour full re-download from cloud (R2). It recurred whenever an update
failed to start (e.g. a missing npm package crash) and burned the user repeatedly. It
masqueraded as power/drive/reboot/filesystem-corruption problems; the giveaways were
that the app's own delete counter showed `0 purged` and the files vanished off a
RUNNING machine with no reboot, on a single root partition (not a droppable mount).

**How to apply:** Whenever you see a backup/exclude list, find the matching
restore/rollback path and confirm it preserves the same excluded paths. Mirror every
backup-skip list with a rollback-preserve list. Never let a destructive `rm` of the
app dir run while any large excluded dir is unaccounted for. Prefer same-filesystem
`mv` (atomic rename) for the carry-across. Also note: these update scripts self-update
from GitHub and re-exec before the rollback runs, so a fix on the source path takes
effect on each unit's next update automatically — no dist rebuild (the dist copy of
the shell script is never executed).

**Diagnosing a recurrence — the symptom is NOT the cause.** A unit re-downloading the
whole library (300 GB+) from R2 on boot looks like an R2/sync problem. It is not. The
R2 music sync (`syncMusicFromR2` in `r2sync.js`) is INCREMENTAL — it skips any local
file whose size matches R2, so a normal reboot with intact music downloads ~nothing.
A full re-pull means the local music folder was EMPTIED. The only thing that empties
it is the rollback wipe above. So when you see a 300 GB boot re-download, do not chase
the sync code — find what deleted `~/djbooth/music`. (The same `syncMusicFromR2` also
has a purge that deletes local files absent from R2, but it is gated: it skips purging
if R2 has >20% fewer non-promo files than local, and never purges `Promos/`. Purge is
not the 300 GB culprit — a full wipe is the rollback.)

**Why it kept recurring on ONE unit (003, three times):** the fix lives in the script,
but a unit whose auto-update is DISABLED stays frozen on the OLD buggy script and
re-wipes music on EVERY failed update — indefinitely — until the script is manually
replaced (curl the GitHub-raw updater over `~/djbooth-update.sh`; see
stale-self-updating-updater.md). So the data-loss bug + the stale-updater bug compound:
disabling auto-update to "protect" a unit actually leaves it exposed to the wipe. After
manually installing the current (fail-closed) script, a future failed update aborts the
rollback instead of deleting music. Confirm the current script is present before trusting
a unit: the rollback block must MOVE music/voiceovers/node_modules into the backup dir
and abort-without-rm if any can't be moved.
