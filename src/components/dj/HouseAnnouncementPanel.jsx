import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, Trash2, Plus, Loader2, Megaphone, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { getApiConfig } from '@/components/apiConfig';
import { VOICE_SETTINGS } from '@/utils/energyLevels';
import { trackElevenLabsCall } from '@/utils/apiCostTracker';

const LOCKED_LEVEL = 4;

const getAuthHeaders = () => {
  const token = localStorage.getItem('djbooth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const DEFAULT_ANNOUNCEMENTS = [
  { name: 'No Touching', script: 'Hey gentlemen, just a reminder — no touching the entertainers. Keep your hands to yourselves and enjoy the show.' },
  { name: 'No Touching 🇪🇸', script: 'Caballeros, un recordatorio — no toquen a las artistas. Mantengan las manos para ustedes mismos y disfruten del espectáculo.' },
  { name: 'No Photos', script: 'Attention in the club — absolutely no photos or videos of the entertainers. Put your phones away and be present in the moment.' },
  { name: 'No Fotos 🇪🇸', script: 'Atención en el club — absolutamente no se permiten fotos ni videos de las artistas. Guarden sus teléfonos y disfruten el momento.' },
  { name: 'Tip Your Entertainers', script: 'Gentlemen, if you are enjoying the show, show your appreciation — tip your entertainers. They work hard for you every night.' },
  { name: 'Propinas 🇪🇸', script: 'Caballeros, si están disfrutando el show, muestren su apreciación — denle propina a las artistas. Ellas trabajan duro para ustedes cada noche.' },
  { name: 'Welcome', script: 'Welcome to the club gentlemen! We have an incredible lineup of entertainers tonight. Sit back, relax, and enjoy the show.' },
  { name: 'Bienvenidos 🇪🇸', script: 'Bienvenidos al club, caballeros. Tenemos una increíble selección de artistas esta noche. Relájense y disfruten del show.' },
];

export default function HouseAnnouncementPanel({ onPlay, isRemote = false, onRemotePlay }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScript, setNewScript] = useState('');
  const [generating, setGenerating] = useState(false);
  const [playingKey, setPlayingKey] = useState(null);

  const { data: announcements = [] } = useQuery({
    queryKey: ['house-announcements'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/house-announcements', { headers: getAuthHeaders() });
        if (!res.ok) return [];
        return await res.json();
      } catch { return []; }
    },
    refetchInterval: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (cacheKey) => {
      await fetch(`/api/voiceovers/${encodeURIComponent(cacheKey)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['house-announcements'] });
      toast.success('Announcement removed');
    },
  });

  const generateAudio = useCallback(async (script) => {
    const config = getApiConfig();
    const apiKey = config.elevenLabsApiKey || '';
    if (!apiKey) throw new Error('ElevenLabs API key not configured in settings');

    const voiceId = config.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM';
    const voiceSettings = VOICE_SETTINGS[LOCKED_LEVEL] || VOICE_SETTINGS[3];

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text: script,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: voiceSettings.stability,
          similarity_boost: voiceSettings.similarity_boost,
          style: voiceSettings.style,
          speed: voiceSettings.speed,
          use_speaker_boost: voiceSettings.use_speaker_boost !== false,
        },
      }),
    });

    if (!res.ok) {
      let detail = '';
      try { const e = await res.json(); detail = e?.detail?.message || e?.detail || ''; } catch {}
      throw new Error(`ElevenLabs error (${res.status}): ${detail || 'Unknown error'}`);
    }

    trackElevenLabsCall({ text: script, model: 'eleven_multilingual_v2', context: 'house-announcement' });
    return await res.blob();
  }, []);

  const saveAnnouncement = useCallback(async (name, script) => {
    const blob = await generateAudio(script);
    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const cacheKey = `house_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
    const res = await fetch('/api/voiceovers', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cache_key: cacheKey,
        audio_base64: base64,
        script,
        type: 'house',
        dancer_name: name,
        energy_level: LOCKED_LEVEL,
      }),
    });
    if (!res.ok) throw new Error('Failed to save announcement');
    return cacheKey;
  }, [generateAudio]);

  const handleAdd = useCallback(async () => {
    if (!newName.trim() || !newScript.trim()) {
      toast.error('Enter both a name and script');
      return;
    }
    setGenerating(true);
    try {
      await saveAnnouncement(newName.trim(), newScript.trim());
      queryClient.invalidateQueries({ queryKey: ['house-announcements'] });
      toast.success(`"${newName.trim()}" saved`);
      setNewName('');
      setNewScript('');
      setAdding(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  }, [newName, newScript, saveAnnouncement, queryClient]);

  const handleAddDefault = useCallback(async (def) => {
    setGenerating(true);
    try {
      await saveAnnouncement(def.name, def.script);
      queryClient.invalidateQueries({ queryKey: ['house-announcements'] });
      toast.success(`"${def.name}" added`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  }, [saveAnnouncement, queryClient]);

  const handlePlay = useCallback(async (ann) => {
    if (isRemote && onRemotePlay) {
      onRemotePlay(ann.cache_key);
      return;
    }
    if (!onPlay) return;
    setPlayingKey(ann.cache_key);
    try {
      const url = `/api/voiceovers/audio/${encodeURIComponent(ann.cache_key)}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) { toast.error('Failed to load audio'); return; }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      await onPlay(blobUrl, { autoDuck: true });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
    } catch (err) {
      toast.error('Playback failed: ' + err.message);
    } finally {
      setPlayingKey(null);
    }
  }, [isRemote, onRemotePlay, onPlay]);

  const existingNames = new Set(announcements.map(a => a.name));
  const missingDefaults = DEFAULT_ANNOUNCEMENTS.filter(d => !existingNames.has(d.name));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-bold text-amber-400 uppercase tracking-wider">House Announcements</span>
        </div>
        <button
          onClick={() => setAdding(v => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 text-xs font-semibold active:opacity-70"
        >
          {adding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {adding ? 'Cancel' : 'New'}
        </button>
      </div>

      {adding && (
        <div className="bg-[#0d0d1f] rounded-xl border border-amber-500/30 p-3 space-y-2 flex-shrink-0">
          <input
            placeholder="Button name (e.g. Last Call)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/50"
          />
          <textarea
            placeholder="What to say... (recorded by ElevenLabs)"
            value={newScript}
            onChange={e => setNewScript(e.target.value)}
            rows={3}
            className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/50 resize-none"
          />
          <button
            onClick={handleAdd}
            disabled={generating || !newName.trim() || !newScript.trim()}
            className="w-full py-2 rounded-lg bg-amber-500 text-black font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {generating ? 'Recording...' : 'Save & Record'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {announcements.length === 0 && !adding && (
          <div className="text-center py-6 text-gray-600 text-sm">
            <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No house announcements yet.<br />Add the defaults below or create your own.
          </div>
        )}

        {announcements.map(ann => (
          <div key={ann.cache_key} className="flex items-center gap-2">
            <button
              onClick={() => handlePlay(ann)}
              disabled={playingKey === ann.cache_key}
              className="flex-1 flex items-center gap-2.5 px-3 py-3 rounded-xl bg-[#0d0d1f] border border-amber-500/30 text-left active:opacity-70 disabled:opacity-50"
            >
              {playingKey === ann.cache_key
                ? <Loader2 className="w-4 h-4 text-amber-400 animate-spin flex-shrink-0" />
                : <Play className="w-4 h-4 text-amber-400 flex-shrink-0" />
              }
              <span className="text-sm font-semibold text-white truncate">{ann.name}</span>
            </button>
            <button
              onClick={() => deleteMutation.mutate(ann.cache_key)}
              disabled={deleteMutation.isPending}
              className="p-2.5 rounded-xl bg-[#0d0d1f] border border-[#1e293b] text-red-400 active:opacity-70"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        {missingDefaults.length > 0 && (
          <div className="pt-1">
            <div className="text-xs text-gray-600 uppercase tracking-wider mb-2">Quick-add defaults</div>
            {missingDefaults.map(def => (
              <button
                key={def.name}
                onClick={() => handleAddDefault(def)}
                disabled={generating}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[#08081a] border border-dashed border-[#1e293b] text-gray-500 text-sm mb-1.5 active:opacity-70 disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{def.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
