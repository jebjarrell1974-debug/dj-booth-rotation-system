import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { playlistApi, musicApi, auth as authApi, setTokenOverride } from '@/api/serverApi';
import { Button } from '@/components/ui/button';
import { Music, Search, Plus, X, GripVertical, LogOut, FolderOpen, Play, Pause } from 'lucide-react';

const INACTIVITY_TIMEOUT = 4 * 60 * 60 * 1000;
const LONG_PRESS_MS = 200;
const PHONE_BREAKPOINT = 768;

export default function DancerView() {
  const { user, role, isAuthenticated, logout, dancerSession, logoutDancerSession } = useAuth();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [genres, setGenres] = useState([]);
  const [selectedGenre, setSelectedGenre] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [page, setPage] = useState(1);
  const [totalTracks, setTotalTracks] = useState(0);
  const lastActivityRef = useRef(Date.now());
  const [dragIdx, setDragIdx] = useState(null);
  const [playedSongs, setPlayedSongs] = useState({});
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
  const searchTimerRef = useRef(null);
  const [isPhone, setIsPhone] = useState(() => window.innerWidth < PHONE_BREAKPOINT);

  // Song preview is allowed only on phone/tablet remotes — never on the booth
  // kiosk, whose audio output is wired into the club PA.
  //
  // Defense in depth — TWO independent gates, BOTH must agree we are remote:
  //   1. Client-side hostname check (matches Landing.jsx's gate at lines 95-99).
  //      Fast, no network round-trip, blocks the obvious kiosk URL.
  //   2. Server-side loopback detection via /api/auth/connection-info.
  //      Server inspects the actual TCP socket — cannot be fooled by URL,
  //      mDNS name, IPv6 form, or any client-side trickery. A booth Dell
  //      with a non-kiosk browser tab pointed at its own LAN IP would still
  //      connect via loopback and be correctly blocked.
  //
  // Default state is fail-CLOSED: preview disabled until server affirmatively
  // confirms the client is NOT on loopback. Network failure, slow load, or a
  // server without the endpoint = preview just stays off.
  const isKioskHostname = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '::1' ||
    window.location.hostname === '[::1]'
  );
  const [serverConfirmedRemote, setServerConfirmedRemote] = useState(false);
  const previewAllowed = !isKioskHostname && serverConfirmedRemote;
  const [previewSong, setPreviewSong] = useState(null);
  const [previewPaused, setPreviewPaused] = useState(false);
  const previewAudioRef = useRef(null);
  const tapTrackerRef = useRef({ id: null, timer: null });

  // Defined early so the inactivity-timeout and beforeunload effects below can
  // include it in their dependency arrays without TDZ errors. The other
  // preview helpers (playPreview, togglePreviewPause, handleTrackTap) live
  // further down with the playlist mutation helpers because they depend on
  // those.
  const stopPreview = useCallback(() => {
    const a = previewAudioRef.current;
    if (a) {
      try { a.pause(); } catch {}
      try { a.src = ''; } catch {}
      previewAudioRef.current = null;
    }
    setPreviewSong(null);
    setPreviewPaused(false);
  }, []);

  useEffect(() => {
    // Fail-closed: only enable preview if server affirmatively says we are NOT loopback
    let cancelled = false;
    fetch('/api/auth/connection-info')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d && d.isLocalhost === false) setServerConfirmedRemote(true); })
      .catch(() => { /* leave fail-closed */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const check = () => setIsPhone(window.innerWidth < PHONE_BREAKPOINT);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('djbooth_song_cooldowns');
      if (raw) setPlayedSongs(JSON.parse(raw));
    } catch {}
  }, []);

  const touchState = useRef({ active: false, idx: null, startY: 0, currentY: 0, timer: null });
  const listRef = useRef(null);
  const itemRefs = useRef([]);
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;
  const saveTimerRef = useRef(null);

  const isDancerSession = !!dancerSession;
  const effectiveUser = isDancerSession ? dancerSession.user : user;

  useEffect(() => {
    if (isDancerSession) {
      setTokenOverride(dancerSession.token);
    }
    return () => {
      setTokenOverride(null);
    };
  }, [isDancerSession, dancerSession]);

  useEffect(() => {
    if (!isDancerSession && (!isAuthenticated || role !== 'dancer')) {
      navigate('/');
    }
  }, [isAuthenticated, role, navigate, isDancerSession]);

  useEffect(() => {
    const load = async () => {
      try {
        const pl = await playlistApi.get();
        setPlaylist(pl.playlist || []);
      } catch {
        navigate('/');
        return;
      }
      try {
        const genreData = await musicApi.getGenres();
        const genreList = (genreData.genres || []).map(g => typeof g === 'string' ? g : g.name);
        setGenres(genreList);
      } catch {
      }
      setLoading(false);
    };
    load();
  }, [navigate]);

  const fetchTracks = useCallback(async (search, genre, pageNum) => {
    setTracksLoading(true);
    try {
      const data = await musicApi.getTracks({ page: pageNum, limit: 100, search, genre: search ? '' : genre });
      if (pageNum === 1) {
        setTracks(data.tracks || []);
      } else {
        setTracks(prev => [...prev, ...(data.tracks || [])]);
      }
      setTotalTracks(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch tracks:', err);
    }
    setTracksLoading(false);
  }, []);

  useEffect(() => {
    setPage(1);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      fetchTracks(searchQuery, selectedGenre, 1);
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery, selectedGenre, fetchTracks]);

  useEffect(() => {
    const resetTimer = () => { lastActivityRef.current = Date.now(); };
    const events = ['touchstart', 'mousedown', 'keydown', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    
    const checker = setInterval(async () => {
      if (Date.now() - lastActivityRef.current > INACTIVITY_TIMEOUT) {
        stopPreview();
        if (isDancerSession) {
          logoutDancerSession();
          navigate('/');
        } else {
          navigate('/');
        }
      } else {
        authApi.ping().catch(() => {});
      }
    }, 30000);

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      clearInterval(checker);
    };
  }, [logout, navigate, isDancerSession, logoutDancerSession, stopPreview]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      playlistApi.update(playlistRef.current).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const clearTapTimer = () => {
      const tt = tapTrackerRef.current;
      if (tt && tt.timer) {
        clearTimeout(tt.timer);
        tt.timer = null;
        tt.id = null;
      }
    };
    const handleBeforeUnload = () => { flushSave(); stopPreview(); clearTapTimer(); };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      flushSave();
      stopPreview();
      clearTapTimer();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [flushSave, stopPreview]);

  const debouncedSave = useCallback((newPlaylist) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      saveTimerRef.current = null;
      try {
        await playlistApi.update(newPlaylist);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(prev => prev === 'saved' ? null : prev), 2000);
      } catch (err) {
        console.error('Failed to save playlist:', err);
        setSaveStatus('error');
      }
    }, 300);
  }, []);

  const updatePlaylist = useCallback((newPlaylist) => {
    setPlaylist(newPlaylist);
    playlistRef.current = newPlaylist;
    debouncedSave(newPlaylist);
  }, [debouncedSave]);

  const addSong = useCallback((songName) => {
    if (/dirty/i.test(songName)) return;
    const current = playlistRef.current;
    const updated = [...current, songName];
    updatePlaylist(updated);
  }, [updatePlaylist]);

  const removeSong = useCallback((index) => {
    const current = playlistRef.current;
    const updated = [...current];
    updated.splice(index, 1);
    updatePlaylist(updated);
  }, [updatePlaylist]);

  // ── Song preview (phone/tablet remote only) ────────────────────────────
  // Uses a single hidden <audio> element scoped to this component. The booth
  // kiosk's AudioEngine (Web Audio API graph in components/dj/AudioEngine.jsx)
  // is intentionally NOT touched — preview lives in a completely separate
  // browser session on a different device. /api/music/stream/:id is unauthed
  // by design (the kiosk relies on this), so HTML5 <audio> can hit it directly.
  // Note: stopPreview is defined earlier (above the lifecycle effects that
  // reference it). Only the helpers that depend on addSong/removeSong live here.
  const playPreview = useCallback((track) => {
    if (!previewAllowed) return;
    if (!track || !track.id) return;
    const prev = previewAudioRef.current;
    if (prev) {
      try { prev.pause(); } catch {}
      try { prev.src = ''; } catch {}
      previewAudioRef.current = null;
    }
    const audio = new Audio(`/api/music/stream/${track.id}`);
    // Instance-guarded: a callback from a stale Audio (e.g. user double-tapped
    // a different song before the previous one's events fired) must NOT stop
    // the currently-active preview. Only stop if we are still the active ref.
    const safeStop = () => { if (previewAudioRef.current === audio) stopPreview(); };
    audio.onended = safeStop;
    audio.onerror = safeStop;
    audio.play().catch(safeStop);
    previewAudioRef.current = audio;
    setPreviewSong(track.name);
    setPreviewPaused(false);
  }, [previewAllowed, stopPreview]);

  const togglePreviewPause = useCallback(() => {
    const a = previewAudioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play().catch(() => stopPreview());
      setPreviewPaused(false);
    } else {
      a.pause();
      setPreviewPaused(true);
    }
  }, [stopPreview]);

  // Tap once = add/remove from playlist (existing behavior, delayed 260ms).
  // Tap twice on the same row = preview (kiosk: skips preview, fires
  // single-tap action immediately so kiosk UX is unchanged).
  const handleTrackTap = useCallback((track) => {
    const tt = tapTrackerRef.current;
    const singleTapAction = () => {
      const inPl = playlistRef.current.includes(track.name);
      if (inPl) {
        const idx = playlistRef.current.indexOf(track.name);
        if (idx !== -1) removeSong(idx);
      } else {
        addSong(track.name);
      }
    };
    if (!previewAllowed) { singleTapAction(); return; }
    if (tt.timer && tt.id === track.id) {
      clearTimeout(tt.timer);
      tt.timer = null;
      tt.id = null;
      playPreview(track);
      return;
    }
    if (tt.timer) clearTimeout(tt.timer);
    tt.id = track.id;
    tt.timer = setTimeout(() => {
      tt.timer = null;
      tt.id = null;
      singleTapAction();
    }, 260);
  }, [previewAllowed, addSong, removeSong, playPreview]);

  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setPlaylist(prev => {
      const updated = [...prev];
      const [item] = updated.splice(dragIdx, 1);
      updated.splice(idx, 0, item);
      playlistRef.current = updated;
      return updated;
    });
    setDragIdx(idx);
  };
  const handleDragEnd = () => {
    setDragIdx(null);
    debouncedSave(playlistRef.current);
  };

  const handleTouchStart = useCallback((e, idx) => {
    const touch = e.touches[0];
    const ts = touchState.current;
    ts.startY = touch.clientY;
    ts.currentY = touch.clientY;
    ts.idx = idx;
    ts.timer = setTimeout(() => {
      ts.active = true;
      setDragIdx(idx);
    }, LONG_PRESS_MS);
  }, []);

  const handleTouchMove = useCallback((e) => {
    const ts = touchState.current;
    const touch = e.touches[0];
    ts.currentY = touch.clientY;

    if (Math.abs(touch.clientY - ts.startY) > 10 && ts.timer) {
      clearTimeout(ts.timer);
      ts.timer = null;
    }

    if (!ts.active || ts.idx === null) return;
    e.preventDefault();

    const items = itemRefs.current;
    for (let i = 0; i < items.length; i++) {
      if (!items[i]) continue;
      const rect = items[i].getBoundingClientRect();
      if (i !== ts.idx && touch.clientY > rect.top && touch.clientY < rect.bottom) {
        setPlaylist(prev => {
          const updated = [...prev];
          const [item] = updated.splice(ts.idx, 1);
          updated.splice(i, 0, item);
          playlistRef.current = updated;
          return updated;
        });
        ts.idx = i;
        setDragIdx(i);
        break;
      }
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const ts = touchState.current;
    if (ts.timer) {
      clearTimeout(ts.timer);
      ts.timer = null;
    }
    if (ts.active) {
      ts.active = false;
      ts.idx = null;
      setDragIdx(null);
      debouncedSave(playlistRef.current);
    }
  }, [debouncedSave]);

  const handleTouchCancel = useCallback(() => {
    const ts = touchState.current;
    if (ts.timer) {
      clearTimeout(ts.timer);
      ts.timer = null;
    }
    ts.active = false;
    ts.idx = null;
    setDragIdx(null);
  }, []);

  const handleLogout = () => {
    flushSave();
    stopPreview();
    if (isDancerSession) {
      logoutDancerSession();
      navigate('/');
    } else {
      navigate('/');
    }
  };

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchTracks(searchQuery, selectedGenre, nextPage);
  };

  const playlistSet = new Set(playlist);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08081a] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#00d4ff]/30 border-t-[#00d4ff] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-[#08081a] flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-[#1e293b] bg-[#0d0d1f] flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-white">{effectiveUser?.name || 'Entertainer'}</h1>
          <p className="text-[10px] text-gray-500">
            My Playlist
            {saveStatus === 'saving' && <span className="ml-2 text-yellow-400">Saving...</span>}
            {saveStatus === 'saved' && <span className="ml-2 text-green-400">Saved</span>}
            {saveStatus === 'error' && <span className="ml-2 text-red-400">Save failed!</span>}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-gray-400 hover:text-white">
          <LogOut className="w-4 h-4 mr-1" />
          Exit
        </Button>
      </div>

      <div className={`flex flex-1 min-h-0 ${isPhone ? 'flex-col' : 'flex-row'}`}>
        <div className={`flex flex-col ${isPhone ? 'h-[38%] border-b' : 'w-[33%] border-r'} border-[#1e293b]`}>
          <div className="px-3 py-2 flex items-center justify-between flex-shrink-0 border-b border-[#1e293b]/50">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">My Songs</span>
            <span className="text-[10px] text-gray-500">{playlist.length}</span>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="px-2 py-2 space-y-0.5">
              {playlist.length === 0 ? (
                <div className={`text-center text-gray-500 ${isPhone ? 'py-4' : 'py-8'}`}>
                  <Music className={`mx-auto mb-2 opacity-50 ${isPhone ? 'w-6 h-6' : 'w-8 h-8'}`} />
                  <p className="text-xs">Your playlist is empty</p>
                  <p className="text-[10px] mt-1 text-gray-600">Tap songs from the library to add</p>
                </div>
              ) : (
                playlist.map((song, idx) => (
                  <div
                    key={`${song}-${idx}`}
                    ref={el => itemRefs.current[idx] = el}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    onTouchStart={(e) => handleTouchStart(e, idx)}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchCancel}
                    className={`flex items-center gap-1.5 px-2 py-2 rounded-lg transition-colors select-none ${
                      dragIdx === idx ? 'bg-[#00d4ff]/20 border border-[#00d4ff]/40' : 'bg-[#151528]'
                    }`}
                  >
                    <GripVertical className="w-3.5 h-3.5 text-gray-600 flex-shrink-0 cursor-grab active:cursor-grabbing" />
                    <span className={`text-[11px] flex-1 truncate leading-tight ${(playedSongs[song] && (Date.now() - playedSongs[song]) < FOUR_HOURS_MS) ? 'text-orange-300' : 'text-gray-200'}`}>{song}</span>
                    <button
                      onClick={() => removeSong(idx)}
                      className="p-1 text-red-400/60 active:text-red-400 transition-colors flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-2 flex-shrink-0 border-b border-[#1e293b]/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#00d4ff] uppercase tracking-wider">Music Library</span>
              <span className="text-[10px] text-gray-500">
                {totalTracks.toLocaleString()} songs{selectedGenre ? ` in ${selectedGenre}` : ''}
              </span>
            </div>
            <div className={`flex items-center gap-2 ${isPhone ? 'flex-col' : ''}`}>
              <div className="relative flex-1 w-full">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search songs..."
                  className="w-full bg-[#151528] border border-[#1e293b] rounded-lg pl-8 pr-8 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00d4ff]"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 active:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {genres.length > 0 && (
                <div className={`flex items-center gap-1.5 ${isPhone ? 'w-full' : ''}`}>
                  <FolderOpen className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                  <select
                    value={selectedGenre}
                    onChange={(e) => setSelectedGenre(e.target.value)}
                    className={`bg-[#151528] border border-[#1e293b] rounded-lg px-2 py-1.5 text-xs text-white appearance-none cursor-pointer focus:outline-none focus:border-[#00d4ff] ${isPhone ? 'flex-1' : 'min-w-[120px]'}`}
                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: '24px' }}
                  >
                    <option value="">All Genres</option>
                    {genres.map(genre => (
                      <option key={genre} value={genre}>{genre}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="px-2 pb-3 pt-1 space-y-0.5">
              {tracksLoading && tracks.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-6 h-6 border-3 border-[#00d4ff]/30 border-t-[#00d4ff] rounded-full animate-spin mx-auto" />
                </div>
              ) : tracks.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-sm">
                  {searchQuery || selectedGenre ? 'No songs match your search' : 'No songs available yet'}
                </div>
              ) : (
                tracks.map((track) => {
                  const inPlaylist = playlistSet.has(track.name);
                  return (
                    <button
                      key={track.id}
                      onClick={() => handleTrackTap(track)}
                      style={{ touchAction: 'manipulation' }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                        inPlaylist
                          ? 'bg-[#00d4ff]/10 text-[#00d4ff] active:bg-red-500/20'
                          : 'text-gray-300 active:bg-[#00d4ff]/20'
                      } ${previewSong === track.name ? 'ring-2 ring-purple-400/60' : ''}`}
                    >
                      <Music className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
                      <div className="flex-1 min-w-0">
                        <span className="truncate text-xs block">{track.name}</span>
                        {track.genre && (
                          <span className="text-[10px] text-gray-600 block">{track.genre}</span>
                        )}
                      </div>
                      {inPlaylist ? (
                        <span className="flex items-center gap-1 text-xs text-red-400 flex-shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <Plus className="w-4 h-4 text-[#00d4ff] flex-shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
              {tracks.length < totalTracks && (
                <div className="text-center py-3">
                  <button
                    onClick={loadMore}
                    disabled={tracksLoading}
                    className="px-4 py-2 text-xs font-medium text-[#00d4ff] bg-[#00d4ff]/10 active:bg-[#00d4ff]/30 rounded-lg transition-colors"
                  >
                    {tracksLoading ? 'Loading...' : `Show More (${tracks.length} of ${totalTracks})`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {previewSong && previewAllowed && (
        <div className="flex items-center gap-3 px-3 py-2 bg-[#1a0d2e] border-t border-purple-500/40 flex-shrink-0">
          <button
            onClick={togglePreviewPause}
            className="w-10 h-10 rounded-full bg-purple-500/20 active:bg-purple-500/60 flex items-center justify-center text-purple-200 flex-shrink-0"
            aria-label={previewPaused ? 'Resume preview' : 'Pause preview'}
          >
            {previewPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-purple-300/70 leading-tight">Preview {previewPaused ? '(paused)' : ''}</div>
            <div className="text-xs text-white truncate leading-tight">{previewSong}</div>
          </div>
          <button
            onClick={stopPreview}
            className="w-8 h-8 rounded-full bg-white/5 active:bg-white/20 flex items-center justify-center text-gray-400 flex-shrink-0"
            aria-label="Stop preview"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
