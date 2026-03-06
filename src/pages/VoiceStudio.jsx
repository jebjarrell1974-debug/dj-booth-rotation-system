import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Mic, MicOff, Square, Play, Pause,
  SkipForward, SkipBack, Check, RefreshCw, Search,
  Download, Trash2, ChevronDown, Volume2, AlertCircle
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { fleetAdmin } from '@/api/fleetApi';
import { processRecording } from '@/utils/voiceProcessor';

const RECORDING_TYPES = ['intro', 'round2', 'outro'];
const TYPE_LABELS = { intro: 'Intro', round2: 'Round 2', outro: 'Outro' };
const TYPE_PROMPTS = {
  intro: 'Introducing them to the stage',
  round2: 'Starting their second song',
  outro: 'Thanking them as they leave the stage',
};

function LiveMeter({ analyser }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!analyser || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = '#0d0d1f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00d4ff';
      ctx.beginPath();
      const sliceWidth = canvas.width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / bufferLength);
      const db = 20 * Math.log10(rms + 0.0001);
      const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));

      ctx.fillStyle = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
      ctx.fillRect(0, canvas.height - 6, (pct / 100) * canvas.width, 6);
    }

    draw();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [analyser]);

  return <canvas ref={canvasRef} width={400} height={80} className="w-full rounded-lg border border-[#1e293b]" />;
}

