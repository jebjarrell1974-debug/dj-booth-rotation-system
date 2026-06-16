# NEON AI DJ — Handoff for Claude Code (read-only diagnostics)

> **What this file is.** A complete, self-contained snapshot of the NEON AI DJ
> project state, maintained by the Replit Agent (the sole editor) and pushed to
> GitHub at the end of every working session. Claude Code is **read-only** and uses
> this to understand what it's diagnosing/monitoring. If anything here conflicts with
> `replit.md`, **this file and the "Corrections" section below win** — `replit.md` has
> a few stale facts that are preserved verbatim by user request and corrected here.

- **LAST UPDATED:** June 16, 2026
- **Latest push:** new-unit audio fix in `x86-setup.sh` + Claude Code operating
  rules (§12) + unit 004 bring-up status & stability gate (§13). (Prior commit
  `7b2fa14` — VIP countdown timer + rotation-tab feature display + replit.md unit 004.)
- **Repo:** https://github.com/jebjarrell1974-debug/dj-booth-rotation-system (PUBLIC)
- **Editing model:** Replit Agent makes ALL repo changes (code, builds, GitHub
  pushes) and ALL commands on LIVE units (002 / 003 / homebase). Claude Code is
  read-only on the repo and on live units — diagnosis + monitoring. **Exception
  (Jun 16, 2026): Claude Code MAY apply hands-on fixes directly on the NOT-YET-LIVE
  sandbox unit 004**, then hand every durable fix to the Replit Agent to bake into
  the repo (see §12 operating rules). It still never edits the repo and never runs
  changes on 002 / 003.

---

## 1. What NEON AI DJ is

Nightclub automation that runs the booth: automated entertainer (dancer) rotations,
music playback with equal-power crossfade + ducking, and dynamic human-sounding voice
announcements (ElevenLabs TTS + OpenAI copy). Runs as a kiosk on Dell mini-PCs in
clubs. Features: 4-hour song cooldown, configurable songs-per-set, interstitial/break
songs, VIP send (additive time), Feature Entertainer shows, autoplay queue when no
entertainers present, promos/commercials, crowd display, remote control, dancer PIN
auth, Telegram alerting, and centralized fleet management with R2 content sync.

## 2. Stack & where things live

- **Frontend:** React 18, Vite, TailwindCSS, Radix/shadcn, React Query, React Router v6.
  Source: `artifacts/dj-booth/src/`.
- **Backend:** Express.js + SQLite. **LIVE server tree = `artifacts/api-server/server/`**
  (this is what runs in dev and on the units). A `src/`+`dist` build under api-server
  targets the *dead* Replit cloud deploy — do not edit that for unit behavior.
- **Monorepo:** pnpm workspaces. Artifacts: `dj-booth` (the booth UI), `api-server`,
  plus unrelated `voice-lab`, `promo-video`, `mockup-sandbox` (canvas).
- **Audio engine:** `artifacts/dj-booth/src/.../AudioEngine.jsx` — **LOCKED. Never
  edit.** Crossfade, ducking, gain-bus architecture are finalized. Voice routes through
  a separate `voiceGainRef` (default 1.5x). All audio fixes are caller-side only
  (`DJBooth.jsx`, `AnnouncementSystem.jsx`).
- **Announcements:** `artifacts/dj-booth/src/components/dj/AnnouncementSystem.jsx`.
  Voice cache version `CURRENT_VOICE_VERSION='V13'`, `NUM_VARIATIONS=5`. Bump version to
  invalidate cached voiceovers. `SPELL_OUT` set (case-insensitive) turns VIP/DJ/etc.
  into `V.I.P.` before ElevenLabs.
- **DB:** dev `./djbooth.db`; prod/unit path set by `DB_PATH`. On units the DB holds
  API keys + settings (NOT browser localStorage — see Corrections). DB is **not**
  R2-synced; only music + voiceovers are.
- **Content redundancy:** music + voiceovers sync to/from Cloudflare R2 on every boot
  and service restart. Fleet music uploads to R2 happen ONLY from homebase.

## 3. Fleet inventory (current)

