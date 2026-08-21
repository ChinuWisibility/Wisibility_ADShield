import { useEffect, useState } from 'react';
import {
  Box,
  Chip,
  Grid,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  HubOutlined,
  LockOutlined,
  PersonOutline,
  WarningAmberOutlined,
} from '@mui/icons-material';
import {
  POSTURE_METRICS_TITLE,
  METRIC_BY_KEY,
  SOD_ANALYSIS_TITLE,
  ACCESS_DETAILS_FIELDS,
  ACCESS_HYGIENE_RULES_BADGE,
  ACCESS_HYGIENE_RULES_SUBTITLE,
  ACCESS_HYGIENE_SCORE_SECTION_TITLE,
  COMPLEXITY_RULES_BADGE,
  COMPLEXITY_RULES_SUBTITLE,
  COMPLEXITY_SCORE_SECTION_TITLE,
  IDENTITY_ATTRIBUTES_RULES_TITLE,
} from '../../../identities/posture/identityPostureLabels';

const SCORE_MAX = 100;
const SOD_VIOLATION_COUNT_MAX = 999;
const ACCESS_PRIVILEGED_COUNT_MAX = 100;
const COMPLEXITY_ENTITLEMENT_COUNT_MAX = 100;
const SLIDER_MIN = 0;
const SLIDER_FLOOR = 30;

const pageSx = { width: '100%' };
const cardSx = {
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 2,
  bgcolor: '#fff',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};
const cardHeaderSx = { px: 2, py: 1.75, borderBottom: '1px solid', borderColor: 'divider' };
const cardBodySx = { p: 2 };
const bandBoxSx = {
  p: 1.75,
  borderRadius: 1.5,
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: '#fafbfc',
};

const ACCESS_SCORE_LEVEL_DEFS = [
  { key: 'poor', label: 'Poor', color: '#dc2626', defaultUpTo: 40, defaultScore: 0 },
  { key: 'moderate', label: 'Moderate', color: '#ca8a04', defaultUpTo: 60, defaultScore: 50 },
  { key: 'good', label: 'Good', color: '#2563eb', defaultUpTo: 80, defaultScore: 85 },
  { key: 'excellent', label: 'Excellent', color: '#16a34a', defaultUpTo: 100, defaultScore: 100 },
];
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
const COMPLEXITY_LEVEL_DEFS = [
  { key: 'excellent', label: 'Excellent', color: '#16a34a', defaultUpTo: 0, defaultScore: 100 },
  { key: 'good', label: 'Good', color: '#2563eb', defaultUpTo: 5, defaultScore: 85 },
  { key: 'moderate', label: 'Moderate', color: '#ca8a04', defaultUpTo: 10, defaultScore: 50 },
  { key: 'poor', label: 'Poor', color: '#dc2626', defaultUpTo: 999, defaultScore: 0 },
];

const METRIC_PANELS = [
  {
    id: 'identity',
    title: METRIC_BY_KEY.identityHygiene.label,
    subtitle: 'Points from identity attributes, then a label on the gauge',
    icon: PersonOutline,
    color: '#2563eb',
  },
  {
    id: 'access',
    title: METRIC_BY_KEY.accessHygiene.label,
    subtitle: ACCESS_HYGIENE_RULES_SUBTITLE,
    icon: LockOutlined,
    color: '#7c3aed',
  },
  {
    id: 'sod',
    title: SOD_ANALYSIS_TITLE,
    subtitle: 'Violation count bands and SoD Risk % per band',
    icon: WarningAmberOutlined,
    color: '#dc2626',
  },
  {
    id: 'complexity',
    title: METRIC_BY_KEY.complexity.label,
    subtitle: COMPLEXITY_RULES_SUBTITLE,
    icon: HubOutlined,
    color: '#059669',
  },
];

