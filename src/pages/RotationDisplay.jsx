import React, { useState, useEffect, useMemo } from 'react';
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
      <div className="min-h-screen bg-[#08081a] flex items-center justify-center">
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
    if (dancer) {
      nextDancers.push(dancer);
    }
  }

  return (
    <div className="min-h-screen bg-[#08081a] flex flex-col items-center justify-center p-12 overflow-hidden">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-[#00d4ff] mb-6 tracking-wide uppercase">
            Currently On Stage
          </h2>
          {currentDancer ? (
            <h1 className="text-8xl font-black text-white uppercase tracking-wider">
              {currentDancer.name}
            </h1>
          ) : (
            <h1 className="text-8xl font-black text-white/40 uppercase">-</h1>
          )}
        </div>

        <div className="text-center">
          <h2 className="text-4xl font-bold text-[#00d4ff] mb-8 tracking-wide uppercase">
            Next On Stage
          </h2>
          <div className="bg-[#0d0d1f] rounded-2xl p-8 border border-[#1e293b]">
            {nextDancers.map((dancer) => (
              <div
                key={dancer.id}
                className="text-center py-4 border-b border-[#1e293b] last:border-b-0"
              >
                <h3 className="text-4xl font-bold text-white uppercase tracking-wider">
                  {dancer.name}
                </h3>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