| Unit | Role | State |
|------|------|-------|
| **002** | Live booth: touch + kiosk + crowd display | HDMI-2 = kiosk (1920×1080), HDMI-1 = crowd display (portrait, rotated left). Primary test unit for new pushes. |
| **003** | Live booth: touch + kiosk + crowd display | Same HDMI layout as 002. The **"known good" reference unit — protect it.** Auto-update DISABLED; user updates it MANUALLY at his chosen cadence. |
| **004** | NEW unit (Jun 16, 2026) | **Not yet in a venue / not deployed.** No HDMI/touch layout confirmed. Safe hands-on sandbox for Claude Code. **Has a stability gate to pass before going live — see §13.** Treat as not-yet-live until assigned a venue. |
| **homebase** | Update source / staging | Openbox appliance, **no touchscreen, no kiosk monitor** (often off). Other units pull updates FROM homebase first, then GitHub fallback. Smoke-tests only — touch/kiosk verification impossible here. |

## 4. Current deploy state & cadence

- **GitHub `main` is at `7b2fa14`** (VIP timer fix + rotation-tab feature display + 004
  doc). 004 is being updated to this now to verify the VIP countdown.
- **Auto-update mechanism:** each unit has a **user-crontab `@reboot`** entry (NOT a
  systemd timer) that runs `~/djbooth-update.sh` ~45s after boot. There is no
  `djbooth-update.timer`.
- **003 auto-update is DISABLED** (commented in crontab). The user keeps 003 current by
  running `~/djbooth-update.sh` **by hand** when he decides it's safe — so 003 is NOT
  silently drifting.
- **Deploy cadence (strict):** at closing, update **002 first**, let it run unattended
  ~5–6 hours; if clean, THEN manually update **003** the following close. Never both at
  once, always 002 → 003.
- **Pending behavioral change still proving out:** commit `de64aca` (Jun 12) — DJ-saved
  rotation/break-song picks now override cooldown/dedup at every transition, "play once."
  Awaiting one clean full night on 002 before going to 003.

## 5. Most recent changes (this session, Jun 16, 2026)

1. **VIP countdown timer restored.** Adding the "+add time" button (multi-hour VIP)
   had pushed the "Returns in X" text onto the same narrow row as two icon buttons in
   the 210px VIP column, truncating it to "Returns...". Fix: countdown now gets its own
   full-width row (bolder, `tabular-nums`, `whitespace-nowrap`), with +/↺ buttons moved
   up beside the name. Display-only; VIP timing/additive logic unchanged. Safe for 003.
2. **Rotation tab shows placed Feature Entertainers distinctly.** `RotationPlaylistManager`
   now consumes `placedFeatures`; a placed feature shows a 🌟 FEATURE badge + chosen set,
   hides normal Skip/Top/VIP/remove and song editing, and gets feature-only "Next"
   (placeFeatureAtSlot pos 1) and "Hold" (cancelFeaturePlacement) buttons. Display-only;
   playback (`playFeatureArrival`) was always correct. Safe for 003.
3. **Unit 004 recorded** in `replit.md` fleet inventory.

All three were typechecked, dist rebuilt (`BASE_PATH=/ PORT=3001`), and pushed.

## 6. Open TODOs / known active issues

- **★ #1 — Rotation edits must SAVE and PLAY exactly what the DJ set, at any position.**
  Largely addressed by `de64aca` (caller-side override, "play once"); awaiting a clean
  002 night before 003.
- **Remote is unstable** — destabilizes the booth while in use. Needs a repro + logs
  during remote use; suspects `remoteMode` in `DJBooth.jsx` + remote API endpoints.
- **One-song sets + "round the house" staggered multi-stage rotation** — larger feature,
  needs a locked spec before building.
- **Daily-reboot hygiene** — decide on a nightly off-hours reboot (clears Chromium audio
  suspension, stale SingletonLocks, memory creep). Never reboot during a show.
- **ElevenLabs speed 400 / name-less announcer** — `VOICE_SETTINGS` speeds in
  `energyLevels.js` exceed ElevenLabs' max 1.2 (L4=1.25 → HTTP 400 on fresh gen). Fix:
  clamp L2/L3/L4 ≤1.20; do NOT bump voice version. Needs approval.
- **Sunny rotation bug + commercial volume** (~30 LOC in `DJBooth.jsx`): repeat tracks to
  fill when pool < songsPerSet; thin-pool diag; per-track post-interstitial cooldown
  replace; boost music ~1.3x during Promos-genre tracks (commercials sit ~33% quieter).
- **★ URGENT — harden `djbooth-update-github.sh`:** abort on `npm install` failure (it
  currently warns + continues), always `--legacy-peer-deps`, protect `node_modules`
  across rollback. Two units have silently lost packages from disk (002 `iconv-lite`
  May 17, 003 `express` May 28). Audit disk health fleet-wide.
