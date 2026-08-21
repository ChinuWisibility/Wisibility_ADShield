import { useEffect, useMemo, useState } from 'react';
import { Chip, Paper, Stack, TextField, Typography, alpha } from '@mui/material';
import { useSnackbar } from 'notistack';
import PostureBreakpointSlider, { PostureLevelLegend } from './PostureBreakpointSlider';
import PostureRuleCard from './PostureRuleCard';
import { postureFormulaPaperSx } from './postureRuleStudioTheme';
import {
  ACCESS_SCORE_LEVEL_DEFS,
  clampScore,
  complexityBandLabel,
  computeComplexityScore,
  normalizeAccessScoreLevels,
  normalizeComplexityThresholds,
} from './postureRuleUiHelpers';
import { METRIC_BY_KEY } from '../../identities/posture/identityPostureLabels';

export const COMPLEXITY_POSTURE_RULE_TITLE = 'Complexity Posture rule';

const SCORE_MAX = 100;

function orderScoreTriple(poor, moderate, good) {
  const a = clampScore(poor);
  const b = clampScore(Math.max(a, moderate));
  const c = clampScore(Math.max(b, good));
  return [a, b, Math.min(c, SCORE_MAX)];
}

const ruleRowSx = {
  p: 1.5,
  borderRadius: 2,
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: '#fff',
};

function RuleKeyword({ children, color = 'default' }) {
  return (
    <Chip
      label={children}
      size="small"
      color={color}
      variant={color === 'default' ? 'outlined' : 'filled'}
      sx={{ fontWeight: 700, fontSize: '0.7rem', minWidth: 56 }}
    />
  );
}

function GroupsScoreRow({ keyword, keywordColor, groups, score, groupsLabel, onGroups, onScore }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={ruleRowSx}>
      <RuleKeyword color={keywordColor}>{keyword}</RuleKeyword>
      <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {groupsLabel} ≥
      </Typography>
      <TextField
        size="small"
        type="number"
        value={groups}
        onChange={(e) => onGroups(Number(e.target.value))}
        inputProps={{ min: 0, max: 999 }}
        sx={{ width: 88 }}
      />
      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
        then score =
      </Typography>
      <TextField
        size="small"
        type="number"
        value={score}
        onChange={(e) => onScore(Number(e.target.value))}
        inputProps={{ min: 0, max: 100 }}
        sx={{ width: 88 }}
      />
      <Typography variant="body2" fontWeight={700}>
        %
      </Typography>
    </Stack>
  );
}

