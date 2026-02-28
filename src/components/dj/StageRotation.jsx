import React from 'react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronUp, 
  ChevronDown, 
  X, 
  Play, 
  UserPlus,
  GripVertical 
} from 'lucide-react';

export default function StageRotation({
  stage,
  dancers,
  rotation,
  currentIndex,
  onAddToRotation,
  onRemoveFromRotation,
  onMoveUp,
  onMoveDown,
  onSetCurrent,
  onStartRotation,
  isActive,
  currentDancer,
  currentSong
}) {
  const rotationDancers = rotation.map(id => dancers.find(d => d.id === id)).filter(Boolean);
  const availableDancers = dancers.filter(d => d.is_active && !rotation.includes(d.id));

  return (
    <div className="flex flex-col h-full bg-[#0d0d1f] rounded-xl border border-[#1e1e3a]">
      <div className="p-4 border-b border-[#1e1e3a]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#e040fb] uppercase tracking-wider">
              {stage?.name || 'Main Stage'}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {rotationDancers.length} in rotation
            </p>
          </div>
          {!isActive && rotationDancers.length > 0 && (
            <Button 
              size="sm"
              onClick={onStartRotation}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Play className="w-4 h-4 mr-1" />
              Start
            </Button>
          )}
        </div>
        
        {/* Currently Performing */}
        {isActive && currentDancer && (
          <div className="mt-3 p-3 bg-[#e040fb]/10 rounded-lg border border-[#e040fb]/30">
            <div className="flex items-center gap-3">
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center text-black font-bold"
                style={{ backgroundColor: currentDancer.color || '#e040fb' }}
              >
                {currentDancer.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-xs text-[#e040fb] uppercase tracking-wider">On Stage</p>
                <p className="text-white font-semibold">{currentDancer.name}</p>
                {currentSong && (
                  <p className="text-xs text-gray-400">Song {currentSong} of 2</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {rotationDancers.map((dancer, idx) => {
            const isCurrent = idx === currentIndex && isActive;
            const isNext = idx === (currentIndex + 1) % rotationDancers.length && isActive;
            
            return (
              <div
                key={dancer.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                  isCurrent 
                    ? 'bg-[#e040fb]/20 ring-1 ring-[#e040fb]' 
                    : isNext
                    ? 'bg-[#1e1e3a]/50 ring-1 ring-[#1e1e3a]'
                    : 'hover:bg-[#151528]'
                }`}
              >
                <GripVertical className="w-4 h-4 text-gray-600 cursor-grab" />
                
                <div 
                  className="w-7 h-7 rounded-full flex items-center justify-center text-black font-bold text-xs"
                  style={{ backgroundColor: dancer.color || '#e040fb' }}
                >
                  {dancer.name.charAt(0).toUpperCase()}
                </div>
                
                <span className="flex-1 text-sm text-white truncate">{dancer.name}</span>
                
                {isCurrent && (
                  <Badge className="bg-[#e040fb] text-black text-xs">NOW</Badge>
                )}
                {isNext && !isCurrent && (
                  <Badge variant="outline" className="border-gray-600 text-gray-400 text-xs">NEXT</Badge>
                )}
                
                <div className="flex items-center gap-0.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-11 h-11 text-gray-500 hover:text-white hover:bg-[#1e1e3a]"
                    onClick={() => onMoveUp(idx)}
                    disabled={idx === 0}
                  >
                    <ChevronUp className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-11 h-11 text-gray-500 hover:text-white hover:bg-[#1e1e3a]"
                    onClick={() => onMoveDown(idx)}
                    disabled={idx === rotationDancers.length - 1}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-11 h-11 text-gray-500 hover:text-red-400 hover:bg-[#1e1e3a]"
                    onClick={() => onRemoveFromRotation(dancer.id)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            );
          })}
          
          {rotationDancers.length === 0 && (
            <div className="text-center py-6 text-gray-500 text-sm">
              Add dancers to start rotation
            </div>
          )}
        </div>
      </ScrollArea>
      
      {/* Add to Rotation */}
      {availableDancers.length > 0 && (
        <div className="p-2 border-t border-[#1e1e3a]">
          <p className="text-xs text-gray-500 px-2 mb-2">Add to rotation:</p>
          <div className="flex flex-wrap gap-1">
            {availableDancers.slice(0, 6).map(dancer => (
              <button
                key={dancer.id}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors border border-[#1e1e3a] bg-[#0d0d1f] text-gray-200 hover:bg-[#1a1a35] hover:text-white"
                onClick={() => onAddToRotation(dancer.id)}
              >
                <div 
                  className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-black font-bold text-[9px] shrink-0"
                  style={{ backgroundColor: dancer.color || '#e040fb' }}
                >
                  {dancer.name.charAt(0).toUpperCase()}
                </div>
                {dancer.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}