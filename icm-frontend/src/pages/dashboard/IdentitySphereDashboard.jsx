import { useState } from 'react';
import { Box, Typography, Stack, Divider, Grid } from '@mui/material';
import {
  Person as PersonIcon,
  Engineering as EngineeringIcon,
  Store as StoreIcon,
  SettingsApplications as ServiceIcon,
  SmartToy as BotIcon,
  SwapHoriz as MoveIcon,
  ExitToApp as LeaveIcon,
  HotelOutlined as DormantIcon,
  Login as JoinIcon,
  Circle as CircleIcon,
} from '@mui/icons-material';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';

import SphereCanvas from './components/SphereCanvas';
import GlowCard from './components/GlowCard';

const IDENTITY_TYPES = [
  { label: 'Employees', count: '12,580', icon: <PersonIcon sx={{ fontSize: 16, color: '#2563eb' }} />, color: '#2563eb' },
  { label: 'Contractors', count: '2,345', icon: <EngineeringIcon sx={{ fontSize: 16, color: '#f97316' }} />, color: '#f97316' },
  { label: 'Vendors', count: '1,089', icon: <StoreIcon sx={{ fontSize: 16, color: '#0d9488' }} />, color: '#0d9488' },
  { label: 'Service Accounts', count: '2,134', icon: <ServiceIcon sx={{ fontSize: 16, color: '#8b5cf6' }} />, color: '#8b5cf6' },
  { label: 'Bots', count: '320', icon: <BotIcon sx={{ fontSize: 16, color: '#ec4899' }} />, color: '#ec4899' },
];

const LIFECYCLE = [
  { label: 'Joiners (30 days)', count: '1,234', trend: '+8% vs last month', icon: <JoinIcon sx={{ fontSize: 16, color: '#059669' }} />, color: '#059669', pos: true },
  { label: 'Movers (30 days)', count: '2,345', trend: '+12% vs last month', icon: <MoveIcon sx={{ fontSize: 16, color: '#2563eb' }} />, color: '#2563eb', pos: true },
  { label: 'Leavers (30 days)', count: '532', trend: '-3% vs last month', icon: <LeaveIcon sx={{ fontSize: 16, color: '#dc2626' }} />, color: '#dc2626', pos: false },
  { label: 'Dormant (90+ days)', count: '1,987', trend: '-5% vs last month', icon: <DormantIcon sx={{ fontSize: 16, color: '#d97706' }} />, color: '#d97706', pos: false },
];

const RISK_DATA = [
  { name: 'Critical', value: 1245, color: '#dc2626' },
  { name: 'High', value: 2640, color: '#f97316' },
  { name: 'Medium', value: 6125, color: '#d97706' },
  { name: 'Low', value: 5280, color: '#2563eb' },
  { name: 'Very Low', value: 1178, color: '#0d9488' },
];

const COMPLEXITY_DATA = [
  { label: 'Very High', value: 2153, color: '#dc2626' },
  { label: 'High', value: 3328, color: '#f97316' },
  { label: 'Medium', value: 5688, color: '#d97706' },
  { label: 'Low', value: 3876, color: '#2563eb' },
  { label: 'Very Low', value: 1423, color: '#0d9488' },
];

const TOTAL_IDENTITIES = 16468;

function CustomTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    return (
      <Box
        sx={{
          background: '#ffffff',
          border: '1px solid rgba(0,0,0,0.1)',
          borderRadius: '8px',
          px: 1.5,
          py: 1,
          boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
        }}
      >
        <Typography sx={{ color: d.color, fontSize: '0.75rem', fontWeight: 700 }}>
          {d.name}: {d.value.toLocaleString()}
        </Typography>
      </Box>
    );
  }
  return null;
}

