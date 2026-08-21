/**
 * Peer access comparison panel bound to a specific identity (no picker).
 * Used by the identity catalog Peer Comparison tab.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Paper, Grid, Chip, CircularProgress,
  TextField, Select, MenuItem, FormControl,
  Divider, Alert, Tooltip, IconButton, Collapse, LinearProgress,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Avatar, Snackbar,
} from '@mui/material';
import {
  CompareArrows, ExpandMore, ExpandLess,
  CheckCircle, Warning, ErrorOutline, Download,
  FilterAlt, People, InfoOutlined,
} from '@mui/icons-material';
import { identityAPI, applicationAPI } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { palette } from '../../../theme/palette';
import { identityCatalogPath, CATALOG_TAB_IDS } from './identityCatalogTabs';
import ExcelJS from 'exceljs';

/* ── Constants ─────────────────────────────────────────────────── */

const THRESHOLD_MODES = [
  { value: 'baseline',   label: 'Role baseline (65%)',    threshold: 0.65 },
  { value: 'majority',   label: 'Majority (50%)',         threshold: 0.5 },
  { value: 'consensus',  label: 'Strong consensus (75%)', threshold: 0.75 },
  { value: 'strict',     label: 'Strict (100%)',          threshold: 1.0 },
  { value: 'custom',     label: 'Custom…',                threshold: null },
];

const RISK_CONFIG = {
  HIGH:   { color: '#ef4444', bg: '#fef2f2', label: 'High' },
  MEDIUM: { color: '#f59e0b', bg: '#fffbeb', label: 'Medium' },
  LOW:    { color: '#22c55e', bg: '#f0fdf4', label: 'Low' },
};

const BASELINE_CONFIDENCE_CONFIG = {
  HIGH:   { color: '#166534', bg: '#dcfce7', label: 'High confidence' },
  MEDIUM: { color: '#1d4ed8', bg: '#dbeafe', label: 'Medium confidence' },
  LOW:    { color: '#b45309', bg: '#fef3c7', label: 'Low confidence' },
};

const COL_CONFIG = {
  normal: {
    color: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0',
    icon: <CheckCircle sx={{ fontSize: 16 }} />,
    label: 'Normal Access',
    tooltip: 'Access commonly assigned to users in similar roles — this user has it and peers usually do too.',
    emptyMsg: 'No access aligned with the peer baseline yet.',
  },
  unusual: {
    color: '#f59e0b', bg: '#fffbeb', border: '#fde68a',
    icon: <Warning sx={{ fontSize: 16 }} />,
    label: 'Unusual Access',
    tooltip: 'Access assigned to this user but uncommon among peers — access uncommon for similar users.',
    emptyMsg: 'No unusual access detected. This user aligns with typical peer patterns.',
  },
  recommendedMissing: {
    color: '#ef4444', bg: '#fef2f2', border: '#fecaca',
    icon: <ErrorOutline sx={{ fontSize: 16 }} />,
    label: 'Recommended Access Missing',
    tooltip: 'Access commonly assigned to peers but missing for this user — common peer access not assigned.',
    emptyMsg: 'No common peer access is missing for this user.',
  },
};

function comparisonRows(comparison) {
  if (!comparison) return { normal: [], unusual: [], recommendedMissing: [] };
  return {
    normal: comparison.normal || comparison.match || [],
    unusual: comparison.unusual || comparison.excess || [],
    recommendedMissing: comparison.recommendedMissing || comparison.missing || [],
  };
}

/* ── Sub-components ────────────────────────────────────────────── */

function RiskChip({ level }) {
  const cfg = RISK_CONFIG[level] || RISK_CONFIG.LOW;
  return (
    <Chip
      label={level}
      size="small"
      sx={{
        bgcolor: cfg.bg, color: cfg.color,
        fontWeight: 700, fontSize: '0.62rem',
        height: 18, border: `1px solid ${cfg.color}33`,
      }}
    />
  );
}

