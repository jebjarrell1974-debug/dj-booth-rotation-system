import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, useMouseSensor } from '@hello-pangea/dnd';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Music2, X, Save, Search, Play, GripVertical, Mic, MicOff, Folder, AlertCircle, Clock, SkipForward, ChevronDown, ChevronUp, Radio, ListMusic, Shuffle, RefreshCw } from 'lucide-react';
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

const LONG_PRESS_MS = 500;
const SCROLL_SLOP_PX = 8;

function useLongPressTouchSensor(api) {
  const phaseRef = useRef({ type: 'IDLE' });

  useEffect(() => {
    function cleanup() {
      const phase = phaseRef.current;
      if (phase.type === 'PENDING') {
        clearTimeout(phase.timerId);
        phase.actions.abort();
      }
      phaseRef.current = { type: 'IDLE' };
    }

    function onTouchStart(event) {
      if (event.defaultPrevented || phaseRef.current.type !== 'IDLE') return;
      const draggableId = api.findClosestDraggableId(event);
      if (!draggableId) return;
      const actions = api.tryGetLock(draggableId, cleanup, { sourceEvent: event });
      if (!actions) return;
      const touch = event.touches[0];
      const startPoint = { x: touch.clientX, y: touch.clientY };
      const timerId = setTimeout(() => {
        if (phaseRef.current.type !== 'PENDING') return;
        const { actions, startPoint } = phaseRef.current;
        const dragActions = actions.fluidLift(startPoint);
        phaseRef.current = { type: 'DRAGGING', actions: dragActions };
      }, LONG_PRESS_MS);
      phaseRef.current = { type: 'PENDING', actions, startPoint, timerId };
    }

    function onTouchMove(event) {
      const phase = phaseRef.current;
      if (phase.type === 'DRAGGING') {
        event.preventDefault();
        const touch = event.touches[0];
        phase.actions.move({ x: touch.clientX, y: touch.clientY });
        return;
      }
      if (phase.type === 'PENDING') {
        const touch = event.touches[0];
        const dx = touch.clientX - phase.startPoint.x;
        const dy = touch.clientY - phase.startPoint.y;
        if (Math.sqrt(dx * dx + dy * dy) > SCROLL_SLOP_PX) cleanup();
      }
    }

    function onTouchEnd() {
      const phase = phaseRef.current;
      if (phase.type === 'DRAGGING') {
        phase.actions.drop({ shouldBlockNextClick: true });
        phaseRef.current = { type: 'IDLE' };
        return;
      }
      cleanup();
    }

    function onTouchCancel() {
      const phase = phaseRef.current;
      if (phase.type === 'DRAGGING') phase.actions.cancel({ shouldBlockNextClick: true });
      cleanup();
    }

    const opts = { capture: true, passive: false };
    window.addEventListener('touchstart', onTouchStart, opts);
    window.addEventListener('touchmove', onTouchMove, opts);
    window.addEventListener('touchend', onTouchEnd, { capture: true });
    window.addEventListener('touchcancel', onTouchCancel, { capture: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart, opts);
      window.removeEventListener('touchmove', onTouchMove, opts);
      window.removeEventListener('touchend', onTouchEnd, { capture: true });
      window.removeEventListener('touchcancel', onTouchCancel, { capture: true });
      cleanup();
    };
  }, [api]);
}

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
  activeBreakInfo,
  onRemoveActiveBreakSong,
  onUpdateActiveBreakSongs,
  djOptions,
  announcementsEnabled,
  onAnnouncementsToggle,
  onSkipDancer,
  currentDancerIndex,
  commercialCounter = 0,
  availablePromos = [],
  promoQueue = [],
  onSwapPromo,
  currentSongNumber,
  breakSongsPerSet,
  onBreakSongsPerSetChange,
  onSongAssignmentsChange,
  autoplayQueue = [],
  onAutoplayQueueChange,
  onAutoplayQueueRemove,
  songCooldowns = {}
}) {
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeGenre, setActiveGenre] = useState(null);
  const [musicSource, setMusicSource] = useState('genres');

  const activeDancers = useMemo(() =>
    (dancers || []).filter(d => d.is_active).sort((a, b) => a.name.localeCompare(b.name)),
    [dancers]
  );

  const selectedPlaylistDancer = musicSource !== 'genres'
    ? (dancers || []).find(d => String(d.id) === String(musicSource))
    : null;
  const playlistSongs = selectedPlaylistDancer?.playlist || [];
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
  const [commercialFreq, setCommercialFreq] = useState(() => localStorage.getItem('neonaidj_commercial_freq') || 'off');
  const [skippedCommercials, setSkippedCommercials] = useState(() => {
    try {
      const saved = localStorage.getItem('neonaidj_skipped_commercials');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const appliedPlaylistsRef = React.useRef({});
  const songAssignmentsRef = React.useRef({});
  const djOverridesRef = React.useRef(new Set());
  const prevCurrentDancerIdRef = React.useRef(null);
  const saveGuardRef = React.useRef(0);
  const libraryPanelRef = useRef(null);
  const rerollingRef = React.useRef(new Set());
  const [rerollingKeys, setRerollingKeys] = useState(new Set());
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
    const checkFreq = () => {
      const freq = localStorage.getItem('neonaidj_commercial_freq') || 'off';
      setCommercialFreq(freq);
    };
    window.addEventListener('storage', checkFreq);
    const interval = setInterval(checkFreq, 2000);
    return () => { window.removeEventListener('storage', checkFreq); clearInterval(interval); };
  }, []);

  useEffect(() => {
    songAssignmentsRef.current = songAssignments;
    onSongAssignmentsChange?.(songAssignments);
  }, [songAssignments]);

  useEffect(() => {
    if (musicSource === 'genres') return;
    const handleClickOutside = (e) => {
      if (libraryPanelRef.current && !libraryPanelRef.current.contains(e.target)) {
        setMusicSource('genres');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [musicSource]);

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
    if (!isRotationActive || !localRotation || localRotation.length === 0) return;
    const currentId = String(localRotation[0]);
    if (prevCurrentDancerIdRef.current && prevCurrentDancerIdRef.current !== currentId) {
      djOverridesRef.current.delete(prevCurrentDancerIdRef.current);
    }
    prevCurrentDancerIdRef.current = currentId;
  }, [localRotation, isRotationActive]);

  useEffect(() => {
    if (isRotationActive && activeRotationSongs && Object.keys(activeRotationSongs).length > 0) {
      setSongAssignments(prev => {
        const fromActive = { ...prev };
        Object.entries(activeRotationSongs).forEach(([dancerId, trackList]) => {
          if (djOverridesRef.current.has(dancerId)) return;
          if (trackList && trackList.length > 0) fromActive[dancerId] = trackList.map(t => t.name);
        });
        return fromActive;
      });
      // Do NOT return early — dancers absent from activeRotationSongs still need auto-assignment below
    }

    if (saveGuardRef.current > Date.now()) return;

    const dancersNeedingAssignment = localRotation.filter(dancerId => {
      if (djOverridesRef.current.has(dancerId)) return false;
      const current = songAssignmentsRef.current[dancerId];
      if (current && current.length > 0) return false;
      return true;
    });
    if (dancersNeedingAssignment.length === 0) return;

    const isFoldersOnly = djOptions?.musicMode === 'folders_only';
    const activeGenres = djOptions?.activeGenres?.length > 0 ? djOptions.activeGenres : [];

    (async () => {
      const token = localStorage.getItem('djbooth_token');
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

        const excludeSet = new Set(batchExcludes);
        const fallbackPlaylist = dancer?.playlist || [];
        let assigned = [];
        if (!isFoldersOnly && fallbackPlaylist.length > 0) {
          const playlistSet = new Set(fallbackPlaylist);
          const playlistTracks = tracks.filter(t => playlistSet.has(t.name) && !excludeSet.has(t.name));
          assigned = fisherYatesShuffle(playlistTracks).slice(0, songsPerSet).map(t => t.name);
        }
        if (assigned.length < songsPerSet) {
          const genrePool = filterByGenres(tracks, activeGenres);
          const usedSet = new Set([...excludeSet, ...assigned]);
          const available = genrePool.filter(t => !usedSet.has(t.name));
          assigned = [...assigned, ...fisherYatesShuffle(available).slice(0, songsPerSet - assigned.length).map(t => t.name)];
        }
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

  const prevMusicModeRef = useRef(djOptions?.musicMode || 'dancer_first');
  useEffect(() => {
    const currentMode = djOptions?.musicMode || 'dancer_first';
    if (prevMusicModeRef.current === currentMode) return;
    prevMusicModeRef.current = currentMode;
    const nonOverridden = Object.keys(songAssignmentsRef.current).filter(id => !djOverridesRef.current.has(id));
    if (nonOverridden.length === 0) return;
    setSongAssignments(prev => {
      const updated = { ...prev };
      nonOverridden.forEach(id => { delete updated[id]; });
      return updated;
    });
  }, [djOptions?.musicMode]);

  const prevSongsPerSetRef = useRef(songsPerSet);
  useEffect(() => {
    if (prevSongsPerSetRef.current === songsPerSet) return;
    prevSongsPerSetRef.current = songsPerSet;
    if (tracks.length === 0) return;
    const genrePool = filterByGenres(tracks, djOptions?.activeGenres);
    const allUsed = new Set(Object.values(songAssignmentsRef.current).flat());
    setSongAssignments(prev => {
      const updated = { ...prev };
      let changed = false;
      Object.keys(updated).forEach(dancerId => {
        const songs = updated[dancerId];
        if (!songs) return;
        if (songs.length > songsPerSet) {
          updated[dancerId] = songs.slice(0, songsPerSet);
          changed = true;
        } else if (songs.length < songsPerSet) {
          const usedNames = new Set([...allUsed, ...songs]);
          const dancer = dancers.find(d => d.id === dancerId);
          const dancerPlaylist = dancer?.playlist || [];
          let extras = [];
          if (dancerPlaylist.length > 0) {
            const unusedFromPlaylist = dancerPlaylist.filter(n => !usedNames.has(n));
            extras = fisherYatesShuffle(unusedFromPlaylist);
          }
          if (extras.length < songsPerSet - songs.length) {
            const available = genrePool.filter(t => !usedNames.has(t.name));
            extras = [...extras, ...fisherYatesShuffle(available).map(t => t.name)];
          }
          const needed = songsPerSet - songs.length;
          updated[dancerId] = [...songs, ...extras.slice(0, needed)];
          updated[dancerId].forEach(n => allUsed.add(n));
          changed = true;
        }
      });
      return changed ? updated : prev;
    });
  }, [songsPerSet, tracks, dancers, djOptions]);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('djbooth_token');
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
      if (activeGenre && !debouncedSearch.trim()) params.set('genre', activeGenre);
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

  const genreFilteredTracks = debouncedSearch.trim() ? serverTracks : filterByGenres(serverTracks, djOptions?.activeGenres);
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
      return updated;
    });
  }, []);
  
  const handleLibraryTrackClick = useCallback((trackName) => {
    const targetId = selectedDancerId || (rotationDancers.length === 1 ? rotationDancers[0]?.id : null);
    if (!targetId) {
      toast('Tap an entertainer name first to select them', { icon: '👆' });
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

    const resolveTrackName = () => {
      if (result.draggableId.startsWith('playlist-')) {
        const parts = result.draggableId.replace('playlist-', '');
        return parts.substring(parts.indexOf('-') + 1);
      }
      const dragId = result.draggableId.replace('lib-', '');
      const track = displayedTracks.find(t => String(t.id) === dragId) || displayedTracks[source.index];
      return track ? track.name : null;
    };

    if (source.droppableId === 'library' && destination.droppableId.startsWith('songs-')) {
      const dancerId = destination.droppableId.replace('songs-', '');
      const trackName = resolveTrackName();
      if (!trackName) return;

      djOverridesRef.current.add(dancerId);
      setSongAssignments(prev => {
        const current = [...(prev[dancerId] || [])];
        if (current.includes(trackName)) {
          toast.error('Song already assigned');
          return prev;
        }
        current.splice(destination.index, 0, trackName);
        const updated = { ...prev, [dancerId]: current };
        return updated;
      });
      return;
    }

    if (source.droppableId === 'library' && destination.droppableId.startsWith('break-')) {
      const breakKey = destination.droppableId.replace('break-', '');
      const trackName = resolveTrackName();
      if (!trackName) return;
      setInterstitialSongs(prev => {
        const current = [...(prev[breakKey] || [])];
        if (current.includes(trackName)) {
          toast.error('Already in this slot');
          return prev;
        }
        current.splice(destination.index, 0, trackName);
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
        return updated;
      });
      return;
    }

    if (source.droppableId === destination.droppableId && source.droppableId.startsWith('break-')) {
      const breakKey = source.droppableId.replace('break-', '');
      setInterstitialSongs(prev => {
        const current = [...(prev[breakKey] || [])];
        const [removed] = current.splice(source.index, 1);
        current.splice(destination.index, 0, removed);
        return { ...prev, [breakKey]: current };
      });
      return;
    }

    if (source.droppableId === 'library' && destination.droppableId === 'autoplay-queue') {
      const trackName = resolveTrackName();
      if (!trackName) return;
      const track = displayedTracks.find(t => t.name === trackName);
      if (!track) return;
      const trackObj = { ...track, url: `/api/music/stream/${track.id}`, autoFilled: false };
      if (autoplayQueue.some(t => t.name === trackName)) {
        toast.error('Song already in autoplay queue');
        return;
      }
      const newQueue = [...autoplayQueue];
      newQueue.splice(destination.index, 0, trackObj);
      onAutoplayQueueChange?.(newQueue);
      return;
    }

    if (source.droppableId === 'autoplay-queue' && destination.droppableId === 'autoplay-queue') {
      const newQueue = [...autoplayQueue];
      const [moved] = newQueue.splice(source.index, 1);
      newQueue.splice(destination.index, 0, moved);
      onAutoplayQueueChange?.(newQueue);
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
      return updated;
    });
  };

  const rerollSong = useCallback(async (dancerId, songIndex) => {
    const key = `${dancerId}-${songIndex}`;
    if (rerollingRef.current.has(key)) return;
    rerollingRef.current.add(key);
    setRerollingKeys(prev => new Set([...prev, key]));

    const finish = () => {
      rerollingRef.current.delete(key);
      setRerollingKeys(prev => { const next = new Set(prev); next.delete(key); return next; });
    };

    try {
      const allAssigned = [];
      Object.entries(songAssignmentsRef.current).forEach(([id, songs]) => {
        if (songs) songs.forEach(n => { if (id !== dancerId || songs.indexOf(n) !== songIndex) allAssigned.push(n); });
      });

      const dancer = dancers.find(d => d.id === dancerId);
      const dancerPlaylist = dancer?.playlist || [];
      const activeGenres = djOptions?.activeGenres?.length > 0 ? djOptions.activeGenres : [];
      try {
        const token = localStorage.getItem('djbooth_token');
        const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
        const res = await fetch('/api/music/select', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            count: 1,
            excludeNames: [...new Set(allAssigned)],
            genres: activeGenres,
            dancerPlaylist
          }),
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const data = await res.json();
          const newTrack = data.tracks?.[0];
          if (newTrack) {
            djOverridesRef.current.add(dancerId);
            setSongAssignments(prev => {
              const current = [...(prev[dancerId] || [])];
              current[songIndex] = newTrack.name;
              return { ...prev, [dancerId]: current };
            });
            toast.success(`Re-rolled: ${newTrack.name.replace(/\.[^.]+$/, '')}`);
            return;
          }
        }
      } catch (err) {
        console.warn('Re-roll failed:', err.message);
      }

      const excludeSet = new Set(allAssigned);
      const allTracks = serverTracks.length > 0 ? serverTracks : tracks;
      const playlistSet = new Set(dancerPlaylist);
      const playlistTracks = dancerPlaylist.length > 0
        ? allTracks.filter(t => playlistSet.has(t.name) && !excludeSet.has(t.name))
        : filterByGenres(allTracks, activeGenres).filter(t => !excludeSet.has(t.name));
      const available = playlistTracks.length > 0 ? playlistTracks : filterByGenres(allTracks, activeGenres).filter(t => !excludeSet.has(t.name));
      if (available.length > 0) {
        const pick = available[Math.floor(Math.random() * available.length)];
        djOverridesRef.current.add(dancerId);
        setSongAssignments(prev => {
          const current = [...(prev[dancerId] || [])];
          current[songIndex] = pick.name;
          return { ...prev, [dancerId]: current };
        });
        toast.success(`Re-rolled: ${pick.name.replace(/\.[^.]+$/, '')}`);
      } else {
        toast.error('No other songs available to pick from');
      }
    } finally {
      finish();
    }
  }, [djOptions, tracks, serverTracks, dancers]);

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

  const moveActiveBreakSong = useCallback((upcomingIdx, direction) => {
    if (!activeBreakInfo || !onUpdateActiveBreakSongs) return;
    const { songs, currentIndex, breakKey } = activeBreakInfo;
    const upcoming = [...songs.slice(currentIndex + 1)];
    const targetIdx = upcomingIdx + direction;
    if (targetIdx < 0 || targetIdx >= upcoming.length) return;
    [upcoming[upcomingIdx], upcoming[targetIdx]] = [upcoming[targetIdx], upcoming[upcomingIdx]];
    const newFullSongs = [...songs.slice(0, currentIndex + 1), ...upcoming];
    onUpdateActiveBreakSongs(breakKey, newFullSongs);
  }, [activeBreakInfo, onUpdateActiveBreakSongs]);

  const lastBreakSwapTimeRef = useRef(0);
  const replaceActiveBreakSong = useCallback((upcomingIdx) => {
    const now = Date.now();
    if (now - lastBreakSwapTimeRef.current < 1000) return;
    lastBreakSwapTimeRef.current = now;
    if (!activeBreakInfo || !onUpdateActiveBreakSongs) return;
    const { songs, currentIndex, breakKey } = activeBreakInfo;
    const upcoming = [...songs.slice(currentIndex + 1)];
    const allBreakNames = new Set(songs);
    const allAssigned = new Set(Object.values(songAssignmentsRef.current).flat());
    const pool = (serverTracks.length > 0 ? serverTracks : tracks).filter(t => !allBreakNames.has(t.name) && !allAssigned.has(t.name));
    if (pool.length === 0) { toast.error('No other songs available'); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    upcoming[upcomingIdx] = pick.name;
    const newFullSongs = [...songs.slice(0, currentIndex + 1), ...upcoming];
    onUpdateActiveBreakSongs(breakKey, newFullSongs);
    toast.success(`Swapped: ${pick.name.replace(/\.[^.]+$/, '')}`);
  }, [activeBreakInfo, onUpdateActiveBreakSongs, tracks, serverTracks]);

  const lastSaveTimeRef = useRef(0);
  const lastSkipDancerTimeRef = useRef(0);
  const handleSave = async () => {
    const now = Date.now();
    if (now - lastSaveTimeRef.current < 2000) return;
    lastSaveTimeRef.current = now;
    const playlists = {};
    Object.entries(songAssignments).forEach(([dancerId, songs]) => {
      playlists[dancerId] = songs;
      appliedPlaylistsRef.current[dancerId] = songs.join(',');
    });

    const finalInterstitials = { ...interstitialSongs };
    const manualOverrides = [...djOverridesRef.current];

    saveGuardRef.current = Date.now() + 30000;
    onSaveAll?.(localRotation, playlists, finalInterstitials, manualOverrides);
    toast.success('Rotation & playlists saved');
  };


  return (
    <div className="flex h-full bg-[#0d0d1f] rounded-xl border border-[#1e293b]">
      <DragDropContext onDragEnd={handleDragEnd} sensors={[useMouseSensor, useLongPressTouchSensor]} enableDefaultSensors={false}>
        <div ref={libraryPanelRef} className="w-1/2 border-r border-[#1e293b] flex flex-col">
          <div className="p-4 border-b border-[#1e293b]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">
                Music Library
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">
                  {musicSource === 'genres'
                    ? `${serverTracks.length} of ${serverTotalTracks} tracks`
                    : `${playlistSongs.length} songs`
                  }
                </span>
              </div>
            </div>
            <select
              value={musicSource}
              onChange={(e) => {
                setMusicSource(e.target.value);
                setSearchQuery('');
                setActiveGenre(null);
              }}
              className="w-full mb-2 px-3 py-2 bg-[#151528] border border-[#1e293b] rounded-lg text-sm text-gray-300 appearance-none cursor-pointer focus:outline-none focus:border-[#00d4ff]"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: '28px' }}
            >
              <option value="genres">Entertainers</option>
              {activeDancers.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}'s Playlist ({(d.playlist || []).length})
                </option>
              ))}
            </select>
            {musicSource === 'genres' && (
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
            )}
          </div>

          {musicSource === 'genres' && genres.length > 0 && (
            <div className="px-3 py-2 border-b border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-gray-400 shrink-0" />
                <select
                  value={activeGenre || ''}
                  onChange={(e) => setActiveGenre(e.target.value || null)}
                  className="flex-1 bg-[#08081a] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white appearance-none cursor-pointer focus:outline-none focus:border-[#00d4ff] hover:border-[#2563eb] transition-colors"
                  style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: '30px' }}
                >
                  <option value="">All Genres ({genres.reduce((sum, g) => sum + g.count, 0)})</option>
                  {genres.map(g => (
                    <option key={g.name} value={g.name}>{g.name} ({g.count})</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {musicSource !== 'genres' ? (
          <Droppable droppableId="library" isDropDisabled={true} type="song">
            {(provided) => (
            <ScrollArea className="flex-1">
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="p-2"
              >
                {playlistSongs.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    {selectedPlaylistDancer?.name} hasn't added any songs yet
                  </div>
                ) : (
                  playlistSongs.map((songName, idx) => (
                    <Draggable key={`playlist-${idx}-${songName}`} draggableId={`playlist-${idx}-${songName}`} index={idx}>
                      {(provided, snapshot) => {
                        const onCool = !!(songCooldowns[songName] && (Date.now() - songCooldowns[songName]) < FOUR_HOURS_MS);
                        return (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      onClick={() => handleLibraryTrackClick(songName)}
                      className={`flex items-center gap-2 px-3 py-2 mb-1 rounded-lg transition-colors cursor-grab active:cursor-grabbing ${
                        snapshot.isDragging
                          ? 'bg-[#a855f7]/20 ring-2 ring-[#a855f7]'
                          : 'bg-[#151528] hover:bg-[#1e293b]'
                      } cursor-pointer`}
                    >
                      <ListMusic className={`w-4 h-4 flex-shrink-0 ${onCool ? 'text-orange-400' : 'text-[#a855f7]'}`} />
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm truncate block ${onCool ? 'text-orange-300' : 'text-white'}`}>{songName}</span>
                      </div>
                    </div>
                        );
                      }}
                    </Draggable>
                  ))
                )}
                {provided.placeholder}
              </div>
            </ScrollArea>
            )}
          </Droppable>
          ) : (
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
                          className={`flex items-center gap-2 px-3 py-2 mb-1 rounded-lg transition-colors ${
                            snapshot.isDragging
                              ? 'bg-[#00d4ff]/20 ring-2 ring-[#00d4ff]'
                              : 'bg-[#151528] hover:bg-[#1e293b]'
                          } cursor-grab active:cursor-grabbing cursor-pointer`}
                          onClick={() => handleLibraryTrackClick(track.name)}
                        >
                          {(() => { const onCool = !!(songCooldowns[track.name] && (Date.now() - songCooldowns[track.name]) < FOUR_HOURS_MS); return (
                          <Music2 className={`w-4 h-4 flex-shrink-0 ${onCool ? 'text-orange-400' : 'text-gray-500'}`} />
                          ); })()}
                          <div className="flex-1 min-w-0">
                            {(() => { const onCool = !!(songCooldowns[track.name] && (Date.now() - songCooldowns[track.name]) < FOUR_HOURS_MS); return (
                            <span className={`text-sm truncate block ${onCool ? 'text-orange-300' : 'text-white'}`}>{track.name}</span>
                            ); })()}
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
          )}
        </div>

        <div className="w-1/2 flex flex-col">
          <div className="p-4 border-b border-[#1e293b]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">
                  Rotation
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {rotationDancers.length} entertainers &bull; drag to reorder
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
                  {activeBreakInfo && activeBreakInfo.songs.length > 0 && (() => {
                    const upcomingBreaks = activeBreakInfo.songs.slice(activeBreakInfo.currentIndex + 1);
                    if (upcomingBreaks.length === 0) return null;
                    return (
                      <div className="mx-2 mb-2 rounded-lg border border-dashed border-violet-500/40 bg-violet-900/10 p-2">
                        <div className="flex items-center gap-1 px-1 mb-1">
                          <Music2 className="w-3 h-3 text-violet-400" />
                          <span className="text-[10px] text-violet-400 uppercase font-semibold tracking-wider">Up Next — Break Song{upcomingBreaks.length > 1 ? 's' : ''}</span>
                        </div>
                        <div className="space-y-1">
                          {upcomingBreaks.map((songName, i) => {
                            const actualIndex = activeBreakInfo.currentIndex + 1 + i;
                            return (
                              <div
                                key={`active-break-${i}`}
                                className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-violet-900/20 border border-violet-500/20"
                              >
                                <Music2 className="w-3 h-3 text-violet-400 flex-shrink-0" />
                                <span className="text-sm text-violet-300 truncate flex-1 mx-1">{songName}</span>
                                <button
                                  onClick={() => moveActiveBreakSong(i, -1)}
                                  disabled={i === 0}
                                  title="Move up"
                                  className="p-0.5 text-violet-400/60 hover:text-violet-200 disabled:opacity-20 disabled:cursor-not-allowed rounded transition-colors flex-shrink-0"
                                >
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => moveActiveBreakSong(i, 1)}
                                  disabled={i === upcomingBreaks.length - 1}
                                  title="Move down"
                                  className="p-0.5 text-violet-400/60 hover:text-violet-200 disabled:opacity-20 disabled:cursor-not-allowed rounded transition-colors flex-shrink-0"
                                >
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => replaceActiveBreakSong(i)}
                                  title="Swap for another song"
                                  className="p-0.5 text-violet-400/60 hover:text-amber-400 rounded transition-colors flex-shrink-0"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                                {onRemoveActiveBreakSong && activeBreakInfo.breakKey && (
                                  <button
                                    onClick={() => onRemoveActiveBreakSong(activeBreakInfo.breakKey, actualIndex)}
                                    title="Remove"
                                    className="p-0.5 text-violet-400/60 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  {(() => { const isFoldersOnlyMode = djOptions?.musicMode === 'folders_only'; return rotationDancers.map((dancer, index) => {
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
                                    const now = Date.now();
                                    if (now - lastSkipDancerTimeRef.current < 2000) return;
                                    lastSkipDancerTimeRef.current = now;
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
                                        const rerollKey = `${dancer.id}-${songIdx}`;
                                        const isRerollingSlot = rerollingKeys.has(rerollKey);
                                        const canReroll = !isNowPlaying && !isRerollingSlot;
                                        return (
                                          <Draggable key={`${dancer.id}-${songName}`} draggableId={`assigned-${dancer.id}-${songName}`} index={songIdx}>
                                            {(songDragProvided, songDragSnapshot) => (
                                              <div
                                                ref={songDragProvided.innerRef}
                                                {...songDragProvided.draggableProps}
                                                {...songDragProvided.dragHandleProps}
                                                onClick={canReroll ? () => rerollSong(dancer.id, songIdx) : undefined}
                                                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${
                                                  songDragSnapshot.isDragging
                                                    ? 'bg-[#00d4ff]/20 border-[#00d4ff]'
                                                    : isNowPlaying
                                                      ? 'bg-[#00d4ff]/15 border-[#00d4ff]/50'
                                                      : isRerollingSlot
                                                        ? 'bg-[#0d0d1f] border-[#1e293b] opacity-60 cursor-wait'
                                                        : canReroll
                                                          ? 'bg-[#0d0d1f] border-[#1e293b] hover:border-amber-500/50 hover:bg-amber-900/10 cursor-pointer'
                                                          : 'bg-[#0d0d1f] border-[#1e293b]'
                                                }`}
                                              >
                                                <span className="text-sm font-bold w-4 flex-shrink-0 text-[#00d4ff]">{isNowPlaying ? '▶' : songIdx + 1}</span>
                                                {isRerollingSlot ? (
                                                  <RefreshCw className="w-3 h-3 flex-shrink-0 text-amber-400 animate-spin" />
                                                ) : canReroll ? (
                                                  <Shuffle className="w-3 h-3 flex-shrink-0 text-amber-400" />
                                                ) : (
                                                  <Music2 className={`w-3 h-3 flex-shrink-0 ${isNowPlaying ? 'text-[#00d4ff]' : (!isNowPlaying && songCooldowns[songName] && (Date.now() - songCooldowns[songName]) < FOUR_HOURS_MS) ? 'text-orange-400' : 'text-gray-500'}`} />
                                                )}
                                                <span className={`text-sm truncate flex-1 ${isNowPlaying ? 'text-[#E0E0E0] font-medium' : (!isNowPlaying && songCooldowns[songName] && (Date.now() - songCooldowns[songName]) < FOUR_HOURS_MS) ? 'text-orange-300' : 'text-[#E0E0E0]'}`}>{songName}</span>
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); removeSong(dancer.id, songIdx); }}
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

                      <Droppable droppableId={`break-${breakKey}`} type="song">
                          {(breakProvided, breakSnapshot) => (
                            <div
                              ref={breakProvided.innerRef}
                              {...breakProvided.droppableProps}
                              className={`mx-2 my-1 rounded-lg transition-all ${
                                breakSongs.length > 0 || breakSnapshot.isDraggingOver
                                  ? 'border border-dashed p-2 ' + (breakSnapshot.isDraggingOver ? 'border-[#00d4ff]/60 bg-[#00d4ff]/5' : 'border-violet-500/40 bg-violet-900/10')
                                  : 'border border-dashed border-[#1e293b]/50 p-1'
                              }`}
                            >
                              {breakSongs.length > 0 ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1 px-1 mb-1">
                                    <Music2 className="w-3 h-3 text-violet-400" />
                                    <span className="text-[10px] text-violet-400 uppercase font-semibold tracking-wider">Between Sets</span>
                                  </div>
                                  {breakSongs.map((songName, songIdx) => (
                                    <Draggable key={`breakitem-${breakKey}-${songIdx}`} draggableId={`breakitem-${breakKey}-${songIdx}-${songName}`} index={songIdx}>
                                      {(itemProv, itemSnap) => (
                                    <div
                                      ref={itemProv.innerRef}
                                      {...itemProv.draggableProps}
                                      {...itemProv.dragHandleProps}
                                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-grab active:cursor-grabbing bg-violet-900/20 border-violet-500/20 ${itemSnap.isDragging ? 'ring-2 ring-[#00d4ff] shadow-lg' : ''}`}
                                    >
                                      <GripVertical className="w-3 h-3 text-gray-600 flex-shrink-0" />
                                      <Music2 className="w-3 h-3 text-violet-400 flex-shrink-0" />
                                      <span className="text-sm truncate flex-1 text-violet-300">{songName}</span>
                                      <button
                                        onClick={() => removeInterstitialSong(breakKey, songIdx)}
                                        className="p-1 text-violet-400/60 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
                                      >
                                        <X className="w-5 h-5" />
                                      </button>
                                    </div>
                                      )}
                                    </Draggable>
                                  ))}
                                </div>
                              ) : (
                                <div className={`flex items-center justify-center transition-colors rounded ${
                                  breakSnapshot.isDraggingOver ? 'h-[36px]' : 'h-[20px]'
                                }`}>
                                  <p className="text-[10px] text-gray-600">
                                    {breakSnapshot.isDraggingOver ? 'Drop song here' : '· · ·'}
                                  </p>
                                </div>
                              )}
                              {breakProvided.placeholder}
                            </div>
                          )}
                        </Droppable>

                      {(() => {
                        if (commercialFreq === 'off') return null;
                        const freqNum = parseInt(commercialFreq);
                        if (!freqNum || freqNum < 1) return null;

                        const totalEntertainers = rotationDancers.length;
                        let stepsFromCurrent;
                        if (isRotationActive && currentDancerIndex != null) {
                          stepsFromCurrent = (index - currentDancerIndex + totalEntertainers) % totalEntertainers;
                          if (stepsFromCurrent === 0) stepsFromCurrent = totalEntertainers;
                        } else {
                          stepsFromCurrent = index + 1;
                        }
                        const futureCount = commercialCounter + stepsFromCurrent;
                        if (futureCount % freqNum !== 0) return null;

                        const commercialId = `commercial-after-${index}`;
                        if (skippedCommercials.has(commercialId)) return null;

                        let promoSlotIndex = 0;
                        for (let i = 0; i < index; i++) {
                          let prevSteps;
                          if (isRotationActive && currentDancerIndex != null) {
                            prevSteps = (i - currentDancerIndex + totalEntertainers) % totalEntertainers;
                            if (prevSteps === 0) prevSteps = totalEntertainers;
                          } else {
                            prevSteps = i + 1;
                          }
                          const prevFuture = commercialCounter + prevSteps;
                          if (prevFuture % freqNum === 0 && !skippedCommercials.has(`commercial-after-${i}`)) {
                            promoSlotIndex++;
                          }
                        }

                        const promoKey = promoQueue[promoSlotIndex];
                        const promo = promoKey ? availablePromos.find(p => p.cache_key === promoKey) : null;
                        const promoName = promo ? (promo.dancer_name || promo.cache_key.replace(/^promo_/, '').replace(/_/g, ' ')) : null;

                        return (
                          <div className="mx-2 my-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/15 border border-dashed border-amber-500/30 opacity-70">
                            <Radio className="w-4 h-4 text-amber-400 flex-shrink-0 animate-pulse" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Auto Commercial</p>
                              {promoName ? (
                                <p className="text-[10px] text-amber-300/80 truncate">{promoName}</p>
                              ) : (
                                <p className="text-[10px] text-amber-500/60">Promo will play here</p>
                              )}
                            </div>
                            {availablePromos.length > 1 && onSwapPromo && promoSlotIndex < promoQueue.length && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSwapPromo(promoSlotIndex);
                                }}
                                className="px-2 py-1 text-[10px] text-amber-400/70 hover:text-amber-300 hover:bg-amber-900/30 rounded transition-colors flex-shrink-0 border border-amber-500/20"
                                title="Change promo"
                              >
                                Swap
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSkippedCommercials(prev => {
                                  const next = new Set([...prev, commercialId]);
                                  try { localStorage.setItem('neonaidj_skipped_commercials', JSON.stringify([...next])); } catch {}
                                  return next;
                                });
                              }}
                              className="p-1.5 text-amber-400/50 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
                              title="Skip this commercial"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })()}
                      </React.Fragment>
                    );
                  }); })()}
                  {provided.placeholder}

                  {rotationDancers.length === 0 && (
                    <Droppable droppableId="autoplay-queue" type="song">
                      {(aqProvided, aqSnapshot) => (
                        <div
                          ref={aqProvided.innerRef}
                          {...aqProvided.droppableProps}
                          className={`mx-2 rounded-lg border border-dashed p-3 transition-colors ${
                            aqSnapshot.isDraggingOver
                              ? 'border-cyan-400/60 bg-cyan-900/20'
                              : 'border-cyan-500/30 bg-cyan-900/10'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 px-1 mb-2">
                            <Radio className="w-3.5 h-3.5 text-cyan-400" />
                            <span className="text-[11px] text-cyan-400 uppercase font-semibold tracking-wider">Autoplay Queue</span>
                            <span className="text-[10px] text-cyan-500/60 ml-auto">{autoplayQueue.length} song{autoplayQueue.length !== 1 ? 's' : ''}</span>
                          </div>
                          {autoplayQueue.length === 0 ? (
                            <div className="text-center py-6 text-gray-500">
                              <Music2 className="w-8 h-8 mx-auto mb-2 text-gray-700" />
                              <p className="text-xs">Drag songs here to build your queue</p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {autoplayQueue.map((track, i) => (
                                <Draggable key={`aq-${track.id}`} draggableId={`aq-${track.id}`} index={i}>
                                  {(aqDragProvided, aqDragSnapshot) => (
                                    <div
                                      ref={aqDragProvided.innerRef}
                                      {...aqDragProvided.draggableProps}
                                      {...aqDragProvided.dragHandleProps}
                                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border transition-colors ${
                                        i === 0
                                          ? 'bg-cyan-900/30 border-cyan-500/40 ring-1 ring-cyan-500/20'
                                          : track.autoFilled
                                            ? 'bg-gray-800/40 border-gray-700/30'
                                            : 'bg-cyan-900/15 border-cyan-600/25'
                                      } ${aqDragSnapshot.isDragging ? 'shadow-lg shadow-cyan-500/20' : ''}`}
                                    >
                                      <GripVertical className="w-3 h-3 text-gray-600 flex-shrink-0" />
                                      {i === 0 ? (
                                        <Play className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                                      ) : (
                                        <span className="text-[10px] text-gray-500 w-3 text-center flex-shrink-0">{i + 1}</span>
                                      )}
                                      <Music2 className={`w-3 h-3 flex-shrink-0 ${track.autoFilled ? 'text-gray-500' : 'text-cyan-400'}`} />
                                      <span className={`text-sm truncate flex-1 ${
                                        i === 0 ? 'text-cyan-300 font-medium' : track.autoFilled ? 'text-gray-400' : 'text-cyan-300/80'
                                      }`}>{track.name}</span>
                                      {track.genre && (
                                        <span className="text-[9px] text-gray-600 flex-shrink-0">{track.genre}</span>
                                      )}
                                      <button
                                        onClick={() => onAutoplayQueueRemove?.(i)}
                                        className="p-0.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  )}
                                </Draggable>
                              ))}
                            </div>
                          )}
                          {aqProvided.placeholder}
                        </div>
                      )}
                    </Droppable>
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
