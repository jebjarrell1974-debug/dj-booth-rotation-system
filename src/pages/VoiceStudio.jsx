import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Mic, MicOff, Square, Play, Pause,
  SkipForward, SkipBack, Check, RefreshCw, Search,
  Download, Trash2, Volume2, AlertCircle,
  Radio, Plus, Sparkles, Music, X
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { fleetAdmin } from '@/api/fleetApi';
import { processRecording } from '@/utils/voiceProcessor';
import { mixPromo, SFX_OPTIONS } from '@/utils/audioMixer';
import { getApiConfig } from '@/components/apiConfig';

const ENTERTAINER_TYPES = ['intro', 'round2', 'round3', 'outro'];
const TYPE_LABELS = { intro: 'Intro', round2: 'Round 2', round3: 'Round 3', outro: 'Outro', transition: 'Transition', mid_set: 'Mid-Set' };
const TYPE_PROMPTS = {
  intro: 'Introducing them to the stage',
  round2: 'Starting their second song',
  round3: 'Starting their third song',
  outro: 'Thanking them as they leave the stage',
  transition: 'Generic transition between entertainers',
  mid_set: 'Between songs in the same set',
};

const GENERIC_NAME = '__generic__';

const VIBE_OPTIONS = ['Hype', 'Party', 'Classy', 'Chill'];
const LENGTH_OPTIONS = ['15s', '30s', '60s'];

const SCRIPT_TEMPLATES = {
  intro: [
    "Gentlemen, make your way to the stage... the beautiful NAME is here!",
    "Put your hands together, NAME is about to blow your mind!",
    "Get those dollars ready, NAME is taking the stage!",
    "Here she is gentlemen, the one and only NAME!",
    "The moment you've been waiting for... welcome NAME to the stage!",
  ],
  round2: [
    "She's not done yet! NAME is back for round two!",
    "NAME's not finished with you yet, she's back on stage!",
    "Round two gentlemen, NAME wants more of your attention!",
    "You asked for it, NAME is back and she's ready to go!",
    "The beautiful NAME is back for another round!",
  ],
  outro: [
    "Let's hear it for the amazing NAME!",
    "A big round of applause for the gorgeous NAME!",
    "Make sure you show love to NAME, wasn't she incredible?",
    "That was NAME everybody, show her some appreciation!",
    "Give it up for NAME, she killed it up there!",
  ],
  transition: [
    "Coming up next to the stage...",
    "Let's keep the party going, next up...",
    "Stay right there, we've got more coming your way!",
    "Keep those drinks flowing, another beauty is headed to the stage!",
    "Don't go anywhere, the party's just getting started!",
    "We're just getting warmed up, who's ready for more?",
    "Keep that energy up! Next entertainer coming right up!",
    "The fun doesn't stop, let's bring out the next one!",
  ],
  mid_set: [
    "She's not done yet, stay right there!",
    "Keep your eyes on the stage, more coming from her!",
    "Oh she's got another one for you, here we go!",
    "Don't look away, she's just getting started!",
    "Round two of this set, let's go!",
    "She's still going, keep that energy up!",
  ],
};

function getRandomScript(type, name) {
  const templates = SCRIPT_TEMPLATES[type] || SCRIPT_TEMPLATES.transition;
  const template = templates[Math.floor(Math.random() * templates.length)];
  return name && name !== GENERIC_NAME ? template.replace(/NAME/g, name) : template;
}

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

