# NEON AI DJ — Nightclub Entertainment Operations Network

## Overview
NEON AI DJ (Nightclub Entertainment Operations Network — Automated Intelligent Disc Jockey) is a React-based application for automating dancer rotations, managing music playback, and generating dynamic voice announcements in nightclubs. It is designed as a robust, low-power solution for hardware like the Raspberry Pi, aiming to streamline club operations and enhance the atmosphere through intelligent automation and responsive design. Key features include seamless music transitions, automated set management, and engaging announcements tailored to club hours and event types. The system also incorporates a fleet management system for centralized control, remote monitoring, updates, and content synchronization across multiple deployed units.

## User Preferences
- Nightclub dark theme with neon cyan accent (#00d4ff) and blue secondary (#2563eb)
- Deep navy-black backgrounds (#08081a, #0d0d1f) with blue-tinged borders (#1e293b)
- Neon dancer color palette for club atmosphere
- App name: "NEON AI DJ" (logo at `/public/neon-ai-dj-logo.jpeg`)
- Minimize CPU/GPU usage for local hardware operation
- Do not modify `AudioEngine.jsx` audio behavior (crossfade, ducking, gain bus architecture are finalized). The `loadTrack` method accepts both URL strings and FileSystemFileHandle objects. Voice announcements route through a separate GainNode (`voiceGainRef`) for independent volume boost (default 1.5x / 150%).
- Production database stored at `/home/runner/data/djbooth.db` (outside project directory) to survive republishing. Development uses `./djbooth.db`. Configurable via `DB_PATH` env var.

## System Architecture
The application uses React 18, Vite, and TailwindCSS for the frontend, with Radix UI primitives and shadcn/ui styling. `localStorage` manages entities, while `IndexedDB` provides fast session caching for voiceover audio. Server-side, voiceovers are stored with SQLite metadata and filesystem MP3s. State management uses React Query, and routing is handled by React Router v6. Configuration settings (API keys, voice ID, club name, hours, energy override) are stored in the browser's `localStorage` on each Pi.

Music tracks are indexed server-side in a SQLite `music_tracks` table via `server/musicScanner.js`, supporting various audio formats and genre extraction from directory structures. The server performs initial scans on startup, periodic rescans every 5 minutes, and manual rescans via API. The client fetches paginated track metadata and streams audio with Range support.

A custom dual-deck audio engine manages seamless music playback, featuring equal-power crossfading, audio ducking, auto-gain loudness normalization, a brick-wall limiter, and sophisticated announcement overlays. Voice announcements are dynamically generated using ElevenLabs TTS and OpenAI, adapting to club energy levels (5-tier system) and operating hours. Announcements include shift-based personalities, optional adult innuendo, and generic fallbacks for offline use. Transitions involve parallel pre-fetching of announcement audio and ducking, playing the announcement over the outgoing song before swapping to the next track.

An Express + SQLite backend on port 3001 manages shared dancer data and PIN authentication, with mobile-optimized playlist management. Performance is optimized for low-power devices like the Raspberry Pi 5 through throttled updates, minimal GPU effects, and memory management. Critical state persists to `localStorage` for crash recovery. Features include a 4-hour song cooldown (applies to both dancer playlist songs and random filler), configurable songs-per-set, interstitial "break songs," display-capped track lists, genre filtering, and debounced search. The `DJBooth` component remains mounted persistently (CSS-hidden) to preserve audio engine state. Robustness features include SQLite WAL mode, touch-based drag-and-drop, aggressive caching, and a Playback Watchdog for automatic recovery from audio dropouts. Playlist synchronization handles DJ overrides and server changes, with an anti-repeat system using Fisher-Yates shuffling. "DJ Remote Mode" uses Server-Sent Events (SSE) for real-time updates. Performance optimizations include gzip compression, database indexing, next-dancer track preloading, and server health endpoints. Voiceover pre-caching runs in batches, with silent fallbacks for API failures.

Every played song is logged server-side in the `play_history` SQLite table, including track name, dancer, genre, and timestamp. Logs older than 90 days are automatically cleaned.

A fleet management system enables centralized control of multiple Pi units, providing device registration, heartbeat monitoring, error log collection, voiceover sharing, music manifest tracking, app update distribution, and sync coordination. An admin dashboard offers an overview of device health, a master voiceover library, and sync history. A Pi-side sync client handles scheduled closed-hours synchronization, including uploading new voiceovers/logs and downloading content/updates. Music files are bulk-loaded via USB, with manifests tracked by the fleet system.

The application is deployed via Replit as an autoscale target, with Vite building to `dist/public/`. Production Express servers static files from `dist/public/` with SPA fallback.

## Critical Architecture Rules (READ FIRST EVERY SESSION)
1. **Server State Relay Whitelist**: When adding ANY new field to the Pi→remote broadcast in `DJBooth.jsx`, MUST ALSO add it to the server relay whitelist in `server/index.js` (POST `/api/booth/state` handler ~line 571). The server drops fields not in its whitelist.
2. **Broadcast Dependency Array**: Any new state variable in the broadcast payload in `DJBooth.jsx` MUST also be added to the useEffect dependency array (~line 822) or changes won't trigger re-broadcasts to the remote.
3. **AudioEngine.jsx**: NEVER modify audio behavior (crossfade, ducking, volume levels are finalized).
4. **Server port**: Always 3001. Do NOT change.
5. **No Suno API**: Music beds from local PROMO BEDS folder only.
6. **UI says "Entertainer" but code says `dancer`**: Do NOT rename variables.
7. **Session history**: Always read `.agents/skills/session-history/SKILL.md` at the start of each session for full context of past decisions, fixes, and architecture.

## Session Notes

### Mar 5, 2026 — Session 24 (White Screen Fix + Wi-Fi Routing + Cleanup)

#### Fix: White Screen During Updates
- **Problem**: Chrome kiosk showed "This site can't be reached" for ~30 seconds during service restarts
- **Root cause**: Update script restarted djbooth service while Chrome was still open; Chrome immediately displayed error page
- **Solution**: Update script now: (1) stops watchdog, (2) kills Chrome, (3) restarts service, (4) waits for health check, (5) relaunches Chrome, (6) restarts watchdog
- **Watchdog service** (`djbooth-watchdog.sh`): Runs as systemd service `djbooth-watchdog`, pings server every 5 seconds, auto-refreshes Chrome via xdotool F5 when server recovers from unexpected crashes
- **Race condition fix**: Update script stops watchdog before restart sequence to prevent both trying to relaunch Chrome

#### Fix: Wi-Fi Overriding Ethernet for Internet
- **Problem**: Pi connected to both ethernet (internet) and Wi-Fi (local iPad remote network with no internet). Wi-Fi took priority for all traffic, breaking API calls
- **Solution**: NetworkManager route metrics — ethernet set to 100 (priority), Wi-Fi set to 600 (local only)
- **Persistence**: Update script now auto-configures route metrics via `nmcli connection modify` on every update
- **Pi network**: Ethernet `10.1.10.41`, Wi-Fi `172.21.33.107` (ShowclubVIP network for iPad remote)

#### Fix: Playlist Save Feedback
- **Problem**: Entertainers adding songs on their phones got no feedback on whether the save succeeded or failed
- **Solution**: DancerView header now shows "Saving..." (yellow), "Saved" (green), or "Save failed!" (red)
- **File**: `src/pages/DancerView.jsx`

#### Fix: Rotation Songs Lost on Refresh
- **Problem**: Songs assigned to entertainers for the current rotation were in memory only — lost on page refresh during updates
- **Solution**: `rotationSongs` now persists to localStorage (`djbooth_rotation_songs`), loaded on mount, cleared when rotation stops
- **File**: `src/pages/DJBooth.jsx`

#### Feature: Auto Pre-Cache on Rotation Start
- **Problem**: DJs never manually pre-cached announcements, causing delays when rotation started as each announcement had to generate on the fly
- **Solution**: When "Start Rotation" is pressed, the app now automatically caches announcements before beginning:
  1. Shows a progress indicator replacing the Start button: "Caching announcements... 2/8 ready" with a progress bar
  2. Caches the first 2 entertainers' announcements (intro, round2, outro, transition) as a buffer — rotation starts after these are done
  3. Remaining entertainers cache in the background while rotation is running
  4. Already-cached announcements are skipped instantly (no delay)
  5. If announcements are disabled or no API key is set, rotation starts immediately (no caching step)
- **Existing auto-cache preserved**: The useEffect that watches rotation changes and pre-caches the next 3 upcoming entertainers still runs during active rotation
- **Files**: `src/components/dj/AnnouncementSystem.jsx` (new `preCacheForRotationStart` method), `src/pages/DJBooth.jsx` (modified `startRotation`, new `preCachingForStart` state + progress UI)

#### Cleanup: Removed Unused Code
- Removed `public/neonaidj-launcher.html` (iframe-based launcher — broken approach, caused localStorage/audio issues)
- Removed unused `/api/proxy/openai` and `/api/proxy/elevenlabs` server endpoints
- Update script reverts any autostart entries still pointing to launcher back to `http://localhost:3001`

#### Files Modified
- `server/index.js` — removed proxy endpoints
- `src/pages/DancerView.jsx` — save status feedback
- `src/pages/DJBooth.jsx` — rotation songs localStorage persistence
- `public/djbooth-update-github.sh` — kill Chrome before restart, watchdog stop/start, Wi-Fi routing, launcher revert
- `public/djbooth-watchdog.sh` — new watchdog script (auto-refresh Chrome on server recovery)
- Removed: `public/neonaidj-launcher.html`

### Mar 4, 2026 — Session 23 (Fleet Dashboard API Costs + Enhanced Fleet Metrics)

#### Feature: Per-Unit API Costs in Fleet Dashboard
- **Purpose**: Show 30-day API costs per Pi unit in the fleet dashboard (homebase), alongside CPU/memory/disk health
- **How it works**:
  1. Each Pi's heartbeat payload now includes `apiCosts: { total, elevenlabs, openai, calls, characters }` — queried from the local `api_usage` table (last 30 days)
  2. Fleet monitor stores `apiCosts` in the in-memory device map
  3. Dashboard overview endpoint merges cost data from in-memory fleet status onto DB device records
  4. Fleet-wide API cost total shown in the overview stats bar (5th stat card, emerald green)
  5. Per-device cost shown inline on DeviceCard (green dollar amount with "30d" label)
  6. Expanded cost breakdown in DeviceDetailModal: Total / ElevenLabs / OpenAI + call count
- **Note**: Costs are in-memory only — after fleet server restart, cost data clears until each Pi sends its next heartbeat (every 5 minutes)
- **Files modified**: `server/index.js` (heartbeat callback), `server/heartbeat-client.js` (payload field), `server/fleet-monitor.js` (in-memory storage + export), `server/fleet-routes.js` (overview merge), `src/pages/FleetDashboard.jsx` (DeviceCard, DeviceDetailModal, overview stats)

#### Feature: Enhanced Fleet Monitoring Metrics
- **Purpose**: Add five new health metrics to fleet dashboard for better visibility across all Pi units
- **New metrics in heartbeat payload**:
  1. **Memory usage** (`memFree`, `memTotal`, `memPct`) — RAM usage from `os.freemem()`/`os.totalmem()`, shown as percentage with color warnings (yellow >75%, red >90%)
  2. **Service uptime** (`serviceUptime`) — How long `djbooth.service` has been running, via `systemctl show`. Distinct from system uptime — catches service restarts
  3. **Last update time** (`lastUpdateTime`) — Timestamp of last `git pull` (from `.git/FETCH_HEAD` mtime). Shows "Today", "Yesterday", "3d ago" etc.
  4. **Active entertainers** (`activeEntertainers`) — Count of entertainers currently in the rotation (`liveBoothState.rotation.length`)
  5. **Error count** (`errorCount`) — Running count of `console.error()` calls since service start. Wraps native console.error to increment counter
- **Dashboard summary bar**: Added "Entertainers" card (pink) alongside existing cards
- **Device card stats grid**: Shows Memory, Service uptime, Entertainers, Errors, Last Update rows alongside existing CPU/Disk/Tracks/Version/IP
- **Files modified**: `server/heartbeat-client.js` (5 new data collectors), `server/index.js` (error counter + heartbeat callback), `public/fleet-monitor-standalone.js` (store new fields), `public/fleet-dashboard.html` (summary card + device card stats + helper functions)

### Mar 4, 2026 — Session 22 (Rotation Playlist Dropdown, Enhanced Boot Screen, API Cost Tracking)

#### Feature: Entertainer Playlist Dropdown in RotationPlaylistManager
- **Purpose**: The Rotation tab's music library panel (left half) now has the same entertainer playlist dropdown as the Library tab
- **How it works**: Dropdown at top of music library switches between "Genre Folders" (default server tracks with search/genre filter) and any active entertainer's playlist (shows their saved songs with purple ListMusic icon)
- **File**: `src/components/dj/RotationPlaylistManager.jsx`

#### Feature: Enhanced AI-Flavored Boot Screen
- **Purpose**: More visually impressive boot screen with AI/tech aesthetics
- **Changes**:
  - "SYSTEM BOOT v3.0" header + "Nightclub Entertainment Operations Network" subtitle
  - Progress bar with percentage counter and gradient shimmer animation (cyan→purple→cyan)
  - Rotating AI status lines in monospace font at bottom (20 different messages like "Initializing neural entertainment matrix", "Calibrating beat-detection algorithms", etc.)
  - Subtle scan line animation and radial glow background
  - All text uses monospace/terminal font for tech feel
  - Progress auto-fills to 95% then jumps to 100% when server reports ready
- **File**: `src/components/BootScreen.jsx`

#### Feature: Per-Unit API Cost Tracking
- **Purpose**: Track ElevenLabs and OpenAI API costs per Pi unit for billing
- **How it works**:
  1. Every API call (ElevenLabs TTS + OpenAI script generation) is logged to local SQLite `api_usage` table
  2. Server attaches its own device ID (hostname or `DEVICE_ID` env var) to each log entry
  3. Cost estimates use current API pricing: ElevenLabs $0.00003/char, OpenAI varies by model
  4. OpenAI usage tokens from API response are used when available; otherwise estimated at ~4 chars/token
  5. Entries auto-cleaned after 180 days
- **Database**: `api_usage` table with columns: device_id, service, model, endpoint, characters, prompt_tokens, completion_tokens, estimated_cost, context, created_at
- **API Endpoints**:
  - `POST /api/usage/log` — log an API call (no auth needed, device ID added server-side)
  - `GET /api/usage/summary` — get cost summary with breakdowns by device/service/day (DJ auth required)
  - `GET /api/usage/by-device` — get per-device cost breakdown (DJ auth required)
  - `GET /api/usage/device-id` — get this unit's device ID
- **Client tracker**: `src/utils/apiCostTracker.js` — exports `trackElevenLabsCall()`, `trackOpenAICall()`, `estimateTokens()`
- **Tracked call sites**: `AnnouncementSystem.jsx` (intro/outro scripts + TTS), `ManualAnnouncementPlayer.jsx` (promo TTS), `promoGenerator.js` (promo scripts), `Configuration.jsx` (bulk pre-cache scripts + TTS), `localEntities.js` (InvokeLLM fallback)
- **UI**: "API Costs" section in Configuration page showing total cost, call count, TTS characters, service breakdown, and daily cost history. Filterable by time period (7/30/90/365 days). Shows this unit's device ID
- **Files**: `server/db.js` (table + queries), `server/index.js` (endpoints), `src/utils/apiCostTracker.js` (client tracker), `src/pages/Configuration.jsx` (dashboard UI)

### Mar 4, 2026 — Session 21 (Remote Deactivate, Club Name Fix, Commercial Audio Fix, Voice Delivery Fix, Remote Break Songs, Commercial Shuffle)

#### Feature: Remote Break Songs & Commercial Markers
- **Purpose**: Allow DJ to manage break songs and see/skip commercial markers from the iPad remote, matching the local Pi rotation view
- **Break songs on remote**:
  - Each break song shows individually between entertainers with music icon + X to remove
  - When a track is selected from the music list, a dashed "Add as break song" button appears between entertainers
  - Tapping it adds the selected song as a break song and sends the update to the Pi
  - Removing sends updated interstitial songs to Pi via `updateInterstitialSongs` command
- **Commercial break markers on remote**:
  - Amber markers appear between entertainers based on commercial frequency setting
  - Each has an X to skip that specific slot, synced to the Pi via `skipCommercial` command
  - Skipped commercials from Pi's localStorage are broadcast in live state so remote stays in sync
- **Commercial frequency** now broadcast in live booth state so remote can calculate marker positions
- **New commands**: `updateInterstitialSongs` (replaces entire break songs state), `skipCommercial` (adds ID to skipped list)
- **Files**: `src/pages/DJBooth.jsx` (commands + broadcast), `src/components/dj/RemoteView.jsx` (UI)

#### Feature: Commercial Shuffle Rotation
- **Problem**: Multiple commercials were selected randomly, causing repeats and uneven airtime
- **Fix**: Fisher-Yates shuffle rotation — cycles through all saved promos before any repeats. Queue reshuffles when all have played or promo list changes
- **File**: `src/pages/DJBooth.jsx` (`promoShuffleRef` + shuffle logic in `playCommercialIfDue`)

#### Fix: VIP Spelled Out as Letters
- **Problem**: The all-caps name fix (converting GIGI→Gigi) was also converting VIP→Vip, causing ElevenLabs to say it as a word instead of individual letters
- **Fix**: Added `SPELL_OUT` exception set (VIP, DJ, MC, ATM, ID, etc.) — these get converted to "V.I.P.", "D.J." etc. with dots between letters so TTS reads them individually
- **File**: `src/components/dj/AnnouncementSystem.jsx`

#### Fix: Server State Relay Missing New Fields
- **Problem**: Remote tablet couldn't see break songs or commercial markers even though Pi was broadcasting them
- **Root cause**: `server/index.js` POST `/api/booth/state` constructs `liveBoothState` with a whitelist of fields — `interstitialSongs`, `commercialFreq`, and `skippedCommercials` were NOT in that whitelist, so the server silently dropped them
- **Fix**: Added all three fields to the server's state relay whitelist
- **Lesson**: When adding new fields to the Pi→remote broadcast in DJBooth.jsx, MUST also add them to the server relay whitelist in `server/index.js` (POST `/api/booth/state` handler around line 571)
- **File**: `server/index.js`

#### Fix: Remote Playlist Dropdown Not Alphabetical + Songs Not Loading
- **Problem 1**: Entertainer playlists in the dropdown were in database order, not alphabetical
- **Problem 2**: Selecting an entertainer's playlist showed "0 songs" even though the dropdown said "(4)"
- **Fix 1**: Added `.sort((a, b) => a.name.localeCompare(b.name))` to `allActiveDancers`
- **Fix 2**: Changed dancer ID comparison from `d.id === parseInt(musicSource)` to `String(d.id) === String(musicSource)` — HTML select values are always strings, so strict equality with parseInt could fail
- **File**: `src/components/dj/RemoteView.jsx`

#### Feature: Break Song Swap on Remote
- **Purpose**: Allow DJ to tap an existing break song to swap it with a different song from the music library
- **How it works**:
  1. Tap a break song in the rotation list — highlights cyan with pulsing "tap song to swap" label
  2. Purple banner appears above the music library: "Tap a song to replace break song"
  3. Tap any song in the library — instantly replaces the selected break song and sends update to Pi
  4. X button still removes the break song; tap again or X on banner to cancel selection
- **State**: `selectedBreakSong` tracks `{ breakKey, index }` of the break song being replaced
- **File**: `src/components/dj/RemoteView.jsx`

#### Fix: Broadcast Dependency Array Missing interstitialSongsState
- **Problem**: Changes to break songs on the Pi didn't trigger a re-broadcast to remote
- **Fix**: Added `interstitialSongsState` to the useEffect dependency array for the broadcast interval
- **File**: `src/pages/DJBooth.jsx`

#### Feature: Deactivate Song on Remote Tablet
- **Purpose**: Allow DJ to block/ban a song from the iPad remote during playback, removing it from future rotation
- **How it works**:
  1. Red "Deactivate Song" button in left controls column of RemoteView (below Voice Volume)
  2. Tapping opens a PIN entry modal with numpad — DJ enters their 5-digit PIN
  3. On 5th digit, sends `deactivateTrack` command via `boothApi.sendCommand` with PIN + track name
  4. DJBooth receives command, verifies PIN via `POST /api/auth/login`, uses returned token for `POST /api/music/block`, then skips
  5. Modal shows "Deactivate Sent" confirmation for 1.5s before auto-closing
  6. Button disabled when no track is playing
- **Files**: `src/pages/DJBooth.jsx` (deactivateTrack command handler), `src/components/dj/RemoteView.jsx` (button + PIN modal UI)

#### Fix: Club Name "the" Prefix in Announcements
- **Problem**: AI was generating "the Pony" in contexts where just "Pony" sounds natural (e.g., "here at the Pony" instead of "here at Pony", "the Pony's finest" instead of "Pony Nation")
- **Fix**: Added explicit CLUB NAME USAGE RULE in the announcement prompt — tells AI to treat club name as proper noun, never prefix with "the", and suggests compound phrases like "Pony Nation", "Pony family", "here at Pony"
- **Priority**: Rule placed right after SYSTEM_PROMPT (2nd position) for maximum AI compliance
- **File**: `src/utils/energyLevels.js`

#### Fix: Commercial Music Bed Volume Fluctuation
- **Problem**: During promo/commercial playback, the background music bed underneath the voice was rapidly fluctuating up and down — a disturbing "pumping" effect
- **Root cause**: `detectVoiceActivity()` in audioMixer.js was splitting speech into many tiny regions (every syllable pause). Each region triggered a separate duck→unduck→duck cycle on the music gain
- **Fix**: Added region merging with 0.8s gap threshold — voice regions separated by less than 0.8 seconds are merged into one continuous region, so the music stays smoothly ducked during continuous speech. Also fixed duck timing to avoid conflicts with the initial music fade-in
- **Note**: Existing saved promos keep old audio; regenerate them for the fix to apply
- **File**: `src/utils/audioMixer.js`

#### Fix: Voice Shouting Entertainer Name on Final Mention
- **Problem**: ElevenLabs was yelling the entertainer's name on the third/final mention in intros, especially noticeable with names like "Gigi"
- **Fix**: Added DELIVERY RULE to intro prompt — final name mention should be "smooth, cool, and confident — NOT shouted." No exclamation marks on final name. Examples updated to model smooth endings like "Coming to the stage, the one and only ${name}."
- **File**: `src/utils/energyLevels.js`

### Mar 4, 2026 — Session 20 (Promo Creator, Commercial Scheduling, Music Search Fix, Pronunciation Fix)

#### Feature: AI Promo Creator
- **Purpose**: Generate radio-quality event promo commercials directly from the DJ booth. DJ fills in event details, app generates a professional promo with AI script + ElevenLabs voice + instrumental music bed
- **How it works**:
  1. DJ enters event details (name, date, time, venue, extras) and selects vibe (Hype/Party/Classy/Chill) + duration (15s/30s/60s)
  2. `promoGenerator.js` builds a track-structured prompt with energy arcs and sends to OpenAI or Replit LLM
  3. AI returns a punchy radio script structured like a track: First Impact → Build → Info Drop → Peak Escalation → CTA → Hard Out
  4. Script is sent to ElevenLabs TTS with radio-announcer voice settings (stability 0.45, style 0.45, speed 0.88)
  5. Music bed is fetched from "PROMO BEDS" genre folder in the music library (random or user-selected track)
  6. `audioMixer.js` uses OfflineAudioContext to mix voice over music: stereo output, music fades in, ducks during speech (voice activity detection), fades out at end
  7. Output is a stereo WAV blob — can preview, download, or save to announcement library as type 'promo'
- **UI**: ManualAnnouncementPlayer now has tabbed interface: "Create Promo" | "Upload". Progress bar shows 5 steps (Script → Voice → Music → Mix → Done). Script is editable before regenerating. "New Bed" remixes with different music track
- **Music beds**: Uses tracks from a folder called "PROMO BEDS" in the music library on each Pi (`/home/<user>/Desktop/DJ MUSIC/PROMO BEDS/`). Genre match is case-insensitive. Tracks sync via R2 across fleet like all other music
- **Audio mixing details**: Voice activity detection with 50ms blocks, music ducks to 6% during speech (0.3s attack, 0.5s release), 0.8s fade-in, 2.5s fade-out, 1.2s voice delay
- **Prompt architecture**: "Design It Like a Track, Not an Ad" — uses section-based timing model with energy arcs, controlled chaos density (high density for short spots, rising density for long spots), duration-aware runtime modes (Short Burst 15s, Standard Spot 30s, Extended Hype 60s), vibe-specific escalation curves
- **Files**: `src/utils/promoGenerator.js` (AI prompt + script generation), `src/utils/audioMixer.js` (OfflineAudioContext mixing + WAV encoding + voice activity detection), `src/components/dj/ManualAnnouncementPlayer.jsx` (tabbed UI + promo form)

#### Feature: Commercial Frequency Setting
- **Purpose**: Control how often promos/commercials play during the rotation — off, every set, every other set, or every 3rd set
- **UI**: "Commercials" dropdown button on Options page, placed right below Energy Level. Shows current setting, opens a dropdown with radio-button-style options: Off, Every Set, Every Other Set, Every 3rd Set. Button lights up blue when active
- **How it works**:
  1. Setting stored in `localStorage` as `neonaidj_commercial_freq` (values: 'off', '1', '2', '3')
  2. `commercialCounterRef` tracks entertainer transitions in DJBooth
  3. At each entertainer transition (handleSkip and handleTrackEnd — both direct and post-interstitial paths), `playCommercialIfDue()` checks if the counter hits the frequency threshold
  4. When due, fetches a random promo/manual announcement from `/api/voiceovers` and plays it via the audio engine's `playAnnouncement` method
  5. Commercial plays in the gap between entertainers, before the next entertainer's transition announcement
- **Files**: `src/components/dj/DJOptions.jsx` (dropdown UI), `src/pages/DJBooth.jsx` (playCommercialIfDue function + integration into all 4 transition paths)

#### Fix: Music Search Bypasses Genre Filter
- All 4 music browser views (RotationPlaylistManager, PlaylistEditor, RemoteView, DancerView) now ignore genre filtering when a search query is active, so search results aren't limited to the selected genre
- PlaylistEditor genre pills replaced with compact dropdown

#### Fix: ElevenLabs All-Caps Name Pronunciation
- All-caps names (AVA, GIGI, MIMI) were spelled out letter-by-letter by TTS
- Pre-TTS conversion now lowercases 2+ letter all-caps words to title case before applying pronunciation map
- Pronunciation map regex uses case-insensitive flag (`/gi`)

#### Fix: Genre Query Case-Insensitive
- `getMusicTracks()` in `server/db.js` now uses `COLLATE NOCASE` for genre matching
- Ensures folder names like "PROMO BEDS", "Promo Beds", "promo beds" all match regardless of case

#### Important Reminders for Future Sessions
- **Music IS synced to R2** — `syncMusicToR2()` and `syncMusicFromR2()` exist in `server/r2sync.js`. Music uploads/downloads from `music/` prefix in R2 bucket. Music library is shared across fleet
- **Voiceovers are ALSO synced to R2** — separate from music, stored in voiceovers directory
- **Pi music path**: `/home/<user>/Desktop/DJ MUSIC/` (set via `MUSIC_PATH` env in systemd service)
- **Promo Beds path on Pi**: `/home/<user>/Desktop/DJ MUSIC/PROMO BEDS/`

### Mar 4, 2026 — Session 19 (Entertainer Side-Session, Pronunciation Fixes)

#### Fix: Entertainer Portal No Longer Kills Music
- **Problem**: On the Pi kiosk (single browser), logging in as an entertainer replaced the DJ auth session, which unmounted PersistentDJBooth and killed the music
- **Solution**: Added "dancer side-session" — when an entertainer logs in while DJ is already authenticated on a local (non-remote) device, the dancer auth is stored separately in `dancerSession` state without touching the DJ session
- **How it works**:
  1. `AuthContext` stores `dancerSession` alongside the main DJ auth (`user`/`role`/`isAuthenticated`)
  2. On login, if `role === 'dj' && isAuthenticated && !isRemoteMode()` and dancer is logging in, the dancer token goes into `dancerSession` instead of replacing the main auth
  3. `ProtectedRoute` allows DancerView access when `dancerSession` is set
  4. `DancerView` sets a token override (`setTokenOverride`) so its API calls use the dancer token
  5. Token override is path-scoped: DJ paths (`/booth/`, `/settings/`, `/auth/`, etc.) always use the main DJ token, preventing bleed
  6. 401 errors on override-token requests dispatch `djbooth-dancer-session-expired` (not the DJ session expired event)
  7. On entertainer logout/timeout, `dancerSession` is cleared and navigation returns to `/DJBooth` (not `/`)
  8. `PersistentDJBooth` stays mounted (hidden) the entire time — music keeps playing
- **Files**: `src/lib/AuthContext.jsx`, `src/App.jsx`, `src/pages/Landing.jsx`, `src/pages/DancerView.jsx`, `src/api/serverApi.js`

#### Pronunciation Fixes
- Added to `PRONUNCIATION_MAP` in AnnouncementSystem.jsx: Mimi → Mee-Mee, Ava → Ay-vuh, Gigi → Jee-Jee

### Mar 4, 2026 — Session 18 (Beat Matching + Club-Locked Voiceovers)

#### Feature: Club-Locked Voiceovers
- **Purpose**: Prevent club-specific voiceovers (that mention a club by name) from playing at other clubs. The demo Pi travels between venues, so changing the club name in config instantly switches which voiceovers are active
- **How it works**:
  1. Club name is encoded in the cache key: `intro-ASHLEY-L3-Cponynation` (the `-C` suffix)
  2. When no club name is set, no suffix is added → voiceover is "universal" (shared everywhere)
  3. When a club name IS set, the AI prompt includes the club name, and the cache key includes the club tag → voiceover is club-specific
  4. Cache key separation means different clubs naturally get different voiceovers
  5. All voiceovers stay saved locally forever — nothing is deleted when switching clubs
  6. Playback is automatically filtered because cache key lookups include the current club suffix
- **R2 sync filtering**: When downloading from R2, filenames are checked for a `-C` club tag. Files tagged for a different club are skipped (saves bandwidth on permanent installations). Universal voiceovers (no `-C` tag) always sync
- **Database**: `voiceovers` table has new `club_name TEXT` column (nullable, NULL = universal). Migration runs automatically
- **Server**: `POST /api/voiceovers` accepts optional `club_name` field. Upload to R2 includes `clubName` in object metadata
- **Files**: `server/db.js` (column + migration), `server/r2sync.js` (upload metadata + download filtering), `server/index.js` (pass club through endpoints), `src/components/dj/AnnouncementSystem.jsx` (cache key suffix + save with club name)

### Mar 4, 2026 — Session 18 (Beat Matching)

#### Feature: Beat-Matched Crossfading
- **Purpose**: During crossfades, the incoming track's tempo is adjusted to match the outgoing track's BPM, then gradually returns to natural speed — like a real DJ
- **How it works**:
  1. BPM detection runs during track analysis (same audio fetch/decode as auto-gain, no extra network request)
  2. Peak detection algorithm analyzes first 30 seconds of audio to find dominant tempo (70-180 BPM range)
  3. BPM values are cached per-track in `bpmCacheRef` (alongside auto-gain cache)
  4. During crossfade, incoming deck's `playbackRate` is set to `outgoingBPM / incomingBPM` (clamped to +/-12%)
  5. Rate gradually ramps back to 1.0 during the crossfade (at 1.5x the fade rate, so it reaches natural speed before fade completes)
  6. Once crossfade finishes, `playbackRate` is explicitly set to 1.0
- **Safety**: If BPM detection fails on either track, beat matching is skipped and normal crossfade runs. Micro-crossfades (skip/manual) don't use beat matching. Max rate adjustment is 12% to avoid noticeable pitch distortion
- **Toggle**: On/off switch in Options page above Music EQ, persisted to `localStorage` key `neonaidj_beat_match`, default OFF
- **API**: `audioEngineRef.current.setBeatMatch(bool)`, `audioEngineRef.current.getBeatMatchEnabled()`
- **Files**: `src/components/dj/AudioEngine.jsx` (BPM detection + crossfade rate adjustment), `src/components/dj/DJOptions.jsx` (toggle UI)
- **Note**: `analyzeTrackLoudness` now returns `{ gain, bpm }` object instead of plain number

### Mar 3, 2026 — Session 17 (Auto-Play on Boot)

#### Feature: Auto-Play Music on Boot
- **Purpose**: Music plays immediately when the Pi boots — no DJ login required. The login screen stays visible for anyone who needs to access controls, but the DJBooth and AudioEngine are already running behind it
- **How it works**:
  1. `AuthContext` auto-calls `POST /api/auth/auto-login` on startup (localhost-only, no PIN needed)
  2. Server creates a DJ session, returns token — PersistentDJBooth renders and AudioEngine starts
  3. DJBooth's existing auto-play logic picks a random track and starts playing
  4. Landing page does NOT auto-redirect on auto-login — only redirects after manual PIN entry
  5. When a DJ enters their PIN, they navigate to `/DJBooth` and see the already-running session
- **Security**: `/api/auth/auto-login` is locked to localhost only (checks `req.ip` for 127.0.0.1/::1). Remote clients get 403
- **Pi requirement**: Chromium must have `--autoplay-policy=no-user-gesture-required` flag (already in kiosk setup)
- **Files**: `src/lib/AuthContext.jsx` (auto-login attempt), `src/pages/Landing.jsx` (manual-only redirect), `server/index.js` (auto-login endpoint)

### Mar 3, 2026 — Session 16 (EQ, Specials Timing, Pronunciation)

#### Feature: 3-Band EQ for Music and Voice
- **Purpose**: Compensate for audio quality differences between Bluetooth and RCA/DAC output on Pi units. Bluetooth codecs add warmth; DAC gives flat output that sounds thinner
- **Implementation**: BiquadFilter nodes inserted into existing Web Audio chains without modifying gain bus architecture
- **Music chain**: musicBusGain → eqBass (lowshelf 200Hz) → eqMid (peaking 1kHz) → eqTreble (highshelf 4kHz) → limiter
- **Voice chain**: voiceGain → eqBass (lowshelf 200Hz) → eqMid (peaking 1kHz) → eqTreble (highshelf 4kHz) → destination
- **Range**: -12 to +12 dB per band, with "Reset to flat" button
- **Persistence**: Saved to localStorage (`neonaidj_music_eq`, `neonaidj_voice_eq`), restored on startup
- **UI**: Two EQ sections in Options tab (Music EQ and Voice EQ) with horizontal sliders
- **Files**: `src/components/dj/AudioEngine.jsx` (filter nodes + setMusicEq/setVoiceEq methods), `src/components/dj/DJOptions.jsx` (slider UI), `src/pages/DJBooth.jsx` (passes audioEngineRef to DJOptions)

#### Fix: Club Specials Only During Transitions
- **Problem**: Club specials (drink deals, dance specials) were being announced during intros and round twos — awkward because the dancer is on stage and not available for private dances yet
- **Fix**: Club specials now only included in `outro` (calling dancer off stage) and `transition` (gap between dancers) announcement prompts
- **File**: `src/utils/energyLevels.js` (condition added to clubSpecials block)

#### Fix: Pronunciation Corrections
- **Yasmine**: Was pronounced "Yaz-mean", now "Yazmen" in PRONUNCIATION_MAP
- **Mia**: Was pronounced "M.I.A." (spelled out), changed from "Mee-ah" to "Meeyah" for smoother TTS output
- **File**: `src/components/dj/AnnouncementSystem.jsx`

### Mar 3, 2026 — Session 15 (Fleet Command Center)

#### Feature: Fleet Command Center Dashboard
- **Purpose**: Web-based dashboard on HOMEBASE to monitor and control all Pi fleet units from any device (phone, laptop, tablet)
- **URL**: `http://100.70.172.8:3001/` (HOMEBASE Tailscale IP)
- **Features**:
  - Real-time device cards: name, club, status, CPU temp, disk space, uptime, track count, voiceover count, current song/entertainer, last heartbeat
  - Remote commands per device: Update (pulls from GitHub), Restart (systemd restart), Sync Voiceovers (R2 sync)
  - "Update All" and "Sync All" global actions for all online devices
  - Telegram test alert button
  - PIN entry (stored in browser, forwarded to Pi for validation)
  - Auto-refreshes every 30 seconds
  - Mobile-responsive neon dark theme
- **Architecture**: HOMEBASE fleet monitor relays commands to each Pi's Tailscale IP on port 3001. Pi validates the master PIN locally.
- **Files**: `public/fleet-monitor-standalone.js` (enhanced with command relay + dashboard serving), `public/fleet-dashboard.html` (new)

#### Feature: Admin Command Endpoints on Pi Server
- **Endpoints** (all PIN-protected via master PIN):
  - `POST /api/admin/update` — runs `~/djbooth-update.sh` in background
  - `POST /api/admin/restart` — restarts djbooth systemd service
  - `POST /api/admin/reboot` — full Pi reboot (confirmation prompt on dashboard)
  - `POST /api/admin/sync` — triggers full R2 voiceover sync (download + upload)
- **Requires sudoers**: `USERNAME ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart djbooth, /usr/bin/systemctl stop djbooth, /usr/bin/systemctl start djbooth, /usr/sbin/reboot`
- **File**: `server/index.js`

#### Feature: Standalone Fleet Monitor on "raspberrypi"
- **Problem**: Fleet monitoring was running on the same Pi it was supposed to watch — if the Pi goes offline, it can't alert about itself. Replit deployment kept failing at the "promotion" stage.
- **Solution**: Created a standalone fleet monitor script (`public/fleet-monitor-standalone.js`) that runs on the home Pi called "HOMEBASE" (hostname: raspberrypi, Tailscale IP `100.70.172.8`). This is a zero-dependency Node.js script (no npm install needed) that receives heartbeats and sends Telegram alerts.
- **Setup details**:
  - HOMEBASE username: `jebjarrell`, Node via nvm at `/home/jebjarrell/.nvm/versions/node/v22.22.0/bin/node`
  - `djbooth` service disabled on HOMEBASE — it only runs `fleet-monitor` service now
  - Systemd service runs without `User=` directive (runs as root) to avoid 217/USER errors
  - Ponynation's `FLEET_SERVER_URL` updated from `localhost:3001` to `http://100.70.172.8:3001`
- **Endpoints**: `POST /api/monitor/heartbeat`, `GET /api/monitor/status`, `POST /api/monitor/test-telegram`, `POST /api/monitor/command/:deviceId/:action` (relay)
- **File**: `public/fleet-monitor-standalone.js`
- **Setup guide**: See "Fleet Monitor Server Setup" section in session-history skill

#### Setup: VNC Remote Desktop Access
- **Purpose**: See and control the Pi's full desktop remotely from phone or laptop
- **Enable**: `sudo raspi-config nonint do_vnc 0` then `sudo vncpasswd -service`
- **Connect**: VNC viewer app (RealVNC Viewer) → Pi's Tailscale IP on port 5900
- **Added to setup guide**: Step 11

#### Fix: Voiceover Path Standardized to ~/djbooth/voiceovers
- **Problem**: Voiceovers were saved to `~/Desktop/VOICE OVERS FOR AUTO DJ` — outside the app directory, hard to find, and inconsistent across fleet
- **Fix**: Changed `VOICEOVER_PATH` in systemd service to `/home/USERNAME/djbooth/voiceovers`. This is inside the app directory, survives updates (the update script doesn't touch it), and is the folder R2 syncs to/from
- **Migration for existing Pi**: Update systemd service VOICEOVER_PATH, restart — R2 auto-downloads all voiceovers to new folder
- **Ponynation (neonaidj001)**: Migrated successfully — 829 voiceovers downloaded from R2 to ~/djbooth/voiceovers/
- **Files**: `.agents/skills/session-history/SKILL.md` (setup guide updated)

### Mar 3, 2026 — Session 14 (Telegram Fix, Genre Dropdown, Voice Tuning)

#### Fix: Fleet Monitor DB Recovery on Startup
- **Problem**: If the Replit server restarted, all fleet devices were lost from memory. Offline Pis wouldn't trigger Telegram alerts because they weren't tracked
- **Fix**: `loadDevicesFromDb()` runs at startup before the check interval begins. Loads all known devices from `fleet_devices` table, calculates their status based on last heartbeat timestamp
- **File**: `server/fleet-monitor.js`

#### UI: Genre Folders Compact Dropdown
- **Problem**: DJOptions showed every genre folder as a full-width checkbox button, filling the screen on clubs with many folders
- **Fix**: Replaced with a compact dropdown that opens a scrollable checklist overlay. Shows selected count summary, click-outside to close, All/None quick buttons
- **File**: `src/components/dj/DJOptions.jsx`

#### Fix: Voice Speed Tuning (Turbo v2.5 Too Fast)
- **Problem**: ElevenLabs Turbo v2.5 model speaks faster than old models, voiceovers sounded rushed
- **Fix**: Reduced speed values across all 5 energy levels (L1: 0.82, L2: 0.88, L3: 0.92, L4: 0.90, L5: 0.85). Previously ranged 0.92-1.05
- **Voiceover date filter**: Bumped `VOICEOVER_VALID_AFTER` to `2026-03-04` so all old cached voiceovers regenerate with new speed settings
- **Files**: `src/utils/energyLevels.js`, `server/db.js`

#### Feature: Energy-Based Excitement Cues in Prompts
- **Problem**: Prime time voiceovers sounded same energy as early/late shifts
- **Fix**: Added `excitement` field to each SHIFT_TYPE with explicit delivery instructions. Prime shift gets "THIS IS THE PEAK — deliver with maximum excitement!" cue. Voice `style` parameter also increased for prime levels (0.50/0.55 vs 0.15/0.25 for early/mid)
- **Files**: `src/utils/energyLevels.js`

### Mar 3, 2026 — Session 13 (Voiceover Cleanup + Settings Tab)

#### Feature: Clear All Voiceovers Button
- **Purpose**: One-click reset of all cached voiceovers so they regenerate fresh with the current voice engine (eleven_turbo_v2_5)
- **Configuration UI**: Red "Clear All Voiceovers (N)" button appears below Voiceover Library stats when count > 0. Confirmation prompt before deletion
- **API**: `DELETE /api/voiceovers` endpoint clears all voiceover files from disk and database records
- **Files**: `src/pages/Configuration.jsx`, `server/index.js`, `server/db.js`

#### Feature: Startup Orphan Voiceover Cleanup
- **Purpose**: Automatically detect and remove database entries for voiceover files that no longer exist on disk (e.g., manually deleted files)
- **Implementation**: `cleanupOrphanedVoiceovers()` runs at startup in `initR2Sync()`, before cloud sync begins
- **Files**: `server/db.js`, `server/index.js`

#### UI: Settings Tab in Nav Bar
- **Change**: Moved "Settings" from a small gear icon in the top-right corner to a proper labeled tab in the main nav bar, placed right after "Options"
- **Behavior**: Opens the same Settings modal (API keys, voice config, announcement settings)
- **Only shown in non-remote mode** (not on iPad DJ Remote)
- **File**: `src/pages/DJBooth.jsx`

### Mar 2, 2026 — Session 12 (Break Song Fix + Song Deactivation)

#### Fix: Break Songs Completely Ignored During Playback
- **Problem**: Break songs assigned in the rotation (manually or via auto-select) were never played. System skipped directly from one entertainer to the next
- **Root cause**: `handleSkip` (which runs on skip button press and remote skip commands) had zero break song logic in its "last song of set" branch. It jumped straight to the next entertainer without checking `interstitialSongsRef` for assigned break songs
- **Fix 1**: Added full break song support to `handleSkip`'s else branch — checks for manual break songs, falls back to auto-selecting from `/api/music/select` if `breakSongsPerSet > 0`, plays first break song with outro announcement, sets `playingInterstitialRef` so subsequent break songs play via `handleTrackEnd`
- **Fix 2**: Auto-selected break songs now persisted in both `handleSkip` AND `handleTrackEnd` — previously auto-selected songs were stored only in a local variable, so multi-break sequences (2+ songs) would lose track after the first. Both paths now write to `interstitialSongsRef`, `interstitialSongsState`, `interstitialRemoteVersion`, and localStorage
- **File**: `src/pages/DJBooth.jsx`

#### Feature: Song Deactivation (Per-Club Song Blocking)
- **Purpose**: Each club can permanently block songs from playing — deactivated songs are excluded from all music selection, random fills, and genre counts
- **Database**: Added `blocked` (INTEGER DEFAULT 0) and `blocked_at` (TEXT) columns to `music_tracks` table with migration for existing databases. The `bulkUpsertTracks` upsert only updates name/genre/size/modified_at on conflict, so the blocked flag survives daily rescans
- **Queries updated**: `getMusicTracks`, `getMusicGenres`, `getRandomTracks`, `selectTracksForSet`, `getMusicTrackCount` all filter `WHERE blocked = 0`
- **API endpoints**: `POST /api/music/block` (DJ only), `POST /api/music/unblock` (DJ only), `GET /api/music/blocked` (authenticated)
- **DJ Booth UI**: Red "Deactivate" button in the tab bar (between Announcements and Stop Rotation). Pressing it blocks the currently playing song and immediately skips to the next track
- **Configuration UI**: "Deactivated Songs" section shows all blocked tracks with song name, genre, date blocked, and a green "Reactivate" button to restore each one
- **Files**: `server/db.js`, `server/index.js`, `src/pages/DJBooth.jsx`, `src/pages/Configuration.jsx`

### Mar 1, 2026 — Session 11 (Deep Entertainer Rename)

#### Fix: Club Specials Sticking in Voiceovers After Removal
- **Problem**: When a club special (e.g. "Tonight is Teena's birthday") was entered, voiceovers were cached with that special baked in. After removing the special, cached voiceovers still mentioned it
- **Root cause**: Cache key was `type-name-L#` — didn't include club specials, so clearing specials still hit the old cached version
- **Fix**: Cache key now includes a hash of the active specials (`-S<hash>` suffix). When specials change or are cleared, the key changes and fresh voiceovers are generated
- **Temporary by design**: Voiceovers with specials are only cached in the browser session (IndexedDB), NOT saved to the permanent server cache. This prevents temporary promotions from polluting the long-term voiceover library
- **No specials = normal behavior**: When the specials box is empty, the key has no suffix and voiceovers load from the permanent server cache as before
- **File**: `src/components/dj/AnnouncementSystem.jsx`

#### "Dancer" → "Entertainer" — Complete Pass
- **Previous session**: Renamed display text in main UI components (DancerRoster, RemoteView, StageRotation, RotationBuilder, DJOptions, Landing, DancerView, DJBooth tabs)
- **This session**: Deep pass catching all remaining user-facing "dancer" text across the entire codebase:
  - **Help page** (`src/pages/Help.jsx`): All 12 sections updated — Getting Started, Options, Rotation, Entertainers Tab, Music Library, Announcements, Configuration, Rotation Display, Entertainer View, iPad Remote, Music Tips
  - **Configuration page** (`src/pages/Configuration.jsx`): Toast messages, announcement descriptions, pre-cache labels
  - **RotationPlaylistManager** (`src/components/dj/RotationPlaylistManager.jsx`): Rotation counter, empty state, toast messages
  - **DJBooth** (`src/pages/DJBooth.jsx`): Tab label, skip toast message
  - **RemoteView** (`src/components/dj/RemoteView.jsx`): Empty state message
  - **FleetDashboard** (`src/pages/FleetDashboard.jsx`): Active entertainers label
  - **AI prompts** (`src/utils/energyLevels.js`): System prompt style rules, terminology lock, transition structure instructions
  - **Server error messages** (`server/index.js`): PIN taken, create/update/delete/playlist error responses
- **Rule preserved**: Variable names, API routes, database fields, query keys all still use `dancer` — only user-facing display text changed

### Mar 1, 2026 — Session 10 (Break Songs on Remote, Playlist Stability, Song Reassignment Analysis)

#### Feature: Break Songs Displayed on Remote
- **Purpose**: iPad remote now shows break songs under each dancer in the rotation list
- **UI**: Violet bar with ♫ icon below each dancer card showing their assigned break song names
- **Data flow**: `interstitialSongs` state broadcast from DJBooth to remote via `liveBoothState`; `interstitialRemoteVersion` counter syncs state to RotationPlaylistManager without triggering on local Save All
- **Files**: `src/components/dj/RemoteView.jsx`, `src/pages/DJBooth.jsx`

#### Fix: Break Song Auto-Population
- **Problem**: Break songs weren't auto-populating when count changed from remote or Pi
- **Fix**: Shared `autoPopulateBreakSongs(count)` function used by both local UI and remote command handlers. Setting count to 0 clears all break songs. Fires immediately on change
- **State sync**: `interstitialSongsState` + `interstitialRemoteVersion` counter pattern ensures React re-renders RotationPlaylistManager when remote changes break count, without re-triggering when local Save All fires
- **Files**: `src/pages/DJBooth.jsx`, `src/components/dj/RotationPlaylistManager.jsx`

#### Fix: Playlist Stability (Save All No Longer Reshuffles)
- **Problem**: Save All was triggering auto-population and reshuffling existing song assignments
- **Fixes applied**:
  1. Save All now just saves — no auto-population side effects
  2. Song assignment effect only fires for new dancers (skips those with existing songs via `songAssignmentsRef`)
  3. Songs-per-set changes preserve existing songs, only add/trim at the end
  4. Second effect guarded by `prevSongsPerSetRef` to prevent reshuffling on `dancers` prop changes
- **Files**: `src/pages/DJBooth.jsx`, `src/components/dj/RotationPlaylistManager.jsx`

#### Feature: Remote Display — Dancer Song Lists + Break Songs
- **Purpose**: Remote rotation tab now shows each dancer's assigned song list and break songs
- **Data flow**: `plannedSongAssignments` state in DJBooth receives song assignments from RotationPlaylistManager via `onSongAssignmentsChange` prop; merged with `rotationSongs` in broadcast
- **Files**: `src/pages/DJBooth.jsx`, `src/components/dj/RotationPlaylistManager.jsx`, `src/components/dj/RemoteView.jsx`

#### Fix: Club Day Name in Announcements
- **Problem**: After midnight, announcements said "Sunday night" instead of "Saturday night" (the club is still operating Saturday's shift)
- **Fix**: Before 6 AM, use `now - 6hrs` for day name so Saturday night stays Saturday until close
- **File**: `src/utils/energyLevels.js`

#### Feature: Cloudflare R2 Cloud Sync (Voiceovers + Music)
- **Purpose**: Centralized cloud storage for voiceovers and music across all Pi fleet units in different cities/states
- **Service**: Cloudflare R2 (S3-compatible, zero download fees, ~$7.50/month at 500 GB)
- **Bucket**: `neonaidj` in Eastern North America (ENAM)
- **Credentials**: Stored as env vars — `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` (secret), `R2_SECRET_ACCESS_KEY` (secret), `R2_BUCKET_NAME`
- **Auto-sync on boot**: Server startup runs `initR2Sync()` — downloads missing voiceovers from cloud, uploads local voiceovers to cloud, downloads missing music files
- **Auto-upload on save**: Every new voiceover saved via `/api/voiceovers` is automatically uploaded to R2 in the background
- **Sync logic**: Compares file names and sizes — skips files that already exist locally/remotely with matching size
- **API endpoints**:
  - `GET /api/r2/status` — shows cloud storage stats (file counts, sizes)
  - `POST /api/r2/sync/voiceovers` — manual sync (direction: upload/download)
  - `POST /api/r2/sync/music` — manual sync (direction: upload/download)
- **Storage layout**: `voiceovers/` prefix for voice MP3s, `music/` prefix for song files (preserves folder structure for genres)
- **New file**: `server/r2sync.js` — S3Client wrapper with upload/download/list/sync functions
- **New dependency**: `@aws-sdk/client-s3`
- **Files modified**: `server/index.js` (import, voiceover upload hook, API endpoints, boot sync), `server/db.js` (exported `getVoiceoverDirPath`)

#### Feature: Boot Status Screen
- **Purpose**: Shows visual progress during startup so the user knows the app is loading and can wait before using it
- **Server**: `bootStatus` object tracks each phase (server, music scan, voiceover sync/upload, music sync/upload); exposed via `GET /api/boot-status`
- **Frontend**: `BootScreen` component polls `/api/boot-status` every 1.5s, shows NEON AI DJ branding with step-by-step progress (pending/running/done/error icons), fades out when all steps complete
- **Music auto-upload on boot**: Music now uploads to R2 on every boot (in addition to downloading), so new tracks on any Pi get shared to the fleet
- **Files**: `server/index.js` (boot status tracking), `src/components/BootScreen.jsx` (new), `src/App.jsx` (renders BootScreen overlay)

#### Feature: Fleet Monitoring with Telegram Alerts
- **Purpose**: Proactive monitoring — get notified on your phone when a Pi goes offline or comes back online
- **Telegram bot**: @NEONAIDJ_bot sends alerts to user's Telegram
- **Heartbeat system**: Each Pi sends a heartbeat every 5 minutes to its local server (includes CPU temp, disk space, uptime, track count, app status)
- **Alerting**: If a Pi misses 2 heartbeats (10 min), Telegram alert fires. Recovery notification when it comes back
- **Env vars**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (stored as Replit env vars + Pi override), `FLEET_SERVER_URL` (Pi only), `DEVICE_ID`, `CLUB_NAME`
- **API endpoints**: `POST /api/fleet/heartbeat` (Pi → server), `GET /api/fleet/status` (dashboard), `POST /api/fleet/test-telegram` (test alert)
- **New files**: `server/fleet-monitor.js` (monitoring server + Telegram sender), `server/heartbeat-client.js` (Pi heartbeat client)
- **Files modified**: `server/index.js` (imports, route setup, start/stop in boot/shutdown)

#### Pending: ElevenLabs Voice Upgrade
- **Status**: User is redoing their personal voice clone on ElevenLabs
- **When ready**: Upgrade TTS model from `eleven_monolingual_v1` to v2 or v3, tune stability/similarity_boost values, update voice ID if it changes
- **File to change**: `src/components/dj/AnnouncementSystem.jsx` (model_id, stability, similarity_boost)

#### Analysis: Song Reassignment Timing (Not Fixed — Monitoring)
- **Observation**: With 2 dancers and 1-song sets, when dancer A finishes and flips to bottom, her new song doesn't appear until ~5 seconds before dancer B finishes
- **Root Cause**: Assignment system skips dancers who still have old (played) songs in `songAssignmentsRef`. Old songs aren't cleared on flip, so new assignment waits for a different trigger
- **Decision**: Left as-is per user request — works acceptably in real-world rotations with more dancers. Second cycle was faster (cached data). Will revisit if needed

#### Voiceover Cost Analysis
- 300 names × 5 energy levels = 453,000 max voiceovers (~$1,632 pre-generated at ElevenLabs rates)
- Practical cost much lower since transitions are generated on-demand and cached
- Only intro/outro/round2 pre-cached; transitions cached as they occur

### Mar 1, 2026 — Session 9 (Remote Sync, Volume Controls, Break Songs, Announcements, Song Repeat Fix)

#### Fix: Song Repetition (Cooldown Bypass)
- **Problem**: Dancers with manual playlists (e.g. Cameron with 2 Joan Jett songs) got the exact same songs every rotation cycle. Code was reusing cached songs for playlist dancers without checking 4-hour cooldown
- **Fix**: Removed all `hasManualPlaylist + cached songs` shortcuts from `beginRotation`, `handleTrackEnd` (both break-song and no-break paths), and `handleSkip`. All transitions now always call `getDancerTracks()` which properly enforces cooldown exclusions
- **File**: `src/pages/DJBooth.jsx`

#### Feature: Voice Gain Boost (Mic Volume)
- **Purpose**: Announcements now route through a Web Audio API GainNode, allowing volume boost above 100% (up to 300%)
- **Default**: 150% gain. Persisted to localStorage as `djbooth_voice_gain`
- **Pi UI**: Purple mic icon with +/- buttons next to music volume controls (10% increments, min 50%, max 300%)
- **Remote UI**: Separate "Voice" row with purple mic icon and +/- buttons in volume section. Sends `setVoiceGain` command
- **AudioEngine changes**: Added `voiceGainRef`, `voiceSourceRef`, voice element routed through gain node on first announcement play. `setVoiceGain()` exposed via imperative handle
- **Server**: `liveBoothState` now stores `voiceGain` field for remote sync
- **Files**: `src/components/dj/AudioEngine.jsx`, `src/pages/DJBooth.jsx`, `src/components/dj/RemoteView.jsx`, `server/index.js`

#### UI: Energy Level Controls Moved to Options Tab
- **Before**: Energy level dropdown + badge in header bar (took space)
- **After**: Energy level buttons (Auto/L1/L2/L3/L4/L5) in Options tab above Music Selection Mode. Header still shows current level badge (read-only indicator)
- **Files**: `src/components/dj/DJOptions.jsx`, `src/pages/DJBooth.jsx`

#### Fix: Announcement Script Improvements
- **Shift type references removed**: AI was literally saying "mid shift" / "prime shift" in announcements. Prompt now labels shift info as "internal guidance only — NEVER say these words out loud"
- **Round 2 context fix**: AI was saying "coming back to the stage" during round 2 when dancer never left. Prompt now explicitly states she's STILL ON STAGE with BAD EXAMPLES of what NOT to say. Output capped to 1-2 sentences
- **Pronunciation map**: Added phonetic mappings for dancer names ElevenLabs mispronounces (Mia→Mee-ah, Chaunte→Shawn-tay, Charisse→Sha-reese, Tatianna→Tah-tee-ah-nah, Nadia→Nah-dee-ah). Applied in `generateAudio()` before sending to TTS. Possessive forms also mapped
- **Name repetition**: Intro and transition say dancer name 2-3 times (varies naturally, not fixed). Round 2 and outro say name once
- **Files**: `src/utils/energyLevels.js`, `src/components/dj/AnnouncementSystem.jsx`

#### Feature: Song Countdown Timer on Remote
- **Purpose**: Remote (iPad) now shows the same countdown timer as the Pi player bar
- **Data flow**: Pi broadcasts `trackTime`, `trackDuration`, `trackTimeAt` in booth state. Remote interpolates locally every 250ms for smooth countdown between updates
- **UI**: Cyan countdown next to track name on RemoteView player and DJBooth remote-mode header
- **Files**: `src/pages/DJBooth.jsx`, `src/components/dj/RemoteView.jsx`, `server/index.js`

#### Fix: Remote Responsiveness
- **Command polling** (remote → Pi): 3s → 1s fallback when SSE drops
- **State polling** (Pi → remote): 3s → 1s fallback when SSE drops
- **State broadcast interval**: 5s → 2s heartbeat (also fires immediately on any state change via React deps)
- SSE delivers commands/state instantly when connected; polling is safety net only
- **File**: `src/pages/DJBooth.jsx`

#### Fix: Playlist Song Resolution (RotationPlaylistManager)
- **Problem**: Initial song assignment matched playlist songs against client-side `tracks` array (only 200 of 8,875 loaded); dancers' playlist songs failed to match, fell through to random
- **Fix**: useEffect now calls `/api/music/select` server endpoint for initial assignment, resolving against full database. Batch excludes prevent cross-dancer duplicates. Falls back to client-side tracks only if server fails
- **File**: `src/components/dj/RotationPlaylistManager.jsx`

#### Feature: Master Volume Control (Plus/Minus Buttons)
- **Pi interface**: Replaced slider with `[ - ] 80% [ + ]` buttons (5% increments) in playback controls bar
- **Manager Remote**: Same plus/minus buttons in left sidebar, sends `setVolume` command via SSE
- **Architecture**: App volume controls `masterGain` node (music only); voice announcements use separate `<audio>` element bypassing masterGain (intentional — Pi system volume controls voice level independently)
- **Server**: `liveBoothState` now stores `volume` field for remote sync
- **Files**: `src/pages/DJBooth.jsx`, `src/components/dj/RemoteView.jsx`, `server/index.js`

#### Feature: Break Songs Count Selector (0/1/2/3)
- **Purpose**: Set how many auto-selected break songs play between dancers during transitions
- **State**: `breakSongsPerSet` (default 0) with ref, stored in `liveBoothState` for remote sync
- **UI**: Purple-highlighted buttons next to Songs/Set selector on both Pi (RotationPlaylistManager) and Remote
- **Auto-selection**: When `breakSongsPerSet > 0` and no manual break songs assigned, calls `/api/music/select` to pick random songs during transition. Manual break song assignments take priority
- **Remote command**: `setBreakSongsPerSet` with `{ count }` payload
- **Files**: `src/pages/DJBooth.jsx`, `src/components/dj/RotationPlaylistManager.jsx`, `src/components/dj/RemoteView.jsx`, `server/index.js`

#### Fix: Remote Sync Reliability (Polling Fallback)
- **Problem**: SSE connections silently die on club WiFi; remote shows stale state and commands don't reach Pi
- **Fix**: Added 3-second polling fallback on both sides as backup to SSE:
  - **Pi mode**: Polls `/booth/commands` every 3s (in addition to SSE listener). Command deduplication via `lastCommandIdRef.current` prevents double execution
  - **Remote mode**: Polls `/booth/state` every 3s (in addition to SSE listener). Only updates if `state.updatedAt` is present
- **Files**: `src/pages/DJBooth.jsx`

#### Feature: Announcement Name Repetition
- **Intro announcements**: Dancer name now said 2-3 times, spaced naturally throughout (not clustered)
- **Transition announcements**: Incoming dancer name 2-3 times; outgoing dancer name once
- **Round 2 / Outro**: Unchanged (single name mention)
- **Implementation**: Added `NAME REPETITION RULE` instruction block to intro and transition templates, plus updated example scripts
- **File**: `src/utils/energyLevels.js`

### Feb 28, 2026 — Session 8 (Script Generation Improvements)

#### Feature: Script Model Selection
- **Purpose**: Let the DJ choose which AI model generates announcement scripts
- **Options**: Auto (built-in AI, no key needed), GPT-4o, GPT-4o Mini, GPT-4.1, GPT-4.1 Mini
- **Config fields**: `scriptModel` stored in localStorage via `apiConfig.jsx`
- **OpenAI direct call**: When model is not 'auto' and OpenAI key is set, `generateScript` in AnnouncementSystem calls OpenAI chat completions directly (temp 0.9, freq_penalty 0.6, pres_penalty 0.4, max_tokens 200). Falls back to InvokeLLM when model is 'auto' or no key.
- **Pre-cache consistency**: Configuration.jsx pre-cache now uses the same OpenAI direct-call path when configured
- **Files**: `src/components/dj/AnnouncementSystem.jsx`, `src/components/apiConfig.jsx`, `src/pages/DJBooth.jsx`, `src/pages/Configuration.jsx`

#### Feature: Club Specials in Announcements
- **Purpose**: Let the DJ enter drink specials, promotions, etc. that get woven into announcements naturally
- **Config field**: `clubSpecials` stored as newline-separated text in localStorage via `apiConfig.jsx`
- **Prompt integration**: `buildAnnouncementPrompt` in `energyLevels.js` accepts `clubSpecials[]` array and weaves them into the system prompt
- **UI**: Textarea in both DJBooth settings and Configuration page, one special per line
- **Files**: `src/utils/energyLevels.js`, `src/pages/DJBooth.jsx`, `src/pages/Configuration.jsx`

#### Feature: Prompt Enhancements (Terminology Lock + Rhythm Rules)
- **Terminology Lock**: System prompt enforces "round two"/"round three" instead of "around" (common AI mistake)
- **Rhythm Rules**: Max 2 sentences per line, 6-16 words per sentence, speakable over bass music
- **File**: `src/utils/energyLevels.js`

#### Audio Normalization — Auto-Gain + Limiter
- **Auto-Gain**: Analyzes first 10 seconds of each track via OfflineAudioContext to calculate RMS loudness. Computes gain multiplier to match target -14 LUFS, clamped between 0.3x–2.5x. Results cached per URL (up to 200 entries). 5-second fetch timeout with graceful fallback to 1.0x on failure
- **Limiter**: DynamicsCompressorNode inserted between MusicBusGain and MasterGain. Threshold -6dB, ratio 20:1, knee 3dB, attack 0.002s, release 0.1s. Prevents peaks from distorting speakers
- **Audio chain**: `Deck → DeckGain(auto-gain) → MusicBusGain → Limiter → MasterGain → destination`
- **Crossfade**: Incoming deck fades to its auto-gain value (not hardcoded 1.0). Outgoing deck fades from whatever gain it had. Ducking unchanged (operates on MusicBusGain, before limiter)
- **Toggle**: `setAutoGain(bool)` exposed via imperative handle. Defaults to enabled
- **CPU impact**: Near zero — OfflineAudioContext runs once per track load, DynamicsCompressorNode runs on native audio thread
- **File**: `src/components/dj/AudioEngine.jsx`

#### FEATURE Track Support (Full-Length Playback)
- **Problem**: Feature performers need songs to play to completion, not capped at 3 minutes
- **Detection**: Songs in the `FEATURE/` subfolder of the music library have `genre='FEATURE'`
- **AudioEngine change**: Added `maxDurationOverrideRef` + `setMaxDuration(seconds)` method. Override replaces `MAX_SONG_DURATION` (180s) for one track, then auto-resets to null
- **DJBooth change**: `isFeatureTrack()` checks `track.genre === 'FEATURE'` or `track.path` starts with `FEATURE/`. Calls `setMaxDuration(3600)` before playing feature tracks
- **Normal songs**: Unaffected — still capped at 180s. Override only set for FEATURE tracks and auto-clears
- **Files**: `src/components/dj/AudioEngine.jsx` (override mechanism), `src/pages/DJBooth.jsx` (detection + trigger)

#### Help Page
- **Route**: `/Help` (DJ login required)
- **Access**: Help button with question mark icon in the DJBooth tab bar, next to Options
- **Content**: 12 collapsible sections covering every feature — Getting Started, Options, Rotation, Entertainers, Music Library, Announcements, Settings, Configuration, Rotation Display, Entertainer View, iPad Remote, Music Tips
- **Design**: Matches app theme (neon cyan headers, navy-black backgrounds, accordion sections)
- **File**: `src/pages/Help.jsx`

#### Configuration Page — Master PIN Lock
- **Change**: Configuration page now requires master PIN to access (DJ PIN rejected)
- **Flow**: Lock screen → enter PIN → login via `/api/auth/login` → verify against `/api/settings/master-pin` → unlock
- **Server data**: Master PIN and music path fetched after unlock (not on mount) since token doesn't exist until then
- **Club Specials**: Removed from Configuration, kept only in DJBooth.jsx announcements section
- **File**: `src/pages/Configuration.jsx`

#### Remote Fleet Update (Phone-Triggered)
- **Endpoint**: `POST /api/system/update` — PIN-protected (master or DJ PIN), runs `~/djbooth-update.sh` or `~/djbooth-update-github.sh`
- **Behavior**: Sends response immediately ("Update started"), then runs script after 1s delay so HTTP response completes before server restarts
- **UI**: "Remote Update" section in Configuration page — add Pi IPs (stored in `djbooth_fleet_ips` localStorage), "Check All" pings `/api/version`, "Update All" sends update command to all Pis
- **Files**: `server/index.js` (endpoint), `src/pages/Configuration.jsx` (UI)

#### Rewrite: Strip Club DJ Announcement Prompts
- **Problem**: AI-generated scripts sounded like a generic hype-man, not a real strip club DJ. Intros lacked buildup, outros didn't push VIP, and scripts felt robotic.
- **Fix**: Complete rewrite of `buildAnnouncementPrompt` in `energyLevels.js` with:
  - Few-shot example scripts for each type based on real strip club DJ delivery
  - Name-at-end rule (dancer name always lands at the end of a sentence for impact)
  - Direct audience commands ("get those dollars ready", "make it rain", "don't let her walk away lonely")
  - VIP/private dance upsell on every outro and transition
  - Day-of-week awareness (e.g., "doing it right on a Friday night")
  - Type-specific structure: intros = 3-5 sentences (big buildup), round 2/3 = 1-3 sentences (short/punchy), outros = 2-4 sentences (VIP push), transitions = 3-5 sentences (thank + hype)
- **File**: `src/utils/energyLevels.js`

#### Rebrand: DJ Booth → NEON AI DJ
- **App name**: Changed all user-visible "DJ Booth" references to "NEON AI DJ"
- **Logo**: Landing page shows `/public/neon-ai-dj-logo.jpeg` (NEON AI DJ branding image)
- **Color scheme**: Magenta/violet → neon cyan/blue to match the logo
  - `#e040fb` → `#00d4ff` (neon cyan primary)
  - `#c026d3` → `#00a3cc` (darker cyan hover)
  - `#7c3aed` → `#2563eb` (blue secondary)
  - `#1e1e3a` → `#1e293b` (blue-tinged borders)
- **Updated**: `index.html` title, `manifest.json`, Landing.jsx, DJBooth.jsx header, Configuration.jsx, server console logs, all component accent colors
- **NOT changed**: Internal localStorage keys (`djbooth_*`), file names, route paths, variable names — preserves backwards compatibility with existing Pi installations

#### Optimization: Touchscreen (Pi Kiosk)
- **Purpose**: Pi touchscreen is the primary interface — optimize all touch interactions for fat-finger use
- **Global CSS** (`src/index.css`): Disabled text selection (except inputs/textareas), tap highlights, touch callouts, overscroll bounce; enabled `touch-action: manipulation` (eliminates 300ms tap delay and double-tap zoom); active-state opacity feedback on all buttons
- **Touch targets**: All buttons, role=button, labels enforce 44px minimum height/width. Button `icon` variant bumped from 36px to 44px. All inline `w-6`/`w-7`/`w-8` icon button overrides changed to `w-11` (44px) across DancerRoster, PlaylistEditor, StageRotation, RotationBuilder, RotationPlaylistManager
- **Transport controls** (NowPlaying): Skip button enlarged to 56px (matches play/pause) for easy mid-set tapping
- **Slider** (`src/components/ui/slider.jsx`): Thumb from 16px to 28px, track from 6px to 12px — much easier to grab on touchscreen
- **Scroll areas**: Momentum scrolling (`-webkit-overflow-scrolling: touch`) and contained overscroll on all Radix scroll areas
- **Performance impact**: Zero — all changes are pure CSS properties, no additional JS, no GPU layers, no animations
- **Files**: `src/index.css`, `src/components/ui/button.jsx`, `src/components/ui/slider.jsx`, `src/components/dj/DancerRoster.jsx`, `src/components/dj/PlaylistEditor.jsx`, `src/components/dj/StageRotation.jsx`, `src/components/dj/RotationBuilder.jsx`, `src/components/dj/RotationPlaylistManager.jsx`, `src/components/dj/NowPlaying.jsx`

#### Bug Fix: Song Repeating
- **Problem 1**: `rotationSongsRef` cached songs at rotation start but reused them for later dancers without rechecking cooldown. If a dancer's turn came after a long wait, their cached songs (now on cooldown from earlier play) would repeat.
- **Fix 1**: All three cache-reuse paths (beginRotation, handleSkip transition, handleTrackEnd transition) now verify every cached song is off-cooldown before reusing. If any song is on cooldown, fresh tracks are fetched via `getDancerTracks`.
- **Problem 2**: Local fallback in `getDancerTracks` used `available` pool (100-track local subset minus already-assigned) when all off-cooldown songs ran out, which was too small to find fresh songs.
- **Fix 2**: Fallback chain is now: offCooldown → available → validTracks (entire local pool). Only falls through when the previous tier can't fill the needed count.
- **File**: `src/pages/DJBooth.jsx`

### Feb 28, 2026 — Session 7 (Break Song Ducking, Rotation Flip, Pre-Cache Fix)

#### Bug Fix: Break Song Ducking
- **Problem**: When the last dancer song ended and break songs were next, the break song started via crossfade BEFORE the outro announcement ducked — so no duck was heard
- **Fix**: Reordered to match dancer-to-dancer pattern: duck → play outro announcement → start break song during announcement → unduck
- **Files**: `src/pages/DJBooth.jsx` (handleTrackEnd break songs block)

#### Bug Fix: Rotation Flip Timing
- **Problem**: Dancer stayed at top of rotation list during break songs, only moved to bottom after ALL break songs finished
- **Fix**: Flip rotation visually (`setRotation`, `setCurrentDancerIndex`, `updateStageState`) immediately when break songs start. Refs (`rotationRef`, `currentDancerIndexRef`) left unchanged so interstitial handler can still look up break songs by dancer ID. Post-interstitial handler syncs refs when break songs finish.
- **Files**: `src/pages/DJBooth.jsx`

#### Feature: Smart Voiceover Pre-Cache
- **Problem**: Pre-cache only triggered on new dancer IDs added to rotation, not on reorder. Transition announcements (e.g. "Thank you Stacy, welcome Sage") were never auto-cached. All dancers fired simultaneously causing API rate limits.
- **Fix**: New `preCacheUpcoming` method in AnnouncementSystem that:
  1. Caches next 3 dancers in rotation (intro, round2, outro, AND transition)
  2. Watches rotation order + currentDancerIndex (not just ID membership)
  3. Cancels in-flight pre-cache when rotation changes
  4. 2-second stagger between uncached API calls; cached items return instantly
  5. 2-second debounce before starting pre-cache after rotation change
- Old `preCacheDancer` method retained for single-dancer additions (addDancer)
- SSE remote rotation handler updated to use `preCacheUpcoming`
- **Files**: `src/components/dj/AnnouncementSystem.jsx`, `src/pages/DJBooth.jsx`

#### Rebuild: AudioEngine — Web Audio API with Gain Bus Architecture
- **Problem**: Multiple ducking bugs — double duck sound, volume drift after several dancers, duck too slow (4.5s), crossfade and duck animations fighting over `.volume` on same Audio elements
- **Root Cause**: Old engine used `requestAnimationFrame` to manually set `.volume` on Audio elements for both crossfading AND ducking. These separate animation loops fought each other. Duck was 4.5 seconds (too slow). No gain separation.
- **Fix**: Complete rebuild using Web Audio API:
  1. **Signal chain**: Deck A/B → deckGainNode (crossfade) → musicBusGain (ducking) → masterGain (volume) → destination
  2. **Ducking** uses `exponentialRampToValueAtTime` on `musicBusGain` — 200ms attack, 600ms release. Completely independent of crossfade.
  3. **Crossfading** operates on deck-level GainNodes with equal-power curves via `requestAnimationFrame`
  4. **Volume** controlled via `masterGainRef` — consistent across all decks and crossfades
  5. **MediaElementSource** tracked per Audio element identity to prevent duplicate creation (browser restriction)
  6. Voice plays through separate HTML5 Audio element (not routed through Web Audio) — independent of ducking
  7. `DUCK_SETTLE_MS` reduced from 2600ms to 300ms in DJBooth.jsx to match new fast duck
- **External interface unchanged**: `playTrack`, `duck`, `unduck`, `playAnnouncement`, `pause`, `resume`, `setVolume`, `seek`
- **Files**: `src/components/dj/AudioEngine.jsx`, `src/pages/DJBooth.jsx`

#### Feature: Booth IP for iPad Remote
- **Problem**: iPad remote had no way to specify which Pi to connect to; with multiple fleet units this is essential
- **Fix**:
  1. Login screen shows "Booth IP Address" input when "DJ Remote" is selected
  2. IP stored in `localStorage` as `djbooth_booth_ip`
  3. All API calls and SSE connections dynamically use `http://{ip}:3001/api` when IP is set, or relative `/api` when blank
  4. CORS enabled on Express server for cross-origin iPad connections
  5. Options tab shows Pi's local IP addresses under "Remote Connection" section
  6. SSE reconnection now detects expired sessions and kicks to login (backoff retry)
- **Files**: `server/index.js`, `src/api/serverApi.js`, `src/pages/Landing.jsx`, `src/components/dj/DJOptions.jsx`

### Feb 28, 2026 — Session 6 (Break Songs Persistence)

#### Bug Fix: Break Songs Disappearing on Tab Switch
- **Problem**: DJ sets break songs between each dancer's set, hits Save All, then navigates to another tab (Dancers, Options, etc.) and comes back — all break songs are gone
- **Root Cause**: `interstitialSongs` state in `RotationPlaylistManager.jsx` was initialized as `{}` on every mount. Since the component unmounts when switching tabs, all break song data was lost. `interstitialSongsRef` in DJBooth.jsx kept the data in memory but never passed it back to the component on re-mount
- **Fix**:
  1. Break songs now persist to `localStorage` as `djbooth_interstitial_songs` (saved on every change and on Save All)
  2. `RotationPlaylistManager` initializes from `savedInterstitials` prop (from DJBooth ref) or falls back to `localStorage`
  3. `DJBooth.jsx` loads break songs from `localStorage` on mount via IIFE in `useRef`
  4. New `savedInterstitials` prop passes current break songs from DJBooth into RotationPlaylistManager
- **Files**: `src/pages/DJBooth.jsx`, `src/components/dj/RotationPlaylistManager.jsx`

### Feb 27, 2026 — Session 5 (Music Library Scaling for 30k+ Songs)

#### Feature: Incremental Music Scanner
- **Problem**: Full scanner walked and stat'd all 30k files every 5 minutes, causing disk I/O spikes that compete with audio streaming
- **Fix**: Scanner now compares file paths and sizes against previous scan — only changed/new files are upserted, only removed files are deleted
- **Quick check**: Top-level directory count + DB track count compared before even walking the filesystem — if unchanged, scan is skipped entirely
- **Scan interval**: Changed from 5 minutes to 30 minutes (manual rescan still available)
- **Files**: `server/musicScanner.js`

#### Feature: Server-Side Track Selection (`/api/music/select`)
- **Problem**: DJBooth loaded 500 tracks into browser memory and selected from that pool — limited variety with 30k+ songs, wasted browser RAM on Pi
- **Fix**: New `POST /api/music/select` endpoint handles all track selection server-side. Client sends: count needed, cooldown names to exclude, active genres, dancer playlist. Server returns exactly the right tracks with streaming URLs
- **Fallback**: If server request fails, DJBooth falls back to local pool selection (graceful degradation)
- **Browser memory**: Reduced initial track load from 500 to 100 (used for UI display only, not playback selection)
- **Files**: `server/db.js` (`selectTracksForSet`), `server/index.js` (new endpoint), `src/pages/DJBooth.jsx` (`getDancerTracks`)

#### Feature: Efficient Random Sampling
- **Problem**: `ORDER BY RANDOM() LIMIT N` scans and sorts entire table — O(n log n) on 30k rows
- **Fix**: Index-based sampling using `WHERE id >= randomId LIMIT 1` — O(1) per lookup. Falls back to `ORDER BY RANDOM()` only if index sampling doesn't find enough tracks (e.g., heavy genre filtering)
- **File**: `server/db.js` (`getRandomTracks`)

#### Feature: Read-Only Database Connection
- **Problem**: Scanner write transactions could block read queries (track lookups during playback)
- **Fix**: Separate `readDb` connection opened in read-only mode for all SELECT queries. Write operations (scanner, settings, play history) use the primary `db` connection. WAL mode ensures zero contention
- **File**: `server/db.js`

#### Break Song Server Fallback
- **Problem**: Break songs looked up in local 100-track pool — with 30k songs, most won't be found locally
- **Fix**: All break song lookups now fall back to `resolveTrackByName` (server API) when local lookup fails
- **File**: `src/pages/DJBooth.jsx`

### Feb 27, 2026 — Session 3 (DJ Options + Genre Filtering + Cooldown Overhaul)

#### Feature: DJ Options Panel
- **Purpose**: Let DJ control music source mode and active genres from main DJ Booth or iPad Remote
- **File**: `src/components/dj/DJOptions.jsx` (new component)
- **Modes**:
  - "Dancer First" (default): Uses dancer playlists when available, fills remaining slots from active genres
  - "Folders Only": Ignores dancer playlists entirely, uses only server-scanned music folders filtered by active genres
- **Genre Selection**: Checkboxes for each genre/folder found on the server; stored as `dj_active_genres` (JSON array) in SQLite settings table
- **Server API**: `GET/POST /api/dj-options` — persists `musicMode` and `activeGenres`
- **SSE Broadcast**: `djOptions` event broadcasts changes to all connected clients (iPad changes instantly reflected on Pi)
- **Integration in DJBooth.jsx**: `djOptions` state + `djOptionsRef` ref, loaded on mount, updated via SSE

#### Feature: Genre Filtering in Rotation Playlist Manager
- **File**: `src/components/dj/RotationPlaylistManager.jsx`
- Added `filterByGenres()` helper that filters tracks by active genres (falls back to full list if filter yields 0 results)
- All filler track selections now use genre-filtered pool
- Track browser in rotation panel also filtered by active genres
- In "Folders Only" mode, dancer playlists are skipped entirely — all songs come from genre-filtered server pool
- `djOptions` prop passed from DJBooth.jsx

#### Feature: Options Tab in iPad Remote
- **File**: `src/components/dj/RemoteView.jsx`
- Added "Options" tab (with SlidersHorizontal icon) to the right panel tab bar
- Embeds full `DJOptions` component — DJ can change music mode and genres from iPad
- Props `djOptions` and `onOptionsChange` passed through from DJBooth.jsx

#### Genre Filtering in Playback Engine
- `getDancerTracks` and `playFallbackTrack` in DJBooth.jsx now respect active genres
- `getRandomTracks` in `server/db.js` accepts genre filter parameter

#### Bug Fix: Folder Names Showing as "(Root folder)"
- **Problem**: DJ Options panel showed every music folder as "(Root folder)" instead of the actual folder name
- **Root Cause**: SQL query `getMusicGenres()` in `server/db.js` returns `genre as name` (aliased to `name`), but `DJOptions.jsx` referenced `g.genre` which was `undefined`, falling through to the "(Root folder)" fallback
- **Fix**: Changed all references in `DJOptions.jsx` from `g.genre` to `g.name` — `selectAll`, `toggleGenre`, key, display, and active check
- **File**: `src/components/dj/DJOptions.jsx`

#### Feature: Pre-Cache on Save All
- **Problem**: Announcement pre-caching wasn't firing when rotation was saved from the Pi
- **Fix**: Added pre-cache trigger inside the `onSaveAll` handler in `DJBooth.jsx` — when DJ hits Save All, all dancers in rotation get their announcements pre-cached
- **Staggering**: Each dancer starts 2 seconds apart (1s, 3s, 5s, etc.) to avoid hammering the ElevenLabs API
- **Safe**: `preCacheDancer` checks if announcements are already cached and skips them, so repeated Save All calls are harmless
- **Background**: Uses `setTimeout` — fires even when navigating to other tabs since DJBooth stays mounted (CSS-hidden)
- **File**: `src/pages/DJBooth.jsx` (inside `onSaveAll` callback)

#### Song Cooldown Overhaul (4-Hour Anti-Repeat)
- **Problem**: Dancer playlist songs played every set with no cooldown; when all songs were on cooldown, filler came from the same genre folder repeatedly
- **Changes**:
  1. **Cooldown reduced from 5 hours → 4 hours** (`COOLDOWN_MS` in `DJBooth.jsx`)
  2. **Dancer playlist songs now respect cooldown**: Songs played in the last 4 hours are filtered out of the dancer's set. If 1 of 3 songs is on cooldown, the other 2 play and 1 random filler fills the gap
  3. **When all playlist songs are on cooldown**: The entire set is filled with random songs from the full catalog (not restricted to the dancer's genre folder)
  4. **Filler songs also respect 4-hour cooldown**: Random replacements won't repeat within 4 hours either
  5. **Genre preference maintained when possible**: Filler tries active genre folders first, falls back to full catalog if not enough off-cooldown songs exist
- **File**: `src/pages/DJBooth.jsx` (`getDancerTracks` function)

### Feb 27, 2026 — Session 4 (DancerView White Screen Fix)

#### Bug Fix: DancerView White Screen (React Error #31)
- **Problem**: When dancers opened their phone view, the page crashed to a pure white screen
- **Root Cause**: `/api/music/genres` returns objects like `{name: "Pop", count: 5}`, but DancerView treated them as plain strings. When genres rendered in JSX filter buttons, React received objects instead of strings → "Objects are not valid as a React child" (minified error #31)
- **Fix**: Normalize genre data to string names on fetch: `.map(g => typeof g === 'string' ? g : g.name)`
- **File**: `src/pages/DancerView.jsx` (line 56)

#### Feature: React ErrorBoundary
- **Problem**: Any React crash resulted in a white screen with no information
- **Fix**: Added `ErrorBoundary` class component wrapping the entire app in `src/App.jsx`
- **Behavior**: Catches render errors, shows dark-themed error page with the error message and a "Go Back" button that navigates to `/`
- **File**: `src/App.jsx`

### Feb 27, 2026 — Session 2 (Fixes + iPad Remote)

#### Bug Fix: Dancer View White Screen
- **Problem**: When dancers tapped "Add Songs" on their phone, the page would crash to a white screen
- **Root Cause**: `DancerView.jsx` loaded playlist and genres in a single `Promise.all()`. If the genre fetch failed (e.g., auth issue), the catch block redirected to `/` (login), causing a white screen
- **Fix**: Separated genre fetch from playlist fetch — genre failure is silently caught, dancer still sees their playlist
- **File**: `src/pages/DancerView.jsx` (lines 45-62)

#### Bug Fix: Playlist Songs Being Erased
- **Problem**: When the DJ assigned songs to a dancer's set during rotation, it would replace the dancer's entire saved playlist with just the new rotation songs, erasing all previously saved songs
- **Root Cause**: `onAutoSavePlaylist` and `onSaveAll` in `DJBooth.jsx` sent the current rotation songs (just 2-3 songs) directly as the dancer's playlist via `updateDancerMutation`, overwriting the full saved playlist
- **Fix**: Both callbacks now fetch the dancer's existing playlist, merge new songs in (skipping duplicates), then save the merged list
- **File**: `src/pages/DJBooth.jsx` (lines 2396-2433)
- **How it works**: `const merged = [...existingPlaylist]; for (song of newSongs) { if (!merged.includes(song)) merged.push(song); }`

#### Tuning: Audio Duck Transition
- **Problem**: Auto-duck sounded too harsh/abrupt when announcements started and ended
- **Fix**: Changed `DUCK_TRANSITION` constant from `2.5` to `4.5` seconds for a gentler fade
- **File**: `src/components/dj/AudioEngine.jsx` (line 10)
- **Note**: Only the timing constant was changed — no logic or curve modifications

#### Feature: iPad DJ Remote View
- **Purpose**: iPad on club WiFi acts as a remote control for the Pi's DJ Booth (no audio playback on iPad)
- **How to use**: Open Pi's IP in iPad Safari → tap "DJ / Manager Remote" → enter DJ PIN
- **File**: `src/components/dj/RemoteView.jsx` (new file)
- **Integration**: `DJBooth.jsx` early-returns `<RemoteView>` when `remoteMode=true` (Pi rendering path completely untouched)
- **Layout**: Landscape split-panel optimized for handheld iPad
  - Left panel (340px): Now Playing card (dancer name, song #, track), Skip + Announcements buttons (64px tall), Songs/Set selector
  - Right panel: Tabbed Rotation list (with reorder arrows, remove buttons) and Dancers list (with add/remove from rotation)
- **Touch**: All buttons 44px+ touch targets, `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation`
- **CSS**: Added `.remote-view` styles in `src/index.css`
- **No server changes**: Uses existing SSE (`connectBoothSSE`) + command API (`boothApi.sendCommand`)

### Feb 27, 2026 — Session 1 (Migration + Features)
- Migrated project to new Repl environment, installed all packages, verified app runs
- Configured deployment: `server/boot.cjs` as production entry, `npm run build` for build step
- Built frontend successfully (`dist/public/`)
- Published app to Replit
- Added quick rotation management buttons to Dancer Roster page:
  - Green **+ Add to Rotation** button on each dancer card (when not in rotation)
  - Red **- In Rotation** button on each dancer card (when already in rotation)
  - Allows fast rotation changes without switching to the Rotation tab
  - Files changed: `src/components/dj/DancerRoster.jsx`, `src/pages/DJBooth.jsx`
- Cleaned up stray import artifacts (`sed3CnVAv`, `zipFile.zip`)
- Removed "Add to rotation" dancer buttons section from Rotation tab (no longer needed with Dancers page buttons)
  - File changed: `src/components/dj/RotationPlaylistManager.jsx`
- Fixed dancer phone view to use real server music catalog instead of empty songs table
  - Genre filter pills (horizontal scroll, mobile-optimized)
  - Search with debounce, paginated results (100 at a time)
  - Track name + genre label display
  - Files changed: `src/pages/DancerView.jsx`, `src/api/serverApi.js` (added `musicApi`)
- GitHub backup pushed

## External Dependencies
- **React**: Frontend UI development
- **Vite**: Project build tool
- **TailwindCSS**: Utility-first CSS framework
- **Radix UI**: Unstyled UI component primitives
- **shadcn/ui**: Component styling
- **React Query (TanStack Query)**: Data fetching and caching
- **React Router v6**: Client-side routing
- **ElevenLabs TTS**: Text-to-Speech API
- **OpenAI**: AI model for announcement script generation
- **Express**: Backend web application framework
- **SQLite**: Database for multi-user dancer data and music catalog