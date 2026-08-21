import { Box, Grid, Paper, Typography } from '@mui/material';
import IdentityPostureRadialMetric from './IdentityPostureRadialMetric';
import { postureCardSx } from './identityPostureTheme';
import { FINAL_POSTURE_SCORE_LABEL, POSTURE_METRICS_TITLE, POSTURE_METRICS } from '../identityPostureLabels';

export default function HealthAnalysisPostureCard({ healthAnalysis }) {
  if (!healthAnalysis) return null;

  const labels = healthAnalysis.labels || {};

  return (
    <Paper sx={{ ...postureCardSx, p: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2.5 }}>
        {POSTURE_METRICS_TITLE}
      </Typography>

      <Grid container spacing={2}>
        {POSTURE_METRICS.map(({ key, label }) => (
          <Grid item xs={6} sm={4} md={6} lg={4} key={key}>
            <IdentityPostureRadialMetric
              label={label}
              value={healthAnalysis[key]}
              statusLabel={labels[key]}
              size={80}
            />
          </Grid>
        ))}
        <Grid item xs={12}>
          <Box
            sx={{
              mt: 1,
              pt: 2,
              borderTop: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 2,
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {FINAL_POSTURE_SCORE_LABEL}
            </Typography>
            <IdentityPostureRadialMetric
              label=""
              value={healthAnalysis.finalPosture}
              statusLabel={labels.finalPosture}
              size={88}
              compact
            />
          </Box>
        </Grid>
      </Grid>
    </Paper>
  );
}
