import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Trash2, Mic, Radio, Send, CheckCircle, Clock, CalendarDays, MapPin, FileText, Zap, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getApiConfig } from '@/components/apiConfig';
import { localIntegrations } from '@/api/localEntities';
import { VOICE_SETTINGS } from '@/utils/energyLevels';
import { trackOpenAICall, trackElevenLabsCall, estimateTokens } from '@/utils/apiCostTracker';

const LOCKED_LEVEL = 4;

const getAuthHeaders = () => {
  const token = localStorage.getItem('djbooth_token');
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const VIBE_OPTIONS = ['Hype', 'Chill', 'Sexy', 'Party', 'Classy', 'Latin', 'Urban'];
const LENGTH_OPTIONS = ['15s', '30s', '45s', '60s'];

export default function ManualAnnouncementPlayer({ onPlay }) {
  const queryClient = useQueryClient();

  const [promoForm, setPromoForm] = useState({
    event_name: '',
    date: '',
    time: '',
    venue: '',
    details: '',
    vibe: 'Hype',
    length: '30s'
  });
  const [submitting, setSubmitting] = useState(false);

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

  const { data: promoRequests = [] } = useQuery({
    queryKey: ['club-promo-requests'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/promo-requests', { headers: getAuthHeaders() });
        if (!res.ok) return [];
        return await res.json();
      } catch { return []; }
    },
    refetchInterval: 30000
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

  const buildPromoPrompt = (form) => {
    const parts = [
      `You are a professional strip club DJ creating a promo voiceover script.`,
      `Write a ${form.length || '30s'} promo with a ${(form.vibe || 'Hype').toLowerCase()} vibe.`,
      `Event/Promo: ${form.event_name}`,
    ];
    if (form.date) parts.push(`Date: ${form.date}`);
    if (form.time) parts.push(`Time: ${form.time}`);
    if (form.venue) parts.push(`Venue: ${form.venue}`);
    if (form.details) parts.push(`Details: ${form.details}`);
    parts.push(
      `Write the script as flowing spoken text — exactly what would be read over the mic.`,
      `No labels, brackets, stage directions, or explanations. Just the spoken words.`,
      `Use commas for breath pauses, ellipsis for drawn-out pauses.`,
      `Keep it punchy, engaging, and club-appropriate.`
    );
    return parts.join('\n');
  };

  const generatePromoScript = async (form) => {
    const config = getApiConfig();
    const prompt = buildPromoPrompt(form);
    const openaiKey = config.openaiApiKey || '';
    const scriptModel = config.scriptModel || 'gpt-4.1';

    if (openaiKey && scriptModel !== 'auto') {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch('/api/openai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: scriptModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.9,
          max_tokens: 300,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`OpenAI ${res.status}: ${errText}`);
      }
      const data = await res.json();
      const usage = data.usage;
      trackOpenAICall({
        model: scriptModel,
        promptTokens: usage?.prompt_tokens || estimateTokens(prompt),
        completionTokens: usage?.completion_tokens || estimateTokens(data.choices?.[0]?.message?.content || ''),
        context: `promo-script-${form.event_name}`,
      });
      const raw = data.choices?.[0]?.message?.content || '';
      return raw.replace(/^\d+[\.\)]\s*/gm, '').replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim() || 'Check out this amazing event.';
    }

    const response = await localIntegrations.Core.InvokeLLM({ prompt });
    const text = typeof response === 'string' ? response : (response?.script || response?.text || response?.content || JSON.stringify(response));
    return text.replace(/^\d+[\.\)]\s*/gm, '').replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim() || 'Check out this amazing event.';
  };

  const generatePromoAudio = async (script) => {
    const config = getApiConfig();
    const apiKey = config.elevenLabsApiKey || '';
    if (!apiKey) throw new Error('ElevenLabs API key not configured');

    const voiceId = config.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM';
    const voiceSettings = VOICE_SETTINGS[LOCKED_LEVEL] || VOICE_SETTINGS[3];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
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
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const status = response.status;
      let detail = '';
      try { const errBody = await response.json(); detail = errBody?.detail?.message || errBody?.detail || JSON.stringify(errBody); } catch {}
      throw new Error(`ElevenLabs error (${status}): ${detail || 'Unknown error'}`);
    }

    trackElevenLabsCall({ text: script, model: 'eleven_multilingual_v2', context: 'promo-tts' });
    return await response.blob();
  };

  const blobToBase64 = (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handlePromoSubmit = async () => {
    if (!promoForm.event_name.trim()) {
      toast.error('Please enter an event or promo name');
      return;
    }
    setSubmitting(true);
    const toastId = toast.loading('Submitting promo request...');
    try {
      const res = await fetch('/api/promo-requests', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(promoForm)
      });
      if (!res.ok) throw new Error('Submit failed');
      queryClient.invalidateQueries({ queryKey: ['club-promo-requests'] });

      toast.loading('Generating script...', { id: toastId });
      const script = await generatePromoScript(promoForm);

      toast.loading('Recording voice...', { id: toastId });
      const audioBlob = await generatePromoAudio(script);

      toast.loading('Saving promo...', { id: toastId });
      const cacheKey = `promo-auto-${Date.now()}-${promoForm.event_name.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const audio_base64 = await blobToBase64(audioBlob);
      const saveRes = await fetch('/api/voiceovers', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cache_key: cacheKey,
          audio_base64,
          script,
          type: 'promo',
          dancer_name: promoForm.event_name,
          energy_level: LOCKED_LEVEL,
        })
      });
      if (!saveRes.ok) throw new Error('Failed to save voiceover');

      queryClient.invalidateQueries({ queryKey: ['manual-announcements'] });
      toast.success('Promo created and ready to play!', { id: toastId });
      setPromoForm({ event_name: '', date: '', time: '', venue: '', details: '', vibe: 'Hype', length: '30s' });
    } catch (err) {
      console.error('Promo auto-generation error:', err);
      toast.error(`Promo generation failed: ${err.message}`, { id: toastId });
    } finally {
      setSubmitting(false);
    }
  };

  const pendingRequests = promoRequests.filter(r => r.status === 'pending');
  const completedRequests = promoRequests.filter(r => r.status === 'recorded');

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-[#151528] rounded-lg border border-[#1e293b] p-4">
        <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider mb-3">
          Promos & Announcements ({announcements.length})
        </h3>

        <div className="space-y-2">
          {announcements.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Radio className="w-10 h-10 mx-auto mb-2 text-gray-700" />
                <p className="text-sm">No promos or announcements yet</p>
                <p className="text-xs text-gray-600 mt-1">Promos are managed from homebase or synced via cloud</p>
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
                    <p className="text-[10px] text-gray-600 uppercase">{announcement.type === 'promo' ? 'Promo' : 'Uploaded'}</p>
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
      </div>

      <div className="bg-[#151528] rounded-lg border border-[#7c3aed]/40 p-4">
        <h3 className="text-sm font-semibold text-[#a78bfa] uppercase tracking-wider mb-3 flex items-center gap-2">
          <Send className="w-4 h-4" />
          Request a Promo / Commercial
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Auto-generates a voiceover and saves it to your Promos list
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Event / Promo Name *</label>
            <Input
              placeholder="e.g. Friday Night VIP Party"
              value={promoForm.event_name}
              onChange={(e) => setPromoForm(f => ({ ...f, event_name: e.target.value }))}
              className="bg-[#08081a] border-[#1e293b]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                <CalendarDays className="w-3 h-3" /> Date
              </label>
              <Input
                type="date"
                value={promoForm.date}
                onChange={(e) => setPromoForm(f => ({ ...f, date: e.target.value }))}
                className="bg-[#08081a] border-[#1e293b]"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Time
              </label>
              <Input
                type="time"
                value={promoForm.time}
                onChange={(e) => setPromoForm(f => ({ ...f, time: e.target.value }))}
                className="bg-[#08081a] border-[#1e293b]"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Venue
            </label>
            <Input
              placeholder="e.g. Club Name, City"
              value={promoForm.venue}
              onChange={(e) => setPromoForm(f => ({ ...f, venue: e.target.value }))}
              className="bg-[#08081a] border-[#1e293b]"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 flex items-center gap-1">
              <FileText className="w-3 h-3" /> Details / What to Say
            </label>
            <textarea
              placeholder="Describe what the promo should say — specials, drink prices, featured performers, etc."
              value={promoForm.details}
              onChange={(e) => setPromoForm(f => ({ ...f, details: e.target.value }))}
              className="w-full bg-[#08081a] border border-[#1e293b] rounded-md px-3 py-2 text-sm text-white placeholder:text-gray-600 resize-none focus:outline-none focus:ring-1 focus:ring-[#7c3aed]"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                <Zap className="w-3 h-3" /> Vibe
              </label>
              <select
                value={promoForm.vibe}
                onChange={(e) => setPromoForm(f => ({ ...f, vibe: e.target.value }))}
                className="w-full bg-[#08081a] border border-[#1e293b] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#7c3aed]"
              >
                {VIBE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Length
              </label>
              <select
                value={promoForm.length}
                onChange={(e) => setPromoForm(f => ({ ...f, length: e.target.value }))}
                className="w-full bg-[#08081a] border border-[#1e293b] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#7c3aed]"
              >
                {LENGTH_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <Button
            onClick={handlePromoSubmit}
            disabled={submitting || !promoForm.event_name.trim()}
            className="w-full bg-[#7c3aed] hover:bg-[#6d28d9] text-white"
          >
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            {submitting ? 'Generating Promo...' : 'Generate Promo'}
          </Button>
        </div>

      </div>
    </div>
  );
}
