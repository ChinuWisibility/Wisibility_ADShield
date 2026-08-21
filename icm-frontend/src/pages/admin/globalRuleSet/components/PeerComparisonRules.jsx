import { useMemo } from 'react';
import {
  Box,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import { PEER_COMPARISON_TITLE } from '../../../identities/posture/identityPostureLabels';
import { PEER_POSTURE_INDICATOR_BADGE, POSTURE_COLORS } from '../../../identities/posture/components/identityPostureTheme';

const STUDIO_ACCENT = '#2563eb';

const ruleEditorColumnSx = { maxWidth: 1000, width: '100%' };

const postureRuleCardSx = {
  borderRadius: 2,
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: '#fff',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
};

const EXAMPLE_USER = 72;
const EXAMPLE_PEER = 65;

function previewPeerComparisonIndicator(userScore, peerAvg, config) {
  const diff = Number(userScore) - Number(peerAvg);
  const above = Number(config?.aboveAveragePoints) || 5;
  const below = Number(config?.belowAveragePoints) || 5;
  if (diff > above) return 'ABOVE_AVERAGE';
  if (diff < -below) return 'BELOW_AVERAGE';
  return 'AVERAGE';
}

function RuleCard({ title, subtitle, children }) {
  return (
    <Box sx={postureRuleCardSx}>
      <Box sx={{ px: 2.5, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2" fontWeight={700} color="text.primary">
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.35, lineHeight: 1.45 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ p: { xs: 2, sm: 2.5 }, minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

function HowItWorksStep({ number, children }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
      <Box
        sx={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          bgcolor: alpha(STUDIO_ACCENT, 0.12),
          color: STUDIO_ACCENT,
          fontSize: '0.72rem',
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          mt: 0.1,
        }}
      >
        {number}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
        {children}
      </Typography>
    </Box>
  );
}

export default function PeerComparisonRules({ peerConfig, onPeerConfigChange }) {
  const cfg = peerConfig || {};
  const enabled = cfg.enabled !== false;
  const above = cfg.aboveAveragePoints ?? 5;
  const below = cfg.belowAveragePoints ?? 5;
  const maxPeers = cfg.maxPeers ?? 50;
  const showEntitlements = cfg.showEntitlements !== false;

  const patch = (next) => onPeerConfigChange({ ...cfg, matchField: 'jobTitle', ...next });

  const exampleDiff = EXAMPLE_USER - EXAMPLE_PEER;
  const exampleIndicator = useMemo(
    () => previewPeerComparisonIndicator(EXAMPLE_USER, EXAMPLE_PEER, cfg),
    [cfg, above, below],
  );
  const exampleBadge = PEER_POSTURE_INDICATOR_BADGE[exampleIndicator] || PEER_POSTURE_INDICATOR_BADGE.AVERAGE;

  const exampleReason =
    exampleIndicator === 'ABOVE_AVERAGE'
      ? `Their score is ${exampleDiff} points higher than peers, and your “Better than peers” threshold is ${above}.`
      : exampleIndicator === 'BELOW_AVERAGE'
        ? `Their score is ${Math.abs(exampleDiff)} points lower than peers, and your “Below peers” threshold is ${below}.`
        : `The gap is within your thresholds (±${Math.min(above, below)}), so they count as similar to peers.`;

  return (
    <Box sx={ruleEditorColumnSx}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 0.75 }}>
        {PEER_COMPARISON_TITLE}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, lineHeight: 1.6, maxWidth: 640 }}>
        On each person’s Identity Posture page, this compares their overall posture score with other people
        who have the <strong>same job title</strong>, then shows a simple badge:
        {' '}
        <strong>Better than peers</strong>, <strong>Similar to peers</strong>, or <strong>Below peers</strong>.
      </Typography>

      <Stack spacing={2}>
        <RuleCard title="How it works" subtitle="What people see on Identity Posture Details">
          <Stack spacing={1.25}>
            <HowItWorksStep number={1}>
              Find other active users with the same job title (up to the max peers setting below).
            </HowItWorksStep>
            <HowItWorksStep number={2}>
              Average those peers’ posture scores and show “This User” vs “Peer Average” bars.
            </HowItWorksStep>
            <HowItWorksStep number={3}>
              Pick a badge using the point gaps you set below (not a strict equal/unequal compare).
            </HowItWorksStep>
          </Stack>

          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 2 }}>
            {['ABOVE_AVERAGE', 'AVERAGE', 'BELOW_AVERAGE'].map((key) => {
              const badge = PEER_POSTURE_INDICATOR_BADGE[key];
              return (
                <Chip
                  key={key}
                  size="small"
                  label={badge.label}
                  sx={{
                    height: 24,
                    fontWeight: 700,
                    fontSize: '0.65rem',
                    bgcolor: badge.bg,
                    color: badge.color,
                  }}
                />
              );
            })}
          </Stack>
        </RuleCard>

        <RuleCard
          title="Settings"
          subtitle={`Controls the ${PEER_COMPARISON_TITLE} card on Identity Posture Details`}
        >
          <FormControlLabel
            control={
              <Switch checked={enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
            }
            label="Show Peer Comparison card on posture pages"
            sx={{ mb: 2.5 }}
          />

          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
            When to show each badge
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5, lineHeight: 1.45 }}>
            A small score difference is treated as “Similar to peers”. Only larger gaps get Better / Below.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
            <TextField
              size="small"
              label={`Show “Better than peers” when ahead by`}
              type="number"
              value={above}
              disabled={!enabled}
              onChange={(e) => patch({ aboveAveragePoints: Number(e.target.value) || 5 })}
              inputProps={{ min: 1, max: 50 }}
              helperText={`e.g. user ${above + EXAMPLE_PEER}% vs peers ${EXAMPLE_PEER}% → Better than peers`}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label={`Show “Below peers” when behind by`}
              type="number"
              value={below}
              disabled={!enabled}
              onChange={(e) => patch({ belowAveragePoints: Number(e.target.value) || 5 })}
              inputProps={{ min: 1, max: 50 }}
              helperText={`e.g. user ${EXAMPLE_PEER - below}% vs peers ${EXAMPLE_PEER}% → Below peers`}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label="Max peers to compare"
              type="number"
              value={maxPeers}
              disabled={!enabled}
              onChange={(e) => patch({ maxPeers: Number(e.target.value) || 50 })}
              inputProps={{ min: 1, max: 200 }}
              helperText="Same job title only"
              sx={{ width: { sm: 160 } }}
            />
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={showEntitlements}
                disabled={!enabled}
                onChange={(e) => patch({ showEntitlements: e.target.checked })}
              />
            }
            label="Also compare entitlement counts in the peer summary"
            sx={{ mb: 2 }}
          />

          <Box
            sx={{
              p: 1.75,
              borderRadius: 1.5,
              bgcolor: alpha(STUDIO_ACCENT, 0.06),
              border: `1px solid ${alpha(STUDIO_ACCENT, 0.15)}`,
            }}
          >
            <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" sx={{ mb: 0.75 }}>
              Live example with your settings
            </Typography>
            <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.55 }}>
              If a user scores <strong>{EXAMPLE_USER}%</strong> and their peer average is{' '}
              <strong>{EXAMPLE_PEER}%</strong> (difference <strong>+{exampleDiff}</strong>):
            </Typography>
            <Chip
              size="small"
              label={exampleBadge.label}
              sx={{
                height: 22,
                fontWeight: 700,
                fontSize: '0.65rem',
                bgcolor: exampleBadge.bg,
                color: exampleBadge.color,
                border: `1px solid ${exampleIndicator === 'AVERAGE' ? POSTURE_COLORS.greyLight : 'transparent'}`,
                mb: 1,
              }}
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.45 }}>
              {exampleReason}
            </Typography>
          </Box>
        </RuleCard>
      </Stack>
    </Box>
  );
}
