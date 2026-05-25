import React, { useState, useEffect, useRef, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const STATUS_ICONS = {
  pending: '○',
  running: '◉',
  done: '✓',
  error: '✗',
};

const STATUS_COLORS = {
  pending: '#555',
  running: '#00d4ff',
  done: '#22c55e',
  error: '#ef4444',
};

const AI_STATUS_LINES = [
  'Initializing neural entertainment matrix',
  'Calibrating beat-detection algorithms',
  'Loading artificial intelligence model',
  'Synchronizing audio frequency analyzers',
  'Mapping harmonic resonance patterns',
  'Bootstrapping deep groove networks',
  'Compiling entertainer rotation logic',
  'Activating voice synthesis engine',
  'Scanning music catalog metadata',
  'Establishing real-time broadcast link',
  'Optimizing crowd energy parameters',
  'Warming up announcement processor',
  'Configuring adaptive playlist engine',
  'Initializing stage lighting protocols',
  'Loading entertainer preference data',
  'Calibrating volume normalization',
  'Syncing cloud configuration state',
  'Preparing commercial break scheduler',
  'Activating neon interface subsystems',
  'Verifying audio codec compatibility',
];

export default function BootScreen({ onReady }) {
  const [status, setStatus] = useState(null);
  const [fadeOut, setFadeOut] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentLine, setCurrentLine] = useState(0);
  const [glitchText, setGlitchText] = useState(false);
  const mountedRef = useRef(true);
  const dismissTimerRef = useRef(null);
  const progressRef = useRef(0);

  const dismiss = useCallback(() => {
    if (!mountedRef.current) return;
    setProgress(100);
    setFadeOut(true);
    dismissTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setDismissed(true);
      onReady();
    }, 800);
  }, [onReady]);

  useEffect(() => {
    const lineInterval = setInterval(() => {
      if (!mountedRef.current) return;
      setGlitchText(true);
      setTimeout(() => {
        if (!mountedRef.current) return;
        setCurrentLine(prev => (prev + 1) % AI_STATUS_LINES.length);
        setGlitchText(false);
      }, 150);
    }, 2200);
    return () => clearInterval(lineInterval);
  }, []);

  useEffect(() => {
    const progressInterval = setInterval(() => {
      if (!mountedRef.current) return;
      setProgress(prev => {
        if (prev >= 95) return prev;
        const increment = Math.random() * 3 + 0.5;
        const next = Math.min(prev + increment, 95);
        progressRef.current = next;
        return next;
      });
    }, 300);
    return () => clearInterval(progressInterval);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let interval;
    let readyTimeout;

    const check = async () => {
      try {
        const res = await fetch(`${API}/api/boot-status`);
        if (res.ok && mountedRef.current) {
          const data = await res.json();
          setStatus(data);
          if (data.ready) {
            clearInterval(interval);
            readyTimeout = setTimeout(dismiss, 1500);
          }
        }
      } catch {
      }
    };

    check();
    interval = setInterval(check, 1500);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      clearTimeout(readyTimeout);
      clearTimeout(dismissTimerRef.current);
    };
  }, [dismiss]);

  if (dismissed) return null;

  const steps = status?.steps || [];
  const hasErrors = steps.some(s => s.status === 'error');
  const showContinue = hasErrors || (status && status.elapsed > 30);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      background: '#08081a',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      opacity: fadeOut ? 0 : 1,
      transition: 'opacity 0.8s ease',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 30%, rgba(0,212,255,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '1px',
        background: 'linear-gradient(90deg, transparent 0%, #00d4ff 50%, transparent 100%)',
        opacity: 0.4,
        animation: 'bootScanLine 3s ease-in-out infinite',
      }} />

      <div style={{ textAlign: 'center', marginBottom: '2rem', position: 'relative' }}>
        <div style={{
          fontSize: '0.7rem',
          color: '#00d4ff',
          letterSpacing: '0.3em',
          marginBottom: '0.75rem',
          opacity: 0.5,
          fontFamily: "'Courier New', monospace",
        }}>
          {'>'} SYSTEM BOOT v3.0
        </div>
        <h1 style={{
          fontSize: '3.5rem',
          fontWeight: 800,
          color: '#00d4ff',
          textShadow: '0 0 40px rgba(0,212,255,0.5), 0 0 80px rgba(0,212,255,0.2), 0 2px 0 rgba(0,212,255,0.1)',
          margin: 0,
          letterSpacing: '0.08em',
          position: 'relative',
        }}>
          NEON AI DJ
        </h1>
        <p style={{
          color: '#555',
          fontSize: '0.7rem',
          marginTop: '0.4rem',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          fontFamily: "'Courier New', monospace",
        }}>
          Nightclub Entertainment Operations Network
        </p>
      </div>

      <div style={{
        width: '380px',
        marginBottom: '1.5rem',
        position: 'relative',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '0.4rem',
        }}>
          <span style={{
            color: '#00d4ff',
            fontSize: '0.7rem',
            fontFamily: "'Courier New', monospace",
            letterSpacing: '0.1em',
          }}>
            SYSTEM INITIALIZATION
          </span>
          <span style={{
            color: '#00d4ff',
            fontSize: '0.7rem',
            fontFamily: "'Courier New', monospace",
            fontWeight: 700,
          }}>
            {Math.round(progress)}%
          </span>
        </div>
        <div style={{
          width: '100%',
          height: '4px',
          background: '#1a1a3a',
          borderRadius: '2px',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #00d4ff, #7c3aed, #00d4ff)',
            backgroundSize: '200% 100%',
            animation: 'bootProgressShimmer 2s linear infinite',
            borderRadius: '2px',
            transition: 'width 0.3s ease',
            boxShadow: '0 0 10px rgba(0,212,255,0.4)',
          }} />
        </div>
      </div>

      <div style={{
        width: '380px',
        background: '#0d0d1f',
        borderRadius: '12px',
        border: '1px solid #1a1a3a',
        padding: '1.25rem',
        boxShadow: '0 0 60px rgba(0,212,255,0.05)',
        maxHeight: '280px',
        overflowY: 'auto',
      }}>
        {steps.map((step) => (
          <div key={step.id} style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            padding: '0.5rem 0',
            borderBottom: '1px solid #1a1a2e',
          }}>
            <span style={{
              color: STATUS_COLORS[step.status],
              fontSize: '1rem',
              flexShrink: 0,
              width: '1.2rem',
              textAlign: 'center',
              animation: step.status === 'running' ? 'bootPulse 1.2s ease infinite' : 'none',
            }}>
              {STATUS_ICONS[step.status]}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                color: step.status === 'running' ? '#00d4ff' : step.status === 'done' ? '#ccc' : '#666',
                fontSize: '0.85rem',
                fontWeight: step.status === 'running' ? 600 : 400,
              }}>
                {step.label}
              </div>
              {step.detail && (
                <div style={{
                  color: step.status === 'done' ? '#22c55e' : step.status === 'error' ? '#ef4444' : '#00d4ff',
                  fontSize: '0.7rem',
                  marginTop: '0.15rem',
                  opacity: 0.8,
                }}>
                  {step.detail}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        width: '380px',
        marginTop: '1.25rem',
        padding: '0.6rem 1rem',
        background: '#0a0a1a',
        borderRadius: '8px',
        border: '1px solid #1a1a2e',
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        minHeight: '2.5rem',
      }}>
        <span style={{
          color: '#00d4ff',
          fontSize: '0.65rem',
          fontFamily: "'Courier New', monospace",
          opacity: 0.6,
          animation: 'bootBlink 1s step-end infinite',
        }}>
          {'▸'}
        </span>
        <span style={{
          color: '#8b8ba0',
          fontSize: '0.75rem',
          fontFamily: "'Courier New', monospace",
          letterSpacing: '0.02em',
          opacity: glitchText ? 0 : 0.8,
          transition: 'opacity 0.1s',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {AI_STATUS_LINES[currentLine]}...
        </span>
      </div>

      {status && (
        <p style={{
          color: '#333',
          fontSize: '0.65rem',
          marginTop: '1rem',
          fontFamily: "'Courier New', monospace",
          letterSpacing: '0.1em',
        }}>
          ELAPSED: {status.elapsed}s
        </p>
      )}

      {showContinue && !status?.ready && (
        <button
          onClick={dismiss}
          style={{
            marginTop: '1rem',
            background: 'transparent',
            border: '1px solid #333',
            color: '#888',
            padding: '8px 24px',
            borderRadius: '8px',
            fontSize: '0.8rem',
            cursor: 'pointer',
            fontFamily: "'Courier New', monospace",
            letterSpacing: '0.05em',
            transition: 'border-color 0.2s, color 0.2s',
          }}
          onMouseEnter={e => { e.target.style.borderColor = '#00d4ff'; e.target.style.color = '#00d4ff'; }}
          onMouseLeave={e => { e.target.style.borderColor = '#333'; e.target.style.color = '#888'; }}
        >
          CONTINUE ANYWAY
        </button>
      )}

      {!status && (
        <div style={{
          marginTop: '2rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
        }}>
          <div style={{
            width: '2rem',
            height: '2rem',
            border: '3px solid #1a1a3a',
            borderTop: '3px solid #00d4ff',
            borderRadius: '50%',
            animation: 'bootSpin 1s linear infinite',
          }} />
          <p style={{ color: '#555', fontSize: '0.8rem', fontFamily: "'Courier New', monospace" }}>
            Connecting to server...
          </p>
        </div>
      )}

      <style>{`
        @keyframes bootPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes bootSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes bootBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes bootProgressShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes bootScanLine {
          0% { top: 0; opacity: 0; }
          10% { opacity: 0.4; }
          90% { opacity: 0.4; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
