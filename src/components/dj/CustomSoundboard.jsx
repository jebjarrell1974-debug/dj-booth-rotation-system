import { useState, useEffect, useRef } from 'react';
import { Upload, Link2 } from 'lucide-react';

const getAuthHeaders = () => {
  const token = localStorage.getItem('djbooth_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const apiFetch = (path, opts = {}) =>
  fetch(path, { ...opts, headers: { ...getAuthHeaders(), ...(opts.headers || {}) } }).then(r => r.json());

export default function CustomSoundboard({ volume = 1, sfxBoost = 1 }) {
  const [sounds, setSounds] = useState([]);
  const [addMode, setAddMode] = useState(null);
  const [urlInput, setUrlInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState('');
  const [playingId, setPlayingId] = useState(null);
  const fileRef = useRef();
  const audioRef = useRef(null);

  const load = async () => {
    try {
      const data = await apiFetch('/api/soundboard');
      if (Array.isArray(data)) setSounds(data);
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const playSound = (id) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const token = localStorage.getItem('djbooth_token');
    const url = token
      ? `/api/soundboard/audio/${id}?token=${encodeURIComponent(token)}`
      : `/api/soundboard/audio/${id}`;
    const audio = new Audio(url);
    audio.volume = Math.min(1, Math.max(0, volume * sfxBoost));
    audio.play().catch(() => {});
    audioRef.current = audio;
    setPlayingId(id);
    audio.onended = () => setPlayingId(null);
  };

  const handleUpload = (file) => {
    if (!file) return;
    const autoName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    const soundName = nameInput.trim() || autoName;
    setBusy(true);
    setError('');
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64 = e.target.result.split(',')[1];
        const ext = file.name.split('.').pop().toLowerCase();
        const res = await apiFetch('/api/soundboard/upload', {
          method: 'POST',
          body: JSON.stringify({ name: soundName, audio_base64: base64, ext }),
        });
        if (res.ok) {
          setNameInput('');
          setAddMode(null);
          await load();
        } else {
          setError(res.error || 'Upload failed');
        }
      } catch {
        setError('Upload failed');
      }
      setBusy(false);
    };
    reader.readAsDataURL(file);
  };

  const handleFetchUrl = async () => {
    const name = nameInput.trim();
    const url = urlInput.trim();
    if (!name || !url) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/soundboard/fetch-url', {
        method: 'POST',
        body: JSON.stringify({ name, url }),
      });
      if (res.ok) {
        setUrlInput('');
        setNameInput('');
        setAddMode(null);
        await load();
      } else {
        setError(res.error || 'Fetch failed');
      }
    } catch {
      setError('Fetch failed');
    }
    setBusy(false);
  };

  const handleDelete = async (id) => {
    await apiFetch(`/api/soundboard/${id}`, { method: 'DELETE' });
    setSounds(s => s.filter(x => x.id !== id));
    if (playingId === id && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingId(null);
    }
  };

  const startEdit = (id, currentName, e) => {
    e.stopPropagation();
    setEditingId(id);
    setEditingName(currentName);
  };

  const commitRename = async (id) => {
    const name = editingName.trim();
    if (!name) { setEditingId(null); return; }
    await apiFetch(`/api/soundboard/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
    setSounds(s => s.map(x => x.id === id ? { ...x, name } : x));
    setEditingId(null);
  };

  const cancelAdd = () => {
    setAddMode(null);
    setNameInput('');
    setUrlInput('');
    setError('');
  };

  return (
    <div>
      <div className="text-xs text-[#f59e0b] uppercase tracking-wider mb-2">My Sounds</div>

      {sounds.length === 0 && !addMode && (
        <div className="text-xs text-gray-600 italic mb-3 px-1">
          No custom sounds yet. Upload a file or paste a direct URL.
        </div>
      )}

      {sounds.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {sounds.map(s => (
            <div key={s.id} className="relative group">
              <button
                onPointerDown={() => playSound(s.id)}
                className={`w-full flex flex-col items-center justify-center gap-1 h-20 rounded-2xl border transition-all select-none
                  ${playingId === s.id
                    ? 'bg-[#f59e0b]/20 border-[#f59e0b]/70 scale-95'
                    : 'bg-[#0d0d1f] border-[#f59e0b]/20 active:bg-[#f59e0b]/15 active:border-[#f59e0b]/60 active:scale-95'
                  }`}>
                <span className="text-2xl leading-none">{playingId === s.id ? '🔊' : '🎵'}</span>
                {editingId === s.id ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onBlur={() => commitRename(s.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename(s.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={e => e.stopPropagation()}
                    onPointerDown={e => e.stopPropagation()}
                    className="text-xs text-center bg-transparent border-b border-amber-400 outline-none w-full px-1 text-white"
                  />
                ) : (
                  <span
                    className="text-xs text-gray-400 leading-tight text-center px-1 line-clamp-2"
                    onPointerDown={e => startEdit(s.id, s.name, e)}>
                    {s.name}
                  </span>
                )}
              </button>
              <button
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-red-400 text-sm font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity leading-none"
                onPointerDown={e => { e.stopPropagation(); handleDelete(s.id); }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {addMode === null ? (
        <div className="flex gap-2">
          <button
            onClick={() => { setAddMode('upload'); setNameInput(''); setError(''); }}
            className="flex-1 h-10 rounded-xl bg-[#1e293b] text-amber-400 text-xs font-semibold hover:bg-[#2e2e5a] flex items-center justify-center gap-1 transition-colors">
            <Upload size={13} /> Upload File
          </button>
          <button
            onClick={() => { setAddMode('url'); setNameInput(''); setUrlInput(''); setError(''); }}
            className="flex-1 h-10 rounded-xl bg-[#1e293b] text-amber-400 text-xs font-semibold hover:bg-[#2e2e5a] flex items-center justify-center gap-1 transition-colors">
            <Link2 size={13} /> Paste URL
          </button>
        </div>
      ) : (
        <div className="bg-[#0d0d1f] border border-[#f59e0b]/25 rounded-xl p-3 space-y-2">
          <input
            type="text"
            placeholder={addMode === 'upload' ? 'Sound name (optional — auto from filename)' : 'Sound name'}
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            className="w-full h-9 rounded-lg bg-[#1e293b] text-white text-sm px-3 outline-none placeholder-gray-600 border border-transparent focus:border-amber-500/40"
          />

          {addMode === 'upload' ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".mp3,.wav,.ogg,.m4a,.aac,.flac"
                className="hidden"
                onChange={e => handleUpload(e.target.files[0])}
              />
              <button
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="w-full h-9 rounded-lg bg-amber-500/20 text-amber-300 text-sm font-semibold disabled:opacity-40 hover:bg-amber-500/30 transition-colors">
                {busy ? 'Uploading…' : 'Choose Audio File'}
              </button>
            </>
          ) : (
            <>
              <input
                type="url"
                placeholder="https://assets.mixkit.co/sfx/preview/…"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleFetchUrl()}
                className="w-full h-9 rounded-lg bg-[#1e293b] text-white text-sm px-3 outline-none placeholder-gray-600 border border-transparent focus:border-amber-500/40"
              />
              <button
                disabled={busy || !urlInput.trim() || !nameInput.trim()}
                onClick={handleFetchUrl}
                className="w-full h-9 rounded-lg bg-amber-500/20 text-amber-300 text-sm font-semibold disabled:opacity-40 hover:bg-amber-500/30 transition-colors">
                {busy ? 'Fetching…' : 'Fetch Sound'}
              </button>
            </>
          )}

          {error && <div className="text-xs text-red-400 text-center">{error}</div>}
          <button onClick={cancelAdd} className="w-full h-7 text-gray-600 text-xs hover:text-gray-400 transition-colors">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
