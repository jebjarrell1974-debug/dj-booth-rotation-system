import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import BootScreen from '@/components/BootScreen';
import VirtualKeyboard from '@/components/VirtualKeyboard';
import Landing from '@/pages/Landing';
import DJBooth from '@/pages/DJBooth';
import DancerView from '@/pages/DancerView';
import RotationDisplay from '@/pages/RotationDisplay';
import Configuration from '@/pages/Configuration';
import FleetDashboard from '@/pages/FleetDashboard';
import VoiceStudio from '@/pages/VoiceStudio';
import Help from '@/pages/Help';

if (window.location.pathname === '/RotationDisplay') { document.title = 'NEON DJ Rotation'; }

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ background: '#08081a', color: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', fontFamily: 'sans-serif' }}>
          <h2 style={{ color: '#00d4ff', marginBottom: '1rem' }}>Something went wrong</h2>
          <p style={{ color: '#999', marginBottom: '1.5rem', textAlign: 'center', maxWidth: '400px' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/'; }}
            style={{ background: '#00d4ff', color: '#000', border: 'none', padding: '12px 32px', borderRadius: '12px', fontSize: '16px', fontWeight: 600, cursor: 'pointer' }}
          >
            Go Back
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedRoute({ children, allowedRole }) {
  const { isAuthenticated, role, isLoadingAuth, dancerSession } = useAuth();
  
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#08081a]">
        <div className="w-8 h-8 border-4 border-[#00d4ff]/30 border-t-[#00d4ff] rounded-full animate-spin"></div>
      </div>
    );
  }
  
  if (allowedRole === 'dancer' && dancerSession) return children;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (allowedRole && role !== allowedRole) return <Navigate to="/" replace />;
  
  return children;
}

function PersistentDJBooth() {
  const location = useLocation();
  const { isAuthenticated, role } = useAuth();
  const [everStarted, setEverStarted] = useState(false);

  const isDJPage = location.pathname === '/DJBooth';
  const isDisplayPage = location.pathname === '/RotationDisplay';

  useEffect(() => {
    if (isAuthenticated && role === 'dj') setEverStarted(true);
  }, [isAuthenticated, role]);

  if (isDisplayPage) return null;
  if (!everStarted) return null;

  return (
    <div style={{ display: isDJPage ? 'block' : 'none', height: isDJPage ? 'auto' : 0, overflow: isDJPage ? 'visible' : 'hidden' }}>
      <DJBooth />
    </div>
  );
}

const KIOSK_INACTIVITY_MS = 3 * 60 * 1000;
const KIOSK_WARNING_SECS = 30;

