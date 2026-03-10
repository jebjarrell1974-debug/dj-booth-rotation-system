import React, { useMemo } from 'react';
import { localEntities } from '@/api/localEntities';
import { useQuery } from '@tanstack/react-query';

export default function RotationDisplay() {
  const { data: stages = [] } = useQuery({
    queryKey: ['stages'],
    queryFn: () => localEntities.Stage.list(),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    staleTime: 9000
  });

  const { data: dancers = [] } = useQuery({
    queryKey: ['dancers'],
    queryFn: () => localEntities.Dancer.list(),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    staleTime: 9000
  });

  const stage = useMemo(() => stages.find(s => s.is_active) || null, [stages]);

  const validRotation = useMemo(() => {
    if (!stage?.rotation_order || dancers.length === 0) return [];
    const dancerIds = new Set(dancers.map(d => d.id));
    return stage.rotation_order.filter(id => dancerIds.has(id));
  }, [stage, dancers]);

  if (!stage || validRotation.length === 0) {
    return (
      <div className="h-screen bg-[#08081a] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-white/90 mb-4">No Active Rotation</h1>
          <p className="text-2xl text-white/60">Waiting for DJ to start...</p>
        </div>
      </div>
    );
  }

  const currentIndex = Math.min(stage.current_dancer_index || 0, validRotation.length - 1);
  const currentDancerId = validRotation[currentIndex];
  const currentDancer = dancers.find(d => d.id === currentDancerId);

  const nextDancers = [];
  for (let i = 1; i <= Math.min(6, validRotation.length - 1); i++) {
    const nextIndex = (currentIndex + i) % validRotation.length;
    const nextDancerId = validRotation[nextIndex];
    const dancer = dancers.find(d => d.id === nextDancerId);
    if (dancer) nextDancers.push(dancer);
  }

  return (
    <div className="h-screen bg-[#08081a] flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col items-center justify-center px-10 pt-10 pb-6">
        <h2 className="text-3xl font-bold text-[#00d4ff] mb-5 tracking-widest uppercase">
          Currently On Stage
        </h2>
        {currentDancer ? (
          <h1 className="text-8xl font-black text-white uppercase tracking-wider text-center leading-tight">
            {currentDancer.name}
          </h1>
        ) : (
          <h1 className="text-8xl font-black text-white/40 uppercase">—</h1>
        )}
      </div>

      <div className="border-t border-[#1e293b] mx-8" />

      <div className="flex-1 flex flex-col items-center px-10 pt-6 pb-10">
        <h2 className="text-3xl font-bold text-[#00d4ff] mb-6 tracking-widest uppercase">
          Next On Stage
        </h2>
        <div className="w-full flex flex-col flex-1 justify-evenly">
          {nextDancers.map((dancer) => (
            <div key={dancer.id} className="text-center py-1">
              <h3 className="text-5xl font-bold text-white uppercase tracking-wider">
                {dancer.name}
              </h3>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
