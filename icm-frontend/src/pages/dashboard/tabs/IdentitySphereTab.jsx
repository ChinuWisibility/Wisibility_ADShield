import { Box, Typography, Stack } from '@mui/material';
import GlowCard from '../components/GlowCard';
import SphereCanvas from '../components/SphereCanvas';
import {
  Circle as CircleIcon,
  Person as PersonIcon,
  Engineering as EngineeringIcon,
  Store as StoreIcon,
  SettingsApplications as ServiceIcon,
  SmartToy as BotIcon,
} from '@mui/icons-material';

const IDENTITY_LEGEND = [
  { label: 'Critical Risk', color: '#ff4444' },
  { label: 'High Risk', color: '#ff8c00' },
  { label: 'Medium Risk', color: '#ffd700' },
  { label: 'Low Risk', color: '#4488ff' },
  { label: 'Very Low Risk', color: '#00ccaa' },
];

const IDENTITY_TYPE_LEGEND = [
  { label: 'Employee', icon: <PersonIcon sx={{ fontSize: 14 }} /> },
  { label: 'Contractor', icon: <EngineeringIcon sx={{ fontSize: 14 }} /> },
  { label: 'Vendor', icon: <StoreIcon sx={{ fontSize: 14 }} /> },
  { label: 'Service Account', icon: <ServiceIcon sx={{ fontSize: 14 }} /> },
  { label: 'Bot / Non Human', icon: <BotIcon sx={{ fontSize: 14 }} /> },
];

const X_AXIS_ITEMS = ['Organization', 'Workforce Type', 'Role / Function', 'Lifecycle Stage', 'Location', 'Business Unit'];
const Y_AXIS_ITEMS = ['# of Applications', '# of Entitlements', 'Privilege Level', 'Access Sources', 'SoD Exposure', 'Access Usage'];

export default function ADSecurityTab() {
  return (
    <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap' }}>
      {/* ── Left: X Axis Context ── */}
      <Box sx={{ width: 200, flexShrink: 0 }}>
        <GlowCard sx={{ mb: 2 }}>
          <Typography
            sx={{
              color: '#00ff88',
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              mb: 1.5,
            }}
          >
            X AXIS
          </Typography>
          <Typography
            sx={{ color: '#e8edf5', fontSize: '0.8rem', fontWeight: 700, mb: 1 }}
          >
            IDENTITY CONTEXT
          </Typography>
          {X_AXIS_ITEMS.map((item) => (
            <Stack
              key={item}
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ mb: 0.8 }}
            >
              <CircleIcon sx={{ fontSize: 6, color: '#00ff88', opacity: 0.6 }} />
              <Typography sx={{ color: '#8898aa', fontSize: '0.72rem', fontWeight: 500 }}>
                {item}
              </Typography>
            </Stack>
          ))}
        </GlowCard>
      </Box>

      {/* ── Center: Sphere ── */}
      <Box sx={{ flex: 1, minWidth: 400, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <SphereCanvas width={580} height={460} />
      </Box>

      {/* ── Right: Legend + Y Axis ── */}
      <Box sx={{ width: 220, flexShrink: 0 }}>
        {/* Identity Legend */}
        <GlowCard sx={{ mb: 2 }}>
          <Typography
            sx={{
              color: '#e8edf5',
              fontSize: '0.75rem',
              fontWeight: 700,
              mb: 1.5,
              letterSpacing: '0.03em',
            }}
          >
            IDENTITY LEGEND
          </Typography>
          {IDENTITY_LEGEND.map((item) => (
            <Stack
              key={item.label}
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ mb: 0.7 }}
            >
              <CircleIcon sx={{ fontSize: 10, color: item.color }} />
              <Typography sx={{ color: '#c0c8d4', fontSize: '0.72rem', fontWeight: 500 }}>
                {item.label}
              </Typography>
            </Stack>
          ))}
          <Box sx={{ my: 1.5, borderBottom: '1px solid rgba(100,180,255,0.1)' }} />
          {IDENTITY_TYPE_LEGEND.map((item) => (
            <Stack
              key={item.label}
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ mb: 0.7, color: '#8898aa' }}
            >
              {item.icon}
              <Typography sx={{ color: '#c0c8d4', fontSize: '0.72rem', fontWeight: 500 }}>
                {item.label}
              </Typography>
            </Stack>
          ))}
        </GlowCard>

        {/* Y Axis */}
        <GlowCard>
          <Typography
            sx={{
              color: '#00ffc8',
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              mb: 1.5,
            }}
          >
            Y AXIS
          </Typography>
          <Typography
            sx={{ color: '#e8edf5', fontSize: '0.8rem', fontWeight: 700, mb: 1 }}
          >
            ACCESS COMPLEXITY
          </Typography>
          {Y_AXIS_ITEMS.map((item) => (
            <Stack
              key={item}
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ mb: 0.8 }}
            >
              <CircleIcon sx={{ fontSize: 6, color: '#00ffc8', opacity: 0.6 }} />
              <Typography sx={{ color: '#8898aa', fontSize: '0.72rem', fontWeight: 500 }}>
                {item}
              </Typography>
            </Stack>
          ))}
        </GlowCard>
      </Box>
    </Box>
  );
}
