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

export default function RotationBuilder({
  dancers,
  rotation,
  currentIndex,
  onAddToRotation,
  onRemoveFromRotation,
  onMoveUp,
  onMoveDown,
  onStartRotation,
  isActive
}) {
  const rotationDancers = rotation.map(id => dancers.find(d => d.id === id)).filter(Boolean);
  const availableDancers = dancers.filter(d => d.is_active && !rotation.includes(d.id));

  return (
    <div className="flex flex-col h-full bg-[#0d0d1f] rounded-xl border border-[#1e293b]">
      <div className="p-4 border-b border-[#1e293b]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">
              Build Rotation
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {rotationDancers.length} dancers in rotation
            </p>
          </div>
          {!isActive && rotationDancers.length > 0 && (
            <Button 
              size="sm"
              onClick={onStartRotation}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Play className="w-4 h-4 mr-1" />
              Start Rotation
            </Button>
          )}
        </div>
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
                    ? 'bg-[#00d4ff]/20 ring-1 ring-[#00d4ff]' 
                    : isNext
                    ? 'bg-[#1e293b]/50 ring-1 ring-[#1e293b]'
                    : 'hover:bg-[#151528]'
                }`}
              >
                <GripVertical className="w-4 h-4 text-gray-600 cursor-grab" />
                
                <div 
                  className="w-7 h-7 rounded-full flex items-center justify-center text-black font-bold text-xs"
                  style={{ backgroundColor: dancer.color || '#00d4ff' }}
                >
                  {dancer.name.charAt(0).toUpperCase()}
                </div>
                
                <span className="flex-1 text-sm text-white truncate">{dancer.name}</span>
                
                {isCurrent && (
                  <Badge className="bg-[#00d4ff] text-black text-xs">NOW</Badge>
                )}
                {isNext && !isCurrent && (
                  <Badge variant="outline" className="border-gray-600 text-gray-400 text-xs">NEXT</Badge>
                )}
                
                <div className="flex items-center gap-0.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-11 h-11 text-gray-500 hover:text-white hover:bg-[#1e293b]"
                    onClick={() => onMoveUp(idx)}
                    disabled={idx === 0}
                  >
                    <ChevronUp className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-11 h-11 text-gray-500 hover:text-white hover:bg-[#1e293b]"
                    onClick={() => onMoveDown(idx)}
                    disabled={idx === rotationDancers.length - 1}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-11 h-11 text-gray-500 hover:text-red-400 hover:bg-[#1e293b]"
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
        <div className="p-4 border-t border-[#1e293b]">
          <p className="text-xs text-gray-500 mb-3 uppercase tracking-wider">Available Dancers:</p>
          <div className="grid grid-cols-2 gap-2">
            {availableDancers.map(dancer => (
              <Button
                key={dancer.id}
                size="sm"
                variant="outline"
                className="border-[#1e293b] text-gray-300 hover:bg-[#1e293b] hover:text-white text-xs justify-start"
                onClick={() => onAddToRotation(dancer.id)}
              >
                <div 
                  className="w-5 h-5 rounded-full flex items-center justify-center text-black font-bold text-xs mr-2"
                  style={{ backgroundColor: dancer.color || '#00d4ff' }}
                >
                  {dancer.name.charAt(0).toUpperCase()}
                </div>
                {dancer.name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}