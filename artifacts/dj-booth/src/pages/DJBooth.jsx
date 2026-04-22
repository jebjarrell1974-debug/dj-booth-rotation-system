import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { localEntities } from '@/api/localEntities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { createPageUrl } from '@/utils';
import { playSoundboardEffect } from '@/utils/soundboard';
import { getApiConfig, saveApiConfig, loadApiConfig } from '@/components/apiConfig';
import { toast } from 'sonner';
import { 
  Music2, 
  Users, 
  Radio,
  Layers,
  Mic,
  MicOff,
  AlertCircle,
  Key,
  Play,
  SkipForward,
  Volume2,
  Check,
  Wifi,
  Plus,
  Minus,
  X,
  SlidersHorizontal,
  HelpCircle,
  Ban,
  Drum
} from 'lucide-react';
import AudioEngine from '@/components/dj/AudioEngine';
import MusicLibrary from '@/components/dj/MusicLibrary';
import { isRemoteMode, boothApi, connectBoothSSE, djOptionsApi } from '@/api/serverApi';
import NowPlaying from '@/components/dj/NowPlaying';
import DancerRoster from '@/components/dj/DancerRoster';
import StageRotation from '@/components/dj/StageRotation';
import PlaylistEditor from '@/components/dj/PlaylistEditor';
import AnnouncementSystem from '@/components/dj/AnnouncementSystem';
import RotationPlaylistManager from '@/components/dj/RotationPlaylistManager';
import HouseAnnouncementPanel from '@/components/dj/HouseAnnouncementPanel';
import ManualAnnouncementPlayer from '@/components/dj/ManualAnnouncementPlayer';
import RemoteView from '@/components/dj/RemoteView';
import DJOptions from '@/components/dj/DJOptions';
import CustomSoundboard from '@/components/dj/CustomSoundboard';

const DEFAULT_SONGS_PER_SET = 2;

function auditEvent(action, details) {
  const token = localStorage.getItem('djbooth_token');
  if (!token) return;
  fetch('/api/audit/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, details: details || undefined }),
  }).catch(() => {});
}

function isDayShiftActive(dayShift) {
  if (!dayShift?.enabled || !dayShift?.startTime || !dayShift?.endTime) return false;
  const now = new Date();
  const [startH, startM] = dayShift.startTime.split(':').map(Number);
  const [endH, endM] = dayShift.endTime.split(':').map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = startH * 60 + startM;
  const endMins = endH * 60 + endM;
  if (startMins <= endMins) {
    return nowMins >= startMins && nowMins < endMins;
  }
  return nowMins >= startMins || nowMins < endMins;
}

