import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { playlistApi, musicApi, auth as authApi } from '@/api/serverApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Music, Search, Plus, X, GripVertical, LogOut, FolderOpen, ChevronLeft } from 'lucide-react';

const INACTIVITY_TIMEOUT = 4 * 60 * 60 * 1000;
const LONG_PRESS_MS = 200;

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
  const [showLibrary, setShowLibrary] = useState(false);
  const [page, setPage] = useState(1);
  const [totalTracks, setTotalTracks] = useState(0);
  const lastActivityRef = useRef(Date.now());
  const [dragIdx, setDragIdx] = useState(null);
  const searchTimerRef = useRef(null);

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
    if (!showLibrary) return;
    setPage(1);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      fetchTracks(searchQuery, selectedGenre, 1);
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [showLibrary, searchQuery, selectedGenre, fetchTracks]);

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
        <div className="w-8 h-8 border-4 border-[#e040fb]/30 border-t-[#e040fb] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#08081a] flex flex-col" style={{ maxHeight: '100dvh' }}>
      <div className="p-4 border-b border-[#1e1e3a] bg-[#0d0d1f] flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-white">{user?.name || 'Dancer'}</h1>
          <p className="text-xs text-gray-500">My Playlist</p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-gray-400 hover:text-white">
          <LogOut className="w-4 h-4 mr-1" />
          Exit
        </Button>
      </div>

      {!showLibrary ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 flex items-center justify-between flex-shrink-0">
            <span className="text-sm text-gray-400">{playlist.length} songs</span>
            <Button
              size="sm"
              onClick={() => setShowLibrary(true)}
              className="bg-[#e040fb] hover:bg-[#c026d3] text-black font-medium"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Songs
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="px-4 pb-4 space-y-1">
              {playlist.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Music className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">Your playlist is empty</p>
                  <p className="text-xs mt-1">Tap "Add Songs" to browse music</p>
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
                    className={`flex items-center gap-2 px-3 py-3 rounded-lg transition-colors select-none ${
                      dragIdx === idx ? 'bg-[#e040fb]/20 border border-[#e040fb]/40' : 'bg-[#151528]'
                    }`}
                  >
                    <GripVertical className="w-4 h-4 text-gray-600 flex-shrink-0 cursor-grab active:cursor-grabbing" />
                    <span className="text-sm text-gray-200 flex-1 truncate">{song}</span>
                    <button
                      onClick={() => removeSong(idx)}
                      className="p-2 text-red-400/70 hover:text-red-400 active:text-red-300 transition-colors flex-shrink-0"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-3 space-y-3 flex-shrink-0 border-b border-[#1e1e3a]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#e040fb] uppercase tracking-wider">Song Library</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowLibrary(false); setSearchQuery(''); setSelectedGenre(''); }}
                className="text-gray-400 hover:text-white"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                My Playlist
              </Button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search songs..."
                className="pl-9 bg-[#151528] border-[#1e1e3a] text-white placeholder:text-gray-500 h-10"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {genres.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
                <button
                  onClick={() => setSelectedGenre('')}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    selectedGenre === ''
                      ? 'bg-[#e040fb] text-black'
                      : 'bg-[#151528] text-gray-400 border border-[#1e1e3a] hover:text-white'
                  }`}
                >
                  All
                </button>
                {genres.map(genre => (
                  <button
                    key={genre}
                    onClick={() => setSelectedGenre(selectedGenre === genre ? '' : genre)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      selectedGenre === genre
                        ? 'bg-[#e040fb] text-black'
                        : 'bg-[#151528] text-gray-400 border border-[#1e1e3a] hover:text-white'
                    }`}
                  >
                    <FolderOpen className="w-3 h-3 inline mr-1" />
                    {genre}
                  </button>
                ))}
              </div>
            )}

            <div className="text-xs text-gray-500">
              {totalTracks} songs{selectedGenre ? ` in ${selectedGenre}` : ''}{searchQuery ? ` matching "${searchQuery}"` : ''}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="px-3 pb-4 pt-2 space-y-0.5">
              {tracksLoading && tracks.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-6 h-6 border-3 border-[#e040fb]/30 border-t-[#e040fb] rounded-full animate-spin mx-auto" />
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
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-colors ${
                        inPlaylist
                          ? 'bg-[#e040fb]/10 text-[#e040fb] active:bg-red-500/20'
                          : 'text-gray-300 hover:bg-[#151528] hover:text-white active:bg-[#e040fb]/20'
                      }`}
                    >
                      <Music className="w-4 h-4 flex-shrink-0 opacity-50" />
                      <div className="flex-1 min-w-0">
                        <span className="truncate text-sm block">{track.name}</span>
                        {track.genre && (
                          <span className="text-[10px] text-gray-600 block">{track.genre}</span>
                        )}
                      </div>
                      {inPlaylist ? (
                        <span className="flex items-center gap-1 text-xs text-red-400 flex-shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <Plus className="w-5 h-5 text-[#e040fb] flex-shrink-0" />
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
                    className="px-4 py-2.5 text-xs font-medium text-[#e040fb] bg-[#e040fb]/10 hover:bg-[#e040fb]/20 rounded-lg transition-colors active:bg-[#e040fb]/30"
                  >
                    {tracksLoading ? 'Loading...' : `Show More (${tracks.length} of ${totalTracks})`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
