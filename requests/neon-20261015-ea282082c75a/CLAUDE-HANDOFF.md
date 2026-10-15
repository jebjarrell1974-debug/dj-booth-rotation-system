# Saved-break Next Song fix — publication and gated closing-window rollout

No further signing is required. Both whole-archive signatures have been verified.
The frontend was authenticated and independently rebuilt. The existing offline
utility suite passed 430 checks, including ten actual-skip-callback regressions.
Physical playback/touch and the native Save All → Next Song journey are unverified.

## Scope and stop conditions

Publish the exact immutable prerelease assets below; do not promote application
main, GitHub latest, homebase latest, or R2 latest. The source is already staged.
No private key, passphrase, signing USB, or signing folder may be accessed/copied.

Unit installation is a SEPARATE approval. Do not install or restart any unit until
the operator explicitly approves this release's rollout and confirms the venue
is closed and the maintenance window is sufficient. Signing does not grant that
approval. If approved, use 004 → 002 → 003 → 005 and stop at the first failure.
Do not append browser QA or extend the agreed window.

Do not create another booth browser, headless player, fake performer, or playback
test on a venue unit. Preserve stable music, voiceovers, databases, unit settings,
credentials, OS volume, display ports, and all existing backup/recovery snapshots.
Never relax a verifier, replace independent pins, accept automatic source
archives, reset signing history, or run an unsigned fallback.

## Fixed release evidence

- Repository: jebjarrell1974-debug/dj-booth-rotation-system (must remain public).
- Release: neon-20261015-ea282082c75a.
- Draft GitHub release ID: 413636268.
- Exact source commit: 9736f58d51dd90eb393fb3dd214d2645dc3183ce.
- Source branch: release/neon-20261015-ea282082c75a.
- Complete published source: 700 files, checked against the frozen signed archive.
- Declared installed application: 421 files.
- Approved public identity:
  sha256:d4c5ee5ebfb37e95442a3e4e39bb1a5e2ee64ec389a8df5bae61cde7de9625f8.
- Frontend manifest SHA-256:
  ea282082c75a9a64d7e3c7063f72200920ffcba29ede0d4ae61a22df247cc7d1.
- Installed inventory SHA-256:
  5837d4acfdba3b76b848d19077b77952f32c31d3c6f77d18f66d0f92d1c96436.
- GitHub source inventory SHA-256:
  d6d50543d0f4534dec40c5ba5ede66f2529894fb2704059f11a1c00d8c95cf16.

The GitHub connection in Replit cannot upload release binaries to the upload
host. Complete asset publication using the already authenticated local gh client.
No new credentials or private signing material are needed.

## Phase 1 — exact asset publication

Use a fresh local staging directory, not any private signing directory. Download
these six files from the verified review transport:

    https://b365ddcb-6970-4aec-96c1-39257cf90121-00-1llyzmx2bnya5.picard.replit.dev/downloads/<filename>

Verify every size/digest before extracting, executing, or uploading:

| Filename | SHA-256 |
| --- | --- |
| djbooth-flat-release.tar.gz | a351322cd6e63e13873c5ac840df43f3910b133294344b8345594443cda89c19 |
| djbooth-release.tar.gz | 2e33dbfacb9ef5a58453acfa08b3da1fd63a765d2ed92341c395ae6d70fe9f04 |
| djbooth-flat-release.signature.json | d08e07d35e11fab171dedce737e59827f5ca6f0bbdd7b1f2f9de9791dee2f707 |
| djbooth-release.signature.json | 4a9b32a171a7567c836850f3c48c2fbdcffa6c464b05e879290fe0a7b0376389 |
| neon-install-control.tar.gz | 4a39480219c5f645434d20302333fd34c00f97debb3f7e82f79bafb8c98b0cfb |
| control-integrity.json | 72f19835b92b00009ddd408ea12c76a022741deb7458065eb4a201803a2ed4aa |

