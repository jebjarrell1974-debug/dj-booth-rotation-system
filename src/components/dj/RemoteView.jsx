import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { boothApi } from '@/api/serverApi';
import DJOptions from '@/components/dj/DJOptions';
import {
  Wifi,
  SkipForward,
  Mic,
  MicOff,
  Users,
  Layers,
  Plus,
  Minus,
  X,
  LogOut,
  Radio,
  ChevronUp,
  ChevronDown,
  SlidersHorizontal,
  Volume2,
  Save,
} from 'lucide-react';

export default function RemoteView({ dancers, liveBoothState, onLogout, djOptions, onOptionsChange }) {
  const [activePanel, setActivePanel] = useState('rotation');

  const isConnected = liveBoothState?.updatedAt > 0;
  const isPlaying = liveBoothState?.isPlaying;
  const isRotationActive = liveBoothState?.isRotationActive;
  const currentDancerName = liveBoothState?.currentDancerName || 'Unknown';
  const currentTrack = liveBoothState?.currentTrack || '';
  const currentSongNumber = liveBoothState?.currentSongNumber || 0;
  const songsPerSet = liveBoothState?.songsPerSet || 3;
  const announcementsEnabled = liveBoothState?.announcementsEnabled;
  const rotationList = liveBoothState?.rotation || [];
  const currentDancerIndex = liveBoothState?.currentDancerIndex || 0;
  const rotationSongs = liveBoothState?.rotationSongs || {};
  const currentVolume = liveBoothState?.volume != null ? liveBoothState.volume : 0.8;
  const volumePercent = Math.round(currentVolume * 100);
  const currentVoiceGain = liveBoothState?.voiceGain != null ? liveBoothState.voiceGain : 1.5;
  const voiceGainPercent = Math.round(currentVoiceGain * 100);
  const breakSongsPerSet = liveBoothState?.breakSongsPerSet || 0;

  const trackTime = liveBoothState?.trackTime || 0;
  const trackDuration = liveBoothState?.trackDuration || 0;
  const trackTimeAt = liveBoothState?.trackTimeAt || 0;

  const countdownRef = useRef(null);
  useEffect(() => {
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const interval = setInterval(() => {
      if (!countdownRef.current) return;
      if (trackDuration > 0 && trackTimeAt > 0) {
        const elapsed = isPlaying ? (Date.now() - trackTimeAt) / 1000 : 0;
        const currentPos = Math.min(trackTime + elapsed, trackDuration);
        const remaining = Math.max(0, trackDuration - currentPos);
        countdownRef.current.textContent = fmt(remaining);
        countdownRef.current.style.display = '';
      } else {
        countdownRef.current.style.display = 'none';
      }
    }, 250);
    return () => clearInterval(interval);
  }, [trackTime, trackDuration, trackTimeAt, isPlaying]);

  const currentDancer = isRotationActive
    ? dancers.find(d => d.id === rotationList[currentDancerIndex])
    : null;

  const availableDancers = dancers.filter(
    d => d.is_active && !rotationList.includes(d.id)
  );

  return (
    <div className="remote-view h-[100dvh] bg-[#08081a] text-white flex flex-col overflow-hidden select-none">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#151528] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#2563eb] flex items-center justify-center">
            <Wifi className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">DJ Remote</h1>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? (isPlaying ? 'bg-green-400 animate-pulse' : 'bg-yellow-500') : 'bg-red-500'}`} />
              <span className="text-xs text-gray-400">
                {isConnected ? (isPlaying ? 'Playing' : 'Connected') : 'Waiting for booth...'}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#151528] active:bg-[#1e293b] transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-sm">Logout</span>
        </button>
      </div>

      <div className="flex flex-1 min-h-0 gap-0">
        <div className="w-[340px] flex-shrink-0 flex flex-col border-r border-[#151528] p-4 gap-4">
          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-4 flex-shrink-0">
            {isRotationActive && currentDancer ? (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-black font-bold text-lg flex-shrink-0"
                    style={{ backgroundColor: currentDancer?.color || '#00d4ff' }}
                  >
                    {currentDancer?.name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-lg font-semibold text-white truncate">{currentDancer?.name}</p>
                    <p className="text-sm text-[#00d4ff]">Song {currentSongNumber} / {songsPerSet}</p>
                  </div>
                </div>
                {currentTrack && (
                  <div className="flex items-center gap-2 bg-[#151528] rounded-lg px-3 py-2">
                    <p className="text-sm text-gray-300 truncate flex-1">
                      {isPlaying ? '▶' : '⏸'} {currentTrack}
                    </p>
                    <span ref={countdownRef} className="text-sm font-mono text-[#00d4ff] tabular-nums flex-shrink-0" style={{ display: 'none' }} />
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-3">
                <Radio className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500">
                  {isConnected ? 'Rotation not active' : 'Waiting for booth connection...'}
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3 flex-shrink-0">
            <button
              onClick={() => boothApi.sendCommand('skip')}
              className="flex-1 h-16 rounded-xl bg-[#1e293b] border border-[#2e2e5a] flex items-center justify-center gap-3 text-white active:bg-[#2e2e5a] transition-colors"
            >
              <SkipForward className="w-7 h-7" />
              <span className="text-base font-semibold">Skip</span>
            </button>
            <button
              onClick={() => boothApi.sendCommand('toggleAnnouncements')}
              className={`flex-1 h-16 rounded-xl border flex items-center justify-center gap-3 active:opacity-80 transition-colors ${
                announcementsEnabled
                  ? 'bg-[#00d4ff]/15 border-[#00d4ff]/40 text-[#00d4ff]'
                  : 'bg-[#1e293b] border-[#2e2e5a] text-gray-500'
              }`}
            >
              {announcementsEnabled ? <Mic className="w-7 h-7" /> : <MicOff className="w-7 h-7" />}
              <span className="text-base font-semibold">{announcementsEnabled ? 'Announce' : 'Muted'}</span>
            </button>
          </div>

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-400">Songs / Set</span>
              <div className="flex items-center gap-1">
                {[1,2,3,4,5].map(n => (
                  <button
                    key={n}
                    onClick={() => boothApi.sendCommand('setSongsPerSet', { count: n })}
                    className={`w-10 h-10 rounded-lg text-base font-bold transition-colors ${
                      n === songsPerSet
                        ? 'bg-[#00d4ff] text-black'
                        : 'bg-[#151528] text-gray-400 active:bg-[#2e2e5a]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-400">Break Songs</span>
              <div className="flex items-center gap-1">
                {[0,1,2,3].map(n => (
                  <button
                    key={n}
                    onClick={() => boothApi.sendCommand('setBreakSongsPerSet', { count: n })}
                    className={`w-10 h-10 rounded-lg text-base font-bold transition-colors ${
                      n === breakSongsPerSet
                        ? 'bg-violet-500 text-white'
                        : 'bg-[#151528] text-gray-400 active:bg-[#2e2e5a]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-400">Music</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => boothApi.sendCommand('setVolume', { volume: Math.max(0, currentVolume - 0.05) })}
                  disabled={volumePercent <= 0}
                  className="w-12 h-12 rounded-lg bg-[#151528] border border-[#2e2e5a] flex items-center justify-center text-white active:bg-[#2e2e5a] disabled:opacity-30 transition-colors"
                >
                  <Minus className="w-6 h-6" />
                </button>
                <div className="w-16 h-12 rounded-lg bg-[#151528] border border-[#2e2e5a] flex items-center justify-center">
                  <span className="text-lg font-bold text-white tabular-nums">{volumePercent}%</span>
                </div>
                <button
                  onClick={() => boothApi.sendCommand('setVolume', { volume: Math.min(1, currentVolume + 0.05) })}
                  disabled={volumePercent >= 100}
                  className="w-12 h-12 rounded-lg bg-[#151528] border border-[#2e2e5a] flex items-center justify-center text-white active:bg-[#2e2e5a] disabled:opacity-30 transition-colors"
                >
                  <Plus className="w-6 h-6" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-[#a855f7]" />
                <span className="text-sm font-semibold text-[#a855f7]">Voice</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => boothApi.sendCommand('setVoiceGain', { gain: Math.max(0.5, currentVoiceGain - 0.1) })}
                  disabled={voiceGainPercent <= 50}
                  className="w-12 h-12 rounded-lg bg-[#151528] border border-[#a855f7]/30 flex items-center justify-center text-white active:bg-[#2e2e5a] disabled:opacity-30 transition-colors"
                >
                  <Minus className="w-6 h-6" />
                </button>
                <div className="w-16 h-12 rounded-lg bg-[#151528] border border-[#a855f7]/30 flex items-center justify-center">
                  <span className="text-lg font-bold text-[#a855f7] tabular-nums">{voiceGainPercent}%</span>
                </div>
                <button
                  onClick={() => boothApi.sendCommand('setVoiceGain', { gain: Math.min(3, currentVoiceGain + 0.1) })}
                  disabled={voiceGainPercent >= 300}
                  className="w-12 h-12 rounded-lg bg-[#151528] border border-[#a855f7]/30 flex items-center justify-center text-white active:bg-[#2e2e5a] disabled:opacity-30 transition-colors"
                >
                  <Plus className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-1 px-4 pt-3 pb-2 flex-shrink-0">
            <button
              onClick={() => setActivePanel('options')}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl text-base font-semibold transition-colors ${
                activePanel === 'options'
                  ? 'bg-[#00d4ff] text-black'
                  : 'bg-[#0d0d1f] text-gray-400 active:bg-[#151528]'
              }`}
            >
              <SlidersHorizontal className="w-5 h-5" />
              Options
            </button>
            <button
              onClick={() => setActivePanel('rotation')}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl text-base font-semibold transition-colors ${
                activePanel === 'rotation'
                  ? 'bg-[#00d4ff] text-black'
                  : 'bg-[#0d0d1f] text-gray-400 active:bg-[#151528]'
              }`}
            >
              <Layers className="w-5 h-5" />
              Rotation
            </button>
            <button
              onClick={() => setActivePanel('dancers')}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl text-base font-semibold transition-colors ${
                activePanel === 'dancers'
                  ? 'bg-[#00d4ff] text-black'
                  : 'bg-[#0d0d1f] text-gray-400 active:bg-[#151528]'
              }`}
            >
              <Users className="w-5 h-5" />
              Dancers
            </button>
          </div>

          <div className="flex-1 px-4 pb-4 overflow-auto min-h-0">
            {activePanel === 'options' && (
              <DJOptions
                djOptions={djOptions}
                onOptionsChange={onOptionsChange}
              />
            )}

            {activePanel === 'rotation' && (
              <div className="space-y-2">
                <button
                  onClick={() => boothApi.sendCommand('saveRotation', { rotation: rotationList })}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#00d4ff] text-black font-semibold text-base active:bg-[#00a3cc] transition-colors"
                >
                  <Save className="w-5 h-5" />
                  Save All
                </button>
                {rotationList.length === 0 ? (
                  <div className="text-center py-12">
                    <Layers className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                    <p className="text-base text-gray-500">No dancers in rotation</p>
                    <p className="text-sm text-gray-600 mt-1">Add dancers from the Dancers tab</p>
                  </div>
                ) : (
                  <>
                    {rotationList.map((dancerId, idx) => {
                      const dancer = dancers.find(d => d.id === dancerId);
                      if (!dancer) return null;
                      const isCurrent = idx === currentDancerIndex && isRotationActive;
                      const dancerSongs = rotationSongs[dancerId] || [];
                      return (
                        <div
                          key={dancerId}
                          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                            isCurrent
                              ? 'bg-[#00d4ff]/10 border-[#00d4ff]/40'
                              : 'bg-[#0d0d1f] border-[#1e293b]'
                          }`}
                        >
                          <div className="flex items-center gap-0 flex-shrink-0">
                            <button
                              onClick={() => boothApi.sendCommand('moveInRotation', { dancerId, direction: 'up' })}
                              className="w-11 h-11 flex items-center justify-center text-gray-500 active:text-white rounded-lg"
                              disabled={idx === 0}
                            >
                              <ChevronUp className="w-6 h-6" />
                            </button>
                            <button
                              onClick={() => boothApi.sendCommand('moveInRotation', { dancerId, direction: 'down' })}
                              className="w-11 h-11 flex items-center justify-center text-gray-500 active:text-white rounded-lg"
                              disabled={idx === rotationList.length - 1}
                            >
                              <ChevronDown className="w-6 h-6" />
                            </button>
                          </div>
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-black font-bold text-sm flex-shrink-0"
                            style={{ backgroundColor: dancer.color || '#00d4ff' }}
                          >
                            {dancer.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-base font-medium ${isCurrent ? 'text-[#00d4ff]' : 'text-white'}`}>
                              {dancer.name}
                              {isCurrent && <span className="ml-2 text-sm text-[#00d4ff]/70">◀ NOW</span>}
                            </p>
                            {dancerSongs.length > 0 && (
                              <p className="text-sm text-gray-500 truncate">
                                {dancerSongs.map(s => typeof s === 'string' ? s : s.name).join(', ')}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => boothApi.sendCommand('removeDancerFromRotation', { dancerId })}
                            className="p-3 text-red-400/60 active:text-red-400 transition-colors flex-shrink-0"
                          >
                            <X className="w-6 h-6" />
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}

                {availableDancers.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-[#1e293b]">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">Add to Rotation</h4>
                    <div className="space-y-1">
                      {availableDancers.map(dancer => (
                        <button
                          key={dancer.id}
                          onClick={() => boothApi.sendCommand('addDancerToRotation', { dancerId: dancer.id })}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left active:bg-[#151528] transition-colors"
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-black font-bold text-sm"
                            style={{ backgroundColor: dancer.color || '#00d4ff' }}
                          >
                            {dancer.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-base text-gray-300 flex-1">{dancer.name}</span>
                          <Plus className="w-6 h-6 text-[#00d4ff]" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activePanel === 'dancers' && (
              <div className="space-y-2">
                {dancers.filter(d => d.is_active).length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                    <p className="text-base text-gray-500">No active dancers</p>
                  </div>
                ) : (
                  dancers.filter(d => d.is_active).map(dancer => {
                    const inRotation = rotationList.includes(dancer.id);
                    return (
                      <div
                        key={dancer.id}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0d0d1f] border border-[#1e293b]"
                      >
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-black font-bold text-sm flex-shrink-0"
                          style={{ backgroundColor: dancer.color || '#00d4ff' }}
                        >
                          {dancer.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-base font-medium text-white">{dancer.name}</p>
                          {dancer.playlist && dancer.playlist.length > 0 && (
                            <p className="text-sm text-gray-500">{dancer.playlist.length} songs</p>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            if (inRotation) {
                              boothApi.sendCommand('removeDancerFromRotation', { dancerId: dancer.id });
                            } else {
                              boothApi.sendCommand('addDancerToRotation', { dancerId: dancer.id });
                            }
                          }}
                          className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors flex-shrink-0 ${
                            inRotation
                              ? 'bg-red-500/15 text-red-400 border border-red-500/30 active:bg-red-500/25'
                              : 'bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30 active:bg-[#00d4ff]/25'
                          }`}
                        >
                          {inRotation ? '- In Rotation' : '+ Add to Rotation'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
