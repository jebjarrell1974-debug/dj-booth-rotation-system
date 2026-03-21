import React, { useEffect, useRef, useMemo } from 'react';
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
  @keyframes breakDotPulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 14px rgba(0,212,255,0.8), 0 0 28px rgba(0,212,255,0.4); }
    50%      { opacity: 0.75; box-shadow: 0 0 8px rgba(0,212,255,0.5), 0 0 16px rgba(0,212,255,0.2); }
  }
  @keyframes scrollList {
    0%   { transform: translateY(0); }
    100% { transform: translateY(-50%); }
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
  .break-dot-active {
    animation: breakDotPulse 2s ease-in-out infinite;
  }
`;

const LABEL_STYLE = {
  background: 'linear-gradient(90deg, #00d4ff, #2563eb, #00d4ff)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text'
};

export default function RotationDisplay() {
  useEffect(() => {
    document.title = 'NEON DJ Rotation';
    return () => { document.title = 'NEON AI DJ'; };
  }, []);

  const { data: stageState = null } = useQuery({
    queryKey: ['stage-server'],
    queryFn: () => fetch('/api/stage/current').then(r => r.json()),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    staleTime: 4000
  });

  const { data: dancers = [] } = useQuery({
    queryKey: ['dancers'],
    queryFn: () => localEntities.Dancer.list(),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    staleTime: 9000
  });

  const { data: displayData = null } = useQuery({
    queryKey: ['booth-display'],
    queryFn: () => fetch('/api/booth/display').then(r => r.json()).catch(() => null),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
    staleTime: 2500,
  });

  const countdownRef = useRef(null);
  useEffect(() => {
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const interval = setInterval(() => {
      if (!countdownRef.current) return;
      const d = displayData;
      if (!d || !d.isPlaying || !d.trackDuration || !d.trackTimeAt) {
        countdownRef.current.textContent = '';
        return;
      }
      const elapsed = (Date.now() - d.trackTimeAt) / 1000;
      const pos = Math.min(d.trackTime + elapsed, d.trackDuration);
      const remaining = Math.max(0, d.trackDuration - pos);
      countdownRef.current.textContent = fmt(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, [displayData]);

  const validRotation = useMemo(() => {
    if (!stageState?.rotation_order || stageState.empty || dancers.length === 0) return [];
    const dancerIds = new Set(dancers.map(d => d.id));
    return stageState.rotation_order.filter(id => dancerIds.has(id));
  }, [stageState, dancers]);

  if (!stageState || stageState.empty || !stageState.is_active || validRotation.length === 0) {
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

  const currentIndex = Math.min(stageState.current_dancer_index || 0, validRotation.length - 1);
  const currentDancerId = validRotation[currentIndex];
  const currentDancer = dancers.find(d => d.id === currentDancerId);

  const isBreak = displayData?.currentSongNumber === 0 && displayData?.isRotationActive;
  const breakSongIndex = displayData?.breakSongIndex ?? null;
  const breakSongTotal = displayData?.breakSongsPerSet ?? 0;

  // During break: show ALL dancers (including the one who just performed, at the end)
  // During active: show all except current (they're shown at top)
  const maxNext = isBreak
    ? Math.min(10, validRotation.length)
    : Math.min(10, validRotation.length - 1);
  const nextDancers = [];
  for (let i = 1; i <= maxNext; i++) {
    const nextIndex = (currentIndex + i) % validRotation.length;
    const dancer = dancers.find(d => d.id === validRotation[nextIndex]);
    if (dancer) nextDancers.push(dancer);
  }

  const nextCount = nextDancers.length;
  const FIXED_FONT = '5.5rem';

  return (
    <div className="h-screen bg-[#08081a] flex flex-col overflow-hidden">
      <style>{STYLES}</style>

      {/* TOP: Current performer or break — pushed to top, auto height */}
      <div className="flex flex-col items-center px-8 pt-8 pb-5 border-b border-[#1e293b]">
        {isBreak ? (
          <>
            <p className="stage-label text-lg font-bold tracking-widest uppercase mb-2" style={LABEL_STYLE}>
              Break
            </p>
            {breakSongTotal > 0 && (
              <div className="flex items-center gap-4 mb-2">
                {Array.from({ length: breakSongTotal }).map((_, i) => {
                  const isDone = breakSongIndex !== null && i < breakSongIndex;
                  const isCurrent = breakSongIndex !== null && i === breakSongIndex;
                  return (
                    <div
                      key={i}
                      className={isCurrent ? 'break-dot-active' : ''}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: isCurrent ? '#00d4ff' : isDone ? 'rgba(0,212,255,0.3)' : 'transparent',
                        border: `3px solid ${isCurrent ? '#00d4ff' : isDone ? 'rgba(0,212,255,0.45)' : 'rgba(255,255,255,0.18)'}`,
                        transition: 'background 0.4s, border-color 0.4s',
                      }}
                    />
                  );
                })}
              </div>
            )}
            <div
              ref={countdownRef}
              className="font-black font-mono tabular-nums leading-none"
              style={{ fontSize: '4.5rem', color: '#00d4ff', textShadow: '0 0 24px rgba(0,212,255,0.45)', minHeight: '1em' }}
            />
          </>
        ) : (
          <>
            <p className="stage-label text-2xl font-bold tracking-widest uppercase mb-1" style={LABEL_STYLE}>
              Currently On Stage
            </p>
            <h1
              key={currentDancerId}
              className="current-name text-9xl font-black text-white uppercase tracking-wider text-center leading-tight"
            >
              {currentDancer ? currentDancer.name : '—'}
            </h1>
            <div
              ref={countdownRef}
              className="font-black font-mono tabular-nums mt-2 leading-none"
              style={{ fontSize: '5.5rem', color: '#00d4ff', textShadow: '0 0 24px rgba(0,212,255,0.45)', minHeight: '1em' }}
            />
          </>
        )}
      </div>

      {/* BOTTOM: Full rotation list — fixed font size, scrolls if needed */}
      <div className="flex-1 flex flex-col overflow-hidden px-8 pt-5 pb-6">
        {nextDancers.length > 0 && (
          <p className="stage-label text-xl font-bold tracking-widest uppercase text-center mb-3" style={LABEL_STYLE}>
            {isBreak ? 'Up Next' : 'Next On Stage'}
          </p>
        )}
        <div className="flex-1 overflow-hidden">
          {nextDancers.map((dancer) => (
            <div key={dancer.id} className="text-center">
              <h3
                className="next-name font-bold text-white uppercase tracking-wider"
                style={{ fontSize: FIXED_FONT, lineHeight: 1.15 }}
              >
                {dancer.name}
              </h3>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
