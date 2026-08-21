import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Grid,
  Typography,
  Button,
  Stack,
  Chip,
  useTheme,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { identityAPI, applicationAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  RadialBarChart,
  RadialBar,
  LabelList,
} from 'recharts';
import { Apps, Group, PersonOff, Person, ManageAccounts, AppRegistration, Storage } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';

function formatTenantName(user) {
  const t = user?.tenantId;
  if (!t) return null;
  if (typeof t === 'object') return t?.name || null;
  return null;
}

function formatTenantCode(user) {
  const t = user?.tenantId;
  if (!t) return null;
  if (typeof t === 'object') return t?.code || null;
  return null;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const theme = useTheme();
  const { user, isPlatformAdmin } = useAuth();
  const tenantId = useMemo(
    () => (typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId) || null,
    [user?.tenantId],
  );

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [identityStats, setIdentityStats] = useState({ total: 0, active: 0, privileged: 0, inactive: 0 });
  const [applicationsTotal, setApplicationsTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadError('');
      setLoading(true);
      try {
        if (!tenantId) {
          if (!cancelled) {
            setIdentityStats({ total: 0, active: 0, privileged: 0, inactive: 0 });
            setApplicationsTotal(0);
          }
          return;
        }

        const [identitiesRes, appsRes] = await Promise.all([
          identityAPI.list({ tenantId, page: 0, limit: 1 }),
          applicationAPI.list({ tenantId, page: 1, limit: 1 }),
        ]);

        const stats = identitiesRes?.data?.stats || {};
        const totalApps = Number(appsRes?.data?.total || appsRes?.data?.count || 0);

        if (!cancelled) {
          setIdentityStats({
            total: Number(stats.total || 0),
            active: Number(stats.active || 0),
            privileged: Number(stats.privileged || 0),
            inactive: Number(stats.inactive || 0),
          });
          setApplicationsTotal(Number.isFinite(totalApps) ? totalApps : 0);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e?.response?.data?.message || e?.message || 'Failed to load dashboard data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const tenantName = formatTenantName(user);
  const tenantCode = formatTenantCode(user);

  const identityBreakdown = useMemo(() => {
    const total = Math.max(0, Number(identityStats.total || 0));
    const active = Math.max(0, Number(identityStats.active || 0));
    const inactive = Math.max(0, Number(identityStats.inactive || 0));
    return [
      { name: 'Active', value: active },
      { name: 'Inactive', value: inactive },
    ].filter((x) => x.value > 0 || total === 0);
  }, [identityStats.active, identityStats.inactive, identityStats.total]);

  const rates = useMemo(() => {
    const total = Math.max(0, Number(identityStats.total || 0));
    const active = Math.max(0, Number(identityStats.active || 0));
    const inactive = Math.max(0, Number(identityStats.inactive || 0));
    const other = Math.max(0, total - active - inactive);
    const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);
    return {
      total,
      active,
      inactive,
      other,
      activePct: pct(active),
      inactivePct: pct(inactive),
      otherPct: pct(other),
    };
  }, [identityStats.active, identityStats.inactive, identityStats.total]);

  const chartColors = useMemo(() => {
    return {
      identities: '#355a7a', // Navy steel
      active: '#4f7f9c', // Lighter navy
      inactive: '#243a5e', // Deep navy
      other: '#8da0b3', // Blue grey
      grid: alpha(theme.palette.divider, 0.6),
    };
  }, [theme.palette.divider]);

  const chartGradients = {
    identities: 'grad-identities',
    active: 'grad-active',
    inactive: 'grad-inactive',
    other: 'grad-other',
  };

  const primaryKpis = useMemo(
    () => ([
      {
        id: 'total',
        title: 'TOTAL IDENTITIES',
        value: identityStats.total,
        helper: 'Total identities',
        icon: <Group sx={{ fontSize: 24, color: chartColors.identities }} />,
        iconBg: alpha(chartColors.identities, 0.12),
      },
      {
        id: 'active',
        title: 'ACTIVE IDENTITIES',
        value: identityStats.active,
        helper: 'Active identities',
        icon: <Person sx={{ fontSize: 24, color: chartColors.active }} />,
        iconBg: alpha(chartColors.active, 0.1),
      },
      {
        id: 'inactive',
        title: 'INACTIVE IDENTITIES',
        value: identityStats.inactive,
        helper: 'Inactive identities',
        icon: <PersonOff sx={{ fontSize: 24, color: chartColors.inactive }} />,
        iconBg: alpha(chartColors.inactive, 0.12),
      },
      {
        id: 'apps',
        title: 'REGISTERED APPLICATIONS',
        value: applicationsTotal,
        helper: 'Registered applications',
        icon: <Apps sx={{ fontSize: 24, color: chartColors.other }} />,
        iconBg: alpha(chartColors.other, 0.12),
      },
    ]),
    [applicationsTotal, identityStats.active, identityStats.inactive, identityStats.total, chartColors],
  );

  if (!tenantId) {
    return (
      <Box sx={{ p: { xs: 2, sm: 3 }, bgcolor: '#f4f6f8', minHeight: '100vh' }}>
        <Card sx={{ borderRadius: 2, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
            <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>
              {isPlatformAdmin ? 'Platform Dashboard' : 'Welcome'}
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {isPlatformAdmin
                ? 'Select a tenant context to view tenant dashboards and reports.'
                : 'No tenant is assigned to your account. Contact an administrator to get access.'}
            </Typography>
            {isPlatformAdmin && (
              <Button variant="contained" onClick={() => navigate('/admin/tenants')}>
                Manage tenants
              </Button>
            )}
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, bgcolor: '#f5f7fa', minHeight: '100vh' }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 0.5 }}>
            Tenant Overview
          </Typography>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            alignItems={{ xs: 'flex-start', md: 'center' }}
            justifyContent="space-between"
          >
            <Box>
              <Typography variant="h3" fontWeight={700} sx={{ mb: 0.5 }}>
                {tenantName || 'Wisibility'}
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 1.5 }}>
                {loading ? 'Loading...' : 'Snapshot of identities and applications in this tenant.'}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {tenantCode && (
                  <Chip
                    size="small"
                    label={`Code: ${tenantCode}`}
                    sx={{ bgcolor: '#e0e0e0', color: '#424242', fontWeight: 500, borderRadius: 1 }}
                  />
                )}
                <Chip
                  size="small"
                  label={`Tenant ID: ${tenantId}`}
                  sx={{ bgcolor: '#e0e0e0', color: '#424242', fontWeight: 500, borderRadius: 1 }}
                />
              </Stack>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button
                variant="contained"
                startIcon={<ManageAccounts />}
                onClick={() => navigate('/identities')}
                sx={{ bgcolor: chartColors.inactive, '&:hover': { bgcolor: '#123158' }, textTransform: 'none', px: 2.5 }}
              >
                Manage Identities
              </Button>
              <Button
                variant="contained"
                startIcon={<AppRegistration />}
                onClick={() => navigate('/applications')}
                sx={{ bgcolor: chartColors.inactive, '&:hover': { bgcolor: '#123158' }, textTransform: 'none', px: 2.5 }}
              >
                Register App
              </Button>
              <Button
                variant="contained"
                startIcon={<Storage />}
                onClick={() => navigate('/datahygine')}
                sx={{ bgcolor: '#37474f', '&:hover': { bgcolor: '#263238' }, textTransform: 'none', px: 2.5 }}
              >
                Data Hygiene
              </Button>
            </Stack>
          </Stack>
        </Box>

        {loadError && (
          <Card sx={{ borderRadius: 2, border: '1px solid', borderColor: 'error.light', boxShadow: 'none' }}>
            <CardContent>
              <Typography fontWeight={700} color="error.main" sx={{ mb: 0.5 }}>
                Dashboard data failed to load
              </Typography>
              <Typography color="text.secondary">{loadError}</Typography>
            </CardContent>
          </Card>
        )}

        <Grid container spacing={2}>
          {primaryKpis.map((kpi) => (
            <Grid key={kpi.id} item xs={12} sm={6} md={3}>
              <Card sx={{ borderRadius: 2, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #f0f0f0' }}>
                <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Box
                      sx={{
                        width: 48,
                        height: 48,
                        borderRadius: 2,
                        bgcolor: kpi.iconBg,
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      {kpi.icon}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.5, lineHeight: 1.2, display: 'block', mb: 0.5 }}>
                        {kpi.title}
                      </Typography>
                      <Typography variant="h4" fontWeight={700} sx={{ lineHeight: 1.1, mb: 0.25 }}>
                        {loading ? <CircularProgress size={20} /> : kpi.value}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {kpi.helper}
                      </Typography>
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}

          {/* Identity Status */}
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: 2, height: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #f0f0f0' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography fontWeight={700} variant="h6" sx={{ mb: 3 }}>
                  Identity Status
                </Typography>
                <Box sx={{ height: 260, display: 'flex', alignItems: 'center' }}>
                  <Box sx={{ flex: 1, height: '100%', position: 'relative' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <defs>
                          <linearGradient id={chartGradients.active} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={alpha(chartColors.active, 0.95)} />
                            <stop offset="100%" stopColor={alpha(chartColors.active, 0.35)} />
                          </linearGradient>
                          <linearGradient id={chartGradients.inactive} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={alpha(chartColors.inactive, 0.95)} />
                            <stop offset="100%" stopColor={alpha(chartColors.inactive, 0.35)} />
                          </linearGradient>
                        </defs>
                        <Pie
                          data={identityBreakdown}
                          dataKey="value"
                          nameKey="name"
                          innerRadius="65%"
                          outerRadius="90%"
                          startAngle={90}
                          endAngle={-270}
                          stroke="none"
                        >
                          {identityBreakdown.map((entry) => (
                            <Cell
                              key={entry.name}
                              fill={entry.name === 'Active'
                                ? `url(#${chartGradients.active})`
                                : `url(#${chartGradients.inactive})`}
                            />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <Box
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'grid',
                        placeItems: 'center',
                        pointerEvents: 'none',
                      }}
                    >
                      <Typography variant="h3" fontWeight={700}>
                        {rates.activePct}%
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ width: 140, pl: 2 }}>
                    <Stack spacing={1.5}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Box sx={{ width: 14, height: 14, borderRadius: '3px', bgcolor: chartColors.active }} />
                        <Typography variant="body2" color="text.secondary">
                          Active ({rates.activePct}%)
                        </Typography>
                      </Stack>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Box sx={{ width: 14, height: 14, borderRadius: '3px', bgcolor: chartColors.inactive }} />
                        <Typography variant="body2" color="text.secondary">
                          Inactive ({rates.inactivePct}%)
                        </Typography>
                      </Stack>
                    </Stack>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Identity Metrics */}
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: 2, height: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #f0f0f0' }}>
              <CardContent sx={{ p: 3, pb: 2 }}>
                <Typography fontWeight={700} variant="h6" sx={{ mb: 3 }}>
                  Identity Metrics
                </Typography>
                <Box sx={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[
                        { name: 'Identities', value: Number(identityStats.total || 0) },
                        { name: 'Active', value: Number(identityStats.active || 0) },
                        { name: 'Inactive', value: Number(identityStats.inactive || 0) },
                        { name: 'Apps', value: Number(applicationsTotal || 0) },
                      ]}
                      margin={{ top: 20, right: 10, left: 10, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id={chartGradients.identities} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={alpha(chartColors.identities, 0.95)} />
                          <stop offset="100%" stopColor={alpha(chartColors.identities, 0.35)} />
                        </linearGradient>
                        <linearGradient id={chartGradients.active} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={alpha(chartColors.active, 0.95)} />
                          <stop offset="100%" stopColor={alpha(chartColors.active, 0.35)} />
                        </linearGradient>
                        <linearGradient id={chartGradients.inactive} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={alpha(chartColors.inactive, 0.95)} />
                          <stop offset="100%" stopColor={alpha(chartColors.inactive, 0.35)} />
                        </linearGradient>
                        <linearGradient id={chartGradients.other} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={alpha(chartColors.other, 0.95)} />
                          <stop offset="100%" stopColor={alpha(chartColors.other, 0.35)} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={chartColors.grid} vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: theme.palette.text.secondary }} dy={10} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fill: theme.palette.text.secondary }} width={45} />
                      <Tooltip cursor={{ fill: 'transparent' }} />
                      <Bar dataKey="value" maxBarSize={60}>
                        {
                          [0, 1, 2, 3].map((entry, index) => {
                            const colors = [
                              `url(#${chartGradients.identities})`,
                              `url(#${chartGradients.active})`,
                              `url(#${chartGradients.inactive})`,
                              `url(#${chartGradients.other})`,
                            ];
                            return <Cell key={`cell-${index}`} fill={colors[index]} />;
                          })
                        }
                        <LabelList dataKey="value" position="top" fill={theme.palette.text.primary} fontWeight={500} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
                <Stack
                  direction="row"
                  spacing={2}
                  justifyContent="center"
                  alignItems="center"
                  sx={{ mt: 2 }}
                >
                  {[
                    { label: 'Identities', color: chartColors.identities },
                    { label: 'Active', color: chartColors.active },
                    { label: 'Inactive', color: chartColors.inactive },
                    { label: 'Apps', color: chartColors.other },
                  ].map((item) => (
                    <Stack key={item.label} direction="row" alignItems="center" spacing={1}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: item.color }} />
                      <Typography variant="body2" color="text.secondary" fontWeight={500}>
                        {item.label}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* Active Rate */}
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: 2, height: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #f0f0f0' }}>
              <CardContent sx={{ p: 3, pb: 2 }}>
                <Typography fontWeight={700} variant="h6" sx={{ mb: 1 }}>
                  Active Rate
                </Typography>
                <Box sx={{ height: 220, position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <defs>
                        <linearGradient id={chartGradients.active} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={alpha(chartColors.active, 0.95)} />
                          <stop offset="100%" stopColor={alpha(chartColors.active, 0.35)} />
                        </linearGradient>
                        <linearGradient id={chartGradients.inactive} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={alpha(chartColors.inactive, 0.95)} />
                          <stop offset="100%" stopColor={alpha(chartColors.inactive, 0.35)} />
                        </linearGradient>
                      </defs>
                      <Pie
                        data={[
                          { name: 'Active', value: rates.activePct },
                          { name: 'Inactive', value: 100 - rates.activePct },
                        ]}
                        dataKey="value"
                        startAngle={180}
                        endAngle={0}
                        innerRadius="70%"
                        outerRadius="100%"
                        stroke="none"
                        cx="50%"
                        cy="80%"
                      >
                        <Cell fill={`url(#${chartGradients.active})`} />
                        <Cell fill={`url(#${chartGradients.inactive})`} />
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      pb: 4,
                      pointerEvents: 'none',
                    }}
                  >
                    <Typography variant="h3" fontWeight={700} sx={{ lineHeight: 1 }}>
                      {loading ? '—' : `${rates.activePct}%`}
                    </Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.5, fontWeight: 500 }}>
                      Active identities
                    </Typography>
                  </Box>
                </Box>
                <Stack
                  direction="row"
                  spacing={2}
                  justifyContent="center"
                  alignItems="center"
                  sx={{ mt: -2 }}
                >
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: chartColors.active }} />
                    <Typography variant="body2" color="text.secondary" fontWeight={500}>
                      Active: {rates.active}
                    </Typography>
                  </Stack>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: chartColors.inactive }} />
                    <Typography variant="body2" color="text.secondary" fontWeight={500}>
                      Inactive: {rates.inactive}
                    </Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* Identity Composition */}
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: 2, height: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #f0f0f0' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography fontWeight={700} variant="h6" sx={{ mb: 3 }}>
                  Identity Composition
                </Typography>
                <Box sx={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={[
                        { name: 'Active', pct: rates.activePct, fill: chartColors.active },
                        { name: 'Inactive', pct: rates.inactivePct, fill: chartColors.inactive },
                        { name: 'Other', pct: rates.otherPct, fill: chartColors.other },
                      ]}
                      margin={{ top: 0, right: 20, left: 0, bottom: 20 }}
                    >
                      <defs>
                        <linearGradient id={chartGradients.active} x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor={alpha(chartColors.active, 0.95)} />
                          <stop offset="100%" stopColor={alpha(chartColors.active, 0.35)} />
                        </linearGradient>
                        <linearGradient id={chartGradients.inactive} x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor={alpha(chartColors.inactive, 0.95)} />
                          <stop offset="100%" stopColor={alpha(chartColors.inactive, 0.35)} />
                        </linearGradient>
                        <linearGradient id={chartGradients.other} x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor={alpha(chartColors.other, 0.95)} />
                          <stop offset="100%" stopColor={alpha(chartColors.other, 0.35)} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={chartColors.grid} horizontal={false} vertical={true} />
                      <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} tick={{ fill: theme.palette.text.secondary }} />
                      <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fill: theme.palette.text.primary, fontWeight: 500 }} width={70} />
                      <Tooltip formatter={(v) => [`${v}%`, 'Percent']} cursor={{ fill: 'transparent' }} />
                      <Bar dataKey="pct" barSize={24} radius={[0, 4, 4, 0]}>
                        {[
                          { k: 'Active', c: `url(#${chartGradients.active})` },
                          { k: 'Inactive', c: `url(#${chartGradients.inactive})` },
                          { k: 'Other', c: `url(#${chartGradients.other})` },
                        ].map((x) => (
                          <Cell key={x.k} fill={x.c} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Stack>
    </Box>
  );
}