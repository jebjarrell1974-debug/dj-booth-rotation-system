import React, { useState, useEffect, useCallback } from 'react';
import { localEntities, localIntegrations } from '@/api/localEntities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings, Key, Mic, ArrowLeft, Download, Check, Lock, Building2, Clock, Server, FolderOpen, Upload, Music, Wifi, RefreshCw, Plus, X, Zap, Cloud, CloudUpload, CloudDownload, Ban, RotateCcw, Trash2, MonitorOff, BarChart3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { trackOpenAICall, trackElevenLabsCall, estimateTokens } from '@/utils/apiCostTracker';
import { toast } from 'sonner';
import { getApiConfig, saveApiConfig, loadApiConfig } from '@/components/apiConfig';
import { ENERGY_LEVELS, getCurrentEnergyLevel, VOICE_SETTINGS, buildAnnouncementPrompt } from '@/utils/energyLevels';

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i < 12 ? 'AM' : 'PM';
  const h = i === 0 ? 12 : i > 12 ? i - 12 : i;
  return { value: i, label: `${h}:00 ${ampm}` };
});

export default function Configuration() {
  const queryClient = useQueryClient();
  const [masterPinInput, setMasterPinInput] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [unlockError, setUnlockError] = useState('');

  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState('21m00Tcm4TlvDq8ikWAM');
  const [openaiKey, setOpenaiKey] = useState('');
  const [announcementsEnabled, setAnnouncementsEnabled] = useState(true);
  const [saved, setSaved] = useState(false);
  const [isCaching, setIsCaching] = useState(false);
  const [isImportingVoiceovers, setIsImportingVoiceovers] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [djPin, setDjPin] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [masterPin, setMasterPin] = useState('');
  const [masterPinCurrent, setMasterPinCurrent] = useState('');
  const [masterPinSaving, setMasterPinSaving] = useState(false);
  const [clubName, setClubName] = useState('');
  const [clubOpenHour, setClubOpenHour] = useState(11);
  const [clubCloseHour, setClubCloseHour] = useState(2);
  const [scriptModel, setScriptModel] = useState('auto');
  const [configReady, setConfigReady] = useState(false);
  const [serverIps, setServerIps] = useState([]);
  const [musicPath, setMusicPath] = useState('');
  const [musicPathSaved, setMusicPathSaved] = useState('');
  const [musicPathSaving, setMusicPathSaving] = useState(false);
  const [musicTrackCount, setMusicTrackCount] = useState(0);
  const [musicLastScan, setMusicLastScan] = useState(null);
  const [fleetIps, setFleetIps] = useState(() => {
    try { return JSON.parse(localStorage.getItem('djbooth_fleet_ips') || '[]'); } catch { return []; }
  });
  const [newFleetIp, setNewFleetIp] = useState('');
  const [fleetStatus, setFleetStatus] = useState({});
  const [fleetUpdating, setFleetUpdating] = useState(false);
  const [r2Status, setR2Status] = useState(null);
  const [r2Loading, setR2Loading] = useState(false);
  const [r2Syncing, setR2Syncing] = useState({ voUp: false, voDown: false, muUp: false, muDown: false });
  const [blockedTracks, setBlockedTracks] = useState([]);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [apiCosts, setApiCosts] = useState(null);
  const [apiCostsLoading, setApiCostsLoading] = useState(false);
  const [apiCostPeriod, setApiCostPeriod] = useState('30');
  const [apiDeviceId, setApiDeviceId] = useState('');

  const config = getApiConfig();
  const currentLevel = getCurrentEnergyLevel({ clubOpenHour, clubCloseHour, energyOverride: config.energyOverride });
  const levelInfo = ENERGY_LEVELS[currentLevel];

  useEffect(() => {
    loadApiConfig().then(cfg => {
      setElevenLabsKey(cfg.elevenLabsApiKey);
      setElevenLabsVoiceId(cfg.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM');
      setOpenaiKey(cfg.openaiApiKey);
      setAnnouncementsEnabled(cfg.announcementsEnabled);
      setClubName(cfg.clubName || '');
      setClubOpenHour(cfg.clubOpenHour);
      setClubCloseHour(cfg.clubCloseHour);
      setScriptModel(cfg.scriptModel || 'auto');
      setConfigReady(true);
    });
  }, []);

  useEffect(() => {
    if (!isUnlocked) return;
    const token = sessionStorage.getItem('djbooth_token');
    if (!token) return;
    fetch('/api/settings/master-pin', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.ok ? r.json() : null).then(data => {
      if (data) setMasterPinCurrent(data.pin);
    }).catch(() => {});

    fetch('/api/settings/music-path', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.ok ? r.json() : null).then(data => {
      if (data) {
        setMusicPath(data.path || '');
        setMusicPathSaved(data.path || '');
        setMusicTrackCount(data.totalTracks || 0);
        setMusicLastScan(data.lastScan || null);
      }
    }).catch(() => {});

    fetch('/api/music/blocked', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.ok ? r.json() : null).then(data => {
      if (data?.tracks) setBlockedTracks(data.tracks);
    }).catch(() => {});

    fetch('/api/server-info')
      .then(r => r.json())
      .then(data => setServerIps(data.ips || []))
      .catch(() => {});

    fetch('/api/usage/device-id')
      .then(r => r.json())
      .then(data => setApiDeviceId(data.deviceId || ''))
      .catch(() => {});
  }, [isUnlocked]);

  const loadApiCosts = useCallback(async () => {
    setApiCostsLoading(true);
    try {
      const days = parseInt(apiCostPeriod) || 30;
      const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
      const token = sessionStorage.getItem('djbooth_token');
      const res = await fetch(`/api/usage/summary?startDate=${startDate}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setApiCosts(data);
      }
    } catch {} finally {
      setApiCostsLoading(false);
    }
  }, [apiCostPeriod]);

  useEffect(() => {
    if (isUnlocked) loadApiCosts();
  }, [isUnlocked, loadApiCosts]);

  useEffect(() => {
    if (!configReady) return;
    saveApiConfig({
      elevenLabsApiKey: elevenLabsKey,
      elevenLabsVoiceId: elevenLabsVoiceId,
      openaiApiKey: openaiKey,
      announcementsEnabled,
      clubName,
      clubOpenHour,
      clubCloseHour,
      scriptModel,
    });
  }, [elevenLabsKey, elevenLabsVoiceId, openaiKey, announcementsEnabled, clubName, clubOpenHour, clubCloseHour, scriptModel, configReady]);

  const { data: dancers = [] } = useQuery({
    queryKey: ['dancers'],
    queryFn: async () => {
      const res = await fetch('/api/dancers', {
        headers: (() => {
          const h = {};
          const token = sessionStorage.getItem('djbooth_token');
          if (token) h['Authorization'] = `Bearer ${token}`;
          return h;
        })()
      });
      if (!res.ok) return [];
      return res.json();
    }
  });

  const { data: stages = [] } = useQuery({
    queryKey: ['stages'],
    queryFn: () => localEntities.Stage.list()
  });

  const activeStage = stages.find(s => s.is_active);
  const rotation = activeStage?.rotation_order || [];

  const { data: voiceovers = [] } = useQuery({
    queryKey: ['voiceovers-stats'],
    queryFn: async () => {
      const token = sessionStorage.getItem('djbooth_token');
      const res = await fetch('/api/voiceovers', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30000,
  });

  const voStats = (() => {
    const total = voiceovers.length;
    const uniqueDancers = new Set(voiceovers.map(v => v.dancer_name).filter(Boolean));
    const byType = {};
    voiceovers.forEach(v => { byType[v.type] = (byType[v.type] || 0) + 1; });
    return { total, dancerCount: uniqueDancers.size, byType };
  })();

  const handlePreCache = async () => {
    if (!elevenLabsKey) {
      toast.error('Please configure ElevenLabs API key first');
      return;
    }

    if (rotation.length === 0) {
      toast.error('No entertainers in rotation to cache');
      return;
    }

    setIsCaching(true);
    const cfg = getApiConfig();
    const level = getCurrentEnergyLevel(cfg);
    toast.info(`Pre-caching announcements at Energy Level ${level}...`);

    try {
      const rotationDancers = rotation.map(id => dancers.find(d => d.id === id)).filter(Boolean);
      let cached = 0;
      let skipped = 0;
      const authHeaders = (() => {
        const h = {};
        const token = sessionStorage.getItem('djbooth_token');
        if (token) h['Authorization'] = `Bearer ${token}`;
        return h;
      })();

      for (let i = 0; i < rotationDancers.length; i++) {
        const dancer = rotationDancers[i];
        const nextDancer = rotationDancers[(i + 1) % rotationDancers.length];

        const types = [
          { type: 'intro', next: null, round: 1 },
          { type: 'round2', next: null, round: 2 },
          { type: 'outro', next: null, round: 1 },
          { type: 'transition', next: nextDancer.name, round: 1 },
        ];

        for (const { type, next, round } of types) {
          const cacheKey = `${type}-${dancer.name}${next ? `-${next}` : ''}-L${level}`;

          try {
            const checkRes = await fetch(`/api/voiceovers/check/${encodeURIComponent(cacheKey)}`, { headers: authHeaders });
            if (checkRes.ok) {
              const { exists } = await checkRes.json();
              if (exists) {
                skipped++;
                continue;
              }
            }
          } catch {}

          const specials = (cfg.clubSpecials || '').split('\n').map(s => s.trim()).filter(Boolean);
          const prompt = buildAnnouncementPrompt(type, dancer.name, next, level, round, cfg.clubName, specials);

          let rawResponse;
          if (cfg.scriptModel && cfg.scriptModel !== 'auto' && cfg.openaiApiKey) {
            const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.openaiApiKey}` },
              body: JSON.stringify({
                model: cfg.scriptModel,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.9,
                frequency_penalty: 0.6,
                presence_penalty: 0.4,
                max_tokens: 200,
              }),
            });
            const oaiData = await oaiRes.json();
            const oaiUsage = oaiData.usage;
            trackOpenAICall({
              model: cfg.scriptModel,
              promptTokens: oaiUsage?.prompt_tokens || estimateTokens(prompt),
              completionTokens: oaiUsage?.completion_tokens || estimateTokens(oaiData.choices?.[0]?.message?.content || ''),
              context: `precache-${type}-${dancer.name}`,
            });
            rawResponse = oaiData.choices?.[0]?.message?.content || '';
          } else {
            rawResponse = await localIntegrations.Core.InvokeLLM({ prompt });
          }
          let script = '';
          if (typeof rawResponse === 'string') {
            script = rawResponse.replace(/^\d+[\.\)]\s*/gm, '').replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
          } else if (rawResponse && typeof rawResponse === 'object') {
            const txt = rawResponse.script ?? rawResponse.text ?? rawResponse.content ?? '';
            script = typeof txt === 'string' ? txt.replace(/\n+/g, ' ').trim() : String(txt);
          } else {
            script = String(rawResponse ?? 'Welcome to the stage.');
          }
          const voiceSettings = VOICE_SETTINGS[level] || VOICE_SETTINGS[3];

          const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + elevenLabsVoiceId, {
            method: 'POST',
            headers: {
              'xi-api-key': elevenLabsKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              text: script,
              model_id: 'eleven_monolingual_v1',
              voice_settings: {
                stability: voiceSettings.stability,
                similarity_boost: voiceSettings.similarity_boost,
                style: voiceSettings.style,
                speed: voiceSettings.speed,
              }
            })
          });

          if (!response.ok) throw new Error('Audio generation failed');
          trackElevenLabsCall({ text: script, model: 'eleven_monolingual_v1', context: `precache-${type}-${dancer.name}` });
          const audioBlob = await response.blob();
          
          const reader = new FileReader();
          const audio_base64 = await new Promise((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(audioBlob);
          });

          await fetch('/api/voiceovers', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cache_key: cacheKey,
              audio_base64,
              script,
              type,
              dancer_name: dancer.name,
              energy_level: level
            })
          });

          cached++;
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }

      toast.success(`Pre-cached ${cached} announcements (${skipped} already cached) at L${level}`);
    } catch (error) {
      console.error('Pre-cache error:', error);
      toast.error('Failed to pre-cache announcements');
    } finally {
      setIsCaching(false);
    }
  };

  const handleImportVoiceovers = async () => {
    if (!window.showDirectoryPicker) {
      toast.error('Folder picker not supported in this browser — use Chromium/Chrome');
      return;
    }
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      setIsImportingVoiceovers(true);
      setImportProgress('Scanning folder...');

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
        setImportProgress('');
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
        setImportProgress(`Importing ${imported + 1}/${toImport.length}: ${cacheKey}`);

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
            body: JSON.stringify({
              cache_key: cacheKey,
              audio_base64,
              script: '',
              type,
              dancer_name,
              energy_level
            })
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
      setImportProgress('');
    }
  };

  const handleUnlock = async () => {
    if (masterPinInput.length !== 5) {
      setUnlockError('Enter a 5-digit PIN');
      return;
    }
    setUnlockError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'dj', pin: masterPinInput }),
      });
      if (!res.ok) {
        setUnlockError('Incorrect PIN');
        return;
      }
      const data = await res.json();
      const token = data.token;
      const masterRes = await fetch('/api/settings/master-pin', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (masterRes.ok) {
        const masterData = await masterRes.json();
        if (masterPinInput === masterData.pin) {
          sessionStorage.setItem('djbooth_token', token);
          setIsUnlocked(true);
          return;
        }
      }
      setUnlockError('Master PIN required — DJ PIN not accepted');
    } catch {
      setUnlockError('Connection failed');
    }
  };

  if (!isUnlocked) {
    return (
      <div className="h-screen bg-[#08081a] text-white flex items-center justify-center">
        <div className="max-w-sm w-full mx-4">
          <Link to={createPageUrl('DJBooth')}>
            <Button variant="ghost" className="mb-6 text-gray-400 hover:text-white">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to NEON DJ
            </Button>
          </Link>
          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-8">
            <div className="flex items-center gap-3 mb-6 justify-center">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#00d4ff] to-[#2563eb] flex items-center justify-center">
                <Lock className="w-6 h-6 text-black" />
              </div>
            </div>
            <h2 className="text-xl font-bold text-center mb-2">Configuration Locked</h2>
            <p className="text-sm text-gray-400 text-center mb-6">Enter the master PIN to access system settings</p>
            <Input
              value={masterPinInput}
              onChange={(e) => { setMasterPinInput(e.target.value.replace(/\D/g, '').slice(0, 5)); setUnlockError(''); }}
              placeholder="Enter master PIN..."
              className="bg-[#08081a] border-[#1e293b] text-center text-lg tracking-widest mb-3"
              inputMode="numeric"
              type="password"
              onKeyDown={(e) => { if (e.key === 'Enter') handleUnlock(); }}
            />
            {unlockError && (
              <p className="text-sm text-red-400 text-center mb-3">{unlockError}</p>
            )}
            <Button
              onClick={handleUnlock}
              disabled={masterPinInput.length !== 5}
              className="w-full bg-[#00d4ff] hover:bg-[#00a3cc] text-black"
            >
              Unlock Configuration
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#08081a] text-white overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 pb-16">
        <div className="mb-8">
          <Link to={createPageUrl('DJBooth')}>
            <Button variant="ghost" className="mb-4 text-gray-400 hover:text-white">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to NEON DJ
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#00d4ff] to-[#2563eb] flex items-center justify-center">
              <Settings className="w-6 h-6 text-black" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Configuration</h1>
              <p className="text-sm text-gray-500">System settings and API keys</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-6">
            <div className="flex items-center gap-3 mb-4">
              <Building2 className="w-5 h-5 text-[#00d4ff]" />
              <h2 className="text-lg font-semibold">Club Information</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="clubName" className="text-gray-400">Club Name</Label>
                <Input
                  id="clubName"
                  value={clubName}
                  onChange={(e) => setClubName(e.target.value)}
                  placeholder="Enter your club name"
                  className="bg-[#08081a] border-[#1e293b]"
                />
                <p className="text-xs text-gray-500">Used in DJ announcements — leave blank to omit</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="openHour" className="text-gray-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Open Time
                  </Label>
                  <select
                    id="openHour"
                    value={clubOpenHour}
                    onChange={(e) => setClubOpenHour(parseInt(e.target.value, 10))}
                    className="w-full h-10 rounded-md bg-[#08081a] border border-[#1e293b] text-white px-3 text-sm"
                  >
                    {HOUR_OPTIONS.map(h => (
                      <option key={h.value} value={h.value}>{h.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="closeHour" className="text-gray-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Close Time
                  </Label>
                  <select
                    id="closeHour"
                    value={clubCloseHour}
                    onChange={(e) => setClubCloseHour(parseInt(e.target.value, 10))}
                    className="w-full h-10 rounded-md bg-[#08081a] border border-[#1e293b] text-white px-3 text-sm"
                  >
                    {HOUR_OPTIONS.map(h => (
                      <option key={h.value} value={h.value}>{h.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="px-3 py-2.5 rounded-lg border" style={{ borderColor: levelInfo.color + '60', backgroundColor: levelInfo.color + '10' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: levelInfo.color }} />
                    <span className="text-sm font-medium" style={{ color: levelInfo.color }}>
                      Current Energy: Level {currentLevel}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">{levelInfo.name}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Energy level auto-adjusts based on time of day and your club hours. Override available in the NEON DJ panel.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-6">
            <div className="flex items-center gap-3 mb-4">
              <Music className="w-5 h-5 text-[#00d4ff]" />
              <h2 className="text-lg font-semibold">Music Library</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="musicPath" className="text-gray-400">Music Folder Path</Label>
                <p className="text-xs text-gray-500">
                  Full path to the folder containing your music files on this machine (e.g. /mnt/music or /home/pi/Desktop/NEONAIDJ MUSIC)
                </p>
                <div className="flex gap-3">
                  <Input
                    id="musicPath"
                    value={musicPath}
                    onChange={(e) => setMusicPath(e.target.value)}
                    placeholder="/path/to/music/folder"
                    className="bg-[#08081a] border-[#1e293b] flex-1 font-mono text-sm"
                  />
                  <Button
                    onClick={async () => {
                      if (!musicPath.trim()) { toast.error('Enter a folder path'); return; }
                      setMusicPathSaving(true);
                      try {
                        const token = sessionStorage.getItem('djbooth_token');
                        const res = await fetch('/api/settings/music-path', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                          body: JSON.stringify({ path: musicPath.trim() }),
                        });
                        const data = await res.json();
                        if (!res.ok) { toast.error(data.error || 'Failed to set music path'); return; }
                        toast.success(`Music folder set — ${data.total} tracks indexed`);
                        setMusicPathSaved(musicPath.trim());
                        setMusicTrackCount(data.total || 0);
                        setMusicLastScan(new Date().toISOString());
                      } catch (err) {
                        toast.error('Failed to set music path');
                      } finally {
                        setMusicPathSaving(false);
                      }
                    }}
                    disabled={musicPathSaving || !musicPath.trim()}
                    className="bg-[#00d4ff] hover:bg-[#00a3cc] text-black"
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    {musicPathSaving ? 'Scanning...' : 'Set & Scan'}
                  </Button>
                </div>
              </div>

              {musicPathSaved && (
                <div className="px-3 py-2.5 rounded-lg bg-[#08081a] border border-[#1e293b]">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Current path:</span>
                    <span className="text-sm font-mono text-[#00d4ff] truncate ml-2">{musicPathSaved}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-500">{musicTrackCount.toLocaleString()} tracks indexed</span>
                    {musicLastScan && (
                      <span className="text-xs text-gray-500">Last scan: {new Date(musicLastScan).toLocaleTimeString()}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-6">
            <div className="flex items-center gap-3 mb-4">
              <Ban className="w-5 h-5 text-red-400" />
              <h2 className="text-lg font-semibold">Deactivated Songs</h2>
              <span className="text-sm text-gray-500 ml-auto">{blockedTracks.length} song{blockedTracks.length !== 1 ? 's' : ''}</span>
            </div>

            {blockedTracks.length === 0 ? (
              <p className="text-sm text-gray-500">No deactivated songs. Use the Deactivate button in the DJ booth to block the currently playing song.</p>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {blockedTracks.map((track) => (
                  <div key={track.name} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#08081a] border border-[#1e293b] group">
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-sm text-white truncate">{track.name}</p>
                      <p className="text-xs text-gray-500">
                        {track.genre && <span className="mr-3">{track.genre}</span>}
                        {track.blocked_at && <span>Blocked {new Date(track.blocked_at).toLocaleDateString()}</span>}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-green-500/50 text-green-400 hover:bg-green-500/20 hover:text-green-300 shrink-0"
                      disabled={blockedLoading}
                      onClick={async () => {
                        setBlockedLoading(true);
                        try {
                          const token = sessionStorage.getItem('djbooth_token');
                          const res = await fetch('/api/music/unblock', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({ trackName: track.name })
                          });
                          if (res.ok) {
                            setBlockedTracks(prev => prev.filter(t => t.name !== track.name));
                            toast.success(`Reactivated: ${track.name}`);
                          } else {
                            toast.error('Failed to reactivate');
                          }
                        } catch {
                          toast.error('Failed to reactivate');
                        } finally {
                          setBlockedLoading(false);
                        }
                      }}
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Reactivate
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-6">
            <div className="flex items-center gap-3 mb-4">
              <Mic className="w-5 h-5 text-[#00d4ff]" />
              <h2 className="text-lg font-semibold">Voice Announcements</h2>
            </div>

            {voStats.total > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-[#08081a] border border-[#1e293b]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">Voiceover Library</span>
                  <span className="text-lg font-bold text-[#00d4ff]">{voStats.total}</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  {voStats.total} voiceover{voStats.total !== 1 ? 's' : ''} for {voStats.dancerCount} dancer{voStats.dancerCount !== 1 ? 's' : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(voStats.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                    <span key={type} className="text-xs px-2 py-0.5 rounded-full bg-[#1e293b] text-gray-300">
                      {type}: {count}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {voStats.total === 0 && (
              <div className="mb-4 p-3 rounded-lg bg-[#08081a] border border-[#1e293b]">
                <p className="text-sm text-gray-400">No voiceovers yet. Generate them by running a rotation or use the pre-cache button below.</p>
              </div>
            )}

            {voStats.total > 0 && (
              <div className="mb-4">
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (!window.confirm(`Delete all ${voStats.total} voiceovers? They will be regenerated fresh with the current voice engine.`)) return;
                    try {
                      const token = sessionStorage.getItem('djbooth_token');
                      const res = await fetch('/api/voiceovers', {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` }
                      });
                      const data = await res.json();
                      if (data.ok) {
                        toast.success(`Cleared ${data.deleted} voiceovers`);
                        queryClient.invalidateQueries({ queryKey: ['voiceovers-stats'] });
                      }
                    } catch (err) {
                      toast.error('Failed to clear voiceovers');
                    }
                  }}
                  className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Clear All Voiceovers ({voStats.total})
                </Button>
                <p className="text-[10px] text-gray-600 mt-1 text-center">Removes all cached voiceovers. They'll regenerate with the current voice engine.</p>
              </div>
            )}
            
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-white">Enable Automatic Announcements</p>
                <p className="text-xs text-gray-500 mt-1">
                  Play AI-generated voice announcements during entertainer rotations
                </p>
              </div>
              <Switch
                checked={announcementsEnabled}
                onCheckedChange={setAnnouncementsEnabled}
              />
            </div>

            <div className="border-t border-[#1e293b] pt-4 mt-2">
              <p className="text-sm text-gray-400 mb-3">
                Import voiceover MP3 files from another device. Select the folder containing the voiceover files and they'll be linked to this system.
              </p>
              <Button
                onClick={handleImportVoiceovers}
                disabled={isImportingVoiceovers}
                className="w-full bg-[#2563eb] hover:bg-[#2563eb]/80 text-white"
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                {isImportingVoiceovers ? 'Importing...' : 'Import Voiceovers Folder'}
              </Button>
              {importProgress && (
                <p className="text-xs text-[#00d4ff] text-center mt-2 animate-pulse">
                  {importProgress}
                </p>
              )}
            </div>
          </div>

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-6">
            <div className="flex items-center gap-3 mb-4">
              <Key className="w-5 h-5 text-[#00d4ff]" />
              <h2 className="text-lg font-semibold">API Configuration</h2>
            </div>

            <div className="mb-3 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
              <div className="flex items-center gap-2">
                <Check className="w-3 h-3 text-green-400" />
                <span className="text-xs text-green-400">
                  Settings save automatically - no need to press a button
                </span>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="elevenlabs" className="text-gray-400">ElevenLabs API Key</Label>
                <Input
                  id="elevenlabs"
                  type="password"
                  value={elevenLabsKey}
                  onChange={(e) => setElevenLabsKey(e.target.value)}
                  placeholder="Enter your ElevenLabs API key"
                  className="bg-[#08081a] border-[#1e293b]"
                />
                <p className="text-xs text-gray-500">Required for voice synthesis announcements</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="voiceid" className="text-gray-400">ElevenLabs Voice ID</Label>
                <Input
                  id="voiceid"
                  value={elevenLabsVoiceId}
                  onChange={(e) => setElevenLabsVoiceId(e.target.value)}
                  placeholder="21m00Tcm4TlvDq8ikWAM"
                  className="bg-[#08081a] border-[#1e293b]"
                />
                <p className="text-xs text-gray-500">Find voice IDs in your ElevenLabs dashboard</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="openai" className="text-gray-400">OpenAI API Key (Optional)</Label>
                <Input
                  id="openai"
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="Enter your OpenAI API key"
                  className="bg-[#08081a] border-[#1e293b]"
                />
                <p className="text-xs text-gray-500">Optional — enables model selection below</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="script-model" className="text-gray-400">Script Generation Model</Label>
                <select
                  id="script-model"
                  value={scriptModel}
                  onChange={(e) => setScriptModel(e.target.value)}
                  className="w-full bg-[#08081a] border border-[#1e293b] text-white text-sm rounded-md px-3 py-2"
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

            </div>
          </div>

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-6">
            <div className="flex items-center gap-3 mb-4">
              <Lock className="w-5 h-5 text-[#00d4ff]" />
              <h2 className="text-lg font-semibold">PIN Management</h2>
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-white mb-1">DJ Login PIN</p>
                <p className="text-xs text-gray-500 mb-3">
                  The PIN used to log into NEON AI DJ on this device.
                </p>
                <div className="flex gap-3">
                  <Input
                    value={djPin}
                    onChange={(e) => setDjPin(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="Enter new 5-digit PIN..."
                    className="bg-[#08081a] border-[#1e293b] flex-1"
                    inputMode="numeric"
                    type="password"
                  />
                  <Button
                    onClick={async () => {
                      if (djPin.length !== 5) { toast.error('PIN must be exactly 5 digits'); return; }
                      setPinSaving(true);
                      try {
                        const token = sessionStorage.getItem('djbooth_token');
                        const res = await fetch('/api/settings/dj-pin', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                          body: JSON.stringify({ pin: djPin }),
                        });
                        if (!res.ok) throw new Error('Failed');
                        toast.success('DJ PIN updated');
                        setDjPin('');
                      } catch (err) {
                        toast.error('Failed to update PIN');
                      } finally {
                        setPinSaving(false);
                      }
                    }}
                    disabled={pinSaving || djPin.length !== 5}
                    className="bg-[#00d4ff] hover:bg-[#00a3cc] text-black"
                  >
                    {pinSaving ? 'Saving...' : 'Update'}
                  </Button>
                </div>
              </div>

              <div className="border-t border-[#1e293b] pt-5">
                <p className="text-sm font-medium text-white mb-1">Master PIN</p>
                <p className="text-xs text-gray-500 mb-1">
                  A backup admin PIN that always works to log in, even if the DJ PIN is lost. Set a unique one for each venue.
                </p>
                {masterPinCurrent && (
                  <p className="text-xs text-gray-500 mb-3">
                    Current: <span className="text-[#00d4ff] font-mono">{masterPinCurrent}</span>
                  </p>
                )}
                <div className="flex gap-3">
                  <Input
                    value={masterPin}
                    onChange={(e) => setMasterPin(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="Enter new 5-digit master PIN..."
                    className="bg-[#08081a] border-[#1e293b] flex-1"
                    inputMode="numeric"
                    type="password"
                  />
                  <Button
                    onClick={async () => {
                      if (masterPin.length !== 5) { toast.error('PIN must be exactly 5 digits'); return; }
                      setMasterPinSaving(true);
                      try {
                        const token = sessionStorage.getItem('djbooth_token');
                        const res = await fetch('/api/settings/master-pin', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                          body: JSON.stringify({ pin: masterPin }),
                        });
                        if (!res.ok) throw new Error('Failed');
                        toast.success('Master PIN updated');
                        setMasterPinCurrent(masterPin);
                        setMasterPin('');
                      } catch (err) {
                        toast.error('Failed to update Master PIN');
                      } finally {
                        setMasterPinSaving(false);
                      }
                    }}
                    disabled={masterPinSaving || masterPin.length !== 5}
                    className="bg-[#2563eb] hover:bg-[#2563eb]/80 text-white"
                  >
                    {masterPinSaving ? 'Saving...' : 'Update'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-6">
            <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider mb-3">
              Pre-Cache Announcements
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Generate and cache all announcements for entertainers in rotation. Already cached announcements will be skipped.
            </p>
            <Button 
              onClick={handlePreCache} 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              disabled={isCaching || !elevenLabsKey || rotation.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              {isCaching ? 'Pre-caching...' : 'Pre-Cache Announcements'}
            </Button>
            {rotation.length > 0 && (
              <p className="text-xs text-gray-500 text-center mt-2">
                {rotation.length} entertainers in rotation ready to cache
              </p>
            )}
          </div>
        </div>

        <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Wifi className="w-5 h-5 text-[#00d4ff]" />
            <h2 className="text-lg font-semibold">Remote Update</h2>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            Add your Pi kiosk IPs (local or Tailscale) to check versions and push updates from your phone.
          </p>

          <div className="flex gap-2 mb-4">
            <Input
              value={newFleetIp}
              onChange={(e) => setNewFleetIp(e.target.value)}
              placeholder="192.168.1.98 or 100.x.x.x"
              className="bg-[#08081a] border-[#1e293b] flex-1 font-mono text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFleetIp.trim()) {
                  const ip = newFleetIp.trim();
                  if (!fleetIps.includes(ip)) {
                    const updated = [...fleetIps, ip];
                    setFleetIps(updated);
                    localStorage.setItem('djbooth_fleet_ips', JSON.stringify(updated));
                  }
                  setNewFleetIp('');
                }
              }}
            />
            <Button
              onClick={() => {
                const ip = newFleetIp.trim();
                if (ip && !fleetIps.includes(ip)) {
                  const updated = [...fleetIps, ip];
                  setFleetIps(updated);
                  localStorage.setItem('djbooth_fleet_ips', JSON.stringify(updated));
                }
                setNewFleetIp('');
              }}
              disabled={!newFleetIp.trim()}
              className="bg-[#00d4ff] hover:bg-[#00a3cc] text-black"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {fleetIps.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-4">No Pi units added yet. Enter an IP above.</p>
          )}

          {fleetIps.length > 0 && (
            <div className="space-y-2 mb-4">
              {fleetIps.map((ip) => {
                const status = fleetStatus[ip];
                return (
                  <div key={ip} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#08081a] border border-[#1e293b]">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      status?.state === 'online' ? 'bg-green-400' :
                      status?.state === 'updating' ? 'bg-yellow-400 animate-pulse' :
                      status?.state === 'updated' ? 'bg-[#00d4ff]' :
                      status?.state === 'error' ? 'bg-red-400' :
                      'bg-gray-600'
                    }`} />
                    <span className="font-mono text-sm text-white flex-1">{ip}</span>
                    {status?.version && (
                      <span className="text-xs text-gray-400 font-mono">{status.version} ({status.commit})</span>
                    )}
                    {status?.state === 'updating' && (
                      <span className="text-xs text-yellow-400 animate-pulse">Updating...</span>
                    )}
                    {status?.state === 'updated' && (
                      <span className="text-xs text-[#00d4ff]">Update sent</span>
                    )}
                    {status?.state === 'error' && (
                      <span className="text-xs text-red-400 truncate max-w-[120px]">{status.error}</span>
                    )}
                    <button
                      onClick={() => {
                        const updated = fleetIps.filter(i => i !== ip);
                        setFleetIps(updated);
                        localStorage.setItem('djbooth_fleet_ips', JSON.stringify(updated));
                        setFleetStatus(prev => { const n = {...prev}; delete n[ip]; return n; });
                      }}
                      className="text-gray-600 hover:text-red-400 p-1 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {fleetIps.length > 0 && (
            <div className="flex gap-3">
              <Button
                onClick={async () => {
                  for (const ip of fleetIps) {
                    setFleetStatus(prev => ({ ...prev, [ip]: { state: 'checking' } }));
                    try {
                      const controller = new AbortController();
                      const timeout = setTimeout(() => controller.abort(), 5000);
                      const res = await fetch(`http://${ip}:3001/api/version`, { signal: controller.signal });
                      clearTimeout(timeout);
                      const data = await res.json();
                      setFleetStatus(prev => ({ ...prev, [ip]: { state: 'online', version: data.version, commit: data.commit } }));
                    } catch (err) {
                      setFleetStatus(prev => ({ ...prev, [ip]: { state: 'error', error: 'Offline' } }));
                    }
                  }
                }}
                className="flex-1 bg-[#1e293b] hover:bg-[#1e293b]/80 text-white"
                disabled={fleetUpdating}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Check All
              </Button>
              <Button
                onClick={async () => {
                  const pin = prompt('Enter your DJ PIN to authorize the update:');
                  if (!pin || pin.length !== 5) {
                    toast.error('5-digit PIN required');
                    return;
                  }
                  setFleetUpdating(true);
                  let successCount = 0;
                  let failCount = 0;
                  for (const ip of fleetIps) {
                    setFleetStatus(prev => ({ ...prev, [ip]: { ...prev[ip], state: 'updating' } }));
                    try {
                      const controller = new AbortController();
                      const timeout = setTimeout(() => controller.abort(), 10000);
                      const res = await fetch(`http://${ip}:3001/api/system/update`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pin }),
                        signal: controller.signal,
                      });
                      clearTimeout(timeout);
                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        throw new Error(data.error || `HTTP ${res.status}`);
                      }
                      setFleetStatus(prev => ({ ...prev, [ip]: { ...prev[ip], state: 'updated' } }));
                      successCount++;
                    } catch (err) {
                      setFleetStatus(prev => ({ ...prev, [ip]: { ...prev[ip], state: 'error', error: err.message } }));
                      failCount++;
                    }
                  }
                  setFleetUpdating(false);
                  if (successCount > 0) toast.success(`Update triggered on ${successCount} unit${successCount !== 1 ? 's' : ''}`);
                  if (failCount > 0) toast.error(`${failCount} unit${failCount !== 1 ? 's' : ''} failed`);
                }}
                className="flex-1 bg-[#00d4ff] hover:bg-[#00a3cc] text-black"
                disabled={fleetUpdating}
              >
                <Zap className="w-4 h-4 mr-2" />
                {fleetUpdating ? 'Updating...' : 'Update All'}
              </Button>
            </div>
          )}
        </div>

        <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Cloud className="w-5 h-5 text-violet-400" />
            <h2 className="text-lg font-semibold">Cloud Sync (R2)</h2>
            {r2Status && r2Status.configured && !r2Status.error && (
              <span className="ml-auto text-xs text-green-400">Connected</span>
            )}
          </div>
          <p className="text-sm text-gray-400 mb-4">
            Sync voiceovers and music across all Pi units via Cloudflare R2 cloud storage.
          </p>

          <div className="mb-4">
            <Button
              onClick={async () => {
                setR2Loading(true);
                try {
                  const token = sessionStorage.getItem('djbooth_token');
                  const res = await fetch('/api/r2/status', { headers: { Authorization: `Bearer ${token}` } });
                  const data = await res.json();
                  setR2Status(data);
                  if (!data.configured) toast.error('R2 not configured — add R2 env vars to the server');
                  else if (data.error) toast.error(`R2 error: ${data.error}`);
                } catch (err) {
                  toast.error('Failed to check R2 status');
                }
                setR2Loading(false);
              }}
              className="w-full bg-[#1e293b] hover:bg-[#1e293b]/80 text-white"
              disabled={r2Loading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${r2Loading ? 'animate-spin' : ''}`} />
              {r2Loading ? 'Checking...' : 'Check Cloud Status'}
            </Button>
          </div>

          {r2Status && r2Status.configured && !r2Status.error && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-[#08081a] rounded-lg p-3 border border-[#1e293b]">
                  <p className="text-2xl font-bold text-violet-400">{r2Status.voiceovers?.count || 0}</p>
                  <p className="text-xs text-gray-500">Voiceovers ({r2Status.voiceovers?.sizeMB || 0} MB)</p>
                </div>
                <div className="bg-[#08081a] rounded-lg p-3 border border-[#1e293b]">
                  <p className="text-2xl font-bold text-[#00d4ff]">{r2Status.music?.count || 0}</p>
                  <p className="text-xs text-gray-500">Music ({r2Status.music?.sizeMB >= 1024 ? `${(r2Status.music.sizeMB / 1024).toFixed(1)} GB` : `${r2Status.music?.sizeMB || 0} MB`})</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Voiceovers</p>
                <div className="flex gap-2">
                  <Button
                    onClick={async () => {
                      setR2Syncing(s => ({ ...s, voUp: true }));
                      try {
                        const token = sessionStorage.getItem('djbooth_token');
                        const res = await fetch('/api/r2/sync/voiceovers', {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ direction: 'upload' }),
                        });
                        const data = await res.json();
                        if (data.ok) toast.success(`Uploaded ${data.uploaded} voiceovers (${data.skipped} already in cloud)`);
                        else toast.error(data.error);
                      } catch { toast.error('Upload failed'); }
                      setR2Syncing(s => ({ ...s, voUp: false }));
                    }}
                    className="flex-1 bg-violet-600 hover:bg-violet-500 text-white"
                    disabled={r2Syncing.voUp}
                  >
                    <CloudUpload className={`w-4 h-4 mr-2 ${r2Syncing.voUp ? 'animate-pulse' : ''}`} />
                    {r2Syncing.voUp ? 'Uploading...' : 'Upload to Cloud'}
                  </Button>
                  <Button
                    onClick={async () => {
                      setR2Syncing(s => ({ ...s, voDown: true }));
                      try {
                        const token = sessionStorage.getItem('djbooth_token');
                        const res = await fetch('/api/r2/sync/voiceovers', {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ direction: 'download' }),
                        });
                        const data = await res.json();
                        if (data.ok) toast.success(`Downloaded ${data.downloaded} voiceovers (${data.skipped} already local)`);
                        else toast.error(data.error);
                      } catch { toast.error('Download failed'); }
                      setR2Syncing(s => ({ ...s, voDown: false }));
                    }}
                    className="flex-1 bg-[#1e293b] hover:bg-[#1e293b]/80 text-white"
                    disabled={r2Syncing.voDown}
                  >
                    <CloudDownload className={`w-4 h-4 mr-2 ${r2Syncing.voDown ? 'animate-pulse' : ''}`} />
                    {r2Syncing.voDown ? 'Downloading...' : 'Download from Cloud'}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Music</p>
                <div className="flex gap-2">
                  <Button
                    onClick={async () => {
                      setR2Syncing(s => ({ ...s, muUp: true }));
                      toast.info('Uploading music — this may take a while for large libraries...');
                      try {
                        const token = sessionStorage.getItem('djbooth_token');
                        const res = await fetch('/api/r2/sync/music', {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ direction: 'upload' }),
                        });
                        const data = await res.json();
                        if (data.ok) toast.success(`Uploaded ${data.uploaded} tracks (${data.skipped} already in cloud)`);
                        else toast.error(data.error);
                      } catch { toast.error('Upload failed'); }
                      setR2Syncing(s => ({ ...s, muUp: false }));
                    }}
                    className="flex-1 bg-[#00d4ff] hover:bg-[#00a3cc] text-black"
                    disabled={r2Syncing.muUp}
                  >
                    <CloudUpload className={`w-4 h-4 mr-2 ${r2Syncing.muUp ? 'animate-pulse' : ''}`} />
                    {r2Syncing.muUp ? 'Uploading...' : 'Upload to Cloud'}
                  </Button>
                  <Button
                    onClick={async () => {
                      setR2Syncing(s => ({ ...s, muDown: true }));
                      toast.info('Downloading music — this may take a while for large libraries...');
                      try {
                        const token = sessionStorage.getItem('djbooth_token');
                        const res = await fetch('/api/r2/sync/music', {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ direction: 'download' }),
                        });
                        const data = await res.json();
                        if (data.ok) toast.success(`Downloaded ${data.downloaded} tracks (${data.skipped} already local)`);
                        else toast.error(data.error);
                      } catch { toast.error('Download failed'); }
                      setR2Syncing(s => ({ ...s, muDown: false }));
                    }}
                    className="flex-1 bg-[#1e293b] hover:bg-[#1e293b]/80 text-white"
                    disabled={r2Syncing.muDown}
                  >
                    <CloudDownload className={`w-4 h-4 mr-2 ${r2Syncing.muDown ? 'animate-pulse' : ''}`} />
                    {r2Syncing.muDown ? 'Downloading...' : 'Download from Cloud'}
                  </Button>
                </div>
              </div>

              <p className="text-xs text-gray-600 text-center">
                Sync also runs automatically on every Pi boot
              </p>
            </div>
          )}

          {r2Status && !r2Status.configured && (
            <p className="text-sm text-red-400 text-center py-3">
              R2 is not configured. Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME to the server environment variables.
            </p>
          )}

          {r2Status && r2Status.error && (
            <p className="text-sm text-red-400 text-center py-3">
              R2 error: {r2Status.error}
            </p>
          )}
        </div>

        {serverIps.length > 0 && (
          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Wifi className="w-4 h-4 text-[#2563eb]" />
              <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Remote Connection</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">Enter this IP on the iPad to connect as DJ Remote</p>
            {serverIps.map((ip, i) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 bg-[#151528] rounded-lg mb-2 last:mb-0">
                <span className="text-xs text-gray-400">{ip.interface}</span>
                <span className="text-lg font-mono font-bold text-white">{ip.address}</span>
              </div>
            ))}
          </div>
        )}

        <div className="bg-[#0d0d1f] rounded-xl border border-red-500/20 p-5">
          <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3">Kiosk Control</h3>
          <button
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
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors text-sm font-medium"
          >
            <MonitorOff className="w-4 h-4" />
            Exit Kiosk Mode
          </button>
          <p className="text-xs text-gray-500 mt-2">Closes the fullscreen browser. Relaunch from Pi desktop or via SSH.</p>
        </div>

        <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white text-md font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#00d4ff]" />
              API Costs
            </h3>
            <div className="flex items-center gap-2">
              <select
                value={apiCostPeriod}
                onChange={(e) => setApiCostPeriod(e.target.value)}
                className="bg-[#08081a] border border-[#1e293b] rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-[#00d4ff]"
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last year</option>
              </select>
              <button
                onClick={loadApiCosts}
                disabled={apiCostsLoading}
                className="text-gray-400 hover:text-[#00d4ff] transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${apiCostsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
          {apiDeviceId && (
            <p className="text-xs text-gray-500 mb-3 font-mono">Unit: {apiDeviceId}</p>
          )}
          {apiCosts ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-[#08081a] rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-[#00d4ff]">
                    ${(apiCosts.totals?.total_cost || 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-500">Total Cost</div>
                </div>
                <div className="bg-[#08081a] rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-[#a855f7]">
                    {(apiCosts.totals?.total_calls || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">API Calls</div>
                </div>
                <div className="bg-[#08081a] rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-[#22c55e]">
                    {((apiCosts.totals?.total_characters || 0) / 1000).toFixed(1)}k
                  </div>
                  <div className="text-xs text-gray-500">TTS Chars</div>
                </div>
              </div>

              {apiCosts.byDevice?.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Breakdown by Service</div>
                  {apiCosts.byDevice.map((row, i) => (
                    <div key={i} className="flex items-center justify-between bg-[#08081a] rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${row.service === 'elevenlabs' ? 'bg-[#a855f7]' : 'bg-[#00d4ff]'}`} />
                        <span className="text-sm text-gray-300 capitalize">{row.service}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-medium text-white">${(row.total_cost || 0).toFixed(4)}</span>
                        <span className="text-xs text-gray-500 ml-2">({row.call_count} calls)</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {apiCosts.byDay?.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Recent Daily Costs</div>
                  {apiCosts.byDay.slice(0, 7).map((row, i) => (
                    <div key={i} className="flex items-center justify-between px-2 py-1">
                      <span className="text-xs text-gray-400 font-mono">{row.day}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${row.service === 'elevenlabs' ? 'text-[#a855f7]' : 'text-[#00d4ff]'}`}>
                          {row.service}
                        </span>
                        <span className="text-xs text-white font-medium">${(row.total_cost || 0).toFixed(4)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(!apiCosts.byDevice || apiCosts.byDevice.length === 0) && (
                <p className="text-xs text-gray-500 text-center py-3">No API usage recorded yet. Costs will appear as announcements and promos are generated.</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500 text-center py-3">
              {apiCostsLoading ? 'Loading cost data...' : 'No cost data available'}
            </p>
          )}
        </div>

        <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl p-5">
          <h3 className="text-white text-md font-semibold mb-2 flex items-center gap-2">
            <Server className="w-4 h-4 text-[#00d4ff]" />
            Fleet Management
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Manage deployed Pi units, monitor health, share voiceovers across venues, and push updates.
          </p>
          <Link to="/FleetDashboard">
            <Button className="w-full bg-[#2563eb] hover:bg-[#2563eb]/80 text-white">
              <Server className="w-4 h-4 mr-2" />
              Open Fleet Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