function KioskLockManager() {
  const { isAuthenticated, role } = useAuth();
  const location = useLocation();
  const [countdown, setCountdown] = useState(null);
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const timerRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const countdownValRef = useRef(null);
  const lockedRef = useRef(false);

  const isActive = isAuthenticated && role === 'dj' && location.pathname !== '/RotationDisplay';

  const doLock = useCallback(() => {
    clearTimeout(timerRef.current);
    clearInterval(countdownIntervalRef.current);
    setCountdown(null);
    lockedRef.current = true;
    setLocked(true);
    setPin('');
    setUnlockError('');
  }, []);

  const startTimer = useCallback(() => {
    clearTimeout(timerRef.current);
    clearInterval(countdownIntervalRef.current);
    setCountdown(null);
    countdownValRef.current = null;
    timerRef.current = setTimeout(() => {
      countdownValRef.current = KIOSK_WARNING_SECS;
      setCountdown(KIOSK_WARNING_SECS);
      countdownIntervalRef.current = setInterval(() => {
        countdownValRef.current = (countdownValRef.current || 1) - 1;
        if (countdownValRef.current <= 0) {
          clearInterval(countdownIntervalRef.current);
          doLock();
        } else {
          setCountdown(countdownValRef.current);
        }
      }, 1000);
    }, KIOSK_INACTIVITY_MS - KIOSK_WARNING_SECS * 1000);
  }, [doLock]);

  const resetTimer = useCallback(() => {
    if (lockedRef.current) return;
    startTimer();
  }, [startTimer]);

  const handleUnlock = useCallback(async (pinToTry) => {
    if (pinToTry.length !== 5 || unlocking) return;
    setUnlocking(true);
    setUnlockError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'dj', pin: pinToTry }),
      });
      if (res.ok) {
        lockedRef.current = false;
        setLocked(false);
        setPin('');
        setUnlockError('');
        startTimer();
      } else {
        setUnlockError('Incorrect PIN');
        setPin('');
      }
    } catch {
      setUnlockError('Connection error');
      setPin('');
    }
    setUnlocking(false);
  }, [unlocking, startTimer]);

  const handlePinDigit = useCallback((digit) => {
    setPin(prev => {
      const next = prev + digit;
      if (next.length === 5) {
        handleUnlock(next);
        return next;
      }
      return next;
    });
  }, [handleUnlock]);

  const handlePinBackspace = useCallback(() => {
    setPin(prev => prev.slice(0, -1));
    setUnlockError('');
  }, []);

  useEffect(() => {
    if (!isActive) {
      clearTimeout(timerRef.current);
      clearInterval(countdownIntervalRef.current);
      setCountdown(null);
      lockedRef.current = false;
      setLocked(false);
      return;
    }
    document.addEventListener('click', resetTimer);
    document.addEventListener('touchstart', resetTimer);
    startTimer();
    return () => {
      document.removeEventListener('click', resetTimer);
      document.removeEventListener('touchstart', resetTimer);
      clearTimeout(timerRef.current);
      clearInterval(countdownIntervalRef.current);
    };
  }, [isActive, resetTimer, startTimer]);

  if (locked) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(8,8,26,0.96)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', width: '100%', maxWidth: 320, padding: '0 1.5rem' }}>
          <div style={{ color: '#00d4ff', fontSize: 13, fontWeight: 700, letterSpacing: 3, marginBottom: '2rem', textTransform: 'uppercase' }}>Screen Locked</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginBottom: '1.25rem' }}>
            {[0,1,2,3,4].map(i => (
              <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: i < pin.length ? '#00d4ff' : 'rgba(255,255,255,0.15)', transition: 'background 0.15s', boxShadow: i < pin.length ? '0 0 8px #00d4ff88' : 'none' }} />
            ))}
          </div>
          {unlockError && <div style={{ color: '#ff2d55', fontSize: 13, marginBottom: '0.75rem', minHeight: 20 }}>{unlockError}</div>}
          {!unlockError && unlocking && <div style={{ color: '#6b7280', fontSize: 13, marginBottom: '0.75rem', minHeight: 20 }}>Checking...</div>}
          {!unlockError && !unlocking && <div style={{ minHeight: 20, marginBottom: '0.75rem' }} />}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
            {[1,2,3,4,5,6,7,8,9].map(d => (
              <button
                key={d}
                onClick={() => handlePinDigit(String(d))}
                disabled={unlocking}
                style={{ height: 68, fontSize: 26, fontWeight: 600, color: '#fff', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, cursor: 'pointer', transition: 'background 0.12s' }}
              >
                {d}
              </button>
            ))}
            <button
              onClick={handlePinBackspace}
              disabled={unlocking}
              style={{ height: 68, fontSize: 20, fontWeight: 600, color: '#6b7280', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, cursor: 'pointer' }}
            >
              ⌫
            </button>
            <button
              onClick={() => handlePinDigit('0')}
              disabled={unlocking}
              style={{ height: 68, fontSize: 26, fontWeight: 600, color: '#fff', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, cursor: 'pointer' }}
            >
              0
            </button>
            <div style={{ height: 68 }} />
          </div>
        </div>
      </div>
    );
  }

  if (countdown) {
    return (
      <div
        onClick={resetTimer}
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(8,8,26,0.92)', backdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
      >
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ width: 88, height: 88, borderRadius: '50%', border: `3px solid ${countdown <= 10 ? '#ff2d55' : '#00d4ff'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', fontSize: 36, fontWeight: 700, color: countdown <= 10 ? '#ff2d55' : '#00d4ff', transition: 'color 0.3s, border-color 0.3s' }}>
            {countdown}
          </div>
          <p style={{ color: '#fff', fontSize: 20, fontWeight: 600, marginBottom: '0.5rem' }}>Screen locking soon</p>
          <p style={{ color: '#6b7280', fontSize: 14, marginBottom: '2rem' }}>Tap anywhere to stay logged in</p>
          <button
            onClick={e => { e.stopPropagation(); resetTimer(); }}
            style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid #00d4ff', color: '#00d4ff', padding: '10px 32px', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            Stay Logged In
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function AppRoutes() {
  const [isHomebase, setIsHomebase] = useState(false);

  useEffect(() => {
    fetch('/api/config/capabilities')
      .then(r => r.json())
      .then(data => setIsHomebase(data.isHomebase || false))
      .catch(() => setIsHomebase(false));
  }, []);

  const location = useLocation();
  const isRotationDisplay = location.pathname === '/RotationDisplay';

  return (
    <>
      <KioskLockManager />
      <PersistentDJBooth />
      {!isRotationDisplay && <VirtualKeyboard />}
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/Landing" element={<Landing />} />
        <Route path="/DJBooth" element={
          <ProtectedRoute allowedRole="dj">
            <></>
          </ProtectedRoute>
        } />
        <Route path="/Configuration" element={
          <ProtectedRoute allowedRole="dj">
            <Configuration />
          </ProtectedRoute>
        } />
        <Route path="/DancerView" element={
          <ProtectedRoute allowedRole="dancer">
            <DancerView />
          </ProtectedRoute>
        } />
        <Route path="/RotationDisplay" element={<RotationDisplay />} />
        <Route path="/fleet" element={<FleetDashboard />} />
        <Route path="/FleetDashboard" element={<FleetDashboard />} />
        {isHomebase && (
          <Route path="/VoiceStudio" element={
            <ProtectedRoute allowedRole="dj">
              <VoiceStudio />
            </ProtectedRoute>
          } />
        )}
        <Route path="/Help" element={
          <ProtectedRoute allowedRole="dj">
            <Help />
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function App() {
  const skipBoot = window.location.pathname.startsWith('/fleet') || window.location.pathname === '/FleetDashboard' || window.location.pathname === '/RotationDisplay';
  const [bootComplete, setBootComplete] = useState(skipBoot);
  const handleBootReady = useCallback(() => setBootComplete(true), []);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          {!bootComplete && <BootScreen onReady={handleBootReady} />}
          <Router>
            <AppRoutes />
          </Router>
          <Toaster />
          <SonnerToaster position="top-center" theme="dark" richColors />
        </QueryClientProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
