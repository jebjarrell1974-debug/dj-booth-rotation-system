import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { playlistApi, musicApi, auth as authApi } from '@/api/serverApi';
import { Button } from '@/components/ui/button';
import { Music, Search, Plus, X, GripVertical, LogOut, FolderOpen } from 'lucide-react';

const INACTIVITY_TIMEOUT = 4 * 60 * 60 * 1000;
const LONG_PRESS_MS = 200;
const PHONE_BREAKPOINT = 768;

export default function DancerView() {
  const { user, role, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [genres, setGenres] = useState([]);
  const [selectedGenre, setSelectedGenre] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalTracks, setTotalTracks] = useState(0);
  const lastActivityRef = useRef(Date.now());
  const [dragIdx, setDragIdx] = useState(null);
  const searchTimerRef = useRef(null);
  const [isPhone, setIsPhone] = useState(() => window.innerWidth < PHONE_BREAKPOINT);

  useEffect(() => {
    const check = () => setIsPhone(window.innerWidth < PHONE_BREAKPOINT);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const touchState = useRef({ active: false, idx: null, startY: 0, currentY: 0, timer: null });
  const listRef = useRef(null);
  const itemRefs = useRef([]);
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;
  const saveTimerRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated || role !== 'dancer') {
      navigate('/');
    }
  }, [isAuthenticated, role, navigate]);

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
      const data = await musicApi.getTracks({ page: pageNum, limit: 100, search, genre });
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
        await logout();
        navigate('/');
      } else {
        authApi.ping().catch(() => {});
      }
    }, 30000);

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      clearInterval(checker);
    };
  }, [logout, navigate]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      playlistApi.update(playlistRef.current).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => flushSave();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      flushSave();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [flushSave]);

  const debouncedSave = useCallback((newPlaylist) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      saveTimerRef.current = null;
      try {
        await playlistApi.update(newPlaylist);
      } catch (err) {
        console.error('Failed to save playlist:', err);
      }
    }, 300);
  }, []);

  const updatePlaylist = useCallback((newPlaylist) => {
    setPlaylist(newPlaylist);
    playlistRef.current = newPlaylist;
    debouncedSave(newPlaylist);
  }, [debouncedSave]);

  const addSong = useCallback((songName) => {
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

  const handleLogout = async () => {
    flushSave();
    await logout();
    navigate('/');
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
          <h1 className="text-lg font-bold text-white">{user?.name || 'Entertainer'}</h1>
          <p className="text-[10px] text-gray-500">My Playlist</p>
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
                    <span className="text-[11px] text-gray-200 flex-1 truncate leading-tight">{song}</span>
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
                      onClick={() => {
                        if (inPlaylist) {
                          const idx = playlist.indexOf(track.name);
                          if (idx !== -1) removeSong(idx);
                        } else {
                          addSong(track.name);
                        }
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                        inPlaylist
                          ? 'bg-[#00d4ff]/10 text-[#00d4ff] active:bg-red-500/20'
                          : 'text-gray-300 active:bg-[#00d4ff]/20'
                      }`}
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
    </div>
  );
}