- **Booth UI font/contrast pass** — HOLD until the Dell P2424HT is the standard panel.
- **Deck-state + crossfade observability logging** — caller-side only, gated, never in
  AudioEngine.
- **Smaller:** stuck "Queued..." hides Stop Rotation; announcements turn off after a full
  rotation cycle; 003 display-config `--primary`/`--pos` hardening; touch-watchdog tier-2
  escalation.

## 7. Diagnostic cheat-sheet (most valuable for Claude Code)

**Verify booth state from SSH (no screen access — user is often 300+ mi away):**
- Service up: `systemctl is-active djbooth`
- Server health: `curl -sf http://localhost:3001/__health`
- Kiosk window on right monitor: `DISPLAY=:0 wmctrl -lG | grep -i 'NEON AI DJ'`
  (expect `0,0 1920×1080` on the HDMI-2 region)
- WM in use: `wmctrl -m` (expect **Openbox** on 002 AND 003 now)
- Touch self-heal: `tail -20 /tmp/djbooth-touch-watchdog.log` (look for
  `remap id=X (...) -> HDMI-2`)
- Live touch id: `DISPLAY=:0 xinput list` (IDs drift — always re-detect)
- Kiosk launch trace: `tail -20 /tmp/kiosk.log`

**Symptom → cause:**
- **Frozen mouse + touch, music still playing** = stuck X input grab at the desktop
  layer. Preventive `djbooth-touch-watchdog.service` cycles touch every 180s (self-heals
  in ~3 min). One-tap operator fix: the **"Rotation Screen"** kiosk button. Manual:
  `xinput --disable <id>; sleep 0.5; xinput --enable <id>`. **Both units run Openbox now,
  so do NOT `killall -HUP gnome-shell`** (that was the old GNOME fix; GNOME removed).
- **Booth SILENT but service active AND `__health` OK** = Chromium suspended its Web
  Audio context — NOT a crash. Do **not** restart the service. Fix fastest-first:
  (1) tap Rotation Screen; (2) `DISPLAY=:0 xdotool key F5`; (3) full relaunch
  `pkill -f chromium; sleep 3; nohup bash ~/djbooth-kiosk.sh > /tmp/kiosk.log 2>&1 &`
  then DJ re-logs in + taps Start.
- **`Failed to fetch` at login, service active but `__health` empty/BOOTH_DOWN** = node
  server crash-looping, usually a missing npm package on disk. Confirm:
  `sudo journalctl -u djbooth -n 60 --no-pager`. Fix (no wipe):
  `cd ~/djbooth && NODE_ENV=development npm install --legacy-peer-deps && sudo systemctl restart djbooth && sleep 8 && curl -sf http://localhost:3001/__health && echo BOOTH_OK || echo STILL_DOWN`.
  Then check disk: `sudo dmesg | grep -iE 'ext4|i/o error|read error|sda|nvme' | tail -30`.
- **OpenAI / R2 / apt "fetch failed" / "Temporary failure resolving"** = Tailscale owns
  `/etc/resolv.conf`. Fix: `sudo tailscale set --accept-dns=false` + reconfigure Wi-Fi
  `ipv4.never-default yes ipv4.ignore-auto-dns yes`.
- **Dashboard "Errors: N"** is a `console.error` counter, NOT an HTTP 404 count. Grep the
  journal for `Express error` / `console.error`, not `404`.
- **"LOW CACHE RATE" / pre-pick-miss Telegram alert** after a reboot = cold-cache warmup
  artifact, self-heals. A REAL music wipe = DEAD AIR + a large R2 re-download.
- **"Lost ~25,000 songs" (historical, RESOLVED Jun 01 `61f94b9`)** was the update
  script's failed-update rollback deleting the music/voiceovers/node_modules it had
  skipped backing up — NOT power loss/disk/R2. Rollback now carries those dirs across,
  fail-closed.

**Network roles on every unit:** Ethernet (`enp*`) = INTERNET ONLY (DNS, OpenAI, R2,
GitHub, apt, Telegram). Wi-Fi (`wlp*`) = REMOTE ACCESS ONLY (phone/laptop on LAN), no
internet route. Default route + DNS MUST be on ethernet. Check: `ip route show`
(default via `enp*`), `resolvectl status` (DNS on the ethernet link).

## 8. Updating a unit (commands)

