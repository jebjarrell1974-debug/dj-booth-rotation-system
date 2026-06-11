---
name: LOW CACHE RATE alert is benign (not a music wipe)
description: The "📉 LOW CACHE RATE / pre-pick misses" Telegram alert is a cold-cache artifact, NOT music loss — how to reassure the user.
---

# "LOW CACHE RATE / N% pre-pick misses" is NOT a music wipe

The Telegram alert `📉 LOW CACHE RATE … N% pre-pick misses (X/Y) … Dead air risk is elevated` measures the booth's **pre-pick cache hit/miss ratio**, nothing about songs on disk.

- A **pre-pick "miss"** = the background pre-pick wasn't ready in time, so the booth fell back to a live library query (`getDancerTracks`) — which **still returns tracks and still plays music**. A miss therefore *proves the library is present and responding*, the opposite of a wipe.
- The alert only fires when `totalPicks >= 5`, the session is >5 min past start (warmup done), and `missRate > 0.5`.

**Why it spikes right after an update/reboot:** the pre-pick cache starts **cold/empty**, and early-night rotation hasn't warmed it, so the first several transitions are misses by nature. It self-resolves as the night goes on. A value like 12/22 (55%) just barely trips the 50% line.

**Why:** the user was previously burned by a real music wipe (failed-update rollback — see `update-rollback-data-loss.md`), so they reflexively read ANY scary alert as "it wiped the music again." This alert is unrelated.

**How to apply:** if the user panics about LOW CACHE RATE, reassure it's benign + self-healing. The real music-loss signals are a `🔇 DEAD AIR` watchdog alert and/or an R2 re-download kicking off — neither of which this alert implies. Positive check (user SSH'd on the unit): `find ~/djbooth/music -type f \( -iname '*.mp3' -o -iname '*.m4a' -o -iname '*.flac' -o -iname '*.wav' \) | wc -l` should print tens of thousands.
