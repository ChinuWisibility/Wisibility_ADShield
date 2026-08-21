import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authAPI } from '../services/api';
import { prefetchPostLoginRoutes } from '../utils/routePrefetch';
import {
  computeIsAdmin,
  computeIsOrgAdmin,
  computeIsPlatformAdmin,
  computeIsTenantAdmin,
} from '../utils/authPlanes';

/**
 * Vite + React Fast Refresh re-executes this module on edits. A fresh `createContext()` yields a
 * *new* context object so `useContext` no longer sees the existing Provider → "useAuth outside AuthProvider".
 * Reuse one context instance for the lifetime of the tab so HMR cannot desync Provider vs consumers.
 */
const AUTH_CTX_KEY = '__ICM_AUTH_CONTEXT__';
function getOrCreateAuthContext() {
  const g = globalThis;
  if (!g[AUTH_CTX_KEY]) {
    g[AUTH_CTX_KEY] = createContext(null);
  }
  return g[AUTH_CTX_KEY];
}

const AuthContext = getOrCreateAuthContext();
const PROFILE_REFRESH_DEDUPE_MS = 1000;

let profileRefreshInFlight = null;
let profileRefreshRecentPromise = null;
let profileRefreshRecentExpiresAt = 0;

function readUserFromStorage() {
  try {
    const saved = localStorage.getItem('icm_user');
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === 'object') return parsed;
    localStorage.removeItem('icm_user');
    return null;
  } catch {
    localStorage.removeItem('icm_user');
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readUserFromStorage());
  const [loading, setLoading] = useState(true);
  const userRef = useRef(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const refreshProfile = useCallback(async () => {
    const token = localStorage.getItem('icm_token');
    if (!token) return null;

    const now = Date.now();
    if (profileRefreshInFlight) return profileRefreshInFlight;
    if (profileRefreshRecentPromise && profileRefreshRecentExpiresAt > now) {
      return profileRefreshRecentPromise;
    }

    const request = authAPI
      .getProfile()
      .then((res) => {
        const userData = res.data.data;
        setUser(userData);
        localStorage.setItem('icm_user', JSON.stringify(userData));
        return userData;
      })
      .catch((err) => {
        const status = err?.response?.status;
        if (status === 401) {
          setUser(null);
          localStorage.removeItem('icm_token');
          localStorage.removeItem('icm_user');
        }
        return userRef.current;
      })
      .finally(() => {
        if (profileRefreshInFlight === request) {
          profileRefreshInFlight = null;
        }
      });

    profileRefreshInFlight = request;
    profileRefreshRecentPromise = request;
    profileRefreshRecentExpiresAt = now + PROFILE_REFRESH_DEDUPE_MS;
    window.setTimeout(() => {
      if (profileRefreshRecentPromise === request && profileRefreshRecentExpiresAt <= Date.now()) {
        profileRefreshRecentPromise = null;
      }
    }, PROFILE_REFRESH_DEDUPE_MS + 25);

    return request;
  }, []);

  useEffect(() => {
    refreshProfile().finally(() => setLoading(false));
  }, [refreshProfile]);

  useEffect(() => {
    const token = localStorage.getItem('icm_token');
    if (!token) return undefined;

    const handleFocus = () => { refreshProfile(); };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshProfile();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    const intervalId = window.setInterval(() => { refreshProfile(); }, 30000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(intervalId);
    };
  }, [refreshProfile]);

  const applySession = useCallback((userData, token) => {
    localStorage.setItem('icm_token', token);
    localStorage.setItem('icm_user', JSON.stringify(userData));
    setUser(userData);
    refreshProfile();
    prefetchPostLoginRoutes(userData?.role || 'user');
    return userData;
  }, [refreshProfile]);

  const login = useCallback(async (email, password) => {
    const res = await authAPI.login({ email, password });
    const { mfaRequired, mfaToken, user: userData, token } = res.data.data;
    if (mfaRequired) {
      // Second factor required — caller must prompt for a code and call
      // completeMfaLogin(mfaToken, code) to finish signing in.
      return { mfaRequired: true, mfaToken };
    }
    return applySession(userData, token);
  }, [applySession]);

  const completeMfaLogin = useCallback(async (mfaToken, code) => {
    const res = await authAPI.verifyLoginMfa({ mfaToken, code });
    const { user: userData, token } = res.data.data;
    return applySession(userData, token);
  }, [applySession]);

  const register = useCallback(async (data) => {
    const res = await authAPI.register(data);
    const { user: userData, token } = res.data.data;
    localStorage.setItem('icm_token', token);
    localStorage.setItem('icm_user', JSON.stringify(userData));
    setUser(userData);
    refreshProfile();
    prefetchPostLoginRoutes(userData?.role || 'user');
    return userData;
  }, [refreshProfile]);

  const logout = useCallback(() => {
    authAPI.logout().catch(() => { });
    localStorage.removeItem('icm_token');
    localStorage.removeItem('icm_user');
    setUser(null);
  }, []);

  const isAuthenticated = !!user;
  const isAdmin = computeIsAdmin(user);
  const isPlatformAdmin = computeIsPlatformAdmin(user);
  const isOrgAdmin = computeIsOrgAdmin(user);
  const isTenantAdmin = computeIsTenantAdmin(user);

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      completeMfaLogin,
      register,
      refreshProfile,
      logout,
      isAuthenticated,
      isAdmin,
      isPlatformAdmin,
      isOrgAdmin,
      isTenantAdmin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Last resort when context is still null (should be rare if AuthContext singleton is stable).
 * Keeps the UI from crashing during HMR; actions are no-ops until the real Provider mounts.
 */
function getDevAuthFallback() {
  const user = readUserFromStorage();
  const isAuthenticated = !!user;
  const noop = async () => {};
  const noopLogout = () => {};
  return {
    user,
    loading: false,
    login: noop,
    completeMfaLogin: noop,
    register: noop,
    refreshProfile: async () => null,
    logout: noopLogout,
    isAuthenticated,
    isAdmin: computeIsAdmin(user),
    isPlatformAdmin: computeIsPlatformAdmin(user),
    isOrgAdmin: computeIsOrgAdmin(user),
    isTenantAdmin: computeIsTenantAdmin(user),
  };
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;
  if (import.meta.env.DEV) {
    return getDevAuthFallback();
  }
  throw new Error('useAuth must be used within AuthProvider');
}
