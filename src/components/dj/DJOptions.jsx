import React, { useState, useEffect, useCallback, useRef } from 'react';
import { djOptionsApi, musicApi } from '@/api/serverApi';
import { Settings, FolderOpen, Check, ChevronDown, Music, MonitorOff, Radio } from 'lucide-react';
import { getCurrentEnergyLevel, ENERGY_LEVELS } from '@/utils/energyLevels';
import { getApiConfig, saveApiConfig } from '@/components/apiConfig';

export default function DJOptions({ djOptions, onOptionsChange, energyOverride, onEnergyOverrideChange, audioEngineRef }) {
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
  const [clubSpecials, setClubSpecials] = useState('');
  const dropdownRef = useRef(null);
  const [musicEq, setMusicEq] = useState(() => JSON.parse(localStorage.getItem('neonaidj_music_eq') || '{"bass":0,"mid":0,"treble":0}'));
  const [voiceEq, setVoiceEq] = useState(() => JSON.parse(localStorage.getItem('neonaidj_voice_eq') || '{"bass":0,"mid":0,"treble":0}'));
  const [beatMatchEnabled, setBeatMatchEnabled] = useState(() => localStorage.getItem('neonaidj_beat_match') === 'true');
  const [commercialFreq, setCommercialFreq] = useState(() => localStorage.getItem('neonaidj_commercial_freq') || 'off');
  const [commercialDropdownOpen, setCommercialDropdownOpen] = useState(false);
  const [commercialBrief, setCommercialBrief] = useState(() => localStorage.getItem('neonaidj_commercial_brief') || '');
  const commercialRef = useRef(null);

  const activeGenres = djOptions?.activeGenres || [];
  const musicMode = djOptions?.musicMode || 'dancer_first';

  useEffect(() => {
    musicApi.getGenres()
      .then(data => setGenres(data.genres || []))
      .catch(() => {})
      .finally(() => setLoading(false));
    const cfg = getApiConfig();
    setClubSpecials(cfg.clubSpecials || '');
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

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setFolderDropdownOpen(false);
      }
      if (commercialRef.current && !commercialRef.current.contains(e.target)) {
        setCommercialDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-[#00d4ff]" />
              <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Commercials</h3>
            </div>
            <div className="relative" ref={commercialRef}>
              <button
                onClick={() => setCommercialDropdownOpen(!commercialDropdownOpen)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  commercialFreq !== 'off'
                    ? 'bg-[#2563eb] text-white'
                    : 'bg-[#151528] text-gray-400 border border-[#1e293b] hover:text-white'
                }`}
              >
                <span>
                  {commercialFreq === 'off' ? 'Off' :
                   commercialFreq === '1' ? 'Every Set' :
                   commercialFreq === '2' ? 'Every Other Set' :
                   'Every 3rd Set'}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${commercialDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {commercialDropdownOpen && (
                <div className="absolute z-50 right-0 mt-1 bg-[#0d0d1f] border border-[#2e2e5a] rounded-xl shadow-xl min-w-[180px] overflow-hidden">
                  {[
                    { value: 'off', label: 'Off' },
                    { value: '1', label: 'Every Set' },
                    { value: '2', label: 'Every Other Set' },
                    { value: '3', label: 'Every 3rd Set' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setCommercialFreq(opt.value);
                        localStorage.setItem('neonaidj_commercial_freq', opt.value);
                        setCommercialDropdownOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-b border-[#1e293b] last:border-b-0 ${
                        commercialFreq === opt.value ? 'bg-[#2563eb]/10 text-white' : 'text-gray-300 hover:bg-[#151528]'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        commercialFreq === opt.value ? 'border-[#2563eb] bg-[#2563eb]' : 'border-gray-600'
                      }`}>
                        {commercialFreq === opt.value && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      <span className="text-sm">{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {commercialFreq === 'off'
              ? 'Commercials and promos are disabled during rotation.'
              : commercialFreq === '1'
              ? 'A promo plays between every entertainer set.'
              : commercialFreq === '2'
              ? 'A promo plays between every other entertainer set.'
              : 'A promo plays between every third entertainer set.'}
          </p>
          <div className="mt-4 pt-4 border-t border-[#1e293b]">
            <label className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-2 block">Event Brief</label>
            <textarea
              value={commercialBrief}
              onChange={(e) => {
                setCommercialBrief(e.target.value);
                localStorage.setItem('neonaidj_commercial_brief', e.target.value);
              }}
              placeholder={"Ladies Night - Friday March 21st\nDoors at 9pm - No cover before 10\n$5 cocktails all night\nDJ Blaze spinning the hottest hits\nVIP sections available"}
              rows={4}
              className="w-full bg-[#151528] border border-[#1e293b] text-white text-sm rounded-lg px-3 py-2 resize-none placeholder-gray-600 focus:outline-none focus:border-[#00d4ff]/50"
            />
            <p className="text-xs text-gray-600 mt-1">Event name, date, time, specials, details — used to generate promos in the Announcements tab</p>
          </div>
        </div>

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
                  Entertainer First
                </p>
                <p className="text-sm text-gray-400 mt-0.5">
                  Play each entertainer's saved playlist. Selected folders are used as fallback when an entertainer has no songs or all songs are on cooldown.
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
                  Ignore entertainer playlists. All songs come from the selected folders below only.
                </p>
              </div>
            </button>
          </div>
        </div>

        <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Active Music Folders</h3>
              <p className="text-xs text-gray-500 mt-1">
                {activeGenres.length === 0
                  ? 'No folders selected — all folders are used'
                  : `${activeGenres.length} of ${genres.length} folder${genres.length !== 1 ? 's' : ''} selected`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white bg-[#151528] rounded-lg transition-colors"
              >
                All
              </button>
              <button
                onClick={clearAll}
                className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white bg-[#151528] rounded-lg transition-colors"
              >
                None
              </button>
            </div>
          </div>

          {genres.length === 0 ? (
            <div className="text-center py-6">
              <FolderOpen className="w-6 h-6 text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No music folders found</p>
              <p className="text-xs text-gray-600 mt-1">Set your music path in Configuration first</p>
            </div>
          ) : (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setFolderDropdownOpen(!folderDropdownOpen)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border bg-[#151528] border-[#1e293b] hover:border-[#2e2e5a] text-left transition-colors"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <FolderOpen className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <span className="text-sm text-gray-300 truncate">
                    {activeGenres.length === 0
                      ? 'All folders (tap to select)'
                      : activeGenres.length <= 3
                        ? activeGenres.join(', ')
                        : `${activeGenres.slice(0, 2).join(', ')} +${activeGenres.length - 2} more`}
                  </span>
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ${folderDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {folderDropdownOpen && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-[#0d0d1f] border border-[#2e2e5a] rounded-xl shadow-xl max-h-64 overflow-auto">
                  {genres.map(g => {
                    const isActive = activeGenres.includes(g.name);
                    return (
                      <button
                        key={g.name}
                        onClick={() => toggleGenre(g.name)}
                        disabled={saving}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-b border-[#1e293b] last:border-b-0 ${
                          isActive ? 'bg-[#2563eb]/10' : 'hover:bg-[#151528]'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                          isActive ? 'border-[#2563eb] bg-[#2563eb]' : 'border-gray-600'
                        }`}>
                          {isActive && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <span className={`text-sm flex-1 ${isActive ? 'text-white font-medium' : 'text-gray-300'}`}>
                          {g.name || '(Root folder)'}
                        </span>
                        <span className="text-[10px] text-gray-500">{g.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeGenres.length === 0 && genres.length > 0 && (
            <p className="text-xs text-gray-600 mt-3 text-center">
              When no folders are selected, the system pulls from all available music.
            </p>
          )}
        </div>
      </div>

      <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-5">
        <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider mb-3">Club Specials</h3>
        <textarea
          value={clubSpecials}
          onChange={(e) => {
            setClubSpecials(e.target.value);
            saveApiConfig({ clubSpecials: e.target.value });
          }}
          placeholder={"2-for-1 drinks until midnight\nVIP bottle service special\nHalf-price private dances"}
          rows={3}
          className="w-full bg-[#151528] border border-[#1e293b] text-white text-sm rounded-md px-3 py-2 resize-none"
        />
        <p className="text-xs text-gray-500 mt-1">One per line — the DJ will weave these into announcements naturally</p>
      </div>

      <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-[#00d4ff]" />
            <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Beat Matching</h3>
          </div>
          <button
            onClick={() => {
              const next = !beatMatchEnabled;
              setBeatMatchEnabled(next);
              audioEngineRef?.current?.setBeatMatch?.(next);
            }}
            className={`relative w-11 h-6 rounded-full transition-colors ${beatMatchEnabled ? 'bg-[#00d4ff]' : 'bg-[#1e293b]'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${beatMatchEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {beatMatchEnabled
            ? 'During crossfades, the incoming track tempo adjusts to match the outgoing track then gradually returns to normal speed.'
            : 'Off — songs crossfade at their natural tempos.'}
        </p>
      </div>

      <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-5">
        <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider mb-4">Music EQ</h3>
        <div className="space-y-3">
          {[
            { band: 'bass', label: 'Bass', sublabel: '200 Hz' },
            { band: 'mid', label: 'Mid', sublabel: '1 kHz' },
            { band: 'treble', label: 'Treble', sublabel: '4 kHz' },
          ].map(({ band, label, sublabel }) => (
            <div key={band} className="flex items-center gap-3">
              <div className="w-16 flex-shrink-0">
                <span className="text-sm text-white font-medium">{label}</span>
                <span className="text-[10px] text-gray-500 block">{sublabel}</span>
              </div>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={musicEq[band]}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setMusicEq(prev => ({ ...prev, [band]: val }));
                  audioEngineRef?.current?.setMusicEq?.(band, val);
                }}
                className="flex-1 h-2 accent-[#00d4ff]"
              />
              <span className="w-10 text-right text-xs font-mono text-gray-400">
                {musicEq[band] > 0 ? '+' : ''}{musicEq[band]} dB
              </span>
            </div>
          ))}
          <button
            onClick={() => {
              const flat = { bass: 0, mid: 0, treble: 0 };
              setMusicEq(flat);
              ['bass', 'mid', 'treble'].forEach(b => audioEngineRef?.current?.setMusicEq?.(b, 0));
            }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors mt-1"
          >
            Reset to flat
          </button>
        </div>
      </div>

      <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-5">
        <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider mb-4">Voice EQ</h3>
        <div className="space-y-3">
          {[
            { band: 'bass', label: 'Bass', sublabel: '200 Hz' },
            { band: 'mid', label: 'Mid', sublabel: '1 kHz' },
            { band: 'treble', label: 'Treble', sublabel: '4 kHz' },
          ].map(({ band, label, sublabel }) => (
            <div key={band} className="flex items-center gap-3">
              <div className="w-16 flex-shrink-0">
                <span className="text-sm text-white font-medium">{label}</span>
                <span className="text-[10px] text-gray-500 block">{sublabel}</span>
              </div>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={voiceEq[band]}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setVoiceEq(prev => ({ ...prev, [band]: val }));
                  audioEngineRef?.current?.setVoiceEq?.(band, val);
                }}
                className="flex-1 h-2 accent-[#00d4ff]"
              />
              <span className="w-10 text-right text-xs font-mono text-gray-400">
                {voiceEq[band] > 0 ? '+' : ''}{voiceEq[band]} dB
              </span>
            </div>
          ))}
          <button
            onClick={() => {
              const flat = { bass: 0, mid: 0, treble: 0 };
              setVoiceEq(flat);
              ['bass', 'mid', 'treble'].forEach(b => audioEngineRef?.current?.setVoiceEq?.(b, 0));
            }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors mt-1"
          >
            Reset to flat
          </button>
        </div>
      </div>

      <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-5">
        <button
          onClick={async () => {
            if (!confirm('Exit kiosk mode? The browser will close. You can relaunch from the Pi desktop or via SSH.')) return;
            try {
              const token = sessionStorage.getItem('djbooth_token');
              await fetch('/api/kiosk/exit', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { Authorization: `Bearer ${token}` } : {})
                }
              });
            } catch {}
          }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors text-sm font-medium"
        >
          <MonitorOff className="w-4 h-4" />
          Exit Kiosk Mode
        </button>
        <p className="text-xs text-gray-500 mt-2 text-center">Closes the fullscreen browser. Relaunch from Pi desktop or via SSH.</p>
      </div>

    </div>
  );
}
