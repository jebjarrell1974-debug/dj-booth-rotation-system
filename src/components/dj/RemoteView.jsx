import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { boothApi } from '@/api/serverApi';
import DJOptions from '@/components/dj/DJOptions';
import {
  Wifi,
  SkipForward,
  Mic,
  MicOff,
  Users,
  Layers,
  Plus,
  Minus,
  X,
  LogOut,
  Radio,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  Volume2,
  Save,
  Search,
  Folder,
  Music,
  GripVertical,
  ListMusic,
  Check,
  Ban,
  Delete,
} from 'lucide-react';

export default function RemoteView({ dancers, liveBoothState, onLogout, djOptions, onOptionsChange }) {
  const [page, setPage] = useState('controls');

  const [expandedDancerId, setExpandedDancerId] = useState(null);
  const [localSongEdits, setLocalSongEdits] = useState({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryGenre, setLibraryGenre] = useState('');
  const [libraryTracks, setLibraryTracks] = useState([]);
  const [libraryGenres, setLibraryGenres] = useState([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [musicSource, setMusicSource] = useState('genres');
  const searchTimeoutRef = useRef(null);

  const [controlsTab, setControlsTab] = useState('entertainers');

  const [selectedTrack, setSelectedTrack] = useState(null);
  const [selectedBreakSong, setSelectedBreakSong] = useState(null);

  const [showDeactivatePin, setShowDeactivatePin] = useState(false);
  const [deactivatePin, setDeactivatePin] = useState('');
  const [deactivateSent, setDeactivateSent] = useState(false);

  const isConnected = liveBoothState?.updatedAt > 0;
  const isPlaying = liveBoothState?.isPlaying;
  const isRotationActive = liveBoothState?.isRotationActive;
  const currentDancerName = liveBoothState?.currentDancerName || 'Unknown';
  const currentTrack = liveBoothState?.currentTrack || '';
  const currentSongNumber = liveBoothState?.currentSongNumber || 0;
  const songsPerSet = liveBoothState?.songsPerSet || 3;
  const announcementsEnabled = liveBoothState?.announcementsEnabled;
  const rotationList = liveBoothState?.rotation || [];
  const currentDancerIndex = liveBoothState?.currentDancerIndex || 0;
  const rotationSongs = liveBoothState?.rotationSongs || {};
  const currentVolume = liveBoothState?.volume != null ? liveBoothState.volume : 0.8;
  const volumePercent = Math.round(currentVolume * 100);
  const currentVoiceGain = liveBoothState?.voiceGain != null ? liveBoothState.voiceGain : 1.5;
  const voiceGainPercent = Math.round(currentVoiceGain * 100);
  const breakSongsPerSet = liveBoothState?.breakSongsPerSet || 0;
  const interstitialSongs = liveBoothState?.interstitialSongs || {};
  const commercialFreq = liveBoothState?.commercialFreq || 'off';
  const commercialCounter = liveBoothState?.commercialCounter || 0;
  const remotePromoQueue = liveBoothState?.promoQueue || [];
  const remoteAvailablePromos = liveBoothState?.availablePromos || [];

  const skippedFromBooth = liveBoothState?.skippedCommercials || [];
  const [localSkipped, setLocalSkipped] = useState(new Set());
  const skippedCommercials = new Set([...skippedFromBooth, ...localSkipped]);

  const trackTime = liveBoothState?.trackTime || 0;
  const trackDuration = liveBoothState?.trackDuration || 0;
  const trackTimeAt = liveBoothState?.trackTimeAt || 0;

  const countdownRef = useRef(null);
  useEffect(() => {
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const interval = setInterval(() => {
      if (!countdownRef.current) return;
      if (trackDuration > 0 && trackTimeAt > 0) {
        const elapsed = isPlaying ? (Date.now() - trackTimeAt) / 1000 : 0;
        const currentPos = Math.min(trackTime + elapsed, trackDuration);
        const remaining = Math.max(0, trackDuration - currentPos);
        countdownRef.current.textContent = fmt(remaining);
        countdownRef.current.style.display = '';
      } else {
        countdownRef.current.style.display = 'none';
      }
    }, 250);
    return () => clearInterval(interval);
  }, [trackTime, trackDuration, trackTimeAt, isPlaying]);

  const currentDancer = isRotationActive
    ? dancers.find(d => d.id === rotationList[currentDancerIndex])
    : null;

  const rotationDancers = rotationList
    .map(id => dancers.find(d => d.id === id))
    .filter(Boolean);

  const fetchLibrary = useCallback(async (search, genre) => {
    setLibraryLoading(true);
    try {
      const token = sessionStorage.getItem('djbooth_token');
      const params = new URLSearchParams({ page: '1', limit: '200' });
      if (search) params.set('search', search);
      if (genre && !search) params.set('genre', genre);
      const res = await fetch(`/api/music/tracks?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLibraryTracks(data.tracks || []);
        setLibraryTotal(data.total || 0);
        if (data.genres && data.genres.length > 0) {
          setLibraryGenres(data.genres);
        }
      }
    } catch {}
    setLibraryLoading(false);
  }, []);

  useEffect(() => {
    if (page === 'music') {
      fetchLibrary('', '');
    }
  }, [page, fetchLibrary]);

  useEffect(() => {
    if (musicSource === 'genres') {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => {
        fetchLibrary(librarySearch, libraryGenre);
      }, 300);
      return () => clearTimeout(searchTimeoutRef.current);
    }
  }, [librarySearch, libraryGenre, fetchLibrary, musicSource]);

  const toggleDancer = (dancerId) => {
    setExpandedDancerId(prev => prev === dancerId ? null : dancerId);
  };

  const getDancerSongs = (dancerId) => {
    if (localSongEdits[dancerId]) return localSongEdits[dancerId];
    const songs = rotationSongs[dancerId] || [];
    return songs.map(s => typeof s === 'string' ? s : s.name);
  };

  const addSongToDancer = (dancerId, trackName) => {
    const current = getDancerSongs(dancerId);
    if (current.includes(trackName)) return;
    const updated = [...current, trackName];
    setLocalSongEdits(prev => ({ ...prev, [dancerId]: updated }));
    setHasUnsavedChanges(true);
  };

  const removeSongFromDancer = (dancerId, songIndex) => {
    const current = [...getDancerSongs(dancerId)];
    current.splice(songIndex, 1);
    setLocalSongEdits(prev => ({ ...prev, [dancerId]: current }));
    setHasUnsavedChanges(true);
  };

  const handleSaveAll = () => {
    if (Object.keys(localSongEdits).length > 0) {
      boothApi.sendCommand('updateSongAssignments', { assignments: localSongEdits });
    }
    boothApi.sendCommand('saveRotation', { rotation: rotationList });
    setLocalSongEdits({});
    setHasUnsavedChanges(false);
  };

  const handleSelectTrack = (trackName) => {
    if (selectedBreakSong) {
      const { breakKey, index } = selectedBreakSong;
      const updated = { ...interstitialSongs };
      const arr = [...(updated[breakKey] || [])];
      arr[index] = trackName;
      updated[breakKey] = arr;
      boothApi.sendCommand('updateInterstitialSongs', { interstitialSongs: updated });
      setSelectedBreakSong(null);
      setSelectedTrack(null);
      return;
    }
    if (selectedTrack === trackName) {
      setSelectedTrack(null);
    } else {
      setSelectedTrack(trackName);
    }
  };

  const handleTapDancerToAdd = (dancerId) => {
    if (selectedTrack) {
      addSongToDancer(dancerId, selectedTrack);
      setExpandedDancerId(dancerId);
      setSelectedTrack(null);
      setSelectedBreakSong(null);
    }
  };

  const selectedPlaylistDancer = musicSource !== 'genres'
    ? dancers.find(d => String(d.id) === String(musicSource))
    : null;
  const playlistSongs = selectedPlaylistDancer?.playlist || [];

  const allActiveDancers = dancers.filter(d => d.is_active).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="remote-view h-[100dvh] bg-[#08081a] text-white flex flex-col overflow-hidden select-none">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#151528] flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-[#2563eb] flex items-center justify-center">
            <Wifi className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-sm font-bold">DJ Remote</span>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? (isPlaying ? 'bg-green-400 animate-pulse' : 'bg-yellow-500') : 'bg-red-500'}`} />
              <span className="text-[10px] text-gray-400">
                {isConnected ? (isPlaying ? 'Playing' : 'Connected') : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        {isRotationActive && currentDancer && (
          <div className="flex items-center gap-2 flex-1 justify-center min-w-0 px-3">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-black font-bold text-xs flex-shrink-0"
              style={{ backgroundColor: currentDancer?.color || '#00d4ff' }}
            >
              {currentDancer?.name?.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <span className="text-sm font-semibold text-white">{currentDancer?.name}</span>
              <span className="text-xs text-[#00d4ff] ml-1.5">{currentSongNumber}/{songsPerSet}</span>
            </div>
            {currentTrack && (
              <div className="flex items-center gap-1.5 min-w-0 max-w-[200px]">
                <span className="text-xs text-gray-400 truncate">{isPlaying ? '▶' : '⏸'} {currentTrack}</span>
                <span ref={countdownRef} className="text-xs font-mono text-[#00d4ff] tabular-nums flex-shrink-0" style={{ display: 'none' }} />
              </div>
            )}
          </div>
        )}

        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-gray-400 hover:text-white active:bg-[#151528] transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-xs">Logout</span>
        </button>
      </div>

      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#151528] flex-shrink-0">
        <button
          onClick={() => setPage('controls')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            page === 'controls' ? 'bg-[#00d4ff] text-black' : 'bg-[#0d0d1f] text-gray-400 active:bg-[#151528]'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Controls
        </button>
        <button
          onClick={() => setPage('music')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            page === 'music' ? 'bg-[#00d4ff] text-black' : 'bg-[#0d0d1f] text-gray-400 active:bg-[#151528]'
          }`}
        >
          <Music className="w-4 h-4" />
          Music & Rotation
        </button>

        {page === 'music' && (
          <button
            onClick={handleSaveAll}
            className={`ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              hasUnsavedChanges
                ? 'bg-green-500 text-black animate-pulse'
                : 'bg-[#00d4ff] text-black'
            }`}
          >
            <Save className="w-4 h-4" />
            Save All
          </button>
        )}
      </div>

      {page === 'controls' && (
        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className="w-[280px] flex-shrink-0 flex flex-col gap-2.5 p-3 border-r border-[#151528] overflow-auto">
            <button
              onClick={() => boothApi.sendCommand('skip')}
              className="h-11 px-4 rounded-xl bg-[#1e293b] border border-[#2e2e5a] flex items-center gap-2 text-white active:bg-[#2e2e5a] transition-colors"
            >
              <SkipForward className="w-5 h-5" />
              <span className="text-sm font-semibold">Skip Track</span>
            </button>
            <button
              onClick={() => boothApi.sendCommand('toggleAnnouncements')}
              className={`h-11 px-4 rounded-xl border flex items-center gap-2 active:opacity-80 transition-colors ${
                announcementsEnabled
                  ? 'bg-[#00d4ff]/15 border-[#00d4ff]/40 text-[#00d4ff]'
                  : 'bg-[#1e293b] border-[#2e2e5a] text-gray-500'
              }`}
            >
              {announcementsEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              <span className="text-sm font-semibold">{announcementsEnabled ? 'Voice On' : 'Voice Muted'}</span>
            </button>

            <div className="rounded-xl bg-[#0d0d1f] border border-[#1e293b] p-2.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">Songs Per Set</span>
              <div className="flex items-center gap-1 mt-1.5">
                {[1,2,3,4,5].map(n => (
                  <button
                    key={n}
                    onClick={() => boothApi.sendCommand('setSongsPerSet', { count: n })}
                    className={`flex-1 h-9 rounded-lg text-sm font-bold transition-colors ${
                      n === songsPerSet ? 'bg-[#00d4ff] text-black' : 'text-gray-400 active:bg-[#2e2e5a]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-[#0d0d1f] border border-[#1e293b] p-2.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">Break Songs</span>
              <div className="flex items-center gap-1 mt-1.5">
                {[0,1,2,3].map(n => (
                  <button
                    key={n}
                    onClick={() => boothApi.sendCommand('setBreakSongsPerSet', { count: n })}
                    className={`flex-1 h-9 rounded-lg text-sm font-bold transition-colors ${
                      n === breakSongsPerSet ? 'bg-violet-500 text-white' : 'text-gray-400 active:bg-[#2e2e5a]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-[#0d0d1f] border border-[#1e293b] p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Volume2 className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Music Volume</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => boothApi.sendCommand('setVolume', { volume: Math.max(0, currentVolume - 0.05) })}
                  disabled={volumePercent <= 0}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-white bg-[#1e293b] active:bg-[#2e2e5a] disabled:opacity-30"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-sm font-bold tabular-nums flex-1 text-center">{volumePercent}%</span>
                <button
                  onClick={() => boothApi.sendCommand('setVolume', { volume: Math.min(1, currentVolume + 0.05) })}
                  disabled={volumePercent >= 100}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-white bg-[#1e293b] active:bg-[#2e2e5a] disabled:opacity-30"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-[#0d0d1f] border border-[#a855f7]/20 p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Mic className="w-3.5 h-3.5 text-[#a855f7]" />
                <span className="text-[10px] text-[#a855f7] uppercase tracking-wider">Voice Volume</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => boothApi.sendCommand('setVoiceGain', { gain: Math.max(0.5, currentVoiceGain - 0.1) })}
                  disabled={voiceGainPercent <= 50}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-white bg-[#1e293b] active:bg-[#2e2e5a] disabled:opacity-30"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-sm font-bold text-[#a855f7] tabular-nums flex-1 text-center">{voiceGainPercent}%</span>
                <button
                  onClick={() => boothApi.sendCommand('setVoiceGain', { gain: Math.min(3, currentVoiceGain + 0.1) })}
                  disabled={voiceGainPercent >= 300}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-white bg-[#1e293b] active:bg-[#2e2e5a] disabled:opacity-30"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <button
              onClick={() => {
                if (!currentTrack) return;
                setDeactivatePin('');
                setDeactivateSent(false);
                setShowDeactivatePin(true);
              }}
              disabled={!currentTrack}
              className="h-11 px-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-red-400 active:bg-red-500/20 transition-colors disabled:opacity-30"
            >
              <Ban className="w-5 h-5" />
              <span className="text-sm font-semibold">Deactivate Song</span>
            </button>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex items-center gap-1 px-3 pt-2 pb-1 flex-shrink-0">
              <button
                onClick={() => setControlsTab('entertainers')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  controlsTab === 'entertainers' ? 'bg-[#00d4ff] text-black' : 'bg-[#0d0d1f] text-gray-400 active:bg-[#151528]'
                }`}
              >
                <Users className="w-4 h-4" />
                Entertainers
              </button>
              <button
                onClick={() => setControlsTab('options')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  controlsTab === 'options' ? 'bg-[#00d4ff] text-black' : 'bg-[#0d0d1f] text-gray-400 active:bg-[#151528]'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                Options
              </button>
            </div>

            <div className="flex-1 px-3 pb-2 overflow-auto min-h-0">
              {controlsTab === 'entertainers' && (
                <div className="space-y-1.5 pt-2">
                  {allActiveDancers.length === 0 ? (
                    <div className="text-center py-12">
                      <Users className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">No active entertainers</p>
                    </div>
                  ) : (
                    allActiveDancers.map(dancer => {
                      const inRotation = rotationList.includes(dancer.id);
                      return (
                        <div
                          key={dancer.id}
                          className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#0d0d1f] border border-[#1e293b]"
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-black font-bold text-sm flex-shrink-0"
                            style={{ backgroundColor: dancer.color || '#00d4ff' }}
                          >
                            {dancer.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white">{dancer.name}</p>
                            {dancer.playlist && dancer.playlist.length > 0 && (
                              <p className="text-xs text-gray-500">{dancer.playlist.length} songs in playlist</p>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              if (inRotation) {
                                boothApi.sendCommand('removeDancerFromRotation', { dancerId: dancer.id });
                              } else {
                                boothApi.sendCommand('addDancerToRotation', { dancerId: dancer.id });
                              }
                            }}
                            className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors flex-shrink-0 ${
                              inRotation
                                ? 'bg-red-500/15 text-red-400 border border-red-500/30 active:bg-red-500/25'
                                : 'bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30 active:bg-[#00d4ff]/25'
                            }`}
                          >
                            {inRotation ? '- Remove' : '+ Add'}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {controlsTab === 'options' && (
                <div className="pt-2">
                  <DJOptions djOptions={djOptions} onOptionsChange={onOptionsChange} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {page === 'music' && (
        <div className="flex-1 flex gap-3 px-3 py-2 overflow-hidden min-h-0">
          <div className="w-[42%] flex flex-col bg-[#0d0d1f] rounded-xl border border-[#1e293b] overflow-hidden">
            <div className="px-3 pt-3 pb-2 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Music Source</span>
                <span className="text-[10px] text-gray-500">
                  {musicSource === 'genres' ? `${libraryTotal.toLocaleString()} tracks` : `${playlistSongs.length} songs`}
                </span>
              </div>

              <select
                value={musicSource}
                onChange={(e) => {
                  setMusicSource(e.target.value);
                  setLibrarySearch('');
                  setLibraryGenre('');
                  setSelectedTrack(null);
                }}
                className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg px-2.5 py-1.5 text-xs text-white appearance-none cursor-pointer focus:outline-none focus:border-[#00d4ff] mb-2"
                style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: '24px' }}
              >
                <option value="genres">Genre Folders</option>
                {allActiveDancers.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}'s Playlist ({(d.playlist || []).length})
                  </option>
                ))}
              </select>

              {musicSource === 'genres' && (
                <>
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <input
                      type="text"
                      value={librarySearch}
                      onChange={(e) => setLibrarySearch(e.target.value)}
                      placeholder="Search..."
                      className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00d4ff]"
                    />
                  </div>
                  {libraryGenres.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Folder className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                      <select
                        value={libraryGenre}
                        onChange={(e) => setLibraryGenre(e.target.value)}
                        className="flex-1 bg-[#08081a] border border-[#1e293b] rounded-lg px-2 py-1.5 text-xs text-white appearance-none cursor-pointer focus:outline-none focus:border-[#00d4ff]"
                        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: '24px' }}
                      >
                        <option value="">All Genres</option>
                        {libraryGenres.map(g => (
                          <option key={g.name} value={g.name}>{g.name} ({g.count})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}
            </div>

            {selectedBreakSong && (
              <div className="mx-3 mb-2 px-2.5 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/30 flex items-center gap-2 flex-shrink-0">
                <Music className="w-3.5 h-3.5 text-violet-400 flex-shrink-0 animate-pulse" />
                <span className="text-xs text-violet-400 truncate flex-1">Tap a song to replace break song</span>
                <button onClick={() => setSelectedBreakSong(null)} className="text-violet-400/60 active:text-violet-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {selectedTrack && !selectedBreakSong && (
              <div className="mx-3 mb-2 px-2.5 py-1.5 rounded-lg bg-[#00d4ff]/10 border border-[#00d4ff]/30 flex items-center gap-2 flex-shrink-0">
                <Check className="w-3.5 h-3.5 text-[#00d4ff] flex-shrink-0" />
                <span className="text-xs text-[#00d4ff] truncate flex-1">{selectedTrack}</span>
                <button onClick={() => setSelectedTrack(null)} className="text-[#00d4ff]/60 active:text-[#00d4ff]">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="flex-1 overflow-auto px-1 pb-2">
              {musicSource === 'genres' ? (
                <>
                  {libraryTracks.map(track => {
                    const isSelected = selectedTrack === track.name;
                    return (
                      <div
                        key={track.id}
                        onClick={() => handleSelectTrack(track.name)}
                        className={`flex items-center gap-2 px-2 py-2 rounded-lg active:bg-[#1e293b] group transition-colors cursor-pointer ${
                          isSelected ? 'bg-[#00d4ff]/15 border border-[#00d4ff]/30' : 'hover:bg-[#151528]'
                        }`}
                      >
                        {isSelected ? (
                          <Check className="w-3.5 h-3.5 text-[#00d4ff] flex-shrink-0" />
                        ) : (
                          <Music className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs truncate ${isSelected ? 'text-[#00d4ff]' : 'text-white'}`}>{track.name}</p>
                          {track.genre && <p className="text-[10px] text-gray-500 truncate">{track.genre}</p>}
                        </div>
                        {expandedDancerId && (
                          <button
                            onClick={(e) => { e.stopPropagation(); addSongToDancer(expandedDancerId, track.name); }}
                            className="w-7 h-7 rounded flex items-center justify-center text-[#00d4ff] bg-[#00d4ff]/10 active:bg-[#00d4ff]/25 flex-shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {libraryTracks.length === 0 && !libraryLoading && (
                    <p className="text-xs text-gray-500 text-center py-8">No tracks found</p>
                  )}
                  {libraryLoading && (
                    <p className="text-xs text-gray-500 text-center py-8">Loading...</p>
                  )}
                </>
              ) : (
                <>
                  {playlistSongs.length === 0 ? (
                    <p className="text-xs text-gray-500 text-center py-8">
                      {selectedPlaylistDancer?.name} hasn't added any songs yet
                    </p>
                  ) : (
                    playlistSongs.map((songName, idx) => {
                      const isSelected = selectedTrack === songName;
                      return (
                        <div
                          key={idx}
                          onClick={() => handleSelectTrack(songName)}
                          className={`flex items-center gap-2 px-2 py-2 rounded-lg active:bg-[#1e293b] group transition-colors cursor-pointer ${
                            isSelected ? 'bg-[#00d4ff]/15 border border-[#00d4ff]/30' : 'hover:bg-[#151528]'
                          }`}
                        >
                          {isSelected ? (
                            <Check className="w-3.5 h-3.5 text-[#00d4ff] flex-shrink-0" />
                          ) : (
                            <ListMusic className="w-3.5 h-3.5 text-[#a855f7] flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs truncate ${isSelected ? 'text-[#00d4ff]' : 'text-white'}`}>{songName}</p>
                          </div>
                          {expandedDancerId && (
                            <button
                              onClick={(e) => { e.stopPropagation(); addSongToDancer(expandedDancerId, songName); }}
                              className="w-7 h-7 rounded flex items-center justify-center text-[#00d4ff] bg-[#00d4ff]/10 active:bg-[#00d4ff]/25 flex-shrink-0"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-2 px-1">
              <div>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Rotation</span>
                <span className="text-[10px] text-gray-500 ml-2">{rotationList.length} entertainers</span>
              </div>
              {selectedTrack && (
                <span className="text-[10px] text-[#00d4ff] animate-pulse">Tap entertainer or break slot to add</span>
              )}
            </div>
            <div className="flex-1 overflow-auto space-y-1">
              {rotationList.length === 0 ? (
                <div className="text-center py-12">
                  <Layers className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No entertainers in rotation</p>
                  <p className="text-xs text-gray-600 mt-1">Add from the Controls tab</p>
                </div>
              ) : (
                rotationList.map((dancerId, idx) => {
                  const dancer = dancers.find(d => d.id === dancerId);
                  if (!dancer) return null;
                  const isCurrent = idx === currentDancerIndex && isRotationActive;
                  const isExpanded = expandedDancerId === dancerId;
                  const songs = getDancerSongs(dancerId);
                  const breakKey = `after-${dancerId}`;
                  const breakSongsList = interstitialSongs[breakKey] || [];
                  const hasEdits = !!localSongEdits[dancerId];
                  const isDropTarget = selectedTrack !== null;

                  return (
                    <div key={dancerId}>
                      <div
                        className={`rounded-xl border transition-colors ${
                          isCurrent
                            ? 'bg-[#00d4ff]/10 border-[#00d4ff]/40'
                            : isExpanded
                              ? 'bg-[#0d0d1f] border-[#2563eb]/40'
                              : isDropTarget
                                ? 'bg-[#0d0d1f] border-[#00d4ff]/20'
                                : 'bg-[#0d0d1f] border-[#1e293b]'
                        }`}
                      >
                        <div
                          className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                          onClick={() => {
                            if (selectedTrack) {
                              handleTapDancerToAdd(dancerId);
                            } else {
                              toggleDancer(dancerId);
                            }
                          }}
                        >
                          <div className="flex flex-col items-center gap-0 flex-shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); boothApi.sendCommand('moveInRotation', { dancerId, direction: 'up' }); }}
                              className="text-gray-600 active:text-white p-0.5"
                              disabled={idx === 0}
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 15 12 9 18 15"/></svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); boothApi.sendCommand('moveInRotation', { dancerId, direction: 'down' }); }}
                              className="text-gray-600 active:text-white p-0.5"
                              disabled={idx === rotationList.length - 1}
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                            </button>
                          </div>
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-black font-bold text-xs flex-shrink-0 ${
                              isDropTarget ? 'ring-2 ring-[#00d4ff] ring-offset-1 ring-offset-[#0d0d1f]' : ''
                            }`}
                            style={{ backgroundColor: dancer.color || '#00d4ff' }}
                          >
                            {dancer.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${isCurrent ? 'text-[#00d4ff]' : 'text-white'}`}>
                              {dancer.name}
                              {isCurrent && <span className="ml-1.5 text-[10px] text-[#00d4ff]/70">NOW</span>}
                              {hasEdits && <span className="ml-1.5 text-[10px] text-green-400">edited</span>}
                            </p>
                            <p className="text-[10px] text-gray-500">{songs.length} song{songs.length !== 1 ? 's' : ''}</p>
                          </div>
                          {selectedTrack ? (
                            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#00d4ff]/15 border border-[#00d4ff]/30 flex-shrink-0">
                              <Plus className="w-3.5 h-3.5 text-[#00d4ff]" />
                              <span className="text-[10px] text-[#00d4ff] font-semibold">Add</span>
                            </div>
                          ) : (
                            <>
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                              )}
                            </>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); boothApi.sendCommand('removeDancerFromRotation', { dancerId }); }}
                            className="p-1.5 text-red-400/40 active:text-red-400 transition-colors flex-shrink-0"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        {isExpanded && !selectedTrack && (
                          <div className="px-3 pb-2 border-t border-[#1e293b]/50">
                            {songs.length === 0 ? (
                              <p className="text-[10px] text-gray-500 py-2 text-center">No songs — select a song on the left, then tap here to add</p>
                            ) : (
                              <div className="space-y-0.5 mt-1">
                                {songs.map((songName, songIdx) => (
                                  <div key={songIdx} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[#151528] group">
                                    <span className="text-[10px] text-gray-600 w-4 text-center flex-shrink-0">{songIdx + 1}</span>
                                    <Music className="w-3 h-3 text-[#00d4ff]/50 flex-shrink-0" />
                                    <p className="text-xs text-gray-300 truncate flex-1">{songName}</p>
                                    <button
                                      onClick={() => removeSongFromDancer(dancerId, songIdx)}
                                      className="w-5 h-5 rounded flex items-center justify-center text-red-400/60 active:text-red-400 flex-shrink-0"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {idx < rotationList.length - 1 && (
                        <div className="ml-10 mt-0.5">
                          {breakSongsList.length > 0 ? (
                            <div className="space-y-0.5">
                              {breakSongsList.map((songName, bsi) => {
                                const isBreakSelected = selectedBreakSong?.breakKey === breakKey && selectedBreakSong?.index === bsi;
                                return (
                                <div
                                  key={bsi}
                                  onClick={() => {
                                    if (isBreakSelected) {
                                      setSelectedBreakSong(null);
                                    } else {
                                      setSelectedBreakSong({ breakKey, index: bsi });
                                      setSelectedTrack(null);
                                    }
                                  }}
                                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer transition-colors ${
                                    isBreakSelected
                                      ? 'bg-[#00d4ff]/15 border border-[#00d4ff]/40'
                                      : 'bg-violet-500/10 border border-violet-500/20'
                                  }`}
                                >
                                  <Music className={`w-3 h-3 flex-shrink-0 ${isBreakSelected ? 'text-[#00d4ff]' : 'text-violet-400'}`} />
                                  <p className={`text-[10px] truncate flex-1 ${isBreakSelected ? 'text-[#00d4ff]' : 'text-violet-400'}`}>{songName}</p>
                                  {isBreakSelected && (
                                    <span className="text-[9px] text-[#00d4ff] animate-pulse flex-shrink-0">tap song to swap</span>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const updated = { ...interstitialSongs };
                                      const arr = [...(updated[breakKey] || [])];
                                      arr.splice(bsi, 1);
                                      if (arr.length === 0) { delete updated[breakKey]; } else { updated[breakKey] = arr; }
                                      boothApi.sendCommand('updateInterstitialSongs', { interstitialSongs: updated });
                                      if (isBreakSelected) setSelectedBreakSong(null);
                                    }}
                                    className="p-0.5 text-violet-400/40 active:text-red-400 flex-shrink-0"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                                );
                              })}
                            </div>
                          ) : null}
                          {selectedTrack && (
                            <button
                              onClick={() => {
                                const updated = { ...interstitialSongs };
                                const arr = [...(updated[breakKey] || [])];
                                arr.push(selectedTrack);
                                updated[breakKey] = arr;
                                boothApi.sendCommand('updateInterstitialSongs', { interstitialSongs: updated });
                                setSelectedTrack(null);
                              }}
                              className="w-full mt-0.5 flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-violet-500/30 bg-violet-500/5 active:bg-violet-500/15 transition-colors"
                            >
                              <Plus className="w-3 h-3 text-violet-400" />
                              <span className="text-[10px] text-violet-400">Add as break song</span>
                            </button>
                          )}
                        </div>
                      )}

                      {(() => {
                        if (commercialFreq === 'off') return null;
                        const freqNum = parseInt(commercialFreq);
                        if (!freqNum || freqNum < 1) return null;
                        if (idx >= rotationList.length - 1) return null;

                        const totalEntertainers = rotationList.length;
                        let stepsFromCurrent;
                        if (currentDancerIndex != null) {
                          stepsFromCurrent = (idx - currentDancerIndex + totalEntertainers) % totalEntertainers;
                          if (stepsFromCurrent === 0) stepsFromCurrent = totalEntertainers;
                        } else {
                          stepsFromCurrent = idx + 1;
                        }
                        const futureCount = commercialCounter + stepsFromCurrent;
                        if (futureCount % freqNum !== 0) return null;

                        let promoSlotIndex = 0;
                        for (let i = 0; i < idx; i++) {
                          if (i >= rotationList.length - 1) continue;
                          let prevSteps;
                          if (currentDancerIndex != null) {
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
                        const promoKey = remotePromoQueue[promoSlotIndex];
                        const promo = promoKey ? remoteAvailablePromos.find(p => p.cache_key === promoKey) : null;
                        const promoName = promo ? (promo.dancer_name || promo.cache_key.replace(/^promo_/, '').replace(/_/g, ' ')) : null;

                        const commercialId = `commercial-after-${idx}`;
                        if (skippedCommercials.has(commercialId)) return null;
                        return (
                          <div className="ml-10 mt-0.5 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-amber-900/20 border border-amber-500/30">
                            <Radio className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Commercial Break</p>
                              {promoName && (
                                <p className="text-[9px] text-amber-300/80 truncate">{promoName}</p>
                              )}
                            </div>
                            {remoteAvailablePromos.length > 1 && promoSlotIndex < remotePromoQueue.length && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  boothApi.sendCommand('swapPromo', { slotIndex: promoSlotIndex });
                                }}
                                className="px-1.5 py-0.5 text-[9px] text-amber-400/70 active:text-amber-300 active:bg-amber-900/30 rounded flex-shrink-0 border border-amber-500/20"
                              >
                                Swap
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setLocalSkipped(prev => new Set([...prev, commercialId]));
                                boothApi.sendCommand('skipCommercial', { commercialId });
                              }}
                              className="p-0.5 text-amber-400/40 active:text-red-400 flex-shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {showDeactivatePin && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6" onClick={() => setShowDeactivatePin(false)}>
          <div className="bg-[#0d0d1f] border border-red-500/30 rounded-2xl p-6 w-full max-w-xs" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
                <Ban className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Deactivate Song</p>
                <p className="text-xs text-gray-500 truncate max-w-[200px]">{currentTrack}</p>
              </div>
            </div>

            {deactivateSent ? (
              <div className="flex flex-col items-center py-6">
                <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mb-3">
                  <Check className="w-7 h-7 text-red-400" />
                </div>
                <p className="text-sm font-semibold text-red-400">Deactivate Sent</p>
                <p className="text-xs text-gray-500 mt-1">Song will be blocked and skipped</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-400 mb-3">Enter DJ PIN to confirm</p>

                <div className="flex gap-2 justify-center mb-4">
                  {[0,1,2,3,4].map(i => (
                    <div key={i} className={`w-10 h-12 rounded-lg border-2 flex items-center justify-center text-xl font-bold transition-colors ${
                      i < deactivatePin.length ? 'border-red-500 bg-red-500/20 text-red-400' : 'border-[#1e293b] bg-[#08081a] text-gray-600'
                    }`}>
                      {i < deactivatePin.length ? '\u2022' : ''}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[1,2,3,4,5,6,7,8,9].map(d => (
                    <button
                      key={d}
                      onClick={() => {
                        if (deactivatePin.length >= 5) return;
                        const newPin = deactivatePin + String(d);
                        setDeactivatePin(newPin);
                        if (newPin.length === 5) {
                          boothApi.sendCommand('deactivateTrack', { pin: newPin, trackName: currentTrack });
                          setDeactivateSent(true);
                          setTimeout(() => { setShowDeactivatePin(false); setDeactivatePin(''); setDeactivateSent(false); }, 1500);
                        }
                      }}
                      className="h-14 rounded-xl bg-[#151528] border border-[#1e293b] text-white text-xl font-semibold active:bg-red-500/20 transition-colors"
                    >
                      {d}
                    </button>
                  ))}
                  <div />
                  <button
                    onClick={() => {
                      if (deactivatePin.length >= 5) return;
                      const newPin = deactivatePin + '0';
                      setDeactivatePin(newPin);
                      if (newPin.length === 5) {
                        boothApi.sendCommand('deactivateTrack', { pin: newPin, trackName: currentTrack });
                        setDeactivateSent(true);
                        setTimeout(() => { setShowDeactivatePin(false); setDeactivatePin(''); setDeactivateSent(false); }, 1500);
                      }
                    }}
                    className="h-14 rounded-xl bg-[#151528] border border-[#1e293b] text-white text-xl font-semibold active:bg-red-500/20 transition-colors"
                  >
                    0
                  </button>
                  <button
                    onClick={() => setDeactivatePin(prev => prev.slice(0, -1))}
                    className="h-14 rounded-xl bg-[#151528] border border-[#1e293b] text-gray-400 flex items-center justify-center active:bg-[#1e293b] transition-colors"
                  >
                    <Delete className="w-5 h-5" />
                  </button>
                </div>

                <button
                  onClick={() => { setShowDeactivatePin(false); setDeactivatePin(''); }}
                  className="w-full mt-3 h-10 rounded-xl bg-[#1e293b] text-gray-400 text-sm font-semibold active:bg-[#2e2e5a] transition-colors"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
