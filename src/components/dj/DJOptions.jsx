import React, { useState, useEffect, useCallback } from 'react';
import { djOptionsApi, musicApi } from '@/api/serverApi';
import { Settings, FolderOpen, Check, Wifi } from 'lucide-react';
import { getCurrentEnergyLevel, ENERGY_LEVELS } from '@/utils/energyLevels';
import { getApiConfig, saveApiConfig } from '@/components/apiConfig';

export default function DJOptions({ djOptions, onOptionsChange, energyOverride, onEnergyOverrideChange }) {
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serverIps, setServerIps] = useState([]);

  const activeGenres = djOptions?.activeGenres || [];
  const musicMode = djOptions?.musicMode || 'dancer_first';

  useEffect(() => {
    musicApi.getGenres()
      .then(data => setGenres(data.genres || []))
      .catch(() => {})
      .finally(() => setLoading(false));
    fetch('/api/server-info')
      .then(r => r.json())
      .then(data => setServerIps(data.ips || []))
      .catch(() => {});
  }, []);

  const saveOptions = useCallback(async (updates) => {
    setSaving(true);
    try {
      const newOptions = { ...djOptions, ...updates };
      await djOptionsApi.update(updates);
      onOptionsChange(newOptions);
    } catch (err) {
      console.error('Failed to save DJ options:', err);
    }
    setSaving(false);
  }, [djOptions, onOptionsChange]);

  const toggleGenre = useCallback((folderName) => {
    const current = [...activeGenres];
    const idx = current.indexOf(folderName);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(folderName);
    }
    saveOptions({ activeGenres: current });
  }, [activeGenres, saveOptions]);

  const selectAll = useCallback(() => {
    saveOptions({ activeGenres: genres.map(g => g.name) });
  }, [genres, saveOptions]);

  const clearAll = useCallback(() => {
    saveOptions({ activeGenres: [] });
  }, [saveOptions]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">Loading options...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto space-y-6">
        {energyOverride !== undefined && onEnergyOverrideChange && (() => {
          const config = getApiConfig();
          const level = getCurrentEnergyLevel({ ...config, energyOverride });
          const info = ENERGY_LEVELS[level];
          return (
            <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-5">
              <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider mb-4">Energy Level</h3>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  {['auto', '1', '2', '3', '4', '5'].map(val => {
                    const isActive = energyOverride === val;
                    const label = val === 'auto' ? 'Auto' : `L${val}`;
                    const levelInfo = val === 'auto' ? info : ENERGY_LEVELS[parseInt(val)];
                    const btnColor = isActive ? levelInfo.color : undefined;
                    return (
                      <button
                        key={val}
                        onClick={() => {
                          onEnergyOverrideChange(val);
                          saveApiConfig({ energyOverride: val });
                        }}
                        className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                          isActive
                            ? 'text-black'
                            : 'bg-[#151528] text-gray-400 hover:text-white border border-[#1e293b]'
                        }`}
                        style={isActive ? { backgroundColor: btnColor } : undefined}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border ml-auto" style={{ borderColor: info.color + '50', backgroundColor: info.color + '10' }}>
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: info.color }} />
                  <span className="text-xs font-medium" style={{ color: info.color }}>{info.name}</span>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-5">
          <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider mb-4">Music Selection Mode</h3>
          <div className="space-y-3">
            <button
              onClick={() => saveOptions({ musicMode: 'dancer_first' })}
              className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl border text-left transition-colors ${
                musicMode === 'dancer_first'
                  ? 'bg-[#00d4ff]/10 border-[#00d4ff]/40'
                  : 'bg-[#151528] border-[#1e293b] hover:border-[#2e2e5a]'
              }`}
            >
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                musicMode === 'dancer_first' ? 'border-[#00d4ff] bg-[#00d4ff]' : 'border-gray-600'
              }`}>
                {musicMode === 'dancer_first' && <Check className="w-4 h-4 text-black" />}
              </div>
              <div>
                <p className={`text-base font-semibold ${musicMode === 'dancer_first' ? 'text-[#00d4ff]' : 'text-white'}`}>
                  Dancer First
                </p>
                <p className="text-sm text-gray-400 mt-0.5">
                  Play each dancer's saved playlist. Selected folders are used as fallback when a dancer has no songs or all songs are on cooldown.
                </p>
              </div>
            </button>
            <button
              onClick={() => saveOptions({ musicMode: 'folders_only' })}
              className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl border text-left transition-colors ${
                musicMode === 'folders_only'
                  ? 'bg-[#00d4ff]/10 border-[#00d4ff]/40'
                  : 'bg-[#151528] border-[#1e293b] hover:border-[#2e2e5a]'
              }`}
            >
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                musicMode === 'folders_only' ? 'border-[#00d4ff] bg-[#00d4ff]' : 'border-gray-600'
              }`}>
                {musicMode === 'folders_only' && <Check className="w-4 h-4 text-black" />}
              </div>
              <div>
                <p className={`text-base font-semibold ${musicMode === 'folders_only' ? 'text-[#00d4ff]' : 'text-white'}`}>
                  Folders Only
                </p>
                <p className="text-sm text-gray-400 mt-0.5">
                  Ignore dancer playlists. All songs come from the selected folders below only.
                </p>
              </div>
            </button>
          </div>
        </div>

        <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Active Music Folders</h3>
              <p className="text-xs text-gray-500 mt-1">
                {activeGenres.length === 0
                  ? 'No folders selected — all folders are used'
                  : `${activeGenres.length} folder${activeGenres.length !== 1 ? 's' : ''} selected`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white bg-[#151528] rounded-lg transition-colors"
              >
                Select All
              </button>
              <button
                onClick={clearAll}
                className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white bg-[#151528] rounded-lg transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>

          {genres.length === 0 ? (
            <div className="text-center py-8">
              <FolderOpen className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No music folders found</p>
              <p className="text-xs text-gray-600 mt-1">Set your music path in Configuration first</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {genres.map(g => {
                const isActive = activeGenres.includes(g.name);
                return (
                  <button
                    key={g.name}
                    onClick={() => toggleGenre(g.name)}
                    disabled={saving}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
                      isActive
                        ? 'bg-[#2563eb]/10 border-[#2563eb]/40'
                        : 'bg-[#151528] border-[#1e293b] hover:border-[#2e2e5a]'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      isActive ? 'border-[#2563eb] bg-[#2563eb]' : 'border-gray-600'
                    }`}>
                      {isActive && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <FolderOpen className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-[#2563eb]' : 'text-gray-500'}`} />
                    <span className={`text-sm font-medium flex-1 ${isActive ? 'text-white' : 'text-gray-300'}`}>
                      {g.name || '(Root folder)'}
                    </span>
                    <span className="text-xs text-gray-500">{g.count} tracks</span>
                  </button>
                );
              })}
            </div>
          )}

          {activeGenres.length === 0 && genres.length > 0 && (
            <p className="text-xs text-gray-600 mt-3 text-center">
              When no folders are selected, the system pulls from all available music.
            </p>
          )}
        </div>
      </div>

      {serverIps.length > 0 && (
        <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-5">
          <div className="flex items-center gap-2 mb-3">
            <Wifi className="w-4 h-4 text-[#2563eb]" />
            <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Remote Connection</h3>
          </div>
          <p className="text-xs text-gray-500 mb-3">Enter this IP on the iPad to connect as DJ Remote</p>
          {serverIps.map((ip, i) => (
            <div key={i} className="flex items-center justify-between py-2 px-3 bg-[#151528] rounded-lg mb-2 last:mb-0">
              <span className="text-xs text-gray-400">{ip.interface}</span>
              <span className="text-lg font-mono font-bold text-white">{ip.address}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
