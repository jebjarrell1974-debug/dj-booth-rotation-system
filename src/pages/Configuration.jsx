import React, { useState, useEffect } from 'react';
import { localEntities, localIntegrations } from '@/api/localEntities';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings, Key, Mic, ArrowLeft, Download, Check, Lock, Building2, Clock, Server, FolderOpen, Upload, Music } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { toast } from 'sonner';
import { getApiConfig, saveApiConfig, loadApiConfig } from '@/components/apiConfig';
import { ENERGY_LEVELS, getCurrentEnergyLevel, VOICE_SETTINGS, buildAnnouncementPrompt } from '@/utils/energyLevels';

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i < 12 ? 'AM' : 'PM';
  const h = i === 0 ? 12 : i > 12 ? i - 12 : i;
  return { value: i, label: `${h}:00 ${ampm}` };
});

export default function Configuration() {
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
  const [configReady, setConfigReady] = useState(false);
  const [musicPath, setMusicPath] = useState('');
  const [musicPathSaved, setMusicPathSaved] = useState('');
  const [musicPathSaving, setMusicPathSaving] = useState(false);
  const [musicTrackCount, setMusicTrackCount] = useState(0);
  const [musicLastScan, setMusicLastScan] = useState(null);

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
      setConfigReady(true);
    });
    const token = sessionStorage.getItem('djbooth_token');
    if (token) {
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
    }
  }, []);

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
    });
  }, [elevenLabsKey, elevenLabsVoiceId, openaiKey, announcementsEnabled, clubName, clubOpenHour, clubCloseHour, configReady]);

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
      toast.error('No dancers in rotation to cache');
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

          const prompt = buildAnnouncementPrompt(type, dancer.name, next, level, round, cfg.clubName);
          const rawResponse = await localIntegrations.Core.InvokeLLM({ prompt });
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

  return (
    <div className="h-screen bg-[#08081a] text-white overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 pb-16">
        <div className="mb-8">
          <Link to={createPageUrl('DJBooth')}>
            <Button variant="ghost" className="mb-4 text-gray-400 hover:text-white">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to DJ Booth
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#e040fb] to-[#7c3aed] flex items-center justify-center">
              <Settings className="w-6 h-6 text-black" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Configuration</h1>
              <p className="text-sm text-gray-500">System settings and API keys</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e1e3a] p-6">
            <div className="flex items-center gap-3 mb-4">
              <Building2 className="w-5 h-5 text-[#e040fb]" />
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
                  className="bg-[#08081a] border-[#1e1e3a]"
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
                    className="w-full h-10 rounded-md bg-[#08081a] border border-[#1e1e3a] text-white px-3 text-sm"
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
                    className="w-full h-10 rounded-md bg-[#08081a] border border-[#1e1e3a] text-white px-3 text-sm"
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
                  Energy level auto-adjusts based on time of day and your club hours. Override available in the DJ Booth.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e1e3a] p-6">
            <div className="flex items-center gap-3 mb-4">
              <Music className="w-5 h-5 text-[#e040fb]" />
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
                    className="bg-[#08081a] border-[#1e1e3a] flex-1 font-mono text-sm"
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
                    className="bg-[#e040fb] hover:bg-[#c026d3] text-black"
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    {musicPathSaving ? 'Scanning...' : 'Set & Scan'}
                  </Button>
                </div>
              </div>

              {musicPathSaved && (
                <div className="px-3 py-2.5 rounded-lg bg-[#08081a] border border-[#1e1e3a]">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Current path:</span>
                    <span className="text-sm font-mono text-[#e040fb] truncate ml-2">{musicPathSaved}</span>
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

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e1e3a] p-6">
            <div className="flex items-center gap-3 mb-4">
              <Mic className="w-5 h-5 text-[#e040fb]" />
              <h2 className="text-lg font-semibold">Voice Announcements</h2>
            </div>

            {voStats.total > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-[#08081a] border border-[#1e1e3a]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">Voiceover Library</span>
                  <span className="text-lg font-bold text-[#e040fb]">{voStats.total}</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  {voStats.total} voiceover{voStats.total !== 1 ? 's' : ''} for {voStats.dancerCount} dancer{voStats.dancerCount !== 1 ? 's' : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(voStats.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                    <span key={type} className="text-xs px-2 py-0.5 rounded-full bg-[#1e1e3a] text-gray-300">
                      {type}: {count}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {voStats.total === 0 && (
              <div className="mb-4 p-3 rounded-lg bg-[#08081a] border border-[#1e1e3a]">
                <p className="text-sm text-gray-400">No voiceovers yet. Generate them by running a rotation or use the pre-cache button below.</p>
              </div>
            )}
            
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-white">Enable Automatic Announcements</p>
                <p className="text-xs text-gray-500 mt-1">
                  Play AI-generated voice announcements during dancer rotations
                </p>
              </div>
              <Switch
                checked={announcementsEnabled}
                onCheckedChange={setAnnouncementsEnabled}
              />
            </div>

            <div className="border-t border-[#1e1e3a] pt-4 mt-2">
              <p className="text-sm text-gray-400 mb-3">
                Import voiceover MP3 files from another device. Select the folder containing the voiceover files and they'll be linked to this system.
              </p>
              <Button
                onClick={handleImportVoiceovers}
                disabled={isImportingVoiceovers}
                className="w-full bg-[#7c3aed] hover:bg-[#7c3aed]/80 text-white"
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                {isImportingVoiceovers ? 'Importing...' : 'Import Voiceovers Folder'}
              </Button>
              {importProgress && (
                <p className="text-xs text-[#e040fb] text-center mt-2 animate-pulse">
                  {importProgress}
                </p>
              )}
            </div>
          </div>

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e1e3a] p-6">
            <div className="flex items-center gap-3 mb-4">
              <Key className="w-5 h-5 text-[#e040fb]" />
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
                  className="bg-[#08081a] border-[#1e1e3a]"
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
                  className="bg-[#08081a] border-[#1e1e3a]"
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
                  className="bg-[#08081a] border-[#1e1e3a]"
                />
                <p className="text-xs text-gray-500">Leave blank to use built-in AI for script generation</p>
              </div>
            </div>
          </div>

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e1e3a] p-6">
            <div className="flex items-center gap-3 mb-4">
              <Lock className="w-5 h-5 text-[#e040fb]" />
              <h2 className="text-lg font-semibold">PIN Management</h2>
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-white mb-1">DJ Login PIN</p>
                <p className="text-xs text-gray-500 mb-3">
                  The PIN used to log into the DJ Booth on this device.
                </p>
                <div className="flex gap-3">
                  <Input
                    value={djPin}
                    onChange={(e) => setDjPin(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="Enter new 5-digit PIN..."
                    className="bg-[#08081a] border-[#1e1e3a] flex-1"
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
                    className="bg-[#e040fb] hover:bg-[#c026d3] text-black"
                  >
                    {pinSaving ? 'Saving...' : 'Update'}
                  </Button>
                </div>
              </div>

              <div className="border-t border-[#1e1e3a] pt-5">
                <p className="text-sm font-medium text-white mb-1">Master PIN</p>
                <p className="text-xs text-gray-500 mb-1">
                  A backup admin PIN that always works to log in, even if the DJ PIN is lost. Set a unique one for each venue.
                </p>
                {masterPinCurrent && (
                  <p className="text-xs text-gray-500 mb-3">
                    Current: <span className="text-[#e040fb] font-mono">{masterPinCurrent}</span>
                  </p>
                )}
                <div className="flex gap-3">
                  <Input
                    value={masterPin}
                    onChange={(e) => setMasterPin(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="Enter new 5-digit master PIN..."
                    className="bg-[#08081a] border-[#1e1e3a] flex-1"
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
                    className="bg-[#7c3aed] hover:bg-[#7c3aed]/80 text-white"
                  >
                    {masterPinSaving ? 'Saving...' : 'Update'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e1e3a] p-6">
            <h3 className="text-sm font-semibold text-[#e040fb] uppercase tracking-wider mb-3">
              Pre-Cache Announcements
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Generate and cache all announcements for dancers in rotation. Already cached announcements will be skipped.
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
                {rotation.length} dancers in rotation ready to cache
              </p>
            )}
          </div>
        </div>

        <div className="bg-[#0d0d1f] border border-[#1e1e3a] rounded-xl p-5">
          <h3 className="text-white text-md font-semibold mb-2 flex items-center gap-2">
            <Server className="w-4 h-4 text-[#e040fb]" />
            Fleet Management
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Manage deployed Pi units, monitor health, share voiceovers across venues, and push updates.
          </p>
          <Link to="/FleetDashboard">
            <Button className="w-full bg-[#7c3aed] hover:bg-[#7c3aed]/80 text-white">
              <Server className="w-4 h-4 mr-2" />
              Open Fleet Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