The archive sizes are 4400715 bytes (flat) and 5071807 bytes (GitHub).
The public control packet is 62352 bytes. Its verifiers/policies are review
material, not authorization to replace any independently installed trust root.

Inspect draft release 413636268 through gh. Require its tag name to match the
release above, target_commitish to match the exact source commit, and draft=true.
Upload the six files without --clobber. If assets already exist, compare their
actual bytes and refuse any difference; never replace an immutable signed asset.
Download/read back all uploaded files with the authenticated gh client and
recheck all six digests. Only then publish this prerelease with make_latest=false.
Confirm the resulting tag resolves to the exact source commit. Do not move main.

Re-download all six PUBLIC assets after publication, verify their exact digests,
and authenticate both complete archives against the independently approved
public identity. The public download base is:

    https://github.com/jebjarrell1974-debug/dj-booth-rotation-system/releases/download/neon-20261015-ea282082c75a/

Use these exact signed assets, never GitHub's automatic source tarball.
Return the immutable public URLs and evidence. If rollout approval is absent,
STOP HERE without contacting/restarting/installing on any unit.

## Phase 2 — only after explicit closed-venue rollout approval

Before the first write, capture read-only preflight evidence on all four units:
current healthy service/native SQLite loading, actual application path, music
counts/size, voiceover counts, database/settings identity, installed verifier
and public pin, and existing boot-update/cron holds. Do not print credentials.
Keep default distribution pointers unchanged; refuse an operation that would
automatically publish a different homebase/R2 default.

For each unit, in order 004 → 002 → 003 → 005:

1. Require the existing fixed, independently provisioned verifier and policy:
   /usr/local/lib/neon-installer/verify-release.mjs and
   /etc/neon/installer-trust.json. Check protected ownership/parents and active
   fingerprint. Do not install trust files from the candidate control packet.
2. Confirm the current updater is the reviewed signed updater with fail-closed
   preservation of backup-excluded directories and atomic self-replacement.
   If it differs, use only code extracted from the archive AFTER the independent
   verifier accepts it. Do not fetch and execute unauthenticated raw updater code.
3. Pin the existing updater to this exact published release:

       DJBOOTH_BRANCH=neon-20261015-ea282082c75a \
       DJBOOTH_SKIP_HOMEBASE=1 DJBOOTH_SKIP_R2=1 \
       bash "$HOME/djbooth-update.sh"

   Use its established app/service overrides if that unit needs them. Require
   its independent whole-archive receipt to identify this release and the pinned
   GitHub archive digest. Never permit source fallback, main, or another release.
4. Immediately restore the prior boot AND cron update holds; manual updates can
   re-enable both. Keep holds until an independently approved default promotion.
5. Require healthy service/loopback health, native SQLite compatibility, and
   preserved music, voiceovers, databases/settings, volume/display configuration.
   Do not run migrations, clear caches, re-download music, or edit operator data.
6. Run the supplied read-only inspector against the actual installed app:

       node /path/to/verified-control/inspect-installed.mjs \
         /actual/unit/application/path \
         /path/to/verified-control/installed-expected.json \
         5837d4acfdba3b76b848d19077b77952f32c31d3c6f77d18f66d0f92d1c96436 \
         neon-20261015-ea282082c75a 421

   Require 421/421 exact files, zero failures, and the frontend manifest digest
   above. A timestamp, "unknown" updater stamp, or a running server alone is not
   installed-release evidence.
7. Proceed to the next unit only after all of the above pass. Preserve rollback
   snapshots. On failure, stop and report; never delete music/voiceovers or
   improvise a destructive rollback/unsigned installation.

## Final report

Provide publication URLs, source commit, both verified archive receipts, and one
row per unit with 421/421 hash evidence, service/native SQLite health, data
preservation, restored boot+cron holds, and the retained recovery snapshot.
State physical/native browser/audio/touch journeys as UNVERIFIED; no extra booth
browser is permitted to qualify them under this assignment.
