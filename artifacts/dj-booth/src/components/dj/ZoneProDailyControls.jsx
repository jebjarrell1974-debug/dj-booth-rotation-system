import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { zoneProApi } from '@/api/serverApi';
import { VolumeX, Volume2, Radio, Activity, AlertTriangle, RotateCcw } from 'lucide-react';

export default function ZoneProDailyControls() {
  const queryClient = useQueryClient();
  const [pendingControls, setPendingControls] = useState({});
  const [controlErrors, setControlErrors] = useState({});
  const [localVolumes, setLocalVolumes] = useState({});

  const { data: statusData, isLoading, error } = useQuery({
    queryKey: ['zonepro-status'],
    queryFn: zoneProApi.getStatus,
    refetchInterval: 3000,
  });

  const controlMutation = useMutation({
    mutationFn: zoneProApi.control,
    onMutate: async (variables) => {
      const requestId = Date.now().toString();
      setPendingControls(prev => ({ ...prev, [variables.zoneId + variables.action]: true }));
      setControlErrors(prev => {
        const next = { ...prev };
        delete next[variables.zoneId + variables.action];
        return next;
      });
      return { requestId, variables };
    },
    onSuccess: (data, variables, context) => {
      setPendingControls(prev => {
        const next = { ...prev };
        delete next[variables.zoneId + variables.action];
        return next;
      });
      if (variables.action === 'volume') {
        setLocalVolumes(prev => {
          const next = { ...prev };
          delete next[variables.zoneId];
          return next;
        });
      }
      queryClient.invalidateQueries({ queryKey: ['zonepro-status'] });
    },
    onError: (err, variables, context) => {
      setPendingControls(prev => {
        const next = { ...prev };
        delete next[variables.zoneId + variables.action];
        return next;
      });
      if (variables.action === 'volume') {
        setLocalVolumes(prev => {
          const next = { ...prev };
          delete next[variables.zoneId];
          return next;
        });
      }
      setControlErrors(prev => ({
        ...prev,
        [variables.zoneId + variables.action]: err.message || 'Failed'
      }));
    }
  });

  const handleControl = (zoneId, action, value) => {
    if (action === 'volume') {
      setLocalVolumes(prev => ({ ...prev, [zoneId]: value }));
    }
    controlMutation.mutate({ zoneId, action, value, requestId: Date.now().toString() });
  };

  if (isLoading && !statusData) {
    return (
      <div className="flex h-full items-center justify-center text-[#00d4ff]">
        <Activity className="w-8 h-8 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-red-500 gap-4">
        <AlertTriangle className="w-12 h-12" />
        <p className="font-bold text-lg">DSP Connection Error</p>
        <p className="text-sm">{error.message}</p>
        <button 
          onClick={() => queryClient.invalidateQueries({ queryKey: ['zonepro-status'] })}
          className="flex items-center gap-2 px-4 py-2 bg-[#1e293b] rounded-lg text-white hover:bg-[#2e3b4e] transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Retry Connection
        </button>
      </div>
    );
  }

  const { health, identityConfirmed, configuration, qualification, safetyLimits } = statusData || {};
  const endpointReachable = health === 'reachable';
  const canWrite = qualification?.writeQualified === true;
  const zones = configuration?.outputs || configuration?.zones || [];
  const inputs = configuration?.inputs || [];
  const noUnit = !statusData?.primaryUnitId && (!statusData?.units || statusData.units.length === 0);

  if (noUnit) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-gray-500 gap-4">
        <Radio className="w-12 h-12 opacity-50" />
        <p className="font-bold text-lg">No Audio Zones Configured</p>
        <p className="text-sm">Configure a DSP in the settings to enable live zone control.</p>
      </div>
    );
  }

  const safeMin = safetyLimits?.minVolumeDb ?? -80;
  const safeMax = safetyLimits?.maxVolumeDb ?? 0;

  return (
    <div className="h-full flex flex-col bg-[#08081a] text-white p-4">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start md:items-end gap-4 mb-6 pb-4 border-b border-[#1e293b] shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-[#00d4ff] flex items-center gap-2 tracking-wide uppercase">
            <Radio className="w-6 h-6" />
            Audio Zones
          </h2>
          <p className="text-sm text-gray-500 mt-1">Live Sound Control Surface</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:gap-4">
          {!canWrite && (
            <div className="flex items-center gap-2 text-red-500 bg-red-500/10 px-3 py-1.5 rounded text-sm font-semibold border border-red-500/20">
              <AlertTriangle className="w-4 h-4" />
              {qualification?.reason || 'Write Disabled'}
            </div>
          )}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded font-bold text-sm uppercase tracking-wider ${endpointReachable ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
            <div className={`w-2 h-2 rounded-full ${endpointReachable ? 'bg-amber-300' : 'bg-red-500'}`} />
            {endpointReachable
              ? identityConfirmed ? 'DSP Identity Confirmed' : 'TCP Reachable / Identity Unconfirmed'
              : 'TCP Endpoint Unreachable'}
          </div>
        </div>
      </div>

      {/* Zones Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 overflow-y-auto pb-8 pr-2">
        {zones.map(zone => {
          const isPendingVol = pendingControls[zone.id + 'volume'];
          const isPendingMute = pendingControls[zone.id + 'mute'];
          const isPendingSrc = pendingControls[zone.id + 'source'];
          const volError = controlErrors[zone.id + 'volume'];
          const displayVolume = localVolumes[zone.id] !== undefined ? localVolumes[zone.id] : (zone.volume !== undefined ? zone.volume : safeMin);
          
          return (
            <div key={zone.id} className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl p-5 relative group transition-all hover:border-[#00d4ff]/30">
              {/* Zone Header */}
              <div className="flex justify-between items-center mb-6">
                <div>
                  <div className="text-[#00d4ff] text-xs font-mono mb-1 opacity-70">OUTPUT {zone.id}</div>
                  <h3 className="text-xl font-bold uppercase tracking-wide truncate max-w-[200px]">{zone.name || `Zone ${zone.id}`}</h3>
                </div>
                <button
                  onClick={() => handleControl(zone.id, 'mute', !zone.muted)}
                  disabled={!canWrite || isPendingMute}
                  className={`w-14 h-14 rounded-xl flex items-center justify-center transition-all shrink-0 ${
                    zone.muted 
                      ? 'bg-red-500/20 text-red-500 border border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
                      : 'bg-[#1e293b] text-emerald-400 border border-[#2e3b4e] hover:border-emerald-500/50'
                  } disabled:opacity-50`}
                >
                  {isPendingMute ? <Activity className="w-6 h-6 animate-spin" /> : (zone.muted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />)}
                </button>
              </div>

              {/* Volume Slider */}
              <div className="mb-6 relative">
                <div className="flex justify-between text-xs text-gray-500 mb-2 font-mono">
                  <span>{safeMin}dB</span>
                  <span className={volError ? 'text-red-500' : 'text-[#00d4ff]'}>
                    {isPendingVol ? '...' : `${displayVolume}dB`}
                  </span>
                  <span>{safeMax}dB</span>
                </div>
                <div className="relative h-6 flex items-center group/slider">
                  <input
                    type="range"
                    min={safeMin}
                    max={safeMax}
                    step="0.5"
                    value={displayVolume}
                    onChange={(e) => setLocalVolumes(prev => ({ ...prev, [zone.id]: parseFloat(e.target.value) }))}
                    onPointerUp={(e) => handleControl(zone.id, 'volume', parseFloat(e.target.value))}
                    onKeyUp={(e) => handleControl(zone.id, 'volume', parseFloat(e.target.value))}
                    disabled={!canWrite || isPendingVol}
                    className="w-full h-3 bg-[#151528] rounded-full appearance-none cursor-pointer z-10 opacity-0 absolute inset-0"
                  />
                  <div className="w-full h-3 bg-[#151528] rounded-full pointer-events-none absolute inset-0 overflow-hidden">
                    <div 
                      className="h-full bg-[#00d4ff] transition-all"
                      style={{ width: `${(parseFloat(displayVolume) - safeMin) / (safeMax - safeMin) * 100}%` }}
                    />
                  </div>
                  <div 
                    className="w-5 h-5 bg-white rounded-full absolute pointer-events-none shadow-md z-20 top-1/2 -translate-y-1/2 transition-transform group-hover/slider:scale-110"
                    style={{ left: `calc(${(parseFloat(displayVolume) - safeMin) / (safeMax - safeMin) * 100}% - 10px)` }}
                  />
                </div>
                {volError && <div className="absolute -bottom-5 left-0 text-xs text-red-500 truncate max-w-full">{volError}</div>}
              </div>

              {/* Source Selection */}
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block font-semibold">Source Route</label>
                <div className="relative">
                  <select
                    value={zone.sourceId || ''}
                    onChange={(e) => handleControl(zone.id, 'source', e.target.value)}
                    disabled={!canWrite || isPendingSrc}
                    className="w-full bg-[#151528] border border-[#2e3b4e] text-white text-sm rounded-lg px-3 py-3 appearance-none focus:outline-none focus:border-[#00d4ff] disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <option value="" disabled>Select Source...</option>
                    {inputs.map(inp => (
                      <option key={inp.id} value={inp.id}>{inp.name || `Input ${inp.id}`}</option>
                    ))}
                  </select>
                  {isPendingSrc ? (
                    <Activity className="w-4 h-4 text-[#00d4ff] absolute right-3 top-3.5 animate-spin pointer-events-none" />
                  ) : (
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500">
                      <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