The installed `~/djbooth-update.sh` on each unit IS the GitHub updater (first-time setup
curls `djbooth-update-github.sh` to that name). Confirm: `grep GITHUB_REPO ~/djbooth-update.sh`.

- Normal update (homebase first, then GitHub): `bash ~/djbooth-update.sh`
- Skip homebase, pull straight from GitHub: `DJBOOTH_SKIP_HOMEBASE=1 bash ~/djbooth-update.sh`
- First-time install of the updater:
  `curl -o ~/djbooth-update.sh https://raw.githubusercontent.com/jebjarrell1974-debug/dj-booth-rotation-system/main/public/djbooth-update-github.sh && chmod +x ~/djbooth-update.sh`
- Disable auto-update (non-destructive):
  `(crontab -l | sed 's|^@reboot.*djbooth-update.*|# DISABLED: &|') | crontab - && crontab -l`
- Re-enable: `(crontab -l | sed 's|^# DISABLED: @reboot|@reboot|') | crontab - && crontab -l`

Units run a **pre-built `dist/`** from the repo (no vite build on the unit). When source
changes, the Replit Agent rebuilds dist with `BASE_PATH=/ PORT=3001` and pushes
`artifacts/dj-booth/dist` alongside the changed source.

## 9. Corrections to `replit.md` (it has stale facts, kept verbatim by user request)

- **API keys are NOT in browser localStorage.** They live in the unit's `.env` + the
  settings DB. (replit.md still says localStorage.) The DB is not R2-synced — back it up.
- **002's touch panel is the Siliconworks SiW**, not "Weida CoolTouchR" as one replit.md
  gotcha claims. Always `xinput list` for the live id; IDs drift.
- **Both 002 and 003 run Openbox now** (GNOME removed from 003; the gnome-shell X-input
  grab was the freeze cause). Any "HUP gnome-shell" advice in replit.md is obsolete.
- **003's live SiW enumerates as USB `1fd2:b101`**, but the udev rule
  `97-djbooth-touch-power.rules` pins `9101` — so the autosuspend rule never matches.
  Touch drops there are USB re-enumeration (watchdog recovers ~3 min), not autosuspend.

## 10. Hard rules (apply to the Replit Agent; useful context for diagnosis)

- **AudioEngine.jsx is LOCKED** — no edits, ever.
- **Repo is PUBLIC** — never commit secrets/music/db/mp3/node_modules. (`license-keys.json`
  is a secret; `music/`, `reports/`, `attached_assets/` are excluded.)
- **Test on 002 one full night before 003.** For any behavioral change, answer "what does
  this do to 003?" before pushing; when in doubt, hold it off 003.
- **`replit.md` and `replit-archive.md` are preserved verbatim** — never trimmed/condensed
  (standing user instruction). Full forensic history lives in `replit-archive.md`.
- **Copy-paste hygiene:** unit commands are given as clean, bare, paste-ready blocks (user
  runs them from a phone). Don't wrap in `ssh unit '...'` if the user is already on the unit.

## 11. Deeper detail (Replit Agent's memory topics, in `.agents/memory/`)

These topic files hold root-cause depth for the above: `update-rollback-data-loss`,
`feature-placement-circular`, `dj-saved-picks-override`, `vip-timeout-additive`,
`tts-paths-law`, `voice-switch-elevenlabs`, `touchscreen-freeze-recovery`,
`fleet-desktop-wm`, `siw-touch-autosuspend-rule`, `dell-update-script-paths`,
`github-push-operational`, `unit-credentials-and-scripts`, `api-server-active-tree`,
`config-precedence-and-clobber`, `low-cache-rate-alert`, `collaboration-model`,
`new-unit-provisioning`.

## 12. Operating rules for Claude Code (tuning)

Read this file at the start of every session — it's the source of truth. If anything
here conflicts with `replit.md`, **this file wins**.

1. **Diagnose freely. For fixes, prefer user-owned config over package-owned files.**
   Put fixes in `~/.config`, `/etc/chromium.d`, or systemd / NetworkManager drop-ins —
   NOT in apt-owned paths like `/usr/lib` or `/usr/share`. An `apt upgrade` silently
   reverts distro files, so a fix there *looks* done but evaporates later. (Concrete
   example: the 004 double-launch fix that commented out
   `/usr/lib/.../openbox-autostart` will be undone by the next openbox upgrade — §13.)
