import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, Server, Plus, Trash2, RefreshCw, 
  Clock, Cpu, HardDrive, Activity, Mic, AlertTriangle, 
  ChevronDown, ChevronRight, Copy, Check, History,
  Upload, Package, Search, Filter, XCircle, 
  BarChart3, Music, Eye, Wifi, WifiOff, MemoryStick,
  AlertCircle, Info, DollarSign
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { fleetAdmin } from '@/api/fleetApi';

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(timestamp) {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

function MiniBar({ value, max = 100, color = '#00d4ff', label }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const barColor = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : color;
  return (
    <div className="flex items-center gap-2 text-xs">
      {label && <span className="text-gray-500 w-12 shrink-0">{label}</span>}
      <div className="flex-1 h-2 bg-[#1e293b] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <span className="text-gray-400 w-10 text-right">{Math.round(pct)}%</span>
    </div>
  );
}

function HealthSparkline({ data, field, color = '#00d4ff', height = 40, unit = '%' }) {
  if (!data || data.length < 2) return <div className="text-xs text-gray-600">No data</div>;
  
  const values = data.map(d => d[field] || 0).reverse();
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 200;
  const h = height;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        points={points}
      />
      <text x={w - 2} y={12} fill="#9ca3af" fontSize="10" textAnchor="end">
        {Math.round(values[values.length - 1])}{unit}
      </text>
    </svg>
  );
}

