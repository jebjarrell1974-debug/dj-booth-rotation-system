# NEON AI DJ — Nightclub Entertainment Operations Network

## Overview
NEON AI DJ (Nightclub Entertainment Operations Network — Automated Intelligent Disc Jockey) is a React-based application for automating dancer rotations, managing music playback, and generating dynamic voice announcements in nightclubs. It is designed as a robust, low-power solution for hardware like the Raspberry Pi, aiming to streamline club operations and enhance the atmosphere through intelligent automation and responsive design. Key features include seamless music transitions, automated set management, and engaging announcements tailored to club hours and event types. The system also incorporates a fleet management system for centralized control, remote monitoring, updates, and content synchronization across multiple deployed units.

## User Preferences
- Nightclub dark theme with neon cyan accent (#00d4ff) and blue secondary (#2563eb)
- Deep navy-black backgrounds (#08081a, #0d0d1f) with blue-tinged borders (#1e293b)
- Neon dancer color palette for club atmosphere
- App name: "NEON AI DJ" (logo at `/public/neon-ai-dj-logo.jpeg`)
- Minimize CPU/GPU usage for local hardware operation
- Do not modify `AudioEngine.jsx` audio behavior (crossfade, ducking, volume levels are finalized). The `loadTrack` method accepts both URL strings and FileSystemFileHandle objects.
- Production database stored at `/home/runner/data/djbooth.db` (outside project directory) to survive republishing. Development uses `./djbooth.db`. Configurable via `DB_PATH` env var.

## System Architecture
The application uses React 18, Vite, and TailwindCSS for the frontend, with Radix UI primitives and shadcn/ui styling. `localStorage` manages entities, while `IndexedDB` provides fast session caching for voiceover audio. Server-side, voiceovers are stored with SQLite metadata and filesystem MP3s. State management uses React Query, and routing is handled by React Router v6. Configuration settings (API keys, voice ID, club name, hours, energy override) are stored in the browser's `localStorage` on each Pi.

Music tracks are indexed server-side in a SQLite `music_tracks` table via `server/musicScanner.js`, supporting various audio formats and genre extraction from directory structures. The server performs initial scans on startup, periodic rescans every 5 minutes, and manual rescans via API. The client fetches paginated track metadata and streams audio with Range support.

A custom dual-deck audio engine manages seamless music playback, featuring equal-power crossfading, audio ducking, auto-gain loudness normalization, a brick-wall limiter, and sophisticated announcement overlays. Voice announcements are dynamically generated using ElevenLabs TTS and OpenAI, adapting to club energy levels (5-tier system) and operating hours. Announcements include shift-based personalities, optional adult innuendo, and generic fallbacks for offline use. Transitions involve parallel pre-fetching of announcement audio and ducking, playing the announcement over the outgoing song before swapping to the next track.

An Express + SQLite backend on port 3001 manages shared dancer data and PIN authentication, with mobile-optimized playlist management. Performance is optimized for low-power devices like the Raspberry Pi 5 through throttled updates, minimal GPU effects, and memory management. Critical state persists to `localStorage` for crash recovery. Features include a 4-hour song cooldown (applies to both dancer playlist songs and random filler), configurable songs-per-set, interstitial "break songs," display-capped track lists, genre filtering, and debounced search. The `DJBooth` component remains mounted persistently (CSS-hidden) to preserve audio engine state. Robustness features include SQLite WAL mode, touch-based drag-and-drop, aggressive caching, and a Playback Watchdog for automatic recovery from audio dropouts. Playlist synchronization handles DJ overrides and server changes, with an anti-repeat system using Fisher-Yates shuffling. "DJ Remote Mode" uses Server-Sent Events (SSE) for real-time updates. Performance optimizations include gzip compression, database indexing, next-dancer track preloading, and server health endpoints. Voiceover pre-caching runs in batches, with silent fallbacks for API failures.

Every played song is logged server-side in the `play_history` SQLite table, including track name, dancer, genre, and timestamp. Logs older than 90 days are automatically cleaned.

A fleet management system enables centralized control of multiple Pi units, providing device registration, heartbeat monitoring, error log collection, voiceover sharing, music manifest tracking, app update distribution, and sync coordination. An admin dashboard offers an overview of device health, a master voiceover library, and sync history. A Pi-side sync client handles scheduled closed-hours synchronization, including uploading new voiceovers/logs and downloading content/updates. Music files are bulk-loaded via USB, with manifests tracked by the fleet system.

The application is deployed via Replit as an autoscale target, with Vite building to `dist/public/`. Production Express servers static files from `dist/public/` with SPA fallback.

## Session Notes

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
- **Content**: 12 collapsible sections covering every feature — Getting Started, Options, Rotation, Dancers, Music Library, Announcements, Settings, Configuration, Rotation Display, Dancer View, iPad Remote, Music Tips
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