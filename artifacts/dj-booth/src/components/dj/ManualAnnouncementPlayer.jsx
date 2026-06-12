import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Trash2, Mic, Radio, Send, CheckCircle, Clock, CalendarDays, MapPin, FileText, Zap, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getApiConfig } from '@/components/apiConfig';
import { localIntegrations } from '@/api/localEntities';
import { VOICE_SETTINGS } from '@/utils/energyLevels';
import { prepareTTSText } from '@/utils/ttsText';
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

// --- Calendar awareness for promo dates -------------------------------------
// The promo script's day-of-week must be computed FROM THE ACTUAL CALENDAR, not
// guessed by the LLM. The model has no reliable year context and will pick the
// wrong year (e.g. "July 16-17" -> 2024's Tue/Wed instead of 2026's Thu/Fri).
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_LOOKUP = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4,
  june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

// Best-effort parse of a free-text event date into one or two concrete dates and
// return an authoritative phrase like "Thursday, July 16th and Friday, July 17th, 2026".
// Returns null if the text can't be parsed (caller falls back to year context only).
const resolveEventDates = (dateStr, today = new Date()) => {
  if (!dateStr || !dateStr.trim()) return null;
  const str = dateStr.trim();
  const yearMatch = str.match(/\b(20\d{2})\b/);
  let year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  let month = null;
  const days = [];

  // "July 16-17" / "Jul 16 & 17" / "July 16 to 17" / "July 16, 2026"
  const monthNameRe = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:[-–—]|to|thru|through|&|and)\s*(\d{1,2})(?:st|nd|rd|th)?)?/i;
  const mn = str.match(monthNameRe);
  if (mn && MONTH_LOOKUP[mn[1].toLowerCase()] !== undefined) {
    month = MONTH_LOOKUP[mn[1].toLowerCase()];
    days.push(parseInt(mn[2], 10));
    if (mn[3]) days.push(parseInt(mn[3], 10));
  } else {
    // Numeric "7/16", "7/16-17", "7/16/26"
    const numRe = /\b(\d{1,2})\/(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?(?:\/(\d{2,4}))?/;
    const num = str.match(numRe);
    if (num) {
      month = parseInt(num[1], 10) - 1;
      days.push(parseInt(num[2], 10));
      if (num[3]) days.push(parseInt(num[3], 10));
      if (num[4] && !year) {
        const y = parseInt(num[4], 10);
        year = y < 100 ? 2000 + y : y;
      }
    }
  }

  if (month === null || month < 0 || month > 11 || days.length === 0) return null;

  // No explicit year: assume the next upcoming occurrence from today.
  if (!year) {
    year = today.getFullYear();
    const firstTry = new Date(year, month, days[0]);
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (firstTry < todayMidnight) year += 1;
  }

  const resolved = [];
  for (const d of days) {
    const dt = new Date(year, month, d);
    // Reject impossible dates (e.g. Feb 30 rolls over to March).
    if (dt.getMonth() !== month || dt.getDate() !== d) return null;
    resolved.push(`${DAY_NAMES[dt.getDay()]}, ${MONTH_NAMES[month]} ${ordinal(d)}`);
  }

  if (resolved.length === 2) return `${resolved[0]} and ${resolved[1]}, ${year}`;
  return `${resolved[0]}, ${year}`;
};

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

  const LENGTH_WORD_LIMITS = { '15s': 40, '30s': 75, '45s': 110, '60s': 140 };

  const buildPromoPrompt = (form) => {
    const maxWords = LENGTH_WORD_LIMITS[form.length] || 75;
    const today = new Date();
    const todayStr = `${DAY_NAMES[today.getDay()]}, ${MONTH_NAMES[today.getMonth()]} ${ordinal(today.getDate())}, ${today.getFullYear()}`;
    const resolvedDates = resolveEventDates(form.date, today);
    const parts = [
      `You are a professional strip club DJ creating a promo voiceover script.`,
      `Write a ${form.length || '30s'} promo with a ${(form.vibe || 'Hype').toLowerCase()} vibe.`,
      `Event/Promo: ${form.event_name}`,
      `(Reference only — today's date is ${todayStr}; the current year is ${today.getFullYear()}.)`,
    ];
    if (resolvedDates) {
      parts.push(`Date: ${form.date}`);
      parts.push(`EVENT DATE(S) — already resolved from the calendar. Say these EXACT day names; do NOT recompute or change the weekday: ${resolvedDates}.`);
    } else if (form.date) {
      parts.push(`Date: ${form.date} (assume the current year, ${today.getFullYear()}, unless the text states otherwise).`);
    }
    if (form.time) parts.push(`Time: ${form.time}`);
    if (form.venue) parts.push(`Venue: ${form.venue}`);
    if (form.details) parts.push(`Details: ${form.details}`);
    parts.push(
      `Write the script as flowing spoken text — exactly what would be read over the mic.`,
      `No labels, brackets, stage directions, or explanations. Just the spoken words.`,
      `Use commas for breath pauses, ellipsis for drawn-out pauses.`,
      `Keep it punchy, engaging, and club-appropriate.`,
      `When referring to the event date, always say the full day and date (for example: "Saturday, May 30th" or "Saturday the 30th"). Never say "this Saturday", "next Saturday", "upcoming", "coming up soon", or any other relative date phrasing — the script may play weeks before the event, so relative phrasing will be wrong.`,
      `Maximum ${maxWords} words. End with a complete sentence followed by a period.`
    );
    return parts.join('\n');
  };

  const splitScriptIntoChunks = (script, targetWords = 40) => {
    const sentences = script.match(/[^.!?]+[.!?]+/g) || [script];
    const chunks = [];
    let current = [];
    let wordCount = 0;
    for (const sentence of sentences) {
      const words = sentence.trim().split(/\s+/).length;
      if (wordCount + words > targetWords && current.length > 0) {
        chunks.push(current.join(' ').trim());
        current = [sentence.trim()];
        wordCount = words;
      } else {
        current.push(sentence.trim());
        wordCount += words;
      }
    }
    if (current.length > 0) chunks.push(current.join(' ').trim());
    return chunks.filter(c => c.length > 0);
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
        text: prepareTTSText(script),
        model_id: 'eleven_v3',
        voice_settings: {
          stability: voiceSettings.stability,
          similarity_boost: voiceSettings.similarity_boost,
          style: voiceSettings.style,
          speed: Math.max(0.7, Math.min(1.2, voiceSettings.speed ?? 1.0)),
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

    trackElevenLabsCall({ text: script, model: 'eleven_v3', context: 'promo-tts' });
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

      const scriptChunks = splitScriptIntoChunks(script);
      const chunkBase64s = [];
      for (let i = 0; i < scriptChunks.length; i++) {
        toast.loading(`Recording voice (part ${i + 1} of ${scriptChunks.length})...`, { id: toastId });
        const audioBlob = await generatePromoAudio(scriptChunks[i]);
        chunkBase64s.push(await blobToBase64(audioBlob));
      }

      let audio_base64;
      if (chunkBase64s.length === 1) {
        audio_base64 = chunkBase64s[0];
      } else {
        toast.loading('Stitching audio parts...', { id: toastId });
        const stitchRes = await fetch('/api/voiceovers/stitch-chunks', {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ chunks: chunkBase64s }),
        });
        if (!stitchRes.ok) throw new Error('Failed to stitch audio parts');
        ({ audio_base64 } = await stitchRes.json());
      }

      toast.loading('Saving promo...', { id: toastId });
      const cacheKey = `promo-auto-${Date.now()}-${promoForm.event_name.replace(/[^a-zA-Z0-9]/g, '_')}`;
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
