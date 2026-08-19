---
name: POS integration
description: LAN webhook receivers that let a venue POS drive rotation/VIP/checkout
---
POS endpoints live in the api-server under `/api/pos/*` (checkin, vip-start, vip-end, checkout, entertainers, health), authed by `X-API-Key` = setting `pos_api_key` (auto-generated at boot; shown/rotated in DJ Options → POS Integration; DJ-authed `/api/pos/key`).

**How it works:** signals are translated into the existing booth remote-command queue (addDancerToRotation / sendToVip / releaseFromVip / removeDancerFromRotation) — the booth reacts exactly like a DJ remote tap. VIP from POS uses a 12h duration; POS vip-end releases.

**Invariants (don't regress):**
- POS signals must stay idempotent: `sendToVip` payload `skipIfActive` (no additive time on retry), `releaseFromVip` payload `onlyIfVip` (no rotation duplicate on retry); `releaseDancerFromVip` also guards duplicate rotation append.
- Checkout = releaseFromVip(onlyIfVip) THEN removeDancerFromRotation, in that order (clears VIP timer so expiry can't re-add her).
- vip-start for the on-stage girl goes PENDING until her set ends (never cuts a set) — documented to the POS company in POS-INTEGRATION.md at repo root.
- Key comparison is timing-safe (sha256 + timingSafeEqual); keep it that way.

**External-demo boundary:** POS vendors never receive a live venue screen, real
performer/music/venue data, or a visual clone of the booth. The hosted sandbox's
`/api/pos/demo` is intentionally a separate generic SignalFlow event simulator
using only its fixed fake roster and in-memory state.

**Why:** operator explicitly approved a POS demonstration but does not trust a
third party with the proprietary booth experience or operational data.
