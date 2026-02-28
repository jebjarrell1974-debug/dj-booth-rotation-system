import React, { useState } from 'react';
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
import { UserPlus, Edit2, Trash2, Music, User, ListMusic, Plus, Minus } from 'lucide-react';

const DANCER_COLORS = [
  '#e040fb', '#ff2d55', '#00e5ff', '#7c3aed', '#39ff14', 
  '#ff6b35', '#ff1493', '#00bfff', '#ff4081', '#00ffc8'
];

export default function DancerRoster({ 
  dancers, 
  rotation = [],
  onAddToRotation,
  onRemoveFromRotation,
  onAddDancer, 
  onEditDancer, 
  onDeleteDancer,
  onEditPlaylist,
  selectedDancerId 
}) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newDancerName, setNewDancerName] = useState('');
  const [newDancerPin, setNewDancerPin] = useState('');
  const [addError, setAddError] = useState('');
  const [editingDancer, setEditingDancer] = useState(null);
  const [isAdding, setIsAdding] = useState(false);

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
          playlist: [], 
          is_active: true 
        });
        await new Promise(resolve => setTimeout(resolve, 300));
        setNewDancerName('');
        setNewDancerPin('');
        setIsAddOpen(false);
      } catch (error) {
        console.error('Failed to add dancer:', error);
        setAddError(error.message || 'Failed to add dancer');
      } finally {
        setIsAdding(false);
      }
    }
  };

  const handleEdit = () => {
    if (editingDancer && editingDancer.name.trim()) {
      onEditDancer(editingDancer.id, { name: editingDancer.name });
      setEditingDancer(null);
    }
  };

  const sortedDancers = [...dancers].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const activeDancers = sortedDancers.filter(d => d.is_active);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#e040fb] uppercase tracking-wider">
            Dancer Roster
          </h3>
          <p className="text-xs text-gray-500 mt-1">{activeDancers.length} active</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-[#e040fb] hover:bg-[#c026d3] text-black">
              <UserPlus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#151528] border-[#1e1e3a] text-white">
            <DialogHeader>
              <DialogTitle>Add New Dancer</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <Input
                value={newDancerName}
                onChange={(e) => setNewDancerName(e.target.value)}
                placeholder="Stage name..."
                className="bg-[#0d0d1f] border-[#1e1e3a]"
                autoFocus
              />
              <div>
                <Input
                  value={newDancerPin}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 5);
                    setNewDancerPin(val);
                  }}
                  placeholder="5-digit PIN..."
                  className="bg-[#0d0d1f] border-[#1e1e3a]"
                  inputMode="numeric"
                  maxLength={5}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
                <p className="text-xs text-gray-500 mt-1">Dancer uses this PIN to log in on their phone</p>
              </div>
              {addError && <p className="text-sm text-red-400">{addError}</p>}
              <Button 
                onClick={handleAdd} 
                disabled={isAdding || !newDancerName.trim() || newDancerPin.length !== 5}
                className="w-full bg-[#e040fb] hover:bg-[#c026d3] text-black"
              >
                {isAdding ? 'Adding...' : 'Add Dancer'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {sortedDancers.map((dancer) => (
            <div
              key={dancer.id}
              className={`bg-[#151528] rounded-lg border p-3 flex flex-col items-center transition-colors ${
                selectedDancerId === dancer.id
                  ? 'border-[#e040fb] ring-1 ring-[#e040fb]/30'
                  : 'border-[#1e1e3a] hover:border-[#2e2e4a]'
              } ${!dancer.is_active ? 'opacity-50' : ''}`}
            >
              <div 
                className="w-12 h-12 rounded-full flex items-center justify-center text-black font-bold text-lg mb-2"
                style={{ backgroundColor: dancer.color || '#e040fb' }}
              >
                {dancer.name.charAt(0).toUpperCase()}
              </div>
              
              <p className="text-sm font-medium text-white truncate w-full text-center mb-1">{dancer.name}</p>
              <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
                <Music className="w-3 h-3" />
                <span>{dancer.playlist?.length || 0} songs</span>
              </div>

              {rotation.includes(dancer.id) ? (
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
              
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="w-11 h-11 text-gray-500 hover:text-[#e040fb] hover:bg-[#1e1e3a]"
                  title="Edit playlist"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditPlaylist?.(dancer);
                  }}
                >
                  <ListMusic className="w-3.5 h-3.5" />
                </Button>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="w-11 h-11 text-gray-500 hover:text-white hover:bg-[#1e1e3a]"
                      title="Edit name"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingDancer({ ...dancer });
                      }}
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-[#151528] border-[#1e1e3a] text-white">
                    <DialogHeader>
                      <DialogTitle>Edit Dancer</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <Input
                        value={editingDancer?.name || ''}
                        onChange={(e) => setEditingDancer(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Stage name..."
                        className="bg-[#0d0d1f] border-[#1e1e3a]"
                      />
                      <Button onClick={handleEdit} className="w-full bg-[#e040fb] hover:bg-[#c026d3] text-black">
                        Save Changes
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                
                <Button
                  size="icon"
                  variant="ghost"
                  className="w-11 h-11 text-gray-500 hover:text-red-400 hover:bg-[#1e1e3a]"
                  title="Delete dancer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteDancer(dancer.id);
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
          
          {sortedDancers.length === 0 && (
            <div className="col-span-full text-center py-12">
              <User className="w-10 h-10 mx-auto text-gray-600 mb-3" />
              <p className="text-gray-500 text-sm">No dancers added yet</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
