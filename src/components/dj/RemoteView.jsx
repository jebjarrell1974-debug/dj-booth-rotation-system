import React, { useState, useEffect, useRef, useCallback } from 'react';
import { boothApi } from '@/api/serverApi';
import DJOptions from '@/components/dj/DJOptions';
import HouseAnnouncementPanel from '@/components/dj/HouseAnnouncementPanel';
import { VOICE_SETTINGS, getCurrentEnergyLevel } from '@/utils/energyLevels';
import { getApiConfig } from '@/components/apiConfig';
import { trackOpenAICall, trackElevenLabsCall, estimateTokens } from '@/utils/apiCostTracker';
import {
  SkipForward, Mic, MicOff, Users, Music, Plus, Minus, X, LogOut,
  Radio, SlidersHorizontal, Volume2, Save, Search, Shuffle, Zap,
  ChevronDown, ChevronUp, RefreshCw, Ban, Send, Loader2,
  PlayCircle, StopCircle, Megaphone, Crown, Drum,
} from 'lucide-react';

const VIBE_OPTIONS = ['Hype', 'Chill', 'Sexy', 'Party', 'Classy', 'Latin', 'Urban'];
const LENGTH_OPTIONS = ['15s', '30s', '45s', '60s'];

const stripExt = (name) => name?.replace(/\.[^.]+$/, '') || '';

