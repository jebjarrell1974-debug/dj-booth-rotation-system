---
name: Rotation name→track resolve-loop invariant
description: Why DJBooth song-save loops must never drop an unresolved song name
---

# Rotation resolve loops must NEVER drop an unresolved song name

In `artifacts/dj-booth/src/pages/DJBooth.jsx`, any loop that converts a song
**name** into a playable track object (via `tracks.find(...)` then
`resolveTrackByName(...)`) MUST keep the DJ's pick even when both lookups miss —
push a name-only entry `{ name, path: name }` instead of discarding it.

**Why:** `tracks` is a capped cache (refreshTracks uses `?limit=100`) and large
libraries / quirky names (apostrophes, dashes, extensions) often miss both the
cache and the server lookup at save time. The old code did `if (track) resolved.push(track)`
with no `else`, which silently shortened the dancer's set, so the edited song
never played and the set could be cut early. This was the #1 user-reported
functional bug ("rotation edits must play exactly what the DJ set").

**How to apply:** Playback is safe with name-only entries because
`handleTrackEnd` gates on `dancerSongCount = dancerTracks.length` (counts
name-only entries) and re-resolves a name-only `nextTrack` via
`resolveTrackByName` just before playing, upgrading it in place. So a name-only
placeholder is the correct, playable fallback. If you ever add a THIRD
name→track resolve loop, apply the same no-drop rule. Empty/blank names are
intentionally still dropped (`else if (name)`).