function DeviceDetailModal({ device, onClose }) {
  const [heartbeats, setHeartbeats] = useState([]);
  const [logs, setLogs] = useState([]);
  const [activeSubTab, setActiveSubTab] = useState('health');
  const [loading, setLoading] = useState(true);
  const [playHistory, setPlayHistory] = useState([]);
  const [playDates, setPlayDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fleetAdmin.getHeartbeats(device.device_id, 50).catch(() => []),
      fleetAdmin.getDeviceLogs(device.device_id, 100).catch(() => []),
    ]).then(([hb, lg]) => {
      setHeartbeats(hb);
      setLogs(lg);
    }).finally(() => setLoading(false));
  }, [device.device_id]);

  useEffect(() => {
    if (activeSubTab !== 'history') return;
    setHistoryLoading(true);
    fleetAdmin.getPlayHistory(device.device_id, selectedDate)
      .then(data => {
        setPlayHistory(data.history || []);
        if (!selectedDate) setPlayDates(data.dates || []);
      })
      .catch(() => { setPlayHistory([]); })
      .finally(() => setHistoryLoading(false));
  }, [device.device_id, activeSubTab, selectedDate]);

  const isOnline = device.status === 'online';
  const latestHb = heartbeats[0];

  const levelColors = { error: 'text-red-400 bg-red-500/10', warn: 'text-yellow-400 bg-yellow-500/10', info: 'text-blue-400 bg-blue-500/10' };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-[#1e293b] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]' : 'bg-red-400/60'}`} />
            <div>
              <h2 className="text-lg font-semibold text-white">{device.device_name}</h2>
              <p className="text-sm text-gray-400">{device.club_name || 'No club'} &middot; v{device.app_version}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-gray-400 hover:text-white">Close</Button>
        </div>

        {latestHb && (
          <div className="p-4 border-b border-[#1e293b]">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="text-center">
                <p className="text-xs text-gray-500">CPU</p>
                <p className="text-lg font-bold text-white">{Math.round(latestHb.cpu_percent || 0)}%</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Temp</p>
                <p className={`text-lg font-bold ${(latestHb.cpu_temp || 0) >= 75 ? 'text-red-400' : (latestHb.cpu_temp || 0) >= 60 ? 'text-yellow-400' : 'text-white'}`}>{latestHb.cpu_temp ? `${Math.round(latestHb.cpu_temp)}°C` : '-'}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Memory</p>
                <p className="text-lg font-bold text-white">{Math.round(latestHb.memory_percent || 0)}%</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Disk</p>
                <p className="text-lg font-bold text-white">{Math.round(latestHb.disk_percent || 0)}%</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Uptime</p>
                <p className="text-lg font-bold text-white">{latestHb.uptime_seconds ? `${Math.floor(latestHb.uptime_seconds / 3600)}h` : '-'}</p>
              </div>
            </div>
            {device.apiCosts && (
              <div className="mt-3 bg-[#08081a] rounded-lg p-3 border border-[#1e293b]">
                <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                  <DollarSign className="w-3 h-3" /> API Costs (30 Day)
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-[10px] text-gray-500 uppercase">Total</p>
                    <p className="text-sm font-bold text-emerald-400">${device.apiCosts.total?.toFixed(2)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-gray-500 uppercase">ElevenLabs</p>
                    <p className="text-sm font-bold text-purple-400">${device.apiCosts.elevenlabs?.toFixed(2)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-gray-500 uppercase">OpenAI</p>
                    <p className="text-sm font-bold text-blue-400">${device.apiCosts.openai?.toFixed(2)}</p>
                  </div>
                </div>
                <p className="text-[10px] text-gray-600 text-center mt-1">{device.apiCosts.calls || 0} API calls</p>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-1 p-2 border-b border-[#1e293b]">
          {['health', 'history', 'logs'].map(tab => (
            <button key={tab} onClick={() => setActiveSubTab(tab)}
              className={`flex-1 px-3 py-1.5 rounded text-sm ${activeSubTab === tab ? 'bg-[#00d4ff]/20 text-[#00d4ff]' : 'text-gray-400 hover:text-white'}`}>
              {tab === 'health' ? 'Health' : tab === 'history' ? 'Play History' : `Logs (${logs.length})`}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && activeSubTab !== 'history' ? (
            <p className="text-gray-500 text-center py-8">Loading...</p>
          ) : activeSubTab === 'health' ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">CPU Usage (last {heartbeats.length} readings)</p>
                <HealthSparkline data={heartbeats} field="cpu_percent" color="#3b82f6" />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">CPU Temperature</p>
                <HealthSparkline data={heartbeats} field="cpu_temp" color="#ef4444" unit="°C" />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Memory Usage</p>
                <HealthSparkline data={heartbeats} field="memory_percent" color="#00d4ff" />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Disk Usage</p>
                <HealthSparkline data={heartbeats} field="disk_percent" color="#f59e0b" />
              </div>
              <div className="text-xs text-gray-500 mt-4">
                <p>Last heartbeat: {formatDate(device.last_heartbeat)}</p>
                <p>Active entertainers: {latestHb?.active_dancers || 0}</p>
                <p>Playing: {latestHb?.is_playing ? 'Yes' : 'No'}</p>
              </div>
            </div>
          ) : activeSubTab === 'history' ? (
            <div>
              {playDates.length > 0 && (
                <div className="mb-3 flex items-center gap-2">
                  <select
                    value={selectedDate || ''}
                    onChange={(e) => setSelectedDate(e.target.value || null)}
                    className="bg-[#08081a] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white appearance-none cursor-pointer focus:outline-none focus:border-[#00d4ff]"
                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: '28px' }}
                  >
                    <option value="">All Dates</option>
                    {playDates.map(d => (
                      <option key={d.date} value={d.date}>{d.date} ({d.count} songs)</option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-500">{playHistory.length} songs</span>
                </div>
              )}
              {historyLoading ? (
                <p className="text-gray-500 text-center py-8">Loading...</p>
              ) : playHistory.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No play history yet</p>
              ) : (
                <div className="space-y-0.5">
                  {playHistory.map((item, i) => {
                    const time = new Date(item.played_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const dateStr = new Date(item.played_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
                    return (
                      <div key={i} className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#151528] group">
                        <span className="text-[10px] text-gray-600 w-16 text-right shrink-0 font-mono">{selectedDate ? time : `${dateStr} ${time}`}</span>
                        <span className="text-sm text-gray-200 truncate flex-1">{item.track_name}</span>
                        {item.dancer_name && (
                          <span className="text-[10px] text-[#00d4ff]/60 shrink-0">{item.dancer_name}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {logs.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No errors logged</p>
              ) : logs.map(log => (
                <div key={log.id} className="text-xs font-mono bg-[#08081a] rounded px-3 py-2 border border-[#1e293b]/50">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">{formatDate(log.timestamp)}</span>
                    <span className={`uppercase font-bold px-1.5 py-0.5 rounded text-[10px] ${levelColors[log.level] || 'text-gray-400 bg-gray-500/10'}`}>{log.level}</span>
                    {log.component && <span className="text-purple-400">[{log.component}]</span>}
                  </div>
                  <p className="text-gray-300 mt-1 whitespace-pre-wrap break-all">{log.message}</p>
                  {log.stack && <p className="text-gray-600 mt-1 whitespace-pre-wrap text-[10px]">{log.stack}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDiskGB(free, total) {
  if (!free || !total) return '--';
  const freeGB = (free / 1073741824).toFixed(1);
  const totalGB = (total / 1073741824).toFixed(1);
  const pct = Math.round((free / total) * 100);
  return `${freeGB}/${totalGB} GB (${pct}%)`;
}

function diskColorClass(free, total) {
  if (!free || !total) return 'text-gray-400';
  const pct = (free / total) * 100;
  if (pct < 10) return 'text-red-400';
  if (pct < 25) return 'text-yellow-400';
  return 'text-gray-300';
}

function tempColorClass(temp) {
  if (!temp) return 'text-gray-300';
  if (temp > 80) return 'text-red-400';
  if (temp > 70) return 'text-yellow-400';
  return 'text-gray-300';
}

function formatUptime(seconds) {
  if (!seconds) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function NetworkBars({ network }) {
  if (!network || !network.pingOk) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-end gap-[1px] h-3">
          {[3,5,8,11].map((h,i) => <span key={i} className="w-[3px] rounded-sm bg-red-400" style={{height:h}} />)}
        </span>
        <span className="text-red-400">{network?.packetLoss === 100 ? 'No Internet' : 'Down'}</span>
      </span>
    );
  }
  const avg = network.pingAvg;
  let quality, cls, bars;
  if (avg < 30) { quality = 'Excellent'; cls = 'text-green-400'; bars = 4; }
  else if (avg < 60) { quality = 'Good'; cls = 'text-green-400'; bars = 3; }
  else if (avg < 100) { quality = 'Fair'; cls = 'text-yellow-400'; bars = 2; }
  else { quality = 'Poor'; cls = 'text-red-400'; bars = 1; }
  const heights = [3,5,8,11];
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex items-end gap-[1px] h-3">
        {heights.map((h,i) => <span key={i} className={`w-[3px] rounded-sm ${i < bars ? (cls.replace('text-','bg-')) : 'bg-gray-600'}`} style={{height:h}} />)}
      </span>
      <span className={cls}>{avg.toFixed(0)}ms</span>
      <span className="text-gray-500 text-[10px]">{quality}</span>
    </span>
  );
}

function DeviceCard({ device, onDelete, onViewDetail, onCommand, pendingCommands }) {
  const isOnline = device.status === 'online';
  const timeSince = device.timeSinceHeartbeat;
  const isStale = timeSince && timeSince > 10 * 60 * 1000;
  const devId = device.device_id;

  const cmdBtn = (action, label, icon, colorClass, borderClass) => {
    const isPending = pendingCommands?.has(`${devId}-${action}`);
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onCommand(devId, action, device.device_name); }}
        disabled={isPending || !isOnline}
        className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg bg-[#1a1a2e] border ${borderClass} ${colorClass} text-xs font-medium hover:bg-opacity-20 active:scale-95 transition-all min-h-0 disabled:opacity-40 disabled:cursor-not-allowed`}>
        {isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : icon} {label}
      </button>
    );
  };

  return (
    <div className={`bg-[#0d0d1f] border rounded-xl overflow-hidden transition-colors ${isOnline ? 'border-[#1a3a2a]' : isStale ? 'border-red-500/30' : 'border-[#1e293b]'}`}>
      <div className="px-4 pt-3 pb-2 flex items-start justify-between">
        <div>
          <h3 className="text-white font-semibold text-base">{device.device_name}</h3>
          <p className="text-xs text-gray-500">{device.club_name || 'No club assigned'}</p>
        </div>
        <Badge variant="outline" className={`text-xs font-semibold uppercase tracking-wide ${isOnline ? 'border-green-500/30 text-green-400 bg-green-500/10' : 'border-red-500/30 text-red-400 bg-red-500/10'}`}>
          {isOnline ? 'Online' : 'Offline'}
        </Badge>
      </div>

      <div className="px-4 pb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex justify-between"><span className="text-gray-500">CPU Temp</span><span className={tempColorClass(device.cpuTemp)}>{device.cpuTemp ? `${device.cpuTemp}°C` : '--'}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Uptime</span><span className="text-gray-300">{formatUptime(device.uptime)}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Disk</span><span className={diskColorClass(device.diskFree, device.diskTotal)}>{formatDiskGB(device.diskFree, device.diskTotal)}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Tracks</span><span className="text-gray-300">{device.trackCount || 0}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Voiceovers</span><span className="text-gray-300">{device.voiceoverCount || 0}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Version</span><span className="text-gray-300">{device.app_version || '--'}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Memory</span><span className={`${device.memPct > 90 ? 'text-red-400' : device.memPct > 75 ? 'text-yellow-400' : 'text-gray-300'}`}>{device.memPct != null ? `${device.memPct}% used` : '--'}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Service</span><span className="text-gray-300">{formatUptime(device.serviceUptime)}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Entertainers</span><span className="text-pink-400">{device.activeEntertainers || 0}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Errors</span><span className={device.errorCount > 0 ? 'text-red-400' : 'text-gray-300'}>{device.errorCount || 0}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Last Update</span><span className="text-gray-300">{device.lastUpdateTime ? formatTimeAgo(device.lastUpdateTime) : '--'}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">IP</span><span className="text-gray-300">{device.tailscaleIp || '--'}</span></div>
        <div className="flex justify-between col-span-2"><span className="text-gray-500">Network</span><span className="text-gray-300"><NetworkBars network={device.network} /></span></div>
      </div>

      {(device.currentDancer || device.currentSong) && (
        <div className="px-4 pb-2 text-xs">
          <span className="text-gray-500">Now Playing: </span>
          <span className="text-purple-400">{device.currentDancer || ''}{device.currentDancer && device.currentSong ? ' — ' : ''}{device.currentSong || ''}</span>
        </div>
      )}

      <div className="px-4 pb-2 text-[11px] text-gray-600">Last seen: {formatTimeAgo(device.last_heartbeat)}</div>

      {device.apiCosts && (
        <div className="px-4 pb-2 border-t border-[#1a1a2e] pt-2">
          <p className="text-[11px] text-gray-500 mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3" /> API Costs (30 Day)</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><div className="text-[9px] text-gray-600 uppercase">Total</div><div className="text-xs font-semibold text-emerald-400">${(device.apiCosts.total || 0).toFixed(2)}</div></div>
            <div><div className="text-[9px] text-gray-600 uppercase">ElevenLabs</div><div className="text-xs font-semibold text-purple-400">${(device.apiCosts.elevenlabs || 0).toFixed(2)}</div></div>
            <div><div className="text-[9px] text-gray-600 uppercase">OpenAI</div><div className="text-xs font-semibold text-blue-400">${(device.apiCosts.openai || 0).toFixed(2)}</div></div>
          </div>
          <p className="text-[10px] text-gray-600 text-center mt-1">{device.apiCosts.calls || 0} API calls</p>
        </div>
      )}

      {device.recentLogs && device.recentLogs.length > 0 && (
        <div className="border-t border-[#1a1a2e] px-3 py-2">
          <details>
            <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-yellow-500" /> Service Logs ({device.recentLogs.length})
            </summary>
            <div className="mt-1.5 max-h-40 overflow-y-auto bg-black/40 rounded p-2 text-[10px] font-mono text-gray-400 space-y-0.5">
              {device.recentLogs.map((line, i) => (
                <div key={i} className={line.toLowerCase().includes('error') ? 'text-red-400' : 'text-yellow-400/70'}>{line}</div>
              ))}
            </div>
          </details>
        </div>
      )}

      <div className="border-t border-[#1e293b] px-3 py-2 flex gap-2">
        {cmdBtn('update', 'Update', <Upload className="w-3.5 h-3.5" />, 'text-blue-400', 'border-blue-500/30')}
        {cmdBtn('restart', 'Restart', <RefreshCw className="w-3.5 h-3.5" />, 'text-yellow-400', 'border-yellow-500/30')}
        {cmdBtn('sync', 'Sync', <Activity className="w-3.5 h-3.5" />, 'text-purple-400', 'border-purple-500/30')}
        {cmdBtn('reboot', 'Reboot', <AlertTriangle className="w-3.5 h-3.5" />, 'text-red-400', 'border-red-500/30')}
      </div>
      <div className="border-t border-[#1e293b]/50 px-3 py-1.5 flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); onViewDetail(device); }}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-gray-400 text-[11px] font-medium hover:text-blue-400 hover:bg-blue-500/10 transition-all">
          <Eye className="w-3 h-3" /> Details
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(device.device_id); }}
          className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-gray-500 text-[11px] font-medium hover:text-red-400 hover:bg-red-500/10 transition-all">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function RegisterDeviceModal({ onClose, onRegister }) {
  const [deviceName, setDeviceName] = useState('');
  const [clubName, setClubName] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleRegister = async () => {
    if (!deviceName.trim()) return;
    try {
      const device = await onRegister(deviceName.trim(), clubName.trim());
      setResult(device);
    } catch (err) {
      alert(err.message);
    }
  };

  const copyApiKey = () => {
    navigator.clipboard.writeText(result.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        {!result ? (
          <>
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-[#00d4ff]" /> Register New Device
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-400 block mb-1">Device Name</label>
                <Input value={deviceName} onChange={e => setDeviceName(e.target.value)}
                  placeholder="e.g., Pi-ClubA-Main"
                  className="bg-[#08081a] border-[#1e293b] text-white" />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Club Name</label>
                <Input value={clubName} onChange={e => setClubName(e.target.value)}
                  placeholder="e.g., Club Aurora"
                  className="bg-[#08081a] border-[#1e293b] text-white" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <Button onClick={handleRegister} disabled={!deviceName.trim()}
                className="flex-1 bg-[#00d4ff] hover:bg-[#00d4ff]/80 text-white">
                Register
              </Button>
              <Button variant="outline" onClick={onClose}
                className="border-[#1e293b] text-gray-300 hover:bg-[#1e293b]">
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-green-400 mb-4 flex items-center gap-2">
              <Check className="w-5 h-5" /> Device Registered
            </h2>
            <div className="space-y-3">
              <div className="text-sm text-gray-300">
                <p><strong>Name:</strong> {result.deviceName}</p>
                <p><strong>Club:</strong> {result.clubName || 'None'}</p>
                <p><strong>Device ID:</strong> <span className="font-mono text-xs">{result.deviceId}</span></p>
              </div>
              <div className="bg-[#08081a] border border-yellow-500/30 rounded-lg p-3">
                <p className="text-xs text-yellow-400 mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Save this API key — it won't be shown again
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-[#00d4ff] bg-[#1e293b] rounded px-2 py-1 flex-1 overflow-x-auto">{result.apiKey}</code>
                  <Button size="sm" variant="ghost" onClick={copyApiKey} className="text-gray-400 hover:text-white shrink-0">
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            </div>
            <Button onClick={onClose} className="w-full mt-4 bg-[#00d4ff] hover:bg-[#00d4ff]/80 text-white">
              Done
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function CreateUpdateModal({ onClose, onCreate, devices }) {
  const [version, setVersion] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [targetAll, setTargetAll] = useState(true);
  const [selectedDevices, setSelectedDevices] = useState([]);

  const handleCreate = async () => {
    if (!version.trim()) return;
    try {
      await onCreate(version.trim(), releaseNotes.trim(), targetAll ? [] : selectedDevices);
      onClose();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Package className="w-5 h-5 text-[#00d4ff]" /> Create Update
        </h2>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-400 block mb-1">Version</label>
            <Input value={version} onChange={e => setVersion(e.target.value)}
              placeholder="e.g., 1.2.0"
              className="bg-[#08081a] border-[#1e293b] text-white" />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Release Notes</label>
            <textarea value={releaseNotes} onChange={e => setReleaseNotes(e.target.value)}
              placeholder="What's new in this version..."
              rows={3}
              className="w-full bg-[#08081a] border border-[#1e293b] text-white rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#00d4ff]/50" />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input type="checkbox" checked={targetAll} onChange={e => setTargetAll(e.target.checked)}
                className="rounded border-[#1e293b]" />
              Target all devices
            </label>
            {!targetAll && devices.length > 0 && (
              <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                {devices.map(d => (
                  <label key={d.device_id} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={selectedDevices.includes(d.device_id)}
                      onChange={e => setSelectedDevices(prev => e.target.checked ? [...prev, d.device_id] : prev.filter(id => id !== d.device_id))}
                      className="rounded border-[#1e293b]" />
                    {d.device_name} ({d.club_name || 'No club'})
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <Button onClick={handleCreate} disabled={!version.trim()}
            className="flex-1 bg-[#00d4ff] hover:bg-[#00d4ff]/80 text-white">
            Create Update
          </Button>
          <Button variant="outline" onClick={onClose}
            className="border-[#1e293b] text-gray-300 hover:bg-[#1e293b]">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorLogsPanel({ devices }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterDevice, setFilterDevice] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [searchText, setSearchText] = useState('');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fleetAdmin.getErrorLogs(filterDevice || null, 500);
      setLogs(data);
    } catch {
      setLogs([]);
    }
    setLoading(false);
  }, [filterDevice]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  useEffect(() => {
    const interval = setInterval(loadLogs, 30000);
    return () => clearInterval(interval);
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (filterLevel && log.level !== filterLevel) return false;
      if (searchText) {
        const s = searchText.toLowerCase();
        return (log.message || '').toLowerCase().includes(s) ||
          (log.component || '').toLowerCase().includes(s) ||
          (log.stack || '').toLowerCase().includes(s);
      }
      return true;
    });
  }, [logs, filterLevel, searchText]);

  const levelColors = { error: 'text-red-400 bg-red-500/10', warn: 'text-yellow-400 bg-yellow-500/10', info: 'text-blue-400 bg-blue-500/10' };
  const errorCount = logs.filter(l => l.level === 'error').length;
  const warnCount = logs.filter(l => l.level === 'warn').length;

  const handleClearLogs = async () => {
    if (!confirm('Clear all error logs? This cannot be undone.')) return;
    try {
      if (filterDevice) {
        await fleetAdmin.clearDeviceLogs(filterDevice);
      } else {
        await fleetAdmin.clearAllLogs();
      }
      loadLogs();
    } catch {}
  };

  const deviceMap = useMemo(() => {
    const map = {};
    devices.forEach(d => { map[d.device_id] = d.device_name; });
    return map;
  }, [devices]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <Input value={searchText} onChange={e => setSearchText(e.target.value)}
            placeholder="Search logs..."
            className="bg-[#08081a] border-[#1e293b] text-white pl-9 h-8 text-sm" />
        </div>
        <select value={filterDevice} onChange={e => setFilterDevice(e.target.value)}
          className="bg-[#08081a] border border-[#1e293b] text-gray-300 rounded-md px-2 h-8 text-xs">
          <option value="">All Devices</option>
          {devices.map(d => <option key={d.device_id} value={d.device_id}>{d.device_name}</option>)}
        </select>
        <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)}
          className="bg-[#08081a] border border-[#1e293b] text-gray-300 rounded-md px-2 h-8 text-xs">
          <option value="">All Levels</option>
          <option value="error">Errors ({errorCount})</option>
          <option value="warn">Warnings ({warnCount})</option>
          <option value="info">Info</option>
        </select>
        <Button variant="ghost" size="sm" onClick={loadLogs} className="text-gray-400 hover:text-white h-8">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
        {logs.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleClearLogs} className="text-red-400 hover:text-red-300 h-8 text-xs">
            <Trash2 className="w-3 h-3 mr-1" /> Clear
          </Button>
        )}
      </div>

      <div className="text-xs text-gray-500">
        Showing {filteredLogs.length} of {logs.length} logs &middot; Auto-refresh every 30s
      </div>

      <div className="space-y-1 max-h-[60vh] overflow-y-auto">
        {loading && logs.length === 0 ? (
          <p className="text-gray-500 text-center py-8">Loading logs...</p>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No logs match your filters</p>
          </div>
        ) : (
          filteredLogs.map(log => (
            <div key={log.id} className="text-xs font-mono bg-[#08081a] rounded px-3 py-2 border border-[#1e293b]/50">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-500">{formatDate(log.timestamp)}</span>
                <span className={`uppercase font-bold px-1.5 py-0.5 rounded text-[10px] ${levelColors[log.level] || 'text-gray-400 bg-gray-500/10'}`}>{log.level}</span>
                {log.component && <span className="text-purple-400">[{log.component}]</span>}
                {log.device_id && <span className="text-gray-600">{deviceMap[log.device_id] || log.device_id.slice(0, 12)}</span>}
              </div>
              <p className="text-gray-300 mt-1 whitespace-pre-wrap break-all">{log.message}</p>
              {log.stack && <p className="text-gray-600 mt-1 whitespace-pre-wrap text-[10px]">{log.stack}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function UpdatesPanel({ devices }) {
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadUpdates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fleetAdmin.listUpdates();
      setUpdates(data);
    } catch {
      setUpdates([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadUpdates(); }, [loadUpdates]);

  const handleCreate = async (version, releaseNotes, targetDevices) => {
    await fleetAdmin.createUpdate(version, releaseNotes, targetDevices);
    loadUpdates();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this update record?')) return;
    await fleetAdmin.deleteUpdate(id);
    loadUpdates();
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-medium text-gray-400">App Updates</h2>
        <Button size="sm" onClick={() => setShowCreate(true)}
          className="bg-[#00d4ff] hover:bg-[#00d4ff]/80 text-white text-xs">
          <Plus className="w-3 h-3 mr-1" /> New Update
        </Button>
      </div>

      {loading ? (
        <p className="text-gray-500 text-center py-8">Loading...</p>
      ) : updates.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No updates created yet</p>
          <p className="text-xs mt-1">Create a version record to track deployments</p>
        </div>
      ) : (
        <div className="space-y-2">
          {updates.map(update => {
            const targets = JSON.parse(update.target_devices || '[]');
            return (
              <div key={update.id} className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-[#00d4ff]/50 text-[#00d4ff] text-sm font-mono">
                      v{update.version}
                    </Badge>
                    {update.is_active ? (
                      <Badge variant="outline" className="border-green-500/50 text-green-400 text-xs">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="border-gray-500/50 text-gray-400 text-xs">Inactive</Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(update.id)}
                    className="text-gray-500 hover:text-red-400 h-7">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                {update.release_notes && (
                  <p className="text-sm text-gray-300 mt-2">{update.release_notes}</p>
                )}
                <div className="mt-2 flex gap-3 text-xs text-gray-500">
                  <span>{formatDate(update.created_at)}</span>
                  <span>Target: {targets.length === 0 ? 'All devices' : `${targets.length} device(s)`}</span>
                  {update.package_size > 0 && <span>{formatBytes(update.package_size)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateUpdateModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          devices={devices}
        />
      )}
    </div>
  );
}

export default function FleetDashboard() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [voiceovers, setVoiceovers] = useState([]);
  const [syncHistory, setSyncHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('devices');
  const [showRegister, setShowRegister] = useState(false);
  const [viewingDevice, setViewingDevice] = useState(null);
  const [isHomebase, setIsHomebase] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [fleetPin, setFleetPin] = useState(() => localStorage.getItem('fleet_pin') || '');
  const [pendingCmds, setPendingCmds] = useState(new Set());
  const [toast, setToast] = useState(null);

  useEffect(() => {
    async function ensureAuth() {
      const existing = sessionStorage.getItem('djbooth_token');
      if (existing) {
        setAuthReady(true);
        return;
      }
      try {
        const res = await fetch('/api/fleet/auto-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        if (res.ok) {
          const data = await res.json();
          if (data.token) {
            sessionStorage.setItem('djbooth_token', data.token);
            sessionStorage.setItem('djbooth_role', 'dj');
          }
        }
      } catch {}
      setAuthReady(true);
    }
    ensureAuth();
  }, []);

  useEffect(() => {
    fetch('/api/config/capabilities')
      .then(r => r.json())
      .then(data => setIsHomebase(data.isHomebase || false))
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, vo, sh] = await Promise.all([
        fleetAdmin.getDashboardOverview(),
        fleetAdmin.getVoiceovers(),
        fleetAdmin.getSyncHistory(),
      ]);
      setOverview(ov);
      setVoiceovers(vo);
      setSyncHistory(sh);
    } catch (err) {
      console.error('Fleet dashboard error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (authReady) refresh(); }, [authReady, refresh]);


  const handleRegister = async (deviceName, clubName) => {
    const device = await fleetAdmin.registerDevice(deviceName, clubName);
    refresh();
    return device;
  };

  const handleDeleteDevice = async (deviceId) => {
    if (!confirm('Remove this device from the fleet? This cannot be undone.')) return;
    await fleetAdmin.deleteDevice(deviceId);
    refresh();
  };

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const handleCommand = useCallback(async (deviceId, action, deviceName) => {
    if (!fleetPin) {
      showToast('Enter your PIN first', 'error');
      return;
    }
    if (action === 'reboot') {
      if (!confirm(`REBOOT "${deviceName}"?\n\nThis will take 1-2 minutes to come back online.`)) return;
    }
    const key = `${deviceId}-${action}`;
    setPendingCmds(prev => new Set([...prev, key]));
    try {
      const res = await fetch(`/api/monitor/command/${encodeURIComponent(deviceId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: fleetPin }),
      });
      const data = await res.json();
      if (res.ok) {
        const labels = { update: 'Update queued', restart: 'Restart queued', reboot: 'Reboot queued', sync: 'Sync queued' };
        showToast(`${labels[action] || 'Queued'} — ${deviceName}`, 'success');
        const timeout = action === 'update' ? 5000 : 3000;
        setTimeout(() => {
          setPendingCmds(prev => { const next = new Set(prev); next.delete(key); return next; });
        }, timeout);
      } else {
        setPendingCmds(prev => { const next = new Set(prev); next.delete(key); return next; });
        showToast(data.error || 'Command failed', 'error');
      }
    } catch (err) {
      setPendingCmds(prev => { const next = new Set(prev); next.delete(key); return next; });
      showToast(`Failed: ${err.message}`, 'error');
    }
  }, [fleetPin, showToast]);

  const devices = overview?.devices || [];

  const handleUpdateAll = useCallback(() => {
    const onlineDevices = devices.filter(d => d.status === 'online');
    if (onlineDevices.length === 0) { showToast('No online devices', 'error'); return; }
    if (!confirm(`Update all ${onlineDevices.length} online device(s)?`)) return;
    for (const d of onlineDevices) handleCommand(d.device_id, 'update', d.device_name);
  }, [devices, handleCommand, showToast]);

  const handleSyncAll = useCallback(() => {
    const onlineDevices = devices.filter(d => d.status === 'online');
    if (onlineDevices.length === 0) { showToast('No online devices', 'error'); return; }
    for (const d of onlineDevices) handleCommand(d.device_id, 'sync', d.device_name);
  }, [devices, handleCommand, showToast]);

  const handleTestTelegram = useCallback(async () => {
    try {
      const res = await fetch('/api/monitor/test-telegram', { method: 'POST' });
      if (res.ok) showToast('Test alert sent to Telegram', 'success');
      else showToast('Telegram test failed', 'error');
    } catch (err) {
      showToast(`Telegram error: ${err.message}`, 'error');
    }
  }, [showToast]);

  const offlineCount = overview?.offlineDevices || 0;
  const hasOfflineAlert = offlineCount > 0 && (overview?.totalDevices || 0) > 0;

  const tabs = [
    { id: 'devices', label: 'Devices', icon: Server },
    { id: 'logs', label: 'Error Logs', icon: AlertCircle },
    { id: 'updates', label: 'Updates', icon: Package },
    { id: 'voiceovers', label: 'Voiceovers', icon: Mic },
    { id: 'music', label: 'Music', icon: Music },
    { id: 'sync', label: 'Sync', icon: History },
  ];

  const voiceoversByDancer = voiceovers.reduce((acc, v) => {
    if (!acc[v.dancer_name]) acc[v.dancer_name] = [];
    acc[v.dancer_name].push(v);
    return acc;
  }, {});

  const [refreshCountdown, setRefreshCountdown] = useState(60);

  useEffect(() => {
    const timer = setInterval(() => {
      setRefreshCountdown(prev => {
        if (prev <= 1) {
          refresh();
          return 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#08081a] text-white fleet-compact" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="sticky top-0 z-50 bg-gradient-to-b from-[#0d0d2b] to-[#08081a] border-b border-[#1e293b] px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#00d4ff] tracking-wide" style={{textShadow: '0 0 20px rgba(0,212,255,0.4)'}}>NEON AI DJ</h1>
          <p className="text-[11px] text-gray-500 tracking-wide">Fleet Command Center</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-600">{refreshCountdown}s</span>
          <div className={`w-2 h-2 rounded-full ${overview ? 'bg-green-400 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-400'}`} />
        </div>
      </div>

      <div className="sticky top-[52px] z-40 bg-[#0d0d1f] border-b border-[#1e293b] px-4 py-2 flex items-center gap-3">
        <label className="text-xs text-gray-500 shrink-0">PIN:</label>
        <input
          type="password"
          inputMode="numeric"
          maxLength={10}
          value={fleetPin}
          onChange={(e) => { setFleetPin(e.target.value); localStorage.setItem('fleet_pin', e.target.value); }}
          placeholder="Enter PIN"
          className="bg-[#1a1a2e] border border-[#2d2d4a] rounded-md text-white px-2 py-1 text-sm w-24 outline-none focus:border-[#00d4ff]"
          style={{ WebkitTextSecurity: 'disc' }}
        />
      </div>

      <div className="max-w-4xl mx-auto p-4">

        {hasOfflineAlert && (
          <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-sm text-red-300">
              {offlineCount} device{offlineCount > 1 ? 's' : ''} offline — check connection at {devices.filter(d => d.status === 'offline').map(d => d.club_name || d.device_name).join(', ')}
            </p>
          </div>
        )}

        {overview && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-white">{overview.totalDevices}</p>
              <p className="text-xs text-gray-500">Devices</p>
            </div>
            <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-400">{overview.onlineDevices}</p>
              <p className="text-xs text-gray-500">Online</p>
            </div>
            <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-3 text-center">
              <p className={`text-2xl font-bold ${overview.offlineDevices > 0 ? 'text-red-400' : 'text-gray-600'}`}>{overview.offlineDevices}</p>
              <p className="text-xs text-gray-500">Offline</p>
            </div>
            <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-purple-400">{overview.totalVoiceovers}</p>
              <p className="text-xs text-gray-500">Voiceovers</p>
            </div>
          </div>
        )}

        {overview && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-[#00d4ff]">{overview.uniqueDancers}</p>
              <p className="text-xs text-gray-500">Entertainers</p>
            </div>
            <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-emerald-400">
                ${(overview.devices || []).reduce((sum, d) => sum + (d.apiCosts?.total || 0), 0).toFixed(2)}
              </p>
              <p className="text-xs text-gray-500">API Costs (30d)</p>
            </div>
            <div
              onClick={() => isHomebase ? navigate('/VoiceStudio') : null}
              className={`bg-[#0d0d1f] border rounded-lg p-3 text-center ${isHomebase ? 'cursor-pointer hover:border-amber-400/50' : ''} transition-colors ${
                (overview.voiceoversNeeded || 0) > 0
                  ? 'border-amber-500/40 bg-gradient-to-b from-[#0d0d1f] to-[#1a1508]'
                  : 'border-[#1e293b]'
              }`}
            >
              <p className={`text-2xl font-bold ${(overview.voiceoversNeeded || 0) > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                {overview.voiceoversNeeded || 0}
              </p>
              <p className="text-xs text-gray-500">Voiceovers Needed</p>
            </div>
          </div>
        )}

        <div className="flex gap-1 mb-4 bg-[#0d0d1f] rounded-lg p-1 border border-[#1e293b] overflow-x-auto">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors
                ${activeTab === tab.id 
                  ? 'bg-[#00d4ff]/20 text-[#00d4ff] border border-[#00d4ff]/30' 
                  : 'text-gray-400 hover:text-white hover:bg-[#1e293b]/50 border border-transparent'}`}>
              <tab.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {activeTab === 'devices' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-medium text-gray-400">Registered Devices</h2>
              <Button size="sm" onClick={() => setShowRegister(true)}
                className="bg-[#00d4ff] hover:bg-[#00d4ff]/80 text-white text-xs">
                <Plus className="w-3 h-3 mr-1" /> Add Device
              </Button>
            </div>
            {devices.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Server className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No devices registered yet</p>
                <p className="text-xs mt-1">Add your first Pi to get started</p>
              </div>
            ) : (
              devices.map(device => (
                <DeviceCard key={device.device_id} device={device}
                  onDelete={handleDeleteDevice}
                  onViewDetail={setViewingDevice}
                  onCommand={handleCommand}
                  pendingCommands={pendingCmds} />
              ))
            )}
          </div>
        )}

        {activeTab === 'logs' && <ErrorLogsPanel devices={devices} />}

        {activeTab === 'updates' && <UpdatesPanel devices={devices} />}

        {activeTab === 'voiceovers' && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-gray-400">
              Master Voiceover Library — {Object.keys(voiceoversByDancer).length} dancers, {voiceovers.length} files
            </h2>
            {Object.keys(voiceoversByDancer).length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Mic className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No voiceovers in the library yet</p>
                <p className="text-xs mt-1">Voiceovers will appear here as they're generated at clubs</p>
              </div>
            ) : (
              Object.entries(voiceoversByDancer).map(([name, vos]) => (
                <div key={name} className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-4">
                  <h3 className="text-white font-medium mb-2">{name}</h3>
                  <div className="flex flex-wrap gap-2">
                    {vos.map(vo => (
                      <Badge key={vo.id} variant="outline" className="border-[#00d4ff]/30 text-[#00d4ff] text-xs">
                        {vo.voiceover_type} ({formatBytes(vo.file_size)})
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Last updated: {formatDate(Math.max(...vos.map(v => v.uploaded_at)))}
                    {vos[0].uploaded_by_device && ` · From: ${vos[0].uploaded_by_device}`}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'music' && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-gray-400">Music Library per Device</h2>
            {devices.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Music className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Register a device first to see its music library</p>
              </div>
            ) : (
              devices.map(device => (
                <MusicManifestCard key={device.device_id} device={device} />
              ))
            )}
          </div>
        )}

        {activeTab === 'sync' && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-gray-400">Recent Sync Activity</h2>
            {syncHistory.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No sync activity recorded yet</p>
              </div>
            ) : (
              syncHistory.map(entry => (
                <div key={entry.id} className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={
                        entry.status === 'success' ? 'border-green-500/50 text-green-400 text-xs' :
                        entry.status === 'partial' ? 'border-yellow-500/50 text-yellow-400 text-xs' :
                        entry.status === 'started' ? 'border-blue-500/50 text-blue-400 text-xs' :
                        'border-red-500/50 text-red-400 text-xs'
                      }>
                        {entry.status}
                      </Badge>
                      <span className="text-sm text-white">{entry.sync_type}</span>
                      <span className="text-xs text-gray-500">{entry.direction}</span>
                    </div>
                    {entry.details && <p className="text-xs text-gray-400 mt-1">{entry.details}</p>}
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p>{formatDate(entry.timestamp)}</p>
                    {entry.items_count > 0 && <p>{entry.items_count} items</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {showRegister && (
          <RegisterDeviceModal onClose={() => setShowRegister(false)} onRegister={handleRegister} />
        )}

        {viewingDevice && (
          <DeviceDetailModal device={viewingDevice} onClose={() => setViewingDevice(null)} />
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[100] px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium backdrop-blur-sm border animate-in fade-in slide-in-from-bottom-4 duration-300
          ${toast.type === 'success' ? 'bg-green-500/20 border-green-500/40 text-green-300' :
            toast.type === 'error' ? 'bg-red-500/20 border-red-500/40 text-red-300' :
            'bg-blue-500/20 border-blue-500/40 text-blue-300'}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

function MusicManifestCard({ device }) {
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadManifest = async () => {
    if (manifest) { setExpanded(!expanded); return; }
    setLoading(true);
    try {
      const data = await fleetAdmin.getMusicManifest(device.device_id);
      setManifest(data);
      setExpanded(true);
    } catch {
      setManifest([]);
      setExpanded(true);
    }
    setLoading(false);
  };

  const totalSize = manifest ? manifest.reduce((sum, m) => sum + (m.file_size || 0), 0) : 0;

  return (
    <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-4">
      <div className="flex items-center justify-between cursor-pointer" onClick={loadManifest}>
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-[#00d4ff]" />
          <span className="text-white font-medium">{device.device_name}</span>
          <span className="text-xs text-gray-500">{device.club_name}</span>
        </div>
        <div className="flex items-center gap-2">
          {manifest && <span className="text-xs text-gray-400">{manifest.length} tracks · {formatBytes(totalSize)}</span>}
          {loading ? (
            <RefreshCw className="w-3.5 h-3.5 text-gray-400 animate-spin" />
          ) : (
            expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </div>
      {expanded && manifest && (
        <div className="mt-3 pt-3 border-t border-[#1e293b]">
          {manifest.length === 0 ? (
            <p className="text-xs text-gray-500">No music manifest tracked for this device yet</p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {manifest.map(track => (
                <div key={track.id || track.filename} className="flex justify-between text-xs py-1 px-2 rounded hover:bg-[#1e293b]/30">
                  <span className="text-gray-300 truncate flex-1">{track.filename}</span>
                  <span className="text-gray-500 shrink-0 ml-2">{track.genre || '-'} · {formatBytes(track.file_size)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
