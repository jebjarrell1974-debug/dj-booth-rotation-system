---
name: Feature placement uses circular play-order
description: Why feature-entertainer slot placement re-seats the current dancer to index 0 and walks the rotation circularly, and the invariant the panel + booth must share.
---

# Feature placement is circular, by play position (not absolute array index)

When the DJ places a feature entertainer into the upcoming line-up, placement is by
**1-based PLAY POSITION** (`pos`, where `1` = next on stage), NOT by absolute array
index.

**The rule:** the booth's rotation is circular — play order runs from the current
dancer forward and wraps to index 0 (the crowd display already renders it that way
with `(currentIndex + i) % len`). So feature placement:
1. builds the upcoming order = everyone EXCEPT the current dancer, starting right
   after her and wrapping, then
2. splices the feature in at `pos`, then
3. **re-seats the current dancer to array index 0** and sets `currentDancerIndex = 0`
   so the stored `rotation_order` array literally matches play order.

**Why:** an earlier linear model (splice at `currentDancerIndex + 1`, enumerate
`curIdx+1..end`) silently misplaced the feature whenever the current dancer was NOT
at array index 0 — e.g. after a manual reorder or a resume. "Next on stage" would
drop her at the array tail and she'd play a full cycle later. In steady state the
flip re-seats current near 0 so the bug was latent, but it is a real correctness
hole for the one interaction this whole feature exists for.

**How to apply / invariant:** the placement UI (`FeatureEntertainerPanel.jsx`
`slotOptions`) and the booth (`DJBooth.jsx` `placeFeatureAtSlot`) MUST use the SAME
circular model and the SAME `pos` meaning. If you ever change one (slot labels, the
estimate math, what `pos=1` means), change the other in lockstep or "Next on stage"
silently lies again. Both currently: compute `baseIdx = indexOf(currentDancer)` in
the feature-filtered array, then walk `k = 1 .. n-1` with `(baseIdx + k) % n`.
