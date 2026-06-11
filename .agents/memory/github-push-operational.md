---
name: GitHub push operational lessons (DJ Booth)
description: How to push to the PUBLIC dj-booth repo without leaking secrets/music or tripping GitHub's rate limit.
---

# Pushing to the dj-booth GitHub repo (PUBLIC)

The repo `jebjarrell1974-debug/dj-booth-rotation-system` is **public** (units download without auth). Two independent hazards when pushing via the Octokit blob/tree API:

## 1. Secondary rate limit on full-tree pushes
Pushing the whole source tree (~450+ files) by creating one blob per file back-to-back trips GitHub's **secondary rate limit** (HTTP 403 "exceeded a secondary rate limit"). It can fail partway.

**How to apply:**
- Don't push the full tree for a routine deploy. `createTree` with `base_tree` MERGES — files you omit stay as-is in the repo. So push **only the changed source files + the rebuilt dist**, which is a handful of blobs.
- Put an ~800ms `sleep` between `createBlob` calls.
- If a full backup push is ever needed, expect to wait out a cooldown (~1–2 min) and throttle.

## 2. The default skill IGNORE list is NOT enough — it would leak/ship junk
`.agents/skills/github-pi-update` push snippet only ignores node_modules/dist/.git/.local/voiceovers/.cache/.config/attached_assets/.upm + .env/.db/.log. It does **NOT** exclude several things that exist in this workspace and must never reach a public repo or the units:
- top-level `music/` and `artifacts/api-server/server/music/` — sample/test music (Blair/Minnie sets, ~5MB).
- `artifacts/api-server/license-keys.json` — **a secret in a public repo.** Always exclude. If an earlier push ever included it, the key may already be in repo history → flag for rotation.
- `reports/` — dev-only forensic PDFs + node_modules.
- `*.mp3` generally live only under music dirs; the `.wav` files under `artifacts/dj-booth/public/public/sfx/` ARE legit app assets (soundboard) — keep those.

**How to apply:** when pushing, harden the ignore set: add dir names `music`, `soundboard`, `reports`; add files `license-keys.json` (+ any one-off `_push_*.mjs`/`push-*.cjs` temp scripts); add exts `.mp3 .m4a .flac .ogg` (NOT `.wav`). Add a final guard that throws if any path matching `/music/`, `license-keys.json`, or `*.mp3`/`.db*` slips into the tree. Delete temp push scripts after running.

**Why:** the user's hard rules forbid pushing music/db/secrets/dev files to the units and the repo is public — a leak is real.
