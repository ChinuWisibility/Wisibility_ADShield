import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ONBOARDING_CTX_KEY = '__ICM_ONBOARDING_CONTEXT__';

function getOrCreateOnboardingContext() {
  const g = globalThis;
  if (!g[ONBOARDING_CTX_KEY]) {
    g[ONBOARDING_CTX_KEY] = createContext(null);
  }
  return g[ONBOARDING_CTX_KEY];
}

const OnboardingContext = getOrCreateOnboardingContext();

function sanitizeKeyPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeOnboardingGroup(group) {
  const dn = String(group?.dn || '').trim();
  const name = String(group?.name || '').trim() || dn;
  const rawCount = Number(group?.memberCount);
  return {
    dn,
    name,
    memberCount: Number.isFinite(rawCount) && rawCount >= 0 ? rawCount : 0,
  };
}

export function buildOnboardingPayload(sourceApplicationId, onboardingSelections) {
  const applications = Object.values(onboardingSelections || {}).filter(
    (selection) =>
      String(selection?.sourceApplicationId || '') === String(sourceApplicationId || '') &&
      Array.isArray(selection?.selectedGroups) &&
      selection.selectedGroups.length > 0,
  );

  return {
    sourceApplicationId,
    applications: applications.map((selection) => ({
      detectedAppName: selection.detectedAppName,
      customName: String(selection.customName || '').trim() || selection.detectedAppName,
      tags: Array.isArray(selection.tags) ? selection.tags.filter(Boolean) : [],
      selectedGroups: Array.isArray(selection.selectedGroups)
        ? selection.selectedGroups.map((group) => normalizeOnboardingGroup(group))
        : [],
    })),
  };
}

export function buildSourceAppKey(sourceApplicationId, detectedAppName) {
  const sid = String(sourceApplicationId || '').trim();
  const name = sanitizeKeyPart(detectedAppName) || 'suggested-app';
  return `${sid}::${name}`;
}

export function OnboardingProvider({ children, sourceApplicationId }) {
  const [onboardingSelections, setOnboardingSelections] = useState({});

  useEffect(() => {
    setOnboardingSelections({});
  }, [sourceApplicationId]);

  const setApplicationSelection = useCallback((sourceAppKey, selection) => {
    if (!sourceAppKey) return;
    setOnboardingSelections((prev) => ({
      ...prev,
      [sourceAppKey]: {
        ...(prev[sourceAppKey] || {}),
        ...(selection || {}),
      },
    }));
  }, []);

  const clearApplicationSelection = useCallback((sourceAppKey) => {
    if (!sourceAppKey) return;
    setOnboardingSelections((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, sourceAppKey)) return prev;
      const next = { ...prev };
      delete next[sourceAppKey];
      return next;
    });
  }, []);

  const resetOnboardingSelections = useCallback(() => {
    setOnboardingSelections({});
  }, []);

  const value = useMemo(
    () => ({
      onboardingSelections,
      setApplicationSelection,
      clearApplicationSelection,
      resetOnboardingSelections,
    }),
    [
      onboardingSelections,
      setApplicationSelection,
      clearApplicationSelection,
      resetOnboardingSelections,
    ],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return ctx;
}
