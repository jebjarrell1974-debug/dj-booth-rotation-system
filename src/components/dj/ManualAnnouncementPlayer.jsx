import React, { useState } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Play, Trash2, Mic } from 'lucide-react';
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

export default function ManualAnnouncementPlayer({ onPlay }) {
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
        return all.filter(a => a.type === 'manual');
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
          dancer_name: null,
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
        toast.success(`Playing: ${announcement.dancer_name || announcement.cache_key}`);
      } else {
        toast.error('Failed to load announcement');
      }
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="bg-[#151528] rounded-lg border border-[#1e1e3a] p-4 mb-4">
        <h3 className="text-sm font-semibold text-[#e040fb] uppercase tracking-wider mb-3">
          Upload Announcement / Ad
        </h3>

        <div className="space-y-3">
          <Input
            placeholder="Custom name (optional)"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="bg-[#08081a] border-[#1e1e3a]"
          />

          <label className="block">
            <Button
              as="span"
              className="w-full bg-[#e040fb] hover:bg-[#c026d3] text-black cursor-pointer"
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

      <div className="flex-1 bg-[#151528] rounded-lg border border-[#1e1e3a] p-4 flex flex-col">
        <h3 className="text-sm font-semibold text-[#e040fb] uppercase tracking-wider mb-3">
          Announcements Library ({announcements.length})
        </h3>

        <ScrollArea className="flex-1">
          <div className="space-y-2">
            {announcements.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Mic className="w-12 h-12 mx-auto mb-3 text-gray-700" />
                <p className="text-sm">No announcements uploaded yet</p>
              </div>
            ) : (
              announcements.map((announcement) => (
                <div
                  key={announcement.cache_key}
                  className="flex items-center gap-3 bg-[#0d0d1f] rounded-lg p-3 border border-[#1e1e3a] hover:border-[#e040fb]/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{announcement.dancer_name || announcement.cache_key}</p>
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