function clampScore(v) { return Math.round(Math.max(0, Math.min(100, Number(v) || 0))); }
function normalizeAccessScoreLevels(levels) {
  const raw = ACCESS_SCORE_LEVEL_DEFS.map((def) => {
    const found = (levels || []).find((l) => l.key === def.key);
    return { key: def.key, upTo: def.key === 'excellent' ? 100 : clampScore(found?.upTo ?? def.defaultUpTo), score: clampScore(found?.score ?? def.defaultScore) };
  });
  raw[0].upTo = clampScore(raw[0].upTo); raw[1].upTo = clampScore(Math.max(raw[0].upTo, raw[1].upTo)); raw[2].upTo = clampScore(Math.max(raw[1].upTo, raw[2].upTo)); raw[3].upTo = 100;
  return raw;
}
function normalizeOrderedLevels(levels, defs) {
  const raw = defs.map((def) => {
    const found = (levels || []).find((l) => l.key === def.key);
    return { key: def.key, upTo: def.key === 'high' || def.key === 'poor' ? 999 : Number(found?.upTo ?? def.defaultUpTo), score: clampScore(found?.score ?? def.defaultScore) };
  });
  raw[0].upTo = Math.max(0, raw[0].upTo); raw[1].upTo = Math.max(raw[0].upTo, raw[1].upTo); raw[2].upTo = Math.max(raw[1].upTo, raw[2].upTo);
  return raw;
}
function normalizeRiskLevels(levels) { return normalizeOrderedLevels(levels, RISK_LEVEL_DEFS); }
function normalizeComplexityLevels(levels) { return normalizeOrderedLevels(levels, COMPLEXITY_LEVEL_DEFS); }
function clampComplexityCount(n) {
  return Math.max(SLIDER_MIN, Math.min(COMPLEXITY_ENTITLEMENT_COUNT_MAX, Math.round(Number(n) || 0)));
}
function complexitySliderCap(excellent, good, moderate) {
  return Math.min(COMPLEXITY_ENTITLEMENT_COUNT_MAX, Math.max(SLIDER_FLOOR, excellent, good, moderate));
}
function orderComplexityTriple(excellent, good, moderate) {
  const a = clampComplexityCount(excellent);
  const b = clampComplexityCount(Math.max(a, good));
  const c = clampComplexityCount(Math.max(b, moderate));
  return [a, b, c];
}
function patchComplexityLevels(levels, {
  excellentUpTo,
  goodUpTo,
  moderateUpTo,
  excellentScore,
  goodScore,
  moderateScore,
  poorScore,
} = {}) {
  const norm = normalizeComplexityLevels(levels || []);
  const byKey = Object.fromEntries(norm.map((l) => [l.key, l]));
  return normalizeComplexityLevels([
    { key: 'excellent', upTo: excellentUpTo ?? byKey.excellent?.upTo ?? 0, score: excellentScore ?? byKey.excellent?.score ?? 100 },
    { key: 'good', upTo: goodUpTo ?? byKey.good?.upTo ?? 5, score: goodScore ?? byKey.good?.score ?? 85 },
    { key: 'moderate', upTo: moderateUpTo ?? byKey.moderate?.upTo ?? 10, score: moderateScore ?? byKey.moderate?.score ?? 50 },
    { key: 'poor', upTo: 999, score: poorScore ?? byKey.poor?.score ?? 0 },
  ]);
}
function normalizeAccessRiskLevels(levels) {
  const legacyBandKeys = ['band1', 'band2', 'band3', 'band4'];
  const raw = ACCESS_RISK_LEVEL_DEFS.map((def, idx) => {
    const found = (levels || []).find((l) => l.key === def.key)
      || (levels || []).find((l) => l.key === legacyBandKeys[idx]);
    const isHigh = def.key === 'high';
    return {
      key: def.key,
      upTo: isHigh ? ACCESS_PRIVILEGED_COUNT_MAX : clampAccessCount(found?.upTo ?? def.defaultUpTo),
      score: clampScore(found?.score ?? def.defaultScore),
    };
  });
  raw[0].upTo = clampAccessCount(raw[0].upTo);
  raw[1].upTo = clampAccessCount(Math.max(raw[0].upTo, raw[1].upTo));
  raw[2].upTo = clampAccessCount(Math.max(raw[1].upTo, raw[2].upTo));
  raw[3].upTo = ACCESS_PRIVILEGED_COUNT_MAX;
  return raw;
}
function clampAccessCount(n) { return Math.max(SLIDER_MIN, Math.min(ACCESS_PRIVILEGED_COUNT_MAX, Math.round(Number(n) || 0))); }
function accessSliderCap(safe, low, medium) {
  return Math.min(ACCESS_PRIVILEGED_COUNT_MAX, Math.max(SLIDER_FLOOR, safe, low, medium));
}
function orderAccessTriple(safe, low, med) {
  const a = clampAccessCount(safe);
  const b = clampAccessCount(Math.max(a, low));
  const c = clampAccessCount(Math.max(b, med));
  return [a, b, c];
}
function patchAccessLevels(levels, { safeUpTo, lowUpTo, mediumUpTo, safeScore, lowScore, mediumScore, highScore } = {}) {
  const norm = normalizeAccessRiskLevels(levels || []);
  const byKey = Object.fromEntries(norm.map((l) => [l.key, l]));
  return normalizeAccessRiskLevels([
    { key: 'safe', upTo: safeUpTo ?? byKey.safe?.upTo ?? 0, score: safeScore ?? byKey.safe?.score ?? 100 },
    { key: 'low', upTo: lowUpTo ?? byKey.low?.upTo ?? 2, score: lowScore ?? byKey.low?.score ?? 85 },
    { key: 'medium', upTo: mediumUpTo ?? byKey.medium?.upTo ?? 5, score: mediumScore ?? byKey.medium?.score ?? 50 },
    { key: 'high', upTo: ACCESS_PRIVILEGED_COUNT_MAX, score: highScore ?? byKey.high?.score ?? 0 },
  ]);
}
function orderScoreTriple(poor, moderate, good) { const a = clampScore(poor); const b = clampScore(Math.max(a, moderate)); const c = clampScore(Math.max(b, good)); return [a, b, Math.min(c, SCORE_MAX)]; }
function getCheckAttributeName(check) {
  if (check?.label) return String(check.label).trim().replace(/\s+present\s*$/i, '');
  if (check?.evaluator?.key === 'hasManager') return 'Manager';
  if (check?.evaluator?.key === 'hasEmail') return 'Email';
  if (check?.evaluator?.key === 'hasHrRecord') return 'HR Record';
  return 'Attribute';
}
function clampCount(n) { return Math.max(SLIDER_MIN, Math.min(SOD_VIOLATION_COUNT_MAX, Math.round(Number(n) || 0))); }
function sliderCap(safe, low, medium) { return Math.min(SOD_VIOLATION_COUNT_MAX, Math.max(SLIDER_FLOOR, safe, low, medium)); }
function orderTriple(safe, low, med) { const a = clampCount(safe); const b = clampCount(Math.max(a, low)); const c = clampCount(Math.max(b, med)); return [a, b, c]; }
function patchSodLevels(levels, { safeUpTo, lowUpTo, mediumUpTo, safeScore, lowScore, mediumScore, highScore } = {}) {
  const norm = normalizeRiskLevels(levels || []);
  const byKey = Object.fromEntries(norm.map((l) => [l.key, l]));
  return normalizeRiskLevels([
    { key: 'safe', upTo: safeUpTo ?? byKey.safe?.upTo ?? 0, score: safeScore ?? byKey.safe?.score ?? 100 },
    { key: 'low', upTo: lowUpTo ?? byKey.low?.upTo ?? 1, score: lowScore ?? byKey.low?.score ?? 85 },
    { key: 'medium', upTo: mediumUpTo ?? byKey.medium?.upTo ?? 3, score: mediumScore ?? byKey.medium?.score ?? 50 },
    { key: 'high', upTo: 999, score: highScore ?? byKey.high?.score ?? 0 },
  ]);
}

