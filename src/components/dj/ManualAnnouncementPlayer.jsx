import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Play, Trash2, Mic, Radio, Send, CheckCircle, Clock, CalendarDays, MapPin, FileText, Zap } from 'lucide-react';
import { toast } from 'sonner';

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

const VIBE_OPTIONS = ['Hype', 'Chill', 'Sexy', 'Party', 'Classy', 'Latin', 'Urban'];
const LENGTH_OPTIONS = ['15s', '30s', '45s', '60s'];

export default function ManualAnnouncementPlayer({ onPlay }) {
  const [uploading, setUploading] = useState(false);
  const [customName, setCustomName] = useState('');
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

  const handlePromoSubmit = async () => {
    if (!promoForm.event_name.trim()) {
      toast.error('Please enter an event or promo name');
      return;
    }
    setSubmitting(true);
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
      toast.success('Promo request sent to Voice Studio!');
      setPromoForm({ event_name: '', date: '', time: '', venue: '', details: '', vibe: 'Hype', length: '30s' });
      queryClient.invalidateQueries({ queryKey: ['club-promo-requests'] });
    } catch (err) {
      console.error('Promo request error:', err);
      toast.error('Failed to submit promo request');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingRequests = promoRequests.filter(r => r.status === 'pending');
  const completedRequests = promoRequests.filter(r => r.status === 'recorded');

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="bg-[#151528] rounded-lg border border-[#1e293b] p-4">
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
      </div>

      <div className="bg-[#151528] rounded-lg border border-[#1e293b] p-4 flex flex-col" style={{ minHeight: '160px' }}>
        <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider mb-3">
          Promos & Announcements ({announcements.length})
        </h3>

        <ScrollArea className="flex-1" style={{ maxHeight: '240px' }}>
          <div className="space-y-2">
            {announcements.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Radio className="w-10 h-10 mx-auto mb-2 text-gray-700" />
                <p className="text-sm">No promos or announcements yet</p>
                <p className="text-xs text-gray-600 mt-1">Upload an audio file to get started</p>
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
        </ScrollArea>
      </div>

      <div className="bg-[#151528] rounded-lg border border-[#7c3aed]/40 p-4">
        <h3 className="text-sm font-semibold text-[#a78bfa] uppercase tracking-wider mb-3 flex items-center gap-2">
          <Send className="w-4 h-4" />
          Request a Promo / Commercial
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Submit a request and Voice Studio will produce the promo for you
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
            <Send className="w-4 h-4 mr-2" />
            {submitting ? 'Sending...' : 'Send Request to Voice Studio'}
          </Button>
        </div>

        {(pendingRequests.length > 0 || completedRequests.length > 0) && (
          <div className="mt-4 pt-4 border-t border-[#1e293b]">
            <h4 className="text-xs text-gray-400 uppercase tracking-wider mb-2">Your Requests</h4>
            <div className="space-y-2">
              {pendingRequests.map(r => (
                <div key={r.id} className="flex items-center gap-2 bg-[#0d0d1f] rounded-lg p-2 border border-[#1e293b]">
                  <Clock className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate">{r.event_name}</p>
                    <p className="text-[10px] text-yellow-400/70">Pending — waiting for Voice Studio</p>
                  </div>
                </div>
              ))}
              {completedRequests.map(r => (
                <div key={r.id} className="flex items-center gap-2 bg-[#0d0d1f] rounded-lg p-2 border border-[#1e293b]">
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate">{r.event_name}</p>
                    <p className="text-[10px] text-green-400/70">Recorded — promo is ready</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
