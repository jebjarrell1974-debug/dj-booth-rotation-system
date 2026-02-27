import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { auth, getSessionInfo, clearToken, setSessionInfo, isRemoteMode } from '@/api/serverApi';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState({});

  const checkSession = useCallback(async () => {
    const info = getSessionInfo();
    if (!info.token) {
      setIsLoadingAuth(false);
      return;
    }
    try {
      const data = await auth.checkSession();
      setUser({ name: data.dancerName || 'DJ', dancerId: data.dancerId });
      setRole(data.role);
      setIsAuthenticated(true);
    } catch {
      clearToken();
      setUser(null);
      setRole(null);
      setIsAuthenticated(false);
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
      setIsAuthenticated(false);
    };
    window.addEventListener('djbooth-session-expired', handler);
    return () => window.removeEventListener('djbooth-session-expired', handler);
  }, []);

  const login = useCallback(async (loginRole, pin, options = {}) => {
    const data = await auth.login(loginRole, pin);
    if (options.remote) data.remote = true;
    setSessionInfo(data);
    setUser({ name: data.dancerName || 'DJ', dancerId: data.dancerId });
    setRole(data.role);
    setIsAuthenticated(true);
    return data;
  }, []);

  const initDjPin = useCallback(async (pin) => {
    const data = await auth.initDjPin(pin);
    setSessionInfo(data);
    setUser({ name: 'DJ' });
    setRole('dj');
    setIsAuthenticated(true);
    return data;
  }, []);

  const logout = useCallback(async () => {
    await auth.logout();
    clearToken();
    setUser(null);
    setRole(null);
    setIsAuthenticated(false);
  }, []);

  const navigateToLogin = () => {};

  return (
    <AuthContext.Provider value={{ 
      user, 
      role,
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      login,
      initDjPin,
      logout,
      navigateToLogin,
      checkAppState: checkSession
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