function buildColoredTrackGradient(a, b, c, scaleMax, defs) {
  const pct = (n) => `${Math.min(100, Math.max(0, (n / scaleMax) * 100))}%`;
  const colors = [defs[0]?.color, defs[1]?.color, defs[2]?.color, defs[3]?.color];
  const fade = (col) => alpha(col || '#94a3b8', 0.4);
  return [`${fade(colors[0])} 0%`, `${fade(colors[0])} ${pct(a)}`, `${fade(colors[1])} ${pct(a)}`, `${fade(colors[1])} ${pct(b)}`, `${fade(colors[2])} ${pct(b)}`, `${fade(colors[2])} ${pct(c)}`, `${fade(colors[3])} ${pct(c)}`, `${fade(colors[3])} 100%`].join(', ');
}

function bandSliderSx(defs) {
  const colors = [defs[0]?.color, defs[1]?.color, defs[2]?.color];
  return {
    height: 40,
    py: 1,
    '& .MuiSlider-rail': { opacity: 0 },
    '& .MuiSlider-track': { opacity: 0 },
    ...colors.reduce((acc, color, i) => ({
      ...acc,
      [`& .MuiSlider-thumb[data-index="${i}"]`]: {
        width: 14,
        height: 14,
        bgcolor: color,
        border: '2px solid #fff',
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.15)',
        '&::before': { display: 'none' },
      },
    }), {}),
    '& .MuiSlider-valueLabel': { fontSize: '0.7rem', fontWeight: 700, bgcolor: 'grey.800', borderRadius: 1 },
  };
}

function LevelLegend({ defs }) {
  return (
    <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mb: 1.25 }}>
      {defs.map((def) => (
        <Stack key={def.key} direction="row" alignItems="center" spacing={0.75}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: def.color, boxShadow: `0 0 0 1px ${alpha(def.color, 0.3)}` }} />
          <Typography variant="caption" fontWeight={600} color="text.secondary">{def.label}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function BandRangeSummary({ defs, values, max, isCount = false, countUnit = 'violations' }) {
  const [a, b, c] = values;
  const unit = isCount ? ` ${countUnit}` : '%';
  const tail = isCount ? ` → ${defs[3]?.label ?? 'High'}` : ` → ${defs[3]?.label ?? 'Excellent'}`;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, lineHeight: 1.6 }}>
      <strong>0–{a}</strong> {defs[0]?.label}
      {' · '}
      <strong>{a + 1}–{b}</strong> {defs[1]?.label}
      {' · '}
      <strong>{b + 1}–{c}</strong> {defs[2]?.label}
      {' · '}
      <strong>{c + 1}{isCount ? '+' : `–${max}`}{unit}</strong>{tail}
    </Typography>
  );
}