export default function ADSecurityDashboard() {
  const maxComp = Math.max(...COMPLEXITY_DATA.map((d) => d.value));

  return (
    <Box
      sx={{
        minHeight: 'calc(100vh - 64px)',
        background: 'transparent',
        color: '#111827',
        p: { xs: 2, md: 3 },
        fontFamily: 'Inter, system-ui, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* ── Main Single Page Layout ── */}
      <Grid container spacing={3} alignItems="flex-start">
        
        {/* ── LEFT COLUMN ── */}
        <Grid item xs={12} md={3} lg={2.5} sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* Identity Context */}
          <GlowCard sx={{ p: 2 }}>
            <Typography sx={{ color: '#4b5563', fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.1em', mb: 2 }}>
              IDENTITY CONTEXT (X)
            </Typography>
            <Stack spacing={0}>
              {IDENTITY_TYPES.map((item, i) => (
                <Box key={item.label}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 1.2 }}>
                    <Typography sx={{ color: '#374151', fontSize: '0.85rem', fontWeight: 600 }}>
                      {item.label}
                    </Typography>
                    <Typography sx={{ color: item.color, fontSize: '0.9rem', fontWeight: 800 }}>
                      {item.count}
                    </Typography>
                  </Stack>
                  {i < IDENTITY_TYPES.length - 1 && <Divider sx={{ borderColor: 'rgba(0,0,0,0.06)' }} />}
                </Box>
              ))}
            </Stack>
            <Typography sx={{ color: '#2563eb', fontSize: '0.75rem', fontWeight: 700, mt: 2, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>
              View All &gt;
            </Typography>
          </GlowCard>

          {/* Risk Distribution (Moved from right to left) */}
          <GlowCard sx={{ p: 2 }}>
            <Typography sx={{ color: '#4b5563', fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.1em', mb: 1 }}>
              RISK DISTRIBUTION (Z)
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 100, height: 100, position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={RISK_DATA}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius="65%"
                      outerRadius="100%"
                      stroke="#ffffff"
                      strokeWidth={2}
                    >
                      {RISK_DATA.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ color: '#111827', fontSize: '0.85rem', fontWeight: 800, lineHeight: 1 }}>
                    {TOTAL_IDENTITIES.toLocaleString()}
                  </Typography>
                  <Typography sx={{ color: '#6b7280', fontSize: '0.45rem', fontWeight: 600 }}>
                    Identities
                  </Typography>
                </Box>
              </Box>
              
              <Box sx={{ flex: 1 }}>
                <Stack spacing={0.5}>
                  {RISK_DATA.map((item) => (
                    <Stack key={item.name} direction="row" alignItems="center" justifyContent="space-between">
                      <Stack direction="row" alignItems="center" spacing={0.8}>
                        <CircleIcon sx={{ fontSize: 8, color: item.color }} />
                        <Typography sx={{ color: '#4b5563', fontSize: '0.7rem', fontWeight: 500 }}>
                          {item.name}
                        </Typography>
                      </Stack>
                      <Typography sx={{ color: '#111827', fontSize: '0.75rem', fontWeight: 700 }}>
                        {item.value.toLocaleString()}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            </Box>
            <Typography sx={{ color: '#2563eb', fontSize: '0.7rem', fontWeight: 700, mt: 1.5, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>
              View Risk Heatmap &gt;
            </Typography>
          </GlowCard>
        </Grid>

        {/* ── CENTER COLUMN (Sphere) ── */}
        <Grid item xs={12} md={6} lg={7} sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Box sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 650, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <SphereCanvas width={800} height={650} />
            {/* Zoom Tooltip Hint */}
            <Typography sx={{ position: 'absolute', bottom: 10, color: '#9ca3af', fontSize: '0.65rem', fontWeight: 500, pointerEvents: 'none' }}>
              Use mouse wheel to zoom in and out
            </Typography>
          </Box>
        </Grid>

        {/* ── RIGHT COLUMN ── */}
        <Grid item xs={12} md={3} lg={2.5} sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          
          {/* Legend Checkboxes */}
          <GlowCard sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              {IDENTITY_TYPES.map((item) => (
                <Stack key={item.label} direction="row" alignItems="center" spacing={1.5} sx={{ cursor: 'pointer', '&:hover .legend-text': { color: '#111827' } }}>
                  <Box sx={{ width: 14, height: 14, borderRadius: '3px', border: `1.5px solid ${item.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '1.5px', background: item.color }} />
                  </Box>
                  <Typography className="legend-text" sx={{ color: '#4b5563', fontSize: '0.8rem', fontWeight: 600, transition: 'color 0.2s' }}>
                    {item.label === 'Employees' ? 'Employee' : item.label === 'Contractors' ? 'Contractor' : item.label === 'Vendors' ? 'Vendor' : item.label === 'Service Accounts' ? 'Service Account' : 'Bot / Non Human'}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </GlowCard>

          {/* Access Complexity */}
          <GlowCard sx={{ p: 2 }}>
            <Typography sx={{ color: '#4b5563', fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.1em', mb: 0.5 }}>
              ACCESS COMPLEXITY (Y)
            </Typography>
            <Typography sx={{ color: '#9ca3af', fontSize: '0.65rem', fontWeight: 500, mb: 1.5 }}>
              By Complexity Score
            </Typography>
            <Stack spacing={1.5}>
              {COMPLEXITY_DATA.map((item) => (
                <Box key={item.label}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography sx={{ color: '#4b5563', fontSize: '0.75rem', fontWeight: 600 }}>
                      {item.label}
                    </Typography>
                    <Typography sx={{ color: '#111827', fontSize: '0.75rem', fontWeight: 700 }}>
                      {item.value.toLocaleString()}
                    </Typography>
                  </Stack>
                  <Box sx={{ width: '100%', height: 6, borderRadius: '3px', background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                    <Box sx={{ width: `${(item.value / maxComp) * 100}%`, height: '100%', background: item.color, borderRadius: '3px' }} />
                  </Box>
                </Box>
              ))}
            </Stack>
          </GlowCard>

        </Grid>
      </Grid>

      {/* ── BOTTOM SECTION ── */}
      <Box sx={{ mt: 3, px: { xs: 0, md: 2 } }}>
        <GlowCard sx={{ p: 2 }}>
          <Typography sx={{ color: '#4b5563', fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.1em', mb: 2 }}>
            LIFECYCLE SUMMARY
          </Typography>
          <Grid container spacing={3}>
            {LIFECYCLE.map((item, i) => (
              <Grid item xs={12} sm={6} md={3} key={item.label}>
                <Stack direction="row" alignItems="center" spacing={2} sx={{ position: 'relative' }}>
                  <Box sx={{ p: 1, borderRadius: '8px', background: 'rgba(0,0,0,0.03)', display: 'flex' }}>
                    {item.icon}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ color: '#374151', fontSize: '0.85rem', fontWeight: 600 }}>
                      {item.label}
                    </Typography>
                    <Typography sx={{ color: item.color, fontSize: '0.65rem', fontWeight: 600, mt: 0.2 }}>
                      {item.trend}
                    </Typography>
                  </Box>
                  <Typography sx={{ color: item.color, fontSize: '1.1rem', fontWeight: 800, pr: 2 }}>
                    {item.count}
                  </Typography>
                  {i < LIFECYCLE.length - 1 && (
                    <Divider orientation="vertical" flexItem sx={{ position: 'absolute', right: 0, borderColor: 'rgba(0,0,0,0.06)' }} />
                  )}
                </Stack>
              </Grid>
            ))}
          </Grid>
        </GlowCard>
      </Box>
    </Box>
  );
}
