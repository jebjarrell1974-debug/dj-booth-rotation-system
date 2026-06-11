---
name: Switching the ElevenLabs voice on a unit
description: Why changing the booth voice ID can produce silence, and the correct full procedure.
---

# Switching the ElevenLabs voice on a booth unit

Changing the voice the booth speaks in is a **per-unit config change**, NOT a code/deploy:
booth Options/Configuration → "ElevenLabs Voice ID" field (stored in that unit's browser
localStorage, key `elevenLabsVoiceId`). Blank falls back to built-in default
`21m00Tcm4TlvDq8ikWAM` (a female voice, guaranteed to work — good for proving the pipeline).

## Two gotchas that cause "I set the voice but hear nothing"

1. **The cache key does NOT include the voice ID.** Cached voiceovers keep playing in the OLD
   voice after you change the ID — only never-cached announcements use the new voice. To flip
   everything, use **Configuration → "Clear All Voiceovers"** (UI button; hits
   `DELETE /api/voiceovers` → `clearAllVoiceovers`, wipes DB rows + files). After clearing,
   every announcement regenerates fresh in the new voice.

2. **The booth generates with model `eleven_v3`** (AnnouncementSystem.jsx `generateAudio`).
   A voice will produce SILENCE (400 from ElevenLabs, surfaced as a toast) unless it is BOTH:
   (a) added to the account's **My Voices** (a Voice Library voice you only copied the ID of is
   NOT usable — must click "Add to my voices"), AND (b) **enabled/compatible with Eleven v3**
   (the "v3 / v3 enhance" support on the voice). A library/female voice that isn't v3-enabled
   fails even after adding. Confirmed live June 2026: the chosen female voice only worked once
   it was enabled for v3.

## Fleet contamination via R2

Voiceover filenames are derived from the cache key and **do not include the voice ID**, and
voiceovers sync fleet-wide through R2. So once one unit regenerates in a new voice, those files
overwrite the shared R2 copies and OTHER units pull the new voice on their next R2 sync.
**You cannot keep two units on different voices** without a code change to namespace voiceover
cache keys by voice/device. If a unit must stay on the old voice, handle the R2 side first.

## Fastest debug order when a new voice is silent
1. Blank the voice ID field → default voice → if it plays, pipeline is fine and the chosen
   voice ID is the problem (not key, not cache).
2. Verify the voice is in My Voices AND supports Eleven v3 on elevenlabs.io.