function TripleBandSlider({
  defs,
  value,
  onChange,
  thumbLabels,
  min = 0,
  max = SCORE_MAX,
  isCount = false,
  countUnit = 'violations',
}) {
  const [a, b, c] = value;
  const trackBg = `linear-gradient(to right, ${buildColoredTrackGradient(a, b, c, max, defs)})`;

  const handleSlider = (_, vals) => onChange(vals);
  const handleInput = (index, raw) => {
    const next = [...value];
    next[index] = Number(raw);
    onChange(next);
  };

  return (
    <Box sx={bandBoxSx}>
      <LevelLegend defs={defs} />
      <Box sx={{ position: 'relative', height: 48, px: 0.5 }}>
        <Box sx={{ position: 'absolute', left: 8, right: 8, top: 20, height: 6, borderRadius: 3, background: trackBg, border: '1px solid', borderColor: alpha('#000', 0.06) }} />
        <Slider
          value={value}
          onChange={handleSlider}
          min={min}
          max={max}
          disableSwap
          valueLabelDisplay="on"
          valueLabelFormat={(_, index) => thumbLabels[index] || ''}
          sx={{ position: 'relative', zIndex: 1, ...bandSliderSx(defs) }}
        />
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ px: 0.5, mb: 1 }}>
        <Typography variant="caption" color="text.disabled">0</Typography>
        <Typography variant="caption" color="text.disabled">{max}{isCount ? '+' : ''}</Typography>
      </Stack>
      <Stack direction="row" spacing={1.5} flexWrap="wrap">
        {thumbLabels.map((label, i) => (
          <TextField
            key={label}
            size="small"
            label={`${label} up to`}
            type="number"
            value={value[i]}
            onChange={(e) => handleInput(i, e.target.value)}
            inputProps={{ min: 0, max: isCount ? max : 100 }}
            sx={{ width: 110, '& .MuiInputBase-root': { fontSize: '0.875rem' } }}
          />
        ))}
      </Stack>
      <BandRangeSummary defs={defs} values={value} max={max} isCount={isCount} countUnit={countUnit} />
    </Box>
  );
}

function MetricCard({ panel, badge, children }) {
  const Icon = panel.icon;
  return (
    <Box sx={cardSx}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={cardHeaderSx}>
        <Box sx={{ width: 36, height: 36, borderRadius: 1.5, bgcolor: alpha(panel.color, 0.1), color: panel.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
            <Typography variant="subtitle1" fontWeight={700} sx={{ lineHeight: 1.3 }}>{panel.title}</Typography>
            {badge ? <Chip label={badge} size="small" sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }} /> : null}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem', mt: 0.25, lineHeight: 1.45 }}>
            {panel.subtitle}
          </Typography>
        </Box>
      </Stack>
      <Box sx={cardBodySx}>{children}</Box>
    </Box>
  );
}

