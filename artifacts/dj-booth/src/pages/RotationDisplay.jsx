import React, { useEffect, useRef, useMemo, useState } from 'react';
import { localEntities } from '@/api/localEntities';
import { useQuery } from '@tanstack/react-query';

const STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: 100%; overflow: hidden; }
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
  const [showCountdown, setShowCountdown] = useState(() => {
    const stored = localStorage.getItem('djbooth_display_countdown');
    return stored === null ? true : stored === 'true';
  });

  useEffect(() => {
    document.title = 'NEON DJ Rotation';
    return () => { document.title = 'NEON AI DJ'; };
  }, []);

  useEffect(() => {
    const readVal = () => {
      const stored = localStorage.getItem('djbooth_display_countdown');
      return stored === null ? true : stored === 'true';
    };
    const handler = () => setShowCountdown(readVal());
    window.addEventListener('djbooth_display_countdown_changed', handler);
    window.addEventListener('storage', handler);
    // Polling fallback — catches changes when cross-window storage events
    // don't fire (Chromium kiosk with separate processes)
    const poll = setInterval(() => setShowCountdown(readVal()), 1500);
    return () => {
      window.removeEventListener('djbooth_display_countdown_changed', handler);
      window.removeEventListener('storage', handler);
      clearInterval(poll);
    };
  }, []);

  const { data: stageState = null } = useQuery({
    queryKey: ['stage-server'],
    queryFn: () => fetch('/api/stage/current').then(r => r.json()),
    refetchInterval: 1000,
    refetchIntervalInBackground: true,
    staleTime: 800
  });

  const { data: dancers = [] } = useQuery({
    queryKey: ['dancers'],
    queryFn: () => localEntities.Dancer.list(),
    refetchInterval: 1000,
    refetchIntervalInBackground: true,
    staleTime: 800
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
      <div style={{ width: '100vw', height: '100vh', background: '#08081a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

  const isBreak = displayData?.breakSongIndex != null && displayData?.isRotationActive;
  const breakSongIndex = displayData?.breakSongIndex ?? null;
  const breakSongTotal = displayData?.breakSongsPerSet ?? 0;

  // During break: current dancer (index 0 = next up) is NOT shown at top (top shows "Break Song")
  // so include her at position 0 of the "Up Next" list.
  // During active: current dancer IS shown at top, so skip her (start at offset 1).
  const startOffset = isBreak ? 0 : 1;
  const nextDancers = [];
  for (let i = startOffset; i < validRotation.length; i++) {
    const nextIndex = (currentIndex + i) % validRotation.length;
    const dancer = dancers.find(d => d.id === validRotation[nextIndex]);
    if (dancer) nextDancers.push(dancer);
  }

  const nextCount = nextDancers.length;
  const FIXED_FONT = '1.4rem';

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#08081a' }}>
      <style>{STYLES}</style>

      {/* TOP: Current performer or break — pushed to top, auto height */}
      <div className="flex flex-col items-center border-b border-[#1e293b]" style={{ padding: '2vh 4vw 1.5vh', flexShrink: 0 }}>
        {isBreak ? (
          <>
            <p className="stage-label text-lg font-bold tracking-widest uppercase mb-2" style={LABEL_STYLE}>
              Break
            </p>
            <h1
              className="current-name text-7xl font-black text-white uppercase tracking-wider text-center leading-tight mb-2"
            >
              Break Song
            </h1>
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
            {showCountdown && (
              <div
                ref={countdownRef}
                className="font-black font-mono tabular-nums leading-none"
                style={{ fontSize: '3.5rem', color: '#00d4ff', textShadow: '0 0 24px rgba(0,212,255,0.45)', minHeight: '1em' }}
              />
            )}
          </>
        ) : (
          <>
            <p className="stage-label text-2xl font-bold tracking-widest uppercase mb-1" style={LABEL_STYLE}>
              Currently On Stage
            </p>
            <h1
              key={currentDancerId}
              className="current-name font-black text-white uppercase tracking-wider text-center leading-tight" style={{ fontSize: '1.85rem' }}
            >
              {currentDancer ? currentDancer.name : '—'}
            </h1>
            {showCountdown && (
              <div
                ref={countdownRef}
                className="font-black font-mono tabular-nums mt-2 leading-none"
                style={{ fontSize: '3rem', color: '#00d4ff', textShadow: '0 0 24px rgba(0,212,255,0.45)', minHeight: '1em' }}
              />
            )}
          </>
        )}
      </div>

      {/* BOTTOM: Full rotation list — natural size, fills screen when enough names */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '1vh 4vw 1vh', minWidth: 0 }}>
        {nextDancers.length > 0 && (
          <p className="stage-label text-xl font-bold tracking-widest uppercase text-center mb-2" style={LABEL_STYLE}>
            {isBreak ? 'Up Next' : 'Next On Stage'}
          </p>
        )}
        {nextDancers.map((dancer) => (
          <div key={dancer.id} style={{ textAlign: 'center', width: '100%', overflow: 'hidden' }}>
            <h3
              className="next-name font-bold text-white uppercase"
              style={{ fontSize: FIXED_FONT, lineHeight: 1.15, letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
            >
              {dancer.name}
            </h3>
          </div>
        ))}
      </div>
    </div>
  );
}
