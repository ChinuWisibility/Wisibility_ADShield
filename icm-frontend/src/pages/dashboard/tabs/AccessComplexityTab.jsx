import { Box, Typography, Stack, Grid } from '@mui/material';
import GlowCard from '../components/GlowCard';
import {
  Circle as CircleIcon,
  Apps as AppsIcon,
  VpnKey as EntitlementIcon,
  AdminPanelSettings as PrivilegeIcon,
  Source as SourceIcon,
  Shield as SoDIcon,
  Assessment as UsageIcon,
} from '@mui/icons-material';

const COMPLEXITY_DATA = [
  { label: 'Very High', value: 2153, color: '#ff4444', width: 38 },
  { label: 'High', value: 3328, color: '#ff8c00', width: 58 },
  { label: 'Medium', value: 5688, color: '#ffd700', width: 100 },
  { label: 'Low', value: 3876, color: '#4488ff', width: 68 },
  { label: 'Very Low', value: 1423, color: '#00ccaa', width: 25 },
];

const Y_AXIS_FACTORS = [
  { label: '# of Applications', icon: <AppsIcon sx={{ fontSize: 18, color: '#4488ff' }} />, desc: 'Number of applications with active access' },
  { label: '# of Entitlements', icon: <EntitlementIcon sx={{ fontSize: 18, color: '#a78bfa' }} />, desc: 'Total entitlements across all applications' },
  { label: 'Privilege Level', icon: <PrivilegeIcon sx={{ fontSize: 18, color: '#ff8c00' }} />, desc: 'Admin, power user, or standard access level' },
  { label: 'Access Sources', icon: <SourceIcon sx={{ fontSize: 18, color: '#00ccaa' }} />, desc: 'Direct grants, role-based, or inherited access' },
  { label: 'SoD Exposure', icon: <SoDIcon sx={{ fontSize: 18, color: '#ff4444' }} />, desc: 'Separation of duties conflict score' },
  { label: 'Access Usage', icon: <UsageIcon sx={{ fontSize: 18, color: '#ffd700' }} />, desc: 'Active, idle, or unused access patterns' },
];

export default function AccessComplexityTab() {
  const maxVal = Math.max(...COMPLEXITY_DATA.map((d) => d.value));

  return (
    <Grid container spacing={2.5}>
      {/* Horizontal Bar Chart */}
      <Grid item xs={12} md={6}>
        <GlowCard sx={{ height: '100%' }}>
          <Typography
            sx={{
              color: '#e8edf5',
              fontSize: '0.85rem',
              fontWeight: 800,
              mb: 0.5,
              letterSpacing: '0.03em',
            }}
          >
            ACCESS COMPLEXITY (Y)
          </Typography>
          <Typography sx={{ color: '#8898aa', fontSize: '0.72rem', fontWeight: 500, mb: 3 }}>
            By Complexity Score
          </Typography>

          <Stack spacing={2.5}>
            {COMPLEXITY_DATA.map((item) => (
              <Box key={item.label}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.6 }}>
                  <Typography sx={{ color: '#c0c8d4', fontSize: '0.8rem', fontWeight: 600, minWidth: 80 }}>
                    {item.label}
                  </Typography>
                  <Typography sx={{ color: '#e8edf5', fontSize: '0.85rem', fontWeight: 800 }}>
                    {item.value.toLocaleString()}
                  </Typography>
                </Stack>
                <Box
                  sx={{
                    width: '100%',
                    height: 24,
                    borderRadius: '6px',
                    background: 'rgba(255,255,255,0.04)',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  <Box
                    sx={{
                      width: `${(item.value / maxVal) * 100}%`,
                      height: '100%',
                      borderRadius: '6px',
                      background: `linear-gradient(90deg, ${item.color}dd, ${item.color}88)`,
                      boxShadow: `0 0 12px ${item.color}33, inset 0 1px 0 rgba(255,255,255,0.2)`,
                      transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)',
                      position: 'relative',
                      '&::after': {
                        content: '""',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: '50%',
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.15), transparent)',
                        borderRadius: '6px 6px 0 0',
                      },
                    }}
                  />
                </Box>
              </Box>
            ))}
          </Stack>

          <Typography
            sx={{
              color: '#4488ff',
              fontSize: '0.72rem',
              fontWeight: 700,
              mt: 3,
              cursor: 'pointer',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            View Access Analytics &gt;
          </Typography>
        </GlowCard>
      </Grid>

      {/* Y Axis Factors */}
      <Grid item xs={12} md={6}>
        <GlowCard sx={{ height: '100%' }}>
          <Typography
            sx={{
              color: '#00ffc8',
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              mb: 0.5,
            }}
          >
            Y AXIS
          </Typography>
          <Typography
            sx={{
              color: '#e8edf5',
              fontSize: '0.85rem',
              fontWeight: 800,
              mb: 2.5,
            }}
          >
            ACCESS COMPLEXITY FACTORS
          </Typography>

          <Stack spacing={1.5}>
            {Y_AXIS_FACTORS.map((item) => (
              <Stack
                key={item.label}
                direction="row"
                alignItems="center"
                spacing={1.5}
                sx={{
                  px: 1.5,
                  py: 1.2,
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  '&:hover': {
                    background: 'rgba(0,255,200,0.06)',
                    borderColor: 'rgba(0,255,200,0.15)',
                    transform: 'translateX(4px)',
                  },
                }}
              >
                <Box
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: '10px',
                    background: 'rgba(100,180,255,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {item.icon}
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ color: '#e8edf5', fontSize: '0.82rem', fontWeight: 700 }}>
                    {item.label}
                  </Typography>
                  <Typography sx={{ color: '#6b7a8d', fontSize: '0.65rem', fontWeight: 500 }}>
                    {item.desc}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </GlowCard>
      </Grid>
    </Grid>
  );
}
