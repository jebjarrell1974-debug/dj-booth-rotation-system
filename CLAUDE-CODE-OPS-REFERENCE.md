# NEON AI DJ — Field Ops Reference (for read-only Claude Code on the hardware)

> **Audience:** an external Claude Code instance that SSHes into a deployed NEON AI DJ
> unit to **monitor, diagnose, and advise on installs**. It is **READ-ONLY for application
> code** — it must never write or edit the app source. All source changes happen in Replit.
>
> **What read-only means here:**
> - ✅ Allowed: read files/logs, run diagnostic commands, `systemctl status/restart`,
>   inspect the DB read-only, run **system-level** installs the operator approves
>   (`apt`, `npm install` inside the app dir to restore missing packages), recovery scripts
>   that already ship on the unit.
> - ❌ Off-limits: editing any file under the app dir's `server/`, `src/`, `public/`;
>   changing the systemd service files, `.env`, `DB_PATH`, or `MUSIC_PATH`; deleting music,
>   voiceovers, or the database; rebooting during operating hours.
> - When in doubt, **diagnose and advise — don't mutate.** Tell the operator the exact
>   command; let them run anything destructive.

---

## 0. First 60 seconds on a unit (triage)

```
hostname
systemctl is-active djbooth
curl -sf http://localhost:3001/__health && echo BOOTH_OK || echo BOOTH_DOWN
DISPLAY=:0 wmctrl -lG 2>/dev/null | grep -i 'NEON AI DJ'
systemctl list-unit-files | grep djbooth
tail -5 "$(ls -t ~/djbooth/diag/diag-*.jsonl | head -1)"
```

Interpretation:
- `djbooth` **active** + `__health` **OK** but **silent** → not a crash; Chromium suspended
  its Web Audio context (see §9). Do **not** restart the service.
- `__health` empty / `BOOTH_DOWN` while service `active` → node server crash-looping,
  usually a **missing npm package on disk** (see §9).
- No `NEON AI DJ` window → kiosk Chromium not launched / on wrong monitor (see §9).

---

## 1. System architecture overview

A single Dell mini-PC per venue ("unit") runs a **self-contained, local-first appliance**.
Everything the show needs to run is on the box; the cloud is only for redundancy and content
generation.

**Processes on a unit:**
1. **`djbooth` (systemd service)** — Node.js/Express server, the brain. Serves the web UI,
   the REST API, runs music selection/rotation logic, talks to ElevenLabs/OpenAI/R2,
   serves audio files. Listens on **`http://localhost:3001`** (binds `0.0.0.0:3001`).
2. **Kiosk Chromium (DJ booth screen)** — full-screen browser pointed at
   `http://localhost:3001`. **This is where audio actually plays** (Web Audio API in the
   browser, not a server-side audio daemon). Runs on `DISPLAY=:0`, monitor **HDMI-2**.
3. **Crowd-display Chromium** — second browser window at
   `http://localhost:3001/RotationDisplay`, on monitor **HDMI-1** (portrait/rotated).
4. **`djbooth-watchdog` (systemd)** — checks server health + relaunches the kiosk browser.
5. **`djbooth-touch-watchdog` (systemd)** — preventive touchscreen self-heal (cycles the
   touch input device every ~180 s to clear stuck X input grabs).

**Communication:**
- UI ↔ server: HTTP/REST + polling over `localhost:3001` (token in browser `localStorage`).
- Server ↔ cloud: HTTPS out to ElevenLabs (TTS), OpenAI (announcement text), Cloudflare R2
  (music/voiceover backup sync), optionally Auphonic (audio mastering).
- Fleet: units can pull updates/content from a "homebase" unit first, falling back to GitHub.
  `FLEET_SERVER_URL` in `.env` points at homebase.
- Audio output: browser → OS audio stack → speakers (the audio path is **inside Chromium**,
  no JACK/standalone mixer).

