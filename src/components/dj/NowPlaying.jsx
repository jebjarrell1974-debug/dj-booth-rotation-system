import React from 'react';
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipForward, Volume2, VolumeX } from 'lucide-react';

export default function NowPlaying({
  trackName,
  currentTime,
  duration,
  isPlaying,
  volume,
  onPlayPause,
  onSkip,
  onSeek,
  onVolumeChange,
  songNumber,
  dancerName
}) {
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const remaining = duration - currentTime;

  return (
    <div className="bg-[#0d0d1f] rounded-xl border border-[#1e1e3a] p-6">
      {/* Dancer Info */}
      {dancerName && (
        <div className="mb-4 text-center">
          <span className="text-xs uppercase tracking-widest text-gray-500">Now Performing</span>
          <h2 className="text-2xl font-bold text-white mt-1">{dancerName}</h2>
          {songNumber && (
            <span className="text-sm text-[#e040fb]">Song {songNumber} of 2</span>
          )}
        </div>
      )}
      
      {/* Track Info */}
      <div className="text-center mb-4">
        <h3 className="text-lg text-gray-200 truncate max-w-md mx-auto">
          {trackName || 'No track loaded'}
        </h3>
      </div>
      
      {/* Progress Bar */}
      <div className="mb-4">
        <div className="relative h-2 bg-[#1e1e3a] rounded-full overflow-hidden cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            onSeek?.(percent * duration);
          }}
        >
          <div 
            className="absolute h-full bg-[#e040fb]"
            style={{ width: `${progress}%` }}
          />
          {/* 3-minute marker */}
          {duration > 180 && (
            <div 
              className="absolute h-full w-0.5 bg-red-500/50"
              style={{ left: `${(180 / duration) * 100}%` }}
            />
          )}
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>{formatTime(currentTime)}</span>
          <span className={remaining <= 30 ? 'text-red-400' : ''}>
            -{formatTime(remaining)}
          </span>
        </div>
      </div>
      
      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        <Button
          size="icon"
          variant="ghost"
          onClick={onPlayPause}
          className="w-14 h-14 rounded-full bg-[#e040fb] hover:bg-[#c026d3] text-black"
        >
          {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
        </Button>
        
        <Button
          size="icon"
          variant="ghost"
          onClick={onSkip}
          className="w-14 h-14 rounded-full text-gray-400 hover:text-white hover:bg-[#1e1e3a]"
        >
          <SkipForward className="w-5 h-5" />
        </Button>
        
        {/* Volume Control */}
        <div className="flex items-center gap-2 ml-4">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onVolumeChange?.(volume > 0 ? 0 : 0.8)}
            className="text-gray-400 hover:text-white"
          >
            {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <Slider
            value={[volume * 100]}
            onValueChange={([v]) => onVolumeChange?.(v / 100)}
            max={100}
            step={1}
            className="w-24"
          />
        </div>
      </div>
    </div>
  );
}