const getAuthHeaders = () => {
  const token = sessionStorage.getItem('djbooth_token');
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

export default function VoiceStudio() {
  const [activeTab, setActiveTab] = useState('entertainers');
  const [pendingData, setPendingData] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [promoRequests, setPromoRequests] = useState([]);
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
  const [suggestedScript, setSuggestedScript] = useState('');
  const [showPromoForm, setShowPromoForm] = useState(false);

  const [promoEventName, setPromoEventName] = useState('');
  const [promoDate, setPromoDate] = useState('');
  const [promoTime, setPromoTime] = useState('');
  const [promoVenue, setPromoVenue] = useState('');
  const [promoDetails, setPromoDetails] = useState('');
  const [promoVibe, setPromoVibe] = useState('Hype');
  const [promoLength, setPromoLength] = useState('30s');
  const [promoMusicBed, setPromoMusicBed] = useState('random');
  const [promoIntroSfx, setPromoIntroSfx] = useState('none');
  const [promoOutroSfx, setPromoOutroSfx] = useState('none');
  const [promoBeds, setPromoBeds] = useState([]);

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
      const [pending, recs, promos] = await Promise.all([
        fleetAdmin.getPendingRecordings(),
        fleetAdmin.getRecordings(),
        fleetAdmin.listPromoRequests(),
      ]);
      setPendingData(pending || []);
      setRecordings(recs || []);
      setPromoRequests(promos || []);
    } catch (err) {
      console.error('VoiceStudio load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    async function detectMics() {
      console.log('🎤 Detecting microphones...');
      console.log('🎤 mediaDevices available:', !!navigator.mediaDevices);
      console.log('🎤 getUserMedia available:', !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
      console.log('🎤 Secure context:', window.isSecureContext);
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('🎤 getUserMedia succeeded, tracks:', tempStream.getTracks().length);
        tempStream.getTracks().forEach(t => t.stop());
      } catch (err) {
        console.warn('🎤 Mic permission request failed:', err.name, err.message);
      }
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        console.log('🎤 All devices found:', devs.length, devs.map(d => `${d.kind}:${d.label||'no-label'}:${d.deviceId?.slice(0,8)}`));
        const audioInputs = devs.filter(d => d.kind === 'audioinput');
        console.log('🎤 Audio inputs:', audioInputs.length, audioInputs.map(d => d.label || d.deviceId));
        setDevices(audioInputs);
        if (audioInputs.length > 0 && !selectedDevice) {
          setSelectedDevice(audioInputs[0].deviceId);
        }
      } catch (err) {
        console.warn('🎤 Device enumeration failed:', err.name, err.message);
      }
    }
    detectMics();
  }, []);

  useEffect(() => {
    async function fetchBeds() {
      try {
        const res = await fetch(`/api/music/tracks?genre=${encodeURIComponent('Promo Beds')}&limit=200`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          setPromoBeds(data.tracks || []);
        }
      } catch {}
    }
    fetchBeds();

    const config = getApiConfig();
    if (config.clubName && !promoVenue) {
      setPromoVenue(config.clubName);
    }
  }, []);

  const entertainerQueue = useMemo(() => {
    const items = [];
    for (const dancer of pendingData) {
      for (const type of ENTERTAINER_TYPES) {
        const isRecorded = dancer.recordings?.[type] || false;
        items.push({ dancerName: dancer.dancer_name, type, isRecorded, category: 'entertainer' });
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

  const transitionQueue = useMemo(() => {
    const transTypes = ['transition', 'mid_set'];
    const items = [];
    const genericRecs = recordings.filter(r => r.dancer_name === GENERIC_NAME);
    for (const type of transTypes) {
      const existing = genericRecs.filter(r => r.recording_type.startsWith(type));
      const count = existing.length;
      const target = type === 'transition' ? 10 : 8;
      for (let i = 0; i < Math.max(target, count); i++) {
        const recType = `${type}_${i + 1}`;
        const isRecorded = genericRecs.some(r => r.recording_type === recType);
        items.push({ dancerName: GENERIC_NAME, type: recType, baseType: type, isRecorded, category: 'transition', variationNum: i + 1 });
      }
    }
    let filtered = items;
    if (filter === 'pending') filtered = items.filter(i => !i.isRecorded);
    else if (filter === 'recorded') filtered = items.filter(i => i.isRecorded);
    return filtered;
  }, [recordings, filter]);

  const promoQueue = useMemo(() => {
    const pending = promoRequests.filter(p => p.status === 'pending');
    return pending.map(p => ({
      promoId: p.id,
      dancerName: p.event_name,
      type: 'promo',
      isRecorded: false,
      category: 'promo',
      promoData: p,
    }));
  }, [promoRequests]);

  const activeQueue = activeTab === 'entertainers' ? entertainerQueue
    : activeTab === 'transitions' ? transitionQueue
    : promoQueue;

  const currentItem = activeQueue[currentIndex] || null;

  const totalNames = pendingData.length;
  const totalNeeded = pendingData.length * 3;
  const totalRecorded = recordings.filter(r => r.dancer_name !== GENERIC_NAME).length;
  const totalPending = Math.max(0, totalNeeded - totalRecorded);
  const transitionRecorded = recordings.filter(r => r.dancer_name === GENERIC_NAME).length;
  const promoPending = promoRequests.filter(p => p.status === 'pending').length;

  useEffect(() => {
    if (currentItem) {
      const t = currentItem.baseType || currentItem.type;
      setSuggestedScript(getRandomScript(t, currentItem.dancerName));
    }
  }, [currentItem?.dancerName, currentItem?.type, currentIndex]);

  const recordingItemRef = useRef(null);

  const startRecording = useCallback(async () => {
    if (!selectedDevice) {
      setMicError('No microphone selected');
      return;
    }
    if (!currentItem) {
      setMicError('No item to record');
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

          if (capturedItem.category === 'promo' && capturedItem.promoData) {
            const promo = capturedItem.promoData;
            let musicBlob = null;
            if (promo.music_bed && promo.music_bed !== 'none') {
              let trackId = promo.music_bed;
              if (trackId === 'random' && promoBeds.length > 0) {
                const randomBed = promoBeds[Math.floor(Math.random() * promoBeds.length)];
                trackId = randomBed.id;
              }
              if (trackId !== 'random') {
                const musicRes = await fetch(`/api/music/stream/${trackId}`, { headers: getAuthHeaders() });
                if (musicRes.ok) musicBlob = await musicRes.blob();
              }
            }

            if (musicBlob) {
              const mixedBlob = await mixPromo(processedMp3Blob, musicBlob, {
                introSfx: promo.intro_sfx || 'none',
                outroSfx: promo.outro_sfx || 'none',
                fullMusicIntro: 3.0,
                fullMusicOutro: 3.0,
                outputFormat: 'mp3',
              });
              await fleetAdmin.savePromo(capturedItem.promoId, mixedBlob);
              setSavedMessage(`Promo saved with music bed: ${capturedItem.dancerName}`);
            } else {
              if (promo.music_bed && promo.music_bed !== 'none' && promo.music_bed !== 'random') {
                setSavedMessage(`Promo saved (voice only — music bed failed to load): ${capturedItem.dancerName}`);
              } else {
                setSavedMessage(`Promo saved: ${capturedItem.dancerName}`);
              }
              await fleetAdmin.savePromo(capturedItem.promoId, processedMp3Blob);
            }
          } else {
            await fleetAdmin.uploadRecording(
              capturedItem.dancerName,
              capturedItem.type,
              processedMp3Blob,
              rawBlob,
              durationMs
            );
            const label = capturedItem.category === 'transition'
              ? `${TYPE_LABELS[capturedItem.baseType] || capturedItem.baseType} #${capturedItem.variationNum}`
              : `${capturedItem.dancerName} — ${TYPE_LABELS[capturedItem.type]}`;
            setSavedMessage(`Saved ${label}`);
          }

          await loadData();
          setTimeout(() => {
            setCurrentIndex(prev => Math.min(prev + 1, activeQueue.length - 1));
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
  }, [selectedDevice, currentItem, activeQueue.length, loadData, promoBeds]);

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
    if (audioElRef.current) audioElRef.current.pause();

    const url = fleetAdmin.getRecordingAudioUrl(dancerName, type);
    const audio = new Audio(url);
    audio.onended = () => { setPlayingId(null); };
    audio.onerror = () => { setPlayingId(null); };
    audio.play().catch(() => setPlayingId(null));
    audioElRef.current = audio;
    setPlayingId(id);
  }, [playingId]);

  const deleteRecording = useCallback(async (id, name, type) => {
    if (!confirm(`Delete recording for ${name} — ${type}?`)) return;
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

  const handleSubmitPromo = useCallback(async () => {
    if (!promoEventName.trim()) return;
    try {
      await fleetAdmin.createPromoRequest({
        event_name: promoEventName,
        date: promoDate,
        time: promoTime,
        venue: promoVenue,
        details: promoDetails,
        vibe: promoVibe,
        length: promoLength,
        music_bed: promoMusicBed,
        intro_sfx: promoIntroSfx,
        outro_sfx: promoOutroSfx,
      });
      setPromoEventName('');
      setPromoDate('');
      setPromoTime('');
      setPromoDetails('');
      setShowPromoForm(false);
      await loadData();
      setSavedMessage('Promo request created');
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (err) {
      setMicError('Failed to create promo request: ' + err.message);
    }
  }, [promoEventName, promoDate, promoTime, promoVenue, promoDetails, promoVibe, promoLength, promoMusicBed, promoIntroSfx, promoOutroSfx, loadData]);

  const handleDeletePromo = useCallback(async (id) => {
    if (!confirm('Delete this promo request?')) return;
    try {
      await fleetAdmin.deletePromoRequest(id);
      await loadData();
    } catch (err) {
      console.error('Delete promo error:', err);
    }
  }, [loadData]);

  const generateAIScript = useCallback(async () => {
    if (!currentItem) return;
    const config = getApiConfig();
    const apiKey = config.openaiApiKey;
    if (!apiKey) {
      setSuggestedScript(getRandomScript(currentItem.baseType || currentItem.type, currentItem.dancerName));
      return;
    }

    let prompt = '';
    if (currentItem.category === 'promo' && currentItem.promoData) {
      const p = currentItem.promoData;
      prompt = `Write a short, high-energy DJ radio promo script (${p.length || '30s'} worth of speech, ${p.vibe || 'Hype'} vibe) for: Event "${p.event_name}", Date: ${p.date || 'TBD'}, Time: ${p.time || 'TBD'}, Venue: ${p.venue || 'the club'}, Details: ${p.details || 'none'}. Write ONLY the script text the DJ should read out loud. No stage directions. Make it punchy and exciting.`;
    } else if (currentItem.category === 'transition') {
      const isTransition = (currentItem.baseType || currentItem.type).startsWith('transition');
      prompt = isTransition
        ? 'Write a short, generic DJ transition line (5-15 words) for introducing the next entertainer to a strip club stage. Do NOT include any specific name. Make it exciting and varied. Write ONLY the script text.'
        : 'Write a short DJ line (5-15 words) for between songs in the same entertainer\'s set at a strip club. Do NOT include any specific name. Make it exciting. Write ONLY the script text.';
    } else {
      const t = currentItem.type;
      const typeLabel = t === 'intro' ? 'introduction' : t === 'round2' ? 'round 2 announcement' : t === 'round3' ? 'round 3 announcement' : 'outro/sendoff';
      prompt = `Write a short, high-energy DJ ${typeLabel} for an entertainer named "${currentItem.dancerName}" at a strip club. Write ONLY the script text the DJ should read (5-20 words). Make it punchy and exciting.`;
    }

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: config.scriptModel || 'gpt-4.1',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.9,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const script = data.choices?.[0]?.message?.content?.trim();
        if (script) {
          setSuggestedScript(script.replace(/^["']|["']$/g, ''));
          return;
        }
      }
    } catch {}
    setSuggestedScript(getRandomScript(currentItem.baseType || currentItem.type, currentItem.dancerName));
  }, [currentItem]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08081a] text-white flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-[#00d4ff] animate-spin" />
      </div>
    );
  }

  const tabClasses = (tab) => `flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
    activeTab === tab
      ? 'bg-[#00d4ff]/20 text-[#00d4ff] border border-[#00d4ff]/30'
      : 'text-gray-400 hover:text-white border border-transparent'
  }`;

  return (
    <div className="min-h-screen bg-[#08081a] text-white">
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Link to="/FleetDashboard" className="text-gray-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Mic className="w-5 h-5 text-[#00d4ff]" /> Voice Recording Studio
              </h1>
              <p className="text-sm text-gray-500">Record all announcements with your voice</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={loadData} className="text-gray-400 hover:text-white">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="flex gap-2 mb-4">
          <button onClick={() => { setActiveTab('entertainers'); setCurrentIndex(0); }} className={tabClasses('entertainers')}>
            Entertainers
            {totalPending > 0 && <Badge className="ml-1.5 bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] px-1.5">{totalPending}</Badge>}
          </button>
          <button onClick={() => { setActiveTab('transitions'); setCurrentIndex(0); }} className={tabClasses('transitions')}>
            Transitions
            <Badge className="ml-1.5 bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px] px-1.5">{transitionRecorded}</Badge>
          </button>
          <button onClick={() => { setActiveTab('promos'); setCurrentIndex(0); }} className={tabClasses('promos')}>
            Promos
            {promoPending > 0 && <Badge className="ml-1.5 bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] px-1.5">{promoPending}</Badge>}
          </button>
        </div>

        {activeTab === 'entertainers' && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-[#00d4ff]">{totalNames}</p>
              <p className="text-xs text-gray-500">Names</p>
            </div>
            <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-400">{totalRecorded}</p>
              <p className="text-xs text-gray-500">Recorded</p>
            </div>
            <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-400">{totalPending}</p>
              <p className="text-xs text-gray-500">Pending</p>
            </div>
          </div>
        )}

        {activeTab === 'transitions' && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-[#0d0d1f] border border-purple-500/20 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-purple-400">{transitionRecorded}</p>
              <p className="text-xs text-gray-500">Recorded</p>
            </div>
            <div className="bg-[#0d0d1f] border border-purple-500/20 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-400">{transitionQueue.filter(i => !i.isRecorded).length}</p>
              <p className="text-xs text-gray-500">Remaining</p>
            </div>
          </div>
        )}

        {activeTab === 'promos' && (
          <div className="mb-4">
            {!showPromoForm ? (
              <Button onClick={() => setShowPromoForm(true)} className="w-full bg-gradient-to-r from-[#2563eb] to-[#00d4ff] hover:from-[#1d4ed8] hover:to-[#00a3cc] text-white font-semibold py-4">
                <Plus className="w-4 h-4 mr-2" /> New Promo Request
              </Button>
            ) : (
              <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-[#00d4ff] uppercase tracking-wider">New Promo Request</h3>
                  <Button variant="ghost" size="icon" onClick={() => setShowPromoForm(false)} className="text-gray-400 hover:text-white h-6 w-6">
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <Input placeholder="Event Name *" value={promoEventName} onChange={(e) => setPromoEventName(e.target.value)} className="bg-[#08081a] border-[#1e293b] text-white" />

                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="Date (e.g. Friday March 15th)" value={promoDate} onChange={(e) => setPromoDate(e.target.value)} className="bg-[#08081a] border-[#1e293b] text-white" />
                  <Input placeholder="Time (e.g. 9pm)" value={promoTime} onChange={(e) => setPromoTime(e.target.value)} className="bg-[#08081a] border-[#1e293b] text-white" />
                </div>

                <Input placeholder="Venue" value={promoVenue} onChange={(e) => setPromoVenue(e.target.value)} className="bg-[#08081a] border-[#1e293b] text-white" />

                <textarea
                  placeholder="Details (specials, dress code, etc.)"
                  value={promoDetails}
                  onChange={(e) => setPromoDetails(e.target.value)}
                  className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white resize-none"
                  rows={2}
                />

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Vibe</label>
                  <div className="flex gap-2">
                    {VIBE_OPTIONS.map(v => (
                      <button key={v} onClick={() => setPromoVibe(v)}
                        className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          promoVibe === v ? 'bg-[#00d4ff]/20 text-[#00d4ff] border border-[#00d4ff]/30' : 'bg-[#08081a] text-gray-400 border border-[#1e293b]'
                        }`}>{v}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Length</label>
                  <div className="flex gap-2">
                    {LENGTH_OPTIONS.map(l => (
                      <button key={l} onClick={() => setPromoLength(l)}
                        className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          promoLength === l ? 'bg-[#00d4ff]/20 text-[#00d4ff] border border-[#00d4ff]/30' : 'bg-[#08081a] text-gray-400 border border-[#1e293b]'
                        }`}>{l}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Music Bed</label>
                  <select value={promoMusicBed} onChange={(e) => setPromoMusicBed(e.target.value)}
                    className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white">
                    <option value="random">Random</option>
                    <option value="none">None (voice only)</option>
                    {promoBeds.map(t => (
                      <option key={t.id} value={t.id}>{t.name || t.file_name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Intro SFX</label>
                    <select value={promoIntroSfx} onChange={(e) => setPromoIntroSfx(e.target.value)}
                      className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white">
                      {SFX_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Outro SFX</label>
                    <select value={promoOutroSfx} onChange={(e) => setPromoOutroSfx(e.target.value)}
                      className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white">
                      {SFX_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                </div>

                <Button onClick={handleSubmitPromo} disabled={!promoEventName.trim()}
                  className="w-full bg-gradient-to-r from-[#2563eb] to-[#00d4ff] hover:from-[#1d4ed8] hover:to-[#00a3cc] text-white font-semibold py-4">
                  <Radio className="w-4 h-4 mr-2" /> Create Promo Request
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="mb-4">
          <label className="text-xs text-gray-500 mb-1 block">Microphone</label>
          <select value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)}
            className="w-full bg-[#0d0d1f] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white">
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
                {currentIndex + 1} of {activeQueue.length}
              </p>

              {currentItem.category === 'promo' ? (
                <>
                  <h2 className="text-2xl font-black text-white mb-1">{currentItem.promoData?.event_name}</h2>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs px-2">{currentItem.promoData?.vibe}</Badge>
                    <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs px-2">{currentItem.promoData?.length}</Badge>
                  </div>
                  <div className="text-xs text-gray-400 space-y-0.5">
                    {currentItem.promoData?.date && <p>{currentItem.promoData.date}{currentItem.promoData?.time ? ` at ${currentItem.promoData.time}` : ''}</p>}
                    {currentItem.promoData?.venue && <p>{currentItem.promoData.venue}</p>}
                    {currentItem.promoData?.details && <p className="text-gray-500">{currentItem.promoData.details}</p>}
                  </div>
                </>
              ) : currentItem.category === 'transition' ? (
                <>
                  <h2 className="text-2xl font-black text-white mb-1">
                    {TYPE_LABELS[currentItem.baseType] || 'Transition'} #{currentItem.variationNum}
                  </h2>
                  <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-sm px-3 py-1">
                    {currentItem.baseType === 'mid_set' ? 'Between Songs' : 'Between Entertainers'}
                  </Badge>
                </>
              ) : (
                <>
                  <h2 className="text-3xl font-black text-white mb-1">{currentItem.dancerName}</h2>
                  <Badge className="bg-[#00d4ff]/20 text-[#00d4ff] border-[#00d4ff]/30 text-sm px-3 py-1">
                    {TYPE_LABELS[currentItem.type]}
                  </Badge>
                  <p className="text-xs text-gray-500 mt-2">{TYPE_PROMPTS[currentItem.type]}</p>
                </>
              )}
            </div>

            {suggestedScript && (
              <div className="bg-[#08081a] border border-[#1e293b] rounded-lg p-3 mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">Suggested Script</span>
                  <Button variant="ghost" size="sm" onClick={generateAIScript} className="text-gray-400 hover:text-[#00d4ff] h-5 px-1.5">
                    <Sparkles className="w-3 h-3 mr-1" />
                    <span className="text-[10px]">New Script</span>
                  </Button>
                </div>
                <p className="text-sm text-white italic leading-relaxed">"{suggestedScript}"</p>
              </div>
            )}

            {isRecording && <LiveMeter analyser={analyserNode} />}

            <div className="flex items-center justify-center gap-4 mt-6">
              <Button variant="ghost" size="icon"
                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0 || isRecording}
                className="text-gray-400 hover:text-white">
                <SkipBack className="w-5 h-5" />
              </Button>

              {!isRecording ? (
                <button onClick={startRecording}
                  className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center transition-all shadow-lg shadow-red-500/30 hover:scale-105 active:scale-95">
                  <Mic className="w-8 h-8 text-white" />
                </button>
              ) : (
                <button onClick={stopRecording}
                  className="w-20 h-20 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all animate-pulse shadow-lg shadow-red-500/50">
                  <Square className="w-8 h-8 text-white" />
                </button>
              )}

              <Button variant="ghost" size="icon"
                onClick={() => setCurrentIndex(Math.min(activeQueue.length - 1, currentIndex + 1))}
                disabled={currentIndex >= activeQueue.length - 1 || isRecording}
                className="text-gray-400 hover:text-white">
                <SkipForward className="w-5 h-5" />
              </Button>
            </div>

            {currentItem.isRecorded && currentItem.category !== 'promo' && (
              <div className="mt-4 text-center">
                <Button variant="ghost" size="sm"
                  onClick={() => playRecording(currentItem.dancerName, currentItem.type)}
                  className="text-[#00d4ff] hover:text-[#00d4ff]/80">
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
            <p className="text-xs text-gray-500 mt-1">
              {currentItem?.category === 'promo' ? 'Mixing voice + music bed + SFX...' : 'Applying compression, EQ, normalization'}
            </p>
          </div>
        )}

        {activeQueue.length === 0 && !isProcessing && (
          <div className="bg-[#0d0d1f] border border-[#1e293b] rounded-xl p-8 mb-6 text-center">
            {activeTab === 'promos' ? (
              <>
                <Radio className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No pending promo requests</p>
                <p className="text-xs text-gray-500 mt-1">Create a new promo request above</p>
              </>
            ) : filter === 'pending' && activeTab === 'entertainers' ? (
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

        {activeTab !== 'promos' && (
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
                      : 'text-gray-400 hover:text-white border border-transparent'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            {activeTab === 'entertainers' && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <Input placeholder="Search..." value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentIndex(0); }}
                  className="bg-[#0d0d1f] border-[#1e293b] text-white text-xs pl-8 w-40 h-8" />
              </div>
            )}
          </div>
        )}

        <div className="space-y-1 mb-6 max-h-[40vh] overflow-y-auto">
          {activeQueue.map((item, idx) => {
            const rec = item.category === 'promo' ? null
              : recordings.find(r => r.dancer_name === item.dancerName && r.recording_type === item.type);
            return (
              <div key={item.category === 'promo' ? `promo-${item.promoId}` : `${item.dancerName}-${item.type}`}
                onClick={() => setCurrentIndex(idx)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors
                  ${idx === currentIndex
                    ? 'bg-[#00d4ff]/10 border border-[#00d4ff]/30'
                    : 'bg-[#0d0d1f] border border-transparent hover:border-[#1e293b]'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  {item.isRecorded ? (
                    <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-gray-600 shrink-0" />
                  )}
                  <span className="text-sm text-white font-medium truncate">
                    {item.category === 'promo'
                      ? item.promoData?.event_name
                      : item.category === 'transition'
                        ? `${TYPE_LABELS[item.baseType] || item.baseType} #${item.variationNum}`
                        : item.dancerName}
                  </span>
                  {item.category === 'entertainer' && (
                    <Badge variant="outline" className="text-[10px] border-gray-700 text-gray-400 shrink-0">
                      {TYPE_LABELS[item.type]}
                    </Badge>
                  )}
                  {item.category === 'promo' && (
                    <Badge variant="outline" className="text-[10px] border-amber-700 text-amber-400 shrink-0">
                      {item.promoData?.vibe} {item.promoData?.length}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {item.isRecorded && item.category !== 'promo' && (
                    <>
                      <Button variant="ghost" size="icon" className="h-6 w-6"
                        onClick={(e) => { e.stopPropagation(); playRecording(item.dancerName, item.type); }}>
                        {playingId === `${item.dancerName}-${item.type}` ? (
                          <Pause className="w-3 h-3 text-[#00d4ff]" />
                        ) : (
                          <Play className="w-3 h-3 text-gray-400" />
                        )}
                      </Button>
                      {rec && (
                        <Button variant="ghost" size="icon" className="h-6 w-6"
                          onClick={(e) => { e.stopPropagation(); deleteRecording(rec.id, item.dancerName, item.type); }}>
                          <Trash2 className="w-3 h-3 text-gray-500 hover:text-red-400" />
                        </Button>
                      )}
                    </>
                  )}
                  {item.category === 'promo' && (
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={(e) => { e.stopPropagation(); handleDeletePromo(item.promoId); }}>
                      <Trash2 className="w-3 h-3 text-gray-500 hover:text-red-400" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {recordings.length > 0 && (
          <div className="border-t border-[#1e293b] pt-4">
            <Button variant="ghost" size="sm" onClick={handleExportRaw} className="text-gray-400 hover:text-white text-xs">
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Export Raw Recordings (for voice clone training)
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
