import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Music, X, Shuffle, Save, AlertCircle, ChevronUp, ChevronDown, Trash2, Search, Folder } from 'lucide-react';

const PAGE_SIZE = 200;

export default function PlaylistEditor({
  dancer,
  tracks,
  onSave,
  onClose
}) {
  const [playlist, setPlaylist] = useState(dancer?.playlist || []);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeGenre, setActiveGenre] = useState(null);
  const [serverTracks, setServerTracks] = useState([]);
  const [serverGenres, setServerGenres] = useState([]);
  const [serverTotalTracks, setServerTotalTracks] = useState(0);
  const [serverCurrentPage, setServerCurrentPage] = useState(1);
  const [serverHasMore, setServerHasMore] = useState(false);
  const [serverLoading, setServerLoading] = useState(false);
  const serverMountedRef = useRef(false);
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const getAuthHeaders = useCallback(() => {
    const token = sessionStorage.getItem('djbooth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchServerTracks = useCallback(async (page = 1, append = false) => {
    setServerLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: PAGE_SIZE.toString(),
      });
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      if (activeGenre) params.set('genre', activeGenre);
      const res = await fetch(`/api/music/tracks?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      const fetched = (data.tracks || []).map(t => ({ ...t, url: '/api/music/stream/' + t.id }));
      if (append) {
        setServerTracks(prev => [...prev, ...fetched]);
      } else {
        setServerTracks(fetched);
      }
      setServerTotalTracks(data.total || 0);
      setServerCurrentPage(page);
      setServerHasMore(page < (data.totalPages || 1));
      if (data.genres && data.genres.length > 0) {
        setServerGenres(data.genres);
      }
    } catch (err) {
      console.error('PlaylistEditor: fetch tracks error', err);
    } finally {
      setServerLoading(false);
    }
  }, [getAuthHeaders, debouncedSearch, activeGenre]);

  useEffect(() => {
    if (!serverMountedRef.current) {
      serverMountedRef.current = true;
      fetchServerTracks(1, false);
      return;
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      fetchServerTracks(1, false);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [debouncedSearch, activeGenre]);

  const loadMore = useCallback(() => {
    if (!serverLoading && serverHasMore) {
      fetchServerTracks(serverCurrentPage + 1, true);
    }
  }, [fetchServerTracks, serverCurrentPage, serverLoading, serverHasMore]);

  const getGenre = (track) => {
    if (track.genre) return track.genre;
    if (track.path && track.path.includes('/')) {
      return track.path.split('/')[0];
    }
    return null;
  };

  const addTrack = (trackName) => {
    if (!playlist.includes(trackName)) {
      setPlaylist([...playlist, trackName]);
    }
  };

  const removeTrack = (trackName) => {
    setPlaylist(playlist.filter(t => t !== trackName));
  };

  const moveTrack = (index, direction) => {
    const newPlaylist = [...playlist];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= newPlaylist.length) return;
    [newPlaylist[index], newPlaylist[newIndex]] = [newPlaylist[newIndex], newPlaylist[index]];
    setPlaylist(newPlaylist);
  };

  const randomize = () => {
    const pool = serverTracks.length > 0 ? serverTracks : tracks;
    const count = Math.min(10, pool.length);
    const a = [...pool];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    setPlaylist(a.slice(0, count).map(t => t.name));
  };

  const handleSave = () => {
    onSave(playlist);
    onClose();
  };

  if (!dancer) return null;

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-[#1e293b] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-full flex items-center justify-center text-black font-bold"
              style={{ backgroundColor: dancer.color || '#00d4ff' }}
            >
              {dancer.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{dancer.name}'s Playlist</h2>
              <p className="text-xs text-gray-500">{playlist.length} songs - App will auto-select 2 per set</p>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className="w-1/2 border-r border-[#1e293b] p-4 flex flex-col min-h-0">
            <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider mb-3">
              Current Playlist ({playlist.length})
            </h3>

            <ScrollArea className="flex-1 mb-4 min-h-0">
              <div className="space-y-1 pr-2">
                {playlist.map((songName, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#00d4ff]/30 bg-[#00d4ff]/10 group"
                  >
                    <span className="text-xs text-[#00d4ff]/60 font-mono w-6 text-right flex-shrink-0">
                      {idx + 1}.
                    </span>
                    <span className="text-sm text-white flex-1 min-w-0 break-words">
                      {songName}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-11 h-11 text-gray-500 hover:text-white"
                        onClick={() => moveTrack(idx, -1)}
                        disabled={idx === 0}
                      >
                        <ChevronUp className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-11 h-11 text-gray-500 hover:text-white"
                        onClick={() => moveTrack(idx, 1)}
                        disabled={idx === playlist.length - 1}
                      >
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-11 h-11 text-gray-500 hover:text-red-400"
                        onClick={() => removeTrack(songName)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                
                {playlist.length === 0 && (
                  <div className="p-4 bg-[#151528] border border-dashed border-[#1e293b] rounded-lg text-center">
                    <span className="text-sm text-gray-600">No songs selected</span>
                  </div>
                )}
              </div>
            </ScrollArea>

            {playlist.length === 0 && (
              <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-400">
                    Empty playlists will use random tracks from library
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-[#1e293b] text-gray-300 hover:bg-[#1e293b]"
                onClick={randomize}
                disabled={serverTracks.length === 0 && tracks.length === 0}
              >
                <Shuffle className="w-4 h-4 mr-2" />
                Add 10 Random
              </Button>
              <Button
                className="flex-1 bg-[#00d4ff] hover:bg-[#00a3cc] text-black"
                onClick={handleSave}
              >
                <Save className="w-4 h-4 mr-2" />
                Save Playlist
              </Button>
            </div>
          </div>

          <div className="w-1/2 flex flex-col min-h-0">
            <div className="p-4 pb-2 border-b border-[#1e293b] flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-400">
                  Available Tracks ({serverTracks.length} of {serverTotalTracks})
                </h3>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search by name, genre, or path..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#151528] border border-[#1e293b] rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00d4ff]/50"
                />
              </div>

              {serverGenres.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setActiveGenre(null)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      !activeGenre
                        ? 'bg-[#00d4ff] text-black'
                        : 'bg-[#151528] text-gray-400 hover:text-white border border-[#1e293b]'
                    }`}
                  >
                    All
                  </button>
                  {serverGenres.map(({ name, count }) => (
                    <button
                      key={name}
                      onClick={() => setActiveGenre(activeGenre === name ? null : name)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
                        activeGenre === name
                          ? 'bg-[#00d4ff] text-black'
                          : 'bg-[#151528] text-gray-400 hover:text-white border border-[#1e293b]'
                      }`}
                    >
                      <Folder className="w-3 h-3" />
                      {name}
                      <span className={`${activeGenre === name ? 'text-black/60' : 'text-gray-600'}`}>{count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <ScrollArea className="flex-1 min-h-0">
              <div className="p-2 space-y-1">
                {serverTracks.map((track, idx) => {
                  const isSelected = playlist.includes(track.name);
                  const genre = getGenre(track);
                  return (
                    <button
                      key={track.id}
                      onClick={() => !isSelected && addTrack(track.name)}
                      disabled={isSelected}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                        isSelected
                          ? 'bg-[#00d4ff]/20 text-[#00d4ff] cursor-default'
                          : 'text-gray-300 hover:bg-[#151528] hover:text-white'
                      }`}
                    >
                      <Music className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-[#00d4ff]' : 'text-gray-500'}`} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm break-words text-left block">{track.name}</span>
                        {genre && (
                          <span className="text-xs text-gray-600 uppercase">{genre}</span>
                        )}
                      </div>
                      {isSelected && (
                        <Badge className="ml-auto flex-shrink-0 bg-[#00d4ff] text-black text-xs">
                          ✓
                        </Badge>
                      )}
                    </button>
                  );
                })}
                {serverHasMore && (
                  <div className="text-center py-3">
                    <button
                      onClick={loadMore}
                      disabled={serverLoading}
                      className="px-4 py-2 text-xs font-medium text-[#00d4ff] bg-[#00d4ff]/10 hover:bg-[#00d4ff]/20 rounded-lg transition-colors"
                    >
                      {serverLoading ? 'Loading...' : `Load More (${serverTracks.length} of ${serverTotalTracks})`}
                    </button>
                  </div>
                )}
                {serverTracks.length === 0 && !serverLoading && (
                  <div className="p-8 text-center text-gray-500 text-sm">
                    {debouncedSearch.trim() || activeGenre ? 'No tracks match your search' : 'No tracks found'}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}