**Fleet (entire fleet — there are no other units):**
- **homebase** — staging/update source. No touchscreen, no kiosk monitor. Smoke tests only.
- **002** — live booth: touchscreen + kiosk + crowd display.
- **003** — live booth: touchscreen + kiosk + crowd display. The "known-good" reference unit.
  > ⚠️ **Aug 18, 2026 — Tailscale name collision:** `ssh neonaidj003` currently resolves to a
  > DEAD stale registration. The live unit is registered as **`neonaidj003-2`** in the Tailscale
  > admin console. **Use `ssh neonaidj003-2` until the operator purges the stale entries from
  > https://login.tailscale.com/admin/machines.** After purge, run `sudo tailscale set --hostname
  > neonaidj003` on the live unit to reclaim the plain name. Then `ssh neonaidj003` will work again.

---

## 2. Tech stack details

**Frontend (served by the node server, runs in Chromium):**
- React 18, Vite, TailwindCSS, Radix UI / shadcn-ui, React Query (`@tanstack/react-query`),
  React Router v6, react-hook-form, react-simple-keyboard (on-screen kiosk keyboard).
- **Audio engine:** browser **Web Audio API** (custom gain-bus / crossfade / ducking graph).
  Beat detection via `web-audio-beat-detector`.

**Backend (the `djbooth` service):**
- Node.js (ESM, `"type":"module"`), **Express 5**.
- **Database:** **SQLite via `better-sqlite3`** (synchronous, single file on disk). Some
  schema/queries use `drizzle-orm`. It is **not** Postgres/MySQL — no DB server process.
- **Logging:** `pino` / `pino-http` (structured JSON) → journald (via the service).
- **MP3 encoding:** `lamejs` / `@breezystack/lamejs`. **Audio analysis/transcode:** FFmpeg
  (system binary) for per-track loudness (LUFS) gain analysis.
- **Cloud SDKs:** `@aws-sdk/client-s3` (talks to Cloudflare R2's S3-compatible API),
  `@octokit/rest` (GitHub, for self-update), `bcryptjs` (PIN/password hashing).

**External services (keys live in env / browser localStorage — see §5):**
- **ElevenLabs** — voice synthesis (TTS) for announcements.
- **OpenAI** — generates announcement text/scripts.
- **Cloudflare R2** — off-site backup of music + voiceovers (S3 API).
- **Auphonic** — optional audio post-processing/mastering.

> Note: on the unit the server runs from **plain `npm`-installed `node_modules`** (the update
> script copies the server + `package.json` and runs `npm install --legacy-peer-deps`).
> The monorepo/pnpm structure is a Replit-side build concern, **not** how the unit runs.

---

## 3. Deployment method (how code reaches a unit)

Source of truth is the Replit repo → pushed to a **public GitHub repo** → units pull from
GitHub (or from homebase first).

- **Updater script on the unit:** `~/djbooth-update.sh` (this is the GitHub-pulling updater;
  internally it is the `djbooth-update-github.sh` logic). It downloads the latest code,
  backs up the current app dir (**excluding** `music/`, `voiceovers/`, `node_modules/`),
  swaps in new code, runs `npm install --legacy-peer-deps`, restarts the service, and
  relaunches the kiosk + crowd browsers.
- **App directory:** `~/djbooth` (e.g. `/home/neonaidj003/djbooth`). Code lives here:
  `server/` (backend), `src/` + `public/` + built assets (frontend), `package.json`, `.env`.
- **Auto-update at boot:** a **user crontab `@reboot`** entry runs the updater ~45 s after
  every boot:
  ```
  @reboot sleep 45 && DJBOOTH_BOOT_UPDATE=1 /bin/bash $HOME/djbooth-update.sh >> $HOME/djbooth-boot.log 2>&1
  ```
  (A `djbooth-update.service` systemd unit may also exist, but the **crontab line is the
  authoritative mechanism** — check both: `crontab -l` and
  `systemctl is-enabled djbooth-update.service`.)
- **Auto-update may be intentionally DISABLED** on a unit (the crontab line is commented with
  a `# DISABLED:` prefix). Some units are updated **manually** by the operator running
  `~/djbooth-update.sh`. **Do not assume a unit is current or stale — verify** with
  `crontab -l` and check the running code/commit.
- **Manual update (operator-run):** `bash ~/djbooth-update.sh`
- **Boot-update log:** `~/djbooth-boot.log`

> Claude Code should **advise** on updates but let the operator trigger them. The cadence the
> operator uses: update **002 first**, let it run ~5–6 hours / one full night; only if clean,
> then update **003**. Never both at once.

---

## 4. Log locations and structure

| What | Where | Format / notes |
|---|---|---|
| Server logs (app) | `sudo journalctl -u djbooth -n 100 --no-pager` | pino JSON lines; `-f` to follow |
| Structured diagnostics | `~/djbooth/diag/diag-YYYY-MM-DD.jsonl` | one JSON object per line (see below) |
| Boot-update log | `~/djbooth-boot.log` | stdout of the @reboot updater |
| Kiosk launch trace | `/tmp/kiosk.log` | Chromium kiosk relaunch output |
| Touch watchdog | `/tmp/djbooth-touch-watchdog.log` | look for `remap id=X (...) -> HDMI-2` |
| Browser watchdog | journald: `journalctl -u djbooth-watchdog` | health-check + relaunch activity |

**Diagnostics JSONL** (`diag-*.jsonl`) — the richest machine-readable signal. Each line:
`{"ts":<epoch_ms>,"serverTs":<epoch_ms>,"type":"<event>","hostname":"...","dancer":"...",...}`.
Useful `type` values: `transition_start`, `transition_complete` (has `feature:true` for
feature-entertainer shows), `track_play`, `track_play_fallback`, `prepick_hit`,
`prepick_miss`, `post_interstitial_played`, `selfheal_reload`, `watchdog_fired`,
`vip_send`, `vip_release`.

Handy queries:
```
# latest diag file
ls -t ~/djbooth/diag/diag-*.jsonl | head -1

# pre-pick cache health (who is missing?)
grep -Ea "prepick_hit|prepick_miss" "$(ls -t ~/djbooth/diag/diag-*.jsonl | head -1)" | tail -20

# transitions / feature shows
grep -Ea "transition_complete|track_play|post_interstitial|selfheal_reload" "$(ls -t ~/djbooth/diag/diag-*.jsonl | head -1)" | tail -30
```

