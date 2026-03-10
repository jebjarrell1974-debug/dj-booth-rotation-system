import React, { useMemo } from 'react';
import { localEntities } from '@/api/localEntities';
import { useQuery } from '@tanstack/react-query';

const STYLES = `
  @keyframes nameEntrance {
    from { opacity: 0; transform: translateY(-14px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0)     scale(1);    }
  }
  @keyframes softPulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.82; }
  }
  @keyframes labelBreath {
    0%, 100% { opacity: 0.75; }
    50%      { opacity: 1; }
  }
  .current-name {
    animation: nameEntrance 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards,
               softPulse 3.5s ease-in-out 0.6s infinite;
    text-shadow:
      0 0 18px rgba(0, 212, 255, 0.55),
      0 0 40px rgba(0, 212, 255, 0.25),
      0 0 70px rgba(0, 212, 255, 0.1);
  }
  .stage-label {
    animation: labelBreath 2.8s ease-in-out infinite;
  }
  .next-name {
    text-shadow: 0 0 10px rgba(255, 255, 255, 0.12);
  }
`;

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
        <style>{STYLES}</style>
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
  for (let i = 1; i <= Math.min(10, validRotation.length - 1); i++) {
    const nextIndex = (currentIndex + i) % validRotation.length;
    const nextDancerId = validRotation[nextIndex];
    const dancer = dancers.find(d => d.id === nextDancerId);
    if (dancer) nextDancers.push(dancer);
  }

  return (
    <div className="h-screen bg-[#08081a] flex flex-col overflow-hidden">
      <style>{STYLES}</style>

      <div className="h-[25%] flex flex-col items-center justify-center px-8 border-b border-[#1e293b]">
        <p
          className="stage-label text-2xl font-bold tracking-widest uppercase mb-2"
          style={{
            background: 'linear-gradient(90deg, #00d4ff, #2563eb, #00d4ff)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}
        >
          Currently On Stage
        </p>
        <h1
          key={currentDancerId}
          className="current-name text-7xl font-black text-white uppercase tracking-wider text-center leading-tight"
        >
          {currentDancer ? currentDancer.name : '—'}
        </h1>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <p className="stage-label text-2xl font-bold tracking-widest uppercase text-center pt-5 pb-3"
          style={{
            background: 'linear-gradient(90deg, #00d4ff, #2563eb, #00d4ff)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}
        >
          Next On Stage
        </p>
        <div className="flex-1 flex flex-col justify-evenly px-8 pb-6">
          {nextDancers.map((dancer) => (
            <div key={dancer.id} className="text-center">
              <h3 className="next-name text-4xl font-bold text-white uppercase tracking-wider">
                {dancer.name}
              </h3>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
