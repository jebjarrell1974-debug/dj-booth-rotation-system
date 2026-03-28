import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { auth, getSessionInfo, clearToken, setSessionInfo, isRemoteMode } from '@/api/serverApi';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [staffName, setStaffName] = useState(null);
  const [staffRole, setStaffRole] = useState(null);
  const [isMaster, setIsMaster] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState({});
  const [dancerSession, setDancerSession] = useState(null);

  const autoLoginAttemptedRef = React.useRef(false);

  const checkSession = useCallback(async () => {
    const info = getSessionInfo();
    if (!info.token) {
      if (!autoLoginAttemptedRef.current && !isRemoteMode()) {
        autoLoginAttemptedRef.current = true;
        try {
          const res = await fetch('/api/auth/auto-login', { method: 'POST' });
          if (res.ok) {
            const data = await res.json();
            setSessionInfo(data);
            setUser({ name: data.staffName || 'DJ' });
            setRole('dj');
            setStaffName(data.staffName || null);
            setStaffRole(data.staffRole || null);
            setIsMaster(!!data.isMaster);
            setIsAuthenticated(true);
            setIsLoadingAuth(false);
            return;
          }
        } catch {
        }
      }
      setIsLoadingAuth(false);
      return;
    }
    const tokenAtStart = info.token;
    try {
      const data = await auth.checkSession();
      setUser({ name: data.dancerName || data.staffName || 'DJ', dancerId: data.dancerId });
      setRole(data.role);
      setStaffName(data.staffName || null);
      setStaffRole(data.staffRole || null);
      setIsMaster(!!data.isMaster);
      setIsAuthenticated(true);
    } catch (err) {
      if (err.message === 'Session expired' && getToken() === null) {
        setUser(null);
        setRole(null);
        setStaffName(null);
        setStaffRole(null);
        setIsMaster(false);
        setIsAuthenticated(false);
      } else if (err.message !== 'Session expired' && getToken() === tokenAtStart) {
        clearToken();
        setUser(null);
        setRole(null);
        setStaffName(null);
        setStaffRole(null);
        setIsMaster(false);
        setIsAuthenticated(false);
      }
    }
    setIsLoadingAuth(false);
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    const handler = () => {
      setUser(null);
      setRole(null);
      setStaffName(null);
      setStaffRole(null);
      setIsMaster(false);
      setIsAuthenticated(false);
    };
    window.addEventListener('djbooth-session-expired', handler);
    return () => window.removeEventListener('djbooth-session-expired', handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setDancerSession(null);
    };
    window.addEventListener('djbooth-dancer-session-expired', handler);
    return () => window.removeEventListener('djbooth-dancer-session-expired', handler);
  }, []);

  const login = useCallback(async (loginRole, pin, options = {}) => {
    const data = await auth.login(loginRole, pin);
    if (options.remote) data.remote = true;

    if (loginRole === 'dancer' && role === 'dj' && isAuthenticated && !isRemoteMode()) {
      setDancerSession({
        token: data.token,
        dancerId: data.dancerId,
        dancerName: data.dancerName,
        user: { name: data.dancerName, dancerId: data.dancerId },
      });
      return data;
    }

    setSessionInfo(data);
    setUser({ name: data.dancerName || data.staffName || 'DJ', dancerId: data.dancerId });
    setRole(data.role);
    setStaffName(data.staffName || null);
    setStaffRole(data.staffRole || null);
    setIsMaster(!!data.isMaster);
    setIsAuthenticated(true);
    return data;
  }, [role, isAuthenticated]);

  const initDjPin = useCallback(async (pin) => {
    const data = await auth.initDjPin(pin);
    setSessionInfo(data);
    setUser({ name: 'Staff' });
    setRole('dj');
    setStaffName('Staff');
    setStaffRole('dj');
    setIsMaster(false);
    setIsAuthenticated(true);
    return data;
  }, []);

  const logout = useCallback(async () => {
    if (dancerSession) {
      setDancerSession(null);
      return;
    }
    await auth.logout();
    clearToken();
    setUser(null);
    setRole(null);
    setStaffName(null);
    setStaffRole(null);
    setIsMaster(false);
    setIsAuthenticated(false);
  }, [dancerSession]);

  const logoutDancerSession = useCallback(() => {
    setDancerSession(null);
  }, []);

  const navigateToLogin = () => {};

  return (
    <AuthContext.Provider value={{ 
      user, 
      role,
      staffName,
      staffRole,
      isMaster,
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      login,
      initDjPin,
      logout,
      navigateToLogin,
      checkAppState: checkSession,
      dancerSession,
      logoutDancerSession,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
