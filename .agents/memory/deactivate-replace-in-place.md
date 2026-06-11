---
name: Deactivate = replace-in-place, never counts
description: The invariant for song "deactivate" in DJBooth — what it must always do, on both booth and remote paths.
---

# Deactivating a song must replace-in-place, never count, never end the set early

Deactivating the currently-playing song (booth PIN box OR remote/phone control) must ALWAYS:
1. Block it server-side (`/api/music/block`).
2. Remove it from every pre-picked rotation set so the cache can't replay it.
3. Play a FRESH song in the SAME slot — pick a brand-new track for the current entertainer's
   playing slot, substitute it in place (do NOT compact/shift the current dancer's array, or the
   target slot drifts), keep the rest of her queue intact.
4. NOT advance her song count (decrement currentSongNumber by 1, then handleSkip re-increments).
5. NEVER end her set early — if no replacement can be secured AND the slot is empty (only when the
   library returns nothing), play a fallback track instead of letting handleSkip fall into the
   end-of-set branch.

**Why:** the booth and remote paths used to diverge — booth decremented+replaced, remote did NOT,
so a remote deactivate counted against the entertainer and jumped to her next song. Both now share
one helper so behavior is identical. Earlier "only replace when slot empty" + array `filter`
compaction were bugs (first/middle deactivations weren't truly refreshed; filter reindex could
shift the replacement out of its slot).

**How to apply:** keep the single shared helper (`deactivateAndReplace`, exposed via a ref so the
remote command handler avoids stale closures) as the ONE place this logic lives. Slot index =
currentSongNumber - 1. Never touch the LOCKED AudioEngine.jsx — all logic is caller-side in
DJBooth.jsx. Safe for protected unit 003: only runs on an explicit deactivate tap, no change to
auto-rotation.
