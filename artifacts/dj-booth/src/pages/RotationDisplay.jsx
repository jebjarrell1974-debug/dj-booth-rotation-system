import React, { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from 'react';
import { localEntities } from '@/api/localEntities';
import { useQuery } from '@tanstack/react-query';

// Fixed font size for the next-up list.
// Calibrated so long names (ENCHANTRESS 11 chars, CHAMPAGNE/ANASTASIA 9 chars)
// fit comfortably across the screen without being cut off.
const NEXT_LIST_FONT_VW = 9;

// When the rotation has more names than this, the list scrolls.
// Below this threshold names are shown statically.
const SCROLL_THRESHOLD = 10;

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

// Measures a piece of text at a given font size and returns its rendered pixel width.
function measureText(text, fontSizePx, fontStyle) {
  const span = document.createElement('span');
  span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-family:inherit;${fontStyle};font-size:${fontSizePx}px`;
  span.textContent = text;
  document.body.appendChild(span);
  const w = span.offsetWidth;
  document.body.removeChild(span);
  return w;
}

// Hook: returns a font-size (in px) that fits `text` within `targetWidthPx`.
// maxVw caps the size for short names so they don't get absurdly huge.
function useFitFontSize(text, containerRef, { maxVw = 22, minVw = 6, fillFraction = 0.92, fontStyle = 'font-weight:900;letter-spacing:0.04em;text-transform:uppercase' } = {}) {
  const [fontSize, setFontSize] = useState(null);

  const recalc = useCallback(() => {
    if (!containerRef.current || !text) return;
    const containerW = containerRef.current.offsetWidth;
    if (!containerW) return;
    const vwPx = window.innerWidth / 100;
    const maxPx = maxVw * vwPx;
    const minPx = minVw * vwPx;
    const targetW = containerW * fillFraction;

    const widthAtMax = measureText(text, maxPx, fontStyle);
    if (widthAtMax <= targetW) {
      setFontSize(maxPx);
      return;
    }
    // Scale down proportionally
    const scaled = Math.max(minPx, (targetW / widthAtMax) * maxPx);
    setFontSize(scaled);
  }, [text, containerRef, maxVw, minVw, fillFraction, fontStyle]);

  useLayoutEffect(() => {
    recalc();
  }, [recalc]);

  useEffect(() => {
    const ro = new ResizeObserver(recalc);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [recalc, containerRef]);

  return fontSize;
}

// Auto-sizing name component for the current performer
function FitName({ text, className, style }) {
  const containerRef = useRef(null);
  const fontSize = useFitFontSize(text, containerRef, { maxVw: 22, minVw: 6, fillFraction: 0.92 });

  return (
    <div ref={containerRef} style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <h1
        className={className}
        style={{
          ...style,
          fontSize: fontSize ? `${fontSize}px` : '15vw',
          whiteSpace: 'nowrap',
          lineHeight: 1.05,
        }}
      >
        {text}
      </h1>
    </div>
  );
}


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
        <div style={{ textAlign: 'center', padding: '0 6vw' }}>
          <h1 style={{ fontSize: '12vw', fontWeight: 900, color: 'rgba(255,255,255,0.9)', marginBottom: '4vw' }}>No Active Rotation</h1>
          <p style={{ fontSize: '5vw', color: 'rgba(255,255,255,0.6)' }}>Waiting for DJ to start...</p>
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

  const startOffset = isBreak ? 0 : 1;
  const nextDancers = [];
  for (let i = startOffset; i < validRotation.length; i++) {
    const nextIndex = (currentIndex + i) % validRotation.length;
    const dancer = dancers.find(d => d.id === validRotation[nextIndex]);
    if (dancer) nextDancers.push(dancer);
  }

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#08081a' }}>
      <style>{STYLES}</style>

      {/* TOP: Current performer or break */}
      <div className="flex flex-col items-center border-b border-[#1e293b]" style={{ padding: '3vh 4vw 2vh', flexShrink: 0 }}>
        {isBreak ? (
          <>
            <p className="stage-label font-bold tracking-widest uppercase mb-2" style={{ ...LABEL_STYLE, fontSize: '5vw' }}>
              Break
            </p>
            <FitName
              text="Break Song"
              className="current-name font-black text-white uppercase tracking-wider text-center"
            />
            {breakSongTotal > 0 && (
              <div className="flex items-center gap-4 mt-2 mb-2">
                {Array.from({ length: breakSongTotal }).map((_, i) => {
                  const isDone = breakSongIndex !== null && i < breakSongIndex;
                  const isCurrent = breakSongIndex !== null && i === breakSongIndex;
                  return (
                    <div
                      key={i}
                      className={isCurrent ? 'break-dot-active' : ''}
                      style={{
                        width: '3vw', height: '3vw', minWidth: 18, minHeight: 18,
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
                style={{ fontSize: '16vw', color: '#00d4ff', textShadow: '0 0 24px rgba(0,212,255,0.45)', minHeight: '1em', marginTop: '1vh' }}
              />
            )}
          </>
        ) : (
          <>
            <p className="stage-label font-bold tracking-widest uppercase mb-2" style={{ ...LABEL_STYLE, fontSize: '5vw' }}>
              Currently On Stage
            </p>
            <FitName
              key={currentDancerId}
              text={currentDancer ? currentDancer.name : '—'}
              className="current-name font-black text-white uppercase tracking-wider text-center"
            />
            {showCountdown && (
              <div
                ref={countdownRef}
                className="font-black font-mono tabular-nums leading-none"
                style={{ fontSize: '16vw', color: '#00d4ff', textShadow: '0 0 24px rgba(0,212,255,0.45)', minHeight: '1em', marginTop: '1.5vh' }}
              />
            )}
          </>
        )}
      </div>

      {/* BOTTOM: Rotation list — fixed font size, scrolls when list is long */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '1.5vh 4vw 1vh', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {nextDancers.length > 0 && (
          <p className="stage-label font-bold tracking-widest uppercase text-center" style={{ ...LABEL_STYLE, fontSize: '4.5vw', marginBottom: '1vh', flexShrink: 0 }}>
            {isBreak ? 'Up Next' : 'Next On Stage'}
          </p>
        )}
        {nextDancers.length > 0 && (() => {
          const shouldScroll = nextDancers.length > SCROLL_THRESHOLD;
          const scrollDuration = Math.max(20, nextDancers.length * 2.5);
          const listItems = shouldScroll ? [...nextDancers, ...nextDancers] : nextDancers;
          return (
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.8vh',
                  animation: shouldScroll ? `scrollList ${scrollDuration}s linear infinite` : 'none',
                }}
              >
                {listItems.map((dancer, i) => (
                  <div key={`${dancer.id}-${i}`} style={{ textAlign: 'center', width: '100%' }}>
                    <h3
                      className="next-name font-bold text-white uppercase"
                      style={{
                        fontSize: `${NEXT_LIST_FONT_VW}vw`,
                        lineHeight: 1.15,
                        letterSpacing: '0.05em',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {dancer.name}
                    </h3>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
