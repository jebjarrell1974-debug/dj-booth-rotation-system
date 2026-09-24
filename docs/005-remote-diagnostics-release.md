# 005-only remote diagnostics candidate — hold for controlled installation

This is **not** a fleet release. Do not merge this branch into `main`, publish it through
004/R2, run `~/djbooth-update.sh`, or enable 005's boot updater/cron. Those routes may
replace the working canary or re-enable unattended updates. Do not change 002/003/004.

## Provenance

- Candidate base: GitHub `main` at `2cbed80ddc7eff0c41c99cb64d7807b92989efca`.
- The base's `artifacts/dj-booth/dist/public/assets/index-BUoVcTsi.js` has SHA-256
  `ae998b4221fa036e963568bb2e655ed895af1f7153cdff7f1d5d482981c49192`,
  matching the asset previously measured on 005.
- Base server entrypoint SHA-256: `1fc20b496fdec15758b10c519f0c791e7e5f4eec4481745e428b7523aeef942c`.
- Base `dist/public/index.html` SHA-256:
  `1ed5974efe216b088db16d29355809d75419cefd73369b5b9dab3371e5a50f0d`.
- This candidate changes only remote selection/rotation repair source, continuous
  staff-remote telemetry source, the API diagnostic writer route, and a prebuilt web
  entry bundle. It does **not** modify the updater, music, environment, license,
  database schema, watchdog, or startup configuration.
- The candidate's new JS bundle is `index-DGCDpmew.js`, SHA-256
  `c9f1685fd2407e0800a1b027aa74c2c95b5e03231ad897b71ec22df26f4d447d`.

**Important limit:** A clean *source* build of the unmodified GitHub canary using
this workspace's installed build dependencies produced a different JS hash from the
published canary. The published canary asset itself matches 005, but byte-for-byte
build reproducibility has **not** been established. Treat the new bundle as a
candidate, not a known-identical rebuild. Inspect the candidate diff and stage a
dry run before changing the running 005 installation.

## 005 preflight — stop on any mismatch

1. Confirm the actual staff remote **page URL** is served by 005. Telemetry reports
   to the page-serving host; if staff load a different host, 005 will not get the logs.
2. On 005, confirm the service is healthy, the normal 005 auto-update service and
   crontab updater are still disabled, and the venue is closed or in an approved
   maintenance window. Do not restart a live set.
3. Check SHA-256 of `~/djbooth/dist/public/assets/index-BUoVcTsi.js`,
   `~/djbooth/server/index.js`, and `~/djbooth/dist/public/index.html` against the
   values above. A difference in **any** file means the installed code diverged:
   **stop** and compare it first; do not overwrite it.
4. Check that `~/djbooth/server/booth-command-policy.js` exists. Preserve `.env`,
   the settings database, music, voiceovers, and all existing diagnostic logs.
5. Review the candidate's source and dist changes against the base commit. Do not
   copy the entire workspace, deploy via `main`, or replace the whole app directory.
6. Take an off-unit copy of the three original files above before installation,
   with hashes and a timestamp. Leave the old JS asset in place.

## Controlled install (Claude/operator only, after preflight)

Install **only** these four runtime paths from this candidate branch, into the
equivalent flat paths under `~/djbooth` on 005:

| Candidate branch path | Installed path |
| --- | --- |
| `artifacts/api-server/server/remote-telemetry.js` | `server/remote-telemetry.js` |
| `artifacts/api-server/server/index.js` | `server/index.js` |
| `artifacts/dj-booth/dist/public/assets/index-DGCDpmew.js` | `dist/public/assets/index-DGCDpmew.js` |
| `artifacts/dj-booth/dist/public/index.html` | `dist/public/index.html` |

Stage the files outside the live app and verify their SHA-256 first. Copy the new
module and new JS asset **before** atomically replacing the server entrypoint and
HTML; preserve ownership/mode. Restart **only** `djbooth` on 005 once, then check
`http://localhost:3001/__health`, the page, server journal, and browser asset load.
Do not run the updater, reboot, delete old assets, or touch any other unit.

Have an actual staff browser load its normal 005 remote page. No diagnostic button
is required: landing and booth views report automatically while the page is open.
Confirm fresh `source:"staff_remote"` records appear in the 005 daily diagnostic
JSONL file (`~/djbooth/diag/diag-YYYY-MM-DD.jsonl`, unless `DIAG_LOG_PATH` overrides
it). Check heartbeat, catalog results, command outcomes, and booth/stage comparison
as applicable. If records do not arrive, check the page origin, browser Origin
header, 005 API route, and status **without** changing the configured booth target.

If the health check, page, remote commands, or display misbehaves, restore the backed-up
`server/index.js` and `dist/public/index.html` atomically and restart `djbooth` on 005.
The old JS asset must still be present; the unused new module/asset can be removed
after rollback. Do not restore/delete the full app directory or data directories.
Verify the auto-update hold remains disabled after either outcome.

These logs cannot reconstruct earlier staff-browser requests that were never
recorded. A successful installation enables evidence for future or reproduced
failures; it does not prove the earlier cause.