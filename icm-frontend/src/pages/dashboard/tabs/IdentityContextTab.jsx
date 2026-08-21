import { Box, Typography, Stack, Grid } from '@mui/material';
import GlowCard from '../components/GlowCard';
import {
  Person as PersonIcon,
  Engineering as EngineeringIcon,
  Store as StoreIcon,
  SettingsApplications as ServiceIcon,
  SmartToy as BotIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  SwapHoriz as MoveIcon,
  ExitToApp as LeaveIcon,
  HotelOutlined as DormantIcon,
  Login as JoinIcon,
  Business as OrgIcon,
  Badge as BadgeIcon,
  Work as WorkIcon,
  Autorenew as LifecycleIcon,
  LocationOn as LocationIcon,
  AccountTree as BUIcon,
} from '@mui/icons-material';

const IDENTITY_TYPES = [
  { label: 'Employees', count: '12,590', icon: <PersonIcon sx={{ fontSize: 18, color: '#4488ff' }} />, color: '#4488ff' },
  { label: 'Contractors', count: '2,345', icon: <EngineeringIcon sx={{ fontSize: 18, color: '#ff8c00' }} />, color: '#ff8c00' },
  { label: 'Vendors', count: '1,089', icon: <StoreIcon sx={{ fontSize: 18, color: '#00ccaa' }} />, color: '#00ccaa' },
  { label: 'Service Accounts', count: '2,134', icon: <ServiceIcon sx={{ fontSize: 18, color: '#a78bfa' }} />, color: '#a78bfa' },
  { label: 'Bots', count: '320', icon: <BotIcon sx={{ fontSize: 18, color: '#f472b6' }} />, color: '#f472b6' },
];

const LIFECYCLE = [
  { label: 'Joiners (30 days)', count: '1,234', icon: <JoinIcon sx={{ fontSize: 16, color: '#00cc88' }} />, color: '#00cc88', dot: '#00cc88' },
  { label: 'Movers (30 days)', count: '2,345', icon: <MoveIcon sx={{ fontSize: 16, color: '#4488ff' }} />, color: '#4488ff', dot: '#4488ff' },
  { label: 'Leavers (30 days)', count: '532', icon: <LeaveIcon sx={{ fontSize: 16, color: '#ff4444' }} />, color: '#ff4444', dot: '#ff4444' },
  { label: 'Dormant (90+ days)', count: '1,987', icon: <DormantIcon sx={{ fontSize: 16, color: '#ffd700' }} />, color: '#ffd700', dot: '#ffd700' },
];

const CONTEXT_ITEMS = [
  { label: 'Organization', icon: <OrgIcon sx={{ fontSize: 18, color: '#4488ff' }} />, desc: 'Company-wide org structure mapping' },
  { label: 'Workforce Type', icon: <BadgeIcon sx={{ fontSize: 18, color: '#ff8c00' }} />, desc: 'Employee, contractor, vendor classification' },
  { label: 'Role / Function', icon: <WorkIcon sx={{ fontSize: 18, color: '#00ccaa' }} />, desc: 'Job roles and functional departments' },
  { label: 'Lifecycle Stage', icon: <LifecycleIcon sx={{ fontSize: 18, color: '#a78bfa' }} />, desc: 'Joiner, mover, leaver, dormant stages' },
  { label: 'Location', icon: <LocationIcon sx={{ fontSize: 18, color: '#f472b6' }} />, desc: 'Geographic and office locations' },
  { label: 'Business Unit', icon: <BUIcon sx={{ fontSize: 18, color: '#ffd700' }} />, desc: 'Department and business unit mapping' },
];

export default function IdentityContextTab() {
  return (
    <Grid container spacing={2.5}>
      {/* Identity Context (X) */}
      <Grid item xs={12} md={4}>
        <GlowCard>
          <Typography
            sx={{
              color: '#e8edf5',
              fontSize: '0.85rem',
              fontWeight: 800,
              mb: 2,
              letterSpacing: '0.03em',
            }}
          >
            IDENTITY CONTEXT (X)
          </Typography>
          <Stack spacing={1.5}>
            {IDENTITY_TYPES.map((item) => (
              <Stack
                key={item.label}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  '&:hover': {
                    background: `${item.color}15`,
                    borderColor: `${item.color}30`,
                    transform: 'translateX(4px)',
                  },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: '8px',
                      background: `${item.color}20`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {item.icon}
                  </Box>
                  <Typography sx={{ color: '#c0c8d4', fontSize: '0.82rem', fontWeight: 600 }}>
                    {item.label}
                  </Typography>
                </Stack>
                <Typography sx={{ color: '#e8edf5', fontSize: '0.9rem', fontWeight: 800 }}>
                  {item.count}
                </Typography>
              </Stack>
            ))}
          </Stack>
          <Typography
            sx={{
              color: '#4488ff',
              fontSize: '0.72rem',
              fontWeight: 700,
              mt: 2,
              cursor: 'pointer',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            View All &gt;
          </Typography>
        </GlowCard>
      </Grid>

      {/* Lifecycle Summary */}
      <Grid item xs={12} md={4}>
        <GlowCard>
          <Typography
            sx={{
              color: '#e8edf5',
              fontSize: '0.85rem',
              fontWeight: 800,
              mb: 2,
              letterSpacing: '0.03em',
            }}
          >
            LIFECYCLE SUMMARY
          </Typography>
          <Stack spacing={1.5}>
            {LIFECYCLE.map((item) => (
              <Stack
                key={item.label}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  '&:hover': {
                    background: `${item.color}12`,
                    borderColor: `${item.color}28`,
                    transform: 'translateX(4px)',
                  },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: item.dot,
                      boxShadow: `0 0 8px ${item.dot}55`,
                    }}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                    {item.icon}
                    <Typography sx={{ color: '#c0c8d4', fontSize: '0.8rem', fontWeight: 600 }}>
                      {item.label}
                    </Typography>
                  </Box>
                </Stack>
                <Typography sx={{ color: '#e8edf5', fontSize: '0.9rem', fontWeight: 800 }}>
                  {item.count}
                </Typography>
              </Stack>
            ))}
          </Stack>
          <Typography
            sx={{
              color: '#4488ff',
              fontSize: '0.72rem',
              fontWeight: 700,
              mt: 2,
              cursor: 'pointer',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            View All &gt;
          </Typography>
        </GlowCard>
      </Grid>

      {/* Context Detail Cards */}
      <Grid item xs={12} md={4}>
        <GlowCard>
          <Typography
            sx={{
              color: '#00ff88',
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              mb: 0.5,
            }}
          >
            X AXIS
          </Typography>
          <Typography
            sx={{
              color: '#e8edf5',
              fontSize: '0.85rem',
              fontWeight: 800,
              mb: 2,
            }}
          >
            IDENTITY CONTEXT
          </Typography>
          <Stack spacing={1.2}>
            {CONTEXT_ITEMS.map((item) => (
              <Stack
                key={item.label}
                direction="row"
                alignItems="center"
                spacing={1.5}
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  '&:hover': {
                    background: 'rgba(100,180,255,0.08)',
                    borderColor: 'rgba(100,180,255,0.2)',
                  },
                }}
              >
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: '10px',
                    background: 'rgba(100,180,255,0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </Box>
                <Box>
                  <Typography sx={{ color: '#e8edf5', fontSize: '0.8rem', fontWeight: 700 }}>
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
