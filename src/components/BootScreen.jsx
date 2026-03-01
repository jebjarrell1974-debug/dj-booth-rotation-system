import React, { useState, useEffect, useRef } from 'react';

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

export default function BootScreen({ onReady }) {
  const [status, setStatus] = useState(null);
  const [fadeOut, setFadeOut] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mountedRef = useRef(true);
  const dismissTimerRef = useRef(null);

  const dismiss = () => {
    if (!mountedRef.current) return;
    setFadeOut(true);
    dismissTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setDismissed(true);
      onReady();
    }, 800);
  };

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
  }, [onReady]);

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
    }}>
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{
          fontSize: '3rem',
          fontWeight: 800,
          color: '#00d4ff',
          textShadow: '0 0 40px rgba(0,212,255,0.5), 0 0 80px rgba(0,212,255,0.2)',
          margin: 0,
          letterSpacing: '0.05em',
        }}>
          NEON AI DJ
        </h1>
        <p style={{
          color: '#666',
          fontSize: '0.85rem',
          marginTop: '0.5rem',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
        }}>
          {status?.ready ? 'Ready' : 'Preparing System'}
        </p>
      </div>

      <div style={{
        width: '340px',
        background: '#0d0d1f',
        borderRadius: '16px',
        border: '1px solid #1a1a3a',
        padding: '1.5rem',
        boxShadow: '0 0 60px rgba(0,212,255,0.05)',
      }}>
        {steps.map((step) => (
          <div key={step.id} style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            padding: '0.6rem 0',
            borderBottom: '1px solid #1a1a2e',
          }}>
            <span style={{
              color: STATUS_COLORS[step.status],
              fontSize: '1.1rem',
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
                fontSize: '0.9rem',
                fontWeight: step.status === 'running' ? 600 : 400,
              }}>
                {step.label}
              </div>
              {step.detail && (
                <div style={{
                  color: step.status === 'done' ? '#22c55e' : step.status === 'error' ? '#ef4444' : '#00d4ff',
                  fontSize: '0.75rem',
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

      {status && (
        <p style={{
          color: '#444',
          fontSize: '0.75rem',
          marginTop: '1.5rem',
        }}>
          {status.elapsed}s elapsed
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
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          Continue Anyway
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
          <p style={{ color: '#555', fontSize: '0.85rem' }}>Connecting to server...</p>
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
      `}</style>
    </div>
  );
}
