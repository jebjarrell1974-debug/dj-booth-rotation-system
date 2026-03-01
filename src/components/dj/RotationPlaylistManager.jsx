import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Music2, X, Save, Search, Play, GripVertical, Mic, MicOff, Folder, AlertCircle, Clock, SkipForward, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

const TRACKS_PER_PAGE = 200;

const fisherYatesShuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const filterByGenres = (trackList, activeGenres) => {
  if (!activeGenres || activeGenres.length === 0) return trackList;
  const filtered = trackList.filter(t => activeGenres.includes(t.genre));
  return filtered.length > 0 ? filtered : trackList;
};

export default function RotationPlaylistManager({ 
  dancers, 
  rotation, 
  tracks,
  onSaveAll,
  onAutoSavePlaylist,
  onAddToRotation,
  onRemoveFromRotation,
  onStartRotation,
  isRotationActive,
  rotationPending,
  onCancelPendingRotation,
  songsPerSet,
  onSongsPerSetChange,
  activeRotationSongs,
  savedInterstitials,
  interstitialRemoteVersion,
  djOptions,
  announcementsEnabled,
  onAnnouncementsToggle,
  onSkipDancer,
  currentDancerIndex,
  currentSongNumber,
  breakSongsPerSet,
  onBreakSongsPerSetChange
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeGenre, setActiveGenre] = useState(null);
  const [localRotation, setLocalRotation] = useState(rotation);
  const [songAssignments, setSongAssignments] = useState({});
  const [interstitialSongs, setInterstitialSongs] = useState(() => {
    if (savedInterstitials && Object.keys(savedInterstitials).length > 0) return savedInterstitials;
    try {
      const saved = localStorage.getItem('djbooth_interstitial_songs');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [selectedDancerId, setSelectedDancerId] = useState(null);
  const [displayLimit, setDisplayLimit] = useState(TRACKS_PER_PAGE);
  const appliedPlaylistsRef = React.useRef({});
  const djOverridesRef = React.useRef(new Set());
  const [serverTracks, setServerTracks] = useState([]);
  const [serverGenres, setServerGenres] = useState([]);
  const [serverTotalTracks, setServerTotalTracks] = useState(0);
  const [serverCurrentPage, setServerCurrentPage] = useState(1);
  const [serverHasMore, setServerHasMore] = useState(false);
  const [serverLoading, setServerLoading] = useState(false);
  const serverMountedRef = useRef(false);
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setLocalRotation(rotation);
  }, [rotation]);

  useEffect(() => {
    if (Object.keys(interstitialSongs).length > 0) {
      try { localStorage.setItem('djbooth_interstitial_songs', JSON.stringify(interstitialSongs)); } catch {}
    }
  }, [interstitialSongs]);

  useEffect(() => {
    if (interstitialRemoteVersion > 0) {
      setInterstitialSongs(savedInterstitials || {});
    }
  }, [interstitialRemoteVersion]);

  useEffect(() => {
    if (isRotationActive && activeRotationSongs && Object.keys(activeRotationSongs).length > 0) {
      setSongAssignments(prev => {
        const fromActive = { ...prev };
        Object.entries(activeRotationSongs).forEach(([dancerId, trackList]) => {
          if (djOverridesRef.current.has(dancerId)) return;
          if (trackList) fromActive[dancerId] = trackList.map(t => t.name);
        });
        return fromActive;
      });
      return;
    }

    const dancersNeedingAssignment = localRotation.filter(dancerId => {
      if (djOverridesRef.current.has(dancerId)) return false;
      return true;
    });
    if (dancersNeedingAssignment.length === 0) return;

    const isFoldersOnly = djOptions?.musicMode === 'folders_only';
    const activeGenres = djOptions?.activeGenres?.length > 0 ? djOptions.activeGenres : [];

    (async () => {
      const token = sessionStorage.getItem('djbooth_token');
      const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const batchExcludes = [];

      setSongAssignments(prev => {
        Object.values(prev).forEach(songs => {
          if (songs) songs.forEach(n => batchExcludes.push(n));
        });
        return prev;
      });

      const newAssignments = {};
      for (const dancerId of dancersNeedingAssignment) {
        const dancer = dancers.find(d => d.id === dancerId);
        if (!dancer) continue;

        const serverPlaylist = dancer?.playlist || [];
        const serverHash = serverPlaylist.join(',');
        const lastApplied = appliedPlaylistsRef.current[dancerId];
        const hasNewServerPlaylist = serverPlaylist.length > 0 && serverHash !== lastApplied;

        const currentSongs = newAssignments[dancerId];
        if (currentSongs && currentSongs.length >= songsPerSet && !hasNewServerPlaylist) {
          currentSongs.forEach(n => batchExcludes.push(n));
          continue;
        }

        const dancerPlaylist = (!isFoldersOnly && serverPlaylist.length > 0)
          ? fisherYatesShuffle(serverPlaylist) : [];

        try {
          const res = await fetch('/api/music/select', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              count: songsPerSet,
              excludeNames: [...new Set(batchExcludes)],
              genres: activeGenres,
              dancerPlaylist
            }),
            signal: AbortSignal.timeout(5000)
          });
          if (res.ok) {
            const data = await res.json();
            const selected = (data.tracks || []).map(t => t.name);
            newAssignments[dancerId] = selected;
            selected.forEach(n => batchExcludes.push(n));
            if (serverPlaylist.length > 0) {
              appliedPlaylistsRef.current[dancerId] = serverHash;
            }
            continue;
          }
        } catch (err) {
          console.warn(`⚠️ RotationPlaylist: Server select failed for ${dancer.name}: ${err.message}`);
        }

        const genrePool = filterByGenres(tracks, activeGenres);
        const excludeSet = new Set(batchExcludes);
        const available = genrePool.filter(t => !excludeSet.has(t.name));
        const shuffled = fisherYatesShuffle(available);
        const assigned = shuffled.slice(0, songsPerSet).map(t => t.name);
        newAssignments[dancerId] = assigned;
        assigned.forEach(n => batchExcludes.push(n));
      }

      if (Object.keys(newAssignments).length > 0) {
        setSongAssignments(prev => {
          const updated = { ...prev };
          for (const [dancerId, songs] of Object.entries(newAssignments)) {
            if (!djOverridesRef.current.has(dancerId)) {
              updated[dancerId] = songs;
            }
          }
          return updated;
        });
      }
    })();
  }, [localRotation, dancers, tracks, songsPerSet, isRotationActive, activeRotationSongs, djOptions]);

  useEffect(() => {
    if (tracks.length === 0) return;
    const genrePool = filterByGenres(tracks, djOptions?.activeGenres);
    setSongAssignments(prev => {
      const updated = { ...prev };
      let changed = false;
      Object.keys(updated).forEach(dancerId => {
        if (djOverridesRef.current.has(dancerId)) return;
        const dancer = dancers.find(d => d.id === dancerId);
        if (dancer?.playlist?.length > 0 && djOptions?.musicMode !== 'folders_only') return;
        const songs = updated[dancerId];
        if (!songs) return;
        if (songs.length > songsPerSet) {
          updated[dancerId] = songs.slice(0, songsPerSet);
          changed = true;
        } else if (songs.length < songsPerSet) {
          const usedNames = new Set(songs);
          const available = genrePool.filter(t => !usedNames.has(t.name));
          const shuffled = fisherYatesShuffle(available);
          const needed = songsPerSet - songs.length;
          updated[dancerId] = [...songs, ...shuffled.slice(0, needed).map(t => t.name)];
          changed = true;
        }
      });
      return changed ? updated : prev;
    });
  }, [songsPerSet, tracks, dancers, djOptions]);

  const getAuthHeaders = useCallback(() => {
    const token = sessionStorage.getItem('djbooth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchServerTracks = useCallback(async (page = 1, append = false) => {
    setServerLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: TRACKS_PER_PAGE.toString(),
      });
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      if (activeGenre) params.set('genre', activeGenre);
      const res = await fetch(`/api/music/tracks?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      const raw = (data.tracks || []).map(t => ({ ...t, url: '/api/music/stream/' + t.id }));
      const seen = new Set();
      const fetched = raw.filter(t => {
        if (seen.has(t.name)) return false;
        seen.add(t.name);
        return true;
      });
      if (append) {
        setServerTracks(prev => {
          const existingNames = new Set(prev.map(t => t.name));
          return [...prev, ...fetched.filter(t => !existingNames.has(t.name))];
        });
      } else {
        setServerTracks(fetched);
      }
      setServerTotalTracks(data.total || 0);
      setServerCurrentPage(page);
      setServerHasMore(page < (data.totalPages || 1));
      if (data.genres && data.genres.length > 0) {
        setServerGenres(data.genres);
      }
    } catch (err) {
      console.error('RotationPlaylistManager: fetch tracks error', err);
    } finally {
      setServerLoading(false);
    }
  }, [getAuthHeaders, debouncedSearch, activeGenre]);

  useEffect(() => {
    if (!serverMountedRef.current) {
      serverMountedRef.current = true;
      fetchServerTracks(1, false);
      return;
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      fetchServerTracks(1, false);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [debouncedSearch, activeGenre]);

  const loadMoreServerTracks = useCallback(() => {
    if (!serverLoading && serverHasMore) {
      fetchServerTracks(serverCurrentPage + 1, true);
    }
  }, [fetchServerTracks, serverCurrentPage, serverLoading, serverHasMore]);

  const genres = serverGenres;

  const rotationDancers = localRotation.map(id => dancers.find(d => d.id === id)).filter(Boolean);
  const availableDancers = dancers.filter(d => d.is_active && !localRotation.includes(d.id)).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const genreFilteredTracks = filterByGenres(serverTracks, djOptions?.activeGenres);
  const filteredTracks = genreFilteredTracks;
  const displayedTracks = genreFilteredTracks;

  const addSongToDancer = useCallback((dancerId, trackName) => {
    djOverridesRef.current.add(dancerId);
    setSongAssignments(prev => {
      const current = [...(prev[dancerId] || [])];
      if (current.includes(trackName)) {
        toast.error('Song already assigned');
        return prev;
      }
      current.push(trackName);
      const updated = { ...prev, [dancerId]: current };
      onAutoSavePlaylist?.(dancerId, current, { type: 'add', song: trackName });
      return updated;
    });
  }, [onAutoSavePlaylist]);
  
  const handleLibraryTrackClick = useCallback((trackName) => {
    const targetId = selectedDancerId || (rotationDancers.length === 1 ? rotationDancers[0]?.id : null);
    if (!targetId) {
      toast('Tap a dancer name first to select them', { icon: '👆' });
      return;
    }
    addSongToDancer(targetId, trackName);
  }, [selectedDancerId, rotationDancers, addSongToDancer]);

  const handleDragEnd = (result) => {
    const { source, destination, type } = result;
    if (!destination) return;

    if (type === 'dancer') {
      const newRotation = [...localRotation];
      const [moved] = newRotation.splice(source.index, 1);
      newRotation.splice(destination.index, 0, moved);
      setLocalRotation(newRotation);
      return;
    }

    if (source.droppableId === 'library' && destination.droppableId.startsWith('songs-')) {
      const dancerId = destination.droppableId.replace('songs-', '');
      const dragId = result.draggableId.replace('lib-', '');
      const track = displayedTracks.find(t => String(t.id) === dragId) || displayedTracks[source.index];
      if (!track) return;

      djOverridesRef.current.add(dancerId);
      setSongAssignments(prev => {
        const current = [...(prev[dancerId] || [])];
        if (current.includes(track.name)) {
          toast.error('Song already assigned');
          return prev;
        }
        current.splice(destination.index, 0, track.name);
        const updated = { ...prev, [dancerId]: current };
        onAutoSavePlaylist?.(dancerId, current, { type: 'add', song: track.name });
        return updated;
      });
      return;
    }

    if (source.droppableId === 'library' && destination.droppableId.startsWith('break-')) {
      const breakKey = destination.droppableId.replace('break-', '');
      const dragId = result.draggableId.replace('lib-', '');
      const track = displayedTracks.find(t => String(t.id) === dragId) || displayedTracks[source.index];
      if (!track) return;
      setInterstitialSongs(prev => {
        const current = [...(prev[breakKey] || [])];
        if (current.includes(track.name)) {
          toast.error('Song already in break slot');
          return prev;
        }
        current.splice(destination.index, 0, track.name);
        return { ...prev, [breakKey]: current };
      });
      return;
    }

    if (source.droppableId === destination.droppableId && source.droppableId.startsWith('songs-')) {
      const dancerId = source.droppableId.replace('songs-', '');
      djOverridesRef.current.add(dancerId);
      setSongAssignments(prev => {
        const current = [...(prev[dancerId] || [])];
        const [removed] = current.splice(source.index, 1);
        current.splice(destination.index, 0, removed);
        const updated = { ...prev, [dancerId]: current };
        onAutoSavePlaylist?.(dancerId, current, { type: 'reorder' });
        return updated;
      });
      return;
    }
  };

  const removeSong = (dancerId, songIndex) => {
    djOverridesRef.current.add(dancerId);
    setSongAssignments(prev => {
      const current = [...(prev[dancerId] || [])];
      const removedSong = current[songIndex];
      current.splice(songIndex, 1);
      const updated = { ...prev, [dancerId]: current };
      onAutoSavePlaylist?.(dancerId, current, { type: 'remove', song: removedSong });
      return updated;
    });
  };

  const handleAddToRotation = (dancerId) => {
    if (!localRotation.includes(dancerId)) {
      setLocalRotation([...localRotation, dancerId]);
      onAddToRotation?.(dancerId);
    }
  };

  const handleRemoveFromRotation = (dancerId) => {
    setLocalRotation(localRotation.filter(id => id !== dancerId));
    const updated = { ...songAssignments };
    delete updated[dancerId];
    setSongAssignments(updated);
    setInterstitialSongs(prev => {
      const cleaned = { ...prev };
      delete cleaned[`after-${dancerId}`];
      return cleaned;
    });
    onRemoveFromRotation?.(dancerId);
  };

  const addInterstitialSong = useCallback((breakKey, trackName) => {
    setInterstitialSongs(prev => {
      const current = [...(prev[breakKey] || [])];
      if (current.includes(trackName)) {
        toast.error('Song already in break slot');
        return prev;
      }
      current.push(trackName);
      return { ...prev, [breakKey]: current };
    });
  }, []);

  const removeInterstitialSong = useCallback((breakKey, songIndex) => {
    setInterstitialSongs(prev => {
      const current = [...(prev[breakKey] || [])];
      current.splice(songIndex, 1);
      const updated = { ...prev };
      if (current.length === 0) {
        delete updated[breakKey];
      } else {
        updated[breakKey] = current;
      }
      return updated;
    });
  }, []);

  const handleSave = async () => {
    const playlists = {};
    Object.entries(songAssignments).forEach(([dancerId, songs]) => {
      playlists[dancerId] = songs;
      appliedPlaylistsRef.current[dancerId] = songs.join(',');
    });

    let finalInterstitials = { ...interstitialSongs };

    if (breakSongsPerSet > 0 && localRotation.length > 0) {
      const slotsNeedingFill = [];
      let totalNeeded = 0;
      for (const dancerId of localRotation) {
        const key = `after-${dancerId}`;
        const existing = finalInterstitials[key] || [];
        const needed = breakSongsPerSet - existing.length;
        if (needed > 0) {
          slotsNeedingFill.push({ dancerId, key, existing, needed });
          totalNeeded += needed;
        }
      }

      if (totalNeeded > 0) {
        try {
          const token = sessionStorage.getItem('djbooth_token');
          const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
          const existingBreakNames = Object.values(finalInterstitials).flat();
          const excludeNames = [...new Set([...Object.values(playlists).flat(), ...existingBreakNames])];
          const activeGenres = djOptions?.activeGenres?.length > 0 ? djOptions.activeGenres : [];

          const res = await fetch('/api/music/select', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              count: totalNeeded,
              excludeNames,
              genres: activeGenres,
              dancerPlaylist: []
            }),
            signal: AbortSignal.timeout(8000)
          });

          if (res.ok) {
            const data = await res.json();
            const pool = fisherYatesShuffle((data.tracks || []).map(t => t.name));
            let poolIdx = 0;
            for (const slot of slotsNeedingFill) {
              const filled = [...slot.existing];
              for (let i = 0; i < slot.needed && poolIdx < pool.length; i++) {
                filled.push(pool[poolIdx++]);
              }
              finalInterstitials[slot.key] = filled;
            }
            setInterstitialSongs(finalInterstitials);
            console.log('🎵 Auto-populated break songs for', slotsNeedingFill.length, 'slots (' + pool.length + '/' + totalNeeded + ' tracks)');
          } else {
            toast.error('Could not load break songs — try again');
          }
        } catch (err) {
          console.warn('⚠️ Failed to auto-populate break songs:', err.message);
          toast.error('Could not load break songs — try again');
        }
      }

      let trimmed = false;
      for (const dancerId of localRotation) {
        const key = `after-${dancerId}`;
        if (finalInterstitials[key] && finalInterstitials[key].length > breakSongsPerSet) {
          finalInterstitials[key] = finalInterstitials[key].slice(0, breakSongsPerSet);
          trimmed = true;
        }
      }
      if (trimmed) {
        setInterstitialSongs(finalInterstitials);
      }
    }

    if (breakSongsPerSet === 0) {
      finalInterstitials = {};
      setInterstitialSongs({});
    }

    onSaveAll?.(localRotation, playlists, finalInterstitials);
    toast.success('Rotation & playlists saved');
  };

  return (
    <div className="flex h-full bg-[#0d0d1f] rounded-xl border border-[#1e293b]">
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="w-1/2 border-r border-[#1e293b] flex flex-col">
          <div className="p-4 border-b border-[#1e293b]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">
                Music Library
              </h3>
              <span className="text-xs text-gray-500">
                {serverTracks.length} of {serverTotalTracks} tracks
              </span>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                placeholder="Search by name, genre, or path..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-[#151528] border-[#1e293b]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {genres.length > 0 && (
            <div className="px-3 py-2 border-b border-[#1e293b]">
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setActiveGenre(null)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    !activeGenre
                      ? 'bg-[#00d4ff] text-black'
                      : 'bg-[#151528] text-gray-400 hover:text-white hover:bg-[#1e293b]'
                  }`}
                >
                  All
                </button>
                {genres.map(g => (
                    <button
                      key={g.name}
                      onClick={() => setActiveGenre(activeGenre === g.name ? null : g.name)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        activeGenre === g.name
                          ? 'bg-[#00d4ff] text-black'
                          : 'bg-[#151528] text-gray-400 hover:text-white hover:bg-[#1e293b]'
                      }`}
                    >
                      <Folder className="w-3 h-3" />
                      {g.name}
                      <span className="opacity-60">{g.count}</span>
                    </button>
                ))}
              </div>
            </div>
          )}

          <Droppable droppableId="library" isDropDisabled={true} type="song">
            {(provided) => (
              <ScrollArea className="flex-1">
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="p-2"
                >
                  {displayedTracks.map((track, index) => (
                    <Draggable key={`lib-${track.id}`} draggableId={`lib-${track.id}`} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className={`flex items-center gap-2 px-3 py-2 mb-1 rounded-lg transition-colors cursor-grab active:cursor-grabbing ${
                            snapshot.isDragging
                              ? 'bg-[#00d4ff]/20 ring-2 ring-[#00d4ff]'
                              : 'bg-[#151528] hover:bg-[#1e293b]'
                          } cursor-pointer`}
                          onClick={() => handleLibraryTrackClick(track.name)}
                        >
                          <Music2 className="w-4 h-4 text-gray-500 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-white truncate block">{track.name}</span>
                            {!activeGenre && (track.genre || (track.path && track.path.includes('/'))) && (
                              <span className="text-xs text-gray-500 truncate block">{track.genre || track.path.split('/')[0]}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {serverHasMore && (
                    <div className="text-center py-3">
                      <button
                        onClick={loadMoreServerTracks}
                        disabled={serverLoading}
                        className="px-4 py-2 text-xs font-medium text-[#00d4ff] bg-[#00d4ff]/10 hover:bg-[#00d4ff]/20 rounded-lg transition-colors"
                      >
                        {serverLoading ? 'Loading...' : `Load More (${serverTracks.length} of ${serverTotalTracks})`}
                      </button>
                    </div>
                  )}
                  {serverTracks.length === 0 && !serverLoading && (
                    <div className="text-center py-8 text-gray-500 text-sm">
                      {debouncedSearch.trim() || activeGenre ? 'No tracks match your search' : 'No music files found'}
                    </div>
                  )}
                  {provided.placeholder}
                </div>
              </ScrollArea>
            )}
          </Droppable>
        </div>

        <div className="w-1/2 flex flex-col">
          <div className="p-4 border-b border-[#1e293b]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">
                  Rotation
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {rotationDancers.length} dancers &bull; drag to reorder
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-[#151528] rounded-lg border border-[#1e293b] p-0.5">
                  {[1, 2, 3].map(n => (
                    <button
                      key={n}
                      onClick={() => onSongsPerSetChange?.(n)}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                        songsPerSet === n
                          ? 'bg-[#00d4ff] text-black'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <span className="text-xs text-gray-500 px-1">songs</span>
                </div>
                <div className="flex items-center gap-1 bg-[#151528] rounded-lg border border-[#1e293b] p-0.5">
                  {[0, 1, 2, 3].map(n => (
                    <button
                      key={n}
                      onClick={() => onBreakSongsPerSetChange?.(n)}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                        breakSongsPerSet === n
                          ? 'bg-violet-500 text-white'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <span className="text-xs text-gray-500 px-1">breaks</span>
                </div>
                <button
                  onClick={() => onAnnouncementsToggle?.(!announcementsEnabled)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
                    announcementsEnabled
                      ? 'bg-[#00d4ff]/20 border-[#00d4ff] text-[#00d4ff]'
                      : 'bg-red-900/30 border-red-700 text-red-400'
                  }`}
                  title={announcementsEnabled ? 'Voice announcements ON — click to turn off' : 'Voice announcements OFF — click to turn on'}
                >
                  {announcementsEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                  <span className="text-xs font-bold">{announcementsEnabled ? 'Voice ON' : 'Voice OFF'}</span>
                </button>
                <Button
                  onClick={handleSave}
                  className="bg-[#00d4ff] hover:bg-[#00a3cc] text-black"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save All
                </Button>
                {rotationDancers.length > 0 && !isRotationActive && !rotationPending && (
                  <Button
                    onClick={onStartRotation}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Start
                  </Button>
                )}
                {rotationPending && (
                  <Button
                    onClick={onCancelPendingRotation}
                    className="bg-yellow-600 hover:bg-yellow-700 text-white animate-pulse"
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    Queued...
                  </Button>
                )}
              </div>
            </div>
            
          </div>

          <Droppable droppableId="rotation-list" type="dancer">
            {(provided) => (
              <ScrollArea className="flex-1">
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="p-4 space-y-1"
                >
                  {rotationDancers.map((dancer, index) => {
                    const assigned = songAssignments[dancer.id] || [];
                    const breakKey = `after-${dancer.id}`;
                    const breakSongs = interstitialSongs[breakKey] || [];
                    
                    return (
                      <React.Fragment key={dancer.id}>
                      <Draggable draggableId={`dancer-${dancer.id}`} index={index}>
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            className={`bg-[#151528] rounded-lg border overflow-hidden ${
                              dragSnapshot.isDragging
                                ? 'border-[#00d4ff] ring-2 ring-[#00d4ff]/30'
                                : 'border-[#1e293b]'
                            }`}
                          >
                            <div
                              className={`px-3 py-2.5 border-b flex items-center gap-2 cursor-pointer transition-colors ${
                                selectedDancerId === dancer.id
                                  ? 'border-[#00d4ff] bg-[#00d4ff]/10'
                                  : 'border-[#1e293b] hover:bg-[#1a1a35]'
                              }`}
                              onClick={() => setSelectedDancerId(selectedDancerId === dancer.id ? null : dancer.id)}
                            >
                              <div
                                {...dragProvided.dragHandleProps}
                                className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <GripVertical className="w-4 h-4" />
                              </div>
                              <div
                                className="w-7 h-7 rounded-full flex items-center justify-center text-black font-bold text-xs flex-shrink-0"
                                style={{ backgroundColor: dancer.color || '#00d4ff' }}
                              >
                                {dancer.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-white font-semibold text-sm truncate">{dancer.name}</p>
                                <p className="text-xs text-gray-500">
                                  {assigned.length > 0
                                    ? `${assigned.length} song${assigned.length !== 1 ? 's' : ''}`
                                    : 'No songs assigned'}
                                  {selectedDancerId === dancer.id && ' — tap songs to add'}
                                </p>
                              </div>
                              {isRotationActive && index !== currentDancerIndex && localRotation.length > 1 && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="w-11 h-11 text-yellow-500 hover:text-yellow-300 hover:bg-yellow-900/30 flex-shrink-0"
                                  title="Skip to bottom of rotation"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSkipDancer?.(dancer.id);
                                  }}
                                >
                                  <SkipForward className="w-5 h-5" />
                                </Button>
                              )}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="w-11 h-11 text-gray-500 hover:text-red-400 hover:bg-[#1e293b] flex-shrink-0"
                                onClick={(e) => { e.stopPropagation(); handleRemoveFromRotation(dancer.id); }}
                              >
                                <X className="w-5 h-5" />
                              </Button>
                            </div>

                            <Droppable droppableId={`songs-${dancer.id}`} type="song">
                              {(songProvided, songSnapshot) => (
                                <div
                                  ref={songProvided.innerRef}
                                  {...songProvided.droppableProps}
                                  className={`px-3 py-2 min-h-[40px] transition-colors ${
                                    songSnapshot.isDraggingOver ? 'bg-[#00d4ff]/10' : ''
                                  }`}
                                >
                                  {assigned.length > 0 ? (
                                    <div className="space-y-1">
                                      {assigned.map((songName, songIdx) => {
                                        const isCurrentDancer = isRotationActive && index === currentDancerIndex;
                                        const isPlayed = isCurrentDancer && songIdx < (currentSongNumber - 1);
                                        const isNowPlaying = isCurrentDancer && songIdx === (currentSongNumber - 1);
                                        if (isPlayed) return null;
                                        return (
                                          <Draggable key={`${dancer.id}-${songName}`} draggableId={`assigned-${dancer.id}-${songName}`} index={songIdx}>
                                            {(songDragProvided, songDragSnapshot) => (
                                              <div
                                                ref={songDragProvided.innerRef}
                                                {...songDragProvided.draggableProps}
                                                {...songDragProvided.dragHandleProps}
                                                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${
                                                  songDragSnapshot.isDragging
                                                    ? 'bg-[#00d4ff]/20 border-[#00d4ff]'
                                                    : isNowPlaying
                                                      ? 'bg-[#00d4ff]/15 border-[#00d4ff]/50'
                                                      : 'bg-[#0d0d1f] border-[#1e293b]'
                                                }`}
                                              >
                                                <span className="text-xs font-bold w-4 flex-shrink-0 text-[#00d4ff]">{isNowPlaying ? '▶' : songIdx + 1}</span>
                                                <Music2 className={`w-3 h-3 flex-shrink-0 ${isNowPlaying ? 'text-[#00d4ff]' : 'text-gray-500'}`} />
                                                <span className={`text-xs truncate flex-1 ${isNowPlaying ? 'text-white font-medium' : 'text-gray-300'}`}>{songName}</span>
                                                <button
                                                  onClick={() => removeSong(dancer.id, songIdx)}
                                                  className="p-1 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
                                                >
                                                  <X className="w-5 h-5" />
                                                </button>
                                              </div>
                                            )}
                                          </Draggable>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-center h-[36px] border-2 border-dashed border-[#1e293b] rounded-lg">
                                      <p className="text-xs text-gray-600">Drag songs here from library</p>
                                    </div>
                                  )}
                                  {songProvided.placeholder}
                                </div>
                              )}
                            </Droppable>
                          </div>
                        )}
                      </Draggable>

                      {index < rotationDancers.length - 1 && (
                        <Droppable droppableId={`break-${breakKey}`} type="song">
                          {(breakProvided, breakSnapshot) => (
                            <div
                              ref={breakProvided.innerRef}
                              {...breakProvided.droppableProps}
                              className={`mx-2 my-1 rounded-lg transition-colors ${
                                breakSongs.length > 0 || breakSnapshot.isDraggingOver
                                  ? 'border border-dashed border-violet-500/40 bg-violet-900/10 p-2'
                                  : 'border border-dashed border-[#1e293b]/50 p-1'
                              }`}
                            >
                              {breakSongs.length > 0 ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1 px-1 mb-1">
                                    <Music2 className="w-3 h-3 text-violet-400" />
                                    <span className="text-[10px] text-violet-400 uppercase font-semibold tracking-wider">Break Song{breakSongs.length > 1 ? 's' : ''}</span>
                                  </div>
                                  {breakSongs.map((songName, songIdx) => (
                                    <div
                                      key={`break-${breakKey}-${songName}`}
                                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-violet-900/20 border border-violet-500/20"
                                    >
                                      <Music2 className="w-3 h-3 text-violet-400 flex-shrink-0" />
                                      <span className="text-xs text-violet-300 truncate flex-1">{songName}</span>
                                      <button
                                        onClick={() => removeInterstitialSong(breakKey, songIdx)}
                                        className="p-1 text-violet-400/60 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
                                      >
                                        <X className="w-5 h-5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className={`flex items-center justify-center transition-colors rounded ${
                                  breakSnapshot.isDraggingOver ? 'h-[36px]' : 'h-[20px]'
                                }`}>
                                  <p className="text-[10px] text-gray-600">
                                    {breakSnapshot.isDraggingOver ? 'Drop for break song' : '· · ·'}
                                  </p>
                                </div>
                              )}
                              {breakProvided.placeholder}
                            </div>
                          )}
                        </Droppable>
                      )}
                      </React.Fragment>
                    );
                  })}
                  {provided.placeholder}

                  {rotationDancers.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                      <Music2 className="w-12 h-12 mx-auto mb-3 text-gray-700" />
                      <p className="text-sm">No dancers in rotation</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </Droppable>
        </div>
      </DragDropContext>
    </div>
  );
}
