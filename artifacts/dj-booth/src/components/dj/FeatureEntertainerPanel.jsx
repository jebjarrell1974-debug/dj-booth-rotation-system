import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Star, Trash2, Play, Square, Loader2, Save, Sparkles, Folder, Music } from 'lucide-react';
import { getApiConfig, FORCED_VOICE_ID } from '@/components/apiConfig';

function authHeaders() {
  const token = localStorage.getItem('djbooth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getElevenLabsConfig() {
  try {
    const cfg = getApiConfig();
    return { apiKey: cfg.elevenLabsApiKey || '', voiceId: FORCED_VOICE_ID };
  } catch {
    return { apiKey: '', voiceId: FORCED_VOICE_ID };
  }
}

async function elevenLabsTTS(script) {
  const { apiKey, voiceId } = getElevenLabsConfig();
  if (!apiKey || !voiceId) throw new Error('ElevenLabs API key / voice ID not configured in Options');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: script,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.6, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${txt.slice(0, 200)}`);
  }
  const buf = await res.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function buildDefaultIntroScript(d) {
  const name = d?.name || 'our feature entertainer';
  const titles = (d?.feature_titles || '').trim();
  const awards = (d?.feature_awards || '').trim();
  const websites = (d?.feature_websites || '').trim();
  const notes = (d?.feature_notes || '').trim();
  const lines = [`Ladies and gentlemen, the moment you've been waiting for!`];
  lines.push(`Please welcome to the stage, the one, the only — ${name}!`);
  if (titles) lines.push(titles);
  if (awards) lines.push(awards);
  if (notes) lines.push(notes);
  if (websites) lines.push(`Find her at ${websites}.`);
  lines.push(`Show her some love — make some noise for ${name}!`);
  return lines.join(' ');
}

function buildDefaultOutroScript(d) {
  const name = d?.name || 'our feature entertainer';
  const websites = (d?.feature_websites || '').trim();
  const lines = [`Make some noise one more time for the incredible ${name}!`];
  lines.push(`What a performance — give it up!`);
  if (websites) lines.push(`Follow her at ${websites}.`);
  lines.push(`Tip your entertainers, tip your bartenders, and stay right here — we're just getting started!`);
  return lines.join(' ');
}

export default function FeatureEntertainerPanel({
  dancers,
  onRefreshDancers,
  rotation = [],
  currentDancerIndex = 0,
  songsPerSet = 0,
  breakSongsPerSet = 0,
  placedFeatures = {},
  onPlaceFeature,
  onCancelFeature,
}) {
  const features = useMemo(
    () => (dancers || []).filter(d => d.entertainer_type === 'feature').sort((a, b) => a.name.localeCompare(b.name)),
    [dancers]
  );

  const [selectedId, setSelectedId] = useState(null);
  const selected = features.find(d => d.id === selectedId) || null;

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editAwards, setEditAwards] = useState('');
  const [editTitles, setEditTitles] = useState('');
  const [editWebsites, setEditWebsites] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  const [introScript, setIntroScript] = useState('');
  const [outroScript, setOutroScript] = useState('');
  const [beds, setBeds] = useState([]);
  const [introBed, setIntroBed] = useState('');
  const [outroBed, setOutroBed] = useState('');
  const [producingIntro, setProducingIntro] = useState(false);
  const [producingOutro, setProducingOutro] = useState(false);
  const [introExists, setIntroExists] = useState(false);
  const [outroExists, setOutroExists] = useState(false);

  const [folders, setFolders] = useState([]);
  const [folderTracks, setFolderTracks] = useState([]);
  const [pickedFolder, setPickedFolder] = useState('');
  const [loadingShow, setLoadingShow] = useState(false);

  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(null);

  const [selectedSet, setSelectedSet] = useState('');

  useEffect(() => {
    fetch('/api/features/beds', { headers: authHeaders() })
      .then(r => r.json()).then(d => setBeds(d.beds || [])).catch(() => setBeds([]));
    fetch('/api/features/music-folders', { headers: authHeaders() })
      .then(r => r.json()).then(d => setFolders(d.folders || [])).catch(() => setFolders([]));
  }, []);

  useEffect(() => {
    if (!selected) {
      setEditAwards(''); setEditTitles(''); setEditWebsites(''); setEditNotes('');
      setIntroScript(''); setOutroScript('');
      setIntroExists(false); setOutroExists(false);
      setPickedFolder(''); setFolderTracks([]);
      return;
    }
    setEditAwards(selected.feature_awards || '');
    setEditTitles(selected.feature_titles || '');
    setEditWebsites(selected.feature_websites || '');
    setEditNotes(selected.feature_notes || '');
    setPickedFolder(selected.feature_music_folder || '');
    fetch(`/api/features/${selected.id}/status`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        setIntroExists(!!d.intro?.exists);
        setOutroExists(!!d.outro?.exists);
        setIntroScript(d.intro?.script || buildDefaultIntroScript(selected));
        setOutroScript(d.outro?.script || buildDefaultOutroScript(selected));
      })
      .catch(() => {
        setIntroScript(buildDefaultIntroScript(selected));
        setOutroScript(buildDefaultOutroScript(selected));
      });
    if (selected.feature_music_folder) {
      fetch(`/api/features/folder-tracks/${encodeURIComponent(selected.feature_music_folder)}`, { headers: authHeaders() })
        .then(r => r.json()).then(d => setFolderTracks(d.tracks || [])).catch(() => setFolderTracks([]));
    } else {
      setFolderTracks([]);
    }
  }, [selectedId, selected?.feature_awards, selected?.feature_titles, selected?.feature_websites, selected?.feature_notes, selected?.feature_music_folder]);

  // Default the set selection: keep an already-placed set, else auto-pick when she
  // only has one, else force the DJ to choose.
  useEffect(() => {
    const placed = selectedId ? (placedFeatures?.[selectedId] || null) : null;
    if (placed?.chosenSetName && folderTracks.includes(placed.chosenSetName)) {
      setSelectedSet(placed.chosenSetName);
    } else if (folderTracks.length === 1) {
      setSelectedSet(folderTracks[0]);
    } else {
      setSelectedSet('');
    }
  }, [selectedId, folderTracks, placedFeatures]);

  const createFeature = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch('/api/dancers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name,
          color: '#a855f7',
          entertainer_type: 'feature',
          feature_awards: '', feature_titles: '', feature_websites: '', feature_notes: '',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Create failed (${res.status})`);
      }
      const created = await res.json();
      setNewName('');
      if (onRefreshDancers) await onRefreshDancers();
      setSelectedId(created.id);
    } catch (e) {
      alert(`Couldn't create feature: ${e.message}`);
    } finally {
      setCreating(false);
    }
  }, [newName, onRefreshDancers]);

  const deleteFeature = useCallback(async (id) => {
    if (!confirm('Delete this feature entertainer? Her produced intro/outro audio will be wiped too.')) return;
    try {
      await fetch(`/api/dancers/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (onRefreshDancers) await onRefreshDancers();
      if (selectedId === id) setSelectedId(null);
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  }, [selectedId, onRefreshDancers]);

  const saveMeta = useCallback(async () => {
    if (!selected) return;
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/dancers/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          feature_awards: editAwards,
          feature_titles: editTitles,
          feature_websites: editWebsites,
          feature_notes: editNotes,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      if (onRefreshDancers) await onRefreshDancers();
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSavingMeta(false);
    }
  }, [selected, editAwards, editTitles, editWebsites, editNotes, onRefreshDancers]);

  const produce = useCallback(async (mode) => {
    if (!selected) return;
    const script = (mode === 'intro' ? introScript : outroScript).trim();
    if (!script) { alert(`${mode} script is empty`); return; }
    const setBusy = mode === 'intro' ? setProducingIntro : setProducingOutro;
    setBusy(true);
    try {
      const audio_base64 = await elevenLabsTTS(script);
      const res = await fetch(`/api/features/${selected.id}/produce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          type: mode,
          script,
          audio_base64,
          bed_file_name: (mode === 'intro' ? introBed : outroBed) || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Produce failed (${res.status})`);
      if (mode === 'intro') setIntroExists(true); else setOutroExists(true);
      alert(`${mode === 'intro' ? 'Intro' : 'Outro'} produced! Bed used: ${data.bed_used}`);
    } catch (e) {
      alert(`${mode} produce failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [selected, introScript, outroScript, introBed, outroBed]);

  const previewAudio = useCallback((mode) => {
    if (!selected) return;
    if (playing === mode) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const url = `/api/features/${selected.id}/audio/${mode}?t=${Date.now()}`;
    const a = new Audio(url);
    a.onended = () => setPlaying(null);
    a.onerror = () => { setPlaying(null); alert(`Couldn't load ${mode} audio — produce it first?`); };
    a.play().catch(e => { setPlaying(null); alert(`Play failed: ${e.message}`); });
    audioRef.current = a;
    setPlaying(mode);
  }, [selected, playing]);

  const loadShow = useCallback(async () => {
    if (!selected || !pickedFolder) return;
    setLoadingShow(true);
    try {
      const res = await fetch(`/api/dancers/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ feature_music_folder: pickedFolder }),
      });
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const t = await fetch(`/api/features/folder-tracks/${encodeURIComponent(pickedFolder)}`, { headers: authHeaders() });
      const d = await t.json();
      setFolderTracks(d.tracks || []);
      if (onRefreshDancers) await onRefreshDancers();
      alert(`Loaded show "${pickedFolder}" — ${d.tracks?.length || 0} track(s) for ${selected.name}.`);
    } catch (e) {
      alert(`Load show failed: ${e.message}`);
    } finally {
      setLoadingShow(false);
    }
  }, [selected, pickedFolder, onRefreshDancers]);

  const placement = selected ? (placedFeatures?.[selected.id] || null) : null;
  // Once she's the on-stage dancer her show has started — placement is locked
  // (moving would double-add her; cancelling would break the running set/outro).
  const curId = (rotation || [])[currentDancerIndex] ?? null;
  const isOnStage = !!selected && selected.id === curId;

  const slotOptions = useMemo(() => {
    if (!selected) return [];
    const rotWithout = (rotation || []).filter(id => id !== selected.id);
    const n = rotWithout.length;
    if (n === 0) return [];
    // Match the booth's CIRCULAR play order: walk from the current dancer forward,
    // wrapping to the front. pos is 1-based (1 = next on stage).
    const curId = (rotation || [])[currentDancerIndex] ?? null;
    let baseIdx = curId != null ? rotWithout.indexOf(curId) : -1;
    if (baseIdx === -1) baseIdx = Math.min(currentDancerIndex || 0, n - 1);
    const setMin = (Number(songsPerSet) || 0) * 3.5 + (Number(breakSongsPerSet) || 0) * 3.5;
    const out = [{ label: 'Next on stage', pos: 1, minutes: Math.round(setMin * 0.5) }];
    for (let k = 1; k <= n - 1; k++) {
      const d = (dancers || []).find(x => x.id === rotWithout[(baseIdx + k) % n]);
      if (!d) continue;
      out.push({ label: `After ${d.name}`, pos: k + 1, minutes: Math.round(k * setMin + setMin * 0.5) });
    }
    return out;
  }, [selected, rotation, currentDancerIndex, songsPerSet, breakSongsPerSet, dancers]);

  const fmtMin = (m) => (m >= 60 ? `~${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `~${m} min`);

  return (
    <div className="h-full flex flex-col gap-4 text-white">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-purple-400" />
        <h2 className="text-lg font-semibold">Feature Entertainers</h2>
      </div>

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
        {/* LEFT: list + add */}
        <div className="col-span-3 flex flex-col gap-3 bg-[#0a0a1a] border border-[#1e293b] rounded-lg p-3 min-h-0">
          <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">Add Feature</div>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Feature name..."
              className="bg-[#08081a] border-[#1e293b] text-white"
              onKeyDown={(e) => { if (e.key === 'Enter') createFeature(); }}
            />
            <Button
              onClick={createFeature}
              disabled={creating || !newName.trim()}
              className="bg-purple-500 hover:bg-purple-600 text-white"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold mt-2">Roster</div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="flex flex-col gap-1">
              {features.length === 0 && (
                <div className="text-gray-500 text-sm italic p-2">No features yet. Add one above.</div>
              )}
              {features.map(d => (
                <div
                  key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  className={`flex items-center justify-between gap-2 p-2 rounded cursor-pointer ${
                    selectedId === d.id ? 'bg-purple-500/20 border border-purple-500/40' : 'hover:bg-[#151528]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Star className="w-4 h-4 text-purple-400 flex-shrink-0" />
                    <span className="truncate">{d.name}</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteFeature(d.id); }}
                    className="text-gray-500 hover:text-red-400 flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* RIGHT: details / producer / show */}
        <div className="col-span-9 flex flex-col gap-3 min-h-0 overflow-auto pr-1">
          {!selected ? (
            <div className="bg-[#0a0a1a] border border-[#1e293b] rounded-lg p-6 text-center text-gray-500">
              Pick a feature on the left, or add a new one to get started.
            </div>
          ) : (
            <>
              {/* META */}
              <div className="bg-[#0a0a1a] border border-[#1e293b] rounded-lg p-3 flex flex-col gap-2">
                <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">
                  Info for {selected.name}'s intros
                </div>
                <textarea
                  value={editTitles}
                  onChange={(e) => setEditTitles(e.target.value)}
                  placeholder="Titles (e.g. Miss Exotic World 2025)"
                  className="bg-[#08081a] border border-[#1e293b] rounded p-2 text-sm min-h-[40px] resize-y"
                />
                <textarea
                  value={editAwards}
                  onChange={(e) => setEditAwards(e.target.value)}
                  placeholder="Awards (e.g. Three-time winner of...)"
                  className="bg-[#08081a] border border-[#1e293b] rounded p-2 text-sm min-h-[40px] resize-y"
                />
                <textarea
                  value={editWebsites}
                  onChange={(e) => setEditWebsites(e.target.value)}
                  placeholder="Websites / socials (e.g. @hername on Insta)"
                  className="bg-[#08081a] border border-[#1e293b] rounded p-2 text-sm min-h-[40px] resize-y"
                />
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Notes / one-liner (any extra detail to weave into the intro)"
                  className="bg-[#08081a] border border-[#1e293b] rounded p-2 text-sm min-h-[40px] resize-y"
                />
                <Button onClick={saveMeta} disabled={savingMeta} className="bg-[#00d4ff] hover:bg-[#00a3cc] text-black self-end">
                  {savingMeta ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-1" /> Save Info</>}
                </Button>
              </div>

              {/* PRODUCER */}
              <div className="bg-[#0a0a1a] border border-[#1e293b] rounded-lg p-3 flex flex-col gap-3">
                <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">
                  Intro / Outro Producer (voice + music bed)
                </div>
                {beds.length === 0 && (
                  <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-2">
                    No bed files found. Drop short loops into <code className="text-amber-300">music/feature-beds/</code> on the unit.
                  </div>
                )}

                {/* INTRO */}
                <div className="border border-[#1e293b] rounded p-2 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-purple-300">Intro {introExists && <span className="text-xs text-emerald-400 ml-2">✓ produced</span>}</div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setIntroScript(buildDefaultIntroScript(selected))} className="text-xs text-gray-400 hover:text-white">Reset template</Button>
                    </div>
                  </div>
                  <textarea
                    value={introScript}
                    onChange={(e) => setIntroScript(e.target.value)}
                    placeholder="Intro script — what the announcer says..."
                    className="bg-[#08081a] border border-[#1e293b] rounded p-2 text-sm min-h-[80px] resize-y"
                  />
                  <div className="flex gap-2 items-center">
                    <select value={introBed} onChange={(e) => setIntroBed(e.target.value)} className="bg-[#08081a] border border-[#1e293b] rounded p-1 text-xs">
                      <option value="">Random bed</option>
                      {beds.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                    </select>
                    <Button onClick={() => produce('intro')} disabled={producingIntro || beds.length === 0} className="bg-purple-500 hover:bg-purple-600 text-white">
                      {producingIntro ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Producing...</> : (introExists ? 'Re-create Intro' : 'Create Intro')}
                    </Button>
                    <Button onClick={() => previewAudio('intro')} disabled={!introExists} variant="outline" className="border-[#1e293b]">
                      {playing === 'intro' ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </Button>
                  </div>
                  <div className="text-xs text-gray-500">Bed lead-in, voice with bed ducked, hard cut on end (no fade — her first song hits clean).</div>
                </div>

                {/* OUTRO */}
                <div className="border border-[#1e293b] rounded p-2 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-purple-300">Outro {outroExists && <span className="text-xs text-emerald-400 ml-2">✓ produced</span>}</div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setOutroScript(buildDefaultOutroScript(selected))} className="text-xs text-gray-400 hover:text-white">Reset template</Button>
                    </div>
                  </div>
                  <textarea
                    value={outroScript}
                    onChange={(e) => setOutroScript(e.target.value)}
                    placeholder="Outro script — what the announcer says when she finishes..."
                    className="bg-[#08081a] border border-[#1e293b] rounded p-2 text-sm min-h-[80px] resize-y"
                  />
                  <div className="flex gap-2 items-center">
                    <select value={outroBed} onChange={(e) => setOutroBed(e.target.value)} className="bg-[#08081a] border border-[#1e293b] rounded p-1 text-xs">
                      <option value="">Random bed</option>
                      {beds.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                    </select>
                    <Button onClick={() => produce('outro')} disabled={producingOutro || beds.length === 0} className="bg-purple-500 hover:bg-purple-600 text-white">
                      {producingOutro ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Producing...</> : (outroExists ? 'Re-create Outro' : 'Create Outro')}
                    </Button>
                    <Button onClick={() => previewAudio('outro')} disabled={!outroExists} variant="outline" className="border-[#1e293b]">
                      {playing === 'outro' ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </Button>
                  </div>
                  <div className="text-xs text-gray-500">Bed lead-in, voice with bed ducked, gradual fade out at the end.</div>
                </div>
              </div>

              {/* SHOW */}
              <div className="bg-[#0a0a1a] border border-[#1e293b] rounded-lg p-3 flex flex-col gap-2">
                <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">Music Show</div>
                <div className="flex gap-2 items-center">
                  <Folder className="w-4 h-4 text-gray-400" />
                  <select value={pickedFolder} onChange={(e) => setPickedFolder(e.target.value)} className="bg-[#08081a] border border-[#1e293b] rounded p-1 text-sm flex-1">
                    <option value="">— Pick a folder —</option>
                    {folders.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <Button onClick={loadShow} disabled={loadingShow || !pickedFolder} className="bg-[#00d4ff] hover:bg-[#00a3cc] text-black">
                    {loadingShow ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load'}
                  </Button>
                </div>
                {selected.feature_music_folder && (
                  <div className="text-xs text-emerald-300">
                    Current show: <strong>{selected.feature_music_folder}</strong> ({folderTracks.length} track{folderTracks.length === 1 ? '' : 's'})
                  </div>
                )}
                {folderTracks.length > 0 && (
                  <>
                    <div className="text-xs text-gray-400">Pick the set for her next show:</div>
                    <div className="text-xs max-h-32 overflow-auto border border-[#1e293b] rounded p-2 flex flex-col gap-1">
                      {folderTracks.map(t => (
                        <label
                          key={t}
                          className={`flex items-center gap-2 truncate cursor-pointer rounded px-1 py-0.5 ${
                            selectedSet === t ? 'bg-purple-500/20 text-purple-200' : 'text-gray-400 hover:bg-[#151528]'
                          }`}
                        >
                          <input
                            type="radio"
                            name="feature-set"
                            checked={selectedSet === t}
                            onChange={() => setSelectedSet(t)}
                            className="accent-purple-500 flex-shrink-0"
                          />
                          <Music className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{t}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <div className="text-xs text-gray-500">Each file is one complete set. Pick the one she'll perform, then place her in the line-up below.</div>
              </div>

              {/* SHOWTIME — place her in the upcoming line-up */}
              <div className="bg-[#0a0a1a] border border-[#1e293b] rounded-lg p-3 flex flex-col gap-2">
                <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">Showtime — Place {selected.name}</div>
                {placement && (
                  <div className="flex items-center justify-between gap-2 bg-purple-500/10 border border-purple-500/30 rounded p-2">
                    <div className="text-sm text-purple-200 min-w-0">
                      {isOnStage
                        ? <>On stage now — her show is running. She'll auto-leave when it ends.</>
                        : <>In the line-up{placement.chosenSetName ? <> — set <strong className="break-all">{placement.chosenSetName}</strong></> : null}. She'll auto-leave after her set.</>}
                    </div>
                    {!isOnStage && (
                      <Button
                        size="sm"
                        onClick={() => onCancelFeature && onCancelFeature(selected.id)}
                        className="bg-red-500/80 hover:bg-red-600 text-white flex-shrink-0"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                )}
                {isOnStage ? (
                  <div className="text-xs text-purple-300">Her show is live on stage right now — placement is locked until it ends.</div>
                ) : folderTracks.length === 0 ? (
                  <div className="text-xs text-amber-400">Load a music folder above first — that's where her sets come from.</div>
                ) : (
                  <>
                    {!selectedSet && <div className="text-xs text-amber-400">Pick which set plays (above) to enable placement.</div>}
                    {!introExists && <div className="text-xs text-amber-400/80">Heads up: no intro produced yet — she'll get a generated one.</div>}
                    {!outroExists && <div className="text-xs text-amber-400/80">Heads up: no outro produced yet — she'll get a generated one.</div>}
                    <div className="text-xs text-gray-400">{placement ? 'Move her to a different spot:' : 'Drop her into the upcoming line-up:'}</div>
                    <div className="flex flex-col gap-1 max-h-48 overflow-auto">
                      {slotOptions.length === 0 && (
                        <div className="text-xs text-gray-500 italic">Start a rotation first, then place her into it.</div>
                      )}
                      {slotOptions.map(s => (
                        <div key={s.pos} className="flex items-center justify-between gap-2 border border-[#1e293b] rounded p-2">
                          <div className="text-sm truncate">
                            {s.label} <span className="text-gray-500">({fmtMin(s.minutes)})</span>
                          </div>
                          <Button
                            size="sm"
                            disabled={!selectedSet || !onPlaceFeature}
                            onClick={() => onPlaceFeature(selected.id, selectedSet, s.pos, { introExists, outroExists })}
                            className="bg-purple-500 hover:bg-purple-600 text-white flex-shrink-0"
                          >
                            {placement ? 'Move here' : 'Place here'}
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-gray-500">Intro plays, the chosen set runs start-to-finish, then her outro — and she auto-leaves the rotation. Times are rough estimates.</div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
