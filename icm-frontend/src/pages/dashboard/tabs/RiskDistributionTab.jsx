import { Box, Typography, Stack, Grid } from '@mui/material';
import GlowCard from '../components/GlowCard';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';

const RISK_DATA = [
  { name: 'Critical', value: 1245, pct: '7.6%', color: '#ff4444' },
  { name: 'High', value: 2640, pct: '16.0%', color: '#ff8c00' },
  { name: 'Medium', value: 6125, pct: '37.2%', color: '#ffd700' },
  { name: 'Low', value: 5280, pct: '32.1%', color: '#4488ff' },
  { name: 'Very Low', value: 1178, pct: '7.1%', color: '#00ccaa' },
];

const TOTAL_IDENTITIES = 16468;

function CustomTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    return (
      <Box
        sx={{
          background: 'rgba(10,14,26,0.95)',
          border: '1px solid rgba(100,180,255,0.2)',
          borderRadius: '10px',
          px: 1.5,
          py: 1,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}
      >
        <Typography sx={{ color: d.color, fontSize: '0.8rem', fontWeight: 700 }}>
          {d.name}: {d.value.toLocaleString()}
        </Typography>
        <Typography sx={{ color: '#8898aa', fontSize: '0.7rem' }}>
          {d.pct} of total
        </Typography>
      </Box>
    );
  }
  return null;
}

export default function RiskDistributionTab() {
  return (
    <Grid container spacing={2.5}>
      {/* Donut Chart */}
      <Grid item xs={12} md={6}>
        <GlowCard sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Typography
            sx={{
              color: '#e8edf5',
              fontSize: '0.85rem',
              fontWeight: 800,
              mb: 1,
              alignSelf: 'flex-start',
              letterSpacing: '0.03em',
            }}
          >
            RISK DISTRIBUTION (Z)
          </Typography>

          <Box sx={{ position: 'relative', width: '100%', height: 320, display: 'flex', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={RISK_DATA}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="80%"
                  startAngle={90}
                  endAngle={-270}
                  stroke="rgba(10,14,26,0.8)"
                  strokeWidth={2}
                >
                  {RISK_DATA.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            {/* Center label */}
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <Typography sx={{ color: '#e8edf5', fontSize: '1.8rem', fontWeight: 800, lineHeight: 1 }}>
                {TOTAL_IDENTITIES.toLocaleString()}
              </Typography>
              <Typography sx={{ color: '#8898aa', fontSize: '0.7rem', fontWeight: 600 }}>
                Total Identities
              </Typography>
            </Box>
          </Box>

          <Typography
            sx={{
              color: '#4488ff',
              fontSize: '0.72rem',
              fontWeight: 700,
              mt: 1,
              cursor: 'pointer',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            View Risk Heatmap &gt;
          </Typography>
        </GlowCard>
      </Grid>

      {/* Risk Breakdown */}
      <Grid item xs={12} md={6}>
        <GlowCard sx={{ height: '100%' }}>
          <Typography
            sx={{
              color: '#e8edf5',
              fontSize: '0.85rem',
              fontWeight: 800,
              mb: 2.5,
              letterSpacing: '0.03em',
            }}
          >
            RISK BREAKDOWN
          </Typography>
          <Stack spacing={2}>
            {RISK_DATA.map((item) => (
              <Box key={item.name}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: item.color,
                        boxShadow: `0 0 8px ${item.color}55`,
                      }}
                    />
                    <Typography sx={{ color: '#c0c8d4', fontSize: '0.8rem', fontWeight: 600 }}>
                      {item.name}
                    </Typography>
                  </Stack>
                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    <Typography sx={{ color: '#e8edf5', fontSize: '0.85rem', fontWeight: 800 }}>
                      {item.value.toLocaleString()}
                    </Typography>
                    <Typography sx={{ color: '#6b7a8d', fontSize: '0.72rem', fontWeight: 600 }}>
                      ({item.pct})
                    </Typography>
                  </Stack>
                </Stack>
                {/* Progress bar */}
                <Box
                  sx={{
                    width: '100%',
                    height: 6,
                    borderRadius: '3px',
                    background: 'rgba(255,255,255,0.06)',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      width: `${(item.value / TOTAL_IDENTITIES) * 100}%`,
                      height: '100%',
                      borderRadius: '3px',
                      background: `linear-gradient(90deg, ${item.color}, ${item.color}88)`,
                      boxShadow: `0 0 8px ${item.color}33`,
                      transition: 'width 1s ease-out',
                    }}
                  />
                </Box>
              </Box>
            ))}
          </Stack>

          {/* Summary */}
          <Box
            sx={{
              mt: 3,
              pt: 2,
              borderTop: '1px solid rgba(100,180,255,0.1)',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ color: '#ff4444', fontSize: '1.3rem', fontWeight: 800 }}>
                23.6%
              </Typography>
              <Typography sx={{ color: '#6b7a8d', fontSize: '0.65rem', fontWeight: 600 }}>
                High + Critical
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ color: '#ffd700', fontSize: '1.3rem', fontWeight: 800 }}>
                37.2%
              </Typography>
              <Typography sx={{ color: '#6b7a8d', fontSize: '0.65rem', fontWeight: 600 }}>
                Medium Risk
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ color: '#00ccaa', fontSize: '1.3rem', fontWeight: 800 }}>
                39.2%
              </Typography>
              <Typography sx={{ color: '#6b7a8d', fontSize: '0.65rem', fontWeight: 600 }}>
                Low + Very Low
              </Typography>
            </Box>
          </Box>
        </GlowCard>
      </Grid>
    </Grid>
  );
}
