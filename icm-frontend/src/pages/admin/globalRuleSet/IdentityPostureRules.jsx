import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import {
  ArrowBack,
  GroupsOutlined,
  RestartAlt,
  RuleOutlined,
  Save,
  TuneOutlined,
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { orgAdminAPI, identityAPI } from '../../../services/api';
import PostureMetricsRules from './components/PostureMetricsRules';
import PeerComparisonRules from './components/PeerComparisonRules';
import IdentityAttributesRules from './components/IdentityAttributesRules';
import {
  POSTURE_METRICS_TITLE,
  IDENTITY_ATTRIBUTES_RULES_TITLE,
  IDENTITY_POSTURE_RULES_PAGE_TITLE,
  PEER_COMPARISON_TITLE,
} from '../../identities/posture/identityPostureLabels';

const ORG_ADMIN_BASE = '/org-admin';

const NAV = [
  { id: 'health', label: POSTURE_METRICS_TITLE, icon: <TuneOutlined fontSize="small" /> },
  { id: 'peer', label: PEER_COMPARISON_TITLE, icon: <GroupsOutlined fontSize="small" /> },
  { id: 'attributes', label: IDENTITY_ATTRIBUTES_RULES_TITLE, icon: <RuleOutlined fontSize="small" /> },
];

const studioPageSx = { minHeight: '100%', bgcolor: '#f8fafc' };
const studioContentSx = { px: { xs: 2, sm: 3 }, py: 3, maxWidth: 1280, mx: 'auto', width: '100%' };
const studioPageHeaderSx = {
  px: { xs: 2, sm: 3 },
  py: 2.5,
  bgcolor: '#fff',
  borderBottom: '1px solid',
  borderColor: 'divider',
};
const studioTabsSx = {
  px: { xs: 2, sm: 3 },
  bgcolor: '#fff',
  borderBottom: '1px solid',
  borderColor: 'divider',
  '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, fontSize: '0.875rem', minHeight: 48 },
};

// --- Rule load/save helpers (API ↔ editor state) ---

const RISK_LEVEL_DEFS = [
  { key: 'safe', label: 'Safe', color: '#16a34a', defaultUpTo: 0, defaultScore: 100 },
  { key: 'low', label: 'Low', color: '#65a30d', defaultUpTo: 1, defaultScore: 85 },
  { key: 'medium', label: 'Medium', color: '#ca8a04', defaultUpTo: 3, defaultScore: 50 },
  { key: 'high', label: 'High', color: '#dc2626', defaultUpTo: 999, defaultScore: 0 },
];

const ACCESS_RISK_LEVEL_DEFS = [
  { key: 'safe', label: 'Safe', color: '#16a34a', defaultUpTo: 0, defaultScore: 100 },
  { key: 'low', label: 'Low', color: '#65a30d', defaultUpTo: 2, defaultScore: 85 },
  { key: 'medium', label: 'Medium', color: '#ca8a04', defaultUpTo: 5, defaultScore: 50 },
  { key: 'high', label: 'High', color: '#dc2626', defaultUpTo: 100, defaultScore: 0 },
];

const ACCESS_SCORE_LEVEL_DEFS = [
  { key: 'poor', label: 'Poor', color: '#dc2626', defaultUpTo: 40, defaultScore: 0 },
  { key: 'moderate', label: 'Moderate', color: '#ca8a04', defaultUpTo: 60, defaultScore: 50 },
  { key: 'good', label: 'Good', color: '#2563eb', defaultUpTo: 80, defaultScore: 85 },
  { key: 'excellent', label: 'Excellent', color: '#16a34a', defaultUpTo: 100, defaultScore: 100 },
];

const COMPLEXITY_LEVEL_DEFS = [
  { key: 'excellent', label: 'Excellent', color: '#16a34a', defaultUpTo: 0, defaultScore: 100 },
  { key: 'good', label: 'Good', color: '#2563eb', defaultUpTo: 5, defaultScore: 85 },
  { key: 'moderate', label: 'Moderate', color: '#ca8a04', defaultUpTo: 10, defaultScore: 50 },
  { key: 'poor', label: 'Poor', color: '#dc2626', defaultUpTo: 999, defaultScore: 0 },
];

function clampScore(value) {
  return Math.round(Math.max(0, Math.min(100, Number(value) || 0)));
}

function clampGroupCount(n) {
  return Math.round(Math.max(0, Math.min(999, Number(n) || 0)));
}

function normalizeOrderedLevels(levels, defs) {
  const raw = defs.map((def) => {
    const found = (levels || []).find((l) => l.key === def.key);
    const isHigh = def.key === 'high' || def.key === 'poor';
    return {
      key: def.key,
      upTo: isHigh ? 999 : Number(found?.upTo ?? def.defaultUpTo),
      score: clampScore(found?.score ?? def.defaultScore),
    };
  });
  const [first, second, third] = raw;
  first.upTo = Math.max(0, first.upTo);
  second.upTo = Math.max(first.upTo, second.upTo);
  third.upTo = Math.max(second.upTo, third.upTo);
  return raw;
}

function clampAccessCount(n) {
  return Math.round(Math.max(0, Math.min(100, Number(n) || 0)));
}

function normalizeAccessRiskLevels(levels) {
  const legacyBandKeys = ['band1', 'band2', 'band3', 'band4'];
  const raw = ACCESS_RISK_LEVEL_DEFS.map((def, idx) => {
    const found = (levels || []).find((l) => l.key === def.key)
      || (levels || []).find((l) => l.key === legacyBandKeys[idx]);
    const isHigh = def.key === 'high';
    return {
      key: def.key,
      upTo: isHigh ? 100 : clampAccessCount(found?.upTo ?? def.defaultUpTo),
      score: clampScore(found?.score ?? def.defaultScore),
    };
  });
  raw[0].upTo = clampAccessCount(raw[0].upTo);
  raw[1].upTo = clampAccessCount(Math.max(raw[0].upTo, raw[1].upTo));
  raw[2].upTo = clampAccessCount(Math.max(raw[1].upTo, raw[2].upTo));
  raw[3].upTo = 100;
  return raw;
}

function normalizeRiskLevels(levels) {
  return normalizeOrderedLevels(levels, RISK_LEVEL_DEFS);
}

function normalizeAccessTierLevelsFromTiers(tiers) {
  const sorted = [...tiers].sort(
    (a, b) => (a.maxPrivilegedEntitlements ?? 0) - (b.maxPrivilegedEntitlements ?? 0),
  );
  const finite = sorted.filter((t) => (t.maxPrivilegedEntitlements ?? 0) < 100);
  return normalizeAccessRiskLevels([
    { key: 'safe', upTo: finite[0]?.maxPrivilegedEntitlements ?? 0, score: finite[0]?.score ?? 100 },
    { key: 'low', upTo: finite[1]?.maxPrivilegedEntitlements ?? 2, score: finite[1]?.score ?? 85 },
    { key: 'medium', upTo: finite[2]?.maxPrivilegedEntitlements ?? 5, score: finite[2]?.score ?? 50 },
    { key: 'high', upTo: 100, score: sorted[sorted.length - 1]?.score ?? 0 },
  ]);
}

function normalizeComplexityLevels(levels) {
  return normalizeOrderedLevels(levels, COMPLEXITY_LEVEL_DEFS);
}

function normalizeAccessScoreLevels(levels) {
  const raw = ACCESS_SCORE_LEVEL_DEFS.map((def) => {
    const found = (levels || []).find((l) => l.key === def.key);
    const isExcellent = def.key === 'excellent';
    return {
      key: def.key,
      upTo: isExcellent ? 100 : clampScore(found?.upTo ?? def.defaultUpTo),
      score: clampScore(found?.score ?? def.defaultScore),
    };
  });
  raw[0].upTo = clampScore(raw[0].upTo);
  raw[1].upTo = clampScore(Math.max(raw[0].upTo, raw[1].upTo));
  raw[2].upTo = clampScore(Math.max(raw[1].upTo, raw[2].upTo));
  raw[3].upTo = 100;
  return raw;
}

function normalizeComplexityThresholds(config) {
  const defaultScore = clampScore(config?.defaultScore ?? 100);
  const raw = Array.isArray(config?.thresholds) ? config.thresholds : [];
  const medium = raw.find((t) => t.key === 'medium') || raw[0] || { minGroups: 5, score: 75 };
  const high = raw.find((t) => t.key === 'high') || raw[1] || { minGroups: 10, score: 50 };
  let lowBreak = clampGroupCount(medium.minGroups ?? 5);
  let highBreak = clampGroupCount(high.minGroups ?? 10);
  if (highBreak <= lowBreak) highBreak = Math.min(999, lowBreak + 1);
  return {
    defaultScore,
    thresholds: [
      { key: 'high', minGroups: highBreak, score: clampScore(high.score ?? 50) },
      { key: 'medium', minGroups: lowBreak, score: clampScore(medium.score ?? 75) },
    ],
  };
}

function complexityLevelsToThresholds(levels) {
  const norm = normalizeComplexityLevels(levels);
  const excellent = norm.find((l) => l.key === 'excellent');
  const good = norm.find((l) => l.key === 'good');
  const moderate = norm.find((l) => l.key === 'moderate');
  const poor = norm.find((l) => l.key === 'poor');
  const thresholds = [];
  if (moderate && poor) thresholds.push({ key: 'high', minGroups: moderate.upTo, score: poor.score });
  if (good && moderate) thresholds.push({ key: 'medium', minGroups: good.upTo, score: moderate.score });
  return normalizeComplexityThresholds({ defaultScore: excellent?.score ?? 100, thresholds });
}

function levelsToAccessTiers(levels) {
  const norm = normalizeAccessRiskLevels(levels);
  const safe = norm.find((l) => l.key === 'safe');
  const low = norm.find((l) => l.key === 'low');
  const medium = norm.find((l) => l.key === 'medium');
  const high = norm.find((l) => l.key === 'high');
  const tiers = [{ maxPrivilegedEntitlements: safe.upTo, score: safe.score }];
  if (low.upTo > safe.upTo) tiers.push({ maxPrivilegedEntitlements: low.upTo, score: low.score });
  if (medium.upTo > low.upTo) tiers.push({ maxPrivilegedEntitlements: medium.upTo, score: medium.score });
  tiers.push({ maxPrivilegedEntitlements: high.upTo, score: high.score });
  return tiers;
}

function levelsToSodTiers(levels) {
  const norm = normalizeRiskLevels(levels);
  const safe = norm.find((l) => l.key === 'safe');
  const low = norm.find((l) => l.key === 'low');
  const medium = norm.find((l) => l.key === 'medium');
  const high = norm.find((l) => l.key === 'high');
  const tiers = [{ maxViolations: safe.upTo, score: safe.score }];
  if (low.upTo > safe.upTo) tiers.push({ maxViolations: low.upTo, score: low.score });
  if (medium.upTo > low.upTo) tiers.push({ maxViolations: medium.upTo, score: medium.score });
  tiers.push({ maxViolations: 999, score: high.score });
  return tiers;
}

function levelsToComplexityTiers(levels) {
  const norm = normalizeComplexityLevels(levels);
  const excellent = norm.find((l) => l.key === 'excellent');
  const good = norm.find((l) => l.key === 'good');
  const moderate = norm.find((l) => l.key === 'moderate');
  const poor = norm.find((l) => l.key === 'poor');
  const tiers = [{ maxGroups: excellent.upTo, score: excellent.score }];
  if (good.upTo > excellent.upTo) tiers.push({ maxGroups: good.upTo, score: good.score });
  if (moderate.upTo > good.upTo) tiers.push({ maxGroups: moderate.upTo, score: moderate.score });
  tiers.push({ maxGroups: 999, score: poor.score });
  return tiers;
}

function levelsFromMaxTiers(sortedTiers, defs, maxKey = 'maxViolations') {
  const finite = sortedTiers.filter((t) => (t[maxKey] ?? 0) < 999);
  return normalizeOrderedLevels(
    [
      { key: defs[0].key, upTo: finite[0]?.[maxKey] ?? defs[0].defaultUpTo, score: finite[0]?.score ?? defs[0].defaultScore },
      { key: defs[1].key, upTo: finite[1]?.[maxKey] ?? defs[1].defaultUpTo, score: finite[1]?.score ?? defs[1].defaultScore },
      { key: defs[2].key, upTo: finite[2]?.[maxKey] ?? defs[2].defaultUpTo, score: finite[2]?.score ?? defs[2].defaultScore },
      { key: defs[3].key, upTo: 999, score: sortedTiers[sortedTiers.length - 1]?.score ?? defs[3].defaultScore },
    ],
    defs,
  );
}

function loadSodLevelsFromRules(rules) {
  if (Array.isArray(rules?.sodRisk?.levels) && rules.sodRisk.levels.length > 0) {
    return normalizeRiskLevels(rules.sodRisk.levels);
  }
  const tiers = rules?.sodRisk?.tiers;
  if (Array.isArray(tiers) && tiers.length > 0) {
    const sorted = [...tiers].sort((a, b) => a.maxViolations - b.maxViolations);
    return levelsFromMaxTiers(sorted, RISK_LEVEL_DEFS, 'maxViolations');
  }
  return normalizeRiskLevels([]);
}

function loadAccessLevelsFromRules(rules) {
  if (Array.isArray(rules?.accessHygiene?.levels) && rules.accessHygiene.levels.length > 0) {
    return normalizeAccessRiskLevels(rules.accessHygiene.levels);
  }
  const tiers = rules?.accessHygiene?.tiers;
  if (Array.isArray(tiers) && tiers.length > 0) {
    return normalizeAccessTierLevelsFromTiers(tiers);
  }
  return normalizeAccessRiskLevels([]);
}

function loadIdentityConfigFromRules(rules) {
  const ih = rules?.identityHygiene || {};
  const scoreLevels = Array.isArray(ih.scoreLevels) && ih.scoreLevels.length > 0
    ? normalizeAccessScoreLevels(ih.scoreLevels)
    : normalizeAccessScoreLevels([]);
  return { checks: Array.isArray(ih.checks) ? [...ih.checks] : [], scoreLevels };
}

function complexityLevelsFromThresholds(complexity) {
  const norm = normalizeComplexityThresholds({
    defaultScore: complexity?.defaultScore,
    thresholds: complexity?.thresholds,
  });
  const medium = norm.thresholds.find((t) => t.key === 'medium');
  const high = norm.thresholds.find((t) => t.key === 'high');
  return normalizeComplexityLevels([
    { key: 'excellent', upTo: 0, score: norm.defaultScore },
    { key: 'good', upTo: medium?.minGroups ?? 5, score: medium?.score ?? 75 },
    { key: 'moderate', upTo: high?.minGroups ?? 10, score: high?.score ?? 50 },
    { key: 'poor', upTo: 999, score: high?.score ?? 0 },
  ]);
}

function loadComplexityLevelsFromRules(rules) {
  if (Array.isArray(rules?.complexity?.levels) && rules.complexity.levels.length > 0) {
    return normalizeComplexityLevels(rules.complexity.levels);
  }
  const tiers = rules?.complexity?.tiers;
  if (Array.isArray(tiers) && tiers.length > 0) {
    const sorted = [...tiers].sort((a, b) => (a.maxGroups ?? 0) - (b.maxGroups ?? 0));
    return levelsFromMaxTiers(sorted, COMPLEXITY_LEVEL_DEFS, 'maxGroups');
  }
  if (Array.isArray(rules?.complexity?.thresholds) && rules.complexity.thresholds.length > 0) {
    return complexityLevelsFromThresholds(rules.complexity);
  }
  return normalizeComplexityLevels([]);
}

function loadPeerComparisonConfigFromRules(rules) {
  const pc = rules?.peerComparison || {};
  return {
    enabled: pc.enabled !== false,
    matchField: 'jobTitle',
    aboveAveragePoints: pc.aboveAveragePoints ?? 5,
    belowAveragePoints: pc.belowAveragePoints ?? 5,
    maxPeers: pc.maxPeers ?? 50,
    showEntitlements: pc.showEntitlements !== false,
  };
}

function applySodLevels(rules, levels) {
  const norm = normalizeRiskLevels(levels);
  return { ...rules, sodRisk: { levels: norm.map(({ key, upTo, score }) => ({ key, upTo, score })), tiers: levelsToSodTiers(norm) } };
}

function applyAccessLevels(rules, levels) {
  const norm = normalizeAccessRiskLevels(levels);
  return {
    ...rules,
    accessHygiene: {
      levels: norm.map(({ key, upTo, score }) => ({ key, upTo, score })),
      tiers: levelsToAccessTiers(norm),
    },
  };
}

function applyIdentityHygieneConfig(rules, identityHygiene) {
  const ih = identityHygiene || {};
  const scoreLevels = normalizeAccessScoreLevels(ih.scoreLevels);
  return {
    ...rules,
    identityHygiene: {
      checks: (ih.checks ?? rules?.identityHygiene?.checks ?? []).map(({ points, ...rest }) => rest),
      scoreLevels: scoreLevels.map(({ key, upTo, score }) => ({ key, upTo, score })),
    },
  };
}

function applyComplexityLevels(rules, levels) {
  const norm = normalizeComplexityLevels(levels);
  const scoreLevels = Array.isArray(rules?.complexity?.scoreLevels) && rules.complexity.scoreLevels.length > 0
    ? normalizeAccessScoreLevels(rules.complexity.scoreLevels)
    : normalizeAccessScoreLevels([]);
  const excellent = norm.find((l) => l.key === 'excellent');
  return {
    ...rules,
    complexity: {
      levels: norm.map(({ key, upTo, score }) => ({ key, upTo, score })),
      tiers: levelsToComplexityTiers(norm),
      scoreLevels: scoreLevels.map(({ key, upTo, score }) => ({ key, upTo, score })),
      // Clear legacy thresholds so merge/defaults cannot shadow the edited levels.
      thresholds: [],
      defaultScore: excellent?.score ?? 100,
    },
  };
}

function applyPeerComparisonConfig(rules, peerComparison) {
  const c = peerComparison || {};
  return {
    ...rules,
    peerComparison: {
      enabled: c.enabled !== false,
      matchField: 'jobTitle',
      aboveAveragePoints: Math.max(1, Math.min(50, Number(c.aboveAveragePoints) || 5)),
      belowAveragePoints: Math.max(1, Math.min(50, Number(c.belowAveragePoints) || 5)),
      maxPeers: Math.max(1, Math.min(200, Number(c.maxPeers) || 50)),
      showEntitlements: c.showEntitlements !== false,
    },
  };
}

export default function IdentityPostureRules() {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState(null);
  const [meta, setMeta] = useState({ source: 'default', tenantName: '', updatedByName: '' });
  const [schemaFields, setSchemaFields] = useState([]);
  const [section, setSection] = useState('health');
  const [sodLevels, setSodLevels] = useState([]);
  const [complexityLevels, setComplexityLevels] = useState([]);
  const [accessLevels, setAccessLevels] = useState([]);
  const [identityConfig, setIdentityConfig] = useState(null);
  const [peerConfig, setPeerConfig] = useState(null);

  const syncRuleLevels = useCallback((r) => {
    if (!r) return;
    setSodLevels(loadSodLevelsFromRules(r));
    setComplexityLevels(loadComplexityLevelsFromRules(r));
    setAccessLevels(loadAccessLevelsFromRules(r));
    setIdentityConfig(loadIdentityConfigFromRules(r));
    setPeerConfig(loadPeerComparisonConfigFromRules(r));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rulesRes = await orgAdminAPI.getIdentityPostureRules();
      const data = rulesRes.data?.data || {};
      const loaded = data.rules || {};
      setRules(loaded);
      syncRuleLevels(loaded);
      setMeta({
        source: data.source || 'default',
        tenantName: data.tenantName || '',
        updatedByName: data.updatedByName || '',
        version: data.version,
        updatedAt: data.updatedAt,
      });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || 'Failed to load rules', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [enqueueSnackbar, syncRuleLevels]);

  useEffect(() => {
    load();
    identityAPI.getMetaFields()
      .then((res) => setSchemaFields(res.data?.data || []))
      .catch(() => {});
  }, [load]);

  const rulesForSave = useCallback(() => {
    let next = rules;
    next = applySodLevels(next, sodLevels);
    next = applyAccessLevels(next, accessLevels);
    if (identityConfig) next = applyIdentityHygieneConfig(next, identityConfig);
    next = applyComplexityLevels(next, complexityLevels);
    if (peerConfig) next = applyPeerComparisonConfig(next, peerConfig);
    return next;
  }, [rules, sodLevels, accessLevels, identityConfig, complexityLevels, peerConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await orgAdminAPI.saveIdentityPostureRules(rulesForSave());
      const data = res.data?.data || {};
      setRules(data.rules);
      syncRuleLevels(data.rules);
      setMeta({
        source: data.source,
        tenantName: data.tenantName,
        updatedByName: data.updatedByName,
        version: data.version,
        updatedAt: data.updatedAt,
      });
      enqueueSnackbar('Rule set saved', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || 'Save failed', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset to system defaults? This removes your tenant rule set.')) return;
    setSaving(true);
    try {
      const res = await orgAdminAPI.resetIdentityPostureRules();
      const resetRules = res.data?.data?.rules || {};
      setRules(resetRules);
      syncRuleLevels(resetRules);
      setMeta({ source: 'default', tenantName: meta.tenantName, updatedByName: '' });
      enqueueSnackbar('Reset to system defaults', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || 'Reset failed', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !rules) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', minHeight: 320 }}>
        <CircularProgress />
      </Box>
    );
  }

  const checks = identityConfig?.checks ?? rules.identityHygiene?.checks ?? [];

  const patchIdentityChecks = (nextChecks) => {
    setIdentityConfig((prev) => ({
      ...(prev || loadIdentityConfigFromRules(rules)),
      checks: nextChecks,
    }));
  };

  const updateCheckAt = (globalIdx, patch) => {
    const next = [...checks];
    next[globalIdx] = { ...next[globalIdx], ...patch };
    patchIdentityChecks(next);
  };

  const addCustomAttribute = (check) => {
    patchIdentityChecks([...checks, check]);
  };

  const sectionIndex = NAV.findIndex((n) => n.id === section);

  return (
    <Box sx={studioPageSx}>
      <Box sx={studioPageHeaderSx}>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => navigate(`${ORG_ADMIN_BASE}/global-rule-set`)}
          size="small"
          sx={{ mb: 1.5, color: 'text.secondary' }}
        >
          Global rule set
        </Button>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          spacing={2}
        >
          <Box>
            <Typography variant="h5" fontWeight={700} letterSpacing="-0.02em">
              {IDENTITY_POSTURE_RULES_PAGE_TITLE}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {meta.tenantName || 'Tenant'}
              {meta.updatedByName ? ` · last saved by ${meta.updatedByName}` : ''}
            </Typography>
          </Box>
          <Stack
            direction="row"
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1.5,
              overflow: 'hidden',
              bgcolor: '#fff',
              flexShrink: 0,
            }}
          >
            <Button
              variant="text"
              size="medium"
              startIcon={<RestartAlt fontSize="small" />}
              onClick={handleReset}
              disabled={saving}
              sx={{
                px: 2,
                py: 0.875,
                color: 'text.secondary',
                borderRadius: 0,
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.875rem',
                borderRight: '1px solid',
                borderColor: 'divider',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              Reset
            </Button>
            <Button
              variant="contained"
              size="medium"
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save fontSize="small" />}
              onClick={handleSave}
              disabled={saving}
              disableElevation
              sx={{
                px: 2.5,
                py: 0.875,
                borderRadius: 0,
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.875rem',
                boxShadow: 'none',
                '&:hover': { boxShadow: 'none' },
              }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Tabs
        value={sectionIndex >= 0 ? sectionIndex : 0}
        onChange={(_, idx) => setSection(NAV[idx]?.id || 'health')}
        sx={studioTabsSx}
        variant="scrollable"
        scrollButtons="auto"
      >
        {NAV.map((item) => (
          <Tab key={item.id} icon={item.icon} iconPosition="start" label={item.label} />
        ))}
      </Tabs>

      <Box sx={studioContentSx}>
        {section === 'health' && (
          <PostureMetricsRules
            identityConfig={identityConfig}
            onIdentityConfigChange={setIdentityConfig}
            sodLevels={sodLevels}
            onSodLevelsChange={setSodLevels}
            accessLevels={accessLevels}
            onAccessLevelsChange={setAccessLevels}
            complexityLevels={complexityLevels}
            onComplexityLevelsChange={setComplexityLevels}
          />
        )}

        {section === 'peer' && peerConfig && (
          <PeerComparisonRules peerConfig={peerConfig} onPeerConfigChange={setPeerConfig} />
        )}

        {section === 'attributes' && (
          <IdentityAttributesRules
            attributeChecks={checks}
            checks={checks}
            schemaFields={schemaFields}
            onUpdateCheck={updateCheckAt}
            onDeleteCheck={(i) => patchIdentityChecks(checks.filter((_, j) => j !== i))}
            onAddCheck={addCustomAttribute}
          />
        )}
      </Box>
    </Box>
  );
}