export default function VoiceStudio() {
  const [pendingData, setPendingData] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [filter, setFilter] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [playingId, setPlayingId] = useState(null);
  const [savedMessage, setSavedMessage] = useState('');
  const [micError, setMicError] = useState('');

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const [analyserNode, setAnalyserNode] = useState(null);
  const audioElRef = useRef(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, recs] = await Promise.all([
        fleetAdmin.getPendingRecordings(),
        fleetAdmin.getRecordings(),
      ]);
      setPendingData(pending || []);
      setRecordings(recs || []);
    } catch (err) {
      console.error('VoiceStudio load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devs => {
      const audioInputs = devs.filter(d => d.kind === 'audioinput');
      setDevices(audioInputs);
      if (audioInputs.length > 0 && !selectedDevice) {
        setSelectedDevice(audioInputs[0].deviceId);
      }
    }).catch(() => {});
  }, []);

  const queue = useMemo(() => {
    const items = [];
    for (const dancer of pendingData) {
      for (const type of RECORDING_TYPES) {
        const isRecorded = dancer.recordings?.[type] || false;
        items.push({
          dancerName: dancer.dancer_name,
          type,
          isRecorded,
        });
      }
    }

    let filtered = items;
    if (filter === 'pending') filtered = items.filter(i => !i.isRecorded);
    else if (filter === 'recorded') filtered = items.filter(i => i.isRecorded);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(i => i.dancerName.toLowerCase().includes(q));
    }

    return filtered;
  }, [pendingData, filter, searchQuery]);

  const currentItem = queue[currentIndex] || null;

  const totalNames = pendingData.length;
  const totalNeeded = pendingData.length * 3;
  const totalRecorded = recordings.length;
  const totalPending = totalNeeded - totalRecorded;

  const recordingItemRef = useRef(null);

  const startRecording = useCallback(async () => {
    if (!selectedDevice) {
      setMicError('No microphone selected');
      return;
    }
    if (!currentItem) {
      setMicError('No item to record — add entertainers to the fleet first');
      return;
    }
    setMicError('');
    setSavedMessage('');

    recordingItemRef.current = { ...currentItem };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: selectedDevice },
          sampleRate: 48000,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });
      streamRef.current = stream;

      const actx = new AudioContext({ sampleRate: 48000 });
      audioCtxRef.current = actx;
      const source = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;
      setAnalyserNode(analyser);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 256000,
      });

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const capturedItem = recordingItemRef.current;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        if (!capturedItem) return;

        if (blob.size < 1000) {
          setMicError('Recording too short — try again');
          return;
        }

        setIsProcessing(true);
        try {
          const { processedMp3Blob, rawBlob, durationMs } = await processRecording(blob);

          await fleetAdmin.uploadRecording(
            capturedItem.dancerName,
            capturedItem.type,
            processedMp3Blob,
            rawBlob,
            durationMs
          );

          setSavedMessage(`Saved ${capturedItem.dancerName} — ${TYPE_LABELS[capturedItem.type]}`);
          await loadData();

          setTimeout(() => {
            setCurrentIndex(prev => Math.min(prev + 1, queue.length - 1));
            setSavedMessage('');
          }, 1200);
        } catch (err) {
          console.error('Processing error:', err);
          setMicError('Failed to process recording: ' + err.message);
        } finally {
          setIsProcessing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Mic error:', err);
      setMicError('Could not access microphone: ' + err.message);
    }
  }, [selectedDevice, currentItem, queue.length, loadData]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setIsRecording(false);
    setAnalyserNode(null);
  }, []);

  const playRecording = useCallback((dancerName, type) => {
    const id = `${dancerName}-${type}`;
    if (playingId === id) {
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current = null;
      }
      setPlayingId(null);
      return;
    }

    if (audioElRef.current) {
      audioElRef.current.pause();
    }

    const url = fleetAdmin.getRecordingAudioUrl(dancerName, type);
    const audio = new Audio(url);
    audio.onended = () => { setPlayingId(null); };
    audio.onerror = () => { setPlayingId(null); };
    audio.play().catch(() => setPlayingId(null));
    audioElRef.current = audio;
    setPlayingId(id);
  }, [playingId]);

  const deleteRecording = useCallback(async (id, name, type) => {
    if (!confirm(`Delete recording for ${name} — ${TYPE_LABELS[type]}?`)) return;
    try {
      await fleetAdmin.deleteRecording(id);
      await loadData();
    } catch (err) {
      console.error('Delete error:', err);
    }
  }, [loadData]);

  const handleExportRaw = useCallback(async () => {
    try {
      const data = await fleetAdmin.exportRawRecordings();
      if (!data || data.length === 0) {
        alert('No raw recordings to export');
        return;
      }
      const token = sessionStorage.getItem('djbooth_token');
      for (const rec of data) {
        const res = await fetch(rec.download_url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) continue;
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${rec.dancer_name}-${rec.recording_type}-raw.webm`;
        a.click();
        URL.revokeObjectURL(a.href);
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      console.error('Export error:', err);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08081a] text-white flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-[#00d4ff] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#08081a] text-white">
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link to="/FleetDashboard" className="text-gray-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Mic className="w-5 h-5 text-[#00d4ff]" /> Voice Recording Studio
              </h1>
              <p className="text-sm text-gray-500">Record announcements with your voice</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={loadData} className="text-gray-400 hover:text-white">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-[#00d4ff]">{totalNames}</p>
            <p className="text-xs text-gray-500">Names</p>
          </div>
          <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-green-400">{totalRecorded}</p>
            <p className="text-xs text-gray-500">Recorded</p>
          </div>
          <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-400">{Math.max(0, totalPending)}</p>
            <p className="text-xs text-gray-500">Pending</p>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-xs text-gray-500 mb-1 block">Microphone</label>
          <select
            value={selectedDevice}
            onChange={(e) => setSelectedDevice(e.target.value)}
            className="w-full bg-[#0d0d1f] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white"
          >
            {devices.length === 0 && <option value="">No microphones found</option>}
            {devices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>

        {micError && (
          <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-sm text-red-300">{micError}</p>
          </div>
        )}

        {savedMessage && (
          <div className="mb-4 bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400 shrink-0" />
            <p className="text-sm text-green-300">{savedMessage}</p>
          </div>
        )}

        {currentItem && !isProcessing && (
          <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl p-6 mb-6">
            <div className="text-center mb-4">
              <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider">
                {currentIndex + 1} of {queue.length}
              </p>
              <h2 className="text-3xl font-black text-white mb-1">{currentItem.dancerName}</h2>
              <Badge className="bg-[#00d4ff]/20 text-[#00d4ff] border-[#00d4ff]/30 text-sm px-3 py-1">
                {TYPE_LABELS[currentItem.type]}
              </Badge>
              <p className="text-xs text-gray-500 mt-2">{TYPE_PROMPTS[currentItem.type]}</p>
            </div>

            {isRecording && <LiveMeter analyser={analyserNode} />}

            <div className="flex items-center justify-center gap-4 mt-6">
              <Button
                variant="ghost" size="icon"
                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0 || isRecording}
                className="text-gray-400 hover:text-white"
              >
                <SkipBack className="w-5 h-5" />
              </Button>

              {!isRecording ? (
                <button
                  onClick={startRecording}
                  className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center transition-all shadow-lg shadow-red-500/30 hover:scale-105 active:scale-95"
                >
                  <Mic className="w-8 h-8 text-white" />
                </button>
              ) : (
                <button
                  onClick={stopRecording}
                  className="w-20 h-20 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all animate-pulse shadow-lg shadow-red-500/50"
                >
                  <Square className="w-8 h-8 text-white" />
                </button>
              )}

              <Button
                variant="ghost" size="icon"
                onClick={() => setCurrentIndex(Math.min(queue.length - 1, currentIndex + 1))}
                disabled={currentIndex >= queue.length - 1 || isRecording}
                className="text-gray-400 hover:text-white"
              >
                <SkipForward className="w-5 h-5" />
              </Button>
            </div>

            {currentItem.isRecorded && (
              <div className="mt-4 text-center">
                <Button
                  variant="ghost" size="sm"
                  onClick={() => playRecording(currentItem.dancerName, currentItem.type)}
                  className="text-[#00d4ff] hover:text-[#00d4ff]/80"
                >
                  {playingId === `${currentItem.dancerName}-${currentItem.type}` ? (
                    <><Pause className="w-4 h-4 mr-1" /> Stop Preview</>
                  ) : (
                    <><Play className="w-4 h-4 mr-1" /> Preview Current</>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {isProcessing && (
          <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl p-8 mb-6 text-center">
            <RefreshCw className="w-10 h-10 text-[#00d4ff] animate-spin mx-auto mb-3" />
            <p className="text-white font-medium">Processing recording...</p>
            <p className="text-xs text-gray-500 mt-1">Applying compression, EQ, normalization</p>
          </div>
        )}

        {queue.length === 0 && !isProcessing && (
          <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl p-8 mb-6 text-center">
            {filter === 'pending' ? (
              <>
                <Check className="w-12 h-12 text-green-400 mx-auto mb-3" />
                <p className="text-white font-medium">All caught up!</p>
                <p className="text-xs text-gray-500 mt-1">Every name in the fleet has recordings</p>
              </>
            ) : (
              <>
                <Mic className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No recordings match your filter</p>
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mb-4">
          <div className="flex bg-[#0d0d1f] rounded-lg border border-[#1e293b] p-0.5 flex-1">
            {[
              { id: 'pending', label: 'Pending' },
              { id: 'recorded', label: 'Recorded' },
              { id: 'all', label: 'All' },
            ].map(f => (
              <button key={f.id}
                onClick={() => { setFilter(f.id); setCurrentIndex(0); }}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs transition-colors
                  ${filter === f.id
                    ? 'bg-[#00d4ff]/20 text-[#00d4ff] border border-[#00d4ff]/30'
                    : 'text-gray-400 hover:text-white border border-transparent'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentIndex(0); }}
              className="bg-[#0d0d1f] border-[#1e293b] text-white text-xs pl-8 w-40 h-8"
            />
          </div>
        </div>

        <div className="space-y-1 mb-6 max-h-[40vh] overflow-y-auto">
          {queue.map((item, idx) => {
            const rec = recordings.find(r => r.dancer_name === item.dancerName && r.recording_type === item.type);
            return (
              <div
                key={`${item.dancerName}-${item.type}`}
                onClick={() => setCurrentIndex(idx)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors
                  ${idx === currentIndex
                    ? 'bg-[#00d4ff]/10 border border-[#00d4ff]/30'
                    : 'bg-[#0d0d1f] border border-transparent hover:border-[#1e293b]'}`}
              >
                <div className="flex items-center gap-2">
                  {item.isRecorded ? (
                    <Check className="w-3.5 h-3.5 text-green-400" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-gray-600" />
                  )}
                  <span className="text-sm text-white font-medium">{item.dancerName}</span>
                  <Badge variant="outline" className="text-[10px] border-gray-700 text-gray-400">
                    {TYPE_LABELS[item.type]}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  {item.isRecorded && (
                    <>
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6"
                        onClick={(e) => { e.stopPropagation(); playRecording(item.dancerName, item.type); }}
                      >
                        {playingId === `${item.dancerName}-${item.type}` ? (
                          <Pause className="w-3 h-3 text-[#00d4ff]" />
                        ) : (
                          <Play className="w-3 h-3 text-gray-400" />
                        )}
                      </Button>
                      {rec && (
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6"
                          onClick={(e) => { e.stopPropagation(); deleteRecording(rec.id, item.dancerName, item.type); }}
                        >
                          <Trash2 className="w-3 h-3 text-gray-500 hover:text-red-400" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {recordings.length > 0 && (
          <div className="border-t border-[#1e293b] pt-4">
            <Button
              variant="ghost" size="sm"
              onClick={handleExportRaw}
              className="text-gray-400 hover:text-white text-xs"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Export Raw Recordings (for voice clone training)
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