export default function ComplexityPostureRule({ config, onChange, bare = false }) {
  const { enqueueSnackbar } = useSnackbar();
  const cfg = config || {};
  const normalized = normalizeComplexityThresholds(cfg);
  const mediumTier = normalized.thresholds.find((t) => t.key === 'medium');
  const highTier = normalized.thresholds.find((t) => t.key === 'high');

  const scoreNorm = normalizeAccessScoreLevels(cfg.scoreLevels || []);
  const poorFrom = scoreNorm.find((l) => l.key === 'poor')?.upTo ?? 40;
  const modFrom = scoreNorm.find((l) => l.key === 'moderate')?.upTo ?? 60;
  const goodFrom = scoreNorm.find((l) => l.key === 'good')?.upTo ?? 80;

  const [defaultScore, setDefaultScore] = useState(normalized.defaultScore);
  const [mediumMin, setMediumMin] = useState(mediumTier?.minGroups ?? 5);
  const [mediumScore, setMediumScore] = useState(mediumTier?.score ?? 75);
  const [highMin, setHighMin] = useState(highTier?.minGroups ?? 10);
  const [highScore, setHighScore] = useState(highTier?.score ?? 50);

  const [poorUpTo, setPoorUpTo] = useState(poorFrom);
  const [moderateUpTo, setModerateUpTo] = useState(modFrom);
  const [goodUpTo, setGoodUpTo] = useState(goodFrom);

  useEffect(() => {
    const n = normalizeComplexityThresholds(cfg);
    const med = n.thresholds.find((t) => t.key === 'medium');
    const hi = n.thresholds.find((t) => t.key === 'high');
    setDefaultScore(n.defaultScore);
    setMediumMin(med?.minGroups ?? 5);
    setMediumScore(med?.score ?? 75);
    setHighMin(hi?.minGroups ?? 10);
    setHighScore(hi?.score ?? 50);
    const sn = normalizeAccessScoreLevels(cfg.scoreLevels || []);
    setPoorUpTo(sn.find((l) => l.key === 'poor')?.upTo ?? 40);
    setModerateUpTo(sn.find((l) => l.key === 'moderate')?.upTo ?? 60);
    setGoodUpTo(sn.find((l) => l.key === 'good')?.upTo ?? 80);
  }, [cfg]);

  const [sliderPoor, sliderMod, sliderGood] = orderScoreTriple(poorUpTo, moderateUpTo, goodUpTo);

  const thresholdsSnapshot = () => ({
    defaultScore,
    thresholds: [
      { key: 'medium', minGroups: mediumMin, score: mediumScore },
      { key: 'high', minGroups: highMin, score: highScore },
    ],
  });

  const patchConfig = (patch) => {
    const th = normalizeComplexityThresholds({ ...thresholdsSnapshot(), ...patch });
    onChange({
      ...th,
      scoreLevels: patch.scoreLevels ?? normalizeAccessScoreLevels(cfg.scoreLevels || scoreNorm),
    });
    const med = th.thresholds.find((t) => t.key === 'medium');
    const hi = th.thresholds.find((t) => t.key === 'high');
    setDefaultScore(th.defaultScore);
    setMediumMin(med.minGroups);
    setMediumScore(med.score);
    setHighMin(hi.minGroups);
    setHighScore(hi.score);
  };

  const pushScoreLevels = (p, m, g) => {
    const [pp, mm, gg] = orderScoreTriple(p, m, g);
    setPoorUpTo(pp);
    setModerateUpTo(mm);
    setGoodUpTo(gg);
    const th = normalizeComplexityThresholds(thresholdsSnapshot());
    onChange({
      ...th,
      scoreLevels: normalizeAccessScoreLevels([
        { key: 'poor', upTo: pp, score: 0 },
        { key: 'moderate', upTo: mm, score: 50 },
        { key: 'good', upTo: gg, score: 85 },
        { key: 'excellent', upTo: 100, score: 100 },
      ]),
    });
  };

  const handleSlider = (_, value) => {
    pushScoreLevels(value[0], value[1], value[2]);
  };

  const commitSave = () => {
    pushScoreLevels(poorUpTo, moderateUpTo, goodUpTo);
    enqueueSnackbar('Complexity rule updated — click Save at top for tenant', { variant: 'success' });
  };

  const examples = useMemo(() => {
    const th = normalizeComplexityThresholds(thresholdsSnapshot());
    const levels = normalizeAccessScoreLevels([
      { key: 'poor', upTo: poorUpTo, score: 0 },
      { key: 'moderate', upTo: moderateUpTo, score: 50 },
      { key: 'good', upTo: goodUpTo, score: 85 },
      { key: 'excellent', upTo: 100, score: 100 },
    ]);
    const samples = [2, 7, 12];
    return samples.map((groups) => {
      const score = computeComplexityScore(groups, th);
      return { groups, score, band: complexityBandLabel(score, levels) };
    });
  }, [defaultScore, mediumMin, mediumScore, highMin, highScore, poorUpTo, moderateUpTo, goodUpTo]);

  const groupsLabel = 'Total entitlements';
  const groupsShort = 'Entitlements';

  const updateHigh = (minGroups, score) => {
    patchConfig({
      thresholds: [
        { key: 'medium', minGroups: mediumMin, score: mediumScore },
        { key: 'high', minGroups: minGroups ?? highMin, score: score ?? highScore },
      ],
    });
  };

  const updateMedium = (minGroups, score) => {
    patchConfig({
      thresholds: [
        { key: 'medium', minGroups: minGroups ?? mediumMin, score: score ?? mediumScore },
        { key: 'high', minGroups: highMin, score: highScore },
      ],
    });
  };

  return (
    <PostureRuleCard
      bare={bare}
      title={COMPLEXITY_POSTURE_RULE_TITLE}
      subtitle="Entitlements → score, then score bands (same pattern as Access Hygiene)"
      onSaveRule={commitSave}
    >
      <Paper variant="outlined" sx={postureFormulaPaperSx}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Chip label="Step 1" size="small" color="primary" sx={{ fontWeight: 700 }} />
          <Typography variant="subtitle2" fontWeight={700}>
            complexityScore from {groupsLabel}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          Rules are checked top to bottom. First match wins.
        </Typography>

        <Stack spacing={1.25}>
          <GroupsScoreRow
            keyword="IF"
            keywordColor="error"
            groups={highMin}
            score={highScore}
            groupsLabel={groupsShort}
            onGroups={(v) => updateHigh(v, highScore)}
            onScore={(v) => updateHigh(highMin, clampScore(v))}
          />
          <GroupsScoreRow
            keyword="ELSE IF"
            keywordColor="warning"
            groups={mediumMin}
            score={mediumScore}
            groupsLabel={groupsShort}
            onGroups={(v) => updateMedium(v, mediumScore)}
            onScore={(v) => updateMedium(mediumMin, clampScore(v))}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={ruleRowSx}>
            <RuleKeyword color="success">ELSE</RuleKeyword>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              All other identities (fewer entitlements)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              then score =
            </Typography>
            <TextField
              size="small"
              type="number"
              value={defaultScore}
              onChange={(e) => patchConfig({ defaultScore: clampScore(e.target.value) })}
              inputProps={{ min: 0, max: 100 }}
              sx={{ width: 88 }}
            />
            <Typography variant="body2" fontWeight={700}>
              %
            </Typography>
          </Stack>
        </Stack>

        <Paper variant="outlined" sx={{ mt: 2, p: 1.5, borderRadius: 1.5, bgcolor: alpha('#fff', 0.7) }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" sx={{ mb: 0.75 }}>
            Quick check
          </Typography>
          {examples.map((ex) => (
            <Typography key={ex.groups} variant="body2" sx={{ fontSize: '0.8rem', py: 0.25 }}>
              • <strong>{ex.groups}</strong> {groupsShort.toLowerCase()} → <strong>{ex.score}%</strong> complexityScore
              → label <strong>{ex.band}</strong> (from Step 2 slider)
            </Typography>
          ))}
        </Paper>
      </Paper>

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Chip label="Step 2" size="small" color="primary" sx={{ fontWeight: 700 }} />
        <Typography variant="subtitle2" fontWeight={700}>
          Score bands on {METRIC_BY_KEY.complexity.label} gauge (0–100)
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Move the 3 dots to set Poor / Moderate / Good cut-offs. Scores above the Good dot = Excellent (e.g. 100% with
        Good at 80 → Excellent).
      </Typography>
      <PostureLevelLegend defs={ACCESS_SCORE_LEVEL_DEFS} />

      <PostureBreakpointSlider
        defs={ACCESS_SCORE_LEVEL_DEFS}
        value={[sliderPoor, sliderMod, sliderGood]}
        onChange={handleSlider}
        min={0}
        max={SCORE_MAX}
        thumbLabels={['Poor', 'Moderate', 'Good']}
      />

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1.5 }} flexWrap="wrap">
        <TextField
          size="small"
          label="Poor"
          type="number"
          value={poorUpTo}
          onChange={(e) => pushScoreLevels(e.target.value, moderateUpTo, goodUpTo)}
          inputProps={{ min: 0, max: 100 }}
          sx={{ width: 88 }}
        />
        <TextField
          size="small"
          label="Moderate"
          type="number"
          value={moderateUpTo}
          onChange={(e) => pushScoreLevels(poorUpTo, e.target.value, goodUpTo)}
          inputProps={{ min: 0, max: 100 }}
          sx={{ width: 96 }}
        />
        <TextField
          size="small"
          label="Good"
          type="number"
          value={goodUpTo}
          onChange={(e) => pushScoreLevels(poorUpTo, moderateUpTo, e.target.value)}
          inputProps={{ min: 0, max: 100 }}
          sx={{ width: 88 }}
        />
      </Stack>
    </PostureRuleCard>
  );
}
