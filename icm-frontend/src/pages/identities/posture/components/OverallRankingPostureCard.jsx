import { Box, Chip, Paper, Typography } from '@mui/material';
import { formatPercentileOrdinal, postureCardSx, POSTURE_INDICATOR_BADGE, POSTURE_COLORS } from './identityPostureTheme';

export default function OverallRankingPostureCard({ overallRanking }) {
  if (!overallRanking) return null;

  const badge = POSTURE_INDICATOR_BADGE[overallRanking.indicator] || POSTURE_INDICATOR_BADGE.AVERAGE;
  const pct = overallRanking.percentile ?? 0;

  return (
    <Paper sx={{ ...postureCardSx, p: 3, textAlign: 'center' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 3 }}>
        Overall Ranking
      </Typography>

      <Box
        sx={{
          width: 140,
          height: 140,
          borderRadius: '50%',
          bgcolor: POSTURE_COLORS.blue,
          display: 'grid',
          placeItems: 'center',
          mx: 'auto',
          mb: 2,
          boxShadow: '0 4px 14px rgba(59,130,246,0.25)',
          transition: 'transform 0.3s ease',
          '&:hover': { transform: 'scale(1.02)' },
        }}
      >
        <Typography variant="h3" sx={{ fontWeight: 800, color: '#fff' }}>
          {pct}%
        </Typography>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 360, mx: 'auto' }}>
        This user ranks in the {formatPercentileOrdinal(pct)} percentile among {overallRanking.totalUsers}{' '}
        active user{overallRanking.totalUsers === 1 ? '' : 's'}.
        {overallRanking.capped ? ' (Ranking based on first 500 users.)' : ''}
      </Typography>

      <Chip
        label={badge.label}
        size="small"
        sx={{
          height: 24,
          fontWeight: 700,
          fontSize: '0.68rem',
          bgcolor: badge.bg,
          color: badge.color,
        }}
      />
    </Paper>
  );
}
