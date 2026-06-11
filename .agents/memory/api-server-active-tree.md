---
name: api-server — which code tree is actually live
description: Edit server/, not src/. The src/+dist build targets the dead Replit deploy.
---

# `artifacts/api-server/server/` is the live tree

The api-server has two parallel code trees:
- `artifacts/api-server/server/` — **active for BOTH** the Replit dev workflow (`dev` runs `node ./server/start.js`) **and the Dell units** (homebase build / `homebase-package.json` runs `server/index.js`).
- `artifacts/api-server/src/` + `build.mjs` → `dist/index.mjs` (the `build`/`start` scripts) — targets the **Replit cloud deployment, which is broken (platform 404) and unused**.

Some modules exist in both trees (e.g. `promo-mixer.js`), which is a trap. **How to apply:** for any server change that must reach dev preview AND the units, edit `server/`. Editing only `src/` changes nothing the user can see or deploy. Feature-entertainer code (`feature-producer.js`) only lives in `server/`.

**Why:** the units serve the prebuilt dj-booth `dist/` + run `server/index.js` directly; Vite/the dist api build are not used on units.