export default function DJBooth() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const audioEngineRef = useRef(null);
  const remoteMode = isRemoteMode();
  
  // Music tracks state (loaded from server)
  const [tracks, setTracks] = useState([]);
  
  const [isHomebase, setIsHomebase] = useState(false);
  useEffect(() => {
    fetch('/api/config/capabilities')
      .then(r => r.json())
      .then(data => setIsHomebase(data.isHomebase || false))
      .catch(() => {});
  }, []);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const currentTrackRef = useRef(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const lastTimeStampRef = useRef(performance.now());
  const isPlayingRef = useRef(false);
  const timeDisplayRef = useRef(null);
  const remoteTimeDisplayRef = useRef(null);
  const [volume, setVolume] = useState(0.8);
  const [voiceGain, setVoiceGain] = useState(() => {
    try { return parseFloat(localStorage.getItem('djbooth_voice_gain')) || 1.5; } catch { return 1.5; }
  });
  const updateThrottleRef = useRef(0);
  
  // Rotation state
  const [rotation, setRotation] = useState([]);
  const [currentDancerIndex, setCurrentDancerIndex] = useState(0);

  // In VIP state — dancers temporarily removed from rotation
  const [dancerVipMap, setDancerVipMap] = useState(() => {
    try {
      const raw = localStorage.getItem('neonaidj_vip_map');
      if (raw) {
        const parsed = JSON.parse(raw);
        const now = Date.now();
        return Object.fromEntries(Object.entries(parsed).filter(([, v]) => !v.expiresAt || v.expiresAt > now));
      }
    } catch {}
    return {};
  });
  const dancerVipMapRef = useRef({});
  const pendingVipRef = useRef((() => { try { const r = localStorage.getItem('neonaidj_pending_vip'); return r ? JSON.parse(r) : {}; } catch { return {}; } })());
  const [pendingVipState, setPendingVipState] = useState(() => { try { const r = localStorage.getItem('neonaidj_pending_vip'); return r ? JSON.parse(r) : {}; } catch { return {}; } });
  const [currentSongNumber, setCurrentSongNumber] = useState(1);
  const [isRotationActive, setIsRotationActive] = useState(false);
  const isRotationActiveRef = useRef(false);
  const tracksRef = useRef([]);
  const [autoplayQueue, setAutoplayQueue] = useState([]);
  const autoplayQueueRef = useRef([]);
  const autoplayFillInFlightRef = useRef(false);
  const autoplayPlayingRef = useRef(false);
  const autoplayFillVersionRef = useRef(0);
  const [rotationSongs, setRotationSongs] = useState(() => {
    try {
      const saved = localStorage.getItem('djbooth_rotation_songs');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const currentDancerIndexRef = useRef(0);
  const currentSongNumberRef = useRef(1);
  const rotationSongsRef = useRef(rotationSongs);
  const djSavedSongsRef = useRef({});
  const [songsPerSet, setSongsPerSet] = useState(DEFAULT_SONGS_PER_SET);
  const songsPerSetRef = useRef(DEFAULT_SONGS_PER_SET);
  const [breakSongsPerSet, setBreakSongsPerSet] = useState(0);
  const breakSongsPerSetRef = useRef(0);
  const [djOptions, setDjOptions] = useState({ activeGenres: [], musicMode: 'dancer_first' });
  const djOptionsRef = useRef({ activeGenres: [], musicMode: 'dancer_first' });
  useEffect(() => {
    try {
      localStorage.setItem('djbooth_rotation_songs', JSON.stringify(rotationSongs));
    } catch {}
  }, [rotationSongs]);

  const rotationRef = useRef([]);
  const dancersRef = useRef([]);
  const transitionInProgressRef = useRef(false);
  const transitionStartTimeRef = useRef(0);
  const lastAudioActivityRef = useRef(Date.now());
  const playbackExpectedRef = useRef(false);
  const watchdogRecoveringRef = useRef(false);
  const diagLogRef = useRef([]);
  const prePickHitsRef = useRef(0);
  const prePickMissesRef = useRef(0);
  const lastTransitionMsRef = useRef(null);
  const lastWatchdogRef = useRef(null);
  const bgPrePickRef = useRef(null);
  const rotationPendingRef = useRef(false);
  const [rotationPending, setRotationPending] = useState(false);
  const [preCachingForStart, setPreCachingForStart] = useState(false);
  const [preCacheStartProgress, setPreCacheStartProgress] = useState({ completed: 0, total: 0, dancersDone: 0, dancersTotal: 0, phase: 'buffer' });
  const interstitialSongsRef = useRef((() => {
    try {
      const saved = localStorage.getItem('djbooth_interstitial_songs');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  })());
  const [interstitialSongsState, setInterstitialSongsState] = useState(() => interstitialSongsRef.current);
  const [interstitialRemoteVersion, setInterstitialRemoteVersion] = useState(0);
  const [plannedSongAssignments, setPlannedSongAssignments] = useState({});
  const playingInterstitialRef = useRef(false);
  const playingInterstitialBreakKeyRef = useRef(null);
  const interstitialIndexRef = useRef(0);
  const [activeBreakInfo, setActiveBreakInfo] = useState(null);
  const handleSkipRef = useRef(null);
  const beginRotationRef = useRef(null);
  const stopRotationRef = useRef(null);
  const saveRotationRef = useRef(null);
  const commercialCounterRef = useRef(0);
  const playingCommercialRef = useRef(false);
  const commercialEndResolverRef = useRef(null);
  const commercialModeRef = useRef(null);
  const promoShuffleRef = useRef([]);
  const promoQueueFingerprintRef = useRef('');
  const [availablePromos, setAvailablePromos] = useState([]);
  const [promoQueue, setPromoQueue] = useState([]);
  const swapPromoRef = useRef(null);
  const sendDancerToVipRef = useRef(null);
  const releaseDancerFromVipRef = useRef(null);
  const soundboardCtxRef = useRef(null);
  
  const DUCK_SETTLE_MS = 300;
  const SONG_OVERLAP_DELAY_MS = 2000;
  const waitForDuck = () => {
    lastAudioActivityRef.current = Date.now();
    return new Promise(r => setTimeout(() => {
      lastAudioActivityRef.current = Date.now();
      r();
    }, DUCK_SETTLE_MS));
  };

  const logDiag = (type, data = {}) => {
    const entry = { ts: Date.now(), type, ...data };
    diagLogRef.current = [entry, ...diagLogRef.current].slice(0, 20);
    try { localStorage.setItem('djbooth_diag_log', JSON.stringify(diagLogRef.current)); } catch {}
  };
  
  const fisherYatesShuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const COOLDOWN_MS = 4 * 60 * 60 * 1000;
  const songCooldownRef = useRef(null);
  const [playedSongsMap, setPlayedSongsMap] = useState({});

  useEffect(() => {
    if (songCooldownRef.current !== null) return;
    const loadCooldowns = async () => {
      let cooldowns = {};
      try {
        const raw = localStorage.getItem('djbooth_song_cooldowns');
        if (raw) {
          const parsed = JSON.parse(raw);
          const now = Date.now();
          for (const [k, v] of Object.entries(parsed)) {
            if (now - v < COOLDOWN_MS) cooldowns[k] = v;
          }
        }
      } catch {}
      try {
        const token = localStorage.getItem('djbooth_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch('/api/history/cooldowns?hours=6', { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.cooldowns) {
            const now = Date.now();
            for (const [k, v] of Object.entries(data.cooldowns)) {
              if (now - v < COOLDOWN_MS) {
                if (!cooldowns[k] || v > cooldowns[k]) {
                  cooldowns[k] = v;
                }
              }
            }
            console.log(`🎵 Loaded ${Object.keys(data.cooldowns).length} song cooldowns from server`);
          }
        }
      } catch (err) {
        console.warn('⚠️ Failed to load server cooldowns:', err.message);
      }
      songCooldownRef.current = cooldowns;
      setPlayedSongsMap({ ...cooldowns });
      try {
        localStorage.setItem('djbooth_song_cooldowns', JSON.stringify(cooldowns));
      } catch {}
    };
    loadCooldowns();
  }, []);

  const recordSongPlayed = useCallback((trackName, dancerName = null, genre = null) => {
    if (!trackName || !songCooldownRef.current) return;
    if (playingCommercialRef.current) return;
    songCooldownRef.current[trackName] = Date.now();
    setPlayedSongsMap(prev => ({ ...prev, [trackName]: Date.now() }));
    try {
      localStorage.setItem('djbooth_song_cooldowns', JSON.stringify(songCooldownRef.current));
    } catch {}
    let resolvedDancer = dancerName;
    if (!resolvedDancer && isRotationActiveRef.current && rotationRef.current.length > 0) {
      const dancerId = rotationRef.current[currentDancerIndexRef.current];
      if (dancerId) {
        const dancer = dancersRef.current.find(d => d.id === dancerId);
        if (dancer) resolvedDancer = dancer.name;
      }
    }
    const token = localStorage.getItem('djbooth_token');
    if (token) {
      fetch('/api/history/played', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ trackName, dancerName: resolvedDancer, genre })
      }).catch(() => {});
    }
  }, []);

  const filterCooldown = useCallback((trackList) => {
    if (!trackList || trackList.length === 0) return trackList;
    if (!songCooldownRef.current) return trackList;
    const now = Date.now();
    const available = trackList.filter(t => {
      const lastPlayed = songCooldownRef.current[t.name];
      return !lastPlayed || (now - lastPlayed) >= COOLDOWN_MS;
    });
    if (available.length > 0) return available;
    const sorted = fisherYatesShuffle(trackList);
    sorted.sort((a, b) => {
      const aTime = songCooldownRef.current[a.name] || 0;
      const bTime = songCooldownRef.current[b.name] || 0;
      return aTime - bTime;
    });
    return sorted;
  }, []);

  const filterByActiveGenres = useCallback((trackList) => {
    const opts = djOptionsRef.current;
    if (!opts?.activeGenres || opts.activeGenres.length === 0) return trackList;
    const filtered = trackList.filter(t => opts.activeGenres.includes(t.genre));
    return filtered.length > 0 ? filtered : trackList;
  }, []);

  const wakeLockRef = useRef(null);
  const audioContextRef = useRef(null);
  const silentSourceRef = useRef(null);

  useEffect(() => {
    if (remoteMode) return;

    const acquireWakeLock = async () => {
      try {
        if (!('wakeLock' in navigator)) return;
        if (wakeLockRef.current) return;
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('🔒 Wake Lock acquired — screen will stay on');
        wakeLockRef.current.addEventListener('release', () => {
          console.log('🔓 Wake Lock released');
          wakeLockRef.current = null;
          if (document.visibilityState === 'visible' && playbackExpectedRef.current) {
            setTimeout(acquireWakeLock, 1000);
          }
        });
      } catch (err) {
        console.log('⚠️ Wake Lock not available:', err.message);
        wakeLockRef.current = null;
      }
    };

    const startSilentAudio = () => {
      try {
        if (audioContextRef.current) return;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = ctx;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start();
        silentSourceRef.current = { oscillator, gain };
        console.log('🔇 Silent audio context started — prevents Chromium media suspension');
      } catch (err) {
        console.log('⚠️ Silent audio context failed:', err.message);
      }
    };

    const resumeAudioContext = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        acquireWakeLock();
        resumeAudioContext();
        if (isPlayingRef.current && audioEngineRef.current && !watchdogRecoveringRef.current && !transitionInProgressRef.current) {
          console.log('👁️ Page visible — resuming audio context');
          lastAudioActivityRef.current = Date.now();
        }
      }
    };

    const handleUserGesture = () => {
      startSilentAudio();
      resumeAudioContext();
      acquireWakeLock();
      document.removeEventListener('click', handleUserGesture);
      document.removeEventListener('touchstart', handleUserGesture);
    };

    acquireWakeLock();
    startSilentAudio();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('click', handleUserGesture);
    document.addEventListener('touchstart', handleUserGesture);

    const keepAliveInterval = setInterval(() => {
      resumeAudioContext();
      if (isPlayingRef.current && audioEngineRef.current && !watchdogRecoveringRef.current && !transitionInProgressRef.current) {
        lastAudioActivityRef.current = Date.now();
      }
    }, 15000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('click', handleUserGesture);
      document.removeEventListener('touchstart', handleUserGesture);
      clearInterval(keepAliveInterval);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      if (silentSourceRef.current) {
        try { silentSourceRef.current.oscillator.stop(); } catch {}
      }
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch {}
      }
    };
  }, [remoteMode]);

  // UI state
  const [selectedDancer, setSelectedDancer] = useState(null);
  const [editingPlaylist, setEditingPlaylist] = useState(null);
  const [activeTab, setActiveTab] = useState('rotation');
  const [sfxBoost, setSfxBoost] = useState(1.0);
  const [voiceId, setVoiceId] = useState('');
  
  // Configuration (from config file)
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [announcementsEnabled, setAnnouncementsEnabled] = useState(true);
  const [scriptModel, setScriptModel] = useState('auto');
  const announcementRef = useRef(null);
  const announcementsEnabledRef = useRef(true);

  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    loadApiConfig().then(config => {
      setElevenLabsKey(config.elevenLabsApiKey);
      setOpenaiKey(config.openaiApiKey);
      setAnnouncementsEnabled(config.announcementsEnabled);
      setVoiceId(config.elevenLabsVoiceId);
      setScriptModel(config.scriptModel || 'auto');
      setConfigLoaded(true);
    });
  }, []);

  useEffect(() => {
    announcementsEnabledRef.current = announcementsEnabled;
  }, [announcementsEnabled]);

  useEffect(() => {
    if (!configLoaded) return;
    saveApiConfig({
      openaiApiKey: openaiKey,
      elevenLabsApiKey: elevenLabsKey,
      elevenLabsVoiceId: voiceId,
      announcementsEnabled,
      scriptModel,
    });
  }, [openaiKey, elevenLabsKey, voiceId, announcementsEnabled, scriptModel, configLoaded]);


  useEffect(() => {
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const interval = setInterval(() => {
      if (!timeDisplayRef.current) return;
      const dur = durationRef.current || 0;
      if (dur > 0) {
        let time = currentTimeRef.current || 0;
        if (isPlayingRef.current) {
          const elapsed = (performance.now() - lastTimeStampRef.current) / 1000;
          time = Math.min(time + elapsed, dur);
        }
        const remaining = Math.max(0, dur - time);
        timeDisplayRef.current.textContent = fmt(remaining);
        timeDisplayRef.current.style.display = '';
        const el = timeDisplayRef.current;
        if (!announcementsEnabledRef.current && isRotationActiveRef.current && remaining <= 30 && remaining > 0) {
          el.style.color = remaining <= 15 ? '#ef4444' : '#eab308';
          el.style.fontSize = '1rem';
          el.style.fontWeight = '700';
          el.style.animation = 'talkPulse 0.8s ease-in-out infinite';
        } else {
          el.style.color = '';
          el.style.fontSize = '';
          el.style.fontWeight = '';
          el.style.animation = '';
        }
      } else {
        timeDisplayRef.current.style.display = 'none';
      }
    }, 250);
    return () => clearInterval(interval);
  }, []);

  const [liveBoothState, setLiveBoothState] = useState(null);
  const sseRef = useRef(null);

  useEffect(() => {
    if (!remoteMode) return;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const interval = setInterval(() => {
      if (!remoteTimeDisplayRef.current) return;
      const dur = liveBoothState?.trackDuration || 0;
      const timeAt = liveBoothState?.trackTimeAt || 0;
      if (dur > 0 && timeAt > 0) {
        const elapsed = liveBoothState?.isPlaying ? (Date.now() - timeAt) / 1000 : 0;
        const currentPos = Math.min((liveBoothState?.trackTime || 0) + elapsed, dur);
        const remaining = Math.max(0, dur - currentPos);
        remoteTimeDisplayRef.current.textContent = fmt(remaining);
        remoteTimeDisplayRef.current.style.display = '';
        const el = remoteTimeDisplayRef.current;
        if (!announcementsEnabledRef.current && remaining <= 30 && remaining > 0) {
          el.style.color = remaining <= 15 ? '#ef4444' : '#eab308';
          el.style.fontWeight = '700';
          el.style.animation = 'talkPulse 0.8s ease-in-out infinite';
        } else {
          el.style.color = '';
          el.style.fontWeight = '';
          el.style.animation = '';
        }
      } else {
        remoteTimeDisplayRef.current.style.display = 'none';
      }
    }, 250);
    return () => clearInterval(interval);
  }, [remoteMode, liveBoothState?.trackTime, liveBoothState?.trackDuration, liveBoothState?.trackTimeAt, liveBoothState?.isPlaying]);

  useEffect(() => {
    if (!remoteMode) return;
    let active = true;

    const pollState = () => {
      if (!active) return;
      boothApi.getState().then(state => {
        if (active && state && state.updatedAt) setLiveBoothState(state);
      }).catch(() => {});
    };

    pollState();

    const es = connectBoothSSE((data) => {
      if (!active) return;
      if (data.type === 'boothState' && data.state) {
        setLiveBoothState(data.state);
      }
      if (data.type === 'djOptions') {
        setDjOptions(data);
        djOptionsRef.current = data;
      }
      if (data.type === 'reconnected' && data.eventSource) {
        sseRef.current = data.eventSource;
      }
    });
    sseRef.current = es;

    const statePollInterval = setInterval(pollState, 1000);

    djOptionsApi.get()
      .then(opts => { if (active) { setDjOptions(opts); djOptionsRef.current = opts; } })
      .catch(() => {});

    return () => { active = false; clearInterval(statePollInterval); sseRef.current?.close(); sseRef.current = null; };
  }, [remoteMode]);

  // Fetch dancers
  const { data: dancers = [] } = useQuery({
    queryKey: ['dancers'],
    queryFn: () => localEntities.Dancer.list(),
    refetchInterval: 15000,
    staleTime: 10000,
    gcTime: 120000
  });

  useEffect(() => {
    const syncDancerBackup = async () => {
      try {
        const serverDancers = await localEntities.Dancer.list();
        if (Array.isArray(serverDancers) && serverDancers.length > 0) {
          localEntities.Dancer.saveBackup(serverDancers);
        } else {
          const backup = localEntities.Dancer.loadBackup();
          if (backup && backup.length > 0) {
            console.log(`🔄 Restoring ${backup.length} dancers from browser backup...`);
            let usedPins = new Set();
            const genPin = () => {
              let pin;
              do { pin = String(Math.floor(10000 + Math.random() * 90000)); } while (usedPins.has(pin));
              usedPins.add(pin);
              return pin;
            };
            for (const dancer of backup) {
              try {
                await localEntities.Dancer.create({
                  name: dancer.name,
                  color: dancer.color || '#00d4ff',
                  pin: genPin(),
                  playlist: dancer.playlist || []
                });
              } catch (err) {
                console.warn(`Failed to restore dancer ${dancer.name}:`, err.message);
              }
            }
            queryClient.invalidateQueries({ queryKey: ['dancers'] });
          }
        }
      } catch (err) {}
    };
    syncDancerBackup();
    const interval = setInterval(async () => {
      try {
        const currentDancers = await localEntities.Dancer.list();
        if (Array.isArray(currentDancers) && currentDancers.length > 0) {
          localEntities.Dancer.saveBackup(currentDancers);
        }
      } catch {}
    }, 30000);
    return () => clearInterval(interval);
  }, [queryClient]);

  // Fetch or create stage
  const { data: stages = [] } = useQuery({
    queryKey: ['stages'],
    queryFn: () => localEntities.Stage.list(),
    staleTime: 30000, // 30 seconds
    gcTime: 60000 // 1 minute
  });

  const activeStage = stages.find(s => s.is_active);

  useEffect(() => { rotationRef.current = rotation; }, [rotation]);
  useEffect(() => { dancersRef.current = dancers; }, [dancers]);
  useEffect(() => { dancerVipMapRef.current = dancerVipMap; }, [dancerVipMap]);

  // Refs so early callbacks/effects can call functions defined later without TDZ
  const updateStageStateRef = useRef(null);
  const getDancerTracksRef = useRef(null);

  // Send a dancer to In VIP — removes from rotation, stores with timer
  const sendDancerToVip = useCallback((dancerId, durationMs) => {
    const isOnStage = rotationRef.current[currentDancerIndexRef.current] === dancerId && isRotationActiveRef.current;
    if (isOnStage) {
      pendingVipRef.current = { ...pendingVipRef.current, [dancerId]: durationMs };
      setPendingVipState({ ...pendingVipRef.current });
      try { localStorage.setItem('neonaidj_pending_vip', JSON.stringify(pendingVipRef.current)); } catch {}
      const dancer = dancersRef.current.find(d => d.id === dancerId);
      toast(`${dancer?.name || 'Entertainer'} going to VIP after this set`, { icon: '👑' });
    } else {
      const expiresAt = Date.now() + durationMs;
      const newMap = { ...dancerVipMapRef.current, [dancerId]: { expiresAt, duration: durationMs } };
      dancerVipMapRef.current = newMap;
      setDancerVipMap(newMap);
      try { localStorage.setItem('neonaidj_vip_map', JSON.stringify(newMap)); } catch {}
      const rot = rotationRef.current;
      const currentId = rot[currentDancerIndexRef.current];
      const newRot = rot.filter(id => id !== dancerId);
      const adjustedIdx = Math.max(0, newRot.indexOf(currentId));
      setRotation(newRot);
      rotationRef.current = newRot;
      setCurrentDancerIndex(adjustedIdx);
      currentDancerIndexRef.current = adjustedIdx;
      if (isRotationActiveRef.current) updateStageStateRef.current?.(adjustedIdx, newRot);
      const dancer = dancersRef.current.find(d => d.id === dancerId);
      toast(`${dancer?.name || 'Entertainer'} sent to VIP`, { icon: '👑' });
    }
  }, []);

  // Release a dancer from In VIP early — adds to bottom of rotation
  const releaseDancerFromVip = useCallback((dancerId) => {
    const id = String(dancerId);
    const newMap = { ...dancerVipMapRef.current };
    delete newMap[id];
    delete pendingVipRef.current[id];
    setPendingVipState({ ...pendingVipRef.current });
    try { localStorage.setItem('neonaidj_pending_vip', JSON.stringify(pendingVipRef.current)); } catch {}
    dancerVipMapRef.current = newMap;
    setDancerVipMap({ ...newMap });
    try { localStorage.setItem('neonaidj_vip_map', JSON.stringify(newMap)); } catch {}
    const newRot = [...rotationRef.current, id];
    setRotation(newRot);
    rotationRef.current = newRot;
    if (isRotationActiveRef.current) updateStageStateRef.current?.(currentDancerIndexRef.current, newRot);
    const dancer = dancersRef.current.find(d => String(d.id) === id);
    toast(`${dancer?.name || 'Entertainer'} released from VIP`, { icon: '✅' });
  }, []);
  sendDancerToVipRef.current = sendDancerToVip;
  releaseDancerFromVipRef.current = releaseDancerFromVip;

  // Auto-expire VIP timers — check every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const map = dancerVipMapRef.current;
      const expired = Object.entries(map).filter(([, v]) => v.expiresAt && v.expiresAt <= now);
      if (expired.length === 0) return;
      const newMap = { ...map };
      const newRot = [...rotationRef.current];
      for (const [id] of expired) {
        delete newMap[id];
        const dancer = dancersRef.current.find(d => String(d.id) === id);
        if (dancer && !newRot.some(r => String(r) === id)) {
          newRot.push(id);
        }
        const rotActive = isRotationActiveRef.current;
        console.log('👑 VIP expired — returning to rotation:', dancer?.name, rotActive ? '' : '(rotation paused)');
        toast(
          rotActive
            ? `${dancer?.name || 'Entertainer'} returned from VIP`
            : `${dancer?.name || 'Entertainer'} VIP time ended — added to rotation`,
          { icon: '✅' }
        );
      }
      dancerVipMapRef.current = newMap;
      setDancerVipMap(newMap);
      setRotation(newRot);
      rotationRef.current = newRot;
      try { localStorage.setItem('neonaidj_vip_map', JSON.stringify(newMap)); } catch {}
      if (isRotationActiveRef.current) updateStageStateRef.current?.(currentDancerIndexRef.current, newRot);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const lastCommandIdRef = useRef(0);
  const commandSseRef = useRef(null);

  const autoPopulateBreakSongs = useCallback(async (count) => {
    const rot = rotationRef.current || [];
    if (count <= 0 || rot.length === 0) return;
    try {
      const current = { ...(interstitialSongsRef.current || {}) };
      const slotsNeeding = [];
      let totalNeeded = 0;
      for (const dancerId of rot) {
        const key = `after-${dancerId}`;
        const existing = current[key] || [];
        if (existing.length > count) {
          current[key] = existing.slice(0, count);
        }
        if (existing.length === 0) {
          slotsNeeding.push({ key, existing: [], need: count });
          totalNeeded += count;
        }
      }
      if (totalNeeded > 0) {
        const token = localStorage.getItem('djbooth_token');
        const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
        const activeGenres = djOptionsRef.current?.activeGenres?.length > 0 ? djOptionsRef.current.activeGenres : [];
        const cooldowns = songCooldownRef.current || {};
        const nowMs = Date.now();
        const cooldownNames = Object.entries(cooldowns)
          .filter(([, ts]) => ts && (nowMs - ts) < COOLDOWN_MS)
          .map(([name]) => name);
        const assignedNames = Object.values(rotationSongsRef.current || {}).flat().filter(t => t?.name).map(t => t.name);
        const existingBreakNames = Object.values(current).flat();
        const excludeNames = [...new Set([...cooldownNames, ...assignedNames, ...existingBreakNames])];
        const res = await fetch('/api/music/select', {
          method: 'POST', headers,
          body: JSON.stringify({ count: totalNeeded, excludeNames, genres: activeGenres, dancerPlaylist: [] }),
          signal: AbortSignal.timeout(8000)
        });
        if (res.ok) {
          const data = await res.json();
          const pool = (data.tracks || []).map(t => t.name).sort(() => Math.random() - 0.5);
          let pi = 0;
          for (const slot of slotsNeeding) {
            const filled = [...slot.existing];
            for (let i = 0; i < slot.need && pi < pool.length; i++) filled.push(pool[pi++]);
            current[slot.key] = filled;
          }
          console.log('🎵 Break songs auto-populated:', slotsNeeding.length, 'slots,', count, 'per set');
        }
      }
      interstitialSongsRef.current = current;
      setInterstitialSongsState(current);
      setInterstitialRemoteVersion(v => v + 1);
      try { localStorage.setItem('djbooth_interstitial_songs', JSON.stringify(current)); } catch {}
    } catch (err) {
      console.warn('⚠️ Break song auto-populate failed:', err.message);
    }
  }, []);

  const executeCommand = useCallback((cmd) => {
    try {
      lastCommandIdRef.current = Math.max(lastCommandIdRef.current, cmd.id);
      switch (cmd.action) {
        case 'skip':
          handleSkipRef.current?.();
          break;
        case 'startRotation':
          beginRotationRef.current?.();
          break;
        case 'stopRotation':
          stopRotationRef.current?.();
          break;
        case 'toggleAnnouncements':
          setAnnouncementsEnabled(prev => !prev);
          break;
        case 'setSongsPerSet':
          if (cmd.payload.count) {
            setSongsPerSet(cmd.payload.count);
            songsPerSetRef.current = cmd.payload.count;
          }
          break;
        case 'updateRotation':
          if (cmd.payload.rotation) {
            setRotation(cmd.payload.rotation);
            rotationRef.current = cmd.payload.rotation;
          }
          break;
        case 'removeDancerFromRotation':
          if (cmd.payload.dancerId) {
            const _removedIdx = rotationRef.current.indexOf(cmd.payload.dancerId);
            const _newRot = rotationRef.current.filter(id => id !== cmd.payload.dancerId);
            if (_removedIdx !== -1 && _removedIdx <= currentDancerIndexRef.current && _newRot.length > 0) {
              const _newIdx = (currentDancerIndexRef.current - 1 + _newRot.length) % _newRot.length;
              currentDancerIndexRef.current = _newIdx;
              setCurrentDancerIndex(_newIdx);
            }
            rotationRef.current = _newRot;
            setRotation(_newRot);
          }
          break;
        case 'addDancerToRotation':
          if (cmd.payload.dancerId) {
            setRotation(prev => {
              if (prev.includes(cmd.payload.dancerId)) return prev;
              const updated = [...prev, cmd.payload.dancerId];
              rotationRef.current = updated;
              return updated;
            });
          }
          break;
        case 'setVolume':
          if (cmd.payload.volume != null) {
            const vol = Math.max(0, Math.min(1, cmd.payload.volume));
            setVolume(vol);
            audioEngineRef.current?.setVolume(vol);
          }
          break;
        case 'setVoiceGain':
          if (cmd.payload.gain != null) {
            const g = Math.max(0.5, Math.min(3, Math.round(cmd.payload.gain * 20) / 20));
            setVoiceGain(g);
            audioEngineRef.current?.setVoiceGain(g);
            try { localStorage.setItem('djbooth_voice_gain', String(g)); } catch {}
            try { fetch('/api/config/save-to-server', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ djbooth_voice_gain: String(g) }) }).catch(() => {}); } catch {}
          }
          break;
        case 'setCommercialFreq':
          if (cmd.payload.freq != null) {
            try { localStorage.setItem('neonaidj_commercial_freq', String(cmd.payload.freq)); } catch {}
          }
          break;
        case 'setBreakSongsPerSet':
          if (cmd.payload.count != null) {
            const c = Math.max(0, Math.min(3, cmd.payload.count));
            setBreakSongsPerSet(c);
            breakSongsPerSetRef.current = c;
            if (c > 0) {
              autoPopulateBreakSongs(c);
            } else {
              interstitialSongsRef.current = {};
              setInterstitialSongsState({});
              setInterstitialRemoteVersion(v => v + 1);
              try { localStorage.setItem('djbooth_interstitial_songs', '{}'); } catch {}
            }
          }
          break;
        case 'moveInRotation':
          if (cmd.payload.dancerId && cmd.payload.direction) {
            setRotation(prev => {
              const rot = [...prev];
              const idx = rot.indexOf(cmd.payload.dancerId);
              if (idx === -1) return prev;
              if (cmd.payload.direction === 'up' && idx > 0) {
                [rot[idx - 1], rot[idx]] = [rot[idx], rot[idx - 1]];
              } else if (cmd.payload.direction === 'down' && idx < rot.length - 1) {
                [rot[idx], rot[idx + 1]] = [rot[idx + 1], rot[idx]];
              }
              rotationRef.current = rot;
              return rot;
            });
          }
          break;
        case 'saveRotation':
          if (cmd.payload.rotation) {
            const newRot = cmd.payload.rotation;
            setRotation(newRot);
            rotationRef.current = newRot;
            saveRotationRef.current?.(newRot);
          }
          break;
        case 'updateInterstitialSongs':
          if (cmd.payload.interstitialSongs) {
            interstitialSongsRef.current = cmd.payload.interstitialSongs;
            setInterstitialSongsState({ ...cmd.payload.interstitialSongs });
            setInterstitialRemoteVersion(v => v + 1);
            try { localStorage.setItem('djbooth_interstitial_songs', JSON.stringify(cmd.payload.interstitialSongs)); } catch {}
            console.log('🎵 Remote updated break songs');
          }
          break;
        case 'skipCommercial':
          if (cmd.payload.commercialId) {
            try {
              const raw = localStorage.getItem('neonaidj_skipped_commercials');
              const existing = raw ? JSON.parse(raw) : [];
              if (!existing.includes(cmd.payload.commercialId)) {
                existing.push(cmd.payload.commercialId);
                localStorage.setItem('neonaidj_skipped_commercials', JSON.stringify(existing));
              }
              console.log('📺 Remote skipped commercial:', cmd.payload.commercialId);
            } catch {}
          }
          break;
        case 'swapPromo':
          if (cmd.payload.slotIndex != null) {
            if (swapPromoRef.current) swapPromoRef.current(cmd.payload.slotIndex);
            console.log('📺 Remote swapped promo at slot:', cmd.payload.slotIndex);
          }
          break;
        case 'deactivateTrack':
          if (cmd.payload.pin && cmd.payload.trackName) {
            (async () => {
              try {
                const verifyRes = await fetch('/api/auth/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ role: 'dj', pin: cmd.payload.pin })
                });
                if (!verifyRes.ok) {
                  console.warn('⚠️ Remote deactivate: invalid PIN');
                  return;
                }
                const loginData = await verifyRes.json().catch(() => ({}));
                const authToken = loginData.token || localStorage.getItem('djbooth_token');
                if (!authToken) {
                  console.warn('⚠️ Remote deactivate: no auth token available');
                  return;
                }
                const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };
                const res = await fetch('/api/music/block', {
                  method: 'POST',
                  headers: hdrs,
                  body: JSON.stringify({ trackName: cmd.payload.trackName })
                });
                if (res.ok) {
                  console.log('🚫 Remote deactivated track:', cmd.payload.trackName);
                  handleSkipRef.current?.();
                } else {
                  console.warn('⚠️ Remote deactivate: block request failed', res.status);
                }
              } catch (err) {
                console.warn('⚠️ Remote deactivate failed:', err.message);
              }
            })();
          }
          break;
        case 'playSound':
          if (cmd.payload.soundId) {
            (async () => {
              try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!soundboardCtxRef.current || soundboardCtxRef.current.state === 'closed') {
                  soundboardCtxRef.current = new AC();
                }
                if (soundboardCtxRef.current.state === 'suspended') {
                  await soundboardCtxRef.current.resume();
                }
                const gain = Math.max(0, Math.min(5, cmd.payload.gain ?? 1.0));
                playSoundboardEffect(cmd.payload.soundId, soundboardCtxRef.current, gain);
                console.log('🎛️ Soundboard:', cmd.payload.soundId, 'gain:', gain.toFixed(2));
              } catch (err) {
                console.warn('🎛️ Soundboard play failed:', err.message);
              }
            })();
          }
          break;
        case 'sendToVip':
          if (cmd.payload.dancerId != null && cmd.payload.durationMs) {
            sendDancerToVipRef.current?.(cmd.payload.dancerId, cmd.payload.durationMs);
          }
          break;
        case 'releaseFromVip':
          if (cmd.payload.dancerId != null) {
            releaseDancerFromVipRef.current?.(cmd.payload.dancerId);
          }
          break;
        case 'updateSongAssignments':
          if (cmd.payload.assignments) {
            const allTracks = tracksRef.current || [];
            const newSongs = { ...rotationSongsRef.current };
            Object.entries(cmd.payload.assignments).forEach(([dancerId, songNames]) => {
              newSongs[dancerId] = songNames.map(name => {
                const found = allTracks.find(t => t.name === name && t.url);
                return found || { name, path: name };
              });
            });
            setRotationSongs(newSongs);
            rotationSongsRef.current = newSongs;
            console.log('🎵 Remote updateSongAssignments: updated songs for', Object.keys(cmd.payload.assignments).length, 'entertainers');
            // Async-resolve any name-only tracks (no URL) so display always matches playback
            (async () => {
              let changed = false;
              const resolved = { ...rotationSongsRef.current };
              for (const [dancerId, trackList] of Object.entries(newSongs)) {
                const resolvedList = [];
                for (const t of trackList) {
                  if (t.url) { resolvedList.push(t); continue; }
                  try {
                    const fresh = await resolveTrackByName(t.name);
                    if (fresh) { resolvedList.push(fresh); changed = true; }
                    else resolvedList.push(t);
                  } catch { resolvedList.push(t); }
                }
                resolved[dancerId] = resolvedList;
              }
              if (changed) {
                setRotationSongs({ ...resolved });
                rotationSongsRef.current = { ...resolved };
                console.log('🎵 Resolved URLs for manually assigned tracks');
              }
            })();
          }
          break;
        case 'playHouseAnnouncement':
          if (cmd.payload.cacheKey) {
            const _haToken = localStorage.getItem('djbooth_token');
            const _haHdrs = _haToken ? { Authorization: `Bearer ${_haToken}` } : {};
            fetch(`/api/voiceovers/audio/${encodeURIComponent(cmd.payload.cacheKey)}`, { headers: _haHdrs })
              .then(r => r.ok ? r.blob() : null)
              .then(blob => {
                if (!blob) return;
                const blobUrl = URL.createObjectURL(blob);
                audioEngineRef.current?.playAnnouncement(blobUrl, { autoDuck: true });
                setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
              })
              .catch(err => console.error('playHouseAnnouncement failed:', err));
          }
          break;
        default:
          console.log('Unknown remote command:', cmd.action);
      }
    } catch (err) {
      console.error('Error executing remote command:', cmd.action, err);
    }
  }, []);

  useEffect(() => {
    if (remoteMode) return;
    let active = true;

    const pollCommands = () => {
      if (!active) return;
      boothApi.getCommands(lastCommandIdRef.current).then(({ commands }) => {
        if (!active || !commands) return;
        commands.forEach(executeCommand);
        if (commands.length > 0) boothApi.ackCommands(lastCommandIdRef.current).catch(() => {});
      }).catch(() => {});
    };

    pollCommands();

    const es = connectBoothSSE((data) => {
      if (!active) return;
      if (data.type === 'command' && data.command) {
        executeCommand(data.command);
        boothApi.ackCommands(data.command.id).catch(() => {});
      }
      if (data.type === 'djOptions') {
        setDjOptions(data);
        djOptionsRef.current = data;
      }
      if (data.type === 'reconnected' && data.eventSource) {
        commandSseRef.current = data.eventSource;
      }
    });
    commandSseRef.current = es;

    const commandPollInterval = setInterval(pollCommands, 1000);

    return () => { active = false; clearInterval(commandPollInterval); commandSseRef.current?.close(); commandSseRef.current = null; };
  }, [remoteMode, executeCommand]);

  // Pi mode: broadcast live state to server every 5 seconds
  const boothBroadcastReadyRef = useRef(false);
  useEffect(() => {
    if (remoteMode) return;
    if (!boothBroadcastReadyRef.current) {
      if (dancers.length > 0 || rotation.length === 0) {
        boothBroadcastReadyRef.current = true;
      } else {
        return;
      }
    }
    const broadcast = async () => {
      try {
        const currentDancer = rotation.length > 0 && dancers.length > 0
          ? dancers.find(d => d.id === rotation[currentDancerIndex])
          : null;
        const mergedSongs = { ...plannedSongAssignments };
        if (rotationSongs && Object.keys(rotationSongs).length > 0) {
          Object.entries(rotationSongs).forEach(([id, tracks]) => {
            if (tracks && tracks.length > 0) mergedSongs[id] = tracks;
          });
        }
        await boothApi.postState({
          isRotationActive,
          currentDancerIndex,
          currentDancerName: currentDancer?.name || null,
          currentTrack,
          currentSongNumber,
          songsPerSet,
          breakSongsPerSet,
          isPlaying,
          rotation,
          announcementsEnabled,
          rotationSongs: mergedSongs,
          interstitialSongs: interstitialSongsRef.current || {},
          breakSongIndex: activeBreakInfo?.currentIndex ?? null,
          commercialFreq: localStorage.getItem('neonaidj_commercial_freq') || 'off',
          commercialCounter: commercialCounterRef.current,
          promoQueue: promoQueue,
          availablePromos: availablePromos.map(p => ({ cache_key: p.cache_key, dancer_name: p.dancer_name })),
          skippedCommercials: (() => { try { return JSON.parse(localStorage.getItem('neonaidj_skipped_commercials') || '[]'); } catch { return []; } })(),  // kept for remote rotation display
          dancerVipMap,
          volume,
          voiceGain,
          trackTime: currentTimeRef.current || 0,
          trackDuration: durationRef.current || 0,
          trackTimeAt: Date.now(),
          diagLog: diagLogRef.current,
          prePickHits: prePickHitsRef.current,
          prePickMisses: prePickMissesRef.current,
          lastTransitionMs: lastTransitionMsRef.current,
          lastWatchdogAt: lastWatchdogRef.current?.at || null,
          lastWatchdogSilentMs: lastWatchdogRef.current?.silentMs || null,
          lastWatchdogDancer: lastWatchdogRef.current?.dancer || null,
          lastWatchdogTrack: lastWatchdogRef.current?.track || null,
        });
      } catch {}
    };
    broadcast();
    const interval = setInterval(broadcast, 2000);
    return () => clearInterval(interval);
  }, [remoteMode, isRotationActive, currentDancerIndex, currentTrack, currentSongNumber, songsPerSet, breakSongsPerSet, isPlaying, rotation, announcementsEnabled, dancers, rotationSongs, volume, voiceGain, plannedSongAssignments, interstitialSongsState, promoQueue, availablePromos, activeBreakInfo, dancerVipMap]);

  // Background pre-pick: when the current dancer's SECOND-TO-LAST song starts (or last song
  // for 1-song sets), quietly fetch the next dancer's tracks in the background so the
  // transition critical path has a full extra song's worth of time to complete the fetch.
  useEffect(() => {
    if (!isRotationActive || currentSongNumber < Math.max(1, songsPerSet - 1) || songsPerSet < 1) return;
    const rot = rotationRef.current;
    const dnc = dancersRef.current;
    const idx = currentDancerIndexRef.current;
    const dancerId = rot[idx];
    if (!dancerId) return;
    const dancer = dnc.find(d => d.id === dancerId);
    if (!dancer) return;
    if (bgPrePickRef.current?.dancerId === dancerId) return;
    const playingTrackExclude = currentTrackRef.current ? [currentTrackRef.current] : [];
    console.log(`🎵 BgPrePick: Starting for ${dancer.name} (song ${currentSongNumber} of ${songsPerSet} — early pre-pick)`);
    const promise = getDancerTracksRef.current(dancer, playingTrackExclude, true)
      .then(tracks => {
        if (bgPrePickRef.current?.dancerId === dancerId) {
          bgPrePickRef.current.tracks = tracks;
          console.log(`🎵 BgPrePick: Ready for ${dancer.name}: [${tracks.map(t => t.name).join(', ')}]`);
        }
        return tracks;
      })
      .catch(e => {
        console.warn(`⚠️ BgPrePick: Failed for ${dancer.name}:`, e.message);
        return [];
      });
    bgPrePickRef.current = { dancerId, promise, tracks: null };
  }, [isRotationActive, currentSongNumber, songsPerSet]);

  useEffect(() => {
    if (!activeStage) return;
    const saved = activeStage.rotation_order;
    if (saved && saved.length > 0 && rotation.length === 0) {
      if (dancers.length > 0) {
        const dancerIds = new Set(dancers.map(d => d.id));
        const valid = saved.filter(id => dancerIds.has(id));
        if (valid.length !== saved.length) {
          console.log(`🧹 Cleaned ${saved.length - valid.length} stale rotation IDs`);
        }
        setRotation(valid);
        rotationRef.current = valid;
        const idx = valid.length > 0 ? Math.min(activeStage.current_dancer_index || 0, valid.length - 1) : 0;
        setCurrentDancerIndex(idx);
        currentDancerIndexRef.current = idx;
      } else {
        setRotation(saved);
        rotationRef.current = saved;
        const idx = activeStage.current_dancer_index || 0;
        setCurrentDancerIndex(idx);
        currentDancerIndexRef.current = idx;
      }
    }
  }, [activeStage, dancers.length]);

  useEffect(() => {
    if (rotation.length > 0 && dancers.length > 0) {
      const dancerIds = new Set(dancers.map(d => d.id));
      const hasStale = rotation.some(id => !dancerIds.has(id));
      if (hasStale) {
        const valid = rotation.filter(id => dancerIds.has(id));
        console.log(`🧹 Purged ${rotation.length - valid.length} stale IDs from active rotation`);
        setRotation(valid);
        rotationRef.current = valid;
        if (currentDancerIndex >= valid.length) {
          const newIdx = Math.max(0, valid.length - 1);
          setCurrentDancerIndex(newIdx);
          currentDancerIndexRef.current = newIdx;
        }
      }
    }
  }, [dancers]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('djbooth_playback_state');
      if (raw) {
        const s = JSON.parse(raw);
        if (s.songsPerSet != null) { setSongsPerSet(s.songsPerSet); songsPerSetRef.current = s.songsPerSet; }
        if (s.currentSongNumber != null) { setCurrentSongNumber(s.currentSongNumber); currentSongNumberRef.current = s.currentSongNumber; }
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    localStorage.setItem('djbooth_playback_state', JSON.stringify({
      isRotationActive,
      currentSongNumber,
      songsPerSet,
    }));
  }, [isRotationActive, currentSongNumber, songsPerSet]);

  // Mutations
  const createDancerMutation = useMutation({
    mutationFn: async (data) => {
      const result = await localEntities.Dancer.create(data);
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dancers'] });
      await queryClient.refetchQueries({ queryKey: ['dancers'] });
    }
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ id, data }) => localEntities.Stage.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stages'] })
  });

  const addDancer = async (data) => {
    const result = await createDancerMutation.mutateAsync(data);
    if (result?.name && announcementRef.current?.preCacheDancer) {
      setTimeout(() => {
        announcementRef.current.preCacheDancer(result.name);
      }, 500);
    }
    return result;
  };

  const updateDancerMutation = useMutation({
    mutationFn: ({ id, data }) => localEntities.Dancer.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dancers'] })
  });

  const deleteDancerMutation = useMutation({
    mutationFn: (id) => localEntities.Dancer.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dancers'] })
  });

  // Get current dancer
  const currentDancer = rotation[currentDancerIndex] 
    ? dancers.find(d => d.id === rotation[currentDancerIndex])
    : null;

  const getTrackUrl = useCallback((trackName) => {
    const track = tracks.find(t => t.name === trackName);
    if (!track) {
      const looseMatch = tracks.find(t => t.name.includes(trackName.split('.')[0]));
      if (looseMatch) return looseMatch.url;
      console.warn(`⚠️ GetTrackUrl: Track "${trackName}" not found in library of ${tracks.length} tracks`);
      return null;
    }
    return track.url;
  }, [tracks]);

  const lastRefreshTimeRef = useRef(0);
  const trackCountRef = useRef(0);

  const refreshTracks = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshTimeRef.current < 5000) return null;
    lastRefreshTimeRef.current = now;
    try {
      const token = localStorage.getItem('djbooth_token');
      const res = await fetch('/api/music/tracks?limit=100', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) return null;
      const data = await res.json();
      const withUrls = data.tracks.map(t => ({ ...t, url: `/api/music/stream/${t.id}` }));
      setTracks(withUrls);
      tracksRef.current = withUrls;
      trackCountRef.current = data.total || withUrls.length;
      return withUrls;
    } catch (err) {
      console.error('❌ RefreshTracks failed:', err.message);
      return null;
    }
  }, []);

  const playFallbackTrack = useCallback(async (crossfade = false) => {
    const updateRotationUI = (track) => {
      if (isRotationActiveRef.current && rotationRef.current.length > 0) {
        const currentDancerId = rotationRef.current[currentDancerIndexRef.current];
        if (currentDancerId) {
          const currentSongs = rotationSongsRef.current[currentDancerId] || [];
          const songIdx = currentSongNumberRef.current - 1;
          const updatedSongs = [...currentSongs];
          updatedSongs[songIdx] = track;
          const newRotationSongs = { ...rotationSongsRef.current, [currentDancerId]: updatedSongs };
          setRotationSongs(newRotationSongs);
          rotationSongsRef.current = newRotationSongs;
        }
      }
    };

    const waitForVisible = () => new Promise(resolve => {
      if (document.visibilityState === 'visible') { resolve(); return; }
      console.log('⏸️ PlayFallback: Page hidden — waiting for visibility before retry');
      const onVisible = () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', onVisible);
          setTimeout(resolve, 200);
        }
      };
      document.addEventListener('visibilitychange', onVisible);
      setTimeout(() => { document.removeEventListener('visibilitychange', onVisible); resolve(); }, 10000);
    });

    const isSuspensionError = (err) => {
      const msg = (err?.message || '').toLowerCase();
      return msg.includes('paused to save power') || msg.includes('interrupted');
    };

    let hitSuspension = false;

    if (document.visibilityState !== 'visible') {
      console.log('⏸️ PlayFallback: Page hidden at start — waiting for visibility');
      await waitForVisible();
    }

    try {
      const token = localStorage.getItem('djbooth_token');
      const opts = djOptionsRef.current;
      const genresParam = opts?.activeGenres?.length > 0 ? `&genres=${encodeURIComponent(opts.activeGenres.join(','))}` : '';
      const cooldowns = songCooldownRef.current || {};
      const nowMs = Date.now();
      const recentNames = Object.entries(cooldowns)
        .filter(([, ts]) => ts && (nowMs - ts) < COOLDOWN_MS)
        .map(([name]) => name);
      const excludeParam = recentNames.length > 0 ? `&exclude=${encodeURIComponent(recentNames.join(','))}` : '';
      const res = await fetch(`/api/music/random?count=5${genresParam}${excludeParam}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data = await res.json();
        const serverTracks = (data.tracks || []).map(t => ({ ...t, url: `/api/music/stream/${t.id}` }));
        for (let i = 0; i < serverTracks.length; i++) {
          if (hitSuspension) await waitForVisible();
          const track = serverTracks[i];
          console.log(`🎵 PlayFallback: Server attempt ${i + 1}/${serverTracks.length} with "${track.name}"`);
          try {
            const success = await audioEngineRef.current?.playTrack({ url: track.url, name: track.name }, crossfade);
            if (success !== false) {
              recordSongPlayed(track.name);
              setIsPlaying(true);
              updateRotationUI(track);
              return true;
            }
          } catch (err) {
            console.error(`❌ PlayFallback: Server attempt ${i + 1} failed:`, err.message);
            if (isSuspensionError(err)) hitSuspension = true;
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ PlayFallback: Server random fetch failed, using local pool:', err.message);
    }

    const validTracks = filterByActiveGenres(tracks.filter(t => t && t.url));
    if (validTracks.length === 0) {
      console.error('❌ PlayFallback: No tracks available');
      return false;
    }
    const pool = filterCooldown(validTracks);
    const cooldowns = songCooldownRef.current || {};
    const shuffled = fisherYatesShuffle(pool);
    shuffled.sort((a, b) => (cooldowns[a.name] || 0) - (cooldowns[b.name] || 0));
    const maxAttempts = Math.min(5, shuffled.length);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (hitSuspension) await waitForVisible();
      const randomTrack = shuffled[attempt];
      console.log(`🎵 PlayFallback: Local attempt ${attempt + 1}/${maxAttempts} with "${randomTrack.name}"`);
      try {
        const success = await audioEngineRef.current?.playTrack({ url: randomTrack.url, name: randomTrack.name }, crossfade);
        if (success !== false) {
          recordSongPlayed(randomTrack.name);
          setIsPlaying(true);
          updateRotationUI(randomTrack);
          return true;
        }
      } catch (err) {
        console.error(`❌ PlayFallback: Local attempt ${attempt + 1} failed:`, err.message);
        if (isSuspensionError(err)) hitSuspension = true;
      }
    }

    console.error('🚨 PlayFallback: ALL attempts failed — keeping current audio alive');
    return false;
  }, [tracks, filterCooldown, recordSongPlayed]);

  const AUTOPLAY_QUEUE_SIZE = 10;

  const fillAutoplayQueue = useCallback(async (currentQueue = []) => {
    const needed = AUTOPLAY_QUEUE_SIZE - currentQueue.length;
    if (needed <= 0) return currentQueue;
    if (autoplayFillInFlightRef.current) return currentQueue;
    autoplayFillInFlightRef.current = true;
    const fillVersion = ++autoplayFillVersionRef.current;
    try {
      const token = localStorage.getItem('djbooth_token');
      const opts = djOptionsRef.current;
      const genresParam = opts?.activeGenres?.length > 0 ? `&genres=${encodeURIComponent(opts.activeGenres.join(','))}` : '';
      const cooldowns = songCooldownRef.current || {};
      const nowMs = Date.now();
      const recentNames = Object.entries(cooldowns)
        .filter(([, ts]) => ts && (nowMs - ts) < COOLDOWN_MS)
        .map(([name]) => name);
      const queueNames = currentQueue.map(t => t.name);
      const allExclude = [...new Set([...recentNames, ...queueNames])];
      const excludeParam = allExclude.length > 0 ? `&exclude=${encodeURIComponent(allExclude.join(','))}` : '';
      const res = await fetch(`/api/music/random?count=${needed}${genresParam}${excludeParam}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(5000)
      });
      if (fillVersion !== autoplayFillVersionRef.current) return autoplayQueueRef.current;
      if (res.ok) {
        const data = await res.json();
        const latestQueue = autoplayQueueRef.current;
        const latestNames = new Set(latestQueue.map(t => t.name));
        const newTracks = (data.tracks || [])
          .filter(t => !latestNames.has(t.name))
          .map(t => ({ ...t, url: `/api/music/stream/${t.id}`, autoFilled: true }));
        const filled = [...latestQueue, ...newTracks].slice(0, AUTOPLAY_QUEUE_SIZE);
        autoplayQueueRef.current = filled;
        setAutoplayQueue(filled);
        return filled;
      }
    } catch (err) {
      console.warn('⚠️ AutoplayQueue fill failed:', err.message);
    } finally {
      autoplayFillInFlightRef.current = false;
    }
    return currentQueue;
  }, []);

  const updateAutoplayQueue = useCallback((newQueue) => {
    autoplayQueueRef.current = newQueue;
    setAutoplayQueue(newQueue);
  }, []);

  const playFromAutoplayQueue = useCallback(async (crossfade = true) => {
    if (autoplayPlayingRef.current) return false;
    autoplayPlayingRef.current = true;
    try {
      let queue = autoplayQueueRef.current;
      if (queue.length === 0) {
        const filled = await fillAutoplayQueue([]);
        queue = autoplayQueueRef.current;
        if (queue.length === 0) return playFallbackTrack(crossfade);
      }
      const track = queue[0];
      const remaining = queue.slice(1);
      updateAutoplayQueue(remaining);
      fillAutoplayQueue(remaining);
      console.log(`🎵 AutoplayQueue: Playing "${track.name}", ${remaining.length} remaining`);
      recordSongPlayed(track.name);
      setIsPlaying(true);
      const success = await audioEngineRef.current?.playTrack({ url: track.url, name: track.name }, crossfade);
      if (success === false) {
        console.warn('⚠️ AutoplayQueue: Track failed, trying fallback');
        return playFallbackTrack(crossfade);
      }
      return success;
    } finally {
      autoplayPlayingRef.current = false;
    }
  }, [fillAutoplayQueue, updateAutoplayQueue, playFallbackTrack, recordSongPlayed]);

  useEffect(() => {
    if (rotation.length === 0 && !isRotationActive && tracks.length > 0 && autoplayQueueRef.current.length === 0) {
      fillAutoplayQueue([]);
    }
  }, [rotation.length, isRotationActive, tracks.length, fillAutoplayQueue]);

  const isFeatureTrack = useCallback((name, genre) => {
    if (genre && genre.toUpperCase() === 'FEATURE') return true;
    if (!name) return false;
    const track = tracks.find(t => t.name === name);
    return track?.genre?.toUpperCase() === 'FEATURE' || track?.path?.toUpperCase()?.startsWith('FEATURE/');
  }, [tracks]);

  const playTrack = useCallback(async (trackUrl, crossfade = true, trackName = null, trackGenre = null) => {
    if (!trackUrl) {
      console.error('❌ PlayTrack: No track URL provided');
      return false;
    }
    if (!audioEngineRef.current) {
      console.error('❌ PlayTrack: Audio engine not initialized');
      return false;
    }
    if (watchdogRecoveringRef.current) {
      console.log('⏳ PlayTrack: Watchdog recovery in progress, waiting...');
      for (let w = 0; w < 10; w++) {
        await new Promise(r => setTimeout(r, 500));
        if (!watchdogRecoveringRef.current) break;
      }
      if (watchdogRecoveringRef.current) {
        console.log('⏳ PlayTrack: Watchdog still recovering after 5s, proceeding');
      }
    }
    const name = trackName || decodeURIComponent(trackUrl.split('/').pop().split('?')[0]) || null;
    if (name) recordSongPlayed(name, null, trackGenre);
    if (isFeatureTrack(name, trackGenre)) {
      console.log('🌟 PlayTrack: FEATURE track detected — playing full duration:', name);
      audioEngineRef.current.setMaxDuration(3600);
    }
    playbackExpectedRef.current = true;
    lastAudioActivityRef.current = Date.now();
    console.log('🎵 PlayTrack: Playing track URL, crossfade=' + crossfade);
    const success = await audioEngineRef.current.playTrack(trackName ? { url: trackUrl, name: trackName } : trackUrl, crossfade);
    if (success !== false) {
      lastAudioActivityRef.current = Date.now();
    }
    if (success === false) {
      console.warn('⚠️ PlayTrack: Engine returned failure, trying fallback');
      const fallbackOk = await playFallbackTrack(crossfade);
      if (!fallbackOk) {
        console.error('🚨 PlayTrack: All recovery failed — resuming whatever is on active deck');
        audioEngineRef.current?.resume();
      }
      return fallbackOk;
    }
    setIsPlaying(true);
    return true;
  }, [recordSongPlayed, playFallbackTrack, isFeatureTrack]);

  const tracksLoadedRef = useRef(false);
  const initialLoadGraceRef = useRef(true);
  useEffect(() => {
    if (remoteMode || tracksLoadedRef.current) return;
    tracksLoadedRef.current = true;
    lastAudioActivityRef.current = Date.now();
    (async () => {
      const loaded = await refreshTracks();
      if (loaded && loaded.length > 0 && !isPlaying) {
        const pool = filterCooldown(loaded);
        const randomTrack = pool[Math.floor(Math.random() * pool.length)];
        if (randomTrack?.url) {
          lastAudioActivityRef.current = Date.now();
          await playTrack(randomTrack.url, false, randomTrack.name, randomTrack.genre);
          lastAudioActivityRef.current = Date.now();
        }
      }
      setTimeout(() => { initialLoadGraceRef.current = false; }, 15000);
    })();
  }, [remoteMode]);

  useEffect(() => {
    if (remoteMode) return;
    djOptionsApi.get()
      .then(opts => {
        setDjOptions(opts);
        djOptionsRef.current = opts;
      })
      .catch(() => {});
  }, [remoteMode]);

  const getRandomTracks = useCallback((count) => {
    const pool = filterCooldown(tracks);
    const cooldowns = songCooldownRef.current || {};
    const shuffled = fisherYatesShuffle(pool);
    shuffled.sort((a, b) => {
      const aTime = cooldowns[a.name] || 0;
      const bTime = cooldowns[b.name] || 0;
      return aTime - bTime;
    });
    const selected = shuffled.slice(0, count);
    console.log(`🎵 GetRandomTracks: Selected ${selected.length} tracks from ${pool.length} available (${tracks.length} total, cooldown filtered)`);
    return selected;
  }, [tracks, filterCooldown]);

  const getAlreadyAssignedNames = useCallback(() => {
    const assigned = new Set();
    const songs = rotationSongsRef.current;
    if (songs) {
      Object.values(songs).forEach(trackList => {
        if (trackList) trackList.forEach(t => { if (t?.name) assigned.add(t.name); });
      });
    }
    return assigned;
  }, []);

  const resolveTrackByName = useCallback(async (trackName) => {
    try {
      const token = localStorage.getItem('djbooth_token');
      const res = await fetch(`/api/music/track-by-name/${encodeURIComponent(trackName)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) return null;
      const track = await res.json();
      return { ...track, url: `/api/music/stream/${track.id}` };
    } catch { return null; }
  }, []);

  const getDancerTracks = useCallback(async (dancer, additionalExcludes = [], skipAssigned = false, timeoutMs = 5000) => {
    const count = songsPerSetRef.current;
    const opts = djOptionsRef.current;
    const isFoldersOnly = opts?.musicMode === 'folders_only';

    // Only exclude songs already assigned to other dancers this cycle.
    // Server owns cooldown logic via play_history — do NOT send cooldown names here.
    // skipAssigned=true is used for bottom-of-rotation pre-picks: the dancer won't play
    // again for many transitions, so excluding other dancers' songs would over-restrict
    // a small playlist. Server cooldown handles the real anti-repeat work.
    const assignedNames = [];
    if (!skipAssigned) {
      const songs = rotationSongsRef.current;
      if (songs) {
        Object.values(songs).forEach(trackList => {
          if (trackList) trackList.forEach(t => { if (t?.name) assignedNames.push(t.name); });
        });
      }
    }

    const excludeNames = [...new Set([...assignedNames, ...additionalExcludes])];
    console.log(`🎵 getDancerTracks: ${dancer?.name || 'unknown'} — ${assignedNames.length} assigned + ${additionalExcludes.length} batch excluded (server handles cooldowns)`);

    const rawPlaylist = (!isFoldersOnly && dancer?.playlist?.length > 0) ? dancer.playlist : [];

    const dayShift = opts?.dayShift;
    const dayShiftOn = isDayShiftActive(dayShift);
    const dayShiftGenres = dayShift?.genres || [];
    const activeGenres = (dayShiftOn && dayShiftGenres.length > 0 && rawPlaylist.length === 0)
      ? dayShiftGenres
      : (opts?.activeGenres?.length > 0 ? opts.activeGenres : []);

    try {
      const token = localStorage.getItem('djbooth_token');
      const res = await fetch('/api/music/select', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          count,
          excludeNames,
          genres: activeGenres,
          dancerPlaylist: rawPlaylist
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (res.ok) {
        const data = await res.json();
        const result = data.tracks || [];
        console.log(`🎵 getDancerTracks: ${dancer?.name || 'unknown'} → [${result.map(t => t.name).join(', ')}] (${result.length} tracks, playlist: ${rawPlaylist.length})`);
        return result;
      }
    } catch (err) {
      console.warn(`⚠️ getDancerTracks: Server select failed for ${dancer?.name}: ${err.message}, using local fallback`);
    }

    // Local fallback (server unavailable) — playlist-strict, fresh first then oldest-cooldown
    // folders_only mode: rawPlaylist is [] so we return [] and caller uses random library (correct)
    const excludeSet = new Set(excludeNames);
    const cooldowns = songCooldownRef.current || {};
    const now = Date.now();

    if (rawPlaylist.length > 0) {
      const allPlaylistTracks = rawPlaylist
        .map(name => tracks.find(t => t.name === name && t.url))
        .filter(Boolean)
        .filter(t => !excludeSet.has(t.name));
      const freshTracks = allPlaylistTracks.filter(t => {
        const lp = cooldowns[t.name] || 0;
        return !lp || (now - lp) >= COOLDOWN_MS;
      });
      const cooldownTracks = allPlaylistTracks
        .filter(t => {
          const lp = cooldowns[t.name] || 0;
          return lp && (now - lp) < COOLDOWN_MS;
        })
        .sort((a, b) => (cooldowns[a.name] || 0) - (cooldowns[b.name] || 0)); // oldest-played first

      const combined = [...fisherYatesShuffle([...freshTracks]), ...cooldownTracks];
      if (combined.length > 0) {
        const result = combined.slice(0, count);
        console.log(`🎵 getDancerTracks: ${dancer?.name || 'unknown'} → [${result.map(t => t.name).join(', ')}] (local fallback, ${freshTracks.length} fresh + ${cooldownTracks.length} cooldown)`);
        return result;
      }
      console.warn(`⚠️ getDancerTracks: ${dancer?.name || 'unknown'} — no playlist tracks found in local library`);
      return [];
    }

    console.warn(`⚠️ getDancerTracks: ${dancer?.name || 'unknown'} has no playlist — returning empty`);
    return [];
  }, [tracks]);
  getDancerTracksRef.current = getDancerTracks;

  const restoredSongsRef = useRef(false);
  useEffect(() => {
    if (restoredSongsRef.current) return;
    if (!isRotationActive || rotation.length === 0 || tracks.length === 0 || dancers.length === 0) return;
    if (Object.keys(rotationSongsRef.current).length > 0) return;
    const allDancersExist = rotation.every(id => dancers.some(d => d.id === id));
    if (!allDancersExist) return;
    restoredSongsRef.current = true;
    const capturedRotation = [...rotation];
    (async () => {
      const selectedSongs = {};
      const batchExcludes = [];
      for (const dancerId of capturedRotation) {
        const dancer = dancers.find(d => d.id === dancerId);
        if (dancer) {
          const dancerTracks = await getDancerTracks(dancer, batchExcludes);
          selectedSongs[dancerId] = dancerTracks;
          dancerTracks.forEach(t => { if (t?.name) batchExcludes.push(t.name); });
        }
      }
      if (JSON.stringify(rotationRef.current) !== JSON.stringify(capturedRotation)) {
        console.log('🔄 Rotation changed during restore, discarding stale results');
        restoredSongsRef.current = false;
        return;
      }
      setRotationSongs(selectedSongs);
      rotationSongsRef.current = selectedSongs;
      console.log('🔄 Restored rotation song assignments after restart');
    })();
  }, [isRotationActive, rotation, tracks, dancers, getDancerTracks]);

  const playAnnouncement = useCallback(async (type, currentDancerName, nextDancerName = null, roundNumber = 1, audioOptions = {}) => {
    if (!announcementsEnabled) {
      console.log('Announcements disabled, skipping');
      return;
    }
    if (!announcementRef.current) {
      console.log('Announcement ref not ready, skipping');
      return;
    }
    console.log(`🎤 Playing ${type} announcement for ${currentDancerName} (round ${roundNumber})`);
    lastAudioActivityRef.current = Date.now();
    const ANNOUNCEMENT_TIMEOUT = 45000;
    try {
      await Promise.race([
        announcementRef.current.playAutoAnnouncement(type, currentDancerName, nextDancerName, roundNumber, audioOptions),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Announcement timed out after 45s')), ANNOUNCEMENT_TIMEOUT))
      ]);
      console.log(`✅ ${type} announcement completed`);
      lastAudioActivityRef.current = Date.now();
    } catch (error) {
      console.error('❌ Announcement failed:', error.message);
      lastAudioActivityRef.current = Date.now();
    }
  }, [announcementsEnabled]);

  const prefetchAnnouncement = useCallback(async (type, dancerName, nextDancerName = null, roundNumber = 1) => {
    if (!announcementsEnabled || !announcementRef.current?.getAnnouncementUrl) return null;
    try {
      const url = await Promise.race([
        announcementRef.current.getAnnouncementUrl(type, dancerName, nextDancerName, roundNumber),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Pre-fetch timeout')), 30000))
      ]);
      return url;
    } catch (error) {
      console.error('❌ Pre-fetch announcement failed:', error.message);
      return null;
    }
  }, [announcementsEnabled]);

  const playPrefetchedAnnouncement = useCallback(async (audioUrl) => {
    if (!audioUrl || !audioEngineRef.current) return;
    lastAudioActivityRef.current = Date.now();
    try {
      await Promise.race([
        audioEngineRef.current.playAnnouncement(audioUrl, { autoDuck: false }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Announcement playback timed out')), 30000))
      ]);
      lastAudioActivityRef.current = Date.now();
    } catch (error) {
      console.error('❌ Announcement playback failed:', error.message);
      lastAudioActivityRef.current = Date.now();
    }
  }, []);

  // Update stage in database
  const updateStageState = useCallback(async (index, newRotation) => {
    const rotationToSave = newRotation || rotation;
    if (activeStage) {
      await updateStageMutation.mutateAsync({
        id: activeStage.id,
        data: {
          rotation_order: rotationToSave,
          current_dancer_index: index,
          is_active: true
        }
      });
    } else if (rotationToSave.length > 0) {
      await localEntities.Stage.create({
        name: 'Main Stage',
        rotation_order: rotationToSave,
        current_dancer_index: index,
        is_active: true
      });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
    }
  }, [activeStage, rotation, updateStageMutation, queryClient]);
  updateStageStateRef.current = updateStageState;

  saveRotationRef.current = async (newRot) => {
    try {
      if (activeStage) {
        await updateStageMutation.mutateAsync({
          id: activeStage.id,
          data: { rotation_order: newRot, current_dancer_index: currentDancerIndexRef.current, is_active: true }
        });
      }
      console.log('💾 Remote saveRotation: persisted to DB');
    } catch (err) {
      console.error('❌ Remote saveRotation failed:', err);
    }
  };

  const beginRotation = useCallback(async () => {
    rotationPendingRef.current = false;
    setRotationPending(false);

    const rot = rotationRef.current;
    const dnc = dancersRef.current;
    if (rot.length === 0 || !tracks.length) {
      console.error('❌ BeginRotation: rotation.length=' + rot.length + ', tracks.length=' + tracks.length);
      return;
    }
    
    const dancerIds = new Set(dnc.map(d => d.id));
    const cleanRotation = rot.filter(id => dancerIds.has(id));
    if (cleanRotation.length !== rot.length) {
      console.log(`🧹 BeginRotation: cleaned ${rot.length - cleanRotation.length} stale IDs`);
      setRotation(cleanRotation);
      rotationRef.current = cleanRotation;
    }
    if (cleanRotation.length === 0) {
      console.error('❌ BeginRotation: no valid dancers in rotation after cleanup');
      return;
    }
    
    transitionInProgressRef.current = true;
    transitionStartTimeRef.current = Date.now();
    lastAudioActivityRef.current = Date.now();
    
    try {
    
    const existingSongs = rotationSongsRef.current || {};
    const selectedSongs = {};
    const batchExcludes = [];
    for (const dancerId of cleanRotation) {
      const dancer = dnc.find(d => d.id === dancerId);
      if (dancer) {
        const existing = existingSongs[dancerId];
        const dancerTracks = (existing && existing.length > 0) ? existing : await getDancerTracks(dancer, batchExcludes);
        selectedSongs[dancerId] = dancerTracks;
        dancerTracks.forEach(t => { if (t?.name) batchExcludes.push(t.name); });
      }
    }
    setRotationSongs(selectedSongs);
    rotationSongsRef.current = selectedSongs;
    
    setIsRotationActive(true);
    isRotationActiveRef.current = true;
    setCurrentDancerIndex(0);
    currentDancerIndexRef.current = 0;
    setCurrentSongNumber(1);
    currentSongNumberRef.current = 1;
    
    await updateStageState(0);
    
    const dancer = dnc.find(d => d.id === cleanRotation[0]);
    console.log('🎤 BeginRotation: First dancer:', dancer?.name);
    if (dancer) {
      let dancerTracks = selectedSongs[cleanRotation[0]];
      console.log('🎵 BeginRotation: Selected tracks for', dancer.name, ':', dancerTracks?.map(t => t.name));
      let firstTrack = dancerTracks?.[0];
      
      if (firstTrack && firstTrack.url) {
        console.log('🎵 BeginRotation: Playing first track:', firstTrack.name);
        lastAudioActivityRef.current = Date.now();
        const success = await playTrack(firstTrack.url, false, firstTrack.name, firstTrack.genre);
        if (success === false) {
          console.warn('⚠️ BeginRotation: First track failed, trying fallback');
          await playFallbackTrack(false);
        }
        lastAudioActivityRef.current = Date.now();
        if (announcementsEnabled) {
          console.log('🎤 BeginRotation: Pre-fetching intro then ducking');
          const announcementPromise = prefetchAnnouncement('intro', dancer.name, null, 1);
          audioEngineRef.current?.duck();
          const [, announcementUrl] = await Promise.all([waitForDuck(), announcementPromise]);
          await playPrefetchedAnnouncement(announcementUrl);
          audioEngineRef.current?.unduck();
        }
      } else {
        console.warn('⚠️ BeginRotation: No valid track, trying fallback');
        lastAudioActivityRef.current = Date.now();
        await playFallbackTrack(false);
        lastAudioActivityRef.current = Date.now();
        if (announcementsEnabled) {
          const announcementPromise = prefetchAnnouncement('intro', dancer.name, null, 1);
          audioEngineRef.current?.duck();
          const [, announcementUrl] = await Promise.all([waitForDuck(), announcementPromise]);
          await playPrefetchedAnnouncement(announcementUrl);
          audioEngineRef.current?.unduck();
        }
      }
    }
    } catch (err) {
      console.error('❌ BeginRotation error:', err);
      audioEngineRef.current?.unduck();
      const ok = await playFallbackTrack(false);
      if (!ok) {
        try { audioEngineRef.current?.resume(); } catch(e) {}
      }
    } finally {
      transitionInProgressRef.current = false;
    }
  }, [getDancerTracks, playTrack, playFallbackTrack, tracks, playAnnouncement, prefetchAnnouncement, playPrefetchedAnnouncement, updateStageState]);

  const lastRotationToggleRef = useRef(0);
  const lastAnnouncementsToggleRef = useRef(0);
  const startRotation = useCallback(async () => {
    const now = Date.now();
    if (now - lastRotationToggleRef.current < 2000) return;
    lastRotationToggleRef.current = now;
    if (rotation.length === 0 || !tracks.length) {
      console.error('❌ StartRotation: rotation.length=' + rotation.length + ', tracks.length=' + tracks.length);
      return;
    }

    // Always clear stale pre-picks from localStorage/previous session so beginRotation
    // always calls getDancerTracks fresh — regardless of whether we start immediately
    // or queue to start after the current song ends.
    rotationSongsRef.current = {};
    setRotationSongs({});

    const isPlaying = audioEngineRef.current?.isPlaying;
    if (isPlaying) {
      console.log('🎵 StartRotation: Music playing — queuing rotation to start after current song ends');
      rotationPendingRef.current = true;
      setRotationPending(true);
      return;
    }

    if (announcementRef.current?.preCacheForRotationStart && announcementsEnabled) {
      const rotationDancers = rotation
        .map(id => dancersRef.current.find(d => d.id === id))
        .filter(Boolean);

      if (rotationDancers.length > 0) {
        setPreCachingForStart(true);
        setPreCacheStartProgress({ completed: 0, total: 0, dancersDone: 0, dancersTotal: rotationDancers.length, phase: 'buffer' });
        console.log(`🔄 Pre-caching ${rotationDancers.length} entertainers before rotation start...`);

        await announcementRef.current.preCacheForRotationStart(
          rotationDancers,
          (progress) => setPreCacheStartProgress(progress),
          2
        );
        setPreCachingForStart(false);
      }
    }

    await beginRotation();
  }, [rotation, tracks, beginRotation, announcementsEnabled]);
  beginRotationRef.current = startRotation;

  const isCommercialDue = useCallback(() => {
    const freq = localStorage.getItem('neonaidj_commercial_freq') || 'off';
    if (freq === 'off') return false;
    const freqNum = parseInt(freq);
    if (!freqNum || freqNum < 1) return false;
    const nextCount = commercialCounterRef.current + 1;
    if (nextCount % freqNum !== 0) return false;
    const curIdx = currentDancerIndexRef.current;
    const commercialId = `commercial-after-${curIdx}`;
    try {
      const skippedRaw = localStorage.getItem('neonaidj_skipped_commercials');
      if (skippedRaw) {
        const skipped = JSON.parse(skippedRaw);
        if (Array.isArray(skipped) && skipped.includes(commercialId)) return false;
      }
    } catch {}
    return true;
  }, []);

  const playCommercialIfDue = useCallback(async () => {
    const freq = localStorage.getItem('neonaidj_commercial_freq') || 'off';
    if (freq === 'off') return false;
    const freqNum = parseInt(freq);
    if (!freqNum || freqNum < 1) return false;

    commercialCounterRef.current += 1;
    if (commercialCounterRef.current % freqNum !== 0) return false;

    const curIdx = currentDancerIndexRef.current;
    const commercialId = `commercial-after-${curIdx}`;
    try {
      const skippedRaw = localStorage.getItem('neonaidj_skipped_commercials');
      if (skippedRaw) {
        const skipped = JSON.parse(skippedRaw);
        if (Array.isArray(skipped) && skipped.includes(commercialId)) {
          const remaining = skipped.filter(id => id !== commercialId);
          localStorage.setItem('neonaidj_skipped_commercials', JSON.stringify(remaining));
          console.log('📺 Commercial skipped (removed by DJ):', commercialId);
          return false;
        }
      }
    } catch {}

    try {
      const token = localStorage.getItem('djbooth_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const promoTrackRes = await fetch(`/api/music/tracks?genre=${encodeURIComponent('Promos')}&limit=200`, { headers });
      if (promoTrackRes.ok) {
        const promoTrackData = await promoTrackRes.json();
        const promoTracks = promoTrackData.tracks || [];
        if (promoTracks.length > 0) {
          const promoTrackNames = promoTracks.map(t => t.name).sort();
          const pQueue = promoShuffleRef.current;
          const pQueueValid = pQueue.length > 0 && pQueue.every(k => promoTrackNames.includes(k));
          if (!pQueueValid) {
            const shuffled = [...promoTrackNames];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            promoShuffleRef.current = shuffled;
          }
          const nextName = promoShuffleRef.current.shift() || promoTrackNames[0];
          setPromoQueue([...promoShuffleRef.current]);
          const promoTrack = promoTracks.find(t => t.name === nextName) || promoTracks[0];
          if (!audioEngineRef.current) return false;
          const promoStreamUrl = `/api/music/stream/${promoTrack.id}`;
          commercialModeRef.current = 'new';
          playingCommercialRef.current = true;
          lastAudioActivityRef.current = Date.now();
          const keepAlive = setInterval(() => { lastAudioActivityRef.current = Date.now(); }, 2000);
          const commercialDone = new Promise(resolve => {
            commercialEndResolverRef.current = () => resolve();
          });
          try {
            console.log(`📺 Pre-mixed promo (as track): "${promoTrack.name}"`);
            await playTrack(promoStreamUrl, false, promoTrack.name, 'Promos');
            await commercialDone;
          } finally {
            clearInterval(keepAlive);
            playingCommercialRef.current = false;
            commercialEndResolverRef.current = null;
            lastAudioActivityRef.current = Date.now();
          }
          return true;
        }
      }

      commercialModeRef.current = 'old';
      const res = await fetch('/api/voiceovers', { headers });
      if (!res.ok) return false;
      const all = await res.json();
      const promos = all.filter(v => v.type === 'promo' || v.type === 'manual');
      if (promos.length === 0) return false;

      const promoKeys = promos.map(p => p.cache_key).sort();
      const promoFingerprint = promoKeys.join('|');
      const currentQueue = promoShuffleRef.current;
      const queueValid = currentQueue.length > 0 && currentQueue.every(key => promoKeys.includes(key)) && promoQueueFingerprintRef.current === promoFingerprint;
      if (!queueValid) {
        const shuffled = [...promoKeys];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        promoShuffleRef.current = shuffled;
        promoQueueFingerprintRef.current = promoFingerprint;
      }
      const nextKey = promoShuffleRef.current.shift();
      setPromoQueue([...promoShuffleRef.current]);
      const promo = promos.find(p => p.cache_key === nextKey) || promos[0];
      const promoName = promo.dancer_name || promo.cache_key;

      const audioRes = await fetch(`/api/voiceovers/audio/${encodeURIComponent(promo.cache_key)}`, { headers });
      if (!audioRes.ok) {
        console.warn('⚠️ Commercial voiceover fetch failed:', audioRes.status);
        return false;
      }
      const voiceBlob = await audioRes.blob();
      const voiceoverUrl = URL.createObjectURL(voiceBlob);

      if (!audioEngineRef.current) {
        console.warn('⚠️ AudioEngine not ready — skipping commercial');
        URL.revokeObjectURL(voiceoverUrl);
        return false;
      }

      const bedsRes = await fetch(`/api/music/tracks?genre=${encodeURIComponent('Promo Beds')}&limit=200`, { headers });
      let bedTrack = null;
      if (bedsRes.ok) {
        const bedsData = await bedsRes.json();
        const beds = bedsData.tracks || [];
        if (beds.length > 0) {
          bedTrack = beds[Math.floor(Math.random() * beds.length)];
        }
      }

      if (!bedTrack) {
        console.warn('⚠️ No Promo Beds tracks found — playing voiceover only');
        playingCommercialRef.current = true;
        lastAudioActivityRef.current = Date.now();
        const keepAlive = setInterval(() => { lastAudioActivityRef.current = Date.now(); }, 2000);
        try {
          await audioEngineRef.current?.playAnnouncement(voiceoverUrl, { autoDuck: true });
        } finally {
          clearInterval(keepAlive);
          playingCommercialRef.current = false;
          lastAudioActivityRef.current = Date.now();
          setTimeout(() => URL.revokeObjectURL(voiceoverUrl), 5000);
        }
        return true;
      }

      console.log(`📺 Commercial: "${promoName}" over bed "${bedTrack.name}"`);
      playingCommercialRef.current = true;
      lastAudioActivityRef.current = Date.now();

      const keepAlive = setInterval(() => { lastAudioActivityRef.current = Date.now(); }, 2000);
      let commercialSkipped = false;

      const skipPromise = new Promise(resolve => {
        commercialEndResolverRef.current = () => { commercialSkipped = true; resolve(); };
      });

      const raceDelay = (ms) => Promise.race([new Promise(r => setTimeout(r, ms)), skipPromise]);

      try {
        const bedUrl = `/api/music/stream/${bedTrack.id}`;
        const trackOk = await playTrack(bedUrl, false, `📺 ${promoName}`, 'Promo Beds');
        if (!trackOk) {
          console.warn('⚠️ Commercial bed track failed');
          playingCommercialRef.current = false;
          clearInterval(keepAlive);
          URL.revokeObjectURL(voiceoverUrl);
          return false;
        }

        await raceDelay(9000);

        if (!commercialSkipped) {
          await Promise.race([
            audioEngineRef.current?.playAnnouncement(voiceoverUrl, { autoDuck: true }),
            skipPromise
          ]);
        }

        if (!commercialSkipped) {
          await raceDelay(9000);
        }
      } finally {
        clearInterval(keepAlive);
        playingCommercialRef.current = false;
        commercialEndResolverRef.current = null;
        lastAudioActivityRef.current = Date.now();
        setTimeout(() => URL.revokeObjectURL(voiceoverUrl), 5000);
      }
      return true;
    } catch (err) {
      playingCommercialRef.current = false;
      commercialEndResolverRef.current = null;
      console.warn('⚠️ Commercial playback failed:', err.message);
      return false;
    }
  }, [playTrack]);

  const refreshPromoQueue = useCallback(async () => {
    try {
      const token = localStorage.getItem('djbooth_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/voiceovers', { headers });
      if (!res.ok) return;
      const all = await res.json();
      const promos = all.filter(v => v.type === 'promo' || v.type === 'manual');
      setAvailablePromos(promos);

      const promoKeys = promos.map(p => p.cache_key).sort();
      const promoFingerprint = promoKeys.join('|');
      const currentQueue = promoShuffleRef.current;
      const queueValid = currentQueue.length > 0 && currentQueue.every(key => promoKeys.includes(key)) && promoQueueFingerprintRef.current === promoFingerprint;
      if (!queueValid) {
        const shuffled = [...promoKeys];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        promoShuffleRef.current = shuffled;
        promoQueueFingerprintRef.current = promoFingerprint;
      }
      setPromoQueue([...promoShuffleRef.current]);
    } catch {}
  }, []);

  useEffect(() => {
    refreshPromoQueue();
    const interval = setInterval(refreshPromoQueue, 30000);
    return () => clearInterval(interval);
  }, [refreshPromoQueue]);

  const swapPromoAtSlot = useCallback((slotIndex) => {
    if (availablePromos.length <= 1) return;
    const queue = [...promoShuffleRef.current];
    if (slotIndex < 0 || slotIndex >= queue.length) return;
    const currentKey = queue[slotIndex];
    const allKeys = availablePromos.map(p => p.cache_key).sort();
    const currentIdx = allKeys.indexOf(currentKey);
    const nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % allKeys.length;
    queue[slotIndex] = allKeys[nextIdx];
    promoShuffleRef.current = queue;
    setPromoQueue([...queue]);
  }, [availablePromos]);

  useEffect(() => {
    swapPromoRef.current = swapPromoAtSlot;
  }, [swapPromoAtSlot]);

  const lastSkipTimeRef = useRef(0);
  const handleSkip = useCallback(async () => {
    const now = Date.now();
    if (now - lastSkipTimeRef.current < 2000) return;
    lastSkipTimeRef.current = now;
    auditEvent('skip_song');
    if (playingCommercialRef.current) {
      console.log('📺 HandleSkip: Skipping commercial');
      if (audioEngineRef.current) {
        audioEngineRef.current.stopVoice();
        audioEngineRef.current.pauseAll();
      }
      commercialEndResolverRef.current?.();
      return;
    }
    if (watchdogRecoveringRef.current) {
      console.log('⏳ HandleSkip: Watchdog recovery in progress, skipping');
      return;
    }
    if (transitionInProgressRef.current) {
      const elapsed = Date.now() - transitionStartTimeRef.current;
      if (elapsed < 30000) return;
      console.warn('⚠️ HandleSkip: Transition lock stuck for', Math.round(elapsed/1000), 's — forcing clear');
      transitionInProgressRef.current = false;
    }
    
    if (!isRotationActiveRef.current) {
      if (rotationPendingRef.current) {
        console.log('⏭️ HandleSkip: Rotation pending — starting rotation now');
        await beginRotation();
        return;
      }
      lastAudioActivityRef.current = Date.now();
      try {
        if (autoplayQueueRef.current.length > 0) {
          console.log('⏭️ HandleSkip (no rotation): Playing from autoplay queue');
          const ok = await playFromAutoplayQueue(true);
          if (ok === false) {
            const fallbackOk = await playFallbackTrack(true);
            if (!fallbackOk) audioEngineRef.current?.resume();
          }
        } else {
          const ok = await playFallbackTrack(true);
          if (!ok) {
            console.error('🚨 HandleSkip (no rotation): All recovery failed — resuming active deck');
            audioEngineRef.current?.resume();
          }
        }
      } catch (err) {
        console.error('🚨 HandleSkip (no rotation): Unexpected error:', err);
        try { audioEngineRef.current?.resume(); } catch(e) {}
      }
      return;
    }
    
    if (playingInterstitialRef.current) {
      const rot = rotationRef.current;
      const idx = currentDancerIndexRef.current;
      const currentDancerId = rot[idx];
      const breakKey = playingInterstitialBreakKeyRef.current || `after-${currentDancerId}`;
      const breakSongs = interstitialSongsRef.current[breakKey] || [];
      const breakIdx = interstitialIndexRef.current;

      if (breakIdx < breakSongs.length) {
        const nextBreakName = breakSongs[breakIdx];
        let nextBreakTrack = tracks.find(t => t.name === nextBreakName && t.url);
        if (!nextBreakTrack?.url) {
          nextBreakTrack = tracks.find(t => t.url && (
            t.name === nextBreakName ||
            t.name.replace(/\.[^.]+$/, '') === nextBreakName.replace(/\.[^.]+$/, '')
          ));
        }
        if (!nextBreakTrack?.url) {
          nextBreakTrack = await resolveTrackByName(nextBreakName);
        }
        if (nextBreakTrack?.url) {
          console.log('⏭️ HandleSkip: Skipping to next break song:', nextBreakTrack.name);
          interstitialIndexRef.current = breakIdx + 1;
          setActiveBreakInfo({ songs: breakSongs, currentIndex: breakIdx, breakKey });
          lastAudioActivityRef.current = Date.now();
          const ok = await playTrack(nextBreakTrack.url, false, nextBreakTrack.name, nextBreakTrack.genre);
          if (!ok) await playFallbackTrack(false);
          transitionInProgressRef.current = false;
          return;
        }
      }

      playingInterstitialRef.current = false;
      playingInterstitialBreakKeyRef.current = null;
      interstitialIndexRef.current = 0;
      setActiveBreakInfo(null);
      console.log('⏭️ HandleSkip: No more break songs, advancing to next dancer');
      const clearedInterstitials = { ...interstitialSongsRef.current };
      delete clearedInterstitials[breakKey];
      interstitialSongsRef.current = clearedInterstitials;
      setInterstitialSongsState(clearedInterstitials);
      setInterstitialRemoteVersion(v => v + 1);
      try { localStorage.setItem('djbooth_interstitial_songs', JSON.stringify(clearedInterstitials)); } catch {}
    }

    transitionInProgressRef.current = true;
    transitionStartTimeRef.current = Date.now();
    lastAudioActivityRef.current = Date.now();
    
    const idx = currentDancerIndexRef.current;
    const songNum = currentSongNumberRef.current;
    const songs = rotationSongsRef.current;
    const rot = rotationRef.current;
    const dnc = dancersRef.current;
    
    const dancer = dnc.find(d => d.id === rot[idx]);
    if (!dancer) {
      console.warn('⚠️ HandleSkip: dancer not found, falling back to random');
      transitionInProgressRef.current = false;
      await playFallbackTrack(false);
      return;
    }
    
    let dancerTracks = songs[rot[idx]];
    if (!dancerTracks || dancerTracks.length === 0) {
      console.log('🎵 HandleSkip: no pre-selected tracks for', dancer.name, ', auto-selecting via getDancerTracks');
      try {
        dancerTracks = await getDancerTracks(dancer);
        if (dancerTracks && dancerTracks.length > 0) {
          const updatedSongs = { ...rotationSongsRef.current, [rot[idx]]: dancerTracks };
          setRotationSongs(updatedSongs);
          rotationSongsRef.current = updatedSongs;
        }
      } catch (err) {
        console.warn('⚠️ HandleSkip: getDancerTracks failed for', dancer.name, ':', err.message);
      }
      if (!dancerTracks || dancerTracks.length === 0) {
        console.warn('⚠️ HandleSkip: still no tracks for', dancer.name, ', falling back');
        transitionInProgressRef.current = false;
        await playFallbackTrack(false);
        return;
      }
    }
    
    const dancerSongCountSkip = dancerTracks.length;

    try {
      if (songNum < songsPerSetRef.current && songNum < dancerSongCountSkip) {
        let nextTrack = dancerTracks[songNum];
        const newSongNum = songNum + 1;
        currentSongNumberRef.current = newSongNum;
        setCurrentSongNumber(newSongNum);
        
        if (nextTrack && !nextTrack.url && nextTrack.name) {
          let fresh = tracks.find(t => t.name === nextTrack.name && t.url);
          if (!fresh) fresh = await resolveTrackByName(nextTrack.name);
          if (fresh) {
            nextTrack = fresh;
            dancerTracks[songNum] = fresh;
          }
        }
        
        if (!nextTrack || !nextTrack.url) {
          // Never silently switch to a different song mid-set — that causes display mismatch.
          // If the pre-assigned track URL is unresolvable, play a brief fallback and keep the rotation intact.
          console.warn('⚠️ HandleSkip: Track URL unresolvable for index', songNum, '— playing fallback without changing assignment');
          await playFallbackTrack(false);
          if (announcementsEnabled) audioEngineRef.current?.unduck();
          transitionInProgressRef.current = false;
          return;
        }

        // Sync crowd display to the current dancer BEFORE announcing.
        // Without this, RotationDisplay keeps showing the previously removed dancer.
        updateStageState(idx, rot);
        fetch('/api/stage/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rotation_order: rot, current_dancer_index: idx, is_active: true })
        }).catch(() => {});

        if (announcementsEnabled) {
          const announcementType = songNum === 0 ? 'intro' : 'round2';
          const announcementPromise = prefetchAnnouncement(announcementType, dancer.name, null, newSongNum);
          audioEngineRef.current?.duck();
          const [, announcementUrl] = await Promise.all([waitForDuck(), announcementPromise]);
          await playPrefetchedAnnouncement(announcementUrl);
          if (nextTrack?.url) {
            console.log('🎵 HandleSkip: Switching to next track after announcement:', nextTrack.name);
            const trackOk = await playTrack(nextTrack.url, false, nextTrack.name, nextTrack.genre);
            if (!trackOk) {
              console.warn('⚠️ HandleSkip: playTrack failed, trying fallback');
              await playFallbackTrack(false);
            }
          } else {
            await playFallbackTrack(false);
          }
          audioEngineRef.current?.unduck();
        } else {
          if (nextTrack?.url) {
            console.log('🎵 HandleSkip: Playing next track:', nextTrack.name);
            await playTrack(nextTrack.url, true, nextTrack.name, nextTrack.genre);
          } else {
            await playFallbackTrack(true);
          }
        }
      } else {
        const breakKey = `after-${rot[idx]}`;
        let breakSongs = interstitialSongsRef.current[breakKey] || [];

        if (breakSongs.length === 0 && breakSongsPerSetRef.current > 0) {
          try {
            const token = localStorage.getItem('djbooth_token');
            const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
            const cooldowns = songCooldownRef.current || {};
            const nowMs = Date.now();
            const cooldownNames = Object.entries(cooldowns)
              .filter(([, ts]) => ts && (nowMs - ts) < COOLDOWN_MS)
              .map(([name]) => name);
            const assignedNames = Object.values(rotationSongsRef.current).flat().map(t => t.name);
            const excludeNames = [...new Set([...cooldownNames, ...assignedNames])];
            const _dsSkip = djOptionsRef.current?.dayShift;
            const _dsSkipOn = isDayShiftActive(_dsSkip);
            const _dsSkipGenres = _dsSkip?.genres || [];
            const activeGenres = (_dsSkipOn && _dsSkipGenres.length > 0)
              ? _dsSkipGenres
              : (djOptionsRef.current?.activeGenres?.length > 0 ? djOptionsRef.current.activeGenres : []);
            const res = await fetch('/api/music/select', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                count: breakSongsPerSetRef.current,
                excludeNames,
                genres: activeGenres,
                dancerPlaylist: []
              }),
              signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
              const data = await res.json();
              breakSongs = (data.tracks || []).map(t => t.name);
              console.log('🎵 HandleSkip: Auto-selected', breakSongs.length, 'break song(s):', breakSongs);
              interstitialSongsRef.current = { ...interstitialSongsRef.current, [breakKey]: breakSongs };
              setInterstitialSongsState({ ...interstitialSongsRef.current });
              setInterstitialRemoteVersion(v => v + 1);
              try { localStorage.setItem('djbooth_interstitial_songs', JSON.stringify(interstitialSongsRef.current)); } catch {}
            }
          } catch (err) {
            console.warn('⚠️ HandleSkip: Failed to auto-select break songs:', err.message);
          }
        }

        if (breakSongs.length > 0) {
          console.log('🎵 HandleSkip: Playing', breakSongs.length, 'break song(s) after', dancer.name, '| Songs:', breakSongs);

          const flippedRotation = [...rotationRef.current];
          const [finishedId] = flippedRotation.splice(idx, 1);
          flippedRotation.push(finishedId);
          setRotation(flippedRotation);
          rotationRef.current = flippedRotation;
          setCurrentDancerIndex(0);
          currentDancerIndexRef.current = 0;
          setCurrentSongNumber(0);
          currentSongNumberRef.current = 0;
          const clearedSongs = { ...rotationSongsRef.current };
          delete clearedSongs[finishedId];
          rotationSongsRef.current = clearedSongs;
          updateStageState(0, flippedRotation);

          playingInterstitialRef.current = true;
          playingInterstitialBreakKeyRef.current = breakKey;
          interstitialIndexRef.current = 1;
          setActiveBreakInfo({ songs: breakSongs, currentIndex: 0, breakKey });
          const firstBreakName = breakSongs[0];
          let firstBreakTrack = tracks.find(t => t.name === firstBreakName && t.url);
          if (!firstBreakTrack?.url) {
            firstBreakTrack = tracks.find(t => t.url && (
              t.name === firstBreakName || 
              t.name.replace(/\.[^.]+$/, '') === firstBreakName.replace(/\.[^.]+$/, '')
            ));
          }
          if (!firstBreakTrack?.url) {
            firstBreakTrack = await resolveTrackByName(firstBreakName);
          }

          if (announcementsEnabled) {
            const announcementPromise = prefetchAnnouncement('outro', dancer.name, null, 1);
            audioEngineRef.current?.duck();
            const [, announcementUrl] = await Promise.all([waitForDuck(), announcementPromise]);
            const announcementDone = playPrefetchedAnnouncement(announcementUrl);
            await Promise.race([announcementDone, new Promise(r => setTimeout(r, SONG_OVERLAP_DELAY_MS))]);
            if (firstBreakTrack?.url) {
              console.log('🎵 HandleSkip: Playing break song during outro:', firstBreakTrack.name);
              lastAudioActivityRef.current = Date.now();
              const ok = await playTrack(firstBreakTrack.url, false, firstBreakTrack.name, firstBreakTrack.genre);
              if (!ok) await playFallbackTrack(false);
            } else {
              console.error('❌ HandleSkip: Could not resolve break song:', firstBreakName);
              await playFallbackTrack(false);
            }
            await announcementDone;
            audioEngineRef.current?.unduck();
          } else {
            if (firstBreakTrack?.url) {
              console.log('🎵 HandleSkip: Playing break song:', firstBreakTrack.name);
              lastAudioActivityRef.current = Date.now();
              const ok = await playTrack(firstBreakTrack.url, true, firstBreakTrack.name, firstBreakTrack.genre);
              if (!ok) await playFallbackTrack(true);
            } else {
              console.error('❌ HandleSkip: Could not resolve break song:', firstBreakName);
              await playFallbackTrack(true);
            }
          }

          transitionInProgressRef.current = false;
          return;
        }

        const newRotation = [...rot];
        const [finishedDancerId] = newRotation.splice(idx, 1);
        // Check if this dancer is pending VIP — if so, send to holding instead of bottom of rotation
        const vipDuration = pendingVipRef.current[finishedDancerId];
        if (vipDuration) {
          delete pendingVipRef.current[finishedDancerId];
          setPendingVipState({ ...pendingVipRef.current });
          const expiresAt = Date.now() + vipDuration;
          const newVipMap = { ...dancerVipMapRef.current, [finishedDancerId]: { expiresAt, duration: vipDuration } };
          dancerVipMapRef.current = newVipMap;
          setDancerVipMap(newVipMap);
          try { localStorage.setItem('neonaidj_vip_map', JSON.stringify(newVipMap)); } catch {}
          const vipDancer = dnc.find(d => d.id === finishedDancerId);
          console.log('👑 HandleSkip: dancer going to VIP holding:', vipDancer?.name);
          toast(`${vipDancer?.name || 'Entertainer'} is now In VIP`, { icon: '👑' });
        } else {
          newRotation.push(finishedDancerId);
        }
        
        const newIdx = 0;
        const nextDancer = dnc.find(d => d.id === newRotation[newIdx]);
        
        if (!nextDancer) {
          console.warn('⚠️ HandleSkip: next dancer not found, falling back');
          await playFallbackTrack(false);
          transitionInProgressRef.current = false;
          return;
        }

        // Apply rotation immediately so any DJ reorders during the async transition land on top
        setRotation(newRotation);
        rotationRef.current = newRotation;
        const finishedIdx = newRotation.length - 1;
        setCurrentDancerIndex(finishedIdx);
        currentDancerIndexRef.current = finishedIdx;

        const _skipTransStart = Date.now();
        logDiag('transition_start', { from: dancer.name, to: nextDancer.name, trigger: 'skip' });

        const outroPromise = announcementsEnabled ? prefetchAnnouncement('outro', dancer.name, null, 1) : Promise.resolve(null);
        if (announcementsEnabled) audioEngineRef.current?.duck();

        const djSaved = djSavedSongsRef.current[finishedDancerId];
        const djSavedValid = djSaved && djSaved.length >= songsPerSetRef.current && djSaved.every(t => t.url);
        if (djSavedValid) delete djSavedSongsRef.current[finishedDancerId];
        const scratchSongs = { ...rotationSongsRef.current };
        delete scratchSongs[finishedDancerId];
        rotationSongsRef.current = scratchSongs;
        const existingTracks = scratchSongs[newRotation[newIdx]];
        // Filter stale pre-picks: remove any tracks now inside the 4-hour cooldown window
        const validPrePicks = existingTracks
          ? existingTracks.filter(t => {
              if (!t?.url) return false;
              const lp = songCooldownRef.current?.[t.name];
              return !lp || (Date.now() - lp) >= COOLDOWN_MS;
            })
          : null;
        const finishedDancer = dnc.find(d => d.id === finishedDancerId);
        const playingTrackExclude = currentTrackRef.current ? [currentTrackRef.current] : [];
        const bgPick = bgPrePickRef.current?.dancerId === finishedDancerId ? bgPrePickRef.current : null;
        bgPrePickRef.current = null;
        const [freshTracks, prePicked] = await Promise.all([
          (() => { const _ev = validPrePicks && validPrePicks.length >= songsPerSetRef.current; if (_ev) { prePickHitsRef.current++; logDiag('prepick_hit', { dancer: nextDancer.name }); } else { prePickMissesRef.current++; logDiag('prepick_miss', { dancer: nextDancer.name }); } return _ev ? Promise.resolve(validPrePicks) : getDancerTracks(nextDancer); })(),
          djSavedValid
            ? (console.log(`🎵 Pre-pick for ${finishedDancer?.name}: using DJ-saved songs`), Promise.resolve(djSaved))
            : finishedDancer
              ? bgPick
                ? (console.log(`🎵 Pre-pick for ${finishedDancer.name}: using background pre-pick`), bgPick.promise.catch(() => []))
                : getDancerTracks(finishedDancer, playingTrackExclude, true, 1500).catch(e => {
                    console.warn('⚠️ Pre-pick failed for', finishedDancer.name, e.message);
                    return [];
                  })
              : Promise.resolve([])
        ]);
        let nextTrack = freshTracks?.[0];

        const updatedSongs = { ...rotationSongsRef.current, [newRotation[newIdx]]: freshTracks };
        if (prePicked && prePicked.length > 0) {
          updatedSongs[finishedDancerId] = prePicked;
          console.log(`🎵 Pre-picked for ${finishedDancer?.name} (bottom): [${prePicked.map(t => t.name).join(', ')}]`);
        } else {
          delete updatedSongs[finishedDancerId];
        }
        setRotationSongs(updatedSongs);
        rotationSongsRef.current = updatedSongs;

        if (announcementsEnabled) {
          const [outroUrl] = await Promise.all([outroPromise, waitForDuck()]);
          await playPrefetchedAnnouncement(outroUrl);
        }

        lastAudioActivityRef.current = Date.now();
        if (nextTrack && nextTrack.url) {
          console.log('🎵 HandleSkip: Switching to next dancer:', nextDancer.name, 'track:', nextTrack.name);
          logDiag('track_play', { dancer: nextDancer.name, track: nextTrack.name, gapMs: Date.now() - _skipTransStart });
          const trackOk = await playTrack(nextTrack.url, true, nextTrack.name, nextTrack.genre);
          if (!trackOk) await playFallbackTrack(true);
        } else {
          logDiag('track_play_fallback', { dancer: nextDancer.name, reason: 'no_url' });
          await playFallbackTrack(true);
        }

        if (announcementsEnabled) {
          audioEngineRef.current?.unduck();
        }

        lastAudioActivityRef.current = Date.now();
        lastTransitionMsRef.current = Date.now() - _skipTransStart;
        logDiag('transition_complete', { dancer: nextDancer.name, durationMs: lastTransitionMsRef.current, trigger: 'skip' });

        const commercialPlayed = await playCommercialIfDue();
        if (commercialPlayed) {
          transitionStartTimeRef.current = Date.now();
          lastAudioActivityRef.current = Date.now();
          if (nextTrack && nextTrack.url) {
            const trackOk = await playTrack(nextTrack.url, true, nextTrack.name, nextTrack.genre);
            if (!trackOk) await playFallbackTrack(true);
          } else {
            await playFallbackTrack(true);
          }
        }

        if (announcementsEnabled) {
          const introPromise = prefetchAnnouncement('intro', nextDancer.name, null, 1);
          audioEngineRef.current?.duck();
          const [, introUrl] = await Promise.all([waitForDuck(), introPromise]);
          lastAudioActivityRef.current = Date.now();
          if (introUrl) {
            await playPrefetchedAnnouncement(introUrl);
          }
          audioEngineRef.current?.unduck();
        }

        const finalRot = rotationRef.current;
        const finalIdx = finalRot.indexOf(nextDancer.id);
        const resolvedIdx = finalIdx !== -1 ? finalIdx : 0;
        currentDancerIndexRef.current = resolvedIdx;
        currentSongNumberRef.current = 1;
        setCurrentDancerIndex(resolvedIdx);
        setCurrentSongNumber(1);
        await updateStageState(resolvedIdx, finalRot);
      }
    } catch (error) {
      console.error('❌ HandleSkip error, falling back to random track:', error);
      audioEngineRef.current?.unduck();
      const ok = await playFallbackTrack(true);
      if (!ok) {
        console.error('🚨 HandleSkip: All recovery failed — resuming active deck');
        audioEngineRef.current?.resume();
      }
    } finally {
      transitionInProgressRef.current = false;
    }
  }, [playTrack, playFallbackTrack, playAnnouncement, prefetchAnnouncement, playPrefetchedAnnouncement, playCommercialIfDue, playFromAutoplayQueue, updateStageState, tracks, filterCooldown, announcementsEnabled, getDancerTracks]);
  handleSkipRef.current = handleSkip;

  const [showDeactivatePin, setShowDeactivatePin] = useState(false);
  const [deactivatePin, setDeactivatePin] = useState('');
  const deactivatePinInputRef = useRef(null);

  const handleDeactivateClick = useCallback(() => {
    if (!currentTrack) {
      toast.error('No song currently playing');
      return;
    }
    setDeactivatePin('');
    setShowDeactivatePin(true);
    setTimeout(() => deactivatePinInputRef.current?.focus(), 100);
  }, [currentTrack]);

  const handleDeactivateConfirm = useCallback(async () => {
    if (!deactivatePin || deactivatePin.length !== 5) {
      toast.error('Enter your 5-digit PIN');
      return;
    }
    try {
      const verifyRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'dj', pin: deactivatePin })
      });
      if (!verifyRes.ok) {
        toast.error('Incorrect PIN');
        setDeactivatePin('');
        deactivatePinInputRef.current?.focus();
        return;
      }
    } catch {
      toast.error('PIN verification failed');
      return;
    }
    setShowDeactivatePin(false);
    setDeactivatePin('');
    const trackName = currentTrack;
    if (!trackName) return;
    try {
      const token = localStorage.getItem('djbooth_token');
      const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const res = await fetch('/api/music/block', {
        method: 'POST',
        headers,
        body: JSON.stringify({ trackName })
      });
      if (res.ok) {
        toast.success(`Deactivated: ${trackName}`);
        // Purge this song from all pre-picked rotation sets so it can't sneak in via the cache
        const cleaned = {};
        for (const [dancerId, songs] of Object.entries(rotationSongsRef.current)) {
          const filtered = (songs || []).filter(t => t?.name !== trackName);
          cleaned[dancerId] = filtered;
        }
        rotationSongsRef.current = cleaned;
        setRotationSongs(cleaned);
        handleSkipRef.current?.();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to deactivate');
      }
    } catch (err) {
      toast.error('Failed to deactivate: ' + err.message);
    }
  }, [currentTrack, deactivatePin]);

  const handleTrackEnd = useCallback(async () => {
    if (playingCommercialRef.current) {
      console.log('📺 HandleTrackEnd: Commercial finished — resolving');
      commercialEndResolverRef.current?.();
      return;
    }
    if (watchdogRecoveringRef.current) {
      console.log('⏳ HandleTrackEnd: Watchdog recovery in progress, skipping');
      return;
    }
    if (transitionInProgressRef.current) {
      const elapsed = Date.now() - transitionStartTimeRef.current;
      if (elapsed < 30000) return;
      console.warn('⚠️ HandleTrackEnd: Transition lock stuck for', Math.round(elapsed/1000), 's — forcing clear');
      transitionInProgressRef.current = false;
    }
    
    if (!isRotationActiveRef.current) {
      if (rotationPendingRef.current) {
        console.log('🎵 HandleTrackEnd: Rotation was pending — starting rotation now');
        await beginRotation();
        return;
      }
      lastAudioActivityRef.current = Date.now();
      try {
        if (autoplayQueueRef.current.length > 0) {
          console.log('🎵 HandleTrackEnd (no rotation): Playing from autoplay queue');
          const ok = await playFromAutoplayQueue(true);
          if (ok === false) {
            const fallbackOk = await playFallbackTrack(true);
            if (!fallbackOk) audioEngineRef.current?.resume();
          }
        } else {
          const ok = await playFallbackTrack(true);
          if (!ok) {
            console.error('🚨 HandleTrackEnd (no rotation): All recovery failed — resuming active deck');
            audioEngineRef.current?.resume();
          }
        }
      } catch (err) {
        console.error('🚨 HandleTrackEnd (no rotation): Unexpected error:', err);
        try { audioEngineRef.current?.resume(); } catch(e) {}
      }
      return;
    }
    
    transitionInProgressRef.current = true;
    transitionStartTimeRef.current = Date.now();
    lastAudioActivityRef.current = Date.now();

    if (playingInterstitialRef.current) {
      const rot = rotationRef.current;
      const dnc = dancersRef.current;
      const idx = currentDancerIndexRef.current;
      const currentDancerId = rot[idx];
      const breakKey = playingInterstitialBreakKeyRef.current || `after-${currentDancerId}`;
      const breakSongs = interstitialSongsRef.current[breakKey] || [];
      const breakIdx = interstitialIndexRef.current;

      if (breakIdx < breakSongs.length) {
        let nextBreakName = breakSongs[breakIdx];
        let nextBreakTrack;
        interstitialIndexRef.current = breakIdx + 1;

        const cooldowns = songCooldownRef.current || {};
        const nowMs = Date.now();
        const isOnCooldown = cooldowns[nextBreakName] && (nowMs - cooldowns[nextBreakName]) < COOLDOWN_MS;
        if (isOnCooldown) {
          console.log('⏭️ HandleTrackEnd: Break song on cooldown, finding replacement:', nextBreakName);
          try {
            const token = localStorage.getItem('djbooth_token');
            const cooldownNames = Object.entries(cooldowns).filter(([, ts]) => ts && (nowMs - ts) < COOLDOWN_MS).map(([n]) => n);
            const assignedNames = Object.values(rotationSongsRef.current || {}).flat().filter(t => t?.name).map(t => t.name);
            const allBreakNames = Object.values(interstitialSongsRef.current || {}).flat();
            const excludeAll = [...new Set([...cooldownNames, ...assignedNames, ...allBreakNames])];
            const _dsCool = djOptionsRef.current?.dayShift;
            const _dsCoolOn = isDayShiftActive(_dsCool);
            const _dsCoolGenres = _dsCool?.genres || [];
            const activeGenres = (_dsCoolOn && _dsCoolGenres.length > 0)
              ? _dsCoolGenres
              : (djOptionsRef.current?.activeGenres?.length > 0 ? djOptionsRef.current.activeGenres : []);
            const res = await fetch('/api/music/select', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ count: 1, excludeNames: excludeAll, genres: activeGenres, dancerPlaylist: [] }),
              signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
              const data = await res.json();
              if (data.tracks?.length > 0) {
                nextBreakName = data.tracks[0].name;
                const updatedBreakSongs = [...breakSongs];
                updatedBreakSongs[breakIdx] = nextBreakName;
                interstitialSongsRef.current = { ...interstitialSongsRef.current, [breakKey]: updatedBreakSongs };
                console.log('🎵 HandleTrackEnd: Replaced cooldown break song with:', nextBreakName);
              }
            }
          } catch (err) {
            console.warn('⚠️ HandleTrackEnd: Break song replacement failed:', err.message);
          }
        }

        setActiveBreakInfo({ songs: breakSongs, currentIndex: breakIdx, breakKey });

        nextBreakTrack = tracks.find(t => t.name === nextBreakName && t.url);
        if (!nextBreakTrack?.url) {
          nextBreakTrack = tracks.find(t => t.url && (
            t.name === nextBreakName || 
            t.name.replace(/\.[^.]+$/, '') === nextBreakName.replace(/\.[^.]+$/, '')
          ));
        }
        if (!nextBreakTrack?.url) {
          nextBreakTrack = await resolveTrackByName(nextBreakName);
        }
        if (nextBreakTrack?.url) {
          console.log('🎵 HandleTrackEnd: Playing next break song:', nextBreakTrack.name);
          lastAudioActivityRef.current = Date.now();
          try {
            const ok = await playTrack(nextBreakTrack.url, true, nextBreakTrack.name, nextBreakTrack.genre);
            if (!ok) await playFallbackTrack(true);
          } finally {
            transitionInProgressRef.current = false;
          }
          return;
        } else {
          console.error('❌ Could not resolve next break song:', nextBreakName);
          transitionInProgressRef.current = false;
        }
      }

      playingInterstitialRef.current = false;
      playingInterstitialBreakKeyRef.current = null;
      interstitialIndexRef.current = 0;
      setActiveBreakInfo(null);
      const clearedInterstitials2 = { ...interstitialSongsRef.current };
      delete clearedInterstitials2[breakKey];
      interstitialSongsRef.current = clearedInterstitials2;
      setInterstitialSongsState(clearedInterstitials2);
      setInterstitialRemoteVersion(v => v + 1);
      try { localStorage.setItem('djbooth_interstitial_songs', JSON.stringify(clearedInterstitials2)); } catch {}

      const newRotation = [...rot];
      const newIdx = idx;
      const nextDancer = dnc.find(d => d.id === newRotation[newIdx]);

      if (!nextDancer) {
        await playFallbackTrack(true);
        transitionInProgressRef.current = false;
        return;
      }

      console.log('🎵 Break songs done — next dancer:', nextDancer.name, 'at index', newIdx);

      try {
        lastAudioActivityRef.current = Date.now();
        const existingTracks = rotationSongsRef.current[newRotation[newIdx]];
        const _postCd = songCooldownRef.current || {};
        const _postNow = Date.now();
        const _postValid = existingTracks && existingTracks.length >= songsPerSetRef.current &&
          existingTracks.every(t => !_postCd[t.name] || ((_postNow - _postCd[t.name]) >= COOLDOWN_MS));
        let freshTracks = _postValid ? existingTracks : await getDancerTracks(nextDancer);
        let nextTrack = freshTracks?.[0];
        const updatedSongs = { ...rotationSongsRef.current, [newRotation[newIdx]]: freshTracks };
        setRotationSongs(updatedSongs);
        rotationSongsRef.current = updatedSongs;

        const commercialPlayed = await playCommercialIfDue();
        if (commercialPlayed) {
          transitionStartTimeRef.current = Date.now();
          lastAudioActivityRef.current = Date.now();
        }

        lastAudioActivityRef.current = Date.now();
        if (nextTrack?.url) {
          const trackOk = await playTrack(nextTrack.url, true, nextTrack.name, nextTrack.genre);
          if (!trackOk) await playFallbackTrack(true);
        } else {
          await playFallbackTrack(true);
        }
        lastAudioActivityRef.current = Date.now();

        if (announcementsEnabled) {
          const announcementPromise = prefetchAnnouncement('intro', nextDancer.name, null, 1);
          audioEngineRef.current?.duck();
          const [, announcementUrl] = await Promise.all([waitForDuck(), announcementPromise]);
          lastAudioActivityRef.current = Date.now();
          await playPrefetchedAnnouncement(announcementUrl);
          audioEngineRef.current?.unduck();
        }

        const liveRot = rotationRef.current;
        setRotation(liveRot);
        currentDancerIndexRef.current = newIdx;
        currentSongNumberRef.current = 1;
        setCurrentDancerIndex(newIdx);
        setCurrentSongNumber(1);
        await updateStageState(newIdx, liveRot);
      } catch (err) {
        console.error('❌ HandleTrackEnd (post-interstitial) error:', err);
        audioEngineRef.current?.unduck();
        await playFallbackTrack(true);
      } finally {
        transitionInProgressRef.current = false;
      }
      return;
    }
    
    const idx = currentDancerIndexRef.current;
    const songNum = currentSongNumberRef.current;
    const songs = rotationSongsRef.current;
    const rot = rotationRef.current;
    const dnc = dancersRef.current;
    
    const dancer = dnc.find(d => d.id === rot[idx]);
    if (!dancer) {
      console.warn('⚠️ HandleTrackEnd: dancer not found, falling back to random');
      transitionInProgressRef.current = false;
      await playFallbackTrack(true);
      return;
    }
    
    let dancerTracks = songs[rot[idx]];
    if (!dancerTracks || dancerTracks.length === 0) {
      console.log('🎵 HandleTrackEnd: no pre-selected tracks for', dancer.name, ', auto-selecting via getDancerTracks');
      try {
        dancerTracks = await getDancerTracks(dancer);
        if (dancerTracks && dancerTracks.length > 0) {
          const updatedSongs = { ...rotationSongsRef.current, [rot[idx]]: dancerTracks };
          setRotationSongs(updatedSongs);
          rotationSongsRef.current = updatedSongs;
        }
      } catch (err) {
        console.warn('⚠️ HandleTrackEnd: getDancerTracks failed for', dancer.name, ':', err.message);
      }
      if (!dancerTracks || dancerTracks.length === 0) {
        console.warn('⚠️ HandleTrackEnd: still no tracks for', dancer.name, ', falling back');
        transitionInProgressRef.current = false;
        await playFallbackTrack(true);
        return;
      }
    }

    const dancerSongCount = dancerTracks.length;
    
    try {
      if (songNum < songsPerSetRef.current && songNum < dancerSongCount) {
        let nextTrack = dancerTracks[songNum];
        const newSongNum = songNum + 1;
        currentSongNumberRef.current = newSongNum;
        setCurrentSongNumber(newSongNum);
        
        if (nextTrack && !nextTrack.url && nextTrack.name) {
          let fresh = tracks.find(t => t.name === nextTrack.name && t.url);
          if (!fresh) fresh = await resolveTrackByName(nextTrack.name);
          if (fresh) {
            nextTrack = fresh;
            dancerTracks[songNum] = fresh;
          }
        }
        
        if (!nextTrack || !nextTrack.url) {
          const freshTracks = await getDancerTracks(dancer);
          if (freshTracks[0]?.url) {
            nextTrack = freshTracks[0];
          } else {
            await playFallbackTrack(true);
            if (announcementsEnabled) audioEngineRef.current?.unduck();
            transitionInProgressRef.current = false;
            return;
          }
        }
        
        if (announcementsEnabled) {
          const announcementPromise = prefetchAnnouncement('round2', dancer.name, null, newSongNum);
          audioEngineRef.current?.duck();
          const [, announcementUrl] = await Promise.all([waitForDuck(), announcementPromise]);
          const announcementDone = playPrefetchedAnnouncement(announcementUrl);
          await Promise.race([announcementDone, new Promise(r => setTimeout(r, SONG_OVERLAP_DELAY_MS))]);
          if (nextTrack?.url) {
            console.log('🎵 HandleTrackEnd: Switching to next track during announcement:', nextTrack.name);
            const trackOk = await playTrack(nextTrack.url, false, nextTrack.name, nextTrack.genre);
            if (!trackOk) {
              const ok = await playFallbackTrack(false);
              if (!ok) audioEngineRef.current?.resume();
            }
          } else {
            const ok = await playFallbackTrack(false);
            if (!ok) audioEngineRef.current?.resume();
          }
          await announcementDone;
          audioEngineRef.current?.unduck();
        } else {
          if (nextTrack?.url) {
            console.log('🎵 HandleTrackEnd: Playing next track:', nextTrack.name);
            const result = await playTrack(nextTrack.url, true, nextTrack.name, nextTrack.genre);
            if (result === false) {
              const ok = await playFallbackTrack(true);
              if (!ok) audioEngineRef.current?.resume();
            }
          } else {
            const ok = await playFallbackTrack(true);
            if (!ok) audioEngineRef.current?.resume();
          }
        }
      } else {
        const breakKey = `after-${rot[idx]}`;
        let breakSongs = interstitialSongsRef.current[breakKey] || [];

        if (breakSongs.length === 0 && breakSongsPerSetRef.current > 0) {
          try {
            const token = localStorage.getItem('djbooth_token');
            const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
            const cooldowns = songCooldownRef.current || {};
            const nowMs = Date.now();
            const cooldownNames = Object.entries(cooldowns)
              .filter(([, ts]) => ts && (nowMs - ts) < COOLDOWN_MS)
              .map(([name]) => name);
            const assignedNames = Object.values(rotationSongsRef.current).flat().map(t => t.name);
            const excludeNames = [...new Set([...cooldownNames, ...assignedNames])];
            const _dsTE = djOptionsRef.current?.dayShift;
            const _dsTEOn = isDayShiftActive(_dsTE);
            const _dsTEGenres = _dsTE?.genres || [];
            const activeGenres = (_dsTEOn && _dsTEGenres.length > 0)
              ? _dsTEGenres
              : (djOptionsRef.current?.activeGenres?.length > 0 ? djOptionsRef.current.activeGenres : []);
            const res = await fetch('/api/music/select', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                count: breakSongsPerSetRef.current,
                excludeNames,
                genres: activeGenres,
                dancerPlaylist: []
              }),
              signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
              const data = await res.json();
              breakSongs = (data.tracks || []).map(t => t.name);
              console.log('🎵 Auto-selected', breakSongs.length, 'break song(s):', breakSongs);
              interstitialSongsRef.current = { ...interstitialSongsRef.current, [breakKey]: breakSongs };
              setInterstitialSongsState({ ...interstitialSongsRef.current });
              setInterstitialRemoteVersion(v => v + 1);
              try { localStorage.setItem('djbooth_interstitial_songs', JSON.stringify(interstitialSongsRef.current)); } catch {}
            }
          } catch (err) {
            console.warn('⚠️ Failed to auto-select break songs:', err.message);
          }
        }

        if (breakSongs.length > 0) {
          console.log('🎵 HandleTrackEnd: Playing', breakSongs.length, 'break song(s) after', dancer.name, '| Songs:', breakSongs);
          
          const flippedRotation = [...rotationRef.current];
          const [finishedId] = flippedRotation.splice(idx, 1);
          flippedRotation.push(finishedId);
          setRotation(flippedRotation);
          rotationRef.current = flippedRotation;
          setCurrentDancerIndex(0);
          currentDancerIndexRef.current = 0;
          setCurrentSongNumber(0);
          currentSongNumberRef.current = 0;
          const clearedSongs = { ...rotationSongsRef.current };
          delete clearedSongs[finishedId];
          rotationSongsRef.current = clearedSongs;
          updateStageState(0, flippedRotation);

          playingInterstitialRef.current = true;
          playingInterstitialBreakKeyRef.current = breakKey;
          interstitialIndexRef.current = 1;
          setActiveBreakInfo({ songs: breakSongs, currentIndex: 0, breakKey });
          const firstBreakName = breakSongs[0];
          let firstBreakTrack = tracks.find(t => t.name === firstBreakName && t.url);
          if (!firstBreakTrack?.url) {
            firstBreakTrack = tracks.find(t => t.url && (
              t.name === firstBreakName || 
              t.name.replace(/\.[^.]+$/, '') === firstBreakName.replace(/\.[^.]+$/, '')
            ));
          }
          if (!firstBreakTrack?.url) {
            firstBreakTrack = await resolveTrackByName(firstBreakName);
          }

          if (announcementsEnabled) {
            const announcementPromise = prefetchAnnouncement('outro', dancer.name, null, 1);
            audioEngineRef.current?.duck();
            const [, announcementUrl] = await Promise.all([waitForDuck(), announcementPromise]);
            const announcementDone = playPrefetchedAnnouncement(announcementUrl);
            await Promise.race([announcementDone, new Promise(r => setTimeout(r, SONG_OVERLAP_DELAY_MS))]);
            if (firstBreakTrack?.url) {
              console.log('🎵 Playing break song during outro announcement:', firstBreakTrack.name);
              lastAudioActivityRef.current = Date.now();
              const ok = await playTrack(firstBreakTrack.url, false, firstBreakTrack.name, firstBreakTrack.genre);
              if (!ok) await playFallbackTrack(false);
            } else {
              console.error('❌ Could not resolve break song:', firstBreakName, '- falling back');
              await playFallbackTrack(false);
            }
            await announcementDone;
            audioEngineRef.current?.unduck();
          } else {
            if (firstBreakTrack?.url) {
              console.log('🎵 Playing break song:', firstBreakTrack.name);
              lastAudioActivityRef.current = Date.now();
              const ok = await playTrack(firstBreakTrack.url, true, firstBreakTrack.name, firstBreakTrack.genre);
              if (!ok) await playFallbackTrack(true);
            } else {
              console.error('❌ Could not resolve break song:', firstBreakName, '- falling back');
              await playFallbackTrack(true);
            }
          }

          transitionInProgressRef.current = false;
          return;
        }

        const newRotation = [...rot];
        const [finishedDancerId] = newRotation.splice(idx, 1);
        // Check if this dancer is pending VIP — if so, send to holding instead of bottom of rotation
        const vipDurationTE = pendingVipRef.current[finishedDancerId];
        if (vipDurationTE) {
          delete pendingVipRef.current[finishedDancerId];
          setPendingVipState({ ...pendingVipRef.current });
          const expiresAt = Date.now() + vipDurationTE;
          const newVipMap = { ...dancerVipMapRef.current, [finishedDancerId]: { expiresAt, duration: vipDurationTE } };
          dancerVipMapRef.current = newVipMap;
          setDancerVipMap(newVipMap);
          try { localStorage.setItem('neonaidj_vip_map', JSON.stringify(newVipMap)); } catch {}
          const vipDancer = dnc.find(d => d.id === finishedDancerId);
          console.log('👑 HandleTrackEnd: dancer going to VIP holding:', vipDancer?.name);
          toast(`${vipDancer?.name || 'Entertainer'} is now In VIP`, { icon: '👑' });
        } else {
          newRotation.push(finishedDancerId);
        }
        
        const newIdx = 0;
        const nextDancer = dnc.find(d => d.id === newRotation[newIdx]);
        
        if (!nextDancer) {
          console.warn('⚠️ HandleTrackEnd: next dancer not found, falling back');
          await playFallbackTrack(true);
          transitionInProgressRef.current = false;
          return;
        }

        // Apply rotation immediately so any DJ reorders during the async transition land on top
        setRotation(newRotation);
        rotationRef.current = newRotation;
        const finishedIdx = newRotation.length - 1;
        setCurrentDancerIndex(finishedIdx);
        currentDancerIndexRef.current = finishedIdx;

        // Sync crowd display to the new rotation BEFORE announcing.
        // Without this, RotationDisplay keeps showing the finished dancer at the top
        // (stale DB state) until updateStageState fires at the very end of the transition.
        updateStageState(newIdx, newRotation);
        fetch('/api/stage/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rotation_order: newRotation, current_dancer_index: newIdx, is_active: true })
        }).catch(() => {});

        const _teTransStart = Date.now();
        logDiag('transition_start', { from: dancer.name, to: nextDancer.name, trigger: 'track_end' });

        const outroPromise = announcementsEnabled ? prefetchAnnouncement('outro', dancer.name, null, 1) : Promise.resolve(null);
        if (announcementsEnabled) audioEngineRef.current?.duck();

        const djSaved = djSavedSongsRef.current[finishedDancerId];
        const djSavedValid = djSaved && djSaved.length >= songsPerSetRef.current && djSaved.every(t => t.url);
        if (djSavedValid) delete djSavedSongsRef.current[finishedDancerId];
        const scratchSongs = { ...rotationSongsRef.current };
        delete scratchSongs[finishedDancerId];
        rotationSongsRef.current = scratchSongs;
        const existingTracks = scratchSongs[newRotation[newIdx]];
        // Filter stale pre-picks: remove any tracks now inside the 4-hour cooldown window
        const validPrePicks = existingTracks
          ? existingTracks.filter(t => {
              if (!t?.url) return false;
              const lp = songCooldownRef.current?.[t.name];
              return !lp || (Date.now() - lp) >= COOLDOWN_MS;
            })
          : null;
        const finishedDancer = dnc.find(d => d.id === finishedDancerId);
        const playingTrackExclude = currentTrackRef.current ? [currentTrackRef.current] : [];
        const bgPick = bgPrePickRef.current?.dancerId === finishedDancerId ? bgPrePickRef.current : null;
        bgPrePickRef.current = null;
        const [freshTracks, prePicked] = await Promise.all([
          (() => { const _ev = validPrePicks && validPrePicks.length >= songsPerSetRef.current; if (_ev) { prePickHitsRef.current++; logDiag('prepick_hit', { dancer: nextDancer.name }); } else { prePickMissesRef.current++; logDiag('prepick_miss', { dancer: nextDancer.name }); } return _ev ? Promise.resolve(validPrePicks) : getDancerTracks(nextDancer); })(),
          djSavedValid
            ? (console.log(`🎵 Pre-pick for ${finishedDancer?.name}: using DJ-saved songs`), Promise.resolve(djSaved))
            : finishedDancer
              ? bgPick
                ? (console.log(`🎵 Pre-pick for ${finishedDancer.name}: using background pre-pick`), bgPick.promise.catch(() => []))
                : getDancerTracks(finishedDancer, playingTrackExclude, true, 1500).catch(e => {
                    console.warn('⚠️ Pre-pick failed for', finishedDancer.name, e.message);
                    return [];
                  })
              : Promise.resolve([])
        ]);
        let nextTrack = freshTracks?.[0];

        const updatedSongs = { ...rotationSongsRef.current, [newRotation[newIdx]]: freshTracks };
        if (prePicked && prePicked.length > 0) {
          updatedSongs[finishedDancerId] = prePicked;
          console.log(`🎵 Pre-picked for ${finishedDancer?.name} (bottom): [${prePicked.map(t => t.name).join(', ')}]`);
        } else {
          delete updatedSongs[finishedDancerId];
        }
        setRotationSongs(updatedSongs);
        rotationSongsRef.current = updatedSongs;

        if (announcementsEnabled) {
          const [outroUrl] = await Promise.all([outroPromise, waitForDuck()]);
          await playPrefetchedAnnouncement(outroUrl);
        }

        lastAudioActivityRef.current = Date.now();
        if (nextTrack && nextTrack.url) {
          console.log('🎵 HandleTrackEnd: Switching to next dancer:', nextDancer.name, 'track:', nextTrack.name);
          logDiag('track_play', { dancer: nextDancer.name, track: nextTrack.name, gapMs: Date.now() - _teTransStart });
          const trackOk = await playTrack(nextTrack.url, true, nextTrack.name, nextTrack.genre);
          if (!trackOk) await playFallbackTrack(true);
        } else {
          logDiag('track_play_fallback', { dancer: nextDancer.name, reason: 'no_url' });
          await playFallbackTrack(true);
        }

        if (announcementsEnabled) {
          audioEngineRef.current?.unduck();
        }

        lastAudioActivityRef.current = Date.now();
        lastTransitionMsRef.current = Date.now() - _teTransStart;
        logDiag('transition_complete', { dancer: nextDancer.name, durationMs: lastTransitionMsRef.current, trigger: 'track_end' });

        const commercialPlayed = await playCommercialIfDue();
        if (commercialPlayed) {
          transitionStartTimeRef.current = Date.now();
          lastAudioActivityRef.current = Date.now();
          if (nextTrack && nextTrack.url) {
            const trackOk = await playTrack(nextTrack.url, true, nextTrack.name, nextTrack.genre);
            if (!trackOk) await playFallbackTrack(true);
          } else {
            await playFallbackTrack(true);
          }
        }

        if (announcementsEnabled) {
          const introPromise = prefetchAnnouncement('intro', nextDancer.name, null, 1);
          audioEngineRef.current?.duck();
          const [, introUrl] = await Promise.all([waitForDuck(), introPromise]);
          lastAudioActivityRef.current = Date.now();
          if (introUrl) {
            await playPrefetchedAnnouncement(introUrl);
          }
          audioEngineRef.current?.unduck();
        }

        const finalRot = rotationRef.current;
        const finalIdx = finalRot.indexOf(nextDancer.id);
        const resolvedIdx = finalIdx !== -1 ? finalIdx : 0;
        currentDancerIndexRef.current = resolvedIdx;
        currentSongNumberRef.current = 1;
        setCurrentDancerIndex(resolvedIdx);
        setCurrentSongNumber(1);
        await updateStageState(resolvedIdx, finalRot);
      }
    } catch (error) {
      console.error('❌ HandleTrackEnd error, falling back to random track:', error);
      audioEngineRef.current?.unduck();
      const ok = await playFallbackTrack(true);
      if (!ok) {
        console.error('🚨 HandleTrackEnd: All recovery failed — resuming active deck');
        audioEngineRef.current?.resume();
      }
    } finally {
      transitionInProgressRef.current = false;
    }
  }, [playTrack, playFallbackTrack, playAnnouncement, prefetchAnnouncement, playPrefetchedAnnouncement, playCommercialIfDue, updateStageState, tracks, filterCooldown, announcementsEnabled, getDancerTracks, beginRotation]);

  const handleAnnouncementPlay = useCallback(async (audioUrl, options) => {
    if (audioEngineRef.current) {
      await audioEngineRef.current.playAnnouncement(audioUrl, options);
    }
  }, []);

  useEffect(() => {
    if (remoteMode) return;
    const WATCHDOG_INTERVAL = 3000;
    const SILENCE_THRESHOLD = 5000;
    
    const watchdogCheck = async () => {
      if (!playbackExpectedRef.current) return;
      if (watchdogRecoveringRef.current) return;
      if (playingCommercialRef.current) return;
      if (tracks.length === 0) return;
      if (initialLoadGraceRef.current) return;
      
      const silentFor = Date.now() - lastAudioActivityRef.current;
      if (silentFor < SILENCE_THRESHOLD) return;
      
      if (transitionInProgressRef.current) {
        const transitionTime = Date.now() - transitionStartTimeRef.current;
        if (transitionTime > 30000) {
          console.warn('🐕 WATCHDOG: Transition stuck for', Math.round(transitionTime/1000), 's — force clearing');
          transitionInProgressRef.current = false;
        } else {
          return;
        }
      }
      
      console.warn('🐕 WATCHDOG: No audio activity for', Math.round(silentFor/1000), 's — emergency recovery!');
      const _wdDancer = dancersRef.current?.find(d => String(d.id) === String(rotationRef.current[currentDancerIndexRef.current]));
      const _wdDancerName = _wdDancer?.name || null;
      const _wdTrack = currentTrackRef.current;
      lastWatchdogRef.current = { at: Date.now(), silentMs: silentFor, dancer: _wdDancerName, track: _wdTrack };
      logDiag('watchdog_fired', { silentMs: silentFor, dancer: _wdDancerName, track: _wdTrack });
      watchdogRecoveringRef.current = true;
      transitionInProgressRef.current = true;
      transitionStartTimeRef.current = Date.now();
      
      try {
        try {
          audioEngineRef.current?.pauseAll();
        } catch (e) {
          console.warn('🐕 WATCHDOG: pauseAll() before recovery failed:', e.message);
        }
        await new Promise(r => setTimeout(r, 200));

        // Capture what failed and who was on stage
        const failedSong = currentTrackRef.current;
        const wdDancerId = rotationRef.current[currentDancerIndexRef.current];
        const wdDancer = dancersRef.current?.find(d => String(d.id) === String(wdDancerId));
        const wdDancerName = wdDancer?.name || null;

        // Log the playback error
        try {
          const token = localStorage.getItem('djbooth_token');
          fetch('/api/playback-errors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ trackName: failedSong, dancerName: wdDancerName, reason: 'watchdog_silence' })
          }).catch(() => {});
        } catch {}

        // Update rotation display to show the track the watchdog actually plays
        const updateWatchdogRotationUI = (recoveredTrack) => {
          if (isRotationActiveRef.current && rotationRef.current.length > 0) {
            const wdUpdateId = rotationRef.current[currentDancerIndexRef.current];
            if (wdUpdateId) {
              const songs = rotationSongsRef.current[wdUpdateId] || [];
              const idx = currentSongNumberRef.current - 1;
              const updated = [...songs];
              updated[idx] = recoveredTrack;
              const newSongs = { ...rotationSongsRef.current, [wdUpdateId]: updated };
              setRotationSongs(newSongs);
              rotationSongsRef.current = newSongs;
            }
          }
        };

        let recovered = false;

        // First: try songs from the current dancer's playlist
        if (wdDancerId && !recovered) {
          const cooldowns = songCooldownRef.current || {};
          const nowMs = Date.now();
          const playlist = (rotationSongsRef.current[wdDancerId] || []).filter(t => {
            if (!t || !t.url) return false;
            const lp = cooldowns[t.name];
            return !lp || (nowMs - lp) >= COOLDOWN_MS;
          });
          const sorted = [...playlist].sort((a, b) => (cooldowns[a.name] || 0) - (cooldowns[b.name] || 0));
          for (const track of sorted.slice(0, 8)) {
            try {
              const success = await audioEngineRef.current?.playTrack({ url: track.url, name: track.name }, false);
              if (success !== false) {
                console.log('🐕 WATCHDOG: Dancer playlist recovery succeeded with "' + track.name + '"');
                lastAudioActivityRef.current = Date.now();
                setIsPlaying(true);
                recordSongPlayed(track.name);
                updateWatchdogRotationUI(track);
                recovered = true;
                break;
              }
            } catch (e) {
              console.error('🐕 WATCHDOG: Dancer playlist attempt failed:', e.message);
            }
          }
        }

        // Second: try server random tracks
        if (!recovered) {
          try {
            const token = localStorage.getItem('djbooth_token');
            const wdCooldowns = songCooldownRef.current || {};
            const wdNow = Date.now();
            const wdRecent = Object.entries(wdCooldowns)
              .filter(([, ts]) => ts && (wdNow - ts) < COOLDOWN_MS)
              .map(([name]) => name);
            const wdExclude = wdRecent.length > 0 ? `&exclude=${encodeURIComponent(wdRecent.join(','))}` : '';
            const res = await fetch(`/api/music/random?count=5${wdExclude}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
              signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
              const data = await res.json();
              const serverTracks = (data.tracks || []).map(t => ({ ...t, url: `/api/music/stream/${t.id}` }));
              for (let i = 0; i < serverTracks.length; i++) {
                try {
                  const track = serverTracks[i];
                  const success = await audioEngineRef.current?.playTrack({ url: track.url, name: track.name }, false);
                  if (success !== false) {
                    console.log('🐕 WATCHDOG: Server recovery succeeded with "' + track.name + '"');
                    lastAudioActivityRef.current = Date.now();
                    setIsPlaying(true);
                    recordSongPlayed(track.name);
                    updateWatchdogRotationUI(track);
                    recovered = true;
                    break;
                  }
                } catch (e) {
                  console.error('🐕 WATCHDOG: Server recovery attempt', i+1, 'failed:', e.message);
                }
              }
            }
          } catch (e) {
            console.warn('🐕 WATCHDOG: Server random fetch failed, trying local pool:', e.message);
          }
        }

        // Third: local pool fallback
        if (!recovered) {
          const cooldowns = songCooldownRef.current || {};
          const nowMs = Date.now();
          const validTracks = tracks.filter(t => {
            if (!t || !t.url) return false;
            const lp = cooldowns[t.name];
            return !lp || (nowMs - lp) >= COOLDOWN_MS;
          });
          const shuffled = fisherYatesShuffle(validTracks);
          shuffled.sort((a, b) => (cooldowns[a.name] || 0) - (cooldowns[b.name] || 0));
          for (let i = 0; i < Math.min(5, shuffled.length); i++) {
            try {
              const track = shuffled[i];
              const success = await audioEngineRef.current?.playTrack({ url: track.url, name: track.name }, false);
              if (success !== false) {
                console.log('🐕 WATCHDOG: Local recovery succeeded with "' + track.name + '"');
                lastAudioActivityRef.current = Date.now();
                setIsPlaying(true);
                recordSongPlayed(track.name);
                updateWatchdogRotationUI(track);
                recovered = true;
                break;
              }
            } catch (e) {
              console.error('🐕 WATCHDOG: Local recovery attempt', i+1, 'failed:', e.message);
            }
          }
        }
        
        if (!recovered) {
          console.error('🐕 WATCHDOG: ALL recovery attempts failed — trying resume as last resort');
          try { audioEngineRef.current?.resume(); } catch(e) {}
          lastAudioActivityRef.current = Date.now();
        }
      } catch (err) {
        console.error('🐕 WATCHDOG: Recovery error:', err);
        lastAudioActivityRef.current = Date.now();
      } finally {
        watchdogRecoveringRef.current = false;
        transitionInProgressRef.current = false;
      }
    };
    
    const intervalId = setInterval(watchdogCheck, WATCHDOG_INTERVAL);
    return () => clearInterval(intervalId);
  }, [tracks, recordSongPlayed]);

  // Rotation management
  const addToRotation = async (dancerId) => {
    if (!rotation.includes(dancerId)) {
      const newRotation = [...rotation, dancerId];
      setRotation(newRotation);
      rotationRef.current = newRotation;

      const dancer = dancers.find(d => d.id === dancerId);
      if (dancer && announcementRef.current?.preCacheDancer) {
        setTimeout(() => {
          announcementRef.current.preCacheDancer(dancer.name);
        }, 500);
      }
      if (dancer && isRotationActive) {
        getDancerTracks(dancer).then(prePicked => {
          if (!isRotationActiveRef.current) return;
          if (!rotationRef.current.includes(dancerId)) return;
          const latest = { ...rotationSongsRef.current, [dancerId]: prePicked };
          setRotationSongs(latest);
          rotationSongsRef.current = latest;
          console.log(`🎵 Pre-picked for ${dancer.name} (added): [${prePicked.map(t => t.name).join(', ')}]`);
        }).catch(e => console.warn('⚠️ Pre-pick failed for', dancer?.name, e.message));
      }
    }
  };

  const stopRotation = useCallback(() => {
    const now = Date.now();
    if (now - lastRotationToggleRef.current < 2000) return;
    lastRotationToggleRef.current = now;
    setIsRotationActive(false);
    isRotationActiveRef.current = false;
    setCurrentDancerIndex(0);
    currentDancerIndexRef.current = 0;
    setCurrentSongNumber(1);
    currentSongNumberRef.current = 1;
    setRotationSongs({});
    rotationSongsRef.current = {};
    restoredSongsRef.current = false;
    rotationPendingRef.current = false;
    setRotationPending(false);
    playingInterstitialRef.current = false;
    playingInterstitialBreakKeyRef.current = null;
    interstitialIndexRef.current = 0;
    setActiveBreakInfo(null);
  }, []);
  stopRotationRef.current = stopRotation;

  const removeFromRotation = (dancerId) => {
    // Always use refs — React state can be stale during an active transition,
    // which would cause us to rebuild the rotation from a stale snapshot and
    // overwrite the correctly-flipped rotation that handleTrackEnd/handleSkip
    // just wrote to rotationRef.current.
    const currentRot = rotationRef.current;
    const removedIdx = currentRot.indexOf(dancerId);
    const newRotation = currentRot.filter(id => id !== dancerId);

    // Clear any lingering pending-VIP flag so the UI badge doesn't get stuck.
    if (pendingVipRef.current[dancerId]) {
      delete pendingVipRef.current[dancerId];
      setPendingVipState({ ...pendingVipRef.current });
      try { localStorage.setItem('neonaidj_pending_vip', JSON.stringify(pendingVipRef.current)); } catch {}
    }

    if (removedIdx !== -1 && removedIdx <= currentDancerIndexRef.current && newRotation.length > 0) {
      // If we removed the dancer currently on stage, stay at the same position index
      // (it now points to the next dancer). If we removed a dancer before the current
      // one, shift down by 1 to keep the same dancer on stage.
      const newIdx = removedIdx === currentDancerIndexRef.current
        ? Math.min(removedIdx, newRotation.length - 1)
        : currentDancerIndexRef.current - 1;
      setCurrentDancerIndex(newIdx);
      currentDancerIndexRef.current = newIdx;
    }
    rotationRef.current = newRotation;
    setRotation(newRotation);
  };

  const moveUp = (index) => {
    if (index > 0) {
      const newRotation = [...rotation];
      [newRotation[index], newRotation[index - 1]] = [newRotation[index - 1], newRotation[index]];
      setRotation(newRotation);
    }
  };

  const moveDown = (index) => {
    if (index < rotation.length - 1) {
      const newRotation = [...rotation];
      [newRotation[index], newRotation[index + 1]] = [newRotation[index + 1], newRotation[index]];
      setRotation(newRotation);
    }
  };

  const preloadedTrackRef = useRef(null);
  useEffect(() => {
    if (remoteMode || !isRotationActive || rotation.length < 2 || tracks.length === 0) return;
    const preloadNext = async () => {
      try {
        const nextIdx = (currentDancerIndex + 1) % rotation.length;
        const nextDancerId = rotation[nextIdx];
        const nextDancer = dancers.find(d => d.id === nextDancerId);
        if (!nextDancer) return;
        const existingTracks = rotationSongsRef.current[nextDancerId];
        const nextTracks = (existingTracks && existingTracks.length >= songsPerSetRef.current) ? existingTracks : await getDancerTracks(nextDancer);
        const firstTrack = nextTracks?.[0];
        if (firstTrack?.url) {
          preloadedTrackRef.current = { dancerId: nextDancerId, track: firstTrack };
          console.log(`⏩ Preloaded next track: "${firstTrack.name}" for ${nextDancer.name}`);
        }
      } catch (err) {
        console.warn('Preload failed (non-critical):', err.message);
      }
    };
    const timer = setTimeout(preloadNext, 2000);
    return () => clearTimeout(timer);
  }, [remoteMode, isRotationActive, currentDancerIndex, rotation, dancers, tracks, getDancerTracks]);

  const [serverHealthy, setServerHealthy] = useState(true);
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
        setServerHealthy(res.ok);
      } catch {
        setServerHealthy(false);
        console.warn('⚠️ Server health check failed — will retry in 30s');
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const prevRotationKeyRef = useRef('');
  useEffect(() => {
    if (remoteMode) return;
    if (!announcementRef.current?.preCacheUpcoming) return;
    if (rotation.length === 0 || dancers.length === 0) return;

    const key = rotation.join(',') + '|' + currentDancerIndex;
    if (key === prevRotationKeyRef.current) return;
    prevRotationKeyRef.current = key;

    const lookahead = Math.min(3, rotation.length);
    const upcoming = [];
    for (let i = 0; i < lookahead; i++) {
      const idx = (currentDancerIndex + i) % rotation.length;
      const nextIdx = (currentDancerIndex + i + 1) % rotation.length;
      const dancer = dancers.find(d => d.id === rotation[idx]);
      const nextDancer = dancers.find(d => d.id === rotation[nextIdx]);
      if (dancer?.name) {
        upcoming.push({ name: dancer.name, nextName: nextDancer?.name || null });
      }
    }
    if (upcoming.length === 0) return;

    const timer = setTimeout(() => {
      announcementRef.current?.preCacheUpcoming(upcoming);
    }, 2000);
    return () => clearTimeout(timer);
  }, [rotation, dancers, currentDancerIndex, remoteMode]);

  if (remoteMode) {
    return (
      <RemoteView
        dancers={dancers}
        liveBoothState={liveBoothState}
        djOptions={djOptions}
        songCooldowns={playedSongsMap}
        onOptionsChange={(opts) => {
          setDjOptions(opts);
          djOptionsRef.current = opts;
        }}
        onLogout={() => {
          navigate('/');
        }}
      />
    );
  }

  return (
    <div className="h-screen bg-[#08081a] text-white flex flex-col overflow-hidden">
      {!remoteMode && (
        <>
          <AudioEngine
            ref={audioEngineRef}
            onTrackEnd={handleTrackEnd}
            onTimeUpdate={(time, dur) => {
              currentTimeRef.current = time;
              durationRef.current = dur;
              lastTimeStampRef.current = performance.now();
              isPlayingRef.current = true;
              lastAudioActivityRef.current = Date.now();
            }}
            onTrackChange={(name) => {
              setCurrentTrack(name);
              currentTrackRef.current = name;
              currentTimeRef.current = 0;
              durationRef.current = 0;
              lastTimeStampRef.current = performance.now();
              lastAudioActivityRef.current = Date.now();
            }}
          />
          <AnnouncementSystem
            ref={announcementRef}
            dancers={dancers}
            rotation={rotation}
            currentDancerIndex={currentDancerIndex}
            onPlay={handleAnnouncementPlay}
            elevenLabsApiKey={elevenLabsKey}
            openaiApiKey={openaiKey}
            hideUI={true}
            onVoiceDiag={logDiag}
          />
        </>
      )}

      {/* Header */}
      <header className="border-b border-[#151528] px-4 py-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-8 h-8 rounded-lg bg-[#00d4ff] flex items-center justify-center">
                <Radio className="w-4 h-4 text-black" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight leading-tight">NEON AI DJ</h1>
                <p className="text-[10px] text-gray-500">Automated Intelligent Disc Jockey</p>
              </div>
            </div>

            {remoteMode ? (
              <div className="bg-[#2563eb]/10 rounded-lg border border-[#2563eb] p-3 min-w-[280px]">
                <div className="flex items-center gap-3 mb-2">
                  <Wifi className="w-5 h-5 text-[#00d4ff] flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[#00d4ff]">Remote Control</p>
                      {liveBoothState?.updatedAt > 0 && (
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${liveBoothState.isPlaying ? 'bg-green-400 animate-pulse' : 'bg-yellow-500'}`} />
                      )}
                    </div>
                    {liveBoothState?.updatedAt > 0 ? (
                      liveBoothState.isRotationActive ? (
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-gray-300 truncate">
                            {liveBoothState.isPlaying ? '▶' : '⏸'} {liveBoothState.currentDancerName || 'Unknown'} — Song {liveBoothState.currentSongNumber}/{liveBoothState.songsPerSet}
                            {liveBoothState.currentTrack ? ` · ${liveBoothState.currentTrack}` : ''}
                          </p>
                          <span ref={remoteTimeDisplayRef} className="text-xs font-mono text-[#00d4ff] tabular-nums flex-shrink-0" style={{ display: 'none' }} />
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">Booth connected · Rotation stopped</p>
                      )
                    ) : (
                      <p className="text-xs text-gray-500">Waiting for booth connection...</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-white hover:bg-[#1e293b] h-8 px-2"
                    onClick={() => boothApi.sendCommand('skip')}
                  >
                    <SkipForward className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-8 px-2 ${liveBoothState?.announcementsEnabled ? 'text-[#00d4ff]' : 'text-gray-500'}`}
                    onClick={() => {
                      const now = Date.now();
                      if (now - lastAnnouncementsToggleRef.current < 1000) return;
                      lastAnnouncementsToggleRef.current = now;
                      boothApi.sendCommand('toggleAnnouncements');
                    }}
                  >
                    {liveBoothState?.announcementsEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-[#0d0d1f] rounded-lg border border-[#1e293b] p-2 min-w-0 flex-1">
                <div className="flex items-center gap-3 mb-2">
                  {currentDancer && (
                    <div 
                      className="w-6 h-6 rounded-full flex items-center justify-center text-black font-bold text-xs flex-shrink-0"
                      style={{ backgroundColor: currentDancer.color || '#00d4ff' }}
                    >
                      {currentDancer.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500">
                      {currentDancer ? `${currentDancer.name}${isRotationActive ? ` - Song ${currentSongNumber}/${songsPerSet}` : ''}` : 'No track loaded'}
                    </p>
                    <p className="text-sm text-white truncate">{currentTrack || 'Select a track'}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-7 h-7 text-white hover:bg-[#1e293b]"
                    onClick={handleSkip}
                  >
                    <SkipForward className="w-4 h-4" />
                  </Button>
                  
                  <div className="flex-1 flex items-center gap-1.5 justify-end">
                    <Volume2 className="w-4 h-4 text-gray-500" />
                    <button
                      onClick={() => {
                        const vol = Math.max(0, volume - 0.05);
                        setVolume(vol);
                        audioEngineRef.current?.setVolume(vol);
                      }}
                      disabled={Math.round(volume * 100) <= 0}
                      className="w-7 h-7 rounded-md bg-[#151528] border border-[#2e2e5a] flex items-center justify-center text-white hover:bg-[#2e2e5a] active:bg-[#2e2e5a] disabled:opacity-30 transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <div className="w-11 h-7 rounded-md bg-[#151528] border border-[#2e2e5a] flex items-center justify-center">
                      <span className="text-xs font-bold text-white tabular-nums">{Math.round(volume * 100)}%</span>
                    </div>
                    <button
                      onClick={() => {
                        const vol = Math.min(1, volume + 0.05);
                        setVolume(vol);
                        audioEngineRef.current?.setVolume(vol);
                      }}
                      disabled={Math.round(volume * 100) >= 100}
                      className="w-7 h-7 rounded-md bg-[#151528] border border-[#2e2e5a] flex items-center justify-center text-white hover:bg-[#2e2e5a] active:bg-[#2e2e5a] disabled:opacity-30 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>

                    <div className="w-px h-5 bg-[#2e2e5a] mx-0.5" />

                    <Mic className="w-4 h-4 text-[#a855f7]" />
                    <button
                      onClick={() => {
                        const g = Math.max(0.5, voiceGain - 0.1);
                        setVoiceGain(g);
                        audioEngineRef.current?.setVoiceGain(g);
                        try { localStorage.setItem('djbooth_voice_gain', String(g)); } catch {}
            try { fetch('/api/config/save-to-server', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ djbooth_voice_gain: String(g) }) }).catch(() => {}); } catch {}
                      }}
                      disabled={Math.round(voiceGain * 100) <= 50}
                      className="w-7 h-7 rounded-md bg-[#151528] border border-[#a855f7]/30 flex items-center justify-center text-white hover:bg-[#2e2e5a] active:bg-[#2e2e5a] disabled:opacity-30 transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <div className="w-11 h-7 rounded-md bg-[#151528] border border-[#a855f7]/30 flex items-center justify-center">
                      <span className="text-xs font-bold text-[#a855f7] tabular-nums">{Math.round(voiceGain * 100)}%</span>
                    </div>
                    <button
                      onClick={() => {
                        const g = Math.min(3, voiceGain + 0.1);
                        setVoiceGain(g);
                        audioEngineRef.current?.setVoiceGain(g);
                        try { localStorage.setItem('djbooth_voice_gain', String(g)); } catch {}
            try { fetch('/api/config/save-to-server', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ djbooth_voice_gain: String(g) }) }).catch(() => {}); } catch {}
                      }}
                      disabled={Math.round(voiceGain * 100) >= 300}
                      className="w-7 h-7 rounded-md bg-[#151528] border border-[#a855f7]/30 flex items-center justify-center text-white hover:bg-[#2e2e5a] active:bg-[#2e2e5a] disabled:opacity-30 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                
                <div ref={timeDisplayRef} className="mt-2 text-xs text-gray-500 text-center" style={{ display: 'none' }} />
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2 flex-shrink-0">
            
            {!remoteMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeactivateClick}
                className="border-red-500/50 text-red-400 hover:bg-red-500/20 hover:text-red-300"
                title="Deactivate the currently playing song"
              >
                <Ban className="w-4 h-4 mr-1" />
                Deactivate
              </Button>
            )}

            {!remoteMode && (!elevenLabsKey || !openaiKey) && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                <span className="text-xs text-amber-400">API keys not configured</span>
              </div>
            )}
            {!remoteMode && rotation.length > 0 && (
              preCachingForStart ? (
                <div className="flex items-center gap-3 px-4 py-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
                  <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  <div className="flex flex-col">
                    <span className="text-sm text-cyan-300 font-medium">
                      Caching announcements... {preCacheStartProgress.dancersDone}/{preCacheStartProgress.dancersTotal} ready
                    </span>
                    <div className="w-32 h-1.5 bg-gray-700 rounded-full mt-1">
                      <div
                        className="h-full bg-cyan-400 rounded-full transition-all duration-300"
                        style={{ width: `${preCacheStartProgress.total > 0 ? (preCacheStartProgress.completed / preCacheStartProgress.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              ) : rotationPending ? (
                <Button
                  onClick={() => {
                    rotationPendingRef.current = false;
                    setRotationPending(false);
                  }}
                  className="bg-yellow-600 hover:bg-yellow-700 text-white animate-pulse"
                >
                  Queued...
                </Button>
              ) : (
                <Button
                  onClick={isRotationActive ? stopRotation : startRotation}
                  className={isRotationActive 
                    ? "bg-red-600 hover:bg-red-700 text-white" 
                    : "bg-green-600 hover:bg-green-700 text-white"
                  }
                >
                  {isRotationActive ? 'Stop Rotation' : 'Start Rotation'}
                </Button>
              )
            )}
            {!remoteMode && (
              <>
                <Button
                  size="sm"
                  className="bg-[#00d4ff] hover:bg-[#00a3cc] text-black font-semibold"
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/display/launch', { method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('djbooth_token')}` } });
                      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Server error');
                      toast.success('Display launching on HDMI-2');
                    } catch (err) {
                      console.error('[Rotation Screen] Failed:', err.message);
                      toast.error(`Display launch failed: ${err.message}`);
                    }
                  }}
                >
                  <Radio className="w-4 h-4 mr-2" />
                  Rotation Screen
                </Button>
                <Link to={createPageUrl('Configuration')}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-gray-400 hover:text-white hover:bg-[#151528]"
                    title="Configuration"
                  >
                    <SlidersHorizontal className="w-5 h-5" />
                  </Button>
                </Link>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-400 hover:text-white hover:bg-[#151528] ml-1"
              onClick={() => navigate('/')}
            >
              <span className="text-xs">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0">

        {/* Left Sidebar Navigation */}
        <div className="w-16 flex flex-col bg-[#0a0a1a] border-r border-[#151528] py-2 gap-0.5 items-center flex-shrink-0">
          {[
            { id: 'rotation',      icon: Layers,           label: 'Rotation',  always: true  },
            { id: 'dancers',       icon: Users,            label: 'Roster',    always: true  },
            { id: 'options',       icon: SlidersHorizontal,label: 'Options',   always: true  },
            { id: 'announcements', icon: Mic,              label: 'Announce',  kiosk: true   },
            { id: 'sfx',           icon: Drum,             label: 'SFX',       kiosk: true   },
          ].filter(t => t.always || (!remoteMode && t.kiosk)).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`w-14 h-14 flex flex-col items-center justify-center rounded-xl gap-1 transition-colors ${
                activeTab === id
                  ? 'bg-[#00d4ff]/15 text-[#00d4ff]'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-[#151528]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[9px] font-medium leading-tight">{label}</span>
            </button>
          ))}

          <div className="flex-1" />

          {isHomebase && (
            <Link to="/VoiceStudio">
              <button className="w-14 h-14 flex flex-col items-center justify-center rounded-xl gap-1 text-gray-500 hover:text-gray-300 hover:bg-[#151528] transition-colors">
                <Mic className="w-5 h-5" />
                <span className="text-[9px] font-medium leading-tight">Studio</span>
              </button>
            </Link>
          )}
          <Link to={createPageUrl('Help')}>
            <button className="w-14 h-14 flex flex-col items-center justify-center rounded-xl gap-1 text-gray-500 hover:text-gray-300 hover:bg-[#151528] transition-colors">
              <HelpCircle className="w-5 h-5" />
              <span className="text-[9px] font-medium leading-tight">Help</span>
            </button>
          </Link>
        </div>

        {/* Main Area - Full Screen */}
        <div className="flex-1 relative min-h-0">
          {/* Content Area */}
          <div className="h-full p-4 overflow-hidden">
            {activeTab === 'options' && (
              <div className="h-full overflow-auto">
                <DJOptions
                  djOptions={djOptions}
                  onOptionsChange={(opts) => {
                    setDjOptions(opts);
                    djOptionsRef.current = opts;
                  }}
                  audioEngineRef={audioEngineRef}
                />
              </div>
            )}

            {activeTab === 'rotation' && remoteMode && (
              <div className="h-full bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-4 overflow-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Live Rotation</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Songs/Set:</span>
                    <select
                      value={liveBoothState?.songsPerSet || 3}
                      onChange={(e) => boothApi.sendCommand('setSongsPerSet', { count: parseInt(e.target.value) })}
                      className="bg-[#151528] border border-[#1e293b] text-white text-xs rounded px-2 py-1"
                    >
                      {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>
                
                {(liveBoothState?.rotation || []).length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-8">No dancers in rotation</p>
                ) : (
                  <div className="space-y-2 mb-4">
                    {(liveBoothState?.rotation || []).map((dancerId, idx) => {
                      const dancer = dancers.find(d => d.id === dancerId);
                      if (!dancer) return null;
                      const isCurrent = idx === (liveBoothState?.currentDancerIndex || 0) && liveBoothState?.isRotationActive;
                      const dancerSongs = liveBoothState?.rotationSongs?.[dancerId] || [];
                      const remoteFreq = localStorage.getItem('neonaidj_commercial_freq') || 'off';
                      const remoteFreqNum = parseInt(remoteFreq);
                      const showCommercial = remoteFreq !== 'off' && remoteFreqNum >= 1 && (idx + 1) % remoteFreqNum === 0 && idx < (liveBoothState?.rotation || []).length - 1;
                      return (
                        <React.Fragment key={dancerId}>
                        <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${isCurrent ? 'bg-[#00d4ff]/10 border-[#00d4ff]/40' : 'bg-[#151528] border-[#1e293b]'}`}>
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-black font-bold text-xs flex-shrink-0" style={{ backgroundColor: dancer.color || '#00d4ff' }}>
                            {dancer.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${isCurrent ? 'text-[#00d4ff]' : 'text-white'}`}>{dancer.name}</p>
                            {dancerSongs.length > 0 && (
                              <p className="text-sm text-gray-400 truncate">{dancerSongs.map(s => typeof s === 'string' ? s : s.name).join(', ')}</p>
                            )}
                          </div>
                          <button
                            onClick={() => boothApi.sendCommand('removeDancerFromRotation', { dancerId })}
                            className="p-1.5 text-red-400/60 hover:text-red-400 transition-colors flex-shrink-0"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        {showCommercial && (
                          <div className="flex items-center gap-2 px-3 py-1.5 mx-1 rounded-lg bg-amber-900/20 border border-amber-500/30">
                            <Radio className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                            <p className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider flex-1">Commercial Break</p>
                          </div>
                        )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
                
                {Object.keys(liveBoothState?.dancerVipMap || {}).length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span>👑</span> In VIP ({Object.keys(liveBoothState.dancerVipMap).length})
                    </h4>
                    <div className="space-y-2">
                      {Object.entries(liveBoothState.dancerVipMap).map(([dancerId, vipEntry]) => {
                        const dancer = dancers.find(d => d.id === parseInt(dancerId) || d.id === dancerId);
                        if (!dancer) return null;
                        const msLeft = vipEntry.expiresAt ? Math.max(0, vipEntry.expiresAt - Date.now()) : 0;
                        const minsLeft = Math.floor(msLeft / 60000);
                        const secsLeft = Math.floor((msLeft % 60000) / 1000);
                        return (
                          <div key={dancerId} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-yellow-500/30 bg-yellow-900/10">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-black font-bold text-xs flex-shrink-0" style={{ backgroundColor: dancer.color || '#00d4ff' }}>
                              {dancer.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white">{dancer.name}</p>
                              <p className="text-xs text-yellow-400">Returns in {minsLeft}:{String(secsLeft).padStart(2,'0')}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="border-t border-[#1e293b] pt-4">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Add to Rotation</h4>
                  <div className="space-y-1">
                    {dancers.filter(d => d.is_active && !(liveBoothState?.rotation || []).includes(d.id) && !Object.keys(liveBoothState?.dancerVipMap || {}).includes(String(d.id))).map(dancer => (
                      <button
                        key={dancer.id}
                        onClick={() => boothApi.sendCommand('addDancerToRotation', { dancerId: dancer.id })}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-[#151528] transition-colors"
                      >
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-black font-bold text-xs" style={{ backgroundColor: dancer.color || '#00d4ff' }}>
                          {dancer.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-gray-300">{dancer.name}</span>
                        <Plus className="w-4 h-4 text-[#00d4ff] ml-auto" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'rotation' && !remoteMode && (
              <RotationPlaylistManager
                dancers={dancers}
                rotation={rotation}
                tracks={tracks}
                djOptions={djOptions}
                songCooldowns={playedSongsMap}
                activeRotationSongs={isRotationActive ? rotationSongs : null}
                savedInterstitials={interstitialSongsState}
                interstitialRemoteVersion={interstitialRemoteVersion}
                activeBreakInfo={activeBreakInfo}
                onRemoveActiveBreakSong={(breakKey, actualIndex) => {
                  const currentSongs = interstitialSongsRef.current[breakKey] || [];
                  const updated = [...currentSongs];
                  if (actualIndex >= 0 && actualIndex < updated.length) {
                    updated.splice(actualIndex, 1);
                  }
                  const newInterstitials = { ...interstitialSongsRef.current };
                  if (updated.length === 0) {
                    delete newInterstitials[breakKey];
                  } else {
                    newInterstitials[breakKey] = updated;
                  }
                  interstitialSongsRef.current = newInterstitials;
                  setInterstitialSongsState({ ...newInterstitials });
                  try { localStorage.setItem('djbooth_interstitial_songs', JSON.stringify(newInterstitials)); } catch {}
                  if (activeBreakInfo && activeBreakInfo.breakKey === breakKey) {
                    const newSongs = [...activeBreakInfo.songs];
                    if (actualIndex >= 0 && actualIndex < newSongs.length) {
                      newSongs.splice(actualIndex, 1);
                    }
                    if (interstitialIndexRef.current > actualIndex) {
                      interstitialIndexRef.current = Math.max(0, interstitialIndexRef.current - 1);
                    }
                    setActiveBreakInfo({ ...activeBreakInfo, songs: newSongs });
                  }
                }}
                onUpdateActiveBreakSongs={(breakKey, newFullSongs) => {
                  const newInterstitials = { ...interstitialSongsRef.current };
                  if (newFullSongs.length === 0) {
                    delete newInterstitials[breakKey];
                  } else {
                    newInterstitials[breakKey] = newFullSongs;
                  }
                  interstitialSongsRef.current = newInterstitials;
                  setInterstitialSongsState({ ...newInterstitials });
                  try { localStorage.setItem('djbooth_interstitial_songs', JSON.stringify(newInterstitials)); } catch {}
                  if (activeBreakInfo && activeBreakInfo.breakKey === breakKey) {
                    setActiveBreakInfo({ ...activeBreakInfo, songs: newFullSongs });
                  }
                }}
                onAutoSavePlaylist={async (dancerId, displayedSongs, action) => {
                  const dancer = dancers.find(d => d.id === dancerId);
                  const existingPlaylist = dancer?.playlist || [];

                  let updatedPlaylist;
                  if (action?.type === 'add' && action.song) {
                    updatedPlaylist = [...existingPlaylist];
                    if (!updatedPlaylist.includes(action.song)) {
                      updatedPlaylist.push(action.song);
                    }
                  } else if (action?.type === 'remove' && action.song) {
                    updatedPlaylist = existingPlaylist.filter(s => s !== action.song);
                  } else if (action?.type === 'reorder') {
                    const playlistSet = new Set(existingPlaylist);
                    updatedPlaylist = displayedSongs.filter(s => playlistSet.has(s));
                  } else {
                    updatedPlaylist = existingPlaylist;
                  }

                  if (updatedPlaylist.length !== existingPlaylist.length || !updatedPlaylist.every((s, i) => s === existingPlaylist[i])) {
                    updateDancerMutation.mutate({ id: dancerId, data: { playlist: updatedPlaylist } });
                  }
                  if (isRotationActive && tracks.length > 0) {
                    const resolved = [];
                    for (const name of displayedSongs) {
                      let track = tracks.find(t => t.name === name);
                      if (!track) track = await resolveTrackByName(name);
                      if (track) resolved.push(track);
                    }
                    if (resolved.length > 0) {
                      const updated = { ...rotationSongsRef.current, [dancerId]: resolved };
                      setRotationSongs(updated);
                      rotationSongsRef.current = updated;
                    }
                  }
                }}
                onSaveAll={async (newRotation, playlists, interstitials = {}, manualOverrides = []) => {
                  if (isRotationActive && rotationRef.current.length > 0) {
                    const currentPerformerId = rotationRef.current[currentDancerIndexRef.current];
                    if (currentPerformerId != null) {
                      const newIdx = newRotation.indexOf(currentPerformerId);
                      const wasAtTop = currentDancerIndexRef.current === 0;
                      const movedAwayFromTop = wasAtTop && newIdx !== 0;
                      if (movedAwayFromTop) {
                        console.log(`🔄 Save All: current dancer dragged off top — treating as skip, resetting to new top dancer`);
                        currentSongNumberRef.current = 0;
                        setCurrentSongNumber(0);
                      } else if (newIdx >= 0 && newIdx !== currentDancerIndexRef.current) {
                        console.log(`🔄 Save All: adjusting currentDancerIndex ${currentDancerIndexRef.current} → ${newIdx} (performer ID ${currentPerformerId})`);
                        setCurrentDancerIndex(newIdx);
                        currentDancerIndexRef.current = newIdx;
                      }
                    }
                  }
                  setRotation(newRotation);
                  rotationRef.current = newRotation;
                  const _saveIdx = (() => {
                    if (!isRotationActive) return currentDancerIndexRef.current;
                    const perf = rotationRef.current[currentDancerIndexRef.current];
                    const ni = newRotation.indexOf(perf);
                    return ni >= 0 ? ni : currentDancerIndexRef.current;
                  })();
                  fetch('/api/stage/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rotation_order: newRotation, current_dancer_index: _saveIdx, is_active: true })
                  }).catch(() => {});
                  interstitialSongsRef.current = interstitials;
                  setInterstitialSongsState(interstitials);
                  setInterstitialRemoteVersion(v => v + 1);
                  try { localStorage.setItem('djbooth_interstitial_songs', JSON.stringify(interstitials)); } catch {}
                  const overrideSet = new Set(manualOverrides.map(id => String(id)));
                  const playlistUpdates = [];
                  for (const [dancerId, displayedSongs] of Object.entries(playlists)) {
                    const dancer = dancers.find(d => String(d.id) === String(dancerId));
                    const existingPlaylist = dancer?.playlist || [];

                    if (!overrideSet.has(String(dancerId))) continue;
                    const playlistSet = new Set(existingPlaylist);
                    const newSongs = displayedSongs.filter(s => !playlistSet.has(s));
                    const updatedPlaylist = [...existingPlaylist, ...newSongs];
                    if (newSongs.length > 0) {
                      console.log(`🎵 Added ${newSongs.length} song(s) to ${dancer?.name}'s permanent playlist: ${newSongs.join(', ')}`);
                      playlistUpdates.push({ id: dancerId, name: dancer?.name, playlist: updatedPlaylist });
                    }
                  }
                  let saveErrors = 0;
                  for (const update of playlistUpdates) {
                    try {
                      await localEntities.Dancer.update(update.id, { playlist: update.playlist });
                      console.log(`💾 Saved ${update.name}'s playlist (${update.playlist.length} songs)`);
                    } catch (err) {
                      saveErrors++;
                      console.error(`❌ Failed to save ${update.name}'s playlist:`, err.message);
                    }
                  }
                  if (saveErrors > 0) {
                    console.error(`❌ ${saveErrors} playlist save(s) failed — check connection`);
                  }
                  if (playlistUpdates.length > 0) {
                    queryClient.invalidateQueries({ queryKey: ['dancers'] });
                  }
                  if (tracks.length > 0) {
                    const updatedSongs = { ...(rotationSongsRef.current || {}) };
                    for (const [dancerId, songNames] of Object.entries(playlists)) {
                      if (!overrideSet.has(String(dancerId))) continue;
                      const resolved = [];
                      for (const name of songNames) {
                        let track = tracks.find(t => t.name === name);
                        if (!track) {
                          track = await resolveTrackByName(name);
                        }
                        if (track) resolved.push(track);
                      }
                      updatedSongs[dancerId] = resolved;
                      if (resolved.length > 0) {
                        djSavedSongsRef.current[dancerId] = resolved;
                        console.log(`🎵 DJ saved ${resolved.length} song(s) for dancer ${dancerId} — will survive next transition`);
                      }
                    }
                    setRotationSongs(updatedSongs);
                    rotationSongsRef.current = updatedSongs;
                    console.log('🎵 Live rotation playlists updated');
                    if (Object.keys(interstitials).length > 0) {
                      console.log('🎵 Interstitial songs updated:', Object.keys(interstitials).length, 'break slots');
                    }
                  }
                  if (announcementRef.current?.preCacheUpcoming) {
                    const lookahead = Math.min(3, newRotation.length);
                    const startIdx = currentDancerIndexRef.current;
                    const upcoming = [];
                    for (let i = 0; i < lookahead; i++) {
                      const rIdx = (startIdx + i) % newRotation.length;
                      const nIdx = (startIdx + i + 1) % newRotation.length;
                      const dancer = dancers.find(d => d.id === newRotation[rIdx]);
                      const nextDancer = dancers.find(d => d.id === newRotation[nIdx]);
                      if (dancer?.name) {
                        upcoming.push({ name: dancer.name, nextName: nextDancer?.name || null });
                      }
                    }
                    if (upcoming.length > 0) {
                      console.log(`🎙️ Pre-caching voiceovers for ${upcoming.length} upcoming entertainer(s)`);
                      announcementRef.current?.preCacheUpcoming(upcoming);
                    }
                  }
                  if (activeStage) {
                    await updateStageMutation.mutateAsync({
                      id: activeStage.id,
                      data: {
                        rotation_order: newRotation,
                        current_dancer_index: currentDancerIndexRef.current,
                        is_active: true
                      }
                    });
                  } else if (newRotation.length > 0) {
                    await localEntities.Stage.create({
                      name: 'Main Stage',
                      rotation_order: newRotation,
                      current_dancer_index: 0,
                      is_active: true
                    });
                    queryClient.invalidateQueries({ queryKey: ['stages'] });
                  }
                }}
                onAddToRotation={addToRotation}
                onRemoveFromRotation={removeFromRotation}
                onStartRotation={startRotation}
                isRotationActive={isRotationActive}
                rotationPending={rotationPending}
                onCancelPendingRotation={() => {
                  rotationPendingRef.current = false;
                  setRotationPending(false);
                  console.log('🚫 Pending rotation cancelled');
                }}
                announcementsEnabled={announcementsEnabled}
                onAnnouncementsToggle={(enabled) => setAnnouncementsEnabled(enabled)}
                currentDancerIndex={currentDancerIndex}
                commercialCounter={commercialCounterRef.current}
                availablePromos={availablePromos}
                promoQueue={promoQueue}
                onSwapPromo={swapPromoAtSlot}
                onSkipCurrentDancer={() => {
                  if (!isRotationActiveRef.current) return;
                  if (rotationRef.current.length <= 1) return;
                  // Force song number past any set size so handleSkip takes the end-of-set
                  // path — it flips rotation, resets her songs, plays break songs if queued,
                  // and gives the next dancer a full intro.
                  setCurrentSongNumber(999);
                  currentSongNumberRef.current = 999;
                  handleSkipRef.current?.();
                }}
                onSkipDancer={(dancerId) => {
                  if (!isRotationActive) return;
                  const rot = [...rotationRef.current];
                  if (rot.length <= 1) return;
                  const skipIdx = rot.indexOf(dancerId);
                  if (skipIdx === -1) return;
                  const currentIdx = currentDancerIndexRef.current;
                  if (currentIdx < 0 || currentIdx >= rot.length) return;
                  const currentDancerId = rot[currentIdx];
                  if (dancerId === currentDancerId) return;
                  rot.splice(skipIdx, 1);
                  rot.push(dancerId);
                  let newCurrentIdx = 0;
                  for (let i = 0; i < rot.length; i++) {
                    if (rot[i] === currentDancerId) { newCurrentIdx = i; break; }
                  }
                  setRotation(rot);
                  rotationRef.current = rot;
                  setCurrentDancerIndex(newCurrentIdx);
                  currentDancerIndexRef.current = newCurrentIdx;
                  updateStageState(newCurrentIdx, rot);
                  const dancer = dancers.find(d => d.id === dancerId);
                  console.log('⏭️ Skipped dancer to bottom:', dancer?.name);
                  toast(`${dancer?.name || 'Entertainer'} moved to end of rotation`, { icon: '⏭️' });
                }}
                onDancerDragReorder={(newRotation, oldFirstId, newFirstId) => {
                  if (!isRotationActive) return;
                  setRotation(newRotation);
                  rotationRef.current = newRotation;
                  setCurrentDancerIndex(0);
                  currentDancerIndexRef.current = 0;
                  setCurrentSongNumber(0);
                  currentSongNumberRef.current = 0;
                  updateStageState(0, newRotation);
                  const incomingDancer = dancers.find(d => d.id === newFirstId);
                  console.log('🔀 Drag reorder: jumping to new first dancer:', incomingDancer?.name);
                  toast(`Now playing: ${incomingDancer?.name || 'Entertainer'}`, { icon: '🔀' });
                  setTimeout(() => handleSkipRef.current?.(), 100);
                }}
                dancerVipMap={dancerVipMap}
                pendingVipMap={pendingVipState}
                onSendToVip={sendDancerToVip}
                onReleaseFromVip={releaseDancerFromVip}
                currentSongNumber={currentSongNumber}
                currentTrack={currentTrack}
                breakSongsPerSet={breakSongsPerSet}
                onBreakSongsPerSetChange={(n) => {
                  const wasBreak = breakSongsPerSetRef.current > 0;
                  setBreakSongsPerSet(n);
                  breakSongsPerSetRef.current = n;
                  if (n > 0) {
                    if (!wasBreak) auditEvent('break_mode_on', `${n} break songs per set`);
                    autoPopulateBreakSongs(n);
                  } else {
                    if (wasBreak) auditEvent('break_mode_off');
                    interstitialSongsRef.current = {};
                    setInterstitialSongsState({});
                    setInterstitialRemoteVersion(v => v + 1);
                    try { localStorage.setItem('djbooth_interstitial_songs', '{}'); } catch {}
                  }
                }}
                songsPerSet={songsPerSet}
                onSongsPerSetChange={(n) => {
                  setSongsPerSet(n);
                  songsPerSetRef.current = n;
                  if (isRotationActive) {
                    const currentSongs = { ...rotationSongsRef.current };
                    rotation.forEach(dancerId => {
                      const existing = currentSongs[dancerId] || [];
                      if (existing.length < n) {
                        const usedNames = new Set(existing.map(t => t.name));
                        const available = filterCooldown(tracks.filter(t => !usedNames.has(t.name)));
                        const shuffled = fisherYatesShuffle(available);
                        currentSongs[dancerId] = [...existing, ...shuffled.slice(0, n - existing.length)];
                      } else if (existing.length > n) {
                        currentSongs[dancerId] = existing.slice(0, n);
                      }
                    });
                    setRotationSongs(currentSongs);
                    rotationSongsRef.current = currentSongs;
                  }
                }}
                onSongAssignmentsChange={setPlannedSongAssignments}
                autoplayQueue={autoplayQueue}
                onAutoplayQueueChange={(newQueue) => {
                  updateAutoplayQueue(newQueue);
                  fillAutoplayQueue(newQueue);
                }}
                onAutoplayQueueRemove={(index) => {
                  const newQueue = [...autoplayQueueRef.current];
                  newQueue.splice(index, 1);
                  updateAutoplayQueue(newQueue);
                  fillAutoplayQueue(newQueue);
                }}
              />
            )}
            
            {activeTab === 'dancers' && (
              <div className="h-full bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-4 overflow-auto">
                <DancerRoster
                  dancers={dancers}
                  rotation={rotation}
                  onAddToRotation={addToRotation}
                  onRemoveFromRotation={removeFromRotation}
                  onAddDancer={addDancer}
                  onEditDancer={(id, data) => updateDancerMutation.mutate({ id, data })}
                  onDeleteDancer={(id) => deleteDancerMutation.mutate(id)}
                  onEditPlaylist={(dancer) => {
                    setSelectedDancer(dancer);
                    setEditingPlaylist(dancer);
                  }}
                  selectedDancerId={selectedDancer?.id}
                  dancerVipMap={dancerVipMap}
                  pendingVipState={pendingVipState}
                  onSendToVip={sendDancerToVip}
                  onReleaseFromVip={releaseDancerFromVip}
                />
              </div>
            )}
            
            {!remoteMode && (
              <div className="h-full bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-4 flex flex-col overflow-hidden" style={{ display: activeTab === 'library' ? 'flex' : 'none' }}>
                <MusicLibrary
                  dancers={dancers}
                  onTrackSelect={(track) => {
                    if (editingPlaylist) return;
                    if (track.url) playTrack(track.url, true, track.name, track.genre);
                  }}
                />
              </div>
            )}
            
            {!remoteMode && activeTab === 'announcements' && (
              <div className="h-full overflow-y-auto">
                <div className="flex flex-col gap-6 pb-6">
                  <AnnouncementSystem
                    dancers={dancers}
                    rotation={rotation}
                    currentDancerIndex={currentDancerIndex}
                    onPlay={handleAnnouncementPlay}
                    elevenLabsApiKey={elevenLabsKey}
                    openaiApiKey={openaiKey}
                    hideUI={false}
                    onVoiceDiag={logDiag}
                  />
                  <div className="bg-[#0d0d1f] rounded-xl border border-amber-500/20 p-4">
                    <HouseAnnouncementPanel onPlay={handleAnnouncementPlay} />
                  </div>
                  <ManualAnnouncementPlayer onPlay={handleAnnouncementPlay} />
                </div>
              </div>
            )}

            {!remoteMode && activeTab === 'sfx' && (
              <div className="h-full overflow-y-auto px-2 py-3 space-y-4">
                {/* Boost selector */}
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">SFX Level — Voice Volume × boost</div>
                  <div className="flex gap-2">
                    {[{ label: '1×', val: 1.0 }, { label: '1.5×', val: 1.5 }, { label: '2×', val: 2.0 }].map(({ label, val }) => (
                      <button key={val} onClick={() => setSfxBoost(val)}
                        className={`flex-1 h-12 rounded-xl font-bold text-base transition-colors ${sfxBoost === val ? 'bg-[#00d4ff] text-black' : 'bg-[#1e293b] text-gray-400 hover:bg-[#2e2e5a]'}`}>
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
                      { id: 'airhorn',    emoji: '📯', label: 'Air Horn'   },
                      { id: 'scratch',    emoji: '💿', label: 'Scratch'    },
                      { id: 'rewind',     emoji: '⏪', label: 'Rewind'     },
                      { id: 'bassdrop',   emoji: '💥', label: 'Bass Drop'  },
                      { id: 'foghorn',    emoji: '🚢', label: 'Foghorn'    },
                      { id: 'vinylstop',  emoji: '⏹', label: 'Vinyl Stop' },
                      { id: 'siren',      emoji: '🚨', label: 'Siren'      },
                      { id: 'woo',        emoji: '👑', label: 'Woo!'       },
                      { id: 'crowdcheer', emoji: '📢', label: 'Crowd'      },
                      { id: 'laser',      emoji: '⚡', label: 'Laser'      },
                    ].map(({ id, emoji, label }) => (
                      <button key={id}
                        onPointerDown={() => {
                          const AC = window.AudioContext || window.webkitAudioContext;
                          if (!soundboardCtxRef.current || soundboardCtxRef.current.state === 'closed') soundboardCtxRef.current = new AC();
                          playSoundboardEffect(id, soundboardCtxRef.current, volume * sfxBoost);
                        }}
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
                      { id: 'bruh',          emoji: '😐', label: 'Bruh'      },
                      { id: 'vineboom',      emoji: '💣', label: 'Vine Boom' },
                      { id: 'johncena',      emoji: '🎺', label: 'John Cena' },
                      { id: 'ohyeah',        emoji: '😎', label: 'Oh Yeah'   },
                      { id: 'sadtrombone',   emoji: '😢', label: 'Sad Bone'  },
                      { id: 'getout',        emoji: '🚪', label: 'Get Out!'  },
                      { id: 'boomshakalaka', emoji: '🏀', label: 'Boomshaka' },
                      { id: 'mlghorn',       emoji: '🎮', label: 'MLG Horn'  },
                      { id: 'spongebob',     emoji: '🧽', label: 'SpongeBob' },
                      { id: 'itslit',        emoji: '🔥', label: "It's Lit"  },
                    ].map(({ id, emoji, label }) => (
                      <button key={id}
                        onPointerDown={() => {
                          const AC = window.AudioContext || window.webkitAudioContext;
                          if (!soundboardCtxRef.current || soundboardCtxRef.current.state === 'closed') soundboardCtxRef.current = new AC();
                          playSoundboardEffect(id, soundboardCtxRef.current, volume * sfxBoost);
                        }}
                        className="flex flex-col items-center justify-center gap-1 h-20 rounded-2xl bg-[#0d0d1f] border border-[#a855f7]/20 active:bg-[#a855f7]/15 active:border-[#a855f7]/60 active:scale-95 transition-transform select-none">
                        <span className="text-2xl leading-none">{emoji}</span>
                        <span className="text-xs text-gray-400 leading-tight text-center">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Sounds */}
                <CustomSoundboard volume={volume} sfxBoost={sfxBoost} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Playlist Editor Modal */}
      {editingPlaylist && (
        <PlaylistEditor
          dancer={editingPlaylist}
          tracks={tracks}
          onSave={(playlist) => {
            updateDancerMutation.mutate({ 
              id: editingPlaylist.id, 
              data: { playlist } 
            });
          }}
          onClose={() => {
            setEditingPlaylist(null);
            setSelectedDancer(null);
          }}
        />
      )}


      {showDeactivatePin && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70" onClick={() => setShowDeactivatePin(false)}>
          <div className="bg-[#0d0d1f] border border-red-500/40 rounded-2xl p-6 w-[320px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-red-400 mb-1">Confirm Deactivation</h3>
            <p className="text-xs text-gray-400 mb-4 truncate">
              {currentTrack || 'Current song'}
            </p>
            <p className="text-sm text-gray-300 mb-3">Enter your DJ PIN to deactivate:</p>
            <input
              ref={deactivatePinInputRef}
              type="password"
              inputMode="numeric"
              maxLength={5}
              value={deactivatePin}
              onChange={e => setDeactivatePin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') handleDeactivateConfirm(); }}
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
                onClick={handleDeactivateConfirm}
                disabled={deactivatePin.length !== 5}
                className="flex-1 py-2.5 rounded-lg bg-red-500 text-white text-sm font-semibold active:bg-red-600 disabled:opacity-30 transition-colors"
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}