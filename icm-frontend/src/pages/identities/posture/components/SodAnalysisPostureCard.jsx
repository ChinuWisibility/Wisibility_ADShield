import { Box, Chip, Paper, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  postureCardAnimate,
  POSTURE_INDICATOR_BADGE,
  POSTURE_COLORS,
} from './identityPostureTheme';
import { SOD_ANALYSIS_TITLE, SOD_VIOLATIONS_LABEL } from '../identityPostureLabels';

export default function SodAnalysisPostureCard({ sodAnalysis, animateIndex = 5 }) {
  if (!sodAnalysis) return null;

  const isSafe = sodAnalysis.status === 'SAFE';
  const tierKey = String(sodAnalysis.riskTierKey || '').toUpperCase();
  const tierBadgeKey = tierKey === 'SAFE'
    ? 'SAFE'
    : tierKey === 'LOW'
      ? 'LOW'
      : tierKey === 'MEDIUM'
        ? 'MEDIUM'
        : tierKey === 'HIGH'
          ? 'HIGH'
          : sodAnalysis.status;
  const badge = POSTURE_INDICATOR_BADGE[tierBadgeKey]
    || POSTURE_INDICATOR_BADGE[sodAnalysis.status]
    || POSTURE_INDICATOR_BADGE.SAFE;
  const countColor = isSafe ? POSTURE_COLORS.green : tierKey === 'LOW' ? '#65a30d' : POSTURE_COLORS.orange;

  return (
    <Paper
      sx={{
        ...postureCardAnimate(animateIndex),
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {SOD_ANALYSIS_TITLE}
        </Typography>
        <Chip
          label={badge.label}
          size="small"
          sx={{
            height: 24,
            fontWeight: 700,
            fontSize: '0.65rem',
            bgcolor: badge.bg,
            color: badge.color,
          }}
        />
      </Box>

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          py: 2,
        }}
      >
        {isSafe ? (
          <CheckCircleOutlineIcon
            sx={{
              fontSize: 64,
              color: POSTURE_COLORS.green,
              mb: 1,
              animation: 'sodPulse 2s ease-in-out infinite',
              '@keyframes sodPulse': {
                '0%, 100%': { transform: 'scale(1)' },
                '50%': { transform: 'scale(1.04)' },
              },
            }}
          />
        ) : (
          <WarningAmberIcon
            sx={{
              fontSize: 64,
              color: POSTURE_COLORS.orange,
              mb: 1,
              animation: 'sodShake 0.6s ease-in-out',
              '@keyframes sodShake': {
                '0%, 100%': { transform: 'rotate(0deg)' },
                '25%': { transform: 'rotate(-4deg)' },
                '75%': { transform: 'rotate(4deg)' },
              },
            }}
          />
        )}

        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography
            variant="h2"
            sx={{
              fontWeight: 800,
              color: countColor,
              lineHeight: 1,
              animation: 'countUp 0.8s ease-out',
              '@keyframes countUp': {
                from: { opacity: 0, transform: 'scale(0.8)' },
                to: { opacity: 1, transform: 'scale(1)' },
              },
            }}
          >
            {sodAnalysis.violationCount}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 600 }}>
            {SOD_VIOLATIONS_LABEL}
          </Typography>
        </Box>
      </Box>

      {!isSafe && sodAnalysis.conflicts?.length > 0 && (
        <Box sx={{ mt: 'auto', pt: 1.5, maxHeight: 80, overflow: 'auto' }}>
          {sodAnalysis.conflicts.slice(0, 3).map((conflict, i) => (
            <Typography
              key={i}
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', fontWeight: 500, lineHeight: 1.4 }}
            >
              • {conflict}
            </Typography>
          ))}
        </Box>
      )}
    </Paper>
  );
}