**Error reporting nuances:**
- The in-app dashboard "**Errors: N**" is a **`console.error` counter**, *not* an HTTP 404
  count. To find real errors grep journald for `Express error` / the literal logged error
  lines — **not** for `404`/`not found`.
- Music/voiceover redundancy: the server may emit an R2 **re-download** on restart — a *full*
  re-download is a red flag (possible local content loss); incremental sync is normal.

---

## 5. Key config files (on the unit)

| File | Purpose |
|---|---|
| `~/djbooth/.env` | Server env: `IS_HOMEBASE`, `FLEET_SERVER_URL`, possibly `DB_PATH`, `MUSIC_PATH`, `PORT`. **Inspect, don't edit.** |
| `/etc/systemd/system/djbooth.service` | Main service. Defines `ExecStart`, `MUSIC_PATH`, `DB_PATH`, working dir. `systemctl cat djbooth` to read. **Do not edit.** |
| `/etc/systemd/system/djbooth-watchdog.service` | Browser watchdog unit. |
| `/etc/systemd/system/djbooth-touch-watchdog.service` | Touch self-heal unit. |
| `~/.djbooth-display-config.sh` | Per-unit `xrandr` display layout (HDMI-2 primary kiosk, HDMI-1 crowd display rotated). |
| `/etc/udev/rules.d/97-djbooth-touch-power.rules` | Pins the touch controller's USB `power/control=on` (disables autosuspend). |
| user `crontab -l` | The `@reboot` auto-update line (may be `# DISABLED:`). |
| Browser `localStorage` (NOT a file) | **Auth/session token + UI/playback state** (not third-party API keys — see correction below). Inside the Chromium profile under `~/.config/chromium/`. Lost on a profile wipe; rebuilds. |

> **Correction to a common assumption:** the **third-party API keys are NOT in
> `localStorage`.** The server reads them from **`.env`** (seed) and from the **`settings`
> DB table** (UI "Options" values, which *override* env). `localStorage` only holds the
> session token (`djbooth_token`) and UI/rotation state. A Chromium profile wipe therefore
> loses the login + UI prefs, **not** the API keys. See Part 2 §4.
>
> **The DB and music paths:** discover real values with `systemctl cat djbooth` and
> `cat ~/djbooth/.env`. Defaults (no env override): DB `~/djbooth/djbooth.db`,
> music `~/djbooth/music/`, voiceovers `~/djbooth/voiceovers/`, soundboard
> `~/djbooth/soundboard/`, diag `~/djbooth/diag/`.

---

## 6. Service / process names

- **`djbooth`** — the Node/Express server. `systemctl status djbooth`, `journalctl -u djbooth`.
- **`djbooth-watchdog`** — browser/health watchdog.
- **`djbooth-touch-watchdog`** — preventive touchscreen xinput cycler.
- **`djbooth-update.service`** (may exist) — boot update oneshot; crontab `@reboot` is the
  primary path.
- Process patterns for `ps`/`pkill`:
  - Server: `node` running `server/` (often `node .../server/index.js` or `start.js`).
  - Kiosk + crowd browsers: **Chromium** (`pgrep -fa chromium`); user-data dirs
    `/tmp/*-kiosk` and `/tmp/*-rotation`.
- Quick inventory:
  ```
  systemctl list-unit-files | grep djbooth
  pgrep -fa node
  pgrep -fa chromium
  ```

---

## 7. Dependencies & environment

- **OS:** Debian 13 (trixie family), kernel 6.12.x, **x86_64**. Not a Raspberry Pi/ARM in the
  live fleet (despite a legacy `pi-setup.sh` in the repo; `x86-setup.sh` is the relevant one).
- **Display server:** **X11** (`DISPLAY=:0`), **Openbox** window manager on the live units
  (GNOME was removed — gnome-shell grabbing X input on gestures was the freeze cause). Confirm
  with `wmctrl -m`. A bare Openbox desktop is "black screen + mouse" — that is **normal**, not
  a crash; the booth auto-launches from `~/.config/autostart/djbooth-*.desktop` and/or
  `~/.config/openbox/autostart`.
- **Browser:** Chromium, launched `--kiosk`/`--app` with media-suspend disabled flags.
- **Runtime:** Node.js + `npm` (installs with `--legacy-peer-deps`). System **FFmpeg** binary
  required for loudness analysis.
- **Audio stack:** output goes through the **browser → the OS default audio stack**. Debian 13
  desktops typically use **PipeWire** (with the Pulse shim); some may be PulseAudio. **Verify on
  the unit, don't assume:** `wpctl status` (PipeWire), `pactl info` (Pulse), `aplay -l`
  (ALSA cards). There is **no JACK** and no standalone mixer process.
- **Network roles (critical):** **Ethernet (`enp*`) = INTERNET ONLY** (DNS, OpenAI, R2,
  GitHub, apt). **Wi-Fi (`wlp*`) = REMOTE ACCESS ONLY** (operator's phone/laptop on the LAN;
  no internet route). The **default route must be ethernet**, DNS must resolve via ethernet.
  Remote admin is via **Tailscale**. Diagnostics: `ip route show` (default via `enp*`),
  `resolvectl status` (Current DNS on the ethernet link).

---

