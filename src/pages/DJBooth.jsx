import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { localEntities } from '@/api/localEntities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { createPageUrl } from '@/utils';
import { getApiConfig, saveApiConfig, loadApiConfig } from '@/components/apiConfig';
import { getCurrentEnergyLevel, ENERGY_LEVELS } from '@/utils/energyLevels';
import { toast } from 'sonner';
import { 
  Settings, 
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
  X,
  FolderOpen,
  SlidersHorizontal,
  MonitorOff,
  HelpCircle
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import AudioEngine from '@/components/dj/AudioEngine';
import MusicLibrary from '@/components/dj/MusicLibrary';
import { isRemoteMode, boothApi, connectBoothSSE, djOptionsApi } from '@/api/serverApi';
import NowPlaying from '@/components/dj/NowPlaying';
import DancerRoster from '@/components/dj/DancerRoster';
import StageRotation from '@/components/dj/StageRotation';
import PlaylistEditor from '@/components/dj/PlaylistEditor';
import AnnouncementSystem from '@/components/dj/AnnouncementSystem';
import RotationPlaylistManager from '@/components/dj/RotationPlaylistManager';
import ManualAnnouncementPlayer from '@/components/dj/ManualAnnouncementPlayer';
import RemoteView from '@/components/dj/RemoteView';
import DJOptions from '@/components/dj/DJOptions';

const DEFAULT_SONGS_PER_SET = 2;

export default function DJBooth() {
  const queryClient = useQueryClient();
  const audioEngineRef = useRef(null);
  const remoteMode = isRemoteMode();
  
  // Music tracks state (loaded from server)
  const [tracks, setTracks] = useState([]);
  
  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const lastTimeStampRef = useRef(performance.now());
  const isPlayingRef = useRef(false);
  const timeDisplayRef = useRef(null);
  const [volume, setVolume] = useState(0.8);
  const updateThrottleRef = useRef(0);
  
  // Rotation state
  const [rotation, setRotation] = useState([]);
  const [currentDancerIndex, setCurrentDancerIndex] = useState(0);
  const [currentSongNumber, setCurrentSongNumber] = useState(1);
  const [isRotationActive, setIsRotationActive] = useState(false);
  const isRotationActiveRef = useRef(false);
  const [rotationSongs, setRotationSongs] = useState({});
  const currentDancerIndexRef = useRef(0);
  const currentSongNumberRef = useRef(1);
  const rotationSongsRef = useRef({});
  const [songsPerSet, setSongsPerSet] = useState(DEFAULT_SONGS_PER_SET);
  const songsPerSetRef = useRef(DEFAULT_SONGS_PER_SET);
  const [energyOverride, setEnergyOverride] = useState(() => getApiConfig().energyOverride || 'auto');
  const [djOptions, setDjOptions] = useState({ activeGenres: [], musicMode: 'dancer_first' });
  const djOptionsRef = useRef({ activeGenres: [], musicMode: 'dancer_first' });
  const rotationRef = useRef([]);
  const dancersRef = useRef([]);
  const transitionInProgressRef = useRef(false);
  const transitionStartTimeRef = useRef(0);
  const lastAudioActivityRef = useRef(Date.now());
  const playbackExpectedRef = useRef(false);
  const watchdogRecoveringRef = useRef(false);
  const rotationPendingRef = useRef(false);
  const [rotationPending, setRotationPending] = useState(false);
  const interstitialSongsRef = useRef((() => {
    try {
      const saved = localStorage.getItem('djbooth_interstitial_songs');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  })());
  const playingInterstitialRef = useRef(false);
  const interstitialIndexRef = useRef(0);
  const handleSkipRef = useRef(null);
  
  const DUCK_SETTLE_MS = 300;
  const SONG_OVERLAP_DELAY_MS = 10000;
  const waitForDuck = () => {
    lastAudioActivityRef.current = Date.now();
    return new Promise(r => setTimeout(() => {
      lastAudioActivityRef.current = Date.now();
      r();
    }, DUCK_SETTLE_MS));
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

  useEffect(() => {
    if (songCooldownRef.current !== null) return;
    try {
      const raw = localStorage.getItem('djbooth_song_cooldowns');
      if (raw) {
        const parsed = JSON.parse(raw);
        const now = Date.now();
        const valid = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (now - v < COOLDOWN_MS) valid[k] = v;
        }
        songCooldownRef.current = valid;
      } else {
        songCooldownRef.current = {};
      }
    } catch {
      songCooldownRef.current = {};
    }
  }, []);

  const recordSongPlayed = useCallback((trackName, dancerName = null, genre = null) => {
    if (!trackName || !songCooldownRef.current) return;
    songCooldownRef.current[trackName] = Date.now();
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
    const token = sessionStorage.getItem('djbooth_token');
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
        if (isPlayingRef.current && audioEngineRef.current) {
          console.log('👁️ Page visible — resuming audio playback');
          setTimeout(() => {
            try {
              audioEngineRef.current?.resume();
              lastAudioActivityRef.current = Date.now();
            } catch (err) {
              console.error('❌ Failed to resume after visibility change:', err.message);
            }
          }, 100);
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
      if (isPlayingRef.current && audioEngineRef.current) {
        lastAudioActivityRef.current = Date.now();
        try { audioEngineRef.current?.resume(); } catch {}
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
  const [activeTab, setActiveTab] = useState(remoteMode ? 'rotation' : 'library');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isImportingVoiceovers, setIsImportingVoiceovers] = useState(false);
  const [voImportProgress, setVoImportProgress] = useState('');
  const [voiceId, setVoiceId] = useState('');
  
  // Configuration (from config file)
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [announcementsEnabled, setAnnouncementsEnabled] = useState(true);
  const [scriptModel, setScriptModel] = useState('auto');
  const [clubSpecials, setClubSpecials] = useState('');

  const announcementRef = useRef(null);

  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    loadApiConfig().then(config => {
      setElevenLabsKey(config.elevenLabsApiKey);
      setOpenaiKey(config.openaiApiKey);
      setAnnouncementsEnabled(config.announcementsEnabled);
      setVoiceId(config.elevenLabsVoiceId);
      setScriptModel(config.scriptModel || 'auto');
      setClubSpecials(config.clubSpecials || '');
      setConfigLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    saveApiConfig({
      openaiApiKey: openaiKey,
      elevenLabsApiKey: elevenLabsKey,
      elevenLabsVoiceId: voiceId,
      announcementsEnabled,
      scriptModel,
      clubSpecials,
    });
  }, [openaiKey, elevenLabsKey, voiceId, announcementsEnabled, scriptModel, clubSpecials, configLoaded]);

  const handleImportVoiceovers = async () => {
    if (!window.showDirectoryPicker) {
      toast.error('Folder picker not supported — use Chromium/Chrome');
      return;
    }
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      setIsImportingVoiceovers(true);
      setVoImportProgress('Scanning folder...');

      const token = sessionStorage.getItem('djbooth_token');
      const authHeaders = {};
      if (token) authHeaders['Authorization'] = `Bearer ${token}`;

      const mp3Files = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.mp3')) {
          mp3Files.push(entry);
        }
      }

      if (mp3Files.length === 0) {
        toast.error('No MP3 files found in the selected folder');
        setIsImportingVoiceovers(false);
        setVoImportProgress('');
        return;
      }

      const checkKeys = mp3Files.map(f => f.name.replace(/\.mp3$/i, ''));
      let existingKeys = new Set();
      try {
        const checkRes = await fetch(`/api/voiceovers/check?keys=${encodeURIComponent(checkKeys.join(','))}`, { headers: authHeaders });
        if (checkRes.ok) {
          const { cached } = await checkRes.json();
          existingKeys = new Set(Object.keys(cached).filter(k => cached[k]));
        }
      } catch {}

      const toImport = mp3Files.filter(f => !existingKeys.has(f.name.replace(/\.mp3$/i, '')));
      const skipped = mp3Files.length - toImport.length;

      let imported = 0;
      let failed = 0;

      for (const fileHandle of toImport) {
        const cacheKey = fileHandle.name.replace(/\.mp3$/i, '');
        setVoImportProgress(`Importing ${imported + 1}/${toImport.length}: ${cacheKey}`);

        try {
          const file = await fileHandle.getFile();
          const reader = new FileReader();
          const audio_base64 = await new Promise((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          let type = 'unknown';
          let dancer_name = '';
          let energy_level = 3;
          const parts = cacheKey.split('-');
          if (parts.length >= 3) {
            type = parts[0];
            energy_level = parseInt(parts[parts.length - 1].replace('L', ''), 10) || 3;
            dancer_name = parts.slice(1, -1).join('-');
            if (type === 'transition' && dancer_name.includes('-')) {
              const nameParts = dancer_name.split('-');
              dancer_name = nameParts[0];
            }
          }

          const res = await fetch('/api/voiceovers', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ cache_key: cacheKey, audio_base64, script: '', type, dancer_name, energy_level })
          });

          if (!res.ok) throw new Error('Upload failed');
          imported++;
        } catch (err) {
          console.error(`Failed to import ${cacheKey}:`, err);
          failed++;
        }
      }

      const msg = [`Imported ${imported} voiceovers`];
      if (skipped > 0) msg.push(`${skipped} already existed`);
      if (failed > 0) msg.push(`${failed} failed`);
      toast.success(msg.join(', '));
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Import voiceovers error:', err);
        toast.error('Failed to import voiceovers');
      }
    } finally {
      setIsImportingVoiceovers(false);
      setVoImportProgress('');
    }
  };

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
    let active = true;

    boothApi.getState().then(state => { if (active) setLiveBoothState(state); }).catch(() => {});

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

    if (remoteMode) {
      djOptionsApi.get()
        .then(opts => { if (active) { setDjOptions(opts); djOptionsRef.current = opts; } })
        .catch(() => {});
    }

    return () => { active = false; sseRef.current?.close(); sseRef.current = null; };
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

  const lastCommandIdRef = useRef(0);
  const commandSseRef = useRef(null);

  const executeCommand = useCallback((cmd) => {
    try {
      lastCommandIdRef.current = Math.max(lastCommandIdRef.current, cmd.id);
      switch (cmd.action) {
        case 'skip':
          handleSkipRef.current?.();
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
            setRotation(prev => {
              const updated = prev.filter(id => id !== cmd.payload.dancerId);
              rotationRef.current = updated;
              return updated;
            });
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

    boothApi.getCommands(lastCommandIdRef.current).then(({ commands }) => {
      if (!active || !commands) return;
      commands.forEach(executeCommand);
      if (commands.length > 0) boothApi.ackCommands(lastCommandIdRef.current).catch(() => {});
    }).catch(() => {});

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

    return () => { active = false; commandSseRef.current?.close(); commandSseRef.current = null; };
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
        await boothApi.postState({
          isRotationActive,
          currentDancerIndex,
          currentDancerName: currentDancer?.name || null,
          currentTrack,
          currentSongNumber,
          songsPerSet,
          isPlaying,
          rotation,
          announcementsEnabled,
          rotationSongs,
        });
      } catch {}
    };
    broadcast();
    const interval = setInterval(broadcast, 5000);
    return () => clearInterval(interval);
  }, [remoteMode, isRotationActive, currentDancerIndex, currentTrack, currentSongNumber, songsPerSet, isPlaying, rotation, announcementsEnabled, dancers, rotationSongs]);

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
      const token = sessionStorage.getItem('djbooth_token');
      const res = await fetch('/api/music/tracks?limit=100', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) return null;
      const data = await res.json();
      const withUrls = data.tracks.map(t => ({ ...t, url: `/api/music/stream/${t.id}` }));
      setTracks(withUrls);
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
      const token = sessionStorage.getItem('djbooth_token');
      const opts = djOptionsRef.current;
      const genresParam = opts?.activeGenres?.length > 0 ? `&genres=${encodeURIComponent(opts.activeGenres.join(','))}` : '';
      const res = await fetch(`/api/music/random?count=5${genresParam}`, {
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
    if (name) recordSongPlayed(name);
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
  useEffect(() => {
    if (remoteMode || tracksLoadedRef.current) return;
    tracksLoadedRef.current = true;
    (async () => {
      const loaded = await refreshTracks();
      if (loaded && loaded.length > 0 && !isPlaying) {
        const pool = filterCooldown(loaded);
        const randomTrack = pool[Math.floor(Math.random() * pool.length)];
        if (randomTrack?.url) {
          lastAudioActivityRef.current = Date.now();
          await playTrack(randomTrack.url, true, randomTrack.name, randomTrack.genre);
        }
      }
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
      const token = sessionStorage.getItem('djbooth_token');
      const res = await fetch(`/api/music/track-by-name/${encodeURIComponent(trackName)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) return null;
      const track = await res.json();
      return { ...track, url: `/api/music/stream/${track.id}` };
    } catch { return null; }
  }, []);

  const getDancerTracks = useCallback(async (dancer, additionalExcludes = []) => {
    const count = songsPerSetRef.current;
    const alreadyAssigned = getAlreadyAssignedNames();
    const opts = djOptionsRef.current;
    const isFoldersOnly = opts?.musicMode === 'folders_only';
    const cooldowns = songCooldownRef.current || {};
    const now = Date.now();

    const cooldownNames = Object.entries(cooldowns)
      .filter(([, ts]) => ts && (now - ts) < COOLDOWN_MS)
      .map(([name]) => name);
    const excludeNames = [...new Set([...cooldownNames, ...alreadyAssigned, ...additionalExcludes])];

    const activeGenres = opts?.activeGenres?.length > 0 ? opts.activeGenres : [];
    const rawPlaylist = (!isFoldersOnly && dancer?.playlist?.length > 0) ? dancer.playlist : [];
    const dancerPlaylist = fisherYatesShuffle(rawPlaylist);

    try {
      const token = sessionStorage.getItem('djbooth_token');
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
          dancerPlaylist
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (res.ok) {
        const data = await res.json();
        const result = data.tracks || [];
        console.log(`🎵 getDancerTracks: ${dancer?.name || 'unknown'} → [${result.map(t => t.name).join(', ')}] (${result.length} tracks from server, playlist: ${dancerPlaylist.length}, excluded: ${excludeNames.length})`);
        return result;
      }
    } catch (err) {
      console.warn(`⚠️ getDancerTracks: Server select failed for ${dancer?.name}: ${err.message}, using local fallback`);
    }

    const excludeSet = new Set(excludeNames);
    const validTracks = tracks.filter(t => t && t.url);
    const available = validTracks.filter(t => !excludeSet.has(t.name));
    const offCooldown = available.filter(t => {
      const lastPlayed = cooldowns[t.name] || 0;
      return !lastPlayed || (now - lastPlayed) >= COOLDOWN_MS;
    });
    const pool = offCooldown.length >= count ? offCooldown : (available.length >= count ? available : validTracks);
    const result = fisherYatesShuffle(pool).slice(0, count);
    console.log(`🎵 getDancerTracks: ${dancer?.name || 'unknown'} → [${result.map(t => t.name).join(', ')}] (${result.length} tracks local fallback)`);
    return result;
  }, [tracks, filterCooldown, getAlreadyAssignedNames]);

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
    const cooldowns = songCooldownRef.current || {};
    const now = Date.now();
    const selectedSongs = {};
    const batchExcludes = [];
    for (const dancerId of cleanRotation) {
      const dancer = dnc.find(d => d.id === dancerId);
      if (dancer) {
        const existing = existingSongs[dancerId];
        const hasManualPlaylist = dancer.playlist && dancer.playlist.length > 0;
        const count = songsPerSetRef.current;
        const allOffCooldown = existing?.every(t => {
          const lastPlayed = cooldowns[t.name] || 0;
          return !lastPlayed || (now - lastPlayed) >= COOLDOWN_MS;
        });
        if (hasManualPlaylist && existing && existing.length >= count && existing.every(t => t.url) && allOffCooldown) {
          selectedSongs[dancerId] = existing;
          existing.forEach(t => { if (t?.name) batchExcludes.push(t.name); });
        } else {
          const dancerTracks = await getDancerTracks(dancer, batchExcludes);
          selectedSongs[dancerId] = dancerTracks;
          dancerTracks.forEach(t => { if (t?.name) batchExcludes.push(t.name); });
        }
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

  const startRotation = useCallback(async () => {
    if (rotation.length === 0 || !tracks.length) {
      console.error('❌ StartRotation: rotation.length=' + rotation.length + ', tracks.length=' + tracks.length);
      return;
    }

    const isPlaying = audioEngineRef.current?.isPlaying;
    if (isPlaying) {
      console.log('🎵 StartRotation: Music playing — queuing rotation to start after current song ends');
      rotationPendingRef.current = true;
      setRotationPending(true);
      return;
    }

    await beginRotation();
  }, [rotation, tracks, beginRotation]);

  const handleSkip = useCallback(async () => {
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
        const ok = await playFallbackTrack(true);
        if (!ok) {
          console.error('🚨 HandleSkip (no rotation): All recovery failed — resuming active deck');
          audioEngineRef.current?.resume();
        }
      } catch (err) {
        console.error('🚨 HandleSkip (no rotation): Unexpected error:', err);
        try { audioEngineRef.current?.resume(); } catch(e) {}
      }
      return;
    }
    
    if (playingInterstitialRef.current) {
      playingInterstitialRef.current = false;
      interstitialIndexRef.current = 0;
      console.log('⏭️ HandleSkip: Skipping break song, advancing to next dancer');
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
    
    const dancerTracks = songs[rot[idx]];
    if (!dancerTracks || dancerTracks.length === 0) {
      console.warn('⚠️ HandleSkip: no tracks for', dancer.name, ', falling back');
      transitionInProgressRef.current = false;
      await playFallbackTrack(false);
      return;
    }
    
    const dancerSongCountSkip = dancerTracks.length;

    try {
      if (songNum < dancerSongCountSkip) {
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
          console.warn('⚠️ HandleSkip: nextTrack undefined at index', songNum, ', trying fresh track');
          const freshTracks = await getDancerTracks(dancer);
          if (freshTracks[0]?.url) {
            nextTrack = freshTracks[0];
          } else {
            await playFallbackTrack(false);
            if (announcementsEnabled) audioEngineRef.current?.unduck();
            transitionInProgressRef.current = false;
            return;
          }
        }
        
        if (announcementsEnabled) {
          const announcementPromise = prefetchAnnouncement('round2', dancer.name, null, newSongNum);
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
        const newRotation = [...rot];
        const [finishedDancerId] = newRotation.splice(idx, 1);
        newRotation.push(finishedDancerId);
        
        const newIdx = 0;
        const nextDancer = dnc.find(d => d.id === newRotation[newIdx]);
        
        if (!nextDancer) {
          console.warn('⚠️ HandleSkip: next dancer not found, falling back');
          await playFallbackTrack(false);
          transitionInProgressRef.current = false;
          return;
        }

        const clearedSongs = { ...rotationSongsRef.current };
        delete clearedSongs[finishedDancerId];
        rotationSongsRef.current = clearedSongs;

        const hasManualPlaylist = nextDancer.playlist && nextDancer.playlist.length > 0;
        const skipCount = songsPerSetRef.current;
        const cachedTracks = rotationSongsRef.current[newRotation[newIdx]];
        const skipCooldowns = songCooldownRef.current || {};
        const skipNow = Date.now();
        const cachedAllOffCooldown = cachedTracks?.every(t => {
          const lp = skipCooldowns[t.name] || 0;
          return !lp || (skipNow - lp) >= COOLDOWN_MS;
        });
        let freshTracks = (hasManualPlaylist && cachedTracks?.length >= skipCount && cachedAllOffCooldown)
          ? cachedTracks
          : await getDancerTracks(nextDancer);
        let nextTrack = freshTracks?.[0];
        
        const updatedSongs = { ...rotationSongsRef.current, [newRotation[newIdx]]: freshTracks };
        setRotationSongs(updatedSongs);
        rotationSongsRef.current = updatedSongs;
        
        if (announcementsEnabled) {
          const announcementPromise = prefetchAnnouncement('transition', dancer.name, nextDancer.name, 1);
          audioEngineRef.current?.duck();
          const [, announcementUrl] = await Promise.all([waitForDuck(), announcementPromise]);
          await playPrefetchedAnnouncement(announcementUrl);
          if (nextTrack && nextTrack.url) {
            console.log('🎵 HandleSkip: Switching to next dancer after announcement:', nextDancer.name, 'track:', nextTrack.name);
            const trackOk = await playTrack(nextTrack.url, false, nextTrack.name, nextTrack.genre);
            if (!trackOk) await playFallbackTrack(false);
          } else {
            await playFallbackTrack(false);
          }
          audioEngineRef.current?.unduck();
        } else {
          if (nextTrack && nextTrack.url) {
            await playTrack(nextTrack.url, true, nextTrack.name, nextTrack.genre);
          } else {
            await playFallbackTrack(true);
          }
        }
        
        setRotation(newRotation);
        rotationRef.current = newRotation;
        currentDancerIndexRef.current = newIdx;
        currentSongNumberRef.current = 1;
        setCurrentDancerIndex(newIdx);
        setCurrentSongNumber(1);
        await updateStageState(newIdx, newRotation);
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
  }, [playTrack, playFallbackTrack, playAnnouncement, prefetchAnnouncement, playPrefetchedAnnouncement, updateStageState, tracks, filterCooldown, announcementsEnabled, getDancerTracks]);
  handleSkipRef.current = handleSkip;

  const handleTrackEnd = useCallback(async () => {
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
        const ok = await playFallbackTrack(true);
        if (!ok) {
          console.error('🚨 HandleTrackEnd (no rotation): All recovery failed — resuming active deck');
          audioEngineRef.current?.resume();
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
      const breakKey = `after-${currentDancerId}`;
      const breakSongs = interstitialSongsRef.current[breakKey] || [];
      const breakIdx = interstitialIndexRef.current;

      if (breakIdx < breakSongs.length) {
        const nextBreakName = breakSongs[breakIdx];
        let nextBreakTrack = tracks.find(t => t.name === nextBreakName && t.url);
        interstitialIndexRef.current = breakIdx + 1;
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
          const ok = await playTrack(nextBreakTrack.url, true, nextBreakTrack.name, nextBreakTrack.genre);
          if (!ok) await playFallbackTrack(true);
          transitionInProgressRef.current = false;
          return;
        } else {
          console.error('❌ Could not resolve next break song:', nextBreakName);
        }
      }

      playingInterstitialRef.current = false;
      interstitialIndexRef.current = 0;

      const newRotation = [...rot];
      const [finishedDancerId] = newRotation.splice(idx, 1);
      newRotation.push(finishedDancerId);
      const newIdx = 0;
      const nextDancer = dnc.find(d => d.id === newRotation[newIdx]);

      if (!nextDancer) {
        await playFallbackTrack(true);
        transitionInProgressRef.current = false;
        return;
      }

      try {
        lastAudioActivityRef.current = Date.now();
        const hasManualPlaylist = nextDancer.playlist && nextDancer.playlist.length > 0;
        const endCount = songsPerSetRef.current;
        const endCached = rotationSongsRef.current[newRotation[newIdx]];
        const endCooldowns = songCooldownRef.current || {};
        const endNow = Date.now();
        const endAllOffCooldown = endCached?.every(t => {
          const lp = endCooldowns[t.name] || 0;
          return !lp || (endNow - lp) >= COOLDOWN_MS;
        });
        let freshTracks = (hasManualPlaylist && endCached?.length >= endCount && endAllOffCooldown)
          ? endCached
          : await getDancerTracks(nextDancer);
        let nextTrack = freshTracks?.[0];
        const updatedSongs = { ...rotationSongsRef.current, [newRotation[newIdx]]: freshTracks };
        setRotationSongs(updatedSongs);
        rotationSongsRef.current = updatedSongs;

        if (announcementsEnabled) {
          const announcementPromise = prefetchAnnouncement('intro', nextDancer.name, null, 1);
          audioEngineRef.current?.duck();
          const [, announcementUrl] = await Promise.all([waitForDuck(), announcementPromise]);
          lastAudioActivityRef.current = Date.now();
          const announcementDone = playPrefetchedAnnouncement(announcementUrl);
          await new Promise(r => setTimeout(r, SONG_OVERLAP_DELAY_MS));
          lastAudioActivityRef.current = Date.now();
          if (nextTrack?.url) {
            const trackOk = await playTrack(nextTrack.url, false, nextTrack.name, nextTrack.genre);
            if (!trackOk) await playFallbackTrack(false);
          } else {
            await playFallbackTrack(false);
          }
          lastAudioActivityRef.current = Date.now();
          await announcementDone;
          audioEngineRef.current?.unduck();
        } else {
          if (nextTrack?.url) {
            await playTrack(nextTrack.url, true, nextTrack.name, nextTrack.genre);
          } else {
            await playFallbackTrack(true);
          }
        }
        lastAudioActivityRef.current = Date.now();

        setRotation(newRotation);
        rotationRef.current = newRotation;
        currentDancerIndexRef.current = newIdx;
        currentSongNumberRef.current = 1;
        setCurrentDancerIndex(newIdx);
        setCurrentSongNumber(1);
        await updateStageState(newIdx, newRotation);
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
    
    const dancerTracks = songs[rot[idx]];
    if (!dancerTracks || dancerTracks.length === 0) {
      console.warn('⚠️ HandleTrackEnd: no tracks for', dancer.name, ', falling back');
      transitionInProgressRef.current = false;
      await playFallbackTrack(true);
      return;
    }

    const dancerSongCount = dancerTracks.length;
    
    try {
      if (songNum < dancerSongCount) {
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
          await new Promise(r => setTimeout(r, SONG_OVERLAP_DELAY_MS));
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
        const breakSongs = interstitialSongsRef.current[breakKey] || [];

        if (breakSongs.length > 0) {
          console.log('🎵 HandleTrackEnd: Playing', breakSongs.length, 'break song(s) after', dancer.name, '| Songs:', breakSongs);
          
          const flippedRotation = [...rot];
          const [finishedId] = flippedRotation.splice(idx, 1);
          flippedRotation.push(finishedId);
          setRotation(flippedRotation);
          setCurrentDancerIndex(0);
          setCurrentSongNumber(0);
          const clearedSongs = { ...rotationSongsRef.current };
          delete clearedSongs[finishedId];
          rotationSongsRef.current = clearedSongs;
          updateStageState(0, flippedRotation);

          playingInterstitialRef.current = true;
          interstitialIndexRef.current = 1;
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
            await new Promise(r => setTimeout(r, SONG_OVERLAP_DELAY_MS));
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
        newRotation.push(finishedDancerId);
        
        const newIdx = 0;
        const nextDancer = dnc.find(d => d.id === newRotation[newIdx]);
        
        if (!nextDancer) {
          console.warn('⚠️ HandleTrackEnd: next dancer not found, falling back');
          await playFallbackTrack(true);
          transitionInProgressRef.current = false;
          return;
        }

        const clearedSongs = { ...rotationSongsRef.current };
        delete clearedSongs[finishedDancerId];
        rotationSongsRef.current = clearedSongs;

        const hasManualPlaylist = nextDancer.playlist && nextDancer.playlist.length > 0;
        let freshTracks = (hasManualPlaylist && rotationSongsRef.current[newRotation[newIdx]]?.length > 0)
          ? rotationSongsRef.current[newRotation[newIdx]]
          : await getDancerTracks(nextDancer);
        let nextTrack = freshTracks?.[0];
        
        const updatedSongs = { ...rotationSongsRef.current, [newRotation[newIdx]]: freshTracks };
        setRotationSongs(updatedSongs);
        rotationSongsRef.current = updatedSongs;
        
        if (announcementsEnabled) {
          const announcementPromise = prefetchAnnouncement('transition', dancer.name, nextDancer.name, 1);
          audioEngineRef.current?.duck();
          const [, announcementUrl] = await Promise.all([waitForDuck(), announcementPromise]);
          const announcementDone = playPrefetchedAnnouncement(announcementUrl);
          await new Promise(r => setTimeout(r, SONG_OVERLAP_DELAY_MS));
          if (nextTrack && nextTrack.url) {
            console.log('🎵 HandleTrackEnd: Switching to next dancer during announcement:', nextDancer.name, 'track:', nextTrack.name);
            const trackOk = await playTrack(nextTrack.url, false, nextTrack.name, nextTrack.genre);
            if (!trackOk) await playFallbackTrack(false);
          } else {
            await playFallbackTrack(false);
          }
          await announcementDone;
          audioEngineRef.current?.unduck();
        } else {
          if (nextTrack && nextTrack.url) {
            await playTrack(nextTrack.url, true, nextTrack.name, nextTrack.genre);
          } else {
            await playFallbackTrack(true);
          }
        }
        
        setRotation(newRotation);
        rotationRef.current = newRotation;
        currentDancerIndexRef.current = newIdx;
        currentSongNumberRef.current = 1;
        setCurrentDancerIndex(newIdx);
        setCurrentSongNumber(1);
        await updateStageState(newIdx, newRotation);
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
  }, [playTrack, playFallbackTrack, playAnnouncement, prefetchAnnouncement, playPrefetchedAnnouncement, updateStageState, tracks, filterCooldown, announcementsEnabled, getDancerTracks, beginRotation]);

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
      if (tracks.length === 0) return;
      
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
      watchdogRecoveringRef.current = true;
      transitionInProgressRef.current = true;
      transitionStartTimeRef.current = Date.now();
      
      try {
        let recovered = false;

        try {
          const token = sessionStorage.getItem('djbooth_token');
          const res = await fetch('/api/music/random?count=5', {
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

        if (!recovered) {
          const validTracks = tracks.filter(t => t && t.url);
          const cooldowns = songCooldownRef.current || {};
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
    }
  };

  const stopRotation = useCallback(() => {
    setIsRotationActive(false);
    isRotationActiveRef.current = false;
    setCurrentSongNumber(1);
    currentSongNumberRef.current = 1;
    setRotationSongs({});
    rotationSongsRef.current = {};
    restoredSongsRef.current = false;
    rotationPendingRef.current = false;
    setRotationPending(false);
    playingInterstitialRef.current = false;
    interstitialIndexRef.current = 0;
  }, []);

  const removeFromRotation = (dancerId) => {
    setRotation(rotation.filter(id => id !== dancerId));
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
        const nextTracks = await getDancerTracks(nextDancer);
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
        onOptionsChange={(opts) => {
          setDjOptions(opts);
          djOptionsRef.current = opts;
        }}
        onLogout={async () => {
          const { clearToken } = await import('@/api/serverApi');
          clearToken();
          window.location.href = '/';
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
          />
        </>
      )}

      {/* Header */}
      <header className="border-b border-[#151528] px-4 py-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#00d4ff] flex items-center justify-center">
                <Radio className="w-5 h-5 text-black" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">NEON AI DJ</h1>
                <p className="text-xs text-gray-500">Automated Intelligent Disc Jockey</p>
              </div>
            </div>

            {!remoteMode && (() => {
              const config = getApiConfig();
              const level = getCurrentEnergyLevel({ ...config, energyOverride });
              const info = ENERGY_LEVELS[level];
              return (
                <div className="flex items-center gap-2">
                  <select
                    value={energyOverride}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEnergyOverride(val);
                      saveApiConfig({ energyOverride: val });
                    }}
                    className="h-8 rounded-md bg-[#0d0d1f] border border-[#1e293b] text-xs px-2"
                    style={{ color: info.color }}
                  >
                    <option value="auto">Auto</option>
                    <option value="1">L1</option>
                    <option value="2">L2</option>
                    <option value="3">L3</option>
                    <option value="4">L4</option>
                    <option value="5">L5</option>
                  </select>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border" style={{ borderColor: info.color + '50', backgroundColor: info.color + '10' }}>
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: info.color }} />
                    <span className="text-xs font-medium" style={{ color: info.color }}>{info.name}</span>
                  </div>
                </div>
              );
            })()}

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
                        <p className="text-xs text-gray-300 truncate">
                          {liveBoothState.isPlaying ? '▶' : '⏸'} {liveBoothState.currentDancerName || 'Unknown'} — Song {liveBoothState.currentSongNumber}/{liveBoothState.songsPerSet}
                          {liveBoothState.currentTrack ? ` · ${liveBoothState.currentTrack}` : ''}
                        </p>
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
                    onClick={() => boothApi.sendCommand('toggleAnnouncements')}
                  >
                    {liveBoothState?.announcementsEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-[#0d0d1f] rounded-lg border border-[#1e293b] p-3 min-w-[320px]">
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
                  
                  <div className="flex-1 flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-gray-500" />
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={volume * 100}
                      onChange={(e) => {
                        const vol = parseFloat(e.target.value) / 100;
                        setVolume(vol);
                        audioEngineRef.current?.setVolume(vol);
                      }}
                      className="flex-1 h-1"
                    />
                  </div>
                </div>
                
                <div ref={timeDisplayRef} className="mt-2 text-xs text-gray-500 text-center" style={{ display: 'none' }} />
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {/* Tab Navigation */}
            <div className="flex items-center gap-1 bg-[#0d0d1f] rounded-lg p-1 border border-[#151528]">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab('options')}
                className={`${activeTab === 'options' ? 'bg-[#00d4ff] text-black' : 'text-gray-400 hover:text-white'}`}
              >
                <SlidersHorizontal className="w-4 h-4 mr-1" />
                Options
              </Button>
              <Link to={createPageUrl('Help')}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-400 hover:text-white"
                  title="Help"
                >
                  <HelpCircle className="w-4 h-4 mr-1" />
                  Help
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab('rotation')}
                className={`${activeTab === 'rotation' ? 'bg-[#00d4ff] text-black' : 'text-gray-400 hover:text-white'}`}
              >
                <Layers className="w-4 h-4 mr-1" />
                Rotation
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab('dancers')}
                className={`${activeTab === 'dancers' ? 'bg-[#00d4ff] text-black' : 'text-gray-400 hover:text-white'}`}
              >
                <Users className="w-4 h-4 mr-1" />
                Dancers
              </Button>
              {!remoteMode && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab('library')}
                    className={`${activeTab === 'library' ? 'bg-[#00d4ff] text-black' : 'text-gray-400 hover:text-white'}`}
                  >
                    <Music2 className="w-4 h-4 mr-1" />
                    Library
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab('announcements')}
                    className={`${activeTab === 'announcements' ? 'bg-[#00d4ff] text-black' : 'text-gray-400 hover:text-white'}`}
                  >
                    <Mic className="w-4 h-4 mr-1" />
                    Announcements
                  </Button>
                </>
              )}
            </div>
            
            {!remoteMode && (!elevenLabsKey || !openaiKey) && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                <span className="text-xs text-amber-400">API keys not configured</span>
              </div>
            )}
            {!remoteMode && rotation.length > 0 && (
              rotationPending ? (
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
                <a href={createPageUrl('RotationDisplay')} target="_blank" rel="noopener noreferrer">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-[#1e293b] text-gray-300 hover:bg-[#1e293b] hover:text-white"
                  >
                    <Radio className="w-4 h-4 mr-2" />
                    Open Display
                  </Button>
                </a>
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-gray-400 hover:text-white hover:bg-[#151528]"
                  onClick={() => setSettingsOpen(true)}
                  title="Settings"
                >
                  <Settings className="w-5 h-5" />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-400 hover:text-white hover:bg-[#151528] ml-1"
              onClick={async () => {
                const { clearToken } = await import('@/api/serverApi');
                clearToken();
                window.location.href = '/';
              }}
            >
              <span className="text-xs">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0">
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
                      return (
                        <div key={dancerId} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${isCurrent ? 'bg-[#00d4ff]/10 border-[#00d4ff]/40' : 'bg-[#151528] border-[#1e293b]'}`}>
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-black font-bold text-xs flex-shrink-0" style={{ backgroundColor: dancer.color || '#00d4ff' }}>
                            {dancer.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${isCurrent ? 'text-[#00d4ff]' : 'text-white'}`}>{dancer.name}</p>
                            {dancerSongs.length > 0 && (
                              <p className="text-xs text-gray-500 truncate">{dancerSongs.map(s => typeof s === 'string' ? s : s.name).join(', ')}</p>
                            )}
                          </div>
                          <button
                            onClick={() => boothApi.sendCommand('removeDancerFromRotation', { dancerId })}
                            className="p-1.5 text-red-400/60 hover:text-red-400 transition-colors flex-shrink-0"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                
                <div className="border-t border-[#1e293b] pt-4">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Add to Rotation</h4>
                  <div className="space-y-1">
                    {dancers.filter(d => d.is_active && !(liveBoothState?.rotation || []).includes(d.id)).map(dancer => (
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
                activeRotationSongs={isRotationActive ? rotationSongs : null}
                savedInterstitials={interstitialSongsRef.current}
                onAutoSavePlaylist={async (dancerId, newSongs) => {
                  const dancer = dancers.find(d => d.id === dancerId);
                  const existingPlaylist = dancer?.playlist || [];
                  const merged = [...existingPlaylist];
                  for (const song of newSongs) {
                    if (!merged.includes(song)) merged.push(song);
                  }
                  updateDancerMutation.mutate({ id: dancerId, data: { playlist: merged } });
                  if (isRotationActive && tracks.length > 0) {
                    const resolved = [];
                    for (const name of newSongs) {
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
                onSaveAll={async (newRotation, playlists, interstitials = {}) => {
                  setRotation(newRotation);
                  rotationRef.current = newRotation;
                  interstitialSongsRef.current = interstitials;
                  try { localStorage.setItem('djbooth_interstitial_songs', JSON.stringify(interstitials)); } catch {}
                  Object.entries(playlists).forEach(([dancerId, newSongs]) => {
                    const dancer = dancers.find(d => d.id === dancerId);
                    const existingPlaylist = dancer?.playlist || [];
                    const merged = [...existingPlaylist];
                    for (const song of newSongs) {
                      if (!merged.includes(song)) merged.push(song);
                    }
                    updateDancerMutation.mutate({ 
                      id: dancerId, 
                      data: { playlist: merged } 
                    });
                  });
                  if (tracks.length > 0) {
                    const updatedSongs = { ...(rotationSongsRef.current || {}) };
                    for (const [dancerId, songNames] of Object.entries(playlists)) {
                      const resolved = [];
                      for (const name of songNames) {
                        let track = tracks.find(t => t.name === name);
                        if (!track) {
                          track = await resolveTrackByName(name);
                        }
                        if (track) resolved.push(track);
                      }
                      if (resolved.length > 0) {
                        updatedSongs[dancerId] = resolved;
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
                    const upcoming = [];
                    for (let i = 0; i < lookahead; i++) {
                      const rIdx = i % newRotation.length;
                      const nIdx = (i + 1) % newRotation.length;
                      const dancer = dancers.find(d => d.id === newRotation[rIdx]);
                      const nextDancer = dancers.find(d => d.id === newRotation[nIdx]);
                      if (dancer?.name) {
                        upcoming.push({ name: dancer.name, nextName: nextDancer?.name || null });
                      }
                    }
                    if (upcoming.length > 0) {
                      setTimeout(() => announcementRef.current?.preCacheUpcoming(upcoming), 2000);
                    }
                  }
                  if (activeStage) {
                    await updateStageMutation.mutateAsync({
                      id: activeStage.id,
                      data: {
                        rotation_order: newRotation,
                        current_dancer_index: currentDancerIndex,
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
                onSkipDancer={(dancerId) => {
                  if (!isRotationActive) return;
                  const rot = [...rotationRef.current];
                  if (rot.length <= 1) return;
                  const skipIdx = rot.indexOf(dancerId);
                  if (skipIdx === -1) return;
                  const currentIdx = currentDancerIndexRef.current;
                  if (currentIdx < 0 || currentIdx >= rot.length) return;
                  const currentDancerId = rot[currentIdx];
                  if (dancerId === currentDancerId) {
                    toast('Use the Skip button above to skip the current dancer', { icon: '⏭️' });
                    return;
                  }
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
                  toast(`${dancer?.name || 'Dancer'} moved to end of rotation`, { icon: '⏭️' });
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
                />
              </div>
            )}
            
            {!remoteMode && (
              <div className="h-full bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-4 flex flex-col overflow-hidden" style={{ display: activeTab === 'library' ? 'flex' : 'none' }}>
                <MusicLibrary
                  onTrackSelect={(track) => {
                    if (editingPlaylist) return;
                    if (track.url) playTrack(track.url, true, track.name, track.genre);
                  }}
                />
              </div>
            )}
            
            {!remoteMode && activeTab === 'announcements' && (
              <div className="h-full flex flex-col gap-6">
                <AnnouncementSystem
                  dancers={dancers}
                  rotation={rotation}
                  currentDancerIndex={currentDancerIndex}
                  onPlay={handleAnnouncementPlay}
                  elevenLabsApiKey={elevenLabsKey}
                  openaiApiKey={openaiKey}
                  hideUI={false}
                />
                <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-6 flex-1">
                  <ManualAnnouncementPlayer onPlay={handleAnnouncementPlay} />
                </div>
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

      {/* Settings Modal */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="bg-[#0d0d1f] border-[#1e293b] text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div className="px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
              <div className="flex items-center gap-2">
                <Check className="w-3 h-3 text-green-400" />
                <span className="text-xs text-green-400">
                  Settings save automatically - enter once, never again
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">API Keys</h3>
              
              <div className="space-y-2">
                <Label htmlFor="openai-key">OpenAI API Key</Label>
                <Input
                  id="openai-key"
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-..."
                  className="bg-[#151528] border-[#1e293b]"
                />
                <p className="text-xs text-gray-500">Optional — enables model selection below</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="script-model">Script Generation Model</Label>
                <select
                  id="script-model"
                  value={scriptModel}
                  onChange={(e) => setScriptModel(e.target.value)}
                  className="w-full bg-[#151528] border border-[#1e293b] text-white text-sm rounded-md px-3 py-2"
                >
                  <option value="auto">Auto (Built-in AI)</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-4.1">GPT-4.1</option>
                  <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                </select>
                <p className="text-xs text-gray-500">
                  {scriptModel === 'auto' ? 'Uses built-in AI — no OpenAI key needed' : 'Requires OpenAI API key above'}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="elevenlabs-key">ElevenLabs API Key</Label>
                <Input
                  id="elevenlabs-key"
                  type="password"
                  value={elevenLabsKey}
                  onChange={(e) => setElevenLabsKey(e.target.value)}
                  placeholder="sk_..."
                  className="bg-[#151528] border-[#1e293b]"
                />
                <p className="text-xs text-gray-500">Used for text-to-speech announcements</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="voice-id">ElevenLabs Voice ID (optional)</Label>
                <Input
                  id="voice-id"
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  placeholder="21m00Tcm4TlvDq8ikWAM"
                  className="bg-[#151528] border-[#1e293b]"
                />
                <p className="text-xs text-gray-500">Leave empty for default voice</p>
              </div>
            </div>

            {/* Announcement Settings */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Announcements</h3>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable Voiceover Announcements</Label>
                  <p className="text-xs text-gray-500 mt-1">
                    Automatically announce dancers during rotation
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={announcementsEnabled}
                  onChange={(e) => setAnnouncementsEnabled(e.target.checked)}
                  className="w-10 h-6"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="club-specials">Club Specials</Label>
                <textarea
                  id="club-specials"
                  value={clubSpecials}
                  onChange={(e) => setClubSpecials(e.target.value)}
                  placeholder={"2-for-1 drinks until midnight\nVIP bottle service special\nHalf-price private dances"}
                  rows={3}
                  className="w-full bg-[#151528] border border-[#1e293b] text-white text-sm rounded-md px-3 py-2 resize-none"
                />
                <p className="text-xs text-gray-500">One per line — the DJ will weave these into announcements naturally</p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Import Voiceovers</h3>
              <p className="text-xs text-gray-400">
                Select a folder containing voiceover MP3 files from another device to import them into this system.
              </p>
              <Button
                onClick={handleImportVoiceovers}
                disabled={isImportingVoiceovers}
                className="w-full bg-[#2563eb] hover:bg-[#2563eb]/80 text-white"
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                {isImportingVoiceovers ? 'Importing...' : 'Import Voiceovers Folder'}
              </Button>
              {voImportProgress && (
                <p className="text-xs text-[#00d4ff] text-center animate-pulse">
                  {voImportProgress}
                </p>
              )}
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider">Kiosk Control</h3>
              <Button
                onClick={async () => {
                  if (!confirm('Exit kiosk mode? The browser will close. You can relaunch from the Pi desktop or via SSH.')) return;
                  try {
                    const token = sessionStorage.getItem('djbooth_token');
                    await fetch('/api/kiosk/exit', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {})
                      }
                    });
                  } catch {}
                }}
                variant="outline"
                className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <MonitorOff className="w-4 h-4 mr-2" />
                Exit Kiosk Mode
              </Button>
              <p className="text-xs text-gray-500">
                Closes the fullscreen browser. Relaunch from Pi desktop or via SSH.
              </p>
            </div>

            <div className="flex justify-end pt-4 border-t border-[#1e293b]">
              <Button
                onClick={() => setSettingsOpen(false)}
                className="bg-[#00d4ff] hover:bg-[#00a3cc] text-black"
              >
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}