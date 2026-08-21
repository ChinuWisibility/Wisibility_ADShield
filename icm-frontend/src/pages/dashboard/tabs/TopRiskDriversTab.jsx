import { Box, Typography, Stack, Grid } from '@mui/material';
import GlowCard from '../components/GlowCard';
import {
  Warning as WarningIcon,
  Security as PrivilegeIcon,
  Hotel as DormantIcon,
  Block as UnusedIcon,
  VpnKey as CriticalIcon,
  TrendingUp,
  TrendingDown,
} from '@mui/icons-material';

const TOP_RISK_DRIVERS = [
  { 
    label: 'SoD Violations', 
    count: '1,234', 
    icon: <WarningIcon sx={{ fontSize: 20, color: '#ff4444' }} />, 
    color: '#ff4444',
    trend: { dir: 'up', val: '8%', pos: false }
  },
  { 
    label: 'Excessive Privileges', 
    count: '987', 
    icon: <PrivilegeIcon sx={{ fontSize: 20, color: '#ff8c00' }} />, 
    color: '#ff8c00',
    trend: { dir: 'down', val: '3%', pos: true }
  },
  { 
    label: 'Dormant Privileged Accounts', 
    count: '765', 
    icon: <DormantIcon sx={{ fontSize: 20, color: '#ffd700' }} />, 
    color: '#ffd700',
    trend: { dir: 'up', val: '12%', pos: false }
  },
  { 
    label: 'Unused Access', 
    count: '2,134', 
    icon: <UnusedIcon sx={{ fontSize: 20, color: '#4488ff' }} />, 
    color: '#4488ff',
    trend: { dir: 'down', val: '5%', pos: true }
  },
  { 
    label: 'Critical App Access', 
    count: '1,098', 
    icon: <CriticalIcon sx={{ fontSize: 20, color: '#a78bfa' }} />, 
    color: '#a78bfa',
    trend: { dir: 'up', val: '2%', pos: false }
  },
];

export default function TopRiskDriversTab() {
  return (
    <Grid container spacing={2.5}>
      <Grid item xs={12} md={8} lg={6}>
        <GlowCard>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
            <Typography
              sx={{
                color: '#e8edf5',
                fontSize: '0.85rem',
                fontWeight: 800,
                letterSpacing: '0.03em',
              }}
            >
              TOP RISK DRIVERS
            </Typography>
            <Typography
              sx={{
                color: '#4488ff',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              View All &gt;
            </Typography>
          </Box>

          <Stack spacing={2}>
            {TOP_RISK_DRIVERS.map((item, index) => (
              <Box 
                key={item.label}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  p: 1.5,
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  '&:hover': {
                    background: 'rgba(255,255,255,0.05)',
                    borderColor: `${item.color}40`,
                    transform: 'translateX(4px)',
                  }
                }}
              >
                <Stack direction="row" alignItems="center" spacing={2}>
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: '10px',
                      background: `${item.color}15`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: `1px solid ${item.color}30`,
                    }}
                  >
                    {item.icon}
                  </Box>
                  <Box>
                    <Typography sx={{ color: '#e8edf5', fontSize: '0.85rem', fontWeight: 700 }}>
                      {item.label}
                    </Typography>
                    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.2 }}>
                      {item.trend.dir === 'up' ? (
                        <TrendingUp sx={{ fontSize: 14, color: item.trend.pos ? '#00cc88' : '#ff4444' }} />
                      ) : (
                        <TrendingDown sx={{ fontSize: 14, color: item.trend.pos ? '#00cc88' : '#ff4444' }} />
                      )}
                      <Typography sx={{ color: item.trend.pos ? '#00cc88' : '#ff4444', fontSize: '0.65rem', fontWeight: 600 }}>
                        {item.trend.val} vs last month
                      </Typography>
                    </Stack>
                  </Box>
                </Stack>
                <Typography sx={{ color: '#e8edf5', fontSize: '1.1rem', fontWeight: 800 }}>
                  {item.count}
                </Typography>
              </Box>
            ))}
          </Stack>
        </GlowCard>
      </Grid>
    </Grid>
  );
}