## 8. Hardware assumptions

- Dell mini-PC, x86_64, wired Ethernet + Wi-Fi.
- **Dual monitor via HDMI**, configured by **port name** (not orientation detection):
  - **HDMI-2** = primary **kiosk** monitor, 1920×1080, landscape (the DJ booth screen).
  - **HDMI-1** = **crowd display**, portrait (rotated left).
  - homebase has neither a touchscreen nor a kiosk monitor.
- **USB touchscreen** on the kiosk monitor. **Controller model varies per unit and the
  xinput id drifts — always re-detect**, never hardcode an id:
  - 003: Siliconworks "SiW HID Touch Controller" (USB vendor `1fd2`; live product id has been
    observed as `b101`, while the udev autosuspend rule targets `9101` — they may not match).
  - 002: Weida Hi-Tech "CoolTouchR" (USB `2575:0401`); it does **not** expose
    `Abs MT Position X`, so detectors scanning that property miss it — match by name
    "Weida"/"CoolTouchR" or vendor `2575`, and use the "…System" entry (not "…System Mouse").
  - Detect: `DISPLAY=:0 xinput list`. Map to the kiosk monitor:
    `DISPLAY=:0 xinput map-to-output <id> HDMI-2`.
- Expects to drive its own audio output (powered speakers/PA via the box's audio out).

---

## 9. Known fragile points (what breaks during installs/updates/runtime)

**Update / install:**
- **npm install failures silently losing packages.** Units have lost packages from disk
  (e.g. `iconv-lite`, `express`) → server crash-loops with `Failed to fetch` at login while
  the service shows `active`. Confirm: `sudo journalctl -u djbooth -n 60 --no-pager`.
  Recovery (non-destructive):
  ```
  cd ~/djbooth && NODE_ENV=development npm install --legacy-peer-deps && sudo systemctl restart djbooth && sleep 8 && curl -sf http://localhost:3001/__health && echo BOOTH_OK || echo STILL_DOWN
  ```
  Then audit disk health: `sudo dmesg | grep -iE 'ext4|i/o error|read error|sda|nvme' | tail -30`.
- **Update rollback historically wiped music** (older updater `rm -rf`'d the app dir on a
  failed update, taking `music/voiceovers/node_modules` with it → huge R2 re-download). Fixed
  in current updater, but a **stale updater on a unit can still do it** — confirm the unit's
  `~/djbooth-update.sh` is current before relying on it.
- A unit on disabled auto-update keeps an **old `~/djbooth-update.sh`** that can't always
  self-replace; if updates misbehave, re-fetch the updater from GitHub-raw over it.

**Audio / show-time:**
- **Booth silent but service active + `__health` OK** = Chromium **suspended its Web Audio
  context** (not a crash). **Do not restart the service.** Recovery, fastest first: (1) tap the
  on-screen **"Rotation Screen"** button; (2) `DISPLAY=:0 xdotool key F5`; (3) full kiosk
  relaunch: `pkill -f chromium; sleep 3; nohup bash ~/djbooth-kiosk.sh > /tmp/kiosk.log 2>&1 &`
  (DJ then re-logs in + taps Start).
- **`📉 LOW CACHE RATE` / pre-pick misses alert** is usually **benign** (cold pre-pick cache
  after a reboot, self-heals; misses still play on-demand — not dead air, not a wipe).
  **But** if the diag shows the misses are **all the same dancer** and persist with **zero
  hits**, that dancer's playlist is empty/thin or her track names don't resolve — a real
  per-dancer issue, not the cache. Real music-loss signal = a `🔇 DEAD AIR` alert and/or a
  full R2 re-download.

**Display / touch / desktop:**
- **Frozen mouse + touchscreen, music still playing** = stuck **X input grab** (desktop
  layer). The touch watchdog self-heals ~every 180 s; manual nudge: cycle the device
  `DISPLAY=:0 xinput --disable <id>; sleep 0.5; DISPLAY=:0 xinput --enable <id>` then re-map
  (`xinput map-to-output <id> HDMI-2`). The **"Rotation Screen"** on-screen button is the
  operator's one-tap recovery — advise that first.
- **`xinput --enable` resets the touch coordinate matrix** (un-maps touch) → always re-apply
  `map-to-output` after enabling.
- **Hot-plugging a monitor flips the xrandr `primary` flag** → kiosk lands on the wrong
  screen. Fix: `xrandr --output HDMI-2 --primary` then relaunch.
- **On Openbox units, do NOT `killall -HUP gnome-shell`** (GNOME is gone; on the old GNOME
  setup a HUP also wiped xrandr state). Use the touch-device cycle instead.

**Network:**
- **`fetch failed` / `Temporary failure resolving` to OpenAI/R2/apt** = **Tailscale hijacked
  `/etc/resolv.conf`** (`--accept-dns=true`) or DNS is leaking onto Wi-Fi. Fix:
  `sudo tailscale set --accept-dns=false` and ensure Wi-Fi is
  `ipv4.never-default yes ipv4.ignore-auto-dns yes`; default route + DNS must be on ethernet.

---

# Part 2 — Provisioning, credentials & deep reference

> Sourced directly from `x86-setup.sh` (provisioning), `djbooth-update-github.sh` (the
> updater), the watchdog scripts, and the server code. Where a value is per-unit or only
> knowable on the box, it says **verify on unit**.

## P2-1. Kiosk recovery script & all `$HOME` scripts

**`~/djbooth-kiosk.sh` is generated by the UPDATER (`~/djbooth-update.sh`), not by the
initial `x86-setup.sh`.** Fresh-setup units launch the kiosk via an *inline* Chromium command
in `~/.config/autostart/djbooth-kiosk.desktop`; the canonical `~/djbooth-kiosk.sh` launcher
(which applies the display config, runs the touch mapper, then launches Chromium with
`--class=KioskChromium`) only appears **after the first `~/djbooth-update.sh` run**. So on a
brand-new unit, **run the updater once** to get the full kiosk launcher + touch integration.

**Scripts the updater REWRITES/refreshes on every run** (treat as updater-managed — never
hand-edit, they'll be overwritten):
- `~/djbooth-kiosk.sh` — canonical kiosk launcher (heredoc-generated each run).
- `~/djbooth-rotation-display.sh` — crowd-display (RotationDisplay) launcher.
- `~/djbooth-display-watcher.sh` — relaunches the crowd display on trigger.
- `~/djbooth-watchdog.sh` — browser/health watchdog (copied from repo).
- `~/djbooth-touch-watchdog.sh` — preventive touch xinput cycler (copied from repo).
- `~/djbooth-unfreeze.sh` — one-shot "frozen mouse+touch, music playing" recovery.
- `~/djbooth-rollback-to-gnome.sh`, `~/djbooth-rollback-to-openbox.sh` — WM session swap.
- `/usr/local/bin/djbooth-touch-map.sh` — canonical touch→monitor mapper (system path).
- The autostart `.desktop` files under `~/.config/autostart/`.

**Set-and-forget (NOT maintained by the updater):**
- **`~/djbooth-update.sh`** itself — placed once by `x86-setup.sh` (downloaded from GitHub
  raw). It cannot reliably replace itself while running, so a stale updater stays stale until
  you manually re-fetch it (see P2-10).
- **`~/.djbooth-display-config.sh`** — created **once, manually, per unit** (see P2-8). The
  updater and setup script only *apply* it, never create it.

## P2-2. New-unit provisioning — bare metal → running booth

**Starting OS:** Debian (x86_64) desktop with GDM — the live fleet runs **Debian 13 / kernel
6.12.x**. The box needs a desktop session (GDM) because the booth is a kiosk browser.

**The setup script: `x86-setup.sh`** (run as the unit user, e.g. `neonaidj004`). 12 phases:
1. **Tailscale** install → **stops and tells you to run `sudo tailscale up`**, authorize in a
   browser, then **re-run the script** (it won't continue until Tailscale is connected).
2. **Node.js 22** (NodeSource) + `openssh-server`, `git`, `curl`; enables `ssh`.
3. **NoMachine** remote desktop (reachable on Tailscale IP : port **4000**).
4. **`git clone`** the app from GitHub into `~/djbooth`.
5. **`npm install` + `npx vite build`**.
6. **`.env`**: tries to pull fleet config from homebase
   `http://100.109.73.27:3001/api/fleet-env`. If homebase is unreachable it writes only a
   **minimal `.env`** (`PORT`, `NODE_ENV`, `FLEET_SERVER_URL`) — **missing all API keys**.
7. **`djbooth.service`** systemd unit (`ExecStart=/usr/bin/node server/index.js`,
   `EnvironmentFile=~/djbooth/.env`); enables + starts it.
8. **Chromium** install; sets hostname to the unit user; writes kiosk autostart + desktop
   launcher.
9. **GNOME kiosk config**: disables lock/screensaver/idle, **GDM auto-login**, **forces X11
   (`WaylandEnable=false`)**, installs xrandr; writes the crowd-display launcher +
   display-watcher and their autostart entries.
   **9.5 Openbox**: installs Openbox and sets it as the default GDM session (GNOME stays as
   fallback). This is the freeze-fix WM — must take effect on next login/reboot.
10. **Passwordless sudo** for the unit user.
11. **Browser watchdog + touch watchdog** services installed/enabled.
12. **Daily 8am reboot** (`/etc/cron.d/daily-reboot`) + **downloads `~/djbooth-update.sh`**
    from GitHub raw.

**Manual steps the script does NOT do:**
- `sudo tailscale up` + browser auth (mid-script, mandatory).
- Final **`sudo reboot`** to land in the Openbox kiosk session.
- **Run `~/djbooth-update.sh` once** to generate `~/djbooth-kiosk.sh` + full touch integration.
- **Create `~/.djbooth-display-config.sh`** for this unit's monitor layout (P2-8).
- **Set the default audio sink** for the USB audio dongle (P2-8).
- **Enter/confirm API keys** if `.env` didn't come from homebase — done in the booth UI
  **Options** screen (stored in the `settings` DB table), or by placing a complete `.env`.

**Exact happy-path sequence:**
`x86-setup.sh` → `sudo tailscale up` (authorize) → re-run `x86-setup.sh` → create
`~/.djbooth-display-config.sh` → `sudo reboot` → `~/djbooth-update.sh` → set audio sink →
open booth UI, confirm keys/voice, log in as DJ.

## P2-3. Tailscale

- **Installed by `x86-setup.sh` step 1** (`curl -fsSL https://tailscale.com/install.sh | sh`).
- **Connected manually:** `sudo tailscale up` (plain, **no special flags** in setup) + browser
  authorization.
- **Hostnames are stable:** the script sets the machine hostname to the unit user
  (`hostnamectl set-hostname neonaidj00X`), so with Tailscale MagicDNS the operator reaches a
  unit as **`ssh neonaidj00X`** (or by Tailscale IP). NoMachine GUI on **port 4000**.
  > **003 exception (Aug 18, 2026):** `ssh neonaidj003` hits a dead stale node — use
  > `ssh neonaidj003-2` until stale entries are removed from the Tailscale admin console and
  > the unit is renamed with `sudo tailscale set --hostname neonaidj003`.
- **CRITICAL post-install flag (not set by the script):** set
  **`sudo tailscale set --accept-dns=false`**. If Tailscale owns `/etc/resolv.conf`
  (`--accept-dns=true`, the default), DNS for OpenAI / R2 / apt / GitHub breaks — the #1
  new-unit networking gotcha. Ethernet must own the default route + DNS; Wi-Fi is LAN-only.

## P2-4. API keys & credentials — full map

**Read by the server from `.env` (and overridden by matching `settings` DB rows — UI Options
win over env):**
`PORT`, `NODE_ENV`, `IS_HOMEBASE`, `FLEET_SERVER_URL`, `FLEET_DEVICE_KEY`, `DEVICE_ID`,
`HOMEBASE_DEVICE_ID`, `MASTER_PIN`, `CLUB_NAME`,
`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `OPENAI_API_KEY`, `SCRIPT_MODEL`,
`AUPHONIC_API_KEY`,
`R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`MUSIC_PATH`, `VOICEOVER_PATH`/`VOICEOVER_DIR`, `SOUNDBOARD_PATH`, `DB_PATH`, `DIAG_LOG_PATH`,
`LICENSE_PUBLIC_KEY`/`LICENSE_PRIVATE_KEY`, `AICHAT_TOKEN`, `DJBOOTH_AICHAT_ENABLED`,
`LUFS_CONCURRENCY`.
(Values are never printed here — these are variable **names**. Inspect on a unit with
`cat ~/djbooth/.env`; query UI-set overrides from the `settings` table — see P2-6.)

**In browser `localStorage`** (the Chromium profile — **no third-party keys here**): session
token `djbooth_token`; fleet auth `fleet_device_id`, `fleet_device_api_key`, `fleet_pin`,
`fleet_server_url`, `djbooth_booth_ip`, `djbooth_fleet_ips`; and UI/playback state
(`djbooth_rotation`, `djbooth_rotation_songs`, `djbooth_planned_assignments`,
`djbooth_song_cooldowns`, `djbooth_interstitial_songs`, `djbooth_autoplay_queue`,
`djbooth_playback_state`, `djbooth_voice_gain`, `neonaidj_vip_map`, `neonaidj_music_eq`,
`neonaidj_voice_eq`, `neonaidj_commercial_freq`, `neonaidj_beat_match`, etc.).

**Shared vs per-unit:**
- **Shared fleet-wide** (distributed via homebase `/api/fleet-env`): ElevenLabs API key,
  OpenAI key, R2 credentials, Telegram, license keys.
- **Per-unit, intentionally NOT fleet-synced:** **`ELEVENLABS_VOICE_ID`** (each unit can run
  a different voice), `DEVICE_ID`, the unit's fleet device key, and all UI/playback state.

**Profile wipe / rebuild:** losing the Chromium profile loses `localStorage` → the DJ must
**re-login** and the UI prefs/rotation rebuild. **API keys are unaffected** (they live in
`.env` + the `settings` DB). **There is no automatic localStorage backup/restore** — it's
ephemeral state that regenerates. The durable config is the `.env` file and the DB.

## P2-5. The GitHub repo

- **URL:** `https://github.com/jebjarrell1974-debug/dj-booth-rotation-system` — **public**.
- **Pulling needs no auth** (public clone/raw fetch). `x86-setup.sh` does
  `git clone https://github.com/jebjarrell1974-debug/dj-booth-rotation-system.git`, and the
  updater fetches over plain HTTPS / `raw.githubusercontent.com/.../main/...`. No deploy key
  or PAT on the unit.
- **Replit → GitHub** is a **manual push from the Replit side** (handled by the project's
  GitHub push tooling), publishing only the intended files (the repo deliberately **excludes**
  music, voiceovers, DB files, `node_modules`, secrets, Replit state). Once pushed, units pick
  it up on their next `~/djbooth-update.sh` (manual or `@reboot`).

## P2-6. Database

- **File:** `~/djbooth/djbooth.db` (default = `<app>/djbooth.db`; overridable by `DB_PATH`).
  **SQLite in WAL mode**, so expect sidecar files **`djbooth.db-wal`** and **`djbooth.db-shm`**
  — never delete those while the service runs.
- **Tables (one-liner each):**
  - `settings` — key/value config (UI Options overrides, music_path, voice settings, etc.).
  - `dancers` — entertainer roster: name, color, **PIN hash**, playlist (JSON), phonetic name.
  - `sessions` — active login tokens (role, dancer_id, last_seen).
  - `songs` — legacy/known song-name registry (name only).
  - `voiceovers` — TTS cache index: cache_key → file_name, script, type, dancer, energy level.
  - `music_tracks` — scanned music library: name, path, genre, size, blocked flag, gain.
  - `play_history` — what played, when, by whom, genre (drives cooldowns/reporting).
  - `playback_errors` — recorded playback failures (track, dancer, reason).
  - `staff_accounts` — DJ/manager accounts with role + PIN hash.
  - `audit_log` — staff actions (who did what, when).
  - `api_usage` — per-service call counts + estimated cost (ElevenLabs/OpenAI/etc.).
  - `soundboard_sounds` — soundboard clip registry.
- **Backup:** WAL checkpoint every 5 min (durability, not off-site). **The DB is NOT synced to
  R2** (only music + voiceovers are). The closest thing to a backup is the **updater's
  timestamped `~/djbooth.backup-YYYYmmdd-HHMMSS/` dir**, which *does* include `djbooth.db`
  (it excludes only music/voiceovers/node_modules). **Advise the operator to copy
  `djbooth.db` off-box periodically** — it is the only home of dancers/PINs/playlists/settings.
- **If the DB is lost/corrupted:** dancers + PINs + playlists, staff accounts, settings (incl.
  any UI-entered keys), play history/cooldowns, and the voiceover/music **index** are gone.
  Music **files** survive (disk + R2); `music_tracks` rebuilds from a rescan on boot, and
  voiceovers re-sync from R2 (but the cache index regenerates). Roster/playlists must be
  restored from a backup dir or re-entered — so the DB is the highest-value thing to back up.

## P2-7. Music & voiceover content

- **Paths (defaults, verify on unit):** music `~/djbooth/music/` (`MUSIC_PATH` or the
  `music_path` setting — **empty/unset = no library until configured**); voiceovers
  `~/djbooth/voiceovers/`; soundboard `~/djbooth/soundboard/`.
- **How content lands:** **Cloudflare R2 sync** on boot and on service restart pulls music +
  voiceovers down. Initial population is the R2 sync (not a manual copy). Generated voiceovers
  are uploaded back to R2.
- **Size:** large — on the order of **~25,000 tracks / roughly 100–300 GB** (verify with
  `du -sh ~/djbooth/music`). A full cold re-download has been observed at ~300 GB.
- **If music is lost:** restart the service (`sudo systemctl restart djbooth`) to trigger the
  R2 re-download; **a full re-pull takes hours** over the venue link. Confirm files return
  (`find ~/djbooth/music -type f | wc -l` should climb back to the tens of thousands). A
  *partial* miss usually self-heals on the next sync; a *full* wipe historically came from a
  bad updater rollback (now fixed) — confirm the unit's updater is current (P2-10).

## P2-8. Display & audio config — hardcoded vs per-unit

- **`~/.djbooth-display-config.sh` is created MANUALLY, once per unit** (the updater + setup
  script only *apply* it). It pins each monitor's xrandr mode/position/rotation +
  `--primary`. Representative template (adjust outputs/resolutions to the actual unit —
  **verify with `xrandr --query`**):
  ```bash
  #!/bin/bash
  export DISPLAY=:0
  # Kiosk (DJ) monitor — landscape, primary
  xrandr --output HDMI-2 --mode 1920x1080 --pos 0x0 --rotate normal --primary
  # Crowd display — portrait, rotated left, placed to the right of the kiosk
  xrandr --output HDMI-1 --mode 1920x1080 --rotate left --pos 1920x0
  ```
  Make it executable (`chmod +x ~/.djbooth-display-config.sh`). The kiosk launcher, crowd
  launcher, and the monitor-hotplug udev rule all call it, so getting it right fixes the crowd
  screen rotation/position fleet-consistently.
- **Audio output is MANUAL.** After plugging the USB audio dongle:
  ```
  pactl list short sinks
  pactl set-default-sink <sink-name-from-the-list>
  ```
  Make it persistent (e.g. append the `set-default-sink` line to `~/.bashrc` or a per-unit
  autostart). `pactl` works whether the box runs PipeWire (Pulse shim) or PulseAudio — confirm
  with `pactl info` / `wpctl status`.

## P2-9. The watchdog services

**`djbooth-watchdog.service`** (installed by both `x86-setup.sh` and refreshed by the updater):
```ini
[Unit]
Description=DJ Booth Browser Watchdog
After=graphical.target djbooth.service
Wants=djbooth.service

[Service]
Type=simple
User=<unit-user>
Environment=DISPLAY=:0
ExecStart=/bin/bash /home/<unit-user>/djbooth-watchdog.sh
Restart=always
RestartSec=10

[Install]
WantedBy=graphical.target
```

**`djbooth-touch-watchdog.service`:**
```ini
[Unit]
Description=DJ Booth Touchscreen Watchdog (preventive xinput cycle)
After=graphical.target
Wants=graphical.target

[Service]
Type=simple
User=<unit-user>
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/<unit-user>/.Xauthority
Environment=HOME=/home/<unit-user>
Environment=INTERVAL_SEC=180
ExecStart=/bin/bash /home/<unit-user>/djbooth-touch-watchdog.sh
Restart=always
RestartSec=15

[Install]
WantedBy=graphical.target
```

- **Installed by:** both `x86-setup.sh` (first build) and `~/djbooth-update.sh` (refreshed on
  every run). The unit `.sh` bodies are copied from the repo; the `.service` files are written
  by the scripts.
- **What the browser watchdog does:** polls `http://localhost:3001/__health` every 5 s. On
  startup it launches the kiosk if `KioskChromium` isn't running. When the server **recovers**
  after being down, it focuses the kiosk and sends **F5**; if that fails or the kiosk is gone,
  it **relaunches** via `~/djbooth-kiosk.sh`. So it **auto-recovers — it does not merely
  alert.** (It does **not** manage the crowd display — that's the GNOME/Openbox autostart, to
  avoid duplicate-window races.)
- **What the touch watchdog does:** every 180 s it cycles each detected touchscreen
  (`xinput --disable; sleep 0.5; --enable`) to clear stuck X grabs, then **re-applies
  `map-to-output <id> HDMI-2`** (enable resets the coordinate matrix). Vendor-agnostic
  detection (ILITEK/Weida/Goodix/eGalax/ELAN/SiW/…); has an EXIT trap to re-enable a device if
  the service is killed mid-cycle.
- **Alerts** (Telegram) come from the **server** (`TELEGRAM_*`), not these scripts — the
  watchdogs only log to `/tmp/kiosk.log` and `/tmp/djbooth-touch-watchdog.log`.

## P2-10. Known new-unit gotchas (things that bite on a fresh unit, not an established one)

1. **Tailscale DNS hijack** right after install → can't reach R2/OpenAI/apt/GitHub. Fix:
   `sudo tailscale set --accept-dns=false`, ensure ethernet owns default route + DNS.
2. **No `~/.djbooth-display-config.sh` yet** → crowd display wrong rotation/position and the
   kiosk may land on the wrong monitor. Create it (P2-8) before relying on the screens.
3. **No audio until the USB dongle's default sink is set** (`pactl set-default-sink`). A fresh
   unit is silent even with a healthy server.
4. **`MUSIC_PATH` unconfigured = empty library**, then the **first R2 sync is huge** (hours,
   ~hundreds of GB). Expect a long first night; don't mistake the initial sync for a fault.
5. **`~/djbooth-kiosk.sh` doesn't exist until the first `~/djbooth-update.sh` run** — the
   canonical launcher + touch integration only land after an update. Run the updater once.
6. **Openbox must actually take over the session.** `x86-setup.sh` sets Openbox as default via
   AccountsService, but it needs a logout/reboot. If the unit boots into **GNOME**, the
   gnome-shell input-grab **freeze bugs return** — verify `wmctrl -m` shows Openbox.
7. **Wayland must be off.** `WaylandEnable=false` + an X11 session are required for xrandr
   rotation; needs a reboot/relogin to apply.
8. **`.env` from homebase requires homebase to be up.** If it wasn't reachable during setup,
   the unit comes up with a minimal `.env` **missing all API keys** → no voice, no R2. Re-pull
   `/api/fleet-env` or enter keys in the UI.
9. **Touch xinput id drifts and vendor detection varies** (002's Weida lacks
   `Abs MT Position X`). Always re-detect with `xinput list`; never hardcode an id.
10. **Stale self-updating updater.** A unit on disabled auto-update keeps an **old
    `~/djbooth-update.sh`** that can't reliably replace itself. If updates misbehave, re-fetch
    it: `curl -o ~/djbooth-update.sh https://raw.githubusercontent.com/jebjarrell1974-debug/dj-booth-rotation-system/main/public/djbooth-update-github.sh && chmod +x ~/djbooth-update.sh`
11. **npm install on first build can fail** (peer-deps); the server then won't start. Re-run
    with `npm install --legacy-peer-deps` inside `~/djbooth`.
12. **Two separate reboot/update mechanisms exist:** a **root** daily-reboot cron
    (`/etc/cron.d/daily-reboot`, 8am) and the **user** `@reboot` auto-update crontab. Check
    both when reasoning about when a unit reboots or updates.

---

## Operating etiquette for Claude Code

- **Never tell the operator to delete files on a unit.** If disk space is needed, ask what
  they want to remove.
- **Verify from the command line** — the operator is often 300+ miles away with no screen
  access. Don't ask them to look at the monitor.
- **Give clean, paste-ready, single-block commands** (the operator is usually on a phone,
  already SSH'd into the unit — so give the **bare** command, not `ssh unit '...'`, unless they
  say they're remote).
- **Never reboot during operating hours.** A reboot triggers boot R2 sync + (if enabled) an
  auto-update.
- **Any application bug fix happens in Replit, not on the unit.** On the unit, Claude Code
  diagnoses and may run system-level recovery (service restart, `npm install` to restore
  packages, recovery scripts that already ship on the box) — nothing more.
