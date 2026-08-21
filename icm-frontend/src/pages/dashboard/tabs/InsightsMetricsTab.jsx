import { Box, Typography, Stack, Grid, LinearProgress } from '@mui/material';
import GlowCard from '../components/GlowCard';
import StatBadge from '../components/StatBadge';
import {
  Warning as WarningIcon,
  LinkOff as ToxicIcon,
  Hotel as DormantIcon,
  KeyOff as ExcessIcon,
  AttachMoney as MoneyIcon,
  Security as CertIcon,
} from '@mui/icons-material';

export default function InsightsMetricsTab() {
  return (
    <Stack spacing={3}>
      {/* Identity Sphere Insights (Row 1) */}
      <Box>
        <Typography
          sx={{
            color: '#e8edf5',
            fontSize: '0.85rem',
            fontWeight: 800,
            mb: 2,
            letterSpacing: '0.03em',
          }}
        >
          IDENTITY SPHERE INSIGHTS
        </Typography>
        <Grid container spacing={2.5}>
          <Grid item xs={12} sm={6} md={3}>
            <GlowCard sx={{ height: '100%' }}>
              <Typography sx={{ color: '#ff4444', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', mb: 1, textTransform: 'uppercase' }}>
                HIGH RISK IDENTITIES
              </Typography>
              <Typography sx={{ color: '#ff4444', fontSize: '1.5rem', fontWeight: 800, mb: 0.5 }}>
                1,245
              </Typography>
              <Typography sx={{ color: '#8898aa', fontSize: '0.7rem', fontWeight: 500, mb: 1 }}>
                7.6% of Total
              </Typography>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography sx={{ color: '#ff4444', fontSize: '0.7rem', fontWeight: 700 }}>
                  ↑ 12%
                </Typography>
                <Typography sx={{ color: '#6b7a8d', fontSize: '0.7rem', fontWeight: 500 }}>
                  vs last month
                </Typography>
              </Stack>
              {/* Sparkline placeholder */}
              <Box sx={{ mt: 1.5, height: 20, display: 'flex', alignItems: 'flex-end', gap: '2px' }}>
                {[4, 5, 3, 6, 8, 7, 9, 12, 10, 15, 14, 18].map((v, i) => (
                  <Box key={i} sx={{ flex: 1, background: '#ff4444', opacity: 0.5 + (i/24), height: `${(v/18)*100}%`, borderRadius: '1px' }} />
                ))}
              </Box>
            </GlowCard>
          </Grid>
          
          <Grid item xs={12} sm={6} md={3}>
            <GlowCard sx={{ height: '100%' }}>
              <Typography sx={{ color: '#ff8c00', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', mb: 1, textTransform: 'uppercase' }}>
                TOXIC ACCESS COMBINATIONS
              </Typography>
              <Typography sx={{ color: '#ff8c00', fontSize: '1.5rem', fontWeight: 800, mb: 0.5 }}>
                892
              </Typography>
              <Typography sx={{ color: '#8898aa', fontSize: '0.7rem', fontWeight: 500, mb: 1 }}>
                Identities
              </Typography>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography sx={{ color: '#ff8c00', fontSize: '0.7rem', fontWeight: 700 }}>
                  ↑ 8%
                </Typography>
                <Typography sx={{ color: '#6b7a8d', fontSize: '0.7rem', fontWeight: 500 }}>
                  vs last month
                </Typography>
              </Stack>
              <Box sx={{ mt: 1.5, height: 20, display: 'flex', alignItems: 'flex-end', gap: '2px' }}>
                {[6, 5, 7, 6, 8, 9, 8, 10, 9, 11, 10, 12].map((v, i) => (
                  <Box key={i} sx={{ flex: 1, background: '#ff8c00', opacity: 0.5 + (i/24), height: `${(v/12)*100}%`, borderRadius: '1px' }} />
                ))}
              </Box>
            </GlowCard>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <GlowCard sx={{ height: '100%' }}>
              <Typography sx={{ color: '#4488ff', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', mb: 1, textTransform: 'uppercase' }}>
                DORMANT ACCOUNTS
              </Typography>
              <Typography sx={{ color: '#4488ff', fontSize: '1.5rem', fontWeight: 800, mb: 0.5 }}>
                1,987
              </Typography>
              <Typography sx={{ color: '#8898aa', fontSize: '0.7rem', fontWeight: 500, mb: 1 }}>
                12.1% of Total
              </Typography>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography sx={{ color: '#00ccaa', fontSize: '0.7rem', fontWeight: 700 }}>
                  ↓ 5%
                </Typography>
                <Typography sx={{ color: '#6b7a8d', fontSize: '0.7rem', fontWeight: 500 }}>
                  vs last month
                </Typography>
              </Stack>
              <Box sx={{ mt: 1.5, height: 20, display: 'flex', alignItems: 'flex-end', gap: '2px' }}>
                {[15, 14, 16, 13, 12, 10, 11, 9, 8, 10, 7, 6].map((v, i) => (
                  <Box key={i} sx={{ flex: 1, background: '#4488ff', opacity: 0.5 + (i/24), height: `${(v/16)*100}%`, borderRadius: '1px' }} />
                ))}
              </Box>
            </GlowCard>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <GlowCard sx={{ height: '100%' }}>
              <Typography sx={{ color: '#00ccaa', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', mb: 1, textTransform: 'uppercase' }}>
                EXCESS ACCESS
              </Typography>
              <Typography sx={{ color: '#00ccaa', fontSize: '1.5rem', fontWeight: 800, mb: 0.5 }}>
                2,134
              </Typography>
              <Typography sx={{ color: '#8898aa', fontSize: '0.7rem', fontWeight: 500, mb: 1 }}>
                13.0% of Total
              </Typography>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography sx={{ color: '#ff4444', fontSize: '0.7rem', fontWeight: 700 }}>
                  ↑ 10%
                </Typography>
                <Typography sx={{ color: '#6b7a8d', fontSize: '0.7rem', fontWeight: 500 }}>
                  vs last month
                </Typography>
              </Stack>
              <Box sx={{ mt: 1.5, height: 20, display: 'flex', alignItems: 'flex-end', gap: '2px' }}>
                {[5, 6, 5, 7, 8, 7, 9, 11, 10, 13, 12, 15].map((v, i) => (
                  <Box key={i} sx={{ flex: 1, background: '#00ccaa', opacity: 0.5 + (i/24), height: `${(v/15)*100}%`, borderRadius: '1px' }} />
                ))}
              </Box>
            </GlowCard>
          </Grid>
        </Grid>
      </Box>

      <Grid container spacing={2.5}>
        {/* Trust Score Distribution */}
        <Grid item xs={12} md={5}>
          <GlowCard sx={{ height: '100%' }}>
            <Typography
              sx={{
                color: '#e8edf5',
                fontSize: '0.85rem',
                fontWeight: 800,
                mb: 3,
                letterSpacing: '0.03em',
              }}
            >
              IDENTITY TRUST SCORE DISTRIBUTION
            </Typography>
            
            <Box sx={{ position: 'relative', pt: 3, pb: 4, px: 2 }}>
              {/* Score Indicator */}
              <Box 
                sx={{ 
                  position: 'absolute', 
                  left: '54%', 
                  top: -5,
                  transform: 'translateX(-50%)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center'
                }}
              >
                <Box 
                  sx={{ 
                    background: 'rgba(255,255,255,0.1)', 
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '4px',
                    px: 1,
                    py: 0.2,
                    mb: 0.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5
                  }}
                >
                  <Typography sx={{ color: '#e8edf5', fontSize: '1rem', fontWeight: 800 }}>54</Typography>
                  <Typography sx={{ color: '#8898aa', fontSize: '0.6rem', fontWeight: 500 }}>Average Trust Score</Typography>
                </Box>
                <Box sx={{ width: 2, height: 12, background: '#fff' }} />
              </Box>

              {/* Gradient Bar */}
              <Box 
                sx={{ 
                  height: 12, 
                  width: '100%', 
                  borderRadius: '6px',
                  background: 'linear-gradient(90deg, #ff4444 0%, #ff8c00 25%, #ffd700 50%, #a3e635 75%, #00cc88 100%)',
                  boxShadow: '0 0 10px rgba(0,0,0,0.5)',
                  position: 'relative'
                }}
              />
              
              {/* Labels */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                <Typography sx={{ color: '#ff4444', fontSize: '0.65rem', fontWeight: 700 }}>High Risk</Typography>
                <Typography sx={{ color: '#8898aa', fontSize: '0.65rem', fontWeight: 600 }}>0</Typography>
                <Typography sx={{ color: '#8898aa', fontSize: '0.65rem', fontWeight: 600 }}>25%</Typography>
                <Typography sx={{ color: '#ffd700', fontSize: '0.65rem', fontWeight: 700 }}>Medium</Typography>
                <Typography sx={{ color: '#8898aa', fontSize: '0.65rem', fontWeight: 600 }}>75%</Typography>
                <Typography sx={{ color: '#8898aa', fontSize: '0.65rem', fontWeight: 600 }}>100</Typography>
                <Typography sx={{ color: '#00cc88', fontSize: '0.65rem', fontWeight: 700 }}>High Trust</Typography>
              </Box>
            </Box>
          </GlowCard>
        </Grid>

        {/* Business Impact Preview */}
        <Grid item xs={12} md={7}>
          <GlowCard sx={{ height: '100%' }}>
            <Typography
              sx={{
                color: '#e8edf5',
                fontSize: '0.85rem',
                fontWeight: 800,
                mb: 3,
                letterSpacing: '0.03em',
              }}
            >
              BUSINESS IMPACT PREVIEW
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box sx={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(167, 139, 250, 0.15)', border: '1px solid rgba(167, 139, 250, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1 }}>
                    <MoneyIcon sx={{ color: '#a78bfa', fontSize: 24 }} />
                  </Box>
                  <Typography sx={{ color: '#a78bfa', fontSize: '1.2rem', fontWeight: 800 }}>
                    $3.2M
                  </Typography>
                  <Typography sx={{ color: '#8898aa', fontSize: '0.65rem', fontWeight: 500, lineHeight: 1.2, mt: 0.5 }}>
                    Est. Financial Exposure
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box sx={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255, 68, 68, 0.15)', border: '1px solid rgba(255, 68, 68, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1 }}>
                    <WarningIcon sx={{ color: '#ff4444', fontSize: 22 }} />
                  </Box>
                  <Typography sx={{ color: '#ff4444', fontSize: '1.2rem', fontWeight: 800 }}>
                    1,245
                  </Typography>
                  <Typography sx={{ color: '#8898aa', fontSize: '0.65rem', fontWeight: 500, lineHeight: 1.2, mt: 0.5 }}>
                    Critical Identities Requiring Action
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box sx={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255, 140, 0, 0.15)', border: '1px solid rgba(255, 140, 0, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1 }}>
                    <ToxicIcon sx={{ color: '#ff8c00', fontSize: 22 }} />
                  </Box>
                  <Typography sx={{ color: '#ff8c00', fontSize: '1.2rem', fontWeight: 800 }}>
                    287
                  </Typography>
                  <Typography sx={{ color: '#8898aa', fontSize: '0.65rem', fontWeight: 500, lineHeight: 1.2, mt: 0.5 }}>
                    SoD Violations Identified
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box sx={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(68, 136, 255, 0.15)', border: '1px solid rgba(68, 136, 255, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1 }}>
                    <CertIcon sx={{ color: '#4488ff', fontSize: 22 }} />
                  </Box>
                  <Typography sx={{ color: '#4488ff', fontSize: '1.2rem', fontWeight: 800 }}>
                    92%
                  </Typography>
                  <Typography sx={{ color: '#8898aa', fontSize: '0.65rem', fontWeight: 500, lineHeight: 1.2, mt: 0.5 }}>
                    Certification Completion
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </GlowCard>
        </Grid>
      </Grid>
    </Stack>
  );
}
