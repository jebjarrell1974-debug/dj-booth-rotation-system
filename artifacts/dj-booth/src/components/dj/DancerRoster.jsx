import React, { useState, useMemo, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UserPlus, Edit2, Trash2, Music, User, ListMusic, Plus, Minus, RotateCcw, Delete } from 'lucide-react';

const clearDancerFromIndexedDB = async (dancerName) => {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('djAnnouncementsDB', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('announcements', 'readwrite');
    const store = tx.objectStore('announcements');
    const allKeys = await new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const matches = allKeys.filter(k => k.includes(dancerName));
    for (const key of matches) store.delete(key);
    await new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; });
    console.log(`🧹 Cleared ${matches.length} IndexedDB voiceover entries for "${dancerName}"`);
    return matches.length;
  } catch (e) {
    console.error('Failed to clear IndexedDB voiceovers:', e);
    return 0;
  }
};

const DANCER_COLORS = [
  '#00d4ff', '#ff2d55', '#00e5ff', '#2563eb', '#39ff14', 
  '#ff6b35', '#ff1493', '#00bfff', '#ff4081', '#00ffc8'
];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function DancerRoster({ 
  dancers, 
  rotation = [],
  onAddToRotation,
  onRemoveFromRotation,
  onPullAll,
  onAddDancer, 
  onEditDancer, 
  onDeleteDancer,
  onEditPlaylist,
  selectedDancerId,
  dancerVipMap = {},
  pendingVipState = {},
  onSendToVip,
  onReleaseFromVip
}) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [pullAllConfirmOpen, setPullAllConfirmOpen] = useState(false);
  const [newDancerName, setNewDancerName] = useState('');
  const [newDancerPin, setNewDancerPin] = useState('');
  const [newDancerPhonetic, setNewDancerPhonetic] = useState('');
  const [addError, setAddError] = useState('');
  const [editingDancer, setEditingDancer] = useState(null);
  const [editingPin, setEditingPin] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePin, setDeletePin] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [vipPickerDancerId, setVipPickerDancerId] = useState(null);

  const gridRef = useRef(null);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    onDeleteDancer(deleteTarget.id);
    setDeleteTarget(null);
    setDeletePin('');
    setIsDeleting(false);
  };

  const handleAdd = async () => {
    if (newDancerName.trim() && newDancerPin.length === 5 && !isAdding) {
      setIsAdding(true);
      setAddError('');
      const color = DANCER_COLORS[dancers.length % DANCER_COLORS.length];
      
      try {
        await onAddDancer({ 
          name: newDancerName.trim(), 
          color, 
          pin: newDancerPin,
          phonetic_name: newDancerPhonetic.trim(),
          playlist: [], 
          is_active: true 
        });
        await new Promise(resolve => setTimeout(resolve, 300));
        setNewDancerName('');
        setNewDancerPin('');
        setNewDancerPhonetic('');
        setIsAddOpen(false);
      } catch (error) {
        console.error('Failed to add dancer:', error);
        setAddError(error.message || 'Failed to add entertainer');
      } finally {
        setIsAdding(false);
      }
    }
  };

  const [resettingVoiceovers, setResettingVoiceovers] = useState(false);
  const [voiceoverResetCount, setVoiceoverResetCount] = useState(null);

  const resetVoiceoversForDancer = async (dancerName) => {
    setResettingVoiceovers(true);
    setVoiceoverResetCount(null);
    try {
      const token = localStorage.getItem('djbooth_token');
      const res = await fetch(`/api/voiceovers/dancer/${encodeURIComponent(dancerName)}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      await clearDancerFromIndexedDB(dancerName);
      if (res.ok) {
        const data = await res.json();
        setVoiceoverResetCount(data.deleted || 0);
        setTimeout(() => setVoiceoverResetCount(null), 3000);
      }
    } catch (e) {
      console.error('Failed to reset voiceovers:', e);
    } finally {
      setResettingVoiceovers(false);
    }
  };

  const handleEdit = async () => {
    if (editingDancer && editingDancer.name.trim()) {
      const original = dancers.find(d => d.id === editingDancer.id);
      if (!original) {
        setEditingDancer(null);
        return;
      }
      const phoneticChanged = (original.phonetic_name || '') !== (editingDancer.phonetic_name || '');
      const nameChanged = original.name !== editingDancer.name;
      const oldName = original.name;

      const updatePayload = { name: editingDancer.name, phonetic_name: editingDancer.phonetic_name || '' };
      if (editingPin.length === 5) updatePayload.pin = editingPin;

      onEditDancer(editingDancer.id, updatePayload);

      if (phoneticChanged || nameChanged) {
        await resetVoiceoversForDancer(oldName);
        if (nameChanged) {
          await resetVoiceoversForDancer(editingDancer.name);
        }
      }

      setEditingDancer(null);
      setEditingPin('');
    }
  };

  const sortedDancers = [...dancers].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const activeDancers = sortedDancers.filter(d => d.is_active);

  const firstIdByLetter = useMemo(() => {
    const map = new Map();
    for (const d of sortedDancers) {
      const ch = (d.name?.charAt(0) || '').toUpperCase();
      if (ch >= 'A' && ch <= 'Z' && !map.has(ch)) map.set(ch, d.id);
    }
    return map;
  }, [sortedDancers]);

  const availableLetters = useMemo(
    () => new Set(firstIdByLetter.keys()),
    [firstIdByLetter]
  );

  const handleLetterTap = (letter) => {
    const root = gridRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-section-letter="${letter}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">
            Entertainer Roster
          </h3>
          <p className="text-xs text-gray-500 mt-1">{activeDancers.length} active</p>
        </div>
        <div className="flex items-center gap-2">
          {rotation.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-red-700/60 text-red-400 hover:bg-red-900/30 hover:text-red-300"
              onClick={() => setPullAllConfirmOpen(true)}
            >
              <Minus className="w-3.5 h-3.5 mr-1" />
              Pull All
            </Button>
          )}
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-[#00d4ff] hover:bg-[#00a3cc] text-black">
                <UserPlus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </DialogTrigger>
          <DialogContent className="bg-[#151528] border-[#1e293b] text-white">
            <DialogHeader>
              <DialogTitle>Add New Entertainer</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <Input
                value={newDancerName}
                onChange={(e) => setNewDancerName(e.target.value)}
                placeholder="Stage name..."
                className="bg-[#0d0d1f] border-[#1e293b]"
                autoFocus
              />
              <div>
                <Input
                  value={newDancerPhonetic}
                  onChange={(e) => setNewDancerPhonetic(e.target.value)}
                  placeholder="Pronunciation (e.g. Jee-Jee for GIGI)"
                  className="bg-[#0d0d1f] border-[#1e293b]"
                />
                <p className="text-xs text-gray-500 mt-1">How the DJ voice should say the name — leave blank if it sounds fine</p>
              </div>
              <div>
                <Input
                  value={newDancerPin}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 5);
                    setNewDancerPin(val);
                  }}
                  placeholder="5-digit PIN..."
                  className="bg-[#0d0d1f] border-[#1e293b]"
                  inputMode="numeric"
                  maxLength={5}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
                <p className="text-xs text-gray-500 mt-1">Entertainer uses this PIN to log in on their phone</p>
              </div>
              {addError && <p className="text-sm text-red-400">{addError}</p>}
              <Button 
                onClick={handleAdd} 
                disabled={isAdding || !newDancerName.trim() || newDancerPin.length !== 5}
                className="w-full bg-[#00d4ff] hover:bg-[#00a3cc] text-black"
              >
                {isAdding ? 'Adding...' : 'Add Entertainer'}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      
      <div className="flex-1 flex gap-2 min-h-0">
        {activeDancers.length > 0 && (
          <div
            className="flex flex-col items-stretch py-1 select-none"
            aria-label="Jump to letter"
          >
            {ALPHABET.map((letter) => {
              const has = availableLetters.has(letter);
              return (
                <button
                  key={letter}
                  type="button"
                  disabled={!has}
                  onClick={() => has && handleLetterTap(letter)}
                  className={`flex-1 min-h-[26px] w-8 flex items-center justify-center text-[11px] font-bold rounded transition-all touch-manipulation ${
                    has
                      ? 'text-[#00d4ff] hover:bg-[#00d4ff]/15 active:bg-[#00d4ff]/30 active:scale-90'
                      : 'text-gray-700 cursor-default'
                  }`}
                  aria-label={`Jump to ${letter}`}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        )}
      <ScrollArea className="flex-1">
        <div ref={gridRef} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {sortedDancers.map((dancer) => {
            const firstChar = (dancer.name?.charAt(0) || '').toUpperCase();
            const isLetterAnchor = firstIdByLetter.get(firstChar) === dancer.id;
            return (
            <div
              key={dancer.id}
              data-section-letter={isLetterAnchor ? firstChar : undefined}
              style={isLetterAnchor ? { scrollMarginTop: '8px' } : undefined}
              className={`bg-[#151528] rounded-lg border p-3 flex flex-col items-center transition-colors ${
                selectedDancerId === dancer.id
                  ? 'border-[#00d4ff] ring-1 ring-[#00d4ff]/30'
                  : 'border-[#1e293b] hover:border-[#2e2e4a]'
              } ${!dancer.is_active ? 'opacity-50' : ''}`}
            >
              <div 
                className="w-12 h-12 rounded-full flex items-center justify-center text-black font-bold text-lg mb-2"
                style={{ backgroundColor: dancer.color || '#00d4ff' }}
              >
                {dancer.name.charAt(0).toUpperCase()}
              </div>
              
              <p className="text-sm font-medium text-white truncate w-full text-center mb-1">{dancer.name}</p>
              <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
                <Music className="w-3 h-3" />
                <span>{dancer.playlist?.length || 0} songs</span>
              </div>

              {dancerVipMap[String(dancer.id)] || pendingVipState[String(dancer.id)] ? (
                <div className="w-full mb-2 h-10 flex items-center justify-center text-xs text-yellow-600 border border-yellow-700/20 rounded-md bg-yellow-900/10">
                  👑 VIP
                </div>
              ) : rotation.includes(dancer.id) ? (
                <Button
                  size="sm"
                  className="w-full mb-2 h-10 text-xs bg-red-900/40 hover:bg-red-800/60 text-red-300 border border-red-700/50"
                  title="Remove from rotation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFromRotation?.(dancer.id);
                  }}
                >
                  <Minus className="w-3.5 h-3.5 mr-1" />
                  In Rotation
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="w-full mb-2 h-10 text-xs bg-green-900/40 hover:bg-green-800/60 text-green-300 border border-green-700/50"
                  title="Add to rotation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToRotation?.(dancer.id);
                  }}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add to Rotation
                </Button>
              )}

              {vipPickerDancerId === dancer.id ? (
                <div className="w-full mb-2">
                  <p className="text-[10px] text-yellow-400 text-center mb-1">VIP timeout duration:</p>
                  <div className="grid grid-cols-4 gap-1 mb-1">
                    {[15, 30, 45, 60].map(mins => (
                      <button
                        key={mins}
                        className="text-[10px] py-1 rounded bg-yellow-900/40 hover:bg-yellow-700/60 text-yellow-300 border border-yellow-700/50 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSendToVip?.(dancer.id, mins * 60 * 1000);
                          setVipPickerDancerId(null);
                        }}
                      >
                        {mins}m
                      </button>
                    ))}
                  </div>
                  <button
                    className="w-full text-[10px] py-1 rounded text-gray-500 hover:text-gray-300 transition-colors"
                    onClick={(e) => { e.stopPropagation(); setVipPickerDancerId(null); }}
                  >
                    cancel
                  </button>
                </div>
              ) : dancerVipMap[String(dancer.id)] ? (
                <button
                  className="w-full mb-2 flex items-center justify-center gap-1 py-1.5 rounded-md bg-yellow-900/30 hover:bg-yellow-800/50 border border-yellow-600/40 text-yellow-400 text-xs font-medium transition-colors"
                  title="Tap to release from VIP"
                  onClick={(e) => { e.stopPropagation(); onReleaseFromVip?.(String(dancer.id)); }}
                >
                  <span>👑</span> In VIP — release
                </button>
              ) : pendingVipState[String(dancer.id)] ? (
                <button
                  className="w-full mb-2 flex items-center justify-center gap-1 py-1.5 rounded-md bg-yellow-900/20 hover:bg-yellow-800/30 border border-yellow-700/30 text-yellow-600 text-xs transition-colors"
                  title="VIP queued after this set — tap to cancel"
                  onClick={(e) => { e.stopPropagation(); onReleaseFromVip?.(String(dancer.id)); }}
                >
                  <span>👑</span> After set — cancel
                </button>
              ) : (
                <button
                  className="w-full mb-2 flex items-center justify-center gap-1 py-1.5 rounded-md bg-[#1e293b] hover:bg-[#2e2e4a] border border-[#2e3a4e] text-gray-400 hover:text-yellow-400 text-xs transition-colors"
                  title="Send to VIP timeout"
                  onClick={(e) => { e.stopPropagation(); setVipPickerDancerId(dancer.id); }}
                >
                  <span>👑</span> VIP Timeout
                </button>
              )}

              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="w-11 h-11 text-gray-500 hover:text-[#00d4ff] hover:bg-[#1e293b]"
                  title="Edit playlist"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditPlaylist?.(dancer);
                  }}
                >
                  <ListMusic className="w-3.5 h-3.5" />
                </Button>

                <Dialog open={editingDancer?.id === dancer.id} onOpenChange={(open) => { if (!open) setEditingDancer(null); }}>
                  <DialogTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="w-11 h-11 text-gray-500 hover:text-white hover:bg-[#1e293b]"
                      title="Edit name"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingDancer({ ...dancer });
                        setEditingPin('');
                      }}
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-[#151528] border-[#1e293b] text-white">
                    <DialogHeader>
                      <DialogTitle>Edit Entertainer</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <Input
                        value={editingDancer?.name || ''}
                        onChange={(e) => setEditingDancer(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Stage name..."
                        className="bg-[#0d0d1f] border-[#1e293b]"
                      />
                      <div>
                        <Input
                          value={editingDancer?.phonetic_name || ''}
                          onChange={(e) => setEditingDancer(prev => ({ ...prev, phonetic_name: e.target.value }))}
                          placeholder="Pronunciation (e.g. Jee-Jee for GIGI)"
                          className="bg-[#0d0d1f] border-[#1e293b]"
                        />
                        <p className="text-xs text-gray-500 mt-1">How the DJ voice should say the name — leave blank if it sounds fine</p>
                      </div>
                      <div>
                        {editingDancer?.pin_plain && (
                          <p className="text-xs text-gray-400 mb-1">Current PIN: <span className="font-mono text-gray-200">{editingDancer.pin_plain}</span></p>
                        )}
                        <input
                          type="tel"
                          value={editingPin}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '').slice(0, 5);
                            setEditingPin(val);
                          }}
                          placeholder="New PIN (leave blank to keep current)"
                          className="w-full bg-[#0d0d1f] border border-[#1e293b] rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#00d4ff]"
                          inputMode="numeric"
                          maxLength={5}
                        />
                        <p className="text-xs text-gray-500 mt-1">Enter a new 5-digit PIN to change it, or leave blank</p>
                      </div>
                      <Button onClick={handleEdit} disabled={editingPin.length > 0 && editingPin.length !== 5} className="w-full bg-[#00d4ff] hover:bg-[#00a3cc] text-black disabled:opacity-50">
                        Save Changes
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => editingDancer?.name && resetVoiceoversForDancer(editingDancer.name)}
                        disabled={resettingVoiceovers}
                        className="w-full border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      >
                        <RotateCcw className={`w-4 h-4 mr-2 ${resettingVoiceovers ? 'animate-spin' : ''}`} />
                        {resettingVoiceovers ? 'Resetting...' : 'Reset Voiceovers'}
                      </Button>
                      {voiceoverResetCount !== null && (
                        <p className="text-xs text-center text-green-400">
                          {voiceoverResetCount > 0 ? `Cleared ${voiceoverResetCount} voiceover${voiceoverResetCount !== 1 ? 's' : ''}` : 'No voiceovers to clear'}
                        </p>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
                
                <Button
                  size="icon"
                  variant="ghost"
                  className="w-11 h-11 text-gray-500 hover:text-red-400 hover:bg-[#1e293b]"
                  title="Delete entertainer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(dancer);
                    setDeletePin('');
                    setDeleteError('');
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
            );
          })}
          
          {sortedDancers.length === 0 && (
            <div className="col-span-full text-center py-12">
              <User className="w-10 h-10 mx-auto text-gray-600 mb-3" />
              <p className="text-gray-500 text-sm">No entertainers added yet</p>
            </div>
          )}
        </div>
      </ScrollArea>
      </div>

      <Dialog open={pullAllConfirmOpen} onOpenChange={setPullAllConfirmOpen}>
        <DialogContent className="bg-[#0d0d1f] border-[#1e293b] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-400">Pull All From Rotation?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-5">
            <p className="text-gray-300 text-center">
              This will remove all <span className="font-semibold text-white">{rotation.length}</span> entertainer{rotation.length !== 1 ? 's' : ''} from rotation at once. Music keeps playing — this just clears the lineup.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 h-14 text-lg border-[#1e293b] text-gray-400"
                onClick={() => setPullAllConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-14 text-lg bg-red-600 hover:bg-red-700 text-white"
                onClick={() => {
                  onPullAll?.();
                  setPullAllConfirmOpen(false);
                }}
              >
                Pull All
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="bg-[#0d0d1f] border-[#1e293b] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete Entertainer</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-5">
            <p className="text-gray-300 text-center">
              Are you sure you want to delete <span className="font-semibold text-white">{deleteTarget?.name}</span>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 h-14 text-lg border-[#1e293b] text-gray-400"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-14 text-lg bg-red-600 hover:bg-red-700 text-white"
                disabled={isDeleting}
                onClick={handleDeleteConfirm}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
