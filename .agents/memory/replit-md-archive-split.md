---
name: replit.md trimmed into replit.md + replit-archive.md
description: replit.md was split on Jun 07 2026 — operational core stays in replit.md, verbatim history/TODO forensics moved to replit-archive.md. No facts were lost.
---

# replit.md is now split into two files

On Jun 07, 2026 the user (frustrated by the wall of text) explicitly authorized trimming `replit.md` with the absolute constraint "don't lose any of this shit and become dumb about the software."

**What was done:** `replit.md` kept its operational core verbatim — Overview, Run, Stack, Where things live, Architecture, Product, ALL User preferences, ALL Gotchas, Pointers. The long dated incident forensics (Jun 01 25k-song root cause) and the full "Open TODOs" forensic writeups were RELOCATED **verbatim** (byte-for-byte, via a script so nothing truncated) into a new committed root file `replit-archive.md`. `replit.md` now carries short "History & resolved incidents" + "Open TODOs (active)" index sections that point into the archive.

**Why:** the user has been burned by lost context and demands every fact preserved. The split was verified byte-exact (moved region present verbatim in archive; both kept sections unchanged). Nothing was deleted — only moved.

**How to apply:**
- Treat `replit.md` + `replit-archive.md` as ONE knowledge base. When you need full forensics/TODO detail, READ `replit-archive.md` — do not assume the detail is gone just because it's not in `replit.md`.
- `.local/work-log-archive.md` is a third, separate (ephemeral) archive referenced for some older TODO fix plans.
- If trimming again: RELOCATE verbatim, never condense/delete. Verify byte-exact before finishing.
- Neither `replit.md` nor `replit-archive.md` is pushed to the Dell units (Replit-side docs only).
