import { Box, Paper, Typography } from '@mui/material';
import { PostureSemiGauge, PosturePeerMiniGauge } from './IdentityPostureRadialMetric';
import { formatPercentileOrdinal, postureCardAnimate, POSTURE_COLORS } from './identityPostureTheme';
import { FINAL_POSTURE_SCORE_LABEL, PEER_AVERAGE_LABEL } from '../identityPostureLabels';

export default function OverallPostureScoreCard({ healthAnalysis, peerComparison, overallRanking, animateIndex = 1 }) {
  if (!healthAnalysis) return null;

  const finalScore = healthAnalysis.finalPosture ?? 0;
  const finalLabel = healthAnalysis.labels?.finalPosture;
  const peerAvg = peerComparison?.enabled !== false ? (peerComparison?.peerAvgPostureScore ?? 0) : null;

  return (
    <Paper sx={{ ...postureCardAnimate(animateIndex), p: 3, display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, color: POSTURE_COLORS.blueDark }}>
        {FINAL_POSTURE_SCORE_LABEL}
      </Typography>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: { xs: 2, sm: 4 },
          flex: 1,
          py: 1,
        }}
      >
        <PostureSemiGauge value={finalScore} statusLabel={finalLabel} size={220} />
        {peerAvg != null && (
          <PosturePeerMiniGauge value={peerAvg} label={PEER_AVERAGE_LABEL} size={80} />
        )}
      </Box>

      {overallRanking?.percentile != null && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ textAlign: 'center', display: 'block', mt: 1, fontSize: '0.72rem' }}
        >
          {formatPercentileOrdinal(overallRanking.percentile)} percentile among{' '}
          {overallRanking.totalUsers ?? 0} active users
        </Typography>
      )}
    </Paper>
  );
}
