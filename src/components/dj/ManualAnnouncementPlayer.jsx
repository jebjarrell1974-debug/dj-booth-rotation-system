import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Play, Trash2, Mic, Radio, Sparkles, Music, ChevronDown, Download } from 'lucide-react';
import { toast } from 'sonner';
import { getApiConfig } from '@/components/apiConfig';
import { generatePromoScript, VIBE_STYLES } from '@/utils/promoGenerator';
import { mixPromo } from '@/utils/audioMixer';
import { trackElevenLabsCall } from '@/utils/apiCostTracker';

const getAuthHeaders = () => {
  const token = sessionStorage.getItem('djbooth_token');
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const blobToBase64 = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const PROMO_BED_GENRE = 'Promo Beds';

function PromoCreator({ onPlay, onSaved }) {
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [venue, setVenue] = useState('');
  const [details, setDetails] = useState('');
  const [vibe, setVibe] = useState('party');
  const [duration, setDuration] = useState('30');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(null);
  const [generatedScript, setGeneratedScript] = useState('');
  const [editingScript, setEditingScript] = useState(false);
  const [promoBeds, setPromoBeds] = useState([]);
  const [selectedBed, setSelectedBed] = useState('random');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewBlob, setPreviewBlob] = useState(null);

  useEffect(() => {
    const config = getApiConfig();
    if (config.clubName && !venue) {
      setVenue(config.clubName);
    }
  }, []);

  useEffect(() => {
    async function fetchBeds() {
      try {
        const res = await fetch(`/api/music/tracks?genre=${encodeURIComponent(PROMO_BED_GENRE)}&limit=200`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          setPromoBeds(data.tracks || []);
        }
      } catch {}
    }
    fetchBeds();
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const generateVoiceover = async (script) => {
    const config = getApiConfig();
    const apiKey = config.elevenLabsApiKey;
    if (!apiKey) throw new Error('ElevenLabs API key not configured');
    const voiceId = config.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM';

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text: script,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.40,
          similarity_boost: 0.75,
          style: 0.30,
          speed: 0.92,
          use_speaker_boost: true,
        }
      }),
    });

    if (!res.ok) {
      const status = res.status;
      if (status === 401) throw new Error('Invalid ElevenLabs API key');
      if (status === 429) throw new Error('ElevenLabs rate limit — wait a moment');
      throw new Error(`ElevenLabs error (${status})`);
    }

    trackElevenLabsCall({ text: script, model: 'eleven_multilingual_v2', context: 'promo-tts' });
    return await res.blob();
  };

  const fetchMusicBed = async () => {
    let track;
    if (selectedBed === 'random') {
      if (promoBeds.length === 0) throw new Error('No tracks found in "Promo Beds" folder. Add instrumental tracks to a folder called "Promo Beds" in your music library.');
      track = promoBeds[Math.floor(Math.random() * promoBeds.length)];
    } else {
      track = promoBeds.find(t => String(t.id) === String(selectedBed));
      if (!track) throw new Error('Selected promo bed not found');
    }

    const res = await fetch(`/api/music/stream/${track.id}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to load music bed');
    return await res.blob();
  };

  const handleGenerate = async () => {
    if (!eventName.trim()) { toast.error('Enter an event name'); return; }
    if (!eventDate.trim()) { toast.error('Enter a date'); return; }
    if (!venue.trim()) { toast.error('Enter a venue name'); return; }

    const config = getApiConfig();
    if (!config.elevenLabsApiKey) {
      toast.error('ElevenLabs API key required — configure in Settings');
      return;
    }

    setGenerating(true);
    setPreviewUrl(null);
    setPreviewBlob(null);
    setGeneratedScript('');

    try {
      setProgress({ step: 1, text: 'Writing script...' });
      const script = await generatePromoScript({
        eventName: eventName.trim(),
        date: eventDate.trim(),
        time: eventTime.trim(),
        venue: venue.trim(),
        details: details.trim(),
        vibe,
        duration,
      });
      setGeneratedScript(script);

      setProgress({ step: 2, text: 'Generating voiceover...' });
      const voiceBlob = await generateVoiceover(script);

      setProgress({ step: 3, text: 'Loading music bed...' });
      const musicBlob = await fetchMusicBed();

      setProgress({ step: 4, text: 'Mixing promo...' });
      const mixedBlob = await mixPromo(voiceBlob, musicBlob);

      const url = URL.createObjectURL(mixedBlob);
      setPreviewUrl(url);
      setPreviewBlob(mixedBlob);
      setProgress({ step: 5, text: 'Done!' });
      toast.success('Promo created! Preview it below.');

    } catch (error) {
      console.error('Promo generation error:', error);
      toast.error(error.message || 'Failed to generate promo');
      setProgress(null);
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    if (!generatedScript) return;
    setGenerating(true);
    setPreviewUrl(null);
    setPreviewBlob(null);

    try {
      const scriptToUse = generatedScript;

      setProgress({ step: 2, text: 'Generating voiceover...' });
      const voiceBlob = await generateVoiceover(scriptToUse);

      setProgress({ step: 3, text: 'Loading music bed...' });
      const musicBlob = await fetchMusicBed();

      setProgress({ step: 4, text: 'Mixing promo...' });
      const mixedBlob = await mixPromo(voiceBlob, musicBlob);

      const url = URL.createObjectURL(mixedBlob);
      setPreviewUrl(url);
      setPreviewBlob(mixedBlob);
      setProgress({ step: 5, text: 'Done!' });
      toast.success('Promo remixed!');
    } catch (error) {
      console.error('Remix error:', error);
      toast.error(error.message || 'Failed to remix');
      setProgress(null);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!previewBlob) return;
    try {
      const name = `${eventName} - ${venue} - ${eventDate}`;
      const cacheKey = `promo-${Date.now()}-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const audio_base64 = await blobToBase64(previewBlob);

      const res = await fetch('/api/voiceovers', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cache_key: cacheKey,
          audio_base64,
          script: generatedScript,
          type: 'promo',
          dancer_name: name,
          energy_level: 0
        })
      });

      if (!res.ok) throw new Error('Save failed');
      toast.success('Promo saved to library!');
      if (onSaved) onSaved();

      setEventName('');
      setEventDate('');
      setEventTime('');
      setDetails('');
      setGeneratedScript('');
      setPreviewUrl(null);
      setPreviewBlob(null);
      setProgress(null);
    } catch (error) {
      toast.error('Failed to save promo');
    }
  };

  const handlePreviewPlay = () => {
    if (previewUrl && onPlay) {
      onPlay(previewUrl);
    }
  };

  const handleDownload = () => {
    if (!previewBlob) return;
    const url = URL.createObjectURL(previewBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${eventName || 'promo'}-${venue || 'venue'}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const progressSteps = [
    { num: 1, label: 'Script' },
    { num: 2, label: 'Voice' },
    { num: 3, label: 'Music' },
    { num: 4, label: 'Mix' },
    { num: 5, label: 'Done' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-gray-500 mb-1 block">Event Name</label>
          <Input
            placeholder="Ladies Night, Fight Night, etc."
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            className="bg-[#08081a] border-[#1e293b]"
            disabled={generating}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Date</label>
          <Input
            placeholder="Friday March 15th"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="bg-[#08081a] border-[#1e293b]"
            disabled={generating}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Time</label>
          <Input
            placeholder="Doors at 9pm"
            value={eventTime}
            onChange={(e) => setEventTime(e.target.value)}
            className="bg-[#08081a] border-[#1e293b]"
            disabled={generating}
          />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 mb-1 block">Venue</label>
          <Input
            placeholder="Club name"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            className="bg-[#08081a] border-[#1e293b]"
            disabled={generating}
          />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 mb-1 block">Details (specials, dress code, etc.)</label>
          <textarea
            placeholder="$5 cocktails all night, no cover before 10pm, DJ spinning the hottest hits..."
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00d4ff]/50 min-h-[60px] resize-none"
            disabled={generating}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">Vibe</label>
          <div className="flex gap-1.5">
            {Object.entries(VIBE_STYLES).map(([key, val]) => (
              <button
                key={key}
                onClick={() => setVibe(key)}
                disabled={generating}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  vibe === key
                    ? 'bg-[#00d4ff] text-black'
                    : 'bg-[#08081a] text-gray-400 border border-[#1e293b] hover:text-white'
                }`}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="w-32">
          <label className="text-xs text-gray-500 mb-1 block">Length</label>
          <div className="flex gap-1.5">
            {['15', '30', '60'].map(d => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                disabled={generating}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  duration === d
                    ? 'bg-[#2563eb] text-white'
                    : 'bg-[#08081a] text-gray-400 border border-[#1e293b] hover:text-white'
                }`}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1 block">Music Bed</label>
        <select
          value={selectedBed}
          onChange={(e) => setSelectedBed(e.target.value)}
          disabled={generating}
          className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white appearance-none cursor-pointer focus:outline-none focus:border-[#00d4ff]"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: '30px' }}
        >
          <option value="random">Random from Promo Beds ({promoBeds.length} available)</option>
          {promoBeds.map(track => (
            <option key={track.id} value={track.id}>{track.name}</option>
          ))}
        </select>
        {promoBeds.length === 0 && (
          <p className="text-[10px] text-amber-400 mt-1">
            No tracks in "Promo Beds" folder. Add instrumental music to a folder called "Promo Beds" in your music library.
          </p>
        )}
      </div>

      {progress && (
        <div className="bg-[#08081a] rounded-lg border border-[#1e293b] p-3">
          <div className="flex items-center gap-2 mb-2">
            {progressSteps.map(s => (
              <div key={s.num} className="flex-1">
                <div className={`h-1.5 rounded-full transition-colors ${
                  progress.step > s.num ? 'bg-[#00d4ff]'
                  : progress.step === s.num ? (s.num === 5 ? 'bg-green-500' : 'bg-[#00d4ff] animate-pulse')
                  : 'bg-[#1e293b]'
                }`} />
                <p className={`text-[10px] mt-1 text-center ${
                  progress.step >= s.num ? 'text-[#00d4ff]' : 'text-gray-600'
                }`}>{s.label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 text-center">{progress.text}</p>
        </div>
      )}

      {generatedScript && !generating && (
        <div className="bg-[#08081a] rounded-lg border border-[#1e293b] p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Script</span>
            <button
              onClick={() => setEditingScript(!editingScript)}
              className="text-[10px] text-[#00d4ff] hover:underline"
            >
              {editingScript ? 'Done' : 'Edit'}
            </button>
          </div>
          {editingScript ? (
            <textarea
              value={generatedScript}
              onChange={(e) => setGeneratedScript(e.target.value)}
              className="w-full bg-[#0d0d1f] border border-[#1e293b] rounded px-2 py-1.5 text-xs text-gray-300 min-h-[80px] resize-none focus:outline-none focus:border-[#00d4ff]/50"
            />
          ) : (
            <p className="text-xs text-gray-400 leading-relaxed">{generatedScript}</p>
          )}
        </div>
      )}

      {previewUrl && !generating && (
        <div className="bg-[#08081a] rounded-lg border border-green-500/30 p-3">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handlePreviewPlay} className="bg-green-600 hover:bg-green-700 text-white">
              <Play className="w-4 h-4 mr-1" /> Preview
            </Button>
            <Button size="sm" onClick={handleRegenerate} variant="outline" className="border-[#1e293b] text-gray-300 hover:bg-[#1e293b]">
              <Music className="w-3.5 h-3.5 mr-1" /> New Bed
            </Button>
            <Button size="sm" onClick={handleDownload} variant="outline" className="border-[#1e293b] text-gray-300 hover:bg-[#1e293b]">
              <Download className="w-3.5 h-3.5 mr-1" /> Export
            </Button>
            <div className="flex-1" />
            <Button size="sm" onClick={handleSave} className="bg-[#00d4ff] hover:bg-[#00a3cc] text-black">
              <Sparkles className="w-3.5 h-3.5 mr-1" /> Save to Library
            </Button>
          </div>
        </div>
      )}

      {!generating && !previewUrl && (
        <Button
          onClick={handleGenerate}
          disabled={generating || !eventName.trim() || !eventDate.trim() || !venue.trim()}
          className="w-full bg-gradient-to-r from-[#2563eb] to-[#00d4ff] hover:from-[#1d4ed8] hover:to-[#00a3cc] text-white font-semibold py-5"
        >
          <Radio className="w-5 h-5 mr-2" />
          Generate Promo
        </Button>
      )}
    </div>
  );
}

export default function ManualAnnouncementPlayer({ onPlay }) {
  const [activeTab, setActiveTab] = useState('promo');
  const [uploading, setUploading] = useState(false);
  const [customName, setCustomName] = useState('');
  const queryClient = useQueryClient();

  const { data: announcements = [] } = useQuery({
    queryKey: ['manual-announcements'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/voiceovers', { headers: getAuthHeaders() });
        if (!res.ok) return [];
        const all = await res.json();
        return all.filter(a => a.type === 'manual' || a.type === 'promo');
      } catch { return []; }
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (cacheKey) => {
      await fetch(`/api/voiceovers/${encodeURIComponent(cacheKey)}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manual-announcements'] });
      toast.success('Announcement deleted');
    }
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      toast.error('Please upload an audio file');
      return;
    }

    setUploading(true);
    try {
      const name = customName.trim() || file.name;
      const cacheKey = `manual-${Date.now()}-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const audio_base64 = await blobToBase64(file);

      const res = await fetch('/api/voiceovers', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cache_key: cacheKey,
          audio_base64,
          script: name,
          type: 'manual',
          dancer_name: name,
          energy_level: 0
        })
      });

      if (!res.ok) throw new Error('Upload failed');

      queryClient.invalidateQueries({ queryKey: ['manual-announcements'] });
      toast.success('Announcement uploaded');
      setCustomName('');
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload announcement');
    } finally {
      setUploading(false);
    }
  };

  const handlePlay = async (announcement) => {
    if (onPlay) {
      const url = `/api/voiceovers/audio/${encodeURIComponent(announcement.cache_key)}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        await onPlay(blobUrl);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
        toast.success(`Playing: ${announcement.dancer_name || announcement.cache_key}`);
      } else {
        toast.error('Failed to load announcement');
      }
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="bg-[#151528] rounded-lg border border-[#1e293b] p-4 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setActiveTab('promo')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === 'promo'
                ? 'bg-gradient-to-r from-[#2563eb] to-[#00d4ff] text-white'
                : 'bg-[#08081a] text-gray-400 hover:text-white border border-[#1e293b]'
            }`}
          >
            <Radio className="w-4 h-4" />
            Create Promo
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === 'upload'
                ? 'bg-[#00d4ff] text-black'
                : 'bg-[#08081a] text-gray-400 hover:text-white border border-[#1e293b]'
            }`}
          >
            <Upload className="w-4 h-4" />
            Upload
          </button>
        </div>

        {activeTab === 'promo' && (
          <PromoCreator
            onPlay={onPlay}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ['manual-announcements'] })}
          />
        )}

        {activeTab === 'upload' && (
          <div className="space-y-3">
            <Input
              placeholder="Custom name (optional)"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="bg-[#08081a] border-[#1e293b]"
            />
            <label className="block">
              <Button
                as="span"
                className="w-full bg-[#00d4ff] hover:bg-[#00a3cc] text-black cursor-pointer"
                disabled={uploading}
              >
                <Upload className="w-4 h-4 mr-2" />
                {uploading ? 'Uploading...' : 'Upload Audio File'}
              </Button>
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="hidden"
                disabled={uploading}
              />
            </label>
            <p className="text-xs text-gray-500">
              Upload MP3, WAV, or other audio files for announcements and advertisements
            </p>
          </div>
        )}
      </div>

      <div className="flex-1 bg-[#151528] rounded-lg border border-[#1e293b] p-4 flex flex-col">
        <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider mb-3">
          Promos & Announcements ({announcements.length})
        </h3>

        <ScrollArea className="flex-1">
          <div className="space-y-2">
            {announcements.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Radio className="w-12 h-12 mx-auto mb-3 text-gray-700" />
                <p className="text-sm">No promos or announcements yet</p>
                <p className="text-xs text-gray-600 mt-1">Create a promo or upload an audio file</p>
              </div>
            ) : (
              announcements.map((announcement) => (
                <div
                  key={announcement.cache_key}
                  className="flex items-center gap-3 bg-[#0d0d1f] rounded-lg p-3 border border-[#1e293b] hover:border-[#00d4ff]/50 transition-colors"
                >
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                    announcement.type === 'promo'
                      ? 'bg-[#2563eb]/20 text-[#60a5fa]'
                      : 'bg-[#00d4ff]/20 text-[#00d4ff]'
                  }`}>
                    {announcement.type === 'promo' ? <Radio className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{announcement.dancer_name || announcement.script || announcement.cache_key}</p>
                    <p className="text-[10px] text-gray-600 uppercase">{announcement.type === 'promo' ? 'AI Promo' : 'Uploaded'}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => handlePlay(announcement)}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      <Play className="w-4 h-4" />
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(announcement.cache_key)}
                      className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
