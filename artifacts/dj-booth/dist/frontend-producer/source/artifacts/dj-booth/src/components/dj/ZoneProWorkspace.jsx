import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { zoneProApi } from '@/api/serverApi';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Activity, Radio, AlertTriangle, CheckCircle2, RotateCcw, Upload, Download, Copy, Save, Network, RefreshCw, Cpu, Check, X, ShieldAlert, Sliders } from 'lucide-react';
import { toast } from 'sonner';

export default function ZoneProWorkspace() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('status');
  const [editedConfig, setEditedConfig] = useState(null);
  
  // Modals state
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planResult, setPlanResult] = useState(null);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  
  // Hardware status
  const { data: statusData, isLoading: statusLoading, error: statusError, refetch: refetchStatus } = useQuery({
    queryKey: ['zonepro-status'],
    queryFn: zoneProApi.getStatus,
    refetchInterval: 5000,
  });

  // Connection settings
  const { data: settingsData, isLoading: settingsLoading } = useQuery({
    queryKey: ['zonepro-settings'],
    queryFn: zoneProApi.getSettings,
  });

  const saveSettings = useMutation({
    mutationFn: zoneProApi.saveSettings,
    onSuccess: () => {
      toast.success('Connection settings saved');
      queryClient.invalidateQueries({ queryKey: ['zonepro-settings'] });
      refetchStatus();
    },
    onError: (err) => toast.error(`Save failed: ${err.message}`)
  });

  const testConnection = useMutation({
    mutationFn: zoneProApi.testConnection,
    onSuccess: (data) => toast.success(data?.identityConfirmed
      ? 'ZonePRO identity confirmed'
      : 'TCP endpoint reachable; ZonePRO identity is not yet confirmed'),
    onError: (err) => toast.error(`Connection test failed: ${err.message}`)
  });

  const discover = useMutation({
    mutationFn: zoneProApi.discover,
    onSuccess: (data) => toast.success(
      `Discovery complete: ${data?.devices?.filter(device => device.reachable).length || 0} saved endpoint(s) reachable; identity not confirmed`
    ),
    onError: (err) => toast.error(`Discovery failed: ${err.message}`)
  });

  const readConfig = useMutation({
    mutationFn: zoneProApi.readConfiguration,
    onSuccess: (data) => {
      toast.success('Configuration read successfully');
      setEditedConfig(data.configuration);
      refetchStatus();
    },
    onError: (err) => toast.error(`Read failed: ${err.message}`)
  });

  const planConfig = useMutation({
    mutationFn: (variables) => zoneProApi.planConfiguration(variables.configuration, variables.expectedRevision, variables.current),
    onSuccess: (data) => {
      setPlanResult(data);
      setPlanModalOpen(true);
    },
    onError: (err) => toast.error(`Plan failed: ${err.message}`)
  });

  const applyConfig = useMutation({
    mutationFn: zoneProApi.applyConfiguration,
    onSuccess: () => {
      toast.success('Configuration applied successfully');
      setPlanModalOpen(false);
      setPlanResult(null);
      refetchStatus();
    },
    onError: (err) => toast.error(`Apply failed: ${err.message}`)
  });

  const listSnapshots = useQuery({
    queryKey: ['zonepro-snapshots'],
    queryFn: zoneProApi.listSnapshots,
    enabled: snapshotModalOpen
  });

  const [restorePlan, setRestorePlan] = useState(null);
  const [restoreSnapshotId, setRestoreSnapshotId] = useState(null);

  const planRestore = useMutation({
    mutationFn: ({ configuration }) =>
      zoneProApi.planConfiguration(configuration, statusData?.revision, statusData?.configuration),
    onSuccess: (data, variables) => {
      setRestoreSnapshotId(variables.snapshotId);
      setRestorePlan(data);
    },
    onError: (err) => toast.error(`Restore plan failed: ${err.message}`)
  });
  
  const restoreSnapshot = useMutation({
    mutationFn: zoneProApi.restoreSnapshot,
    onSuccess: () => {
      toast.success('Snapshot restored');
      setSnapshotModalOpen(false);
      setRestorePlan(null);
      setRestoreSnapshotId(null);
      refetchStatus();
    },
    onError: (err) => toast.error(`Restore failed: ${err.message}`)
  });
  
  const importSnapshot = useMutation({
    mutationFn: zoneProApi.importSnapshot,
    onSuccess: () => {
      toast.success('Snapshot imported');
      queryClient.invalidateQueries({ queryKey: ['zonepro-snapshots'] });
    },
    onError: (err) => toast.error(`Import failed: ${err.message}`)
  });

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const snap = JSON.parse(ev.target.result);
        importSnapshot.mutate(snap);
      } catch (err) {
        toast.error('Invalid JSON file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Ensure editedConfig is populated from status if available and we don't have edits
  useEffect(() => {
    if (statusData?.configuration && !editedConfig) {
      setEditedConfig(statusData.configuration);
    }
  }, [statusData, editedConfig]);

  const handleUpdateSetting = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    saveSettings.mutate({
      name: fd.get('name'),
      ip: fd.get('ip'),
      port: fd.get('port'),
      model: fd.get('model'),
      firmware: fd.get('firmware'),
      minVolumeDb: Number(fd.get('minVolumeDb')),
      maxVolumeDb: Number(fd.get('maxVolumeDb')),
      autoConnect: fd.get('autoConnect') === 'true',
      enabled: fd.get('enabled') === 'on'
    });
  };

  const handleApplyConfig = () => {
    applyConfig.mutate({
      planId: planResult?.planId || planResult?.id,
      confirmationToken: planResult?.confirmationToken
    });
  };

  const noUnit = !statusData?.primaryUnitId && (!statusData?.units || statusData.units.length === 0);

  useEffect(() => {
    if (noUnit && activeTab !== 'connection') {
      setActiveTab('connection');
    }
  }, [noUnit, activeTab]);

  if (statusError) {
    return (
      <div className="h-96 flex flex-col items-center justify-center text-red-500 gap-4">
        <AlertTriangle className="w-12 h-12" />
        <p className="font-bold text-lg">DSP Connection Error</p>
        <p className="text-sm">{statusError.message}</p>
        <Button onClick={() => refetchStatus()} className="mt-4 bg-[#1e293b] text-white">Retry Connection</Button>
      </div>
    );
  }

  if (statusLoading && !statusData) {
    return <div className="h-96 flex items-center justify-center text-[#00d4ff]"><Activity className="w-8 h-8 animate-pulse" /></div>;
  }

  const { health, identityConfirmed, device, qualification, capabilities, configuration: currentConfig } = statusData || {};
  const endpointReachable = health === 'reachable';
  const canWrite = qualification?.writeQualified === true;
  const safeMin = statusData?.safetyLimits?.minVolumeDb ?? -80;
  const safeMax = statusData?.safetyLimits?.maxVolumeDb ?? 0;

  return (
    <div className="bg-[#08081a] border border-[#1e293b] rounded-xl text-white flex flex-col h-[800px] max-h-[80vh] font-mono">
      {/* Top toolbar */}
      <div className="flex flex-shrink-0 items-center justify-between p-4 border-b border-[#1e293b] bg-[#0a0a1a] rounded-t-xl">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-[#00d4ff]/10 flex items-center justify-center border border-[#00d4ff]/30">
            <Radio className="w-5 h-5 text-[#00d4ff]" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-wide uppercase">ZonePRO Designer</h2>
            <div className="flex items-center gap-3 text-xs mt-1">
              <span className="text-gray-400">Status:</span>
              <span className={`font-bold flex items-center gap-1 ${endpointReachable ? 'text-amber-300' : 'text-red-500'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${endpointReachable ? 'bg-amber-300' : 'bg-red-500'}`} />
                {noUnit ? 'NOT CONFIGURED' : endpointReachable ? 'TCP ENDPOINT REACHABLE' : 'TCP ENDPOINT UNREACHABLE'}
              </span>
              {device?.model && (
                <>
                  <span className="text-gray-600">|</span>
                  <span className="text-[#00d4ff]">{device.model} v{device.firmware}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!canWrite && (
            <div className="bg-red-500/10 text-red-500 border border-red-500/30 px-3 py-1.5 rounded flex items-center gap-2 text-xs font-bold mr-2">
              <ShieldAlert className="w-4 h-4" />
              {qualification?.reason || 'READ ONLY'}
            </div>
          )}
          <Button 
            variant="outline" 
            size="sm" 
            className="border-[#1e293b] bg-transparent text-gray-300 hover:text-white hover:bg-[#1e293b]"
            onClick={() => setSnapshotModalOpen(true)}
          >
            <Copy className="w-4 h-4 mr-2" /> Snapshots
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="border-[#1e293b] bg-transparent text-[#00d4ff] hover:text-[#33e0ff] hover:bg-[#1e293b]"
            onClick={() => readConfig.mutate()}
            disabled={!endpointReachable || qualification?.readQualified !== true || readConfig.isPending}
          >
            {readConfig.isPending ? <Activity className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Read HW
          </Button>
          <Button 
            size="sm" 
            className="bg-[#00d4ff] hover:bg-[#00a3cc] text-black font-bold"
            disabled={!endpointReachable || !canWrite || planConfig.isPending || !editedConfig}
            onClick={() => planConfig.mutate({ configuration: editedConfig, expectedRevision: statusData?.revision, current: statusData?.configuration })}
          >
            {planConfig.isPending ? <Activity className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Apply Changes
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Vertical Tabs Sidebar */}
        <div className="w-48 flex-shrink-0 bg-[#0a0a1a] border-r border-[#1e293b] overflow-y-auto">
          {[
            { id: 'status', label: 'Overview', icon: Activity },
            { id: 'connection', label: 'Connection', icon: Network },
            { id: 'routing', label: 'Routing Matrix', icon: Radio },
            { id: 'inputs', label: 'Input DSP', icon: Sliders },
            { id: 'outputs', label: 'Output DSP', icon: Sliders },
            { id: 'eq', label: 'EQ', icon: Sliders },
            { id: 'filters', label: 'Filters/Crossovers', icon: Sliders },
            { id: 'dynamics', label: 'Dynamics', icon: Activity },
            { id: 'delays', label: 'Delays', icon: Activity },
            { id: 'schedules', label: 'Schedules', icon: Activity },
            { id: 'presets', label: 'Presets', icon: Copy },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors border-l-2 ${
                activeTab === t.id 
                  ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff] font-bold' 
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-[#151528]'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#08081a]">
          {activeTab === 'status' && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold uppercase tracking-widest text-gray-300">Device Overview</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#0d0d1f] p-4 rounded-lg border border-[#1e293b]">
                  <div className="text-xs text-gray-500 uppercase mb-2">Configured Endpoint Metadata</div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-gray-400">Configured Model:</span>
                    <span className="text-white">{device?.model || 'Unknown'}</span>
                    <span className="text-gray-400">Entered Firmware:</span>
                    <span className="text-white">{device?.firmware || 'Unknown'}</span>
                    <span className="text-gray-400">Endpoint Name:</span>
                    <span className="text-white">{device?.name || 'Unknown'}</span>
                    <span className="text-gray-400">Identity Verified:</span>
                    <span className={identityConfirmed ? 'text-emerald-400' : 'text-amber-300'}>{identityConfirmed ? 'Yes' : 'No'}</span>
                    <span className="text-gray-400">Revision:</span>
                    <span className="text-white">{statusData?.revision || 0}</span>
                  </div>
                </div>
                <div className="bg-[#0d0d1f] p-4 rounded-lg border border-[#1e293b]">
                  <div className="text-xs text-gray-500 uppercase mb-2">Capabilities</div>
                  {capabilities ? (
                    <div className="flex flex-wrap gap-2">
                      {Object.keys(capabilities).filter(k => capabilities[k]).map(cap => (
                        <span key={cap} className="px-2 py-1 bg-[#151528] rounded text-xs text-emerald-400 border border-[#2e3b4e]">
                          {cap}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-500">Not available</span>
                  )}
                </div>
              </div>
              <div className="bg-[#0d0d1f] p-4 rounded-lg border border-[#1e293b]">
                <div className="text-xs text-gray-500 uppercase mb-2">Current Warnings</div>
                {!qualification?.writeQualified ? (
                  <div className="text-red-400 text-sm flex items-start gap-2 bg-red-500/10 p-3 rounded border border-red-500/20">
                    <ShieldAlert className="w-5 h-5 shrink-0" />
                    <div>
                      <div className="font-bold">Write Lock Active</div>
                      <div className="text-gray-400">{qualification?.reason}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500 text-sm">No warnings. System is fully operational.</div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'connection' && (
            <div className="max-w-xl space-y-6">
              <h3 className="text-xl font-bold uppercase tracking-widest text-gray-300">Connection Settings</h3>
              {settingsLoading ? (
                <Activity className="w-6 h-6 animate-spin text-[#00d4ff]" />
              ) : (
                <form onSubmit={handleUpdateSetting} className="space-y-4 bg-[#0d0d1f] p-5 rounded-lg border border-[#1e293b]">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 col-span-2">
                      <label className="text-xs text-gray-400 uppercase">Device Name</label>
                      <Input name="name" defaultValue={settingsData?.name || ''} placeholder="Main Floor DSP" className="bg-[#08081a] border-[#1e293b]" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 uppercase">IP Address</label>
                      <Input name="ip" defaultValue={settingsData?.ip || ''} placeholder="192.168.1.100" className="bg-[#08081a] border-[#1e293b]" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 uppercase">Port</label>
                      <Input name="port" defaultValue={settingsData?.port || '3804'} placeholder="3804" className="bg-[#08081a] border-[#1e293b]" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 uppercase">Model</label>
                      <select name="model" defaultValue={settingsData?.model || 'ZonePRO 640m'} className="w-full h-10 bg-[#08081a] border border-[#1e293b] rounded-md px-3 text-sm focus:outline-none focus:border-[#00d4ff]">
                        <option>ZonePRO 1260</option>
                        <option>ZonePRO 1260m</option>
                        <option>ZonePRO 1261</option>
                        <option>ZonePRO 1261m</option>
                        <option>ZonePRO 640m</option>
                        <option>ZonePRO 641m</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 uppercase">Firmware</label>
                      <Input name="firmware" defaultValue={settingsData?.firmware || ''} placeholder="2.000" className="bg-[#08081a] border-[#1e293b]" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 uppercase">Safe Min dB</label>
                      <Input name="minVolumeDb" type="number" step="0.5" defaultValue={settingsData?.minVolumeDb ?? -80} className="bg-[#08081a] border-[#1e293b]" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 uppercase">Safe Max dB</label>
                      <Input name="maxVolumeDb" type="number" step="0.5" defaultValue={settingsData?.maxVolumeDb ?? 0} className="bg-[#08081a] border-[#1e293b]" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 uppercase">Auto Connect</label>
                      <select name="autoConnect" defaultValue={String(settingsData?.autoConnect ?? true)} className="w-full h-10 bg-[#08081a] border border-[#1e293b] rounded-md px-3 text-sm focus:outline-none focus:border-[#00d4ff]">
                        <option value="true">Enabled</option>
                        <option value="false">Disabled</option>
                      </select>
                    </div>
                    <div className="space-y-2 flex flex-col justify-end">
                      <label className="flex items-center gap-2 text-sm cursor-pointer h-10 px-3 bg-[#08081a] border border-[#1e293b] rounded-md">
                        <input type="checkbox" name="enabled" defaultChecked={settingsData?.enabled ?? true} className="accent-[#00d4ff] w-4 h-4" />
                        <span className="text-gray-200">Device Enabled</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-4 border-t border-[#1e293b]">
                    <Button type="button" variant="outline" className="flex-1 bg-transparent border-[#1e293b] hover:bg-[#1e293b] text-white" onClick={() => discover.mutate()} disabled={discover.isPending}>
                      {discover.isPending ? <Activity className="w-4 h-4 mr-2 animate-spin" /> : <SearchIcon className="w-4 h-4 mr-2" />}
                      Probe Saved Endpoint
                    </Button>
                    <Button type="button" variant="outline" className="flex-1 bg-transparent border-[#1e293b] hover:bg-[#1e293b] text-white" onClick={() => testConnection.mutate()} disabled={testConnection.isPending}>
                      {testConnection.isPending ? <Activity className="w-4 h-4 mr-2 animate-spin" /> : <Network className="w-4 h-4 mr-2" />}
                      Test Link
                    </Button>
                    <Button type="submit" className="flex-1 bg-[#00d4ff] hover:bg-[#00a3cc] text-black" disabled={saveSettings.isPending}>
                      {saveSettings.isPending ? <Activity className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                      Save
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}

          {activeTab === 'routing' && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold uppercase tracking-widest text-gray-300">Routing Matrix</h3>
              {!editedConfig ? (
                <div className="text-gray-500">Read hardware configuration first to enable routing.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className="p-3 border border-[#1e293b] bg-[#151528] text-left">Outputs / Inputs</th>
                        {editedConfig.inputs?.map(inp => (
                          <th key={inp.id} className="p-3 border border-[#1e293b] bg-[#151528] text-center w-24">
                            <div className="text-xs text-[#00d4ff] font-bold">IN {inp.id}</div>
                            <div className="truncate text-xs text-gray-400">{inp.name || 'Unnamed'}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {editedConfig.outputs?.map(out => (
                        <tr key={out.id}>
                          <td className="p-3 border border-[#1e293b] bg-[#0d0d1f]">
                            <div className="text-xs text-emerald-400 font-bold">OUT {out.id}</div>
                            <div className="font-bold">{out.name || 'Unnamed'}</div>
                          </td>
                          {editedConfig.inputs?.map(inp => (
                            <td key={inp.id} className="p-3 border border-[#1e293b] bg-[#08081a] text-center">
                              <button
                                onClick={() => {
                                  setEditedConfig(prev => {
                                    const nextOutputs = [...prev.outputs];
                                    const outIdx = nextOutputs.findIndex(o => o.id === out.id);
                                    if (outIdx > -1) {
                                      nextOutputs[outIdx] = { ...nextOutputs[outIdx], sourceId: inp.id };
                                    }
                                    return { ...prev, outputs: nextOutputs };
                                  });
                                }}
                                className={`w-8 h-8 rounded flex items-center justify-center mx-auto transition-colors ${
                                  out.sourceId === inp.id ? 'bg-[#00d4ff] text-black shadow-[0_0_10px_rgba(0,212,255,0.4)]' : 'bg-[#151528] hover:bg-[#1e293b] text-gray-500'
                                }`}
                              >
                                {out.sourceId === inp.id && <Check className="w-5 h-5" />}
                              </button>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {(activeTab === 'inputs' || activeTab === 'outputs') && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold uppercase tracking-widest text-gray-300">{activeTab} DSP</h3>
              {!editedConfig ? (
                <div className="text-gray-500">Read hardware configuration first.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {(editedConfig[activeTab] || []).map(ch => (
                    <div key={ch.id} className="bg-[#0d0d1f] p-4 rounded-lg border border-[#1e293b]">
                      <div className="flex justify-between items-center mb-4">
                        <div className="font-bold uppercase text-[#00d4ff]">CH {ch.id}: {ch.name}</div>
                        <div className="text-xs font-mono text-gray-500">{ch.volume ?? 0} dB</div>
                      </div>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-xs text-gray-400">Gain</label>
                          <input
                            type="range" min={safeMin} max={safeMax} step="0.5"
                            value={ch.volume ?? 0}
                            onChange={(e) => {
                              setEditedConfig(prev => {
                                const nextArr = [...prev[activeTab]];
                                const idx = nextArr.findIndex(c => c.id === ch.id);
                                if (idx > -1) {
                                  nextArr[idx] = { ...nextArr[idx], volume: parseFloat(e.target.value) };
                                }
                                return { ...prev, [activeTab]: nextArr };
                              });
                            }}
                            className="w-full accent-[#00d4ff]"
                          />
                        </div>
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#1e293b]">
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className={`flex-1 h-8 text-xs ${ch.muted ? 'bg-red-500/20 text-red-500 border-red-500/50' : 'bg-transparent text-gray-400 border-[#1e293b]'}`}
                            onClick={() => {
                              setEditedConfig(prev => {
                                const nextArr = [...prev[activeTab]];
                                const idx = nextArr.findIndex(c => c.id === ch.id);
                                if (idx > -1) {
                                  nextArr[idx] = { ...nextArr[idx], muted: !ch.muted };
                                }
                                return { ...prev, [activeTab]: nextArr };
                              });
                            }}
                          >
                            {ch.muted ? 'MUTED' : 'MUTE'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {['eq', 'filters', 'dynamics', 'delays', 'schedules', 'presets'].includes(activeTab) && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold uppercase tracking-widest text-gray-300">{activeTab} Configuration</h3>
              <div className="text-gray-500 bg-[#0d0d1f] p-6 rounded-lg border border-[#1e293b] text-center border-dashed">
                <Sliders className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>This DSP section awaits profile qualification.</p>
                <p className="text-xs mt-1">Structured editor for {activeTab} will be available once your profile is qualified for deep DSP edits.</p>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Plan Apply Modal */}
      <Dialog open={planModalOpen} onOpenChange={setPlanModalOpen}>
        <DialogContent className="bg-[#0a0a1a] border-[#1e293b] text-white max-w-2xl font-mono">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-[#00d4ff] uppercase">Confirm Configuration Plan</DialogTitle>
            <DialogDescription className="text-gray-400">
              Review changes before writing to hardware.
            </DialogDescription>
          </DialogHeader>
          
          <div className="my-4 max-h-[400px] overflow-y-auto bg-[#08081a] p-4 rounded border border-[#1e293b]">
            {planResult?.diffs?.length > 0 ? (
              <ul className="space-y-2">
                {planResult.diffs.map((diff, i) => (
                  <li key={i} className="text-sm">
                    <span className="text-gray-500">{diff.path.join('.')}</span>: 
                    <span className="text-red-400 line-through mx-2">{JSON.stringify(diff.oldValue)}</span> 
                    → 
                    <span className="text-emerald-400 ml-2">{JSON.stringify(diff.newValue)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-gray-500 italic">No structural differences detected. Only parameters will be updated.</div>
            )}
            
            {planResult?.warnings?.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[#1e293b]">
                <h4 className="text-red-400 font-bold mb-2 flex items-center gap-2"><ShieldAlert className="w-4 h-4" /> Warnings</h4>
                <ul className="list-disc pl-5 text-sm text-red-300">
                  {planResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanModalOpen(false)} className="bg-transparent border-[#1e293b] text-white">Cancel</Button>
            <Button 
              onClick={() => handleApplyConfig()}
              className="bg-red-500 hover:bg-red-600 text-white font-bold"
              disabled={applyConfig.isPending}
            >
              {applyConfig.isPending ? <Activity className="w-4 h-4 mr-2 animate-spin" /> : 'WRITE TO HARDWARE'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Snapshots Modal */}
      <Dialog open={snapshotModalOpen} onOpenChange={setSnapshotModalOpen}>
        <DialogContent className="bg-[#0a0a1a] border-[#1e293b] text-white max-w-xl font-mono">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-[#00d4ff] uppercase">Configuration Snapshots</DialogTitle>
            <DialogDescription className="text-gray-400">
              Snapshots are stored in NEON. Imported files are unverified until a qualified hardware readback matches them.
            </DialogDescription>
          </DialogHeader>
          
          <div className="my-4">
            {restorePlan ? (
              <div className="bg-[#08081a] p-4 rounded border border-[#1e293b]">
                <h4 className="text-[#00d4ff] font-bold mb-2">Review Restore Plan</h4>
                <div className="max-h-[300px] overflow-y-auto mb-4">
                  {restorePlan.diffs?.length > 0 ? (
                    <ul className="space-y-2">
                      {restorePlan.diffs.map((diff, i) => (
                        <li key={i} className="text-sm">
                          <span className="text-gray-500">{diff.path.join('.')}</span>: 
                          <span className="text-red-400 line-through mx-2">{JSON.stringify(diff.oldValue)}</span> 
                          → 
                          <span className="text-emerald-400 ml-2">{JSON.stringify(diff.newValue)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-gray-500 italic">No structural differences detected.</div>
                  )}
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setRestorePlan(null)} className="bg-transparent border-[#1e293b] text-white">Cancel</Button>
                  <Button 
                    onClick={() => restoreSnapshot.mutate({
                      snapshotId: restoreSnapshotId,
                      planId: restorePlan.planId,
                      confirmationToken: restorePlan.confirmationToken
                    })}
                    className="bg-red-500 hover:bg-red-600 text-white font-bold"
                    disabled={restoreSnapshot.isPending}
                  >
                    {restoreSnapshot.isPending ? <Activity className="w-4 h-4 mr-2 animate-spin" /> : 'CONFIRM RESTORE'}
                  </Button>
                </div>
              </div>
            ) : listSnapshots.isLoading ? (
              <div className="flex justify-center p-8"><Activity className="w-6 h-6 animate-spin text-[#00d4ff]" /></div>
            ) : (
              <>
                <div className="flex justify-between items-center mb-4">
                  <label className="cursor-pointer bg-[#1e293b] hover:bg-[#2e3b4e] text-white px-3 py-1.5 rounded text-sm font-bold flex items-center gap-2">
                    <Upload className="w-4 h-4" /> Import JSON
                    <input type="file" accept=".json" className="hidden" onChange={handleImport} />
                  </label>
                </div>
                {listSnapshots.data?.snapshots?.length > 0 ? (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                    {listSnapshots.data.snapshots.map(snap => (
                      <div key={snap.id} className="flex items-center justify-between bg-[#08081a] p-3 rounded border border-[#1e293b]">
                        <div>
                          <div className="font-bold text-sm">{snap.name || snap.kind || `Snapshot ${snap.id}`}</div>
                          <div className="text-xs text-gray-500">{new Date(snap.createdAt).toLocaleString()}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-transparent border-[#1e293b] text-[#00d4ff]"
                            onClick={() => {
                              const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `zonepro_snapshot_${snap.id}.json`;
                              a.click();
                            }}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button 
                            size="sm" 
                            onClick={() => planRestore.mutate({ snapshotId: snap.id, configuration: snap.configuration })}
                            disabled={planRestore.isPending || restoreSnapshot.isPending || !canWrite}
                            className="bg-[#1e293b] hover:bg-[#2e3b4e] text-white"
                          >
                            Restore
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-gray-500 text-center p-8 border border-dashed border-[#1e293b] rounded">No configuration snapshots are stored in NEON.</div>
                )}
              </>
            )}
          </div>
          
          {!restorePlan && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setSnapshotModalOpen(false)} className="bg-transparent border-[#1e293b] text-white">Close</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Utility icon
function SearchIcon(props) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
  );
}
