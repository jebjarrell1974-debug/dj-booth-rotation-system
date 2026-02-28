import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Music, RefreshCw, Check, Folder, ChevronDown } from 'lucide-react';

const PAGE_SIZE = 200;

export default function MusicLibrary({ 
  onTrackSelect,
  selectedTracks = [],
  selectionMode = false
}) {
  const [tracks, setTracks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [genres, setGenres] = useState([]);
  const [activeGenre, setActiveGenre] = useState(null);
  const [isRescanning, setIsRescanning] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalTracks, setTotalTracks] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const searchTimeoutRef = useRef(null);

  const getAuthHeaders = useCallback(() => {
    const token = sessionStorage.getItem('djbooth_token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  }, []);

  const fetchTracks = useCallback(async (page = 1, append = false) => {
    if (page === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: PAGE_SIZE.toString(),
      });
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (activeGenre) params.set('genre', activeGenre);

      const res = await fetch(`/api/music/tracks?${params}`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Failed to fetch tracks');
      const data = await res.json();
      const raw = (data.tracks || []).map(t => ({
        ...t,
        url: '/api/music/stream/' + t.id
      }));
      const seen = new Set();
      const fetchedTracks = raw.filter(t => {
        if (seen.has(t.name)) return false;
        seen.add(t.name);
        return true;
      });

      if (append) {
        setTracks(prev => {
          const existingNames = new Set(prev.map(t => t.name));
          return [...prev, ...fetchedTracks.filter(t => !existingNames.has(t.name))];
        });
      } else {
        setTracks(fetchedTracks);
      }

      setTotalTracks(data.total || 0);
      setCurrentPage(page);
      setHasMore(page < (data.totalPages || 1));

      if (data.genres && data.genres.length > 0) {
        setGenres(data.genres);
      }
    } catch (err) {
      console.error('Error fetching tracks:', err);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [getAuthHeaders, searchQuery, activeGenre]);

  const handleRescan = useCallback(async () => {
    setIsRescanning(true);
    try {
      await fetch('/api/music/rescan', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      await fetchTracks(1, false);
    } catch (err) {
      console.error('Error rescanning:', err);
    } finally {
      setIsRescanning(false);
    }
  }, [getAuthHeaders, fetchTracks]);

  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    fetchTracks(1, false);
  }, []);

  useEffect(() => {
    if (!mountedRef.current) return;
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      fetchTracks(1, false);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, activeGenre]);

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      fetchTracks(currentPage + 1, true);
    }
  }, [fetchTracks, currentPage, isLoadingMore, hasMore]);

  const isSelected = (trackName) => selectedTracks.includes(trackName);

  return (
    <div className="flex flex-col h-full bg-[#0d0d1f] rounded-xl border border-[#1e293b]">
      <div className="p-4 border-b border-[#1e293b]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Music Library</h3>
          <span className="text-xs text-gray-500">
            {tracks.length} of {totalTracks} tracks
          </span>
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-2 bg-[#151528] rounded-lg text-sm text-gray-300 truncate">
              🎵 Server Music Library
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={handleRescan}
              disabled={isRescanning}
              className="text-gray-400 hover:text-white hover:bg-[#1e293b]"
              title="Rescan music folder"
            >
              <RefreshCw className={`w-4 h-4 ${isRescanning ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tracks..."
              className="pl-9 bg-[#151528] border-[#1e293b] text-white placeholder:text-gray-500"
            />
          </div>
        </div>
      </div>
      
      {genres.length > 0 && (
        <div className="px-3 py-2 border-b border-[#1e293b]">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveGenre(null)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                !activeGenre
                  ? 'bg-[#00d4ff] text-black'
                  : 'bg-[#151528] text-gray-400 hover:text-white hover:bg-[#1e293b]'
              }`}
            >
              All
            </button>
            {genres.map(genre => (
              <button
                key={genre.name}
                onClick={() => setActiveGenre(activeGenre === genre.name ? null : genre.name)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeGenre === genre.name
                    ? 'bg-[#00d4ff] text-black'
                    : 'bg-[#151528] text-gray-400 hover:text-white hover:bg-[#1e293b]'
                }`}
              >
                <Folder className="w-3 h-3" />
                {genre.name}
                <span className="opacity-60">{genre.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading && tracks.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">
              Loading...
            </div>
          )}

          {tracks.map((track) => (
            <button
              key={track.id}
              onClick={() => onTrackSelect?.({ ...track, url: '/api/music/stream/' + track.id })}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                isSelected(track.name)
                  ? 'bg-[#00d4ff]/20 text-[#00d4ff]'
                  : 'text-gray-300 hover:bg-[#151528] hover:text-white'
              }`}
            >
              {selectionMode && isSelected(track.name) ? (
                <Check className="w-4 h-4 text-[#00d4ff] flex-shrink-0" />
              ) : (
                <Music className="w-4 h-4 text-gray-500 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <span className="truncate text-sm block">{track.name}</span>
                {activeGenre === null && track.genre && (
                  <span className="text-xs text-gray-500 truncate block">{track.genre}</span>
                )}
              </div>
            </button>
          ))}

          {hasMore && (
            <div className="py-3 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={loadMore}
                disabled={isLoadingMore}
                className="text-[#00d4ff] hover:text-white hover:bg-[#1e293b]"
              >
                <ChevronDown className="w-4 h-4 mr-2" />
                {isLoadingMore ? 'Loading...' : `Load More (${tracks.length} of ${totalTracks})`}
              </Button>
            </div>
          )}
          
          {tracks.length === 0 && !isLoading && (
            <div className="text-center py-8 text-gray-500 text-sm">
              {searchQuery.trim() || activeGenre ? 'No tracks match your search' : 'No music files found on server'}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