2. **Every persistent fix must be reproducible in the repo, not just live on a unit.**
   Express it as a concrete edit to `x86-setup.sh`, `djbooth-update-github.sh`, or a
   bundled script, and hand it to the Replit Agent to commit. A fix that lives only on
   one machine is lost on reimage and never reaches unit 005.
3. **Don't introduce fleet divergence silently.** Switching the display manager,
   purging packages other units keep, or changing the autostart mechanism is a
   fleet-wide decision — raise it, don't apply it to one unit. **Keep the fleet on
   GDM + openbox session + GNOME-installed-as-fallback. Do NOT standardize on lightdm.**
4. **After any change touching display / audio / network / keyring, cold-reboot and
   confirm UNATTENDED recovery**, stating pass/fail for each: (a) single kiosk window
   at 0,0 1920×1080, (b) single rotation window, (c) audio through the USB DAC,
   (d) Wi-Fi remote access reconnected.
5. **Destructive ops** (apt purge, DM swap, editing system files): state the exact
   commands and the rollback first. You MAY run them on the **not-yet-live unit 004**.
   **NEVER on live 002 / 003** — hand those to the Replit Agent and the
   "002-first-for-a-full-night" cadence.
6. **Keep your reporting format** — root cause → fix → "bake into setup for the next
   unit." It's genuinely good. Just make sure rule 2 actually happens for every fix.

## 13. Unit 004 bring-up: status & stability gate

The 12-phase `x86-setup.sh` ran on 004 (Tailscale `100.64.87.105`). Three first-boot
problems surfaced — here's each one's root cause and where the durable fix stands:

1. **No USB-DAC audio.** Chromium's launch env lacked `XDG_RUNTIME_DIR`, so pipewire-alsa
   couldn't find the audio socket. **RESOLVED for all future units:** the Replit Agent
   baked `/etc/chromium.d/pipewire-audio` (exports `XDG_RUNTIME_DIR`, `PULSE_SERVER`,
   `DBUS_SESSION_BUS_ADDRESS`) into `x86-setup.sh`. 004 already carries the equivalent
   hand-fix.
2. **gnome-keyring gcr-prompter blocks Chromium on first boot.** Under GDM autologin no
   password reaches PAM, so the login keyring stays locked and pops a dialog. 004 was
   hand-fixed by removing the keyring. **CAUTION — Wi-Fi risk:** NetworkManager may store
   the Wi-Fi PSK in that keyring; removing it can break Wi-Fi reconnect after a reboot,
   and Wi-Fi is 004's remote-access path. **Gate item:** confirm Wi-Fi remote access
   survives a reboot. If it doesn't, store Wi-Fi secrets system-wide (`psk-flags=0`,
   root-owned `/etc/NetworkManager/system-connections`) so they don't depend on a keyring.
3. **Double-launch of kiosk / crowd display** → "Opening in existing browser session"
   race → RotationChromium stuck at 10×10 px. Root cause: BOTH the XDG
   `~/.config/autostart/*.desktop` entries AND `~/.config/openbox/autostart` launch the
   same scripts (Debian's openbox-session also runs `xdg-autostart`). 004 was hand-fixed
   by commenting out the xdg-autostart block in `/usr/lib/.../openbox-autostart`.
   **CAUTION — that file is apt-owned; an openbox upgrade reverts it and the double-launch
   returns.** Durable fix is **pending** and must also change the updater (which runs on
   live units → 002-first cadence): add a `flock -n` guard to the launcher scripts, or
   stop emitting the XDG duplicates so `~/.config/openbox/autostart` is the only launcher.
   **Open question to answer BEFORE touching shared scripts:** why do live 002 / 003 NOT
   double-launch but 004 does? (Most likely a newer Debian/openbox on 004.)

**Fleet display-manager decision (Jun 16, 2026):** keep new units on **GDM + openbox +
GNOME-as-fallback** to match 002 / 003 / homebase. The lightdm switch on 004 was a
side-effect of an aggressive GNOME purge, not a design choice. Under autologin → openbox,
gnome-shell never runs, so keeping GNOME installed is harmless and preserves
`djbooth-rollback-to-gnome.sh` as a real escape hatch (that rollback is broken on a
GNOME-purged unit).

**★ STABILITY GATE — 004 must pass this before it goes to a venue.** Reboot it several
times and confirm, unattended on every reboot: (a) single KioskChromium at 0,0
1920×1080, (b) single RotationChromium, (c) audio through the USB DAC, (d) Wi-Fi remote
access reconnects with no hands. Only when all four are green every reboot is 004
venue-ready.
