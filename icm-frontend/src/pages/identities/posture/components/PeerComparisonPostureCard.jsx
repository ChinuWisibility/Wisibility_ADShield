import { useEffect, useState } from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';
import {
  postureCardAnimate,
  postureProgressBarSx,
  PEER_POSTURE_INDICATOR_BADGE,
  POSTURE_COLORS,
} from './identityPostureTheme';
import { PEER_COMPARISON_TITLE } from '../identityPostureLabels';

const detailCardSx = {
  p: 1.75,
  height: '100%',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  boxSizing: 'border-box',
};

function AnimatedProgressBar({ pct, color, delay = 0 }) {
  const [width, setWidth] = useState(0);
  const clamped = Math.max(0, Math.min(100, pct));

  useEffect(() => {
    const t = setTimeout(() => setWidth(clamped), 200);
    return () => clearTimeout(t);
  }, [clamped]);

  return (
    <Box sx={{ ...postureProgressBarSx(width, color, delay), height: 7 }}>
      <Box className="fill" sx={{ width: `${width}% !important` }} />
    </Box>
  );
}

function PeerBarRow({ label, pct, color, delay = 0, isLast = false }) {
  return (
    <Box sx={{ mb: isLast ? 0 : 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.35 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.72rem' }}>
          {label}
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.72rem' }}>
          {Math.round(pct)}%
        </Typography>
      </Box>
      <AnimatedProgressBar pct={pct} color={color} delay={delay} />
    </Box>
  );
}

export default function PeerComparisonPostureCard({ peerComparison, animateIndex = 8 }) {
  if (!peerComparison) return null;

  if (peerComparison.enabled === false) {
    return (
      <Paper sx={{ ...postureCardAnimate(animateIndex), ...detailCardSx }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.95rem' }}>
          {PEER_COMPARISON_TITLE}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
          {peerComparison.summary || 'Peer comparison is not enabled for this organization.'}
        </Typography>
      </Paper>
    );
  }

  const badge = PEER_POSTURE_INDICATOR_BADGE[peerComparison.indicator]
    || PEER_POSTURE_INDICATOR_BADGE.AVERAGE;
  const peerCount = peerComparison.peerCount ?? 0;
  const userScore = peerComparison.userPostureScore ?? 0;
  const peerScore = peerComparison.peerAvgPostureScore ?? 0;

  return (
    <Paper sx={{ ...postureCardAnimate(animateIndex), ...detailCardSx }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.95rem' }}>
          {PEER_COMPARISON_TITLE}
        </Typography>
        {peerCount > 0 && (
          <Chip
            label={badge.label}
            size="small"
            sx={{
              height: 20,
              fontWeight: 700,
              fontSize: '0.58rem',
              bgcolor: badge.bg,
              color: badge.color,
              flexShrink: 0,
            }}
          />
        )}
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, lineHeight: 1.35 }}>
        {peerCount > 0
          ? `${peerCount} peer${peerCount === 1 ? '' : 's'} with same job title`
          : 'No peers with same job title'}
      </Typography>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        {peerCount > 0 && (
          <>
            <PeerBarRow
              label="This User"
              pct={userScore}
              color={POSTURE_COLORS.blueDark}
              delay={0.1}
            />
            <PeerBarRow
              label="Peer Average"
              pct={peerScore}
              color="#94a3b8"
              delay={0.25}
              isLast
            />
          </>
        )}
      </Box>
    </Paper>
  );
}
