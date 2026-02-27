# DJ Booth - Automated Rotation System

## Overview
The DJ Booth project is a React-based application for automating dancer rotations, managing music playback, and generating dynamic voice announcements in nightclubs. It is designed as a robust, low-power solution for hardware like the Raspberry Pi, aiming to streamline club operations and enhance the atmosphere through intelligent automation and responsive design. Key features include seamless music transitions, automated set management, and engaging announcements tailored to club hours and event types. The system also incorporates a fleet management system for centralized control, remote monitoring, updates, and content synchronization across multiple deployed units.

## User Preferences
- Nightclub dark theme with electric magenta accent (#e040fb) and violet secondary (#7c3aed)
- Deep navy-black backgrounds (#08081a, #0d0d1f) with purple-tinged borders (#1e1e3a)
- Neon dancer color palette for club atmosphere
- Minimize CPU/GPU usage for local hardware operation
- Do not modify `AudioEngine.jsx` audio behavior (crossfade, ducking, volume levels are finalized). The `loadTrack` method accepts both URL strings and FileSystemFileHandle objects.
- Production database stored at `/home/runner/data/djbooth.db` (outside project directory) to survive republishing. Development uses `./djbooth.db`. Configurable via `DB_PATH` env var.

## System Architecture
The application uses React 18, Vite, and TailwindCSS for the frontend, with Radix UI primitives and shadcn/ui styling. `localStorage` manages entities, while `IndexedDB` provides fast session caching for voiceover audio. Server-side, voiceovers are stored with SQLite metadata and filesystem MP3s. State management uses React Query, and routing is handled by React Router v6. Configuration settings (API keys, voice ID, club name, hours, energy override) are stored in the browser's `localStorage` on each Pi.

Music tracks are indexed server-side in a SQLite `music_tracks` table via `server/musicScanner.js`, supporting various audio formats and genre extraction from directory structures. The server performs initial scans on startup, periodic rescans every 5 minutes, and manual rescans via API. The client fetches paginated track metadata and streams audio with Range support.

A custom dual-deck audio engine manages seamless music playback, featuring equal-power crossfading, audio ducking, and sophisticated announcement overlays. Voice announcements are dynamically generated using ElevenLabs TTS and OpenAI, adapting to club energy levels (5-tier system) and operating hours. Announcements include shift-based personalities, optional adult innuendo, and generic fallbacks for offline use. Transitions involve parallel pre-fetching of announcement audio and ducking, playing the announcement over the outgoing song before swapping to the next track.

An Express + SQLite backend on port 3001 manages shared dancer data and PIN authentication, with mobile-optimized playlist management. Performance is optimized for low-power devices like the Raspberry Pi 5 through throttled updates, minimal GPU effects, and memory management. Critical state persists to `localStorage` for crash recovery. Features include a 5-hour song cooldown, configurable songs-per-set, interstitial "break songs," display-capped track lists, genre filtering, and debounced search. The `DJBooth` component remains mounted persistently (CSS-hidden) to preserve audio engine state. Robustness features include SQLite WAL mode, touch-based drag-and-drop, aggressive caching, and a Playback Watchdog for automatic recovery from audio dropouts. Playlist synchronization handles DJ overrides and server changes, with an anti-repeat system using Fisher-Yates shuffling. "DJ Remote Mode" uses Server-Sent Events (SSE) for real-time updates. Performance optimizations include gzip compression, database indexing, next-dancer track preloading, and server health endpoints. Voiceover pre-caching runs in batches, with silent fallbacks for API failures.

Every played song is logged server-side in the `play_history` SQLite table, including track name, dancer, genre, and timestamp. Logs older than 90 days are automatically cleaned.

A fleet management system enables centralized control of multiple Pi units, providing device registration, heartbeat monitoring, error log collection, voiceover sharing, music manifest tracking, app update distribution, and sync coordination. An admin dashboard offers an overview of device health, a master voiceover library, and sync history. A Pi-side sync client handles scheduled closed-hours synchronization, including uploading new voiceovers/logs and downloading content/updates. Music files are bulk-loaded via USB, with manifests tracked by the fleet system.

The application is deployed via Replit as an autoscale target, with Vite building to `dist/public/`. Production Express servers static files from `dist/public/` with SPA fallback.

## Session Notes

### Feb 27, 2026 — Session 3 (DJ Options + Genre Filtering)

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