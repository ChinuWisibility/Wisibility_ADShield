import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Chip,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  IconButton,
  Menu,
  ListItemIcon,
  ListItemText,
  Stack,
  Divider,
  LinearProgress,
} from '@mui/material';
import {
  PlayArrow,
  Search as SearchIcon,
  MoreVert,
  CheckCircleOutline,
  HourglassEmpty,
  Apps,
  Link as LinkIcon,
  LinkOff,
  TrendingUp,
  OpenInNew,
} from '@mui/icons-material';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { alpha } from '@mui/material/styles';
import { palette } from '../../theme/palette';
import { resolveApplicationIconSrc } from '../../components/applications/ApplicationIconPicker';

/** Correlation accents — slate blue from analytics bars + amber for gaps */
const CORR = {
  linked: '#4A6984',
  linkedSoft: alpha('#4A6984', 0.12),
  linkedMuted: '#3D5870',
  linkedLight: '#AAB8C8',
  linkedGradient: 'linear-gradient(90deg, #4A6984 0%, #6B849C 55%, #AAB8C8 100%)',
  unlinked: '#C2410C',
  unlinkedSoft: alpha('#C2410C', 0.1),
  track: '#E8EEF4',
};

export function getAppCorrelationStats(app, history) {
  if (!history) {
    return {
      total: 0,
      linked: 0,
      unlinked: 0,
      status: 'never',
      successPct: null,
      hasRun: false,
    };
  }
  const total = Number(history.totalProcessed ?? 0);
  const linked = Number(history.newlyLinked ?? 0);
  const unlinked = Number(history.uncorrelatedAccounts ?? history.orphansDetected ?? 0);
  const denom = linked + unlinked;
  const successPct = denom > 0 ? (linked / denom) * 100 : null;
  // Unlinked accounts are expected; any successful run is "completed".
  return { total, linked, unlinked, status: 'completed', successPct, hasRun: true };
}

export function formatRuleChips(history) {
  const list = Array.isArray(history?.rules) ? history.rules : [];
  if (list.length > 0) {
    return list
      .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
      .map((r) => {
        const ia = String(r.identityAttribute || '').trim();
        const aa = String(r.accountAttribute || '').trim();
        if (!ia || !aa) return null;
        return `${ia} → ${aa}`;
      })
      .filter(Boolean);
  }
  const ia = String(history?.identityAttribute || '').trim();
  const aa = String(history?.accountAttribute || '').trim();
  if (ia && aa) return [`${ia} → ${aa}`];
  return [];
}

function formatLastRun(ts) {
  if (!ts) return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function AppIcon({ app, size = 36 }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: 1.25,
        border: `1px solid ${palette.border.default}`,
        bgcolor: app.icon ? '#fff' : (app.color || alpha(palette.brand.primary, 0.12)),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        fontSize: size * 0.36,
        fontWeight: 800,
        p: app.icon ? 0.35 : 0,
      }}
    >
      {app.icon ? (
        <Box
          component="img"
          src={resolveApplicationIconSrc(app.icon)}
          alt=""
          loading="lazy"
          decoding="async"
          sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <Box sx={{ color: app.color || palette.brand.primary }}>
          {app.name?.charAt(0)?.toUpperCase() || '?'}
        </Box>
      )}
    </Box>
  );
}

function StatusBadge({ status, isRunning }) {
  if (isRunning) {
    return (
      <Chip
        size="small"
        icon={<CircularProgress size={12} thickness={5} />}
        label="Running"
        sx={{
          height: 24,
          fontWeight: 700,
          bgcolor: alpha(palette.brand.primary, 0.1),
          color: palette.brand.primary,
          border: `1px solid ${alpha(palette.brand.primary, 0.28)}`,
          '& .MuiChip-icon': { color: palette.brand.primary, ml: 0.75 },
        }}
      />
    );
  }
  if (status === 'completed') {
    return (
      <Chip
        size="small"
        icon={<CheckCircleOutline sx={{ fontSize: '16px !important' }} />}
        label="Completed"
        sx={{
          height: 24,
          fontWeight: 700,
          bgcolor: CORR.linkedSoft,
          color: CORR.linkedMuted,
          border: `1px solid ${alpha(CORR.linked, 0.22)}`,
          '& .MuiChip-icon': { color: CORR.linked },
        }}
      />
    );
  }
  return (
    <Chip
      size="small"
      icon={<HourglassEmpty sx={{ fontSize: '16px !important' }} />}
      label="Never run"
      sx={{
        height: 24,
        fontWeight: 700,
        bgcolor: palette.bg.elevated,
        color: palette.text.secondary,
      }}
    />
  );
}

