import React, { useState, useCallback, useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import BootScreen from '@/components/BootScreen';
import Landing from '@/pages/Landing';
import DJBooth from '@/pages/DJBooth';
import DancerView from '@/pages/DancerView';
import RotationDisplay from '@/pages/RotationDisplay';
import Configuration from '@/pages/Configuration';
import FleetDashboard from '@/pages/FleetDashboard';
import VoiceStudio from '@/pages/VoiceStudio';
import Help from '@/pages/Help';

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

  const isDJPage = location.pathname === '/DJBooth';
  const isDisplayPage = location.pathname === '/RotationDisplay';

  if (isDisplayPage) return null;
  if (!isAuthenticated || role !== 'dj') return null;

  return (
    <div style={{ display: isDJPage ? 'block' : 'none', height: isDJPage ? 'auto' : 0, overflow: isDJPage ? 'visible' : 'hidden' }}>
      <DJBooth />
    </div>
  );
}

function AppRoutes() {
  const [isHomebase, setIsHomebase] = useState(false);

  useEffect(() => {
    fetch('/api/config/capabilities')
      .then(r => r.json())
      .then(data => setIsHomebase(data.isHomebase || false))
      .catch(() => setIsHomebase(false));
  }, []);

  return (
    <>
      <PersistentDJBooth />
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
  const skipBoot = window.location.pathname.startsWith('/fleet') || window.location.pathname === '/FleetDashboard';
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
