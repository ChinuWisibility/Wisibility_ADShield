import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { brandingAPI, resolveServerBaseUrl } from '../services/api';
import { BRANDING } from '../constants/branding';

/* ═══════════════════════════════════════════════
   DEFAULT LAYOUT COLORS
   These are the full set of layout surfaces.
   Each can be overridden from the Branding admin.
═══════════════════════════════════════════════ */
export const DEFAULT_LAYOUT_COLORS = {
  // Sidebar
  sidebarBg: '#ffffff',
  sidebarAccent: '#3b82f6',
  sidebarText: '#0f172a',
  sidebarBorder: 'rgba(37,99,235,0.12)',

  // Topbar
  topbarBg: '#ffffff',
  topbarBorder: 'rgba(37,99,235,0.12)',
  topbarText: '#0f172a',

  // Auth left panel
  authPanelBg: '#1e3a8a',

  // Page/content area
  pageBg: '#f8fafc',

  // Brand accent (buttons, highlights)
  accentPrimary: '#2563EB',
  accentSecondary: '#7C3AED',
};

const DEFAULTS = {
  companyName: BRANDING.name,
  primaryColor: '#2563EB',
  secondaryColor: '#7C3AED',
  customCss: '',
  logoId: null,
  faviconId: null,
  logoUrl: null,
  faviconUrl: null,
  layoutColors: DEFAULT_LAYOUT_COLORS,
};

const BrandingContext = createContext(null);
const BRANDING_FETCH_DEDUPE_MS = 1000;

let brandingFetchInFlight = null;
let brandingRecentPromise = null;
let brandingRecentExpiresAt = 0;

function resolveLogoUrl(logoField) {
  if (!logoField) return null;
  if (typeof logoField === 'object' && logoField.fileUrl) {
    const url = logoField.fileUrl;
    if (url.startsWith('http')) return url;
    const base = resolveServerBaseUrl();
    return `${base}${url}`;
  }
  return null;
}

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const location = useLocation();
  const scheduledBackgroundFetch = useRef(false);
  const initialFetchStarted = useRef(false);

  // Auth pages are latency-sensitive. They only need the default branding.
  // We load full branding when entering protected pages (after login).
  const isAuthRoute = [
    '/login',
    '/reset-password',
    '/reset-password/confirm',
    '/create-own-password',
  ].includes(location.pathname);

  const fetchBranding = useCallback(async () => {
    const now = Date.now();
    if (brandingFetchInFlight) return brandingFetchInFlight;
    if (brandingRecentPromise && brandingRecentExpiresAt > now) {
      return brandingRecentPromise;
    }

    const request = brandingAPI
      .get()
      .then((res) => {
        const data = res.data.data;
        if (data) {
          setBranding(() => ({
            ...DEFAULTS,
            ...data,
            /* Merge layoutColors so missing keys fall back to defaults */
            layoutColors: { ...DEFAULT_LAYOUT_COLORS, ...(data.layoutColors || {}) },
            logoUrl: resolveLogoUrl(data.logoId),
            faviconUrl: resolveLogoUrl(data.faviconId),
          }));
        }
      })
      .catch(() => {
        // Use defaults on failure
      })
      .finally(() => {
        if (brandingFetchInFlight === request) {
          brandingFetchInFlight = null;
        }
        setLoaded(true);
      });

    brandingFetchInFlight = request;
    brandingRecentPromise = request;
    brandingRecentExpiresAt = now + BRANDING_FETCH_DEDUPE_MS;
    window.setTimeout(() => {
      if (brandingRecentPromise === request && brandingRecentExpiresAt <= Date.now()) {
        brandingRecentPromise = null;
      }
    }, BRANDING_FETCH_DEDUPE_MS + 25);

    return request;
  }, []);

  useEffect(() => {
    if (isAuthRoute) {
      setLoaded(true);
      // Fetch branding after the user can see the page.
      // This avoids blocking first paint on `/login` while still applying custom logo/company branding soon after.
      if (!scheduledBackgroundFetch.current) {
        scheduledBackgroundFetch.current = true;
        initialFetchStarted.current = true;
        const run = () => { fetchBranding(); };
        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          window.requestIdleCallback(run, { timeout: 5000 });
        } else {
          window.setTimeout(run, 2000);
        }
      }
      return;
    }
    // Avoid duplicate auto-fetch if we already started it during an auth route.
    if (!initialFetchStarted.current) {
      initialFetchStarted.current = true;
      fetchBranding();
    }
  }, [fetchBranding, isAuthRoute]);

  const refreshBranding = useCallback(async () => {
    await fetchBranding();
  }, [fetchBranding]);

  const updateBranding = useCallback((partial) => {
    setBranding((prev) => ({
      ...prev,
      ...partial,
      layoutColors: { ...(prev.layoutColors || {}), ...(partial.layoutColors || {}) },
    }));
  }, []);

  return (
    <BrandingContext.Provider value={{ branding, loaded, refreshBranding, updateBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used within BrandingProvider');
  return ctx;
}