function CoverageBar({ pct, peersWithAccess, peerGroupSize }) {
  const color = pct >= 75 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
  const hasCount =
    peersWithAccess != null &&
    peerGroupSize != null &&
    Number.isFinite(Number(peersWithAccess)) &&
    Number.isFinite(Number(peerGroupSize)) &&
    Number(peerGroupSize) > 0;
  const countLabel = hasCount
    ? `${Number(peersWithAccess)} of ${Number(peerGroupSize)}`
    : null;
  const tip = hasCount
    ? `${pct}% of peers hold this entitlement (${countLabel})`
    : `${pct}% of peers hold this entitlement`;

  return (
    <Tooltip title={tip} arrow>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35, minWidth: 118 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LinearProgress
            variant="determinate"
            value={Math.min(Math.max(Number(pct) || 0, 0), 100)}
            sx={{
              flex: 1, height: 5, borderRadius: 3,
              bgcolor: `${color}22`,
              '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 3 },
            }}
          />
          <Typography variant="caption" sx={{ fontWeight: 700, color, minWidth: 32, textAlign: 'right' }}>
            {pct}%
          </Typography>
        </Box>
        {countLabel && (
          <Typography variant="caption" sx={{ fontSize: '0.62rem', color: 'text.secondary', fontWeight: 600, lineHeight: 1.2 }}>
            {countLabel} peers
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
}

function BaselineConfidenceChip({ level }) {
  const cfg = BASELINE_CONFIDENCE_CONFIG[level] || BASELINE_CONFIDENCE_CONFIG.MEDIUM;
  return (
    <Chip
      label={cfg.label}
      size="small"
      sx={{
        bgcolor: cfg.bg, color: cfg.color, fontWeight: 700, fontSize: '0.62rem', height: 20,
        border: `1px solid ${cfg.color}33`,
      }}
    />
  );
}

function SectionHeader({ title, subtitle, tooltip, count, accentColor }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', color: accentColor || 'text.primary' }}>
          {title}
        </Typography>
        {tooltip && (
          <Tooltip title={tooltip} arrow placement="top">
            <IconButton size="small" sx={{ p: 0.25, color: 'text.secondary' }}>
              <InfoOutlined sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
        {count != null && (
          <Chip label={count} size="small" sx={{ height: 20, fontWeight: 800, fontSize: '0.7rem' }} />
        )}
      </Box>
      {subtitle && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
          {subtitle}
        </Typography>
      )}
    </Box>
  );
}

function EntitlementTable({ rows, emptyMsg, showBaselineConfidence = false, showSource = true }) {
  if (!rows.length) {
    return (
      <Typography variant="body2" color="text.disabled" sx={{ py: 3, textAlign: 'center', fontStyle: 'italic' }}>
        {emptyMsg}
      </Typography>
    );
  }
  const headers = ['Application', 'Entitlement', 'Peer Coverage', 'Risk Level'];
  if (showBaselineConfidence) headers.push('Baseline Confidence');
  if (showSource) headers.push('Source');

  return (
    <TableContainer sx={{ maxHeight: 420 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {headers.map((h) => (
              <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem', bgcolor: '#f8fafc', py: 1 }}>{h}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i} hover sx={{ '&:nth-of-type(even)': { bgcolor: '#fafafa' } }}>
              <TableCell sx={{ fontSize: '0.75rem', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Tooltip title={r.application}><span>{r.application}</span></Tooltip>
              </TableCell>
              <TableCell sx={{ fontSize: '0.78rem', fontWeight: 500, maxWidth: 220, wordBreak: 'break-word' }}>
                {r.entitlement}
              </TableCell>
              <TableCell sx={{ minWidth: 130 }}>
                <CoverageBar
                  pct={r.peerCoverage}
                  peersWithAccess={r.peersWithAccess}
                  peerGroupSize={r.peerGroupSize}
                />
              </TableCell>
              <TableCell><RiskChip level={r.riskLevel} /></TableCell>
              {showBaselineConfidence && (
                <TableCell><BaselineConfidenceChip level={r.baselineConfidence} /></TableCell>
              )}
              {showSource && (
                <TableCell>
                  <Tooltip title={r.dataSource === 'correlated' ? 'From entitlement correlation' : 'From account data (run correlation for richer results)'}>
                    <Chip
                      label={r.dataSource === 'correlated' ? 'Correlated' : r.dataSource === 'raw_field' ? 'Account data' : 'Mixed'}
                      size="small"
                      sx={{
                        height: 18, fontSize: '0.6rem', fontWeight: 700,
                        bgcolor: r.dataSource === 'correlated' ? '#eff6ff' : '#fafafa',
                        color: r.dataSource === 'correlated' ? '#2563eb' : '#64748b',
                      }}
                    />
                  </Tooltip>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function DeviationSection({ type, rows }) {
  const cfg = COL_CONFIG[type];
  return (
    <Paper
      elevation={0}
      sx={{
        border: `1.5px solid ${cfg.border}`,
        borderRadius: 2,
        overflow: 'hidden',
        mb: 2.5,
      }}
    >
      <Box sx={{ bgcolor: cfg.bg, px: 2.5, py: 2, borderBottom: `1px solid ${cfg.border}` }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ color: cfg.color, display: 'flex', mt: 0.25 }}>{cfg.icon}</Box>
          <Box sx={{ flex: 1 }}>
            <SectionHeader
              title={cfg.label}
              tooltip={cfg.tooltip}
              count={rows.length}
              accentColor={cfg.color}
            />
          </Box>
        </Box>
      </Box>
      <Box sx={{ p: 2 }}>
        <EntitlementTable rows={rows} emptyMsg={cfg.emptyMsg} showSource />
      </Box>
    </Paper>
  );
}

function PeerBaselineSummaryBanner({ summary, thresholdPercent }) {
  const baseline = summary?.baselineCount ?? summary?.matchCount ?? 0;
  const aligned = summary?.alignedCount ?? summary?.matchCount ?? 0;
  const unusual = summary?.unusualCount ?? summary?.excessCount ?? 0;
  const missing = summary?.recommendedMissingCount ?? summary?.missingCount ?? 0;

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.5, mb: 3, borderRadius: 2,
        border: '1.5px solid #bfdbfe',
        bgcolor: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
        background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
      }}
    >
      <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', mb: 1.5, color: '#1e40af' }}>
        Peer baseline summary
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Compared using a {thresholdPercent ?? 65}% peer coverage threshold — only access held by at least that share of
        similar users counts as expected baseline access.
      </Typography>
      <Grid container spacing={2}>
        {[
          { value: baseline, label: 'expected entitlements in peer baseline', color: '#1d4ed8' },
          { value: aligned, label: 'aligned with peer baseline (normal access)', color: '#166534' },
          { value: unusual, label: 'unusual entitlement(s) detected', color: '#b45309' },
          { value: missing, label: 'recommended entitlement(s) missing', color: '#b91c1c' },
        ].map((item) => (
          <Grid item xs={12} sm={6} md={3} key={item.label}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '1.75rem', lineHeight: 1, color: item.color }}>
                {item.value}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                {item.label}
              </Typography>
            </Box>
          </Grid>
        ))}
      </Grid>
    </Paper>
  );
}

function PeerGroupGrid({ peers, totalCount, onPeerClick }) {
  if (!peers?.length) return null;

  return (
    <Box>
      <SectionHeader
        title={`Peer group (${totalCount ?? peers.length})`}
        subtitle="Similar users in the same department and role used to establish the access baseline."
        tooltip="Peers are identities with matching department and job title. Comparison results are based on entitlements across this group."
      />
      <Grid container spacing={1.5}>
        {peers.map((p) => {
          const name = p.displayName || p.email || 'Unknown';
          const initial = name.charAt(0).toUpperCase();
          return (
            <Grid item xs={12} sm={6} md={4} lg={3} key={p.id}>
              <Box
                role="button"
                tabIndex={0}
                onClick={() => onPeerClick(p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onPeerClick(p.id);
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  px: 1.5,
                  py: 1.25,
                  borderRadius: 1.5,
                  border: '1px solid #e2e8f0',
                  bgcolor: '#fff',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, box-shadow 0.15s, background-color 0.15s',
                  '&:hover': {
                    borderColor: '#93c5fd',
                    bgcolor: '#f8fafc',
                    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
                  },
                  '&:focus-visible': {
                    outline: '2px solid #2563eb',
                    outlineOffset: 2,
                  },
                }}
              >
                <Avatar
                  sx={{
                    width: 32,
                    height: 32,
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    bgcolor: '#e0e7ff',
                    color: '#3730a3',
                  }}
                >
                  {initial}
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={name}
                  >
                    {name}
                  </Typography>
                  {p.email && p.email !== name && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={p.email}
                    >
                      {p.email}
                    </Typography>
                  )}
                </Box>
              </Box>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}

function ConfidenceBadge({ level, peerCount }) {
  const map = {
    NONE:   { color: '#ef4444', label: 'No peers' },
    LOW:    { color: '#f59e0b', label: 'Low confidence' },
    MEDIUM: { color: '#3b82f6', label: 'Medium confidence' },
    HIGH:   { color: '#22c55e', label: 'High confidence' },
  };
  const cfg = map[level] || map.HIGH;
  return (
    <Chip
      icon={<InfoOutlined sx={{ fontSize: 14, color: cfg.color + ' !important' }} />}
      label={`${cfg.label} (${peerCount} peer${peerCount !== 1 ? 's' : ''})`}
      size="small"
      variant="outlined"
      sx={{ borderColor: cfg.color, color: cfg.color, fontWeight: 600, fontSize: '0.72rem' }}
    />
  );
}

/* ── Bound panel ───────────────────────────────────────────────── */

export default function PeerComparisonPanel({ identity }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const identityId = identity?._id || identity?.id || null;

  // Parameters
  const [mode, setMode] = useState('baseline');
  const [customThreshold, setCustomThreshold] = useState(65);
  const [applicationIds, setApplicationIds] = useState([]);
  const [apps, setApps] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [filterLocation, setFilterLocation] = useState('');
  const [minPeers, setMinPeers] = useState(3);

  // Results — Unusual Access loads automatically on open
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(identity?._id || identity?.id));
  const [error, setError] = useState('');
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' });
  const [exporting, setExporting] = useState(false);
  /** Default results view: Unusual Access only (full report available via toggle). */
  const [resultView, setResultView] = useState('unusual');
  const requestGenRef = React.useRef(0);

  // Load apps list on mount
  useEffect(() => {
    if (!tenantId) return;
    applicationAPI.list({ tenantId, limit: 200 })
      .then((r) => setApps(r.data?.data || []))
      .catch(() => {});
  }, [tenantId]);

  const resolvedThreshold = () => {
    if (mode === 'custom') return customThreshold / 100;
    return THRESHOLD_MODES.find((m) => m.value === mode)?.threshold ?? 0.65;
  };

  const runComparison = async () => {
    if (!identityId) return;
    const gen = ++requestGenRef.current;
    setLoading(true);
    setError('');
    setResultView('unusual');
    try {
      const res = await identityAPI.peerComparison(identityId, {
        mode,
        threshold: resolvedThreshold(),
        applicationIds,
        minPeers,
        filters: { location: filterLocation || undefined },
      });
      if (gen !== requestGenRef.current) return;
      setResult(res.data?.data);
    } catch (err) {
      if (gen !== requestGenRef.current) return;
      setError(err.response?.data?.message || err.message || 'Comparison failed');
    } finally {
      if (gen === requestGenRef.current) setLoading(false);
    }
  };

  // Unusual Access loads first automatically when the tab opens for this identity
  useEffect(() => {
    if (!identityId) {
      requestGenRef.current += 1;
      setResult(null);
      setError('');
      setLoading(false);
      return undefined;
    }
    setResult(null);
    runComparison();
    return () => {
      requestGenRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-load on identity only; filters use Refresh
  }, [identityId]);

  const handleRun = () => runComparison();

  const handleExport = async () => {
    if (!result) return;
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const addSheet = (name, rows, extraCols = []) => {
        const ws = wb.addWorksheet(name);
        ws.addRow([
          'Application',
          'Entitlement',
          'Peer Coverage %',
          'Peers with access',
          'Peer group size',
          'Risk Level',
          ...extraCols,
        ]);
        ws.getRow(1).font = { bold: true };
        rows.forEach((r) => {
          const extra = extraCols.map((col) => {
            if (col === 'Baseline Confidence') return r.baselineConfidence || '';
            return '';
          });
          ws.addRow([
            r.application,
            r.entitlement,
            r.peerCoverage,
            r.peersWithAccess ?? '',
            r.peerGroupSize ?? '',
            r.riskLevel,
            ...extra,
          ]);
        });
        ws.columns.forEach((c) => { c.width = 24; });
      };
      const rows = comparisonRows(result.comparison);
      addSheet('Peer Baseline', result.peerBaseline || [], ['Baseline Confidence']);
      addSheet('Normal Access', rows.normal);
      addSheet('Unusual Access', rows.unusual);
      addSheet('Recommended Missing', rows.recommendedMissing);

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `peer-comparison-${result.targetIdentity.displayName.replace(/\s+/g, '_')}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setToast({ open: true, message: 'Report exported!', severity: 'success' });
    } catch (err) {
      setToast({ open: true, message: 'Export failed: ' + err.message, severity: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const peerGroup = result?.peerGroup;
  const summary = result?.summary;
  const compRows = comparisonRows(result?.comparison);
  const peerBaseline = result?.peerBaseline || [];
  const thresholdPct = result?.parameters?.thresholdPercent ?? Math.round((result?.parameters?.threshold ?? 0.65) * 100);

  return (
    <Box sx={{ width: '100%' }}>
      {/* Slim actions — Unusual Access is primary; filters stay collapsed */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          size="small"
          startIcon={<FilterAlt sx={{ fontSize: 14 }} />}
          endIcon={showControls ? <ExpandLess sx={{ fontSize: 14 }} /> : <ExpandMore sx={{ fontSize: 14 }} />}
          onClick={() => setShowControls((p) => !p)}
          sx={{ textTransform: 'none', color: 'text.secondary', fontSize: '0.78rem' }}
        >
          Adjust comparison
        </Button>
        {result && (
          <Button
            variant="outlined"
            size="small"
            startIcon={exporting ? <CircularProgress size={13} /> : <Download />}
            onClick={handleExport}
            disabled={exporting}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Export Excel
          </Button>
        )}
      </Box>

      <Collapse in={showControls}>
        <Paper elevation={0} sx={{ p: 3, mb: 3, border: '1.5px solid #e2e8f0', borderRadius: 2 }}>
          <Grid container spacing={2} alignItems="flex-end">
            <Grid item xs={12} sm={6} md={4}>
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Peer baseline threshold
              </Typography>
              <FormControl fullWidth size="small">
                <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                  {THRESHOLD_MODES.map((m) => (
                    <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {mode === 'custom' && (
              <Grid item xs={12} sm={6} md={2}>
                <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'text.secondary', display: 'block', mb: 0.5 }}>
                  Custom %
                </Typography>
                <TextField
                  type="number" size="small" fullWidth
                  value={customThreshold}
                  onChange={(e) => setCustomThreshold(Math.min(100, Math.max(1, Number(e.target.value))))}
                  inputProps={{ min: 1, max: 100 }}
                />
              </Grid>
            )}

            <Grid item xs={12} sm={6} md={mode === 'custom' ? 6 : 8}>
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Applications (all if empty)
              </Typography>
              <FormControl fullWidth size="small">
                <Select
                  multiple value={applicationIds}
                  onChange={(e) => setApplicationIds(e.target.value)}
                  displayEmpty
                  renderValue={(sel) => sel.length === 0 ? <Typography color="text.disabled" variant="body2">All applications</Typography> : `${sel.length} selected`}
                >
                  {apps.map((a) => (
                    <MenuItem key={a._id} value={a._id}>{a.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>

          <Box sx={{ mt: 1.5, display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <Button
              size="small" startIcon={<FilterAlt sx={{ fontSize: 14 }} />}
              endIcon={showFilters ? <ExpandLess sx={{ fontSize: 14 }} /> : <ExpandMore sx={{ fontSize: 14 }} />}
              onClick={() => setShowFilters((p) => !p)}
              sx={{ textTransform: 'none', color: 'text.secondary', fontSize: '0.78rem' }}
            >
              Advanced Filters
            </Button>
            <Divider orientation="vertical" flexItem />
            <Button
              id="peer-comparison-run-btn"
              variant="contained"
              startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <CompareArrows />}
              onClick={handleRun}
              disabled={!identityId || loading}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, px: 3 }}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </Box>

          <Collapse in={showFilters}>
            <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #e2e8f0' }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Location filter" size="small" fullWidth
                    value={filterLocation}
                    onChange={(e) => setFilterLocation(e.target.value)}
                    placeholder="e.g. New York"
                    helperText="Only include peers from this location"
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Min. peer group size" size="small" fullWidth type="number"
                    value={minPeers}
                    onChange={(e) => setMinPeers(Math.max(1, parseInt(e.target.value) || 1))}
                    helperText="Warning shown if fewer peers"
                    inputProps={{ min: 1, max: 50 }}
                  />
                </Grid>
              </Grid>
            </Box>
          </Collapse>
        </Paper>
      </Collapse>

      {/* ── Loading (auto-load Unusual Access first) ── */}
      {loading && !result && (
        <Paper elevation={0} sx={{ p: 6, textAlign: 'center', border: '1.5px solid #e2e8f0', borderRadius: 2 }}>
          <CircularProgress size={36} sx={{ mb: 2 }} />
          <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 600 }}>
            Loading unusual access…
          </Typography>
        </Paper>
      )}

      {/* ── Empty state ── */}
      {!result && !loading && !error && (
        <Paper elevation={0} sx={{ p: 6, textAlign: 'center', border: '1.5px dashed #e2e8f0', borderRadius: 2 }}>
          <CompareArrows sx={{ fontSize: 56, color: '#cbd5e1', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 600 }}>
            No peer comparison data yet
          </Typography>
          <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
            Unusual access will appear here once peers are available for this identity.
          </Typography>
        </Paper>
      )}

      {/* ── Error ── */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>{error}</Alert>
      )}

      {/* ── Results (Unusual Access first) ── */}
      {result && (
        <Box>
          {/* Identity + Peer info banner */}
          <Paper elevation={0} sx={{ p: 2.5, mb: 3, border: '1.5px solid #e2e8f0', borderRadius: 2, display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Avatar sx={{ bgcolor: palette.brand?.primary || '#1976d2', width: 40, height: 40, fontSize: '1rem', fontWeight: 700 }}>
                {(result.targetIdentity.displayName || 'U').charAt(0).toUpperCase()}
              </Avatar>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: '0.95rem' }}>{result.targetIdentity.displayName}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {[result.targetIdentity.title, result.targetIdentity.department].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
            </Box>
            <Divider orientation="vertical" flexItem />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <People sx={{ color: 'text.secondary', fontSize: 18 }} />
              <ConfidenceBadge level={peerGroup.confidence} peerCount={peerGroup.count} />
            </Box>
            {peerGroup.lowConfidence && (
              <Alert severity="warning" icon={<InfoOutlined fontSize="small" />} sx={{ py: 0, px: 1.5, flex: 1 }}>
                <Typography variant="caption">
                  Peer group is small ({peerGroup.count} peer{peerGroup.count !== 1 ? 's' : ''}) — results may be less statistically reliable.
                </Typography>
              </Alert>
            )}
            {peerGroup.capped && (
              <Chip label={`Capped at ${peerGroup.maxScanned} peers`} size="small" color="info" variant="outlined" />
            )}
            {result.dataSourceSummary && (
              <Tooltip title={
                result.dataSourceSummary.quality === 'full_correlation'
                  ? 'All entitlements sourced from the Entitlement Correlation Engine — highest accuracy.'
                  : result.dataSourceSummary.quality === 'partial_correlation'
                    ? `${result.dataSourceSummary.fromCorrelationEngine} correlated, ${result.dataSourceSummary.fromRawFields} from raw fields. Run the correlation engine on remaining apps for full accuracy.`
                    : 'No correlation engine results found. Run the Entitlement Correlation Engine per application for richer data.'
              }>
                <Chip
                  icon={<InfoOutlined sx={{ fontSize: 13, color: (result.dataSourceSummary.quality === 'full_correlation' ? '#2563eb' : result.dataSourceSummary.quality === 'partial_correlation' ? '#d97706' : '#64748b') + ' !important' }} />}
                  label={
                    result.dataSourceSummary.quality === 'full_correlation' ? 'Full correlation data'
                    : result.dataSourceSummary.quality === 'partial_correlation' ? 'Partial correlation'
                    : 'Raw fields only'
                  }
                  size="small"
                  variant="outlined"
                  sx={{
                    borderColor: result.dataSourceSummary.quality === 'full_correlation' ? '#bfdbfe' : result.dataSourceSummary.quality === 'partial_correlation' ? '#fde68a' : '#e2e8f0',
                    color: result.dataSourceSummary.quality === 'full_correlation' ? '#2563eb' : result.dataSourceSummary.quality === 'partial_correlation' ? '#d97706' : '#64748b',
                    fontSize: '0.72rem', fontWeight: 600,
                  }}
                />
              </Tooltip>
            )}
          </Paper>

          <Box sx={{ display: 'flex', gap: 1, mb: 2.5, flexWrap: 'wrap' }}>
            {[
              { id: 'unusual', label: 'Unusual Access', count: compRows.unusual.length },
              { id: 'full', label: 'Full comparison' },
            ].map((opt) => (
              <Chip
                key={opt.id}
                label={opt.count != null ? `${opt.label} (${opt.count})` : opt.label}
                clickable
                onClick={() => setResultView(opt.id)}
                color={resultView === opt.id ? 'primary' : 'default'}
                variant={resultView === opt.id ? 'filled' : 'outlined'}
                sx={{ fontWeight: 700, fontSize: '0.75rem' }}
              />
            ))}
          </Box>

          {resultView === 'unusual' ? (
            <DeviationSection type="unusual" rows={compRows.unusual} />
          ) : (
            <>
              <Paper elevation={0} sx={{ p: 2.5, mb: 3, border: '1.5px solid #93c5fd', borderRadius: 2, bgcolor: '#f8fafc' }}>
                <SectionHeader
                  title="Peer Baseline Access"
                  subtitle="Users with a similar department and role typically have the following access. This is the expected access model for comparison."
                  tooltip="Answers: what access should this identity normally have based on peers? Only entitlements held by at least the selected % of peers appear here."
                  count={peerBaseline.length}
                  accentColor="#1e40af"
                />
                <EntitlementTable
                  rows={peerBaseline}
                  emptyMsg="No peer baseline entitlements met the coverage threshold. Try a lower threshold or expand the peer group."
                  showBaselineConfidence
                  showSource
                />
              </Paper>

              <PeerBaselineSummaryBanner summary={summary} thresholdPercent={thresholdPct} />

              <Paper elevation={0} sx={{ p: 2.5, mb: 2.5, border: `1.5px solid ${COL_CONFIG.normal.border}`, borderRadius: 2 }}>
                <SectionHeader
                  title={COL_CONFIG.normal.label}
                  subtitle="Access this user has that matches what peers commonly hold."
                  tooltip={COL_CONFIG.normal.tooltip}
                  count={compRows.normal.length}
                  accentColor={COL_CONFIG.normal.color}
                />
                <EntitlementTable rows={compRows.normal} emptyMsg={COL_CONFIG.normal.emptyMsg} showSource />
              </Paper>

              <DeviationSection type="unusual" rows={compRows.unusual} />
              <DeviationSection type="recommendedMissing" rows={compRows.recommendedMissing} />

              {peerGroup.peers.length > 0 && (
                <Paper elevation={0} sx={{ mt: 3, p: 2.5, border: '1px solid #e2e8f0', borderRadius: 2 }}>
                  <PeerGroupGrid
                    peers={peerGroup.peers}
                    totalCount={peerGroup.count}
                    onPeerClick={(id) => navigate(identityCatalogPath(id, CATALOG_TAB_IDS.OVERVIEW))}
                  />
                </Paper>
              )}
            </>
          )}
        </Box>
      )}

      {/* Toast */}
      <Snackbar
        open={toast.open} autoHideDuration={5000}
        onClose={() => setToast((p) => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={toast.severity} variant="filled" onClose={() => setToast((p) => ({ ...p, open: false }))}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