function IdentityHygieneRule({ config, onChange }) {
  const ih = config || {};
  const checks = ih.checks || [];
  const normalized = normalizeAccessScoreLevels(ih.scoreLevels || []);
  const poorFrom = normalized.find((l) => l.key === 'poor')?.upTo ?? 40;
  const modFrom = normalized.find((l) => l.key === 'moderate')?.upTo ?? 60;
  const goodFrom = normalized.find((l) => l.key === 'good')?.upTo ?? 80;
  const [poorUpTo, setPoorUpTo] = useState(poorFrom);
  const [moderateUpTo, setModerateUpTo] = useState(modFrom);
  const [goodUpTo, setGoodUpTo] = useState(goodFrom);
  useEffect(() => { setPoorUpTo(poorFrom); setModerateUpTo(modFrom); setGoodUpTo(goodFrom); }, [poorFrom, modFrom, goodFrom]);
  const sliderValues = orderScoreTriple(poorUpTo, moderateUpTo, goodUpTo);
  const enabledChecks = checks.filter((c) => c.enabled !== false);
  const pointsEach = enabledChecks.length > 0 ? Math.round((100 / enabledChecks.length) * 10) / 10 : 0;
  const patchConfig = (patch) => onChange({ checks, scoreLevels: ih.scoreLevels || normalized, ...patch });
  const pushScoreLevels = (vals) => {
    const [pp, mm, gg] = orderScoreTriple(vals[0], vals[1], vals[2]);
    setPoorUpTo(pp); setModerateUpTo(mm); setGoodUpTo(gg);
    patchConfig({ scoreLevels: normalizeAccessScoreLevels([{ key: 'poor', upTo: pp, score: 0 }, { key: 'moderate', upTo: mm, score: 50 }, { key: 'good', upTo: gg, score: 85 }, { key: 'excellent', upTo: 100, score: 100 }]) });
  };

  return (
    <>
      <TripleBandSlider
        defs={ACCESS_SCORE_LEVEL_DEFS}
        value={sliderValues}
        thumbLabels={['Poor', 'Moderate', 'Good']}
        onChange={pushScoreLevels}
      />
      <Box sx={{ ...bandBoxSx, mb: 0, mt: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Enabled attributes</Typography>
        <Stack spacing={1}>
          {enabledChecks.length === 0 ? (
            <Box sx={{ p: 1.25, borderRadius: 1.25, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                No attributes enabled. Configure on the {IDENTITY_ATTRIBUTES_RULES_TITLE} tab.
              </Typography>
            </Box>
          ) : (
            enabledChecks.map((check) => (
              <Stack
                key={check.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                alignItems={{ sm: 'center' }}
                sx={{ p: 1.25, borderRadius: 1.25, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700} sx={{ fontSize: '0.8125rem' }}>
                    {getCheckAttributeName(check)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Included when present on the identity
                  </Typography>
                </Box>
                <Chip
                  label={`${pointsEach} pts`}
                  size="small"
                  sx={{ height: 28, fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}
                />
              </Stack>
            ))
          )}
        </Stack>
      </Box>
    </>
  );
}

function AccessHygieneRule({ levels, onLevelsChange }) {
  const normalized = normalizeAccessRiskLevels(levels || []);
  const safeTier = normalized.find((l) => l.key === 'safe') || { upTo: 0, score: 100 };
  const lowTier = normalized.find((l) => l.key === 'low') || { upTo: 2, score: 85 };
  const mediumTier = normalized.find((l) => l.key === 'medium') || { upTo: 5, score: 50 };
  const highTier = normalized.find((l) => l.key === 'high') || { upTo: 100, score: 0 };
  const [safeUpTo, setSafeUpTo] = useState(safeTier.upTo);
  const [lowUpTo, setLowUpTo] = useState(lowTier.upTo);
  const [mediumUpTo, setMediumUpTo] = useState(mediumTier.upTo);
  const [safeScore, setSafeScore] = useState(safeTier.score);
  const [lowScore, setLowScore] = useState(lowTier.score);
  const [mediumScore, setMediumScore] = useState(mediumTier.score);
  const [highScore, setHighScore] = useState(highTier.score);
  useEffect(() => {
    setSafeUpTo(safeTier.upTo);
    setLowUpTo(lowTier.upTo);
    setMediumUpTo(mediumTier.upTo);
    setSafeScore(safeTier.score);
    setLowScore(lowTier.score);
    setMediumScore(mediumTier.score);
    setHighScore(highTier.score);
  }, [safeTier.upTo, lowTier.upTo, mediumTier.upTo, safeTier.score, lowTier.score, mediumTier.score, highTier.score]);
  const scaleMax = accessSliderCap(safeUpTo, lowUpTo, mediumUpTo);
  const sliderValues = orderAccessTriple(Math.min(safeUpTo, scaleMax), Math.min(lowUpTo, scaleMax), Math.min(mediumUpTo, scaleMax));

  const commit = (patch) => {
    const next = patchAccessLevels(normalized, {
      safeUpTo,
      lowUpTo,
      mediumUpTo,
      safeScore,
      lowScore,
      mediumScore,
      highScore,
      ...patch,
    });
    const safe = next.find((l) => l.key === 'safe');
    const low = next.find((l) => l.key === 'low');
    const medium = next.find((l) => l.key === 'medium');
    const high = next.find((l) => l.key === 'high');
    setSafeUpTo(safe.upTo);
    setLowUpTo(low.upTo);
    setMediumUpTo(medium.upTo);
    setSafeScore(safe.score);
    setLowScore(low.score);
    setMediumScore(medium.score);
    setHighScore(high.score);
    onLevelsChange(next);
  };

  const pushBreakpoints = (vals) => {
    const [s, l, m] = orderAccessTriple(vals[0], vals[1], vals[2]);
    commit({ safeUpTo: s, lowUpTo: l, mediumUpTo: m });
  };

  const privilegedLabel = ACCESS_DETAILS_FIELDS.find((f) => f.key === 'privilegedEntitlements')?.label ?? 'Privileged entitlements';
  const countNoun = privilegedLabel.toLowerCase();
  const scoreRows = [
    { key: 'safe', label: 'Safe', color: 'success.main', countLabel: `0–${safeUpTo} ${countNoun}`, score: safeScore, onScore: (v) => commit({ safeScore: clampScore(v) }) },
    { key: 'low', label: 'Low', color: '#65a30d', countLabel: `${safeUpTo + 1}–${lowUpTo} ${countNoun}`, score: lowScore, onScore: (v) => commit({ lowScore: clampScore(v) }) },
    { key: 'medium', label: 'Medium', color: 'warning.dark', countLabel: `${lowUpTo + 1}–${mediumUpTo} ${countNoun}`, score: mediumScore, onScore: (v) => commit({ mediumScore: clampScore(v) }) },
    { key: 'high', label: 'High', color: 'error.main', countLabel: `${mediumUpTo + 1}+ ${countNoun}`, score: highScore, onScore: (v) => commit({ highScore: clampScore(v) }) },
  ];

  return (
    <>
      <TripleBandSlider
        defs={ACCESS_RISK_LEVEL_DEFS}
        value={sliderValues}
        thumbLabels={['Safe', 'Low', 'Medium']}
        min={SLIDER_MIN}
        max={scaleMax}
        isCount
        countUnit={countNoun}
        onChange={pushBreakpoints}
      />
      <Box sx={{ ...bandBoxSx, mb: 0, mt: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{ACCESS_HYGIENE_SCORE_SECTION_TITLE}</Typography>
        <Stack spacing={1}>
          {scoreRows.map((row) => (
            <Stack
              key={row.key}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              alignItems={{ sm: 'center' }}
              sx={{ p: 1.25, borderRadius: 1.25, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={700} color={row.color} sx={{ fontSize: '0.8125rem' }}>
                  {row.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">{row.countLabel}</Typography>
              </Box>
              <TextField
                size="small"
                label="Access Hygiene %"
                type="number"
                value={row.score}
                onChange={(e) => row.onScore(e.target.value)}
                inputProps={{ min: 0, max: 100 }}
                sx={{ width: { xs: '100%', sm: 160 } }}
              />
            </Stack>
          ))}
        </Stack>
      </Box>
    </>
  );
}

function SodAnalysisRule({ levels, onLevelsChange }) {
  const normalized = normalizeRiskLevels(levels || []);
  const safeTier = normalized.find((l) => l.key === 'safe') || { upTo: 0, score: 100 };
  const lowTier = normalized.find((l) => l.key === 'low') || { upTo: 1, score: 85 };
  const mediumTier = normalized.find((l) => l.key === 'medium') || { upTo: 3, score: 50 };
  const highTier = normalized.find((l) => l.key === 'high') || { upTo: 999, score: 0 };
  const [safeUpTo, setSafeUpTo] = useState(safeTier.upTo);
  const [lowUpTo, setLowUpTo] = useState(lowTier.upTo);
  const [mediumUpTo, setMediumUpTo] = useState(mediumTier.upTo);
  const [safeScore, setSafeScore] = useState(safeTier.score);
  const [lowScore, setLowScore] = useState(lowTier.score);
  const [mediumScore, setMediumScore] = useState(mediumTier.score);
  const [highScore, setHighScore] = useState(highTier.score);
  useEffect(() => {
    setSafeUpTo(safeTier.upTo);
    setLowUpTo(lowTier.upTo);
    setMediumUpTo(mediumTier.upTo);
    setSafeScore(safeTier.score);
    setLowScore(lowTier.score);
    setMediumScore(mediumTier.score);
    setHighScore(highTier.score);
  }, [safeTier.upTo, lowTier.upTo, mediumTier.upTo, safeTier.score, lowTier.score, mediumTier.score, highTier.score]);
  const scaleMax = sliderCap(safeUpTo, lowUpTo, mediumUpTo);
  const sliderValues = orderTriple(Math.min(safeUpTo, scaleMax), Math.min(lowUpTo, scaleMax), Math.min(mediumUpTo, scaleMax));

  const commit = (patch) => {
    const next = patchSodLevels(normalized, {
      safeUpTo,
      lowUpTo,
      mediumUpTo,
      safeScore,
      lowScore,
      mediumScore,
      highScore,
      ...patch,
    });
    const safe = next.find((l) => l.key === 'safe');
    const low = next.find((l) => l.key === 'low');
    const medium = next.find((l) => l.key === 'medium');
    const high = next.find((l) => l.key === 'high');
    setSafeUpTo(safe.upTo);
    setLowUpTo(low.upTo);
    setMediumUpTo(medium.upTo);
    setSafeScore(safe.score);
    setLowScore(low.score);
    setMediumScore(medium.score);
    setHighScore(high.score);
    onLevelsChange(next);
  };

  const pushBreakpoints = (vals) => {
    const [s, l, m] = orderTriple(vals[0], vals[1], vals[2]);
    commit({ safeUpTo: s, lowUpTo: l, mediumUpTo: m });
  };

  const scoreRows = [
    { key: 'safe', label: 'Safe', color: 'success.main', countLabel: `0–${safeUpTo} violations`, score: safeScore, onScore: (v) => commit({ safeScore: clampScore(v) }) },
    { key: 'low', label: 'Low', color: '#65a30d', countLabel: `${safeUpTo + 1}–${lowUpTo} violations`, score: lowScore, onScore: (v) => commit({ lowScore: clampScore(v) }) },
    { key: 'medium', label: 'Medium', color: 'warning.dark', countLabel: `${lowUpTo + 1}–${mediumUpTo} violations`, score: mediumScore, onScore: (v) => commit({ mediumScore: clampScore(v) }) },
    { key: 'high', label: 'High', color: 'error.main', countLabel: `${mediumUpTo + 1}+ violations`, score: highScore, onScore: (v) => commit({ highScore: clampScore(v) }) },
  ];

  return (
    <>
      <TripleBandSlider
        defs={RISK_LEVEL_DEFS}
        value={sliderValues}
        thumbLabels={['Safe', 'Low', 'Medium']}
        min={SLIDER_MIN}
        max={scaleMax}
        isCount
        onChange={pushBreakpoints}
      />
      <Box sx={{ ...bandBoxSx, mb: 0, mt: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>SoD Risk score per band</Typography>
        <Stack spacing={1}>
          {scoreRows.map((row) => (
            <Stack
              key={row.key}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              alignItems={{ sm: 'center' }}
              sx={{ p: 1.25, borderRadius: 1.25, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={700} color={row.color} sx={{ fontSize: '0.8125rem' }}>
                  {row.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">{row.countLabel}</Typography>
              </Box>
              <TextField
                size="small"
                label="SoD Risk %"
                type="number"
                value={row.score}
                onChange={(e) => row.onScore(e.target.value)}
                inputProps={{ min: 0, max: 100 }}
                sx={{ width: 110 }}
              />
            </Stack>
          ))}
        </Stack>
      </Box>
    </>
  );
}

function ComplexityRule({ levels, onLevelsChange }) {
  const normalized = normalizeComplexityLevels(levels || []);
  const excellentTier = normalized.find((l) => l.key === 'excellent') || { upTo: 0, score: 100 };
  const goodTier = normalized.find((l) => l.key === 'good') || { upTo: 5, score: 85 };
  const moderateTier = normalized.find((l) => l.key === 'moderate') || { upTo: 10, score: 50 };
  const poorTier = normalized.find((l) => l.key === 'poor') || { upTo: 999, score: 0 };
  const [excellentUpTo, setExcellentUpTo] = useState(excellentTier.upTo);
  const [goodUpTo, setGoodUpTo] = useState(goodTier.upTo);
  const [moderateUpTo, setModerateUpTo] = useState(moderateTier.upTo);
  const [excellentScore, setExcellentScore] = useState(excellentTier.score);
  const [goodScore, setGoodScore] = useState(goodTier.score);
  const [moderateScore, setModerateScore] = useState(moderateTier.score);
  const [poorScore, setPoorScore] = useState(poorTier.score);
  useEffect(() => {
    setExcellentUpTo(excellentTier.upTo);
    setGoodUpTo(goodTier.upTo);
    setModerateUpTo(moderateTier.upTo);
    setExcellentScore(excellentTier.score);
    setGoodScore(goodTier.score);
    setModerateScore(moderateTier.score);
    setPoorScore(poorTier.score);
  }, [
    excellentTier.upTo, goodTier.upTo, moderateTier.upTo,
    excellentTier.score, goodTier.score, moderateTier.score, poorTier.score,
  ]);
  const scaleMax = complexitySliderCap(excellentUpTo, goodUpTo, moderateUpTo);
  const sliderValues = orderComplexityTriple(
    Math.min(excellentUpTo, scaleMax),
    Math.min(goodUpTo, scaleMax),
    Math.min(moderateUpTo, scaleMax),
  );

  const commit = (patch) => {
    const next = patchComplexityLevels(normalized, {
      excellentUpTo,
      goodUpTo,
      moderateUpTo,
      excellentScore,
      goodScore,
      moderateScore,
      poorScore,
      ...patch,
    });
    const excellent = next.find((l) => l.key === 'excellent');
    const good = next.find((l) => l.key === 'good');
    const moderate = next.find((l) => l.key === 'moderate');
    const poor = next.find((l) => l.key === 'poor');
    setExcellentUpTo(excellent.upTo);
    setGoodUpTo(good.upTo);
    setModerateUpTo(moderate.upTo);
    setExcellentScore(excellent.score);
    setGoodScore(good.score);
    setModerateScore(moderate.score);
    setPoorScore(poor.score);
    onLevelsChange(next);
  };

  const pushBreakpoints = (vals) => {
    const [e, g, m] = orderComplexityTriple(vals[0], vals[1], vals[2]);
    commit({ excellentUpTo: e, goodUpTo: g, moderateUpTo: m });
  };

  const entitlementsLabel = ACCESS_DETAILS_FIELDS.find((f) => f.key === 'entitlements')?.label ?? 'Entitlements';
  const countNoun = entitlementsLabel.toLowerCase();
  const scoreRows = [
    {
      key: 'excellent',
      label: 'Excellent',
      color: 'success.main',
      countLabel: `0–${excellentUpTo} ${countNoun}`,
      score: excellentScore,
      onScore: (v) => commit({ excellentScore: clampScore(v) }),
    },
    {
      key: 'good',
      label: 'Good',
      color: '#2563eb',
      countLabel: `${excellentUpTo + 1}–${goodUpTo} ${countNoun}`,
      score: goodScore,
      onScore: (v) => commit({ goodScore: clampScore(v) }),
    },
    {
      key: 'moderate',
      label: 'Moderate',
      color: 'warning.dark',
      countLabel: `${goodUpTo + 1}–${moderateUpTo} ${countNoun}`,
      score: moderateScore,
      onScore: (v) => commit({ moderateScore: clampScore(v) }),
    },
    {
      key: 'poor',
      label: 'Poor',
      color: 'error.main',
      countLabel: `${moderateUpTo + 1}+ ${countNoun}`,
      score: poorScore,
      onScore: (v) => commit({ poorScore: clampScore(v) }),
    },
  ];

  return (
    <>
      <TripleBandSlider
        defs={COMPLEXITY_LEVEL_DEFS}
        value={sliderValues}
        thumbLabels={['Excellent', 'Good', 'Moderate']}
        min={SLIDER_MIN}
        max={scaleMax}
        isCount
        countUnit={countNoun}
        onChange={pushBreakpoints}
      />
      <Box sx={{ ...bandBoxSx, mb: 0, mt: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{COMPLEXITY_SCORE_SECTION_TITLE}</Typography>
        <Stack spacing={1}>
          {scoreRows.map((row) => (
            <Stack
              key={row.key}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              alignItems={{ sm: 'center' }}
              sx={{ p: 1.25, borderRadius: 1.25, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={700} color={row.color} sx={{ fontSize: '0.8125rem' }}>
                  {row.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">{row.countLabel}</Typography>
              </Box>
              <TextField
                size="small"
                label="Complexity %"
                type="number"
                value={row.score}
                onChange={(e) => row.onScore(e.target.value)}
                inputProps={{ min: 0, max: 100 }}
                sx={{ width: { xs: '100%', sm: 160 } }}
              />
            </Stack>
          ))}
        </Stack>
      </Box>
    </>
  );
}

export default function PostureMetricsRules({
  identityConfig,
  onIdentityConfigChange,
  sodLevels,
  onSodLevelsChange,
  accessLevels,
  onAccessLevelsChange,
  complexityLevels,
  onComplexityLevelsChange,
}) {
  const enabledAttrCount = (identityConfig?.checks || []).filter((c) => c.enabled !== false).length;

  return (
    <Box component="section" aria-label={POSTURE_METRICS_TITLE} sx={pageSx}>
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h6" fontWeight={700} letterSpacing="-0.02em">
          {POSTURE_METRICS_TITLE}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.6, maxWidth: 640 }}>
          Each card matches a gauge on the identity posture page. Adjust sliders and fields, then click <strong>Save changes</strong>.
        </Typography>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <MetricCard panel={METRIC_PANELS[0]} badge={`${enabledAttrCount} attributes`}>
            {identityConfig ? <IdentityHygieneRule config={identityConfig} onChange={onIdentityConfigChange} /> : null}
          </MetricCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <MetricCard panel={METRIC_PANELS[1]} badge={ACCESS_HYGIENE_RULES_BADGE}>
            <AccessHygieneRule levels={accessLevels} onLevelsChange={onAccessLevelsChange} />
          </MetricCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <MetricCard panel={METRIC_PANELS[2]} badge="Bands + scores">
            <SodAnalysisRule levels={sodLevels} onLevelsChange={onSodLevelsChange} />
          </MetricCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <MetricCard panel={METRIC_PANELS[3]} badge={COMPLEXITY_RULES_BADGE}>
            <ComplexityRule levels={complexityLevels} onLevelsChange={onComplexityLevelsChange} />
          </MetricCard>
        </Grid>
      </Grid>
    </Box>
  );
}