export default function RemoteView({ dancers, liveBoothState, onLogout, djOptions, onOptionsChange, songCooldowns = {} }) {
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
  const isOnCooldown = (name) => {
    const ts = songCooldowns[name];
    return !!(ts && (Date.now() - ts) < FOUR_HOURS_MS);
  };
  const [tab, setTab] = useState('live');
  const [songEdits, setSongEdits] = useState({});
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [expandedDancer, setExpandedDancer] = useState(null);
  const [vipPickerFor, setVipPickerFor] = useState(null);
  const [soundBoost, setSoundBoost] = useState(1.0);

  const [libSearch, setLibSearch] = useState('');
  const [libGenre, setLibGenre] = useState('');
  const [libTracks, setLibTracks] = useState([]);
  const [libGenres, setLibGenres] = useState([]);
  const [libTotal, setLibTotal] = useState(0);
  const [libLoading, setLibLoading] = useState(false);
  const libSearchTimer = useRef(null);

  const [assigningTo, setAssigningTo] = useState(null);
  const [assigningBreak, setAssigningBreak] = useState(null);

  const [showDeactivatePin, setShowDeactivatePin] = useState(false);
  const [deactivatePin, setDeactivatePin] = useState('');

  const [rerolling, setRerolling] = useState({});

  const [promoForm, setPromoForm] = useState({ event_name: '', details: '', vibe: 'Hype', length: '30s' });
  const [promoSubmitting, setPromoSubmitting] = useState(false);
  const [promoStatus, setPromoStatus] = useState('');
  const [optimisticBreak, setOptimisticBreak] = useState(null);

  const skippedFromBooth = liveBoothState?.skippedCommercials || [];
  const [localSkipped, setLocalSkipped] = useState(new Set());
  const skippedCommercials = new Set([...skippedFromBooth, ...localSkipped]);

  const isConnected = liveBoothState?.updatedAt > 0;
  const isPlaying = liveBoothState?.isPlaying;
  const isRotationActive = liveBoothState?.isRotationActive;
  const currentDancerName = liveBoothState?.currentDancerName || '';
  const currentTrack = liveBoothState?.currentTrack || '';
  const currentSongNumber = liveBoothState?.currentSongNumber || 0;
  const songsPerSet = liveBoothState?.songsPerSet || 3;
  const announcementsEnabled = liveBoothState?.announcementsEnabled !== false;
  const rotationList = liveBoothState?.rotation || [];
  const currentDancerIndex = liveBoothState?.currentDancerIndex || 0;
  const rotationSongs = liveBoothState?.rotationSongs || {};
  const currentVolume = liveBoothState?.volume != null ? liveBoothState.volume : 0.8;
  const currentVoiceGain = liveBoothState?.voiceGain != null ? liveBoothState.voiceGain : 1.5;
  const breakSongsPerSet = optimisticBreak !== null ? optimisticBreak : (liveBoothState?.breakSongsPerSet || 0);
  const interstitialSongs = liveBoothState?.interstitialSongs || {};
  const commercialFreq = liveBoothState?.commercialFreq || 'off';
  const promoQueue = liveBoothState?.promoQueue || [];
  const availablePromos = liveBoothState?.availablePromos || [];
  const trackTime = liveBoothState?.trackTime || 0;
  const trackDuration = liveBoothState?.trackDuration || 0;
  const trackTimeAt = liveBoothState?.trackTimeAt || 0;
  const dancerVipMap = liveBoothState?.dancerVipMap || {};

  const currentDancer = dancers?.find(d => d.id === rotationList[currentDancerIndex]);
  const rotationDancers = rotationList.map(id => dancers?.find(d => d.id === id)).filter(Boolean);
  const allActiveDancers = (dancers || []).filter(d => d.is_active).sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    if (optimisticBreak !== null && liveBoothState?.breakSongsPerSet === optimisticBreak) {
      setOptimisticBreak(null);
    }
  }, [liveBoothState?.breakSongsPerSet, optimisticBreak]);

  const countdownRef = useRef(null);
  const progressRef = useRef(null);
  useEffect(() => {
    const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const interval = setInterval(() => {
      if (!isPlaying || trackDuration <= 0 || trackTimeAt <= 0) {
        if (countdownRef.current) countdownRef.current.textContent = '';
        if (progressRef.current) progressRef.current.style.width = '0%';
        return;
      }
      const elapsed = (Date.now() - trackTimeAt) / 1000;
      const pos = Math.min(trackTime + elapsed, trackDuration);
      const remaining = Math.max(0, trackDuration - pos);
      const pct = Math.min(100, (pos / trackDuration) * 100);
      if (countdownRef.current) countdownRef.current.textContent = fmt(remaining);
      if (progressRef.current) progressRef.current.style.width = `${pct}%`;
    }, 250);
    return () => clearInterval(interval);
  }, [trackTime, trackDuration, trackTimeAt, isPlaying]);

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
    if (tab === 'library' || tab === 'rotation') fetchLib('', '');
  }, [tab, fetchLib]);

  useEffect(() => {
    clearTimeout(libSearchTimer.current);
    libSearchTimer.current = setTimeout(() => fetchLib(libSearch, libGenre), 300);
    return () => clearTimeout(libSearchTimer.current);
  }, [libSearch, libGenre, fetchLib]);

  const getSongs = (dancerId) => {
    if (songEdits[dancerId]) return songEdits[dancerId];
    const songs = rotationSongs[dancerId] || [];
    return songs.map(s => typeof s === 'string' ? s : s.name);
  };

  const setSongs = (dancerId, songs) => {
    setSongEdits(prev => ({ ...prev, [dancerId]: songs }));
    setHasUnsaved(true);
  };

  const addSong = (dancerId, trackName) => {
    const current = getSongs(dancerId);
    if (current.includes(trackName)) return;
    setSongs(dancerId, [...current, trackName]);
  };

  const removeSong = (dancerId, idx) => {
    const current = [...getSongs(dancerId)];
    current.splice(idx, 1);
    setSongs(dancerId, current);
  };

  const rerollSong = async (dancerId, songIdx) => {
    const key = `${dancerId}-${songIdx}`;
    setRerolling(prev => ({ ...prev, [key]: true }));
    try {
      const allAssigned = [];
      rotationList.forEach(id => {
        getSongs(id).forEach((n, i) => {
          if (id !== dancerId || i !== songIdx) allAssigned.push(n);
        });
      });
      const genres = djOptions?.activeGenres?.length > 0 ? djOptions.activeGenres : [];
      const token = localStorage.getItem('djbooth_token');
      const res = await fetch('/api/music/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ count: 1, excludeNames: [...new Set(allAssigned)], genres, dancerPlaylist: [] }),
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
      boothApi.sendCommand('updateSongAssignments', { assignments: songEdits });
    }
    boothApi.sendCommand('saveRotation', { rotation: rotationList });
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
      boothApi.sendCommand('updateInterstitialSongs', { interstitialSongs: updated });
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

  const handlePromoSubmit = async () => {
    if (!promoForm.event_name.trim()) return;
    setPromoSubmitting(true);
    setPromoStatus('Generating script...');
    try {
      const token = localStorage.getItem('djbooth_token');
      const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

      await fetch('/api/promo-requests', { method: 'POST', headers, body: JSON.stringify(promoForm) });

      const config = getApiConfig();
      const prompt = [
        `You are a professional strip club DJ creating a promo voiceover script.`,
        `Write a ${promoForm.length} promo with a ${promoForm.vibe.toLowerCase()} vibe.`,
        `Event/Promo: ${promoForm.event_name}`,
        promoForm.details ? `Details: ${promoForm.details}` : '',
        `Write the script as flowing spoken text — exactly what would be read over the mic.`,
        `No labels, brackets, or stage directions. Just the spoken words.`,
        `Use commas for breath pauses. Keep it punchy and club-appropriate.`,
      ].filter(Boolean).join('\n');

      let script = '';
      const openaiKey = config.openaiApiKey || '';
      const scriptModel = config.scriptModel || 'gpt-4.1';
      if (openaiKey && scriptModel !== 'auto') {
        const res = await fetch('/api/openai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: scriptModel, messages: [{ role: 'user', content: prompt }], temperature: 0.9, max_tokens: 300 }),
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`OpenAI ${res.status}`);
        const data = await res.json();
        const usage = data.usage;
        trackOpenAICall({ model: scriptModel, promptTokens: usage?.prompt_tokens || estimateTokens(prompt), completionTokens: usage?.completion_tokens || 0, context: `remote-promo-${promoForm.event_name}` });
        script = (data.choices?.[0]?.message?.content || '').replace(/^\d+[\.\)]\s*/gm, '').replace(/\n+/g, ' ').trim();
      }
      if (!script) script = `Ladies and gentlemen — ${promoForm.event_name}. Don't miss it.`;

      setPromoStatus('Recording voice...');
      const apiKey = config.elevenLabsApiKey || '';
      if (!apiKey) throw new Error('ElevenLabs key not configured');
      const voiceId = config.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM';
      const energyLvl = getCurrentEnergyLevel(config);
      const vs = VOICE_SETTINGS[energyLvl] || VOICE_SETTINGS[3];
      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { Accept: 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': apiKey },
        body: JSON.stringify({ text: script, model_id: 'eleven_multilingual_v2', voice_settings: { stability: vs.stability, similarity_boost: vs.similarity_boost, style: vs.style, speed: vs.speed, use_speaker_boost: vs.use_speaker_boost !== false } }),
        signal: AbortSignal.timeout(30000),
      });
      if (!ttsRes.ok) throw new Error(`ElevenLabs ${ttsRes.status}`);
      trackElevenLabsCall({ text: script, model: 'eleven_multilingual_v2', context: 'remote-promo-tts' });

      setPromoStatus('Saving...');
      const audioBlob = await ttsRes.blob();
      const audio_base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onloadend = () => res(reader.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(audioBlob);
      });
      const cacheKey = `promo-auto-${Date.now()}-${promoForm.event_name.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const saveRes = await fetch('/api/voiceovers', {
        method: 'POST',
        headers,
        body: JSON.stringify({ cache_key: cacheKey, audio_base64, script, type: 'promo', dancer_name: promoForm.event_name, energy_level: energyLvl }),
      });
      if (!saveRes.ok) throw new Error('Failed to save');

      setPromoStatus('Done!');
      setPromoForm({ event_name: '', details: '', vibe: 'Hype', length: '30s' });
      setTimeout(() => setPromoStatus(''), 3000);
    } catch (err) {
      setPromoStatus(`Error: ${err.message}`);
      setTimeout(() => setPromoStatus(''), 5000);
    } finally {
      setPromoSubmitting(false);
    }
  };

  return (
    <div className="h-[100dvh] bg-[#08081a] text-white flex flex-col overflow-hidden select-none">

      {/* ── HEADER ── */}
      <div className="flex items-center px-3 py-2 border-b border-[#151528] flex-shrink-0 gap-3 min-h-0">
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? (isPlaying ? 'bg-green-400 animate-pulse' : 'bg-yellow-400') : 'bg-red-500'}`} />
          <span className="text-sm text-gray-500">{isConnected ? (isPlaying ? 'Live' : 'Connected') : 'Offline'}</span>
        </div>

        {isRotationActive && currentDancer ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-black font-bold text-base flex-shrink-0" style={{ backgroundColor: currentDancer.color || '#00d4ff' }}>
              {currentDancer.name?.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-white truncate">{currentDancer.name}</span>
                <span className="text-base text-[#00d4ff] flex-shrink-0">{currentSongNumber}/{songsPerSet}</span>
              </div>
              {currentTrack && <div className="text-sm text-gray-500 truncate">{isPlaying ? '▶' : '⏸'} {stripExt(currentTrack)}</div>}
            </div>
            <div className="w-20 h-1 bg-[#1e293b] rounded-full flex-shrink-0 overflow-hidden">
              <div ref={progressRef} className="h-full bg-[#00d4ff] rounded-full" style={{ width: '0%', transition: 'none' }} />
            </div>
            <span ref={countdownRef} className="text-base font-mono text-[#00d4ff] tabular-nums flex-shrink-0 w-10 text-right" />
          </div>
        ) : (
          <div className="flex-1 text-base text-gray-600">{isConnected ? 'Rotation not active' : 'Connecting...'}</div>
        )}

        <button onClick={onLogout} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-gray-500 active:text-white active:bg-[#151528] flex-shrink-0">
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* ── TAB CONTENT ── */}
      <div className="flex-1 overflow-hidden min-h-0">

        {/* ─────────── LIVE TAB ─────────── */}
        {tab === 'live' && (
          <div className="h-full flex overflow-hidden">

            {/* LEFT: Playback Controls */}
            <div className="w-[340px] flex-shrink-0 flex flex-col gap-2 p-3 border-r border-[#151528] overflow-y-auto">

              {/* Now Playing card */}
              <div className="rounded-xl bg-[#0d0d1f] border border-[#1e293b] p-3 flex-shrink-0">
                {currentDancer ? (
                  <div className="flex items-center gap-2.5">
                    <div className="w-11 h-11 rounded-full flex items-center justify-center text-black font-bold text-xl flex-shrink-0" style={{ backgroundColor: currentDancer.color || '#00d4ff' }}>
                      {currentDancer.name?.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-lg font-bold text-white truncate">{currentDancer.name}</div>
                      <div className="text-base text-[#00d4ff]">Song {currentSongNumber} of {songsPerSet}</div>
                      {currentTrack && <div className="text-sm text-gray-500 truncate mt-0.5">{stripExt(currentTrack)}</div>}
                    </div>
                  </div>
                ) : (
                  <div className="text-lg text-gray-600 text-center py-1">{isRotationActive ? 'Loading...' : 'No active entertainer'}</div>
                )}
              </div>

              {/* Skip */}
              <button
                onClick={() => boothApi.sendCommand('skip')}
                className="h-14 rounded-xl bg-[#00d4ff] text-black font-bold text-xl flex items-center justify-center gap-2 active:opacity-80 flex-shrink-0"
              >
                <SkipForward className="w-6 h-6" />
                SKIP
              </button>

              {/* Start / Stop Rotation */}
              <button
                onClick={() => boothApi.sendCommand(isRotationActive ? 'stopRotation' : 'startRotation')}
                className={`h-14 rounded-xl border-2 flex items-center justify-center gap-2 font-bold text-xl active:opacity-80 flex-shrink-0 ${
                  isRotationActive
                    ? 'bg-red-500/15 border-red-500/50 text-red-400'
                    : 'bg-green-500/15 border-green-500/50 text-green-400'
                }`}
              >
                {isRotationActive ? <StopCircle className="w-6 h-6" /> : <PlayCircle className="w-6 h-6" />}
                {isRotationActive ? 'Stop Rotation' : 'Start Rotation'}
              </button>

              {/* Announce toggle */}
              <button
                onClick={() => boothApi.sendCommand('toggleAnnouncements')}
                className={`h-14 rounded-xl border flex items-center justify-center gap-2 font-semibold text-lg active:opacity-80 flex-shrink-0 ${
                  announcementsEnabled
                    ? 'bg-[#00d4ff]/15 border-[#00d4ff]/40 text-[#00d4ff]'
                    : 'bg-[#1e293b] border-[#2e2e5a] text-gray-500'
                }`}
              >
                {announcementsEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                {announcementsEnabled ? 'Voice On' : 'Voice Off'}
              </button>

              {/* Deactivate song */}
              {!showDeactivatePin ? (
                <button
                  onClick={() => { if (currentTrack) setShowDeactivatePin(true); }}
                  disabled={!currentTrack}
                  className="h-14 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center gap-2 text-red-400 text-lg font-semibold active:bg-red-500/20 disabled:opacity-30 flex-shrink-0"
                >
                  <Ban className="w-4 h-4" />
                  Deactivate Song
                </button>
              ) : (
                <div className="rounded-xl bg-[#0d0d1f] border border-red-500/30 p-3 flex-shrink-0">
                  <div className="text-sm text-red-400 mb-1">Enter DJ PIN to deactivate:</div>
                  <div className="text-xs text-gray-500 truncate mb-2">{stripExt(currentTrack)}</div>
                  <input
                    type="password"
                    value={deactivatePin}
                    onChange={e => setDeactivatePin(e.target.value.replace(/\D/g, ''))}
                    placeholder="PIN"
                    maxLength={10}
                    autoFocus
                    className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg px-2.5 py-2 text-lg text-center font-mono mb-2 focus:outline-none focus:border-red-500"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => { setShowDeactivatePin(false); setDeactivatePin(''); }} className="flex-1 h-9 rounded-lg bg-[#1e293b] text-gray-400 text-lg">Cancel</button>
                    <button
                      onClick={() => {
                        if (deactivatePin) {
                          boothApi.sendCommand('deactivateTrack', { pin: deactivatePin, trackName: currentTrack });
                          setShowDeactivatePin(false);
                          setDeactivatePin('');
                        }
                      }}
                      className="flex-1 h-9 rounded-lg bg-red-500 text-white text-lg font-bold"
                    >Deactivate</button>
                  </div>
                </div>
              )}

              {/* Music Volume */}
              <div className="rounded-xl bg-[#0d0d1f] border border-[#1e293b] p-3 flex-shrink-0">
                <div className="flex items-center gap-1.5 mb-2">
                  <Volume2 className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Music Volume</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => boothApi.sendCommand('setVolume', { volume: Math.max(0, currentVolume - 0.05) })} className="w-16 h-16 rounded-xl bg-[#1e293b] flex items-center justify-center active:bg-[#2e2e5a]"><Minus className="w-6 h-6" /></button>
                  <div className="flex-1 text-center font-bold text-2xl">{Math.round(currentVolume * 100)}%</div>
                  <button onClick={() => boothApi.sendCommand('setVolume', { volume: Math.min(1, currentVolume + 0.05) })} className="w-16 h-16 rounded-xl bg-[#1e293b] flex items-center justify-center active:bg-[#2e2e5a]"><Plus className="w-6 h-6" /></button>
                </div>
              </div>

              {/* Voice Volume */}
              <div className="rounded-xl bg-[#0d0d1f] border border-[#a855f7]/20 p-3 flex-shrink-0">
                <div className="flex items-center gap-1.5 mb-2">
                  <Mic className="w-3.5 h-3.5 text-[#a855f7]" />
                  <span className="text-xs text-[#a855f7] uppercase tracking-wider">Voice Volume</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => boothApi.sendCommand('setVoiceGain', { gain: Math.max(0.5, currentVoiceGain - 0.1) })} className="w-16 h-16 rounded-xl bg-[#1e293b] flex items-center justify-center active:bg-[#2e2e5a]"><Minus className="w-6 h-6" /></button>
                  <div className="flex-1 text-center font-bold text-2xl text-[#a855f7]">{Math.round(currentVoiceGain * 100)}%</div>
                  <button onClick={() => boothApi.sendCommand('setVoiceGain', { gain: Math.min(3, currentVoiceGain + 0.1) })} className="w-16 h-16 rounded-xl bg-[#1e293b] flex items-center justify-center active:bg-[#2e2e5a]"><Plus className="w-6 h-6" /></button>
                </div>
              </div>

              {/* Songs Per Set */}
              <div className="rounded-xl bg-[#0d0d1f] border border-[#1e293b] p-3 flex-shrink-0">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Songs Per Set</div>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button key={n} onClick={() => boothApi.sendCommand('setSongsPerSet', { count: n })}
                      className={`flex-1 h-13 rounded-xl font-bold text-lg ${n === songsPerSet ? 'bg-[#00d4ff] text-black' : 'bg-[#1e293b] text-gray-400 active:bg-[#2e2e5a]'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Break Songs Per Set */}
              <div className="rounded-xl bg-[#0d0d1f] border border-[#1e293b] p-3 flex-shrink-0">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Break Songs Per Set</div>
                <div className="flex gap-1.5">
                  {[0, 1, 2, 3].map(n => (
                    <button key={n} onClick={() => { setOptimisticBreak(n); boothApi.sendCommand('setBreakSongsPerSet', { count: n }); }}
                      className={`flex-1 h-13 rounded-xl font-bold text-lg ${n === breakSongsPerSet ? 'bg-violet-500 text-white' : 'bg-[#1e293b] text-gray-400 active:bg-[#2e2e5a]'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT: Rotation Order */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">

              {/* Rotation list */}
              <div className="flex-1 overflow-y-auto px-3 py-2">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                  Rotation — {rotationDancers.length} entertainer{rotationDancers.length !== 1 ? 's' : ''}
                </div>
                <div className="space-y-1.5">
                  {rotationDancers.length === 0 && (
                    <div className="text-center py-8 text-lg text-gray-600">No rotation active</div>
                  )}
                  {rotationDancers.map((dancer, idx) => {
                    const isOnStage = idx === currentDancerIndex && isRotationActive;
                    const dancerSongs = getSongs(dancer.id);
                    const upcomingSongs = isOnStage ? dancerSongs.slice(currentSongNumber) : dancerSongs;
                    const showVipPicker = vipPickerFor === dancer.id;
                    return (
                      <div key={dancer.id} className={`rounded-xl border ${isOnStage ? 'bg-[#00d4ff]/10 border-[#00d4ff]/40' : 'bg-[#0d0d1f] border-[#1e293b]'}`}>
                        <div className="flex items-center gap-2 p-3">
                          <div className={`text-base font-bold w-5 text-center flex-shrink-0 ${isOnStage ? 'text-[#00d4ff]' : 'text-gray-600'}`}>{isOnStage ? '▶' : idx + 1}</div>
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-black font-bold text-lg flex-shrink-0" style={{ backgroundColor: dancer.color || '#00d4ff' }}>
                            {dancer.name?.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-lg font-semibold ${isOnStage ? 'text-white' : 'text-gray-300'}`}>{dancer.name}</div>
                            {upcomingSongs.length > 0 && (
                              <div className="text-xs text-gray-500 truncate">{upcomingSongs.map(stripExt).join(' · ')}</div>
                            )}
                          </div>
                          <div className="flex gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => setVipPickerFor(showVipPicker ? null : dancer.id)}
                              className={`w-12 h-12 rounded-xl flex items-center justify-center ${showVipPicker ? 'bg-yellow-500/25 border border-yellow-500/50' : 'bg-yellow-500/10 border border-yellow-500/20'} active:bg-yellow-500/30`}>
                              <Crown className="w-5 h-5 text-yellow-400" />
                            </button>
                            <button onClick={() => boothApi.sendCommand('moveInRotation', { dancerId: dancer.id, direction: 'up' })} disabled={idx === 0}
                              className="w-12 h-12 rounded-xl bg-[#1e293b] flex items-center justify-center text-gray-400 active:bg-[#2e2e5a] disabled:opacity-20">
                              <ChevronUp className="w-5 h-5" />
                            </button>
                            <button onClick={() => boothApi.sendCommand('moveInRotation', { dancerId: dancer.id, direction: 'down' })} disabled={idx === rotationDancers.length - 1}
                              className="w-12 h-12 rounded-xl bg-[#1e293b] flex items-center justify-center text-gray-400 active:bg-[#2e2e5a] disabled:opacity-20">
                              <ChevronDown className="w-5 h-5" />
                            </button>
                            <button onClick={() => boothApi.sendCommand('removeDancerFromRotation', { dancerId: dancer.id })}
                              className="w-12 h-12 rounded-xl bg-red-500/15 flex items-center justify-center text-red-400 active:bg-red-500/25">
                              <X className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                        {showVipPicker && (
                          <div className="px-3 pb-3 flex items-center gap-2">
                            <span className="text-xs text-yellow-400 flex-shrink-0">VIP duration:</span>
                            {[{ label: '15m', ms: 15 * 60 * 1000 }, { label: '30m', ms: 30 * 60 * 1000 }, { label: '1h', ms: 60 * 60 * 1000 }].map(({ label, ms }) => (
                              <button key={label}
                                onClick={() => { boothApi.sendCommand('sendToVip', { dancerId: dancer.id, durationMs: ms }); setVipPickerFor(null); }}
                                className="flex-1 h-10 rounded-xl bg-yellow-500/15 border border-yellow-500/30 text-yellow-300 text-base font-bold active:bg-yellow-500/30">
                                {label}
                              </button>
                            ))}
                            <button onClick={() => setVipPickerFor(null)}
                              className="flex-1 h-10 rounded-xl bg-[#1e293b] text-gray-400 text-base active:bg-[#2e2e5a]">
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {Object.keys(dancerVipMap).length > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Crown className="w-3 h-3 text-yellow-400" />
                        <span className="text-xs text-yellow-400 uppercase tracking-wider">In VIP ({Object.keys(dancerVipMap).length})</span>
                      </div>
                      <div className="space-y-1.5">
                        {Object.entries(dancerVipMap).map(([dancerId, vipEntry]) => {
                          const vipDancer = dancers?.find(d => String(d.id) === String(dancerId));
                          if (!vipDancer) return null;
                          const msLeft = vipEntry.expiresAt ? Math.max(0, vipEntry.expiresAt - Date.now()) : 0;
                          const minsLeft = Math.floor(msLeft / 60000);
                          const secsLeft = Math.floor((msLeft % 60000) / 1000);
                          return (
                            <div key={dancerId} className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-yellow-500/30 bg-yellow-900/10">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-black font-bold text-lg flex-shrink-0" style={{ backgroundColor: vipDancer.color || '#00d4ff' }}>
                                {vipDancer.name?.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-base font-semibold text-white">{vipDancer.name}</div>
                                <div className="text-xs text-yellow-400">Returns in {minsLeft}:{String(secsLeft).padStart(2, '0')}</div>
                              </div>
                              <button
                                onClick={() => boothApi.sendCommand('releaseFromVip', { dancerId: vipDancer.id })}
                                className="px-3 h-10 rounded-xl bg-green-500/15 border border-green-500/30 text-green-400 text-sm font-semibold active:bg-green-500/25 flex-shrink-0">
                                Release
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Add to rotation */}
                {allActiveDancers.filter(d => !rotationList.includes(d.id)).length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs text-gray-600 uppercase tracking-wider mb-2">Add to Rotation</div>
                    <div className="space-y-1">
                      {allActiveDancers.filter(d => !rotationList.includes(d.id)).map(dancer => (
                        <button key={dancer.id} onClick={() => boothApi.sendCommand('addDancerToRotation', { dancerId: dancer.id })}
                          className="w-full flex items-center gap-2.5 px-3 py-4 rounded-xl bg-[#0d0d1f] border border-[#1e293b] active:bg-[#1e293b]">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-black font-bold text-base flex-shrink-0" style={{ backgroundColor: dancer.color || '#00d4ff' }}>
                            {dancer.name?.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-lg text-gray-300 flex-1 text-left">{dancer.name}</span>
                          <Plus className="w-4 h-4 text-[#00d4ff]" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─────────── ROTATION TAB ─────────── */}
        {tab === 'rotation' && (
          <div className="h-full flex flex-col overflow-hidden">
            <div className="flex-shrink-0 flex items-center gap-3 px-3 py-2 border-b border-[#151528]">
              <span className="text-base text-gray-500 flex-1">{hasUnsaved ? '● Unsaved changes' : 'Tap a dancer to manage songs'}</span>
              <button
                onClick={handleSaveAll}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-lg font-bold ${hasUnsaved ? 'bg-green-500 text-black animate-pulse' : 'bg-[#00d4ff] text-black'}`}
              >
                <Save className="w-4 h-4" />
                Save All
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
              {rotationDancers.length === 0 && (
                <div className="text-center py-12 text-lg text-gray-600">No rotation active. Add entertainers from the Live tab.</div>
              )}

              {rotationDancers.map((dancer, idx) => {
                const isOnStage = idx === currentDancerIndex && isRotationActive;
                const songs = getSongs(dancer.id);
                const isExpanded = expandedDancer === dancer.id;
                const breakKey = String(idx + 1);
                const breakSlots = Array.from({ length: breakSongsPerSet }).map((_, i) => (interstitialSongs[breakKey] || [])[i] || '');

                return (
                  <div key={dancer.id} className={`rounded-xl border ${isOnStage ? 'border-[#00d4ff]/50 bg-[#00d4ff]/5' : 'border-[#1e293b] bg-[#0d0d1f]'}`}>
                    <button className="w-full flex items-center gap-2.5 px-3 py-3" onClick={() => setExpandedDancer(isExpanded ? null : dancer.id)}>
                      <div className={`text-base font-bold w-5 text-center flex-shrink-0 ${isOnStage ? 'text-[#00d4ff]' : 'text-gray-600'}`}>{isOnStage ? '▶' : idx + 1}</div>
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-black font-bold flex-shrink-0" style={{ backgroundColor: dancer.color || '#00d4ff' }}>
                        {dancer.name?.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <div className="text-lg font-semibold text-white">{dancer.name}</div>
                        <div className="text-sm text-gray-500">{songs.length} song{songs.length !== 1 ? 's' : ''} assigned{breakSongsPerSet > 0 ? ` · ${breakSongsPerSet} break slot${breakSongsPerSet !== 1 ? 's' : ''}` : ''}</div>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    {breakSongsPerSet > 0 && (
                      <div className="px-3 pb-2 border-t border-violet-500/20">
                        <div className="pt-2 space-y-1">
                          {breakSlots.map((slot, i) => (
                            <button
                              key={i}
                              onClick={() => { setAssigningBreak({ breakKey, index: i }); setTab('library'); }}
                              className="w-full flex items-center gap-2 px-2.5 py-3.5 rounded-lg border border-violet-500/25 bg-violet-900/10 active:bg-violet-500/20 active:border-violet-500/50"
                            >
                              <span className="text-xs font-bold text-violet-400 w-5 flex-shrink-0">B{i + 1}</span>
                              <span className="text-base flex-1 text-left truncate">
                                {slot ? <span className="text-gray-200">{stripExt(slot)}</span> : <span className="text-gray-600 italic">Tap to pick break song</span>}
                              </span>
                              <Music className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-[#1e293b]">
                        <div className="pt-2 space-y-1.5">
                          {songs.length === 0 && (
                            <div className="text-base text-gray-600 text-center py-2">No songs — system auto-picks at stage time</div>
                          )}
                          {songs.map((song, songIdx) => {
                            const isNowPlaying = isOnStage && songIdx === (currentSongNumber - 1);
                            const rerollKey = `${dancer.id}-${songIdx}`;
                            const isRerolling = rerolling[rerollKey];
                            return (
                              <div key={songIdx} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border ${isNowPlaying ? 'bg-[#00d4ff]/10 border-[#00d4ff]/30' : 'bg-[#08081a] border-[#1e293b]'}`}>
                                <span className={`text-base font-bold w-4 flex-shrink-0 ${isNowPlaying ? 'text-[#00d4ff]' : 'text-gray-600'}`}>{isNowPlaying ? '▶' : songIdx + 1}</span>
                                <span className={`text-base flex-1 truncate ${isOnCooldown(song) ? 'text-orange-300' : 'text-gray-300'}`}>{stripExt(song)}</span>
                                {!isNowPlaying && (
                                  <>
                                    <button onClick={() => rerollSong(dancer.id, songIdx)} disabled={isRerolling}
                                      className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-400 active:bg-amber-500/25 disabled:opacity-40 flex-shrink-0">
                                      {isRerolling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Shuffle className="w-3.5 h-3.5" />}
                                    </button>
                                    <button onClick={() => removeSong(dancer.id, songIdx)}
                                      className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 active:bg-red-500/20 flex-shrink-0">
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            );
                          })}

                          <button onClick={() => { setAssigningTo(dancer.id); setTab('library'); }}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-[#2e2e5a] text-[#00d4ff] text-base active:bg-[#00d4ff]/10">
                            <Plus className="w-3.5 h-3.5" />
                            Add Song from Library
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─────────── LIBRARY TAB ─────────── */}
        {tab === 'library' && (
          <div className="h-full flex flex-col overflow-hidden">
            {(assigningTo || assigningBreak) && (
              <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-[#00d4ff]/10 border-b border-[#00d4ff]/30">
                <div className="w-2 h-2 rounded-full bg-[#00d4ff] animate-pulse flex-shrink-0" />
                <span className="text-lg text-[#00d4ff] flex-1">
                  {assigningBreak
                    ? `Tap a track for break slot B${assigningBreak.index + 1}`
                    : `Tap a track to add to ${dancers?.find(d => d.id === assigningTo)?.name || 'entertainer'}`}
                </span>
                <button onClick={() => { setAssigningTo(null); setAssigningBreak(null); setTab('rotation'); }}
                  className="text-base text-gray-400 px-2 py-1 rounded-lg active:bg-[#1e293b]">Cancel</button>
              </div>
            )}

            <div className="flex-shrink-0 flex gap-2 px-3 py-2 border-b border-[#151528]">
              <div className="flex-1 flex items-center gap-2 bg-[#0d0d1f] border border-[#1e293b] rounded-xl px-3">
                <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <input value={libSearch} onChange={e => setLibSearch(e.target.value)} placeholder="Search tracks..."
                  className="flex-1 bg-transparent text-lg text-white py-2.5 focus:outline-none placeholder-gray-600" />
                {libSearch && <button onClick={() => setLibSearch('')} className="text-gray-500 flex-shrink-0"><X className="w-4 h-4" /></button>}
              </div>
              <select value={libGenre} onChange={e => setLibGenre(e.target.value)}
                className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl px-3 py-2 text-lg text-white appearance-none focus:outline-none focus:border-[#00d4ff] min-w-[130px]">
                <option value="">All Folders</option>
                {libGenres.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
              </select>
            </div>

            <div className="flex-shrink-0 px-3 py-1.5 flex items-center justify-between">
              <span className="text-base text-gray-600">{libTotal.toLocaleString()} tracks</span>
              {(assigningTo || assigningBreak) && <span className="text-base text-[#00d4ff]">Tap to assign →</span>}
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-2">
              {libLoading && libTracks.length === 0 ? (
                <div className="text-center py-12 text-lg text-gray-600">Loading...</div>
              ) : (
                <div className="space-y-1">
                  {libTracks.map(track => (
                    <button key={track.name}
                      onClick={() => { if (assigningTo || assigningBreak) handleAssignTrack(track.name); }}
                      className={`w-full flex items-center gap-3 px-3 py-4 rounded-xl text-left border border-[#1e293b] bg-[#0d0d1f] ${(assigningTo || assigningBreak) ? 'active:bg-[#00d4ff]/10 active:border-[#00d4ff]/40' : 'cursor-default'}`}>
                      <Music className="w-4 h-4 text-gray-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-lg text-white truncate">{stripExt(track.name)}</div>
                        {track.genre && <div className="text-xs text-gray-600">{track.genre}</div>}
                      </div>
                      {(assigningTo || assigningBreak) && <Plus className="w-4 h-4 text-[#00d4ff] flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─────────── PROMOS TAB ─────────── */}
        {tab === 'promos' && (
          <div className="h-full flex gap-3 p-3 overflow-hidden">

            {/* LEFT: Commercial Request */}
            <div className="flex-1 flex flex-col bg-[#0d0d1f] rounded-xl border border-violet-500/30 overflow-hidden">
              <div className="px-4 pt-3 pb-2 flex-shrink-0 border-b border-[#1e293b]">
                <div className="text-base font-bold text-violet-300 uppercase tracking-wider">Make a Commercial</div>
                <div className="text-xs text-gray-600 mt-0.5">AI writes the script and records the voice</div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">

                {/* Event / Promo Name */}
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1.5">What's the commercial for? *</label>
                  <input
                    value={promoForm.event_name}
                    onChange={e => setPromoForm(f => ({ ...f, event_name: e.target.value }))}
                    placeholder="e.g. Ladies Night, VIP Table Special, Saturday Night..."
                    className="w-full bg-[#08081a] border border-[#1e293b] rounded-xl px-4 py-3 text-base text-white placeholder-gray-700 focus:outline-none focus:border-violet-500"
                  />
                </div>

                {/* Details */}
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1.5">Details (optional)</label>
                  <textarea
                    value={promoForm.details}
                    onChange={e => setPromoForm(f => ({ ...f, details: e.target.value }))}
                    placeholder="Any specifics — time, price, offer, who it's for..."
                    rows={3}
                    className="w-full bg-[#08081a] border border-[#1e293b] rounded-xl px-4 py-3 text-base text-white placeholder-gray-700 focus:outline-none focus:border-violet-500 resize-none"
                  />
                </div>

                {/* Vibe */}
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1.5">Vibe</label>
                  <div className="flex flex-wrap gap-2">
                    {VIBE_OPTIONS.map(v => (
                      <button key={v} onClick={() => setPromoForm(f => ({ ...f, vibe: v }))}
                        className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${promoForm.vibe === v ? 'bg-violet-500 border-violet-500 text-white' : 'bg-[#08081a] border-[#1e293b] text-gray-400 active:border-violet-500/50'}`}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Length */}
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1.5">Length</label>
                  <div className="flex gap-2">
                    {LENGTH_OPTIONS.map(l => (
                      <button key={l} onClick={() => setPromoForm(f => ({ ...f, length: l }))}
                        className={`flex-1 py-2.5 rounded-xl text-base font-bold border transition-colors ${promoForm.length === l ? 'bg-violet-500 border-violet-500 text-white' : 'bg-[#08081a] border-[#1e293b] text-gray-400 active:border-violet-500/50'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Status */}
                {promoStatus && (
                  <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-base font-semibold ${promoStatus.startsWith('Error') ? 'bg-red-500/15 text-red-400 border border-red-500/30' : promoStatus === 'Done!' ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-violet-500/15 text-violet-300 border border-violet-500/30'}`}>
                    {promoSubmitting && <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />}
                    {promoStatus}
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={handlePromoSubmit}
                  disabled={promoSubmitting || !promoForm.event_name.trim()}
                  className="w-full h-14 rounded-xl bg-violet-500 text-white font-bold text-lg flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-40"
                >
                  {promoSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  {promoSubmitting ? promoStatus || 'Working...' : 'Generate Commercial'}
                </button>
              </div>
            </div>

            {/* RIGHT: Queue + Settings */}
            <div className="flex-1 flex flex-col gap-3 overflow-hidden">

              {/* Promo Queue */}
              <div className="flex-1 flex flex-col bg-[#0d0d1f] rounded-xl border border-[#1e293b] overflow-hidden">
                <div className="px-3 pt-3 pb-2 flex-shrink-0 border-b border-[#1e293b]">
                  <div className="text-base font-semibold text-gray-300 uppercase tracking-wider">Promo Queue</div>
                  <div className="text-xs text-gray-600 mt-0.5">Plays between entertainer sets</div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {promoQueue.length === 0 ? (
                    <div className="text-center py-8 text-lg text-gray-600">No promos queued</div>
                  ) : promoQueue.map((promo, idx) => {
                    const promoId = promo?.cache_key || promo?.id || String(idx);
                    const promoName = promo?.dancer_name || promo?.cache_key?.replace(/^promo_/, '').replace(/_/g, ' ') || 'Promo';
                    const isSkipped = skippedCommercials.has(promoId);
                    return (
                      <div key={promoId} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-[#1e293b] bg-[#08081a] ${isSkipped ? 'opacity-40' : ''}`}>
                        <Radio className="w-4 h-4 text-violet-400 flex-shrink-0" />
                        <span className="text-base text-white flex-1 truncate capitalize">{promoName}</span>
                        <button onClick={() => boothApi.sendCommand('swapPromo', { slotIndex: idx })}
                          className="px-2.5 py-1.5 rounded-lg text-sm bg-[#1e293b] text-gray-400 active:bg-[#2e2e5a]">Swap</button>
                        <button
                          onClick={() => { boothApi.sendCommand('skipCommercial', { commercialId: promoId }); setLocalSkipped(prev => new Set([...prev, promoId])); }}
                          disabled={isSkipped}
                          className="px-2.5 py-1.5 rounded-lg text-sm bg-red-500/15 text-red-400 border border-red-500/30 active:bg-red-500/25 disabled:opacity-30">Skip</button>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ─────────── ANNOUNCE TAB ─────────── */}
        {tab === 'announce' && (
          <div className="h-full p-3 overflow-hidden">
            <HouseAnnouncementPanel
              isRemote={true}
              onRemotePlay={(cacheKey) => boothApi.sendCommand('playHouseAnnouncement', { cacheKey })}
            />
          </div>
        )}

        {/* ─────────── SOUNDS TAB ─────────── */}
        {tab === 'sounds' && (
          <div className="h-full overflow-y-auto px-3 py-3 space-y-4">

            {/* Boost selector */}
            <div className="flex-shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-gray-500 uppercase tracking-wider flex-1">SFX Level — matches Voice Volume × boost</span>
              </div>
              <div className="flex gap-2">
                {[{ label: '1×', val: 1.0 }, { label: '1.5×', val: 1.5 }, { label: '2×', val: 2.0 }].map(({ label, val }) => (
                  <button key={val} onClick={() => setSoundBoost(val)}
                    className={`flex-1 h-11 rounded-xl font-bold text-base ${soundBoost === val ? 'bg-[#00d4ff] text-black' : 'bg-[#1e293b] text-gray-400 active:bg-[#2e2e5a]'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Classic FX */}
            <div>
              <div className="text-xs text-[#00d4ff] uppercase tracking-wider mb-2">Classic FX</div>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { id: 'airhorn',   emoji: '📯', label: 'Air Horn'   },
                  { id: 'scratch',   emoji: '💿', label: 'Scratch'    },
                  { id: 'rewind',    emoji: '⏪', label: 'Rewind'     },
                  { id: 'bassdrop',  emoji: '💥', label: 'Bass Drop'  },
                  { id: 'foghorn',   emoji: '🚢', label: 'Foghorn'    },
                  { id: 'vinylstop', emoji: '⏹', label: 'Vinyl Stop' },
                  { id: 'siren',     emoji: '🚨', label: 'Siren'      },
                  { id: 'woo',       emoji: '👑', label: 'Woo!'       },
                  { id: 'crowdcheer',emoji: '📢', label: 'Crowd'      },
                  { id: 'laser',     emoji: '⚡', label: 'Laser'      },
                ].map(({ id, emoji, label }) => (
                  <button key={id}
                    onPointerDown={() => boothApi.sendCommand('playSound', { soundId: id, gain: currentVoiceGain * soundBoost })}
                    className="flex flex-col items-center justify-center gap-1 h-20 rounded-2xl bg-[#0d0d1f] border border-[#00d4ff]/20 active:bg-[#00d4ff]/15 active:border-[#00d4ff]/60 active:scale-95 transition-transform select-none">
                    <span className="text-2xl leading-none">{emoji}</span>
                    <span className="text-xs text-gray-400 leading-tight text-center">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Viral Bites */}
            <div>
              <div className="text-xs text-[#a855f7] uppercase tracking-wider mb-2">Viral Bites</div>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { id: 'bruh',         emoji: '😐', label: 'Bruh'       },
                  { id: 'vineboom',     emoji: '💣', label: 'Vine Boom'  },
                  { id: 'johncena',     emoji: '🎺', label: 'John Cena'  },
                  { id: 'ohyeah',       emoji: '😎', label: 'Oh Yeah'    },
                  { id: 'sadtrombone',  emoji: '😢', label: 'Sad Bone'   },
                  { id: 'getout',       emoji: '🚪', label: 'Get Out!'   },
                  { id: 'boomshakalaka',emoji: '🏀', label: 'Boomshaka'  },
                  { id: 'mlghorn',      emoji: '🎮', label: 'MLG Horn'   },
                  { id: 'spongebob',    emoji: '🧽', label: 'SpongeBob'  },
                  { id: 'itslit',       emoji: '🔥', label: "It's Lit"   },
                ].map(({ id, emoji, label }) => (
                  <button key={id}
                    onPointerDown={() => boothApi.sendCommand('playSound', { soundId: id, gain: currentVoiceGain * soundBoost })}
                    className="flex flex-col items-center justify-center gap-1 h-20 rounded-2xl bg-[#0d0d1f] border border-[#a855f7]/20 active:bg-[#a855f7]/15 active:border-[#a855f7]/60 active:scale-95 transition-transform select-none">
                    <span className="text-2xl leading-none">{emoji}</span>
                    <span className="text-xs text-gray-400 leading-tight text-center">{label}</span>
                  </button>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ─────────── OPTIONS TAB ─────────── */}
        {tab === 'options' && (
          <div className="h-full overflow-y-auto p-3">
            <DJOptions
              djOptions={djOptions}
              onOptionsChange={onOptionsChange}
              onCommercialFreqChange={(freq) => boothApi.sendCommand('setCommercialFreq', { freq })}
              externalCommercialFreq={liveBoothState?.commercialFreq}
            />
          </div>
        )}
      </div>

      {/* ── BOTTOM NAV ── */}
      <div className="flex-shrink-0 flex items-stretch border-t border-[#151528] bg-[#080818]">
        {[
          { id: 'live', icon: Zap, label: 'Live' },
          { id: 'rotation', icon: Users, label: 'Rotation' },
          { id: 'promos', icon: Radio, label: 'Promos' },
          { id: 'announce', icon: Megaphone, label: 'Announce' },
          { id: 'sounds', icon: Drum, label: 'SFX' },
          { id: 'options', icon: SlidersHorizontal, label: 'Options' },
        ].map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => { setTab(id); if (id !== 'library') { setAssigningTo(null); setAssigningBreak(null); } }}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-4 relative transition-colors ${tab === id ? 'text-[#00d4ff]' : 'text-gray-600 active:text-gray-400'}`}
          >
            {tab === id && <div className="absolute top-0 inset-x-0 h-0.5 bg-[#00d4ff] rounded-b" />}
            <Icon className="w-6 h-6" />
            <span className="text-sm font-medium">{label}</span>
            {id === 'rotation' && hasUnsaved && (
              <div className="absolute top-1.5 right-1/4 w-1.5 h-1.5 rounded-full bg-green-400" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
