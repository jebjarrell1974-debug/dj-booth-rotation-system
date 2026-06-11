---
name: Config precedence (stored vs env) + always-mounted clobber rule
description: Why the ElevenLabs Voice ID (and any UI-editable setting) kept reverting, and the two rules that fix it.
---

# Settings precedence + the always-mounted re-save trap

Two independent bugs made the ElevenLabs Voice ID field "un-editable" on units — it
kept reverting to a fleet-pushed value. Both classes apply to ANY UI-editable setting,
not just the voice ID.

## Rule 1 — stored UI value WINS over env; env is only a seed
`GET /api/config/defaults` (api-server `server/index.js`) must let DB-stored client
settings take priority, with `process.env.*` used ONLY to seed keys that have never
been set in the UI. The original code did the reverse (env won), so a unit whose
`.env` carried a value could never be overridden from the Configuration screen.

**Why:** voice/keys are configured per-unit in the UI and persisted to that unit's DB;
env is a bootstrap convenience, not the source of truth.
**How to apply:** when adding any settable field, populate `defaults` from stored first,
then `if (!defaults.x && process.env.X) defaults.x = process.env.X`. Never the reverse.

## Rule 2 — an always-mounted component must only SAVE what it actually EDITS
The booth view (`DJBooth.jsx`) is persistently mounted. It loaded the full API config
at mount and re-saved ALL of it on a debounced effect — so it silently overwrote edits
made on the Configuration screen (voice ID, keys, script model) with the stale values
it had read at startup. The only field the booth itself edits is the announcements
on/off toggle, so it must save ONLY `{ announcementsEnabled }`.

**Why:** a component that re-saves config it merely read will clobber every other
editor of that config. This is a general hazard for any long-lived/global component.
**How to apply:** a component's save payload must be the INTERSECTION of (fields it
renders an editor for). Loading a field ≠ owning it. If you add an editable control to
the booth, add only that key to the save payload.

## Rule 3 — voice ID is per-unit, NOT fleet-synced
Removed `ELEVENLABS_VOICE_ID` from homebase's `/api/fleet-env` `FLEET_KEYS` and from the
update script's `KEYS_TO_CHECK`. Homebase pushing a central voice ID re-seeded the wrong
voice onto every unit. Existing units keep whatever is already in their `.env`, but with
Rule 1 the UI/DB value wins anyway, so a stale `.env` voice ID is now harmless.
**How to apply:** keys that are meant to be chosen per-unit must NOT live in the fleet-env
whitelist; only truly fleet-wide secrets (API keys, R2, Telegram) belong there.

## Deploy note
After deploying these, the operator sets the desired voice ID in the UI ONCE per unit;
from then on it persists (DB-stored wins, booth no longer clobbers, fleet no longer
re-seeds). A unit's pre-existing `.env` voice ID does not need to be removed by hand.
