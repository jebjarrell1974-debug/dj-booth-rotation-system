import React, { useState, useEffect, useRef, useCallback } from 'react';
import { boothApi } from '@/api/serverApi';
import HouseAnnouncementPanel from '@/components/dj/HouseAnnouncementPanel';
import { capSongAssignments, capSongList } from '@/utils/rotationAssignments';
import {
  SkipForward, Mic, MicOff, Users, Music, Plus, Minus, X, LogOut,
  Radio, SlidersHorizontal, Volume2, Save, Shuffle,
  ChevronDown, ChevronUp, RefreshCw, Drum, Layers, Star, Activity, Crown, Ban
} from 'lucide-react';
import ZoneProDailyControls from '@/components/dj/ZoneProDailyControls';

const stripExt = (name) => name?.replace(/\.[^.]+$/, '') || '';
const STRUCTURAL_COMMANDS = new Set([
  'updateRotation',
  'removeDancerFromRotation',
  'addDancerToRotation',
  'moveInRotation',
  'saveRotation',
  'updateSongAssignments',
]);
const BOOTH_STALE_AFTER_MS = 10_000;

export default function RemoteView({ dancers, liveBoothState, onLogout, songCooldowns = {} }) {
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
  const isOnCooldown = (name) => {
    const ts = songCooldowns[name];
    return !!(ts && (Date.now() - ts) < FOUR_HOURS_MS);
  };

  const [tab, setTab] = useState('rotation');
  const [songEdits, setSongEdits] = useState({});
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [expandedDancer, setExpandedDancer] = useState(null);
  const [vipPickerFor, setVipPickerFor] = useState(null);
  const [vipExtendFor, setVipExtendFor] = useState(null);
  const [vipAddMs, setVipAddMs] = useState(0);
  useEffect(() => { setVipAddMs(0); }, [vipPickerFor, vipExtendFor]);

  const [assigningTo, setAssigningTo] = useState(null);
  const [assigningBreak, setAssigningBreak] = useState(null);
  const [rerolling, setRerolling] = useState({});

  const [libSearch, setLibSearch] = useState('');
  const [libGenre, setLibGenre] = useState('');
  const [libTracks, setLibTracks] = useState([]);
  const [libGenres, setLibGenres] = useState([]);
  const [libTotal, setLibTotal] = useState(0);
  const [libLoading, setLibLoading] = useState(false);
  const libSearchTimer = useRef(null);

  const [clock, setClock] = useState(Date.now());
  const [lastStateReceivedAt, setLastStateReceivedAt] = useState(0);
  const [commandError, setCommandError] = useState('');
  const [showDeactivatePin, setShowDeactivatePin] = useState(false);
  const [deactivatePin, setDeactivatePin] = useState('');
  const deactivatePinInputRef = useRef(null);
  const lastServerUpdateRef = useRef(null);
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (liveBoothState?.updatedAt && liveBoothState.updatedAt !== lastServerUpdateRef.current) {
      lastServerUpdateRef.current = liveBoothState.updatedAt;
      setLastStateReceivedAt(Date.now());
    }
  }, [liveBoothState?.updatedAt]);

  const stateAgeMs = lastStateReceivedAt ? Math.max(0, clock - lastStateReceivedAt) : Infinity;
  const isConnected = stateAgeMs <= BOOTH_STALE_AFTER_MS;
  const isPlaying = liveBoothState?.isPlaying;
  const isRotationActive = liveBoothState?.isRotationActive;
  const currentDancerName = liveBoothState?.currentDancerName || '';
  const currentTrack = liveBoothState?.currentTrack || '';
  const currentSongNumber = liveBoothState?.currentSongNumber || 0;
  const songsPerSet = liveBoothState?.songsPerSet || 3;
  const boothStateLoaded = isConnected;
  const announcementsEnabled = liveBoothState?.announcementsEnabled !== false;
  const rotationList = liveBoothState?.rotation || [];
  const currentDancerIndex = liveBoothState?.currentDancerIndex || 0;
  const rotationSongs = liveBoothState?.rotationSongs || {};
  const currentVolume = liveBoothState?.volume != null ? liveBoothState.volume : 0.8;
  const currentVoiceGain = liveBoothState?.voiceGain != null ? liveBoothState.voiceGain : 1.5;
  const breakSongsPerSet = liveBoothState?.breakSongsPerSet || 0;
  const interstitialSongs = liveBoothState?.interstitialSongs || {};
  const dancerVipMap = liveBoothState?.dancerVipMap || {};
  const promoQueue = liveBoothState?.promoQueue || [];
  const skippedCommercials = new Set(liveBoothState?.skippedCommercials || []);
  const skipLocked = !!liveBoothState?.skipLocked;

  const sendRemoteCommand = useCallback(async (action, payload = {}) => {
    if (!isConnected) {
      setCommandError('The kiosk state is stale. No command was sent.');
      return null;
    }
    setCommandError('');
    try {
      return await boothApi.sendCommand(action, payload, {
        expectedRotationVersion: STRUCTURAL_COMMANDS.has(action)
          ? liveBoothState?.rotationVersion
          : undefined,
      });
    } catch (error) {
      setCommandError(error.message || 'The kiosk rejected the command.');
      return null;
    }
  }, [isConnected, liveBoothState?.rotationVersion]);

  const openDeactivate = () => {
    if (!currentTrack || !isConnected) return;
    setDeactivatePin('');
    setShowDeactivatePin(true);
    setTimeout(() => deactivatePinInputRef.current?.focus(), 100);
  };

  const confirmDeactivate = async () => {
    if (!currentTrack || !/^\d{5}$/.test(deactivatePin)) return;
    const result = await sendRemoteCommand('deactivateTrack', {
      trackName: currentTrack,
      pin: deactivatePin,
    });
    if (result) {
      setShowDeactivatePin(false);
      setDeactivatePin('');
    }
  };

  const currentDancer = dancers?.find(d => d.id === rotationList[currentDancerIndex]);
  const rotationDancers = rotationList.map(id => dancers?.find(d => d.id === id)).filter(Boolean);
  const allActiveDancers = (dancers || []).filter(d => d.is_active).sort((a, b) => a.name.localeCompare(b.name));

  const fetchLib = useCallback(async (search, genre) => {
    setLibLoading(true);
    try {
      const token = localStorage.getItem('djbooth_token');
      const params = new URLSearchParams({ page: '1', limit: '300' });
      if (search) params.set('search', search);
      if (genre && !search) params.set('genre', genre);
      const res = await fetch(`/api/music/tracks?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setLibTracks(data.tracks || []);
        setLibTotal(data.total || 0);
        if (data.genres?.length > 0) setLibGenres(data.genres);
      }
    } catch {}
    setLibLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'library') fetchLib('', '');
  }, [tab, fetchLib]);

  useEffect(() => {
    clearTimeout(libSearchTimer.current);
    libSearchTimer.current = setTimeout(() => fetchLib(libSearch, libGenre), 300);
    return () => clearTimeout(libSearchTimer.current);
  }, [libSearch, libGenre, fetchLib]);

  const getSongs = (dancerId) => {
    if (songEdits[dancerId]) return capSongList(songEdits[dancerId], songsPerSet);
    const songs = rotationSongs[dancerId] || [];
    return capSongList(songs.map(s => typeof s === 'string' ? s : s.name), songsPerSet);
  };

  const setSongs = (dancerId, songs) => {
    setSongEdits(prev => ({ ...prev, [dancerId]: capSongList(songs, songsPerSet) }));
    setHasUnsaved(true);
  };

  const addSong = (dancerId, trackName) => {
    const current = getSongs(dancerId);
    if (current.includes(trackName)) return;
    if (current.length >= songsPerSet) return;
    setSongs(dancerId, [...current, trackName]);
  };

  const removeSong = (dancerId, idx) => {
    const current = [...getSongs(dancerId)];
    current.splice(idx, 1);
    setSongs(dancerId, current);
  };

  const rerollSong = async (dancerId, songIdx) => {
    const key = `${dancerId}-${songIdx}`;
    const rerollDancer = dancers?.find(d => d.id === dancerId);
    const persistentPlaylist = Array.isArray(rerollDancer?.playlist) ? rerollDancer.playlist : [];
    const shownSongs = getSongs(dancerId) || [];
    const dancerPlaylist = [...new Set([...shownSongs, ...persistentPlaylist].filter(Boolean))];
    if (dancerPlaylist.length === 0) return;
    setRerolling(prev => ({ ...prev, [key]: true }));
    try {
      const allAssigned = [];
      rotationList.forEach(id => {
        getSongs(id).forEach((n, i) => {
          if (id !== dancerId || i !== songIdx) allAssigned.push(n);
        });
      });
      const token = localStorage.getItem('djbooth_token');
      const res = await fetch('/api/music/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ count: 1, excludeNames: [...new Set(allAssigned)], dancerPlaylist, strictPlaylist: true }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        const newTrack = data.tracks?.[0];
        if (newTrack) {
          const current = [...getSongs(dancerId)];
          current[songIdx] = newTrack.name;
          setSongs(dancerId, current);
        }
      }
    } catch {}
    setRerolling(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const handleSaveAll = () => {
    if (Object.keys(songEdits).length > 0) {
      sendRemoteCommand('updateSongAssignments', {
        assignments: capSongAssignments(songEdits, songsPerSet)
      });
    }
    sendRemoteCommand('saveRotation', { rotation: rotationList });
    setSongEdits({});
    setHasUnsaved(false);
  };

  const handleAssignTrack = (trackName) => {
    if (assigningBreak) {
      const { breakKey, index } = assigningBreak;
      const updated = { ...interstitialSongs };
      const arr = [...(updated[breakKey] || [])];
      arr[index] = trackName;
      updated[breakKey] = arr;
      sendRemoteCommand('updateInterstitialSongs', { interstitialSongs: updated });
      setAssigningBreak(null);
      setAssigningTo(null);
      setTab('rotation');
      return;
    }
    if (assigningTo) {
      addSong(assigningTo, trackName);
      setAssigningTo(null);
      setTab('rotation');
    }
  };

  return (
    <div className="h-[100dvh] bg-[#08081a] text-white flex flex-col overflow-hidden select-none font-sans">

      {/* ── HEADER ── */}
      <header className="border-b border-[#151528] px-4 py-2 flex-shrink-0 bg-[#0a0a1a]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-8 h-8 rounded-lg bg-[#00d4ff] flex items-center justify-center">
                <Radio className="w-4 h-4 text-black" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold tracking-tight leading-tight">NEON AI DJ</h1>
                <p className="text-[10px] text-gray-500">Remote Manager Console</p>
              </div>
            </div>

            <div className="bg-[#0d0d1f] rounded-lg border border-[#1e293b] p-2 min-w-0 flex-1 relative flex items-center gap-3">
              {currentDancer ? (
                <>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-black font-bold text-xs flex-shrink-0" style={{ backgroundColor: currentDancer.color || '#00d4ff' }}>
                    {currentDancer.name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 truncate">
                      {currentDancer.name}{isRotationActive ? ` - Song ${currentSongNumber}/${songsPerSet}` : ''}
                    </p>
                    <p className="text-sm text-white truncate">{currentTrack || 'Select a track'}</p>
                  </div>
                </>
              ) : (
                <div className="flex-1 text-sm text-gray-500 pl-2">No active entertainer</div>
              )}

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  disabled={!boothStateLoaded || !currentTrack}
                  onClick={openDeactivate}
                  title="Deactivate this song and replace it without counting it against the entertainer"
                  className="w-7 h-7 rounded-md text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center justify-center disabled:opacity-30 transition-colors"
                >
                  <Ban className="w-4 h-4" />
                </button>
                <button
                  disabled={!boothStateLoaded || skipLocked}
                  onClick={() => sendRemoteCommand('skip')}
                  title={skipLocked ? 'Skip is locked during announcements and the final 10 seconds' : 'Skip'}
                  className="w-7 h-7 rounded-md text-white hover:bg-[#1e293b] flex items-center justify-center disabled:opacity-30 transition-colors"
                >
                  <SkipForward className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-1.5 justify-end hidden xs:flex">
                  <Volume2 className="w-4 h-4 text-gray-500" />
                  <button onClick={() => sendRemoteCommand('setVolume', { volume: Math.max(0, currentVolume - 0.05) })} disabled={!boothStateLoaded || Math.round(currentVolume * 100) <= 0} className="w-7 h-7 rounded-md bg-[#151528] border border-[#2e2e5a] flex items-center justify-center text-white hover:bg-[#2e2e5a] active:bg-[#2e2e5a] disabled:opacity-30 transition-colors">
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-11 h-7 rounded-md bg-[#151528] border border-[#2e2e5a] flex items-center justify-center">
                    <span className="text-xs font-bold text-white tabular-nums">{Math.round(currentVolume * 100)}%</span>
                  </div>
                  <button onClick={() => sendRemoteCommand('setVolume', { volume: Math.min(1, currentVolume + 0.05) })} disabled={!boothStateLoaded || Math.round(currentVolume * 100) >= 100} className="w-7 h-7 rounded-md bg-[#151528] border border-[#2e2e5a] flex items-center justify-center text-white hover:bg-[#2e2e5a] active:bg-[#2e2e5a] disabled:opacity-30 transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                  </button>

                  <div className="w-px h-5 bg-[#2e2e5a] mx-0.5" />

                  <Mic className="w-4 h-4 text-[#a855f7]" />
                  <button onClick={() => sendRemoteCommand('setVoiceGain', { gain: Math.max(0.5, currentVoiceGain - 0.1) })} disabled={!boothStateLoaded || Math.round(currentVoiceGain * 100) <= 50} className="w-7 h-7 rounded-md bg-[#151528] border border-[#a855f7]/30 flex items-center justify-center text-white hover:bg-[#2e2e5a] active:bg-[#2e2e5a] disabled:opacity-30 transition-colors">
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-11 h-7 rounded-md bg-[#151528] border border-[#a855f7]/30 flex items-center justify-center">
                    <span className="text-xs font-bold text-[#a855f7] tabular-nums">{Math.round(currentVoiceGain * 100)}%</span>
                  </div>
                  <button onClick={() => sendRemoteCommand('setVoiceGain', { gain: Math.min(1.2, currentVoiceGain + 0.1) })} disabled={!boothStateLoaded || Math.round(currentVoiceGain * 100) >= 120} className="w-7 h-7 rounded-md bg-[#151528] border border-[#a855f7]/30 flex items-center justify-center text-white hover:bg-[#2e2e5a] active:bg-[#2e2e5a] disabled:opacity-30 transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="hidden lg:flex items-center gap-1.5 mr-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? (isPlaying ? 'bg-green-400 animate-pulse' : 'bg-yellow-400') : 'bg-red-500'}`} />
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">{isConnected ? (isPlaying ? 'Live' : 'Connected') : 'Offline'}</span>
            </div>

            <button
              onClick={() => sendRemoteCommand(isRotationActive ? 'stopRotation' : 'startRotation')}
              disabled={!boothStateLoaded}
              className={`px-3 h-9 rounded-md text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5 ${isRotationActive ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
            >
              {isRotationActive ? 'Stop Rotation' : 'Start Rotation'}
            </button>
            <button
              onClick={() => sendRemoteCommand('toggleAnnouncements')}
              disabled={!boothStateLoaded}
              className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors disabled:opacity-50 ${announcementsEnabled ? 'text-[#00d4ff] bg-[#00d4ff]/10 hover:bg-[#00d4ff]/20' : 'text-gray-500 hover:bg-[#151528]'}`}
              title="Toggle Announcements"
            >
              {announcementsEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>
            <button
              onClick={onLogout}
              className="w-9 h-9 rounded-md flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#151528] transition-colors ml-1"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {(!isConnected || commandError) && (
        <div className={`flex-shrink-0 px-4 py-2 border-b text-xs font-medium flex items-center gap-2 ${
          commandError
            ? 'bg-red-950/80 border-red-500/30 text-red-300'
            : 'bg-amber-950/80 border-amber-500/30 text-amber-300'
        }`}>
          <Activity className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">
            {commandError || 'Waiting for a fresh state update from the physical kiosk. Controls are disabled.'}
          </span>
          {commandError && (
            <button onClick={() => setCommandError('')} className="ml-auto text-current underline underline-offset-2">
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0">

        {/* Left Sidebar Navigation (Desktop) */}
        <div className="hidden md:flex w-16 flex-col bg-[#0a0a1a] border-r border-[#151528] py-2 gap-0.5 items-center flex-shrink-0">
          {[
            { id: 'rotation',      icon: Layers,           label: 'Rotation' },
            { id: 'dancers',       icon: Users,            label: 'Roster' },
            { id: 'options',       icon: SlidersHorizontal,label: 'Options' },
            { id: 'zones',         icon: Radio,            label: 'Zones' },
            { id: 'announce',      icon: Mic,              label: 'Announce' },
            { id: 'sounds',        icon: Drum,             label: 'SFX' },
            { id: 'promos',        icon: Star,             label: 'Feature' },
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => { setTab(id); if (id !== 'library') { setAssigningTo(null); setAssigningBreak(null); } }}
              className={`w-14 h-14 flex flex-col items-center justify-center rounded-xl gap-1 transition-colors relative ${
                tab === id
                  ? 'bg-[#00d4ff]/15 text-[#00d4ff]'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-[#151528]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[9px] font-medium leading-tight">{label}</span>
              {id === 'rotation' && hasUnsaved && <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-green-400" />}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 relative min-h-0 overflow-hidden bg-[#0d0d1f]">
          {!boothStateLoaded && (
            <div className="absolute inset-0 z-50 bg-[#08081a]/80 backdrop-blur-[1px] flex items-center justify-center p-6">
              <div className="max-w-sm rounded-xl border border-amber-500/30 bg-[#0d0d1f] p-5 text-center shadow-2xl">
                <Activity className="w-7 h-7 text-amber-400 mx-auto mb-3" />
                <div className="text-base font-semibold text-white">Kiosk state is unavailable</div>
                <div className="text-sm text-gray-400 mt-1">No operational commands will be sent until the physical kiosk reconnects.</div>
              </div>
            </div>
          )}

          {/* ─────────── ROTATION TAB ─────────── */}
          {tab === 'rotation' && (
            <div className="h-full flex flex-col overflow-hidden">
              <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-[#1e293b]">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Live Rotation</span>

                  <div className="hidden sm:flex items-center gap-2">
                    <span className="text-xs text-gray-500">Songs/Set:</span>
                    <select
                      value={songsPerSet}
                      onChange={(e) => sendRemoteCommand('setSongsPerSet', { count: parseInt(e.target.value), source: 'dashboard-dropdown' })}
                      className="bg-[#151528] border border-[#1e293b] text-white text-xs rounded px-2 py-1 outline-none"
                    >
                      {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>

                  <div className="hidden sm:flex items-center gap-2">
                    <span className="text-xs text-gray-500">Breaks/Set:</span>
                    <select
                      value={breakSongsPerSet}
                      onChange={(e) => sendRemoteCommand('setBreakSongsPerSet', { count: parseInt(e.target.value) })}
                      className="bg-[#151528] border border-[#1e293b] text-white text-xs rounded px-2 py-1 outline-none"
                    >
                      {[0,1,2,3].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>

                <button
                  onClick={handleSaveAll}
                  disabled={!hasUnsaved}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${hasUnsaved ? 'bg-green-500 text-black animate-pulse' : 'bg-[#151528] text-gray-500'}`}
                >
                  <Save className="w-4 h-4" />
                  Save Changes
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {rotationDancers.length === 0 && (
                  <div className="text-center py-12 text-lg text-gray-600">No rotation active. Add entertainers from the Roster tab.</div>
                )}

                {rotationDancers.map((dancer, idx) => {
                  const isOnStage = idx === currentDancerIndex && isRotationActive;
                  const songs = getSongs(dancer.id);
                  const isExpanded = expandedDancer === dancer.id;
                  const showVipPicker = vipPickerFor === dancer.id;
                  const breakKey = String(idx + 1);
                  const breakSlots = Array.from({ length: breakSongsPerSet }).map((_, i) => (interstitialSongs[breakKey] || [])[i] || '');

                  return (
                    <div key={dancer.id} className={`rounded-xl border transition-colors bg-[#08081a] ${isOnStage ? 'border-[#00d4ff]/50' : 'border-[#1e293b]'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`text-base font-bold w-6 text-center flex-shrink-0 ${isOnStage ? 'text-[#00d4ff]' : 'text-gray-600'}`}>{isOnStage ? '▶' : idx + 1}</div>
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-black font-bold text-lg flex-shrink-0" style={{ backgroundColor: dancer.color || '#00d4ff' }}>
                            {dancer.name?.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-lg font-semibold truncate ${isOnStage ? 'text-white' : 'text-gray-300'}`}>{dancer.name}</div>
                            <div className="text-sm text-gray-500 truncate">{songs.length} song{songs.length !== 1 ? 's' : ''} assigned{breakSongsPerSet > 0 ? ` · ${breakSongsPerSet} breaks` : ''}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0 pl-12 sm:pl-0">
                          <button onClick={() => setVipPickerFor(showVipPicker ? null : dancer.id)} title="VIP" className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${showVipPicker ? 'bg-yellow-500/25 text-yellow-400' : 'bg-[#1e293b] text-gray-400 hover:bg-[#2e2e5a]'}`}>
                            <Crown className="w-5 h-5" />
                          </button>
                          <button onClick={() => sendRemoteCommand('moveInRotation', { dancerId: dancer.id, direction: 'up' })} disabled={idx === 0} title="Move Up" className="w-10 h-10 rounded-xl bg-[#1e293b] flex items-center justify-center text-gray-400 hover:bg-[#2e2e5a] disabled:opacity-20 transition-colors">
                            <ChevronUp className="w-5 h-5" />
                          </button>
                          <button onClick={() => sendRemoteCommand('moveInRotation', { dancerId: dancer.id, direction: 'down' })} disabled={idx === rotationDancers.length - 1} title="Move Down" className="w-10 h-10 rounded-xl bg-[#1e293b] flex items-center justify-center text-gray-400 hover:bg-[#2e2e5a] disabled:opacity-20 transition-colors">
                            <ChevronDown className="w-5 h-5" />
                          </button>
                          <button onClick={() => setExpandedDancer(isExpanded ? null : dancer.id)} title="Edit Songs" className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isExpanded ? 'bg-[#00d4ff]/25 text-[#00d4ff]' : 'bg-[#1e293b] text-gray-400 hover:bg-[#2e2e5a]'}`}>
                            <Music className="w-5 h-5" />
                          </button>
                          <button onClick={() => sendRemoteCommand('removeDancerFromRotation', { dancerId: dancer.id })} title="Remove" className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center text-red-400 hover:bg-red-500/25 ml-2 transition-colors">
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      </div>

                      {showVipPicker && (
                        <div className="px-3 pb-3 pt-1 border-t border-[#1e293b] ml-12 sm:ml-0">
                          {(() => {
                            const addMins = Math.round(vipAddMs / 60000);
                            const h = Math.floor(addMins / 60), m = addMins % 60;
                            const lbl = addMins === 0 ? '—' : (h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`);
                            return (
                              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                <div className="flex items-center gap-2 flex-1">
                                  <span className="text-xs text-yellow-400 flex-shrink-0 w-8">Add:</span>
                                  {[{ label: '+15m', ms: 15 * 60 * 1000 }, { label: '+30m', ms: 30 * 60 * 1000 }, { label: '+1h', ms: 60 * 60 * 1000 }].map(({ label, ms }) => (
                                    <button key={label} onClick={() => setVipAddMs(v => v + ms)} className="flex-1 h-9 rounded-lg bg-yellow-500/15 border border-yellow-500/30 text-yellow-300 text-sm font-bold active:bg-yellow-500/30">
                                      {label}
                                    </button>
                                  ))}
                                </div>
                                <div className="flex items-center gap-2 flex-1">
                                  <span className="text-xs text-yellow-300 flex-shrink-0 w-16">Total: {lbl}</span>
                                  <button disabled={vipAddMs === 0} onClick={() => { if (vipAddMs > 0) sendRemoteCommand('sendToVip', { dancerId: dancer.id, durationMs: vipAddMs }); setVipPickerFor(null); }} className="flex-1 h-9 rounded-lg bg-yellow-500 text-black text-sm font-bold active:bg-yellow-400 disabled:opacity-30">
                                    Send to VIP
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {isExpanded && (
                        <div className="px-4 pb-4 border-t border-[#1e293b]">
                          {breakSongsPerSet > 0 && (
                            <div className="pt-3 pb-2">
                              <div className="text-xs font-semibold text-violet-400 uppercase tracking-wider mb-2">Break Slots</div>
                              <div className="space-y-1.5">
                                {breakSlots.map((slot, i) => (
                                  <button key={i} onClick={() => { setAssigningBreak({ breakKey, index: i }); setTab('library'); }} className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-violet-500/25 bg-violet-900/10 hover:bg-violet-500/15 transition-colors text-left">
                                    <span className="text-xs font-bold text-violet-400 w-5">B{i + 1}</span>
                                    <span className="text-sm flex-1 truncate">{slot ? <span className="text-gray-200">{stripExt(slot)}</span> : <span className="text-gray-500 italic">Tap to assign break song</span>}</span>
                                    <Music className="w-4 h-4 text-violet-400 opacity-70" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="pt-3">
                            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Playlist Songs</div>
                            <div className="space-y-1.5">
                              {songs.length === 0 && <div className="text-sm text-gray-500 py-2 italic">No songs — system auto-picks at stage time</div>}
                              {songs.map((song, songIdx) => {
                                const isNowPlaying = isOnStage && songIdx === (currentSongNumber - 1);
                                const rerollKey = `${dancer.id}-${songIdx}`;
                                const isRerolling = rerolling[rerollKey];
                                return (
                                  <div key={songIdx} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${isNowPlaying ? 'bg-[#00d4ff]/10 border-[#00d4ff]/30' : 'bg-[#0d0d1f] border-[#1e293b]'}`}>
                                    <span className={`text-sm font-bold w-5 ${isNowPlaying ? 'text-[#00d4ff]' : 'text-gray-500'}`}>{isNowPlaying ? '▶' : songIdx + 1}</span>
                                    <span className={`text-sm flex-1 truncate ${isOnCooldown(song) ? 'text-orange-300' : 'text-gray-300'}`}>{stripExt(song)}</span>
                                    {!isNowPlaying && (
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <button onClick={() => rerollSong(dancer.id, songIdx)} disabled={isRerolling} className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-400 hover:bg-amber-500/25 disabled:opacity-40 transition-colors" title="Reroll Song">
                                          {isRerolling ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shuffle className="w-4 h-4" />}
                                        </button>
                                        <button onClick={() => removeSong(dancer.id, songIdx)} className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors" title="Remove Song">
                                          <X className="w-4 h-4" />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─────────── ROSTER TAB ─────────── */}
          {tab === 'dancers' && (
            <div className="h-full overflow-y-auto px-4 py-4 space-y-8">
              <div>
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Add to Rotation</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {allActiveDancers.filter(d => !rotationList.includes(d.id)).map(dancer => (
                    <button key={dancer.id} onClick={() => { sendRemoteCommand('addDancerToRotation', { dancerId: dancer.id }); setTab('rotation'); }}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#08081a] border border-[#1e293b] hover:bg-[#151528] transition-all group hover:border-[#00d4ff]/30 text-left">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-black font-bold text-lg flex-shrink-0" style={{ backgroundColor: dancer.color || '#00d4ff' }}>
                        {dancer.name?.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-base text-gray-300 flex-1 font-medium group-hover:text-white transition-colors truncate">{dancer.name}</span>
                      <Plus className="w-5 h-5 text-[#00d4ff] opacity-50 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                    </button>
                  ))}
                  {allActiveDancers.filter(d => !rotationList.includes(d.id)).length === 0 && (
                    <div className="col-span-full py-12 text-center text-gray-500 italic">All active entertainers are in rotation</div>
                  )}
                </div>
              </div>

              {Object.keys(dancerVipMap).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-yellow-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Crown className="w-4 h-4" /> In VIP
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {Object.entries(dancerVipMap).map(([dancerId, vipEntry]) => {
                      const vipDancer = dancers?.find(d => String(d.id) === String(dancerId));
                      if (!vipDancer) return null;
                      const msLeft = vipEntry.expiresAt ? Math.max(0, vipEntry.expiresAt - Date.now()) : 0;
                      const minsLeft = Math.floor(msLeft / 60000);
                      const secsLeft = Math.floor((msLeft % 60000) / 1000);
                      return (
                        <div key={dancerId} className="p-4 rounded-xl border border-yellow-500/30 bg-yellow-900/10">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center text-black font-bold text-lg flex-shrink-0" style={{ backgroundColor: vipDancer.color || '#00d4ff' }}>
                              {vipDancer.name?.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-base font-semibold text-white truncate">{vipDancer.name}</div>
                              <div className="text-sm text-yellow-400 font-medium">Returns in {minsLeft}:{String(secsLeft).padStart(2, '0')}</div>
                            </div>
                          </div>

                          {vipExtendFor === vipDancer.id ? (
                            <div className="pt-3 border-t border-yellow-500/20 space-y-2">
                              {(() => {
                                const addMins = Math.round(vipAddMs / 60000);
                                const h = Math.floor(addMins / 60), m = addMins % 60;
                                const lbl = addMins === 0 ? '—' : (h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`);
                                return (
                                  <>
                                    <div className="flex items-center gap-2">
                                      {[15, 30, 60].map(mm => (
                                        <button key={mm} onClick={() => setVipAddMs(v => v + mm * 60 * 1000)} className="flex-1 h-8 rounded-lg bg-yellow-500/15 border border-yellow-500/30 text-yellow-300 text-xs font-bold active:bg-yellow-500/30">
                                          +{mm < 60 ? `${mm}m` : '1h'}
                                        </button>
                                      ))}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-yellow-300 flex-shrink-0 w-16">Tot: {lbl}</span>
                                      <button disabled={vipAddMs === 0} onClick={() => { if (vipAddMs > 0) sendRemoteCommand('sendToVip', { dancerId: vipDancer.id, durationMs: vipAddMs }); setVipExtendFor(null); }} className="flex-1 h-8 rounded-lg bg-yellow-500 text-black text-xs font-bold active:bg-yellow-400 disabled:opacity-30">Extend</button>
                                      <button onClick={() => setVipExtendFor(null)} className="flex-1 h-8 rounded-lg bg-[#1e293b] text-gray-400 text-xs active:bg-[#2e2e5a]">Cancel</button>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 pt-3 border-t border-yellow-500/20">
                              <button onClick={() => { setVipExtendFor(vipDancer.id); setVipAddMs(0); }} className="flex-1 h-9 rounded-lg bg-yellow-500/15 border border-yellow-500/30 text-yellow-300 text-sm font-semibold hover:bg-yellow-500/25 transition-colors">
                                Extend Time
                              </button>
                              <button
                                onClick={() => sendRemoteCommand('releaseFromVip', { dancerId: vipDancer.id })}
                                className="flex-1 min-h-9 h-auto py-2 rounded-lg bg-green-500/15 border border-green-500/30 text-green-400 text-sm font-semibold hover:bg-green-500/25 transition-colors"
                                title={`End ${vipDancer.name}'s VIP early and return her to rotation`}
                              >
                                Return to Rotation
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─────────── LIBRARY SEARCH TAB ─────────── */}
          {tab === 'library' && (
            <div className="h-full flex flex-col bg-[#0d0d1f]">
              <div className="p-3 border-b border-[#1e293b] bg-[#0a0a1a] flex flex-col sm:flex-row sm:items-center gap-3 flex-shrink-0">
                <div className="flex items-center gap-2 flex-1">
                  <button onClick={() => { setTab('rotation'); setAssigningTo(null); setAssigningBreak(null); }} className="h-10 px-3 rounded-lg bg-[#1e293b] text-gray-300 text-sm font-medium hover:bg-[#2e2e5a] transition-colors">
                    Back
                  </button>
                  <div className="flex-1 text-sm text-[#00d4ff] font-medium truncate">
                    {assigningBreak ? `Picking B${assigningBreak.index + 1}` :
                     assigningTo ? `Picking for ${dancers.find(d => d.id === assigningTo)?.name || 'Dancer'}` : ''}
                  </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <input type="text" value={libSearch} onChange={e => setLibSearch(e.target.value)} placeholder="Search..." className="w-full sm:w-48 h-10 bg-[#08081a] border border-[#1e293b] rounded-lg px-3 text-sm focus:outline-none focus:border-[#00d4ff] transition-colors" />
                  <select value={libGenre} onChange={e => setLibGenre(e.target.value)} className="w-full sm:w-32 h-10 bg-[#08081a] border border-[#1e293b] rounded-lg px-2 text-sm focus:outline-none focus:border-[#00d4ff] transition-colors">
                    <option value="">All Genres</option>
                    {libGenres.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {libLoading ? (
                  <div className="py-8 text-center text-gray-500">Searching...</div>
                ) : libTracks.length === 0 ? (
                  <div className="py-8 text-center text-gray-500">No tracks found</div>
                ) : (
                  libTracks.map(t => {
                    const cd = isOnCooldown(t.name);
                    return (
                      <button key={t.path} onClick={() => handleAssignTrack(t.name)} className="w-full text-left px-4 py-3 rounded-xl border border-transparent hover:bg-[#151528] hover:border-[#1e293b] transition-all flex items-center justify-between group">
                        <span className={`text-base truncate flex-1 pr-4 ${cd ? 'text-orange-300' : 'text-gray-300 group-hover:text-white'}`}>{stripExt(t.name)}</span>
                        {cd && <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-orange-500/20 text-orange-400">Recently Played</span>}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* ─────────── ANNOUNCE TAB ─────────── */}
          {tab === 'announce' && (
            <div className="h-full overflow-hidden flex flex-col p-4 bg-[#0d0d1f]">
              <div className="flex-1 overflow-y-auto max-w-3xl w-full mx-auto">
                <HouseAnnouncementPanel
                  isRemote
                  onRemotePlay={(cacheKey) => sendRemoteCommand('playHouseAnnouncement', { cacheKey })}
                />
              </div>
            </div>
          )}

          {showDeactivatePin && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4" onClick={() => { setShowDeactivatePin(false); setDeactivatePin(''); }}>
              <div className="bg-[#0d0d1f] border border-red-500/40 rounded-2xl p-6 w-full max-w-[340px] shadow-2xl" onClick={event => event.stopPropagation()}>
                <h3 className="text-lg font-bold text-red-400 mb-1">Deactivate Current Song</h3>
                <p className="text-xs text-gray-400 mb-4 truncate">{stripExt(currentTrack) || 'Current song'}</p>
                <p className="text-sm text-gray-300 mb-3">
                  Enter your 5-digit DJ PIN. The kiosk will replace this song without counting it against the entertainer.
                </p>
                <input
                  ref={deactivatePinInputRef}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={5}
                  value={deactivatePin}
                  onChange={event => setDeactivatePin(event.target.value.replace(/\D/g, '').slice(0, 5))}
                  onKeyDown={event => { if (event.key === 'Enter') confirmDeactivate(); }}
                  className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg px-4 py-3 text-center text-2xl font-mono text-white tracking-[0.5em] focus:outline-none focus:border-red-500/60 mb-4"
                  placeholder="•••••"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowDeactivatePin(false); setDeactivatePin(''); }}
                    className="flex-1 py-2.5 rounded-lg bg-[#1e293b] text-gray-300 text-sm font-semibold active:bg-[#2e2e5a] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDeactivate}
                    disabled={deactivatePin.length !== 5}
                    className="flex-1 py-2.5 rounded-lg bg-red-500 text-white text-sm font-semibold active:bg-red-600 disabled:opacity-30 transition-colors"
                  >
                    Deactivate
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─────────── PROMOS TAB ─────────── */}
          {tab === 'promos' && (
            <div className="h-full overflow-y-auto p-4 bg-[#0d0d1f]">
              <div className="max-w-4xl w-full mx-auto space-y-4">
                <div className="rounded-xl border border-violet-500/25 bg-violet-950/10 p-4">
                  <h2 className="text-lg font-bold text-white">Feature & Promo Queue</h2>
                  <p className="text-sm text-gray-400 mt-1">
                    Reorder or skip the promos already prepared on the physical kiosk. Creating and recording new promo audio remains kiosk-only.
                  </p>
                </div>
                {promoQueue.length === 0 ? (
                  <div className="rounded-xl border border-[#1e293b] bg-[#08081a] py-14 text-center text-gray-500">
                    No promos are currently queued.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {promoQueue.map((promo, idx) => {
                      const promoId = promo?.cache_key || promo?.id || String(idx);
                      const promoName = promo?.dancer_name || promo?.cache_key?.replace(/^promo_/, '').replace(/_/g, ' ') || 'Promo';
                      const isSkipped = skippedCommercials.has(promoId);
                      return (
                        <div key={promoId} className={`flex items-center gap-3 rounded-xl border border-[#1e293b] bg-[#08081a] p-3 ${isSkipped ? 'opacity-40' : ''}`}>
                          <div className="w-8 h-8 rounded-lg bg-violet-500/15 text-violet-300 flex items-center justify-center font-bold text-sm">
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-white truncate capitalize">{promoName}</div>
                            <div className="text-xs text-gray-500">{isSkipped ? 'Skipped' : 'Queued between entertainer sets'}</div>
                          </div>
                          <button
                            onClick={() => sendRemoteCommand('swapPromo', { slotIndex: idx })}
                            className="h-9 px-3 rounded-lg bg-[#1e293b] text-gray-300 text-sm font-semibold hover:bg-[#2e2e5a]"
                          >
                            Swap
                          </button>
                          <button
                            onClick={() => sendRemoteCommand('skipCommercial', { commercialId: promoId })}
                            disabled={isSkipped}
                            className="h-9 px-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-sm font-semibold disabled:opacity-30"
                          >
                            Skip
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─────────── SOUNDS TAB ─────────── */}
          {tab === 'sounds' && (
            <div className="h-full overflow-y-auto p-4 bg-[#0d0d1f]">
              <div className="max-w-4xl mx-auto">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Soundboard</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {[
                    { id: 'airhorn', label: 'Airhorn' },
                    { id: 'applause', label: 'Applause' },
                    { id: 'cashregister', label: 'Ca-Ching' },
                    { id: 'drumroll', label: 'Drumroll' },
                    { id: 'rimshot', label: 'Rimshot' },
                    { id: 'siren', label: 'Siren' },
                    { id: 'scratch', label: 'Record Scratch' },
                    { id: 'whip', label: 'Whip Crack' },
                    { id: 'buzzer', label: 'Buzzer' },
                    { id: 'cheer', label: 'Cheer' }
                  ].map(sfx => (
                    <button
                      key={sfx.id}
                      onClick={() => sendRemoteCommand('playSound', { soundId: sfx.id })}
                      className="h-20 rounded-xl bg-[#151528] border border-[#1e293b] hover:bg-[#1e293b] hover:border-[#2e2e5a] text-gray-300 font-bold active:bg-[#00d4ff]/20 active:text-[#00d4ff] active:border-[#00d4ff]/50 transition-all flex flex-col items-center justify-center gap-2"
                    >
                      <Drum className="w-5 h-5 opacity-70" />
                      <span className="text-sm">{sfx.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─────────── ZONES TAB ─────────── */}
          {tab === 'zones' && (
            <div className="h-full overflow-hidden bg-[#0d0d1f]">
              <ZoneProDailyControls />
            </div>
          )}

          {/* ─────────── OPTIONS TAB ─────────── */}
          {tab === 'options' && (
            <div className="h-full overflow-y-auto p-4 bg-[#0d0d1f]">
              <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-[#1e293b] bg-[#08081a] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#00d4ff] mb-3">Music Volume</div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => sendRemoteCommand('setVolume', { volume: Math.max(0, currentVolume - 0.05) })} disabled={currentVolume <= 0} className="w-12 h-12 rounded-xl bg-[#1e293b] flex items-center justify-center disabled:opacity-30"><Minus className="w-5 h-5" /></button>
                    <div className="flex-1 text-center text-2xl font-bold tabular-nums">{Math.round(currentVolume * 100)}%</div>
                    <button onClick={() => sendRemoteCommand('setVolume', { volume: Math.min(1, currentVolume + 0.05) })} disabled={currentVolume >= 1} className="w-12 h-12 rounded-xl bg-[#1e293b] flex items-center justify-center disabled:opacity-30"><Plus className="w-5 h-5" /></button>
                  </div>
                </div>
                <div className="rounded-xl border border-[#1e293b] bg-[#08081a] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-violet-400 mb-3">Voice Volume</div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => sendRemoteCommand('setVoiceGain', { gain: Math.max(0.5, currentVoiceGain - 0.1) })} disabled={currentVoiceGain <= 0.5} className="w-12 h-12 rounded-xl bg-[#1e293b] flex items-center justify-center disabled:opacity-30"><Minus className="w-5 h-5" /></button>
                    <div className="flex-1 text-center text-2xl font-bold tabular-nums">{Math.round(currentVoiceGain * 100)}%</div>
                    <button onClick={() => sendRemoteCommand('setVoiceGain', { gain: Math.min(1.2, currentVoiceGain + 0.1) })} disabled={currentVoiceGain >= 1.2} className="w-12 h-12 rounded-xl bg-[#1e293b] flex items-center justify-center disabled:opacity-30"><Plus className="w-5 h-5" /></button>
                  </div>
                </div>
                <div className="rounded-xl border border-[#1e293b] bg-[#08081a] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Set Format</div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-gray-500">
                      Songs per set
                      <select value={songsPerSet} onChange={(event) => sendRemoteCommand('setSongsPerSet', { count: Number(event.target.value), source: 'remote-options' })} className="mt-1 w-full h-11 rounded-lg bg-[#151528] border border-[#2e2e5a] px-3 text-white">
                        {[1,2,3,4,5,6,7,8].map(count => <option key={count} value={count}>{count}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-gray-500">
                      Break songs
                      <select value={breakSongsPerSet} onChange={(event) => sendRemoteCommand('setBreakSongsPerSet', { count: Number(event.target.value) })} className="mt-1 w-full h-11 rounded-lg bg-[#151528] border border-[#2e2e5a] px-3 text-white">
                        {[0,1,2,3].map(count => <option key={count} value={count}>{count}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
                <div className="rounded-xl border border-[#1e293b] bg-[#08081a] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Announcements & Promos</div>
                  <button onClick={() => sendRemoteCommand('toggleAnnouncements')} className={`w-full h-11 rounded-lg font-semibold ${announcementsEnabled ? 'bg-[#00d4ff]/15 text-[#00d4ff]' : 'bg-[#1e293b] text-gray-400'}`}>
                    Announcements {announcementsEnabled ? 'On' : 'Off'}
                  </button>
                  <label className="block text-xs text-gray-500 mt-3">
                    Promo frequency
                    <select value={String(liveBoothState?.commercialFreq ?? 'off')} onChange={(event) => sendRemoteCommand('setCommercialFreq', { freq: event.target.value })} className="mt-1 w-full h-11 rounded-lg bg-[#151528] border border-[#2e2e5a] px-3 text-white">
                      <option value="off">Off</option>
                      <option value="1">Every set</option>
                      <option value="2">Every other set</option>
                      <option value="3">Every third set</option>
                    </select>
                  </label>
                </div>
                <div className="md:col-span-2 rounded-xl border border-[#1e293b] bg-[#08081a] p-4 text-sm text-gray-400">
                  System maintenance, credentials, display configuration, recovery tools, and deep audio-zone setup are available only on the physical kiosk.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── BOTTOM NAV (Mobile) ── */}
        <div className="md:hidden flex-shrink-0 flex items-stretch border-t border-[#151528] bg-[#080818] overflow-x-auto snap-x">
          {[
            { id: 'rotation',      icon: Layers,           label: 'Rotation' },
            { id: 'dancers',       icon: Users,            label: 'Roster' },
            { id: 'options',       icon: SlidersHorizontal,label: 'Options' },
            { id: 'zones',         icon: Radio,            label: 'Zones' },
            { id: 'announce',      icon: Mic,              label: 'Announce' },
            { id: 'sounds',        icon: Drum,             label: 'SFX' },
            { id: 'promos',        icon: Star,             label: 'Feature' },
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => { setTab(id); if (id !== 'library') { setAssigningTo(null); setAssigningBreak(null); } }}
              className={`flex-none w-20 flex flex-col items-center justify-center gap-1 py-3 snap-start relative transition-colors ${tab === id ? 'text-[#00d4ff]' : 'text-gray-600 active:text-gray-400'}`}
            >
              {tab === id && <div className="absolute top-0 inset-x-0 h-0.5 bg-[#00d4ff] rounded-b" />}
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{label}</span>
              {id === 'rotation' && hasUnsaved && <div className="absolute top-2 right-4 w-1.5 h-1.5 rounded-full bg-green-400" />}
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}
