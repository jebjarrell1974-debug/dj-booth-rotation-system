---
name: Commercial audio ownership
description: Keep ad playback completion separate from entertainer track completion and automatic selection.
---

Ad backing-track completion is not voiceover completion. Clean up only media owned by the ad session, before returning control to the next entertainer; cancelling an ad must also cancel its delayed voice start.

**Why:** A short backing track can end before speech, and unfinished bed audio can sound like an entertainer's first song. Late cleanup can instead stop the new song.

**How to apply:** Keep separate completion rules for premixed ads versus bed-plus-voice ads. Exclude Promo Beds and Promos before automatic selection limits, including fallback queries, while preserving intentional manual and promo access.

Premixed ads must complete at physical media end, not the music deck's advance-transition signal. A due ad must precede the incoming entertainer's first audio, including feature arrivals.

**Why:** Ordinary music intentionally signals completion early for overlap; reusing that signal cuts ads short. Starting an entertainer before owned ad cleanup stops and restarts their first song.

**How to apply:** Keep early transition signals for regular music only. Announcement replacement must settle the previous wait and release only its own duck owner.

Legacy ad endings need a single owner of the backing-track fade, with cleanup tied to the exact playback generation rather than the current player.

**Why:** An ordinary safety fade can race a post-speech fade, and broad cleanup can stop replacement music even when the fade itself checks ownership.

**How to apply:** Check both fade and cleanup ownership; test replacement playback and cancellation as well as natural completion. Do not change master volume or another announcement's ducking.