function KpiCard({ icon, label, value, hint, accent }) {
  const iconColor = accent || palette.text.secondary;
  const iconBg = accent ? alpha(accent, 0.1) : palette.bg.elevated;
  return (
    <Paper
      elevation={0}
      sx={{
        flex: 1,
        minWidth: 0,
        px: 1.5,
        py: 1.25,
        borderRadius: 1.5,
        border: `1px solid ${palette.border.default}`,
        bgcolor: '#fff',
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
      }}
    >
      <Box
        sx={{
          width: 34,
          height: 34,
          borderRadius: 1.25,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: iconBg,
          color: iconColor,
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: palette.text.secondary, fontWeight: 600, display: 'block', lineHeight: 1.15 }}>
          {label}
        </Typography>
        <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', lineHeight: 1.2, color: palette.text.primary }}>
          {value}
        </Typography>
        {hint ? (
          <Typography variant="caption" sx={{ color: palette.text.disabled, display: 'block', lineHeight: 1.2 }}>
            {hint}
          </Typography>
        ) : null}
      </Box>
    </Paper>
  );
}

export function CorrelationKpiStrip({ apps, scanHistory }) {
  const kpi = useMemo(() => {
    let total = 0;
    let linked = 0;
    let unlinked = 0;
    let ran = 0;
    for (const app of apps) {
      const s = getAppCorrelationStats(app, scanHistory[app._id]);
      if (!s.hasRun) continue;
      ran += 1;
      total += s.total;
      linked += s.linked;
      unlinked += s.unlinked;
    }
    const denom = linked + unlinked;
    const success = denom > 0 ? (linked / denom) * 100 : null;
    const ofTotal = total > 0 ? (linked / total) * 100 : null;
    const unlinkedPct = total > 0 ? (unlinked / total) * 100 : null;
    return {
      apps: apps.length,
      total,
      linked,
      unlinked,
      ran,
      success,
      ofTotal,
      unlinkedPct,
    };
  }, [apps, scanHistory]);

  const fmt = (n) => Number(n || 0).toLocaleString();
  const pct = (n) => (n == null ? '—' : `${n.toFixed(1)}%`);

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
      <KpiCard icon={<Apps sx={{ fontSize: 18 }} />} label="Applications" value={fmt(kpi.apps)} hint="Configured" />
      <KpiCard icon={<LinkIcon sx={{ fontSize: 18 }} />} label="Total accounts" value={fmt(kpi.total)} hint={kpi.ran ? `Across ${kpi.ran} runs` : 'No runs yet'} />
      <KpiCard
        icon={<CheckCircleOutline sx={{ fontSize: 18 }} />}
        label="Correlated accounts"
        value={fmt(kpi.linked)}
        hint={kpi.ofTotal != null ? `${pct(kpi.ofTotal)} of total` : undefined}
        accent={CORR.linked}
      />
      <KpiCard
        icon={<LinkOff sx={{ fontSize: 18 }} />}
        label="Uncorrelated accounts"
        value={fmt(kpi.unlinked)}
        hint={kpi.unlinkedPct != null ? `${pct(kpi.unlinkedPct)} of total` : undefined}
        accent={CORR.unlinked}
      />
      <KpiCard
        icon={<TrendingUp sx={{ fontSize: 18 }} />}
        label="Correlation success"
        value={pct(kpi.success)}
        hint={kpi.success != null ? 'Linked / (linked + unlinked)' : 'Run correlation to measure'}
        accent={CORR.linked}
      />
    </Stack>
  );
}

export function CorrelationFilters({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
}) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={1.25}
      alignItems={{ md: 'center' }}
      sx={{
        p: 1.25,
        borderRadius: 1.5,
        border: `1px solid ${palette.border.default}`,
        bgcolor: palette.bg.secondary,
      }}
    >
      <TextField
        size="small"
        placeholder="Search applications…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        sx={{ flex: 1, minWidth: 180 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 18, color: palette.text.disabled }} />
            </InputAdornment>
          ),
        }}
      />
      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel>Status</InputLabel>
        <Select
          label="Status"
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
        >
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="completed">Completed</MenuItem>
          <MenuItem value="never">Never run</MenuItem>
        </Select>
      </FormControl>
    </Stack>
  );
}

export function CorrelationAppCard({
  app,
  appTypeLabel,
  history,
  isRunning,
  correlateDisabled,
  onCorrelate,
}) {
  const navigate = useNavigate();
  const [menuEl, setMenuEl] = useState(null);
  const stats = getAppCorrelationStats(app, history);
  const rules = formatRuleChips(history);
  const lastRun = formatLastRun(history?.timestamp);
  const barDenom = stats.linked + stats.unlinked;
  const linkedPct = stats.hasRun && barDenom > 0 ? (stats.linked / barDenom) * 100 : 0;
  const unlinkedPct = stats.hasRun && barDenom > 0 ? (stats.unlinked / barDenom) * 100 : 0;

  useEffect(() => {
    if (isRunning) setMenuEl(null);
  }, [isRunning]);

  return (
    <Paper
      elevation={0}
      sx={{
        px: 1.75,
        py: 1.35,
        borderRadius: 1.75,
        border: `1px solid ${isRunning ? alpha(palette.brand.primary, 0.35) : palette.border.default}`,
        bgcolor: palette.bg.secondary,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexWrap: { xs: 'wrap', lg: 'nowrap' },
        }}
      >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 168, flex: '0 1 200px' }}>
        <AppIcon app={app} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 800, color: palette.text.primary, lineHeight: 1.2 }} noWrap>
            {app.name}
          </Typography>
          <Typography variant="caption" sx={{ color: palette.text.secondary, textTransform: 'capitalize' }}>
            {appTypeLabel}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ flex: '1 1 200px', minWidth: 160 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, color: palette.text.secondary, display: 'block', mb: 0.5 }}>
          Match rule
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.35 }}>
          {rules.length ? (
            rules.map((r) => (
              <Chip
                key={r}
                size="small"
                label={r}
                sx={{
                  height: 22,
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  fontFamily: 'ui-monospace, monospace',
                  bgcolor: palette.bg.elevated,
                  border: `1px solid ${palette.border.default}`,
                }}
              />
            ))
          ) : (
            <Typography variant="caption" color="text.disabled">Not configured</Typography>
          )}
        </Box>
        <Typography variant="caption" color="text.secondary">
          {isRunning ? 'Correlation in progress…' : (lastRun ? `Last run: ${lastRun}` : 'No correlation run yet')}
        </Typography>
      </Box>

      <Box sx={{ flex: '1 1 220px', minWidth: 180 }}>
        <Stack direction="row" spacing={2} sx={{ mb: 0.75 }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.1 }}>Linked</Typography>
            <Typography variant="body2" sx={{ fontWeight: 800, color: CORR.linkedMuted, lineHeight: 1.2 }}>
              {stats.linked.toLocaleString()}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.1 }}>Unlinked</Typography>
            <Typography variant="body2" sx={{ fontWeight: 800, color: CORR.unlinked, lineHeight: 1.2 }}>
              {stats.unlinked.toLocaleString()}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.1 }}>Total</Typography>
            <Typography variant="body2" sx={{ fontWeight: 800, color: palette.text.primary, lineHeight: 1.2 }}>
              {stats.total.toLocaleString()}
            </Typography>
          </Box>
        </Stack>
        <Box
          sx={{
            height: 8,
            borderRadius: 99,
            bgcolor: CORR.track,
            overflow: 'hidden',
            display: 'flex',
          }}
        >
          {stats.hasRun ? (
            <>
              <Box
                sx={{
                  width: `${linkedPct}%`,
                  background: CORR.linkedGradient,
                  bgcolor: CORR.linked,
                  minWidth: stats.linked > 0 ? 4 : 0,
                }}
              />
              <Box sx={{ width: `${unlinkedPct}%`, bgcolor: CORR.unlinked, minWidth: stats.unlinked > 0 ? 4 : 0 }} />
            </>
          ) : null}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: '0 0 auto', ml: { lg: 'auto' } }}>
        <Box sx={{ textAlign: 'right', minWidth: 88 }}>
          <Typography variant="body2" sx={{ fontWeight: 800, color: palette.text.primary, lineHeight: 1.2, mb: 0.35 }}>
            {stats.successPct != null ? `${stats.successPct.toFixed(1)}%` : '—'}
          </Typography>
          <StatusBadge status={stats.status} isRunning={isRunning} />
        </Box>
        <IconButton size="small" onClick={(e) => setMenuEl(e.currentTarget)} aria-label="More actions" disabled={isRunning}>
          <MoreVert fontSize="small" />
        </IconButton>
        <Menu anchorEl={menuEl} open={Boolean(menuEl)} onClose={() => setMenuEl(null)}>
          <MenuItem
            onClick={() => {
              setMenuEl(null);
              onCorrelate(app);
            }}
            disabled={correlateDisabled}
          >
            <ListItemIcon>
              <PlayArrow fontSize="small" />
            </ListItemIcon>
            <ListItemText>Correlate</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenuEl(null);
              navigate(`/applications/${app._id}`);
            }}
          >
            <ListItemIcon><OpenInNew fontSize="small" /></ListItemIcon>
            <ListItemText>Open application</ListItemText>
          </MenuItem>
        </Menu>
      </Box>
      </Box>
      {isRunning ? (
        <Box sx={{ mt: 1.25, pt: 1.15, borderTop: `1px solid ${palette.border.default}` }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
            <CircularProgress size={14} thickness={5} />
            <Typography variant="caption" sx={{ fontWeight: 700, color: palette.brand.primary }}>
              Matching identities to {app.name} accounts
            </Typography>
          </Stack>
          <LinearProgress
            sx={{
              height: 6,
              borderRadius: 99,
              bgcolor: alpha(palette.brand.primary, 0.12),
              '& .MuiLinearProgress-bar': { borderRadius: 99 },
            }}
          />
        </Box>
      ) : null}
    </Paper>
  );
}

export function CorrelationHealthSidebar({ apps, scanHistory }) {
  const { linked, unlinked, success, topUnlinked, recent } = useMemo(() => {
    let linkedSum = 0;
    let unlinkedSum = 0;
    const withStats = apps.map((app) => {
      const s = getAppCorrelationStats(app, scanHistory[app._id]);
      return { app, ...s, timestamp: scanHistory[app._id]?.timestamp || null };
    });
    for (const row of withStats) {
      if (!row.hasRun) continue;
      linkedSum += row.linked;
      unlinkedSum += row.unlinked;
    }
    const denom = linkedSum + unlinkedSum;
    const successPct = denom > 0 ? (linkedSum / denom) * 100 : null;
    const top = [...withStats]
      .filter((r) => r.unlinked > 0)
      .sort((a, b) => b.unlinked - a.unlinked)
      .slice(0, 5);
    const recentRuns = [...withStats]
      .filter((r) => r.timestamp)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 5);
    return {
      linked: linkedSum,
      unlinked: unlinkedSum,
      success: successPct,
      topUnlinked: top,
      recent: recentRuns,
    };
  }, [apps, scanHistory]);

  const pieData = [
    { name: 'Linked', value: linked, color: CORR.linked },
    { name: 'Unlinked', value: unlinked, color: CORR.unlinked },
  ].filter((d) => d.value > 0);

  return (
    <Stack spacing={1.5} sx={{ width: '100%' }}>
      <Paper
        elevation={0}
        sx={{ p: 1.75, borderRadius: 1.75, border: `1px solid ${palette.border.default}`, bgcolor: palette.bg.secondary }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>Correlation health</Typography>
        <Box sx={{ height: 160, position: 'relative' }}>
          {pieData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={68}
                  paddingAngle={2}
                  stroke="none"
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="body2" color="text.secondary">No run data yet</Typography>
            </Box>
          )}
          {success != null ? (
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
              <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', lineHeight: 1.1 }}>
                {success.toFixed(1)}%
              </Typography>
              <Typography variant="caption" color="text.secondary">Success</Typography>
            </Box>
          ) : null}
        </Box>
        <Stack spacing={0.75} sx={{ mt: 0.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: CORR.linked }} />
              Linked
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>{linked.toLocaleString()}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: CORR.unlinked }} />
              Unlinked
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>{unlinked.toLocaleString()}</Typography>
          </Box>
          <Divider sx={{ my: 0.25 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">Total reviewed</Typography>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {(linked + unlinked).toLocaleString()}
            </Typography>
          </Box>
        </Stack>
      </Paper>

      <Paper
        elevation={0}
        sx={{ p: 1.75, borderRadius: 1.75, border: `1px solid ${palette.border.default}`, bgcolor: palette.bg.secondary }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>Uncorrelated accounts</Typography>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>{unlinked.toLocaleString()}</Typography>
        {topUnlinked.length === 0 ? (
          <Typography variant="caption" color="text.secondary">No unlinked accounts from recent runs.</Typography>
        ) : (
          <Stack spacing={0.85}>
            {topUnlinked.map((row) => (
              <Box key={row.app._id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AppIcon app={row.app} size={24} />
                <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }} noWrap>{row.app.name}</Typography>
                <Typography variant="caption" sx={{ fontWeight: 800, color: palette.text.primary }}>
                  {row.unlinked.toLocaleString()}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Paper>

      <Paper
        elevation={0}
        sx={{ p: 1.75, borderRadius: 1.75, border: `1px solid ${palette.border.default}`, bgcolor: palette.bg.secondary }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>Recent correlation runs</Typography>
        {recent.length === 0 ? (
          <Typography variant="caption" color="text.secondary">No runs yet.</Typography>
        ) : (
          <Stack spacing={1}>
            {recent.map((row) => (
              <Box key={row.app._id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AppIcon app={row.app} size={24} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{row.app.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatLastRun(row.timestamp)}
                  </Typography>
                </Box>
                <StatusBadge status={row.status} />
              </Box>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
