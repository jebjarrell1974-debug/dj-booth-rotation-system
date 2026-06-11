---
name: Feature intro/outro bed music — "Promo Beds" genre (BUILT)
description: Where the feature producer gets its intro/outro music bed. Implemented June 2026 — reuses the existing "Promo Beds" genre.
---

# Feature intro/outro bed source = the "Promo Beds" music-library genre (IMPLEMENTED)

Status: **BUILT (June 2026).** Supersedes the earlier (never-shipped) plan to use a dedicated `Featured Beds` genre — the user decided to reuse the existing **`Promo Beds`** genre instead, so they only manage one beds folder.

## How it works
- Beds are NOT a separate `<musicPath>/feature-beds/` folder (that dead-folder approach is gone). They come from a normal top-level music-library folder named **`Promo Beds`** (folder name = genre; the scanner sets `genre = top-level folder name`, nested folders won't work).
- `server/feature-producer.js`: `FEATURE_BED_GENRE = 'Promo Beds'`; `produceFeatureAudio` pulls a RANDOM track via `getMusicTracks({ genre: FEATURE_BED_GENRE })`, resolves `bedFilePath = join(musicPath, bed.path)` with an `existsSync` guard, throws a clear error if the genre is empty / file missing.
- `server/index.js`: `/api/features/beds` returns the `Promo Beds` track names (panel picker stays coherent).

**Why:** the user reused the folder=genre mechanism so they manage beds by dropping files in one folder (no separate upload path), and explicitly chose to share the existing **Promo Beds** genre rather than create a dedicated one. If the genre is empty, the producer fails loudly (fail-closed) — populate the `Promo Beds` folder on a unit (it syncs via R2 on service restart / boot).
