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
} from 'lucide-react';

export default function RemoteView({ dancers, liveBoothState, onLogout, djOptions, onOptionsChange }) {
  const [activePanel, setActivePanel] = useState('rotation');
  const [expandedDancerId, setExpandedDancerId] = useState(null);
  const [localSongEdits, setLocalSongEdits] = useState({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryGenre, setLibraryGenre] = useState('');
  const [libraryTracks, setLibraryTracks] = useState([]);
  const [libraryGenres, setLibraryGenres] = useState([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const searchTimeoutRef = useRef(null);

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
    if (activePanel === 'rotation') {
      fetchLibrary('', '');
    }
  }, [activePanel, fetchLibrary]);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      fetchLibrary(librarySearch, libraryGenre);
    }, 300);
    return () => clearTimeout(searchTimeoutRef.current);
  }, [librarySearch, libraryGenre, fetchLibrary]);

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

  const targetDancerId = expandedDancerId;
  const targetDancer = targetDancerId ? dancers.find(d => d.id === targetDancerId) : null;

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

      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#151528] flex-shrink-0 flex-wrap">
        <button
          onClick={() => boothApi.sendCommand('skip')}
          className="h-9 px-3 rounded-lg bg-[#1e293b] border border-[#2e2e5a] flex items-center gap-1.5 text-white active:bg-[#2e2e5a] transition-colors"
        >
          <SkipForward className="w-4 h-4" />
          <span className="text-xs font-semibold">Skip</span>
        </button>
        <button
          onClick={() => boothApi.sendCommand('toggleAnnouncements')}
          className={`h-9 px-3 rounded-lg border flex items-center gap-1.5 active:opacity-80 transition-colors ${
            announcementsEnabled
              ? 'bg-[#00d4ff]/15 border-[#00d4ff]/40 text-[#00d4ff]'
              : 'bg-[#1e293b] border-[#2e2e5a] text-gray-500'
          }`}
        >
          {announcementsEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          <span className="text-xs font-semibold">{announcementsEnabled ? 'Voice' : 'Muted'}</span>
        </button>

        <div className="h-9 flex items-center gap-0.5 bg-[#0d0d1f] rounded-lg border border-[#1e293b] px-1.5">
          <span className="text-[10px] text-gray-500 mr-1">Songs</span>
          {[1,2,3,4,5].map(n => (
            <button
              key={n}
              onClick={() => boothApi.sendCommand('setSongsPerSet', { count: n })}
              className={`w-7 h-7 rounded text-xs font-bold transition-colors ${
                n === songsPerSet ? 'bg-[#00d4ff] text-black' : 'text-gray-400 active:bg-[#2e2e5a]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="h-9 flex items-center gap-0.5 bg-[#0d0d1f] rounded-lg border border-[#1e293b] px-1.5">
          <span className="text-[10px] text-gray-500 mr-1">Break</span>
          {[0,1,2,3].map(n => (
            <button
              key={n}
              onClick={() => boothApi.sendCommand('setBreakSongsPerSet', { count: n })}
              className={`w-7 h-7 rounded text-xs font-bold transition-colors ${
                n === breakSongsPerSet ? 'bg-violet-500 text-white' : 'text-gray-400 active:bg-[#2e2e5a]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="h-9 flex items-center gap-1 bg-[#0d0d1f] rounded-lg border border-[#1e293b] px-1.5">
          <Volume2 className="w-3.5 h-3.5 text-gray-400" />
          <button
            onClick={() => boothApi.sendCommand('setVolume', { volume: Math.max(0, currentVolume - 0.05) })}
            disabled={volumePercent <= 0}
            className="w-7 h-7 rounded flex items-center justify-center text-white active:bg-[#2e2e5a] disabled:opacity-30"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-bold tabular-nums w-8 text-center">{volumePercent}%</span>
          <button
            onClick={() => boothApi.sendCommand('setVolume', { volume: Math.min(1, currentVolume + 0.05) })}
            disabled={volumePercent >= 100}
            className="w-7 h-7 rounded flex items-center justify-center text-white active:bg-[#2e2e5a] disabled:opacity-30"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="h-9 flex items-center gap-1 bg-[#0d0d1f] rounded-lg border border-[#a855f7]/20 px-1.5">
          <Mic className="w-3.5 h-3.5 text-[#a855f7]" />
          <button
            onClick={() => boothApi.sendCommand('setVoiceGain', { gain: Math.max(0.5, currentVoiceGain - 0.1) })}
            disabled={voiceGainPercent <= 50}
            className="w-7 h-7 rounded flex items-center justify-center text-white active:bg-[#2e2e5a] disabled:opacity-30"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-bold text-[#a855f7] tabular-nums w-8 text-center">{voiceGainPercent}%</span>
          <button
            onClick={() => boothApi.sendCommand('setVoiceGain', { gain: Math.min(3, currentVoiceGain + 0.1) })}
            disabled={voiceGainPercent >= 300}
            className="w-7 h-7 rounded flex items-center justify-center text-white active:bg-[#2e2e5a] disabled:opacity-30"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 px-3 pt-2 pb-1 flex-shrink-0">
        <button
          onClick={() => setActivePanel('options')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activePanel === 'options' ? 'bg-[#00d4ff] text-black' : 'bg-[#0d0d1f] text-gray-400 active:bg-[#151528]'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Options
        </button>
        <button
          onClick={() => setActivePanel('rotation')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activePanel === 'rotation' ? 'bg-[#00d4ff] text-black' : 'bg-[#0d0d1f] text-gray-400 active:bg-[#151528]'
          }`}
        >
          <Layers className="w-4 h-4" />
          Rotation
        </button>
        <button
          onClick={() => setActivePanel('dancers')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activePanel === 'dancers' ? 'bg-[#00d4ff] text-black' : 'bg-[#0d0d1f] text-gray-400 active:bg-[#151528]'
          }`}
        >
          <Users className="w-4 h-4" />
          Entertainers
        </button>

        {activePanel === 'rotation' && (
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

      <div className="flex-1 px-3 pb-2 overflow-hidden min-h-0">
        {activePanel === 'options' && (
          <div className="h-full overflow-auto pt-2">
            <DJOptions djOptions={djOptions} onOptionsChange={onOptionsChange} />
          </div>
        )}

        {activePanel === 'rotation' && (
          <div className="flex gap-3 h-full pt-2">
            <div className="w-[42%] flex flex-col bg-[#0d0d1f] rounded-xl border border-[#1e293b] overflow-hidden">
              <div className="px-3 pt-3 pb-2 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Music Library</span>
                  <span className="text-[10px] text-gray-500">{libraryTotal.toLocaleString()} tracks</span>
                </div>
                {targetDancer && (
                  <div className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-lg bg-[#00d4ff]/10 border border-[#00d4ff]/20">
                    <Plus className="w-3 h-3 text-[#00d4ff]" />
                    <span className="text-[10px] text-[#00d4ff] font-medium">Adding to {targetDancer.name}</span>
                  </div>
                )}
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
              </div>
              <div className="flex-1 overflow-auto px-1 pb-2">
                {libraryTracks.map(track => (
                  <div
                    key={track.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#151528] active:bg-[#1e293b] group transition-colors"
                  >
                    <Music className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white truncate">{track.name}</p>
                      {track.genre && <p className="text-[10px] text-gray-500 truncate">{track.genre}</p>}
                    </div>
                    {targetDancerId && (
                      <button
                        onClick={() => addSongToDancer(targetDancerId, track.name)}
                        className="w-7 h-7 rounded flex items-center justify-center text-[#00d4ff] bg-[#00d4ff]/10 active:bg-[#00d4ff]/25 flex-shrink-0"
                        title={`Add to ${targetDancer?.name || 'entertainer'}`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {libraryTracks.length === 0 && !libraryLoading && (
                  <p className="text-xs text-gray-500 text-center py-8">No tracks found</p>
                )}
                {libraryLoading && (
                  <p className="text-xs text-gray-500 text-center py-8">Loading...</p>
                )}
              </div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-2 px-1">
                <div>
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Rotation</span>
                  <span className="text-[10px] text-gray-500 ml-2">{rotationList.length} entertainers</span>
                </div>
              </div>
              <div className="flex-1 overflow-auto space-y-1.5">
                {rotationList.length === 0 ? (
                  <div className="text-center py-12">
                    <Layers className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No entertainers in rotation</p>
                    <p className="text-xs text-gray-600 mt-1">Add from the Entertainers tab</p>
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

                    return (
                      <div key={dancerId}>
                        <div
                          className={`rounded-xl border transition-colors ${
                            isCurrent
                              ? 'bg-[#00d4ff]/10 border-[#00d4ff]/40'
                              : isExpanded
                                ? 'bg-[#0d0d1f] border-[#2563eb]/40'
                                : 'bg-[#0d0d1f] border-[#1e293b]'
                          }`}
                        >
                          <div
                            className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                            onClick={() => toggleDancer(dancerId)}
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
                              className="w-8 h-8 rounded-full flex items-center justify-center text-black font-bold text-xs flex-shrink-0"
                              style={{ backgroundColor: dancer.color || '#00d4ff' }}
                            >
                              {dancer.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium ${isCurrent ? 'text-[#00d4ff]' : 'text-white'}`}>
                                {dancer.name}
                                {isCurrent && <span className="ml-1.5 text-[10px] text-[#00d4ff]/70">◀ NOW</span>}
                                {hasEdits && <span className="ml-1.5 text-[10px] text-green-400">●</span>}
                              </p>
                              <p className="text-[10px] text-gray-500">{songs.length} song{songs.length !== 1 ? 's' : ''}</p>
                            </div>
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); boothApi.sendCommand('removeDancerFromRotation', { dancerId }); }}
                              className="p-1.5 text-red-400/40 active:text-red-400 transition-colors flex-shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          {isExpanded && (
                            <div className="px-3 pb-2 border-t border-[#1e293b]/50">
                              {songs.length === 0 ? (
                                <p className="text-[10px] text-gray-500 py-2 text-center">No songs assigned — tap + on a library track to add</p>
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

                        {breakSongsList.length > 0 && (
                          <div className="ml-10 mt-0.5 px-2 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20">
                            <p className="text-[10px] text-violet-400 truncate">♫ {breakSongsList.join(', ')}</p>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {activePanel === 'dancers' && (
          <div className="h-full overflow-auto space-y-1.5 pt-2">
            {dancers.filter(d => d.is_active).length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No active entertainers</p>
              </div>
            ) : (
              dancers.filter(d => d.is_active).map(dancer => {
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
                        <p className="text-xs text-gray-500">{dancer.playlist.length} songs</p>
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
      </div>
    </div>
  );
}
