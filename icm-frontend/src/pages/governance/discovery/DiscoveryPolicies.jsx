import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  alpha,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  LinearProgress,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add,
  ContentCopy,
  DeleteForever,
  Edit,
  MoreVert,
  PlayArrow,
  Search,
  TrendingUp,
  FiberManualRecord,
  VpnKey,
  PersonSearch,
  Dns,
  Refresh,
} from '@mui/icons-material';
import { palette } from '../../../theme/palette';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import { discoveryAPI } from '../../../services/discoveryService';
import { useAuth } from '../../../contexts/AuthContext';

/* ── Map URL slug → backend type ─────────────────────────────────── */
const SLUG_MAP = {
  'privileged-entitlement': { type: 'ENTITLEMENT', label: 'Privileged Entitlement', desc: 'Detect entitlements that grant elevated or sensitive access across applications.', icon: <VpnKey />, color: '#7C3AED' },
  'privileged-user': { type: 'USER', label: 'Privileged User', desc: 'Discover user accounts with admin-level, service, or privileged access patterns.', icon: <PersonSearch />, color: '#2563EB' },
  'ad-group': { type: 'AD_GROUP', label: 'AD Group Based Application', desc: 'Identify Active Directory groups that provide elevated access to applications.', icon: <Dns />, color: '#0891B2' },
};

/* ═══════════════════════════════════════════════════════════════════ */
export default function DiscoveryPolicies() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { enqueueSnackbar } = useSnackbar();

  // Derive type from URL path
  const slug = location.pathname.split('/').pop();
  const meta = SLUG_MAP[slug] || SLUG_MAP['privileged-entitlement'];
  const policyType = meta.type;

  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState([]);
  const [error, setError] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  // Evaluation
  const [evalUi, setEvalUi] = useState({ running: false, policyId: null });
  const [evalTick, setEvalTick] = useState(0);

  // Action menu
  const [actionAnchorEl, setActionAnchorEl] = useState(null);
  const [actionPolicy, setActionPolicy] = useState(null);

  useEffect(() => {
    if (!evalUi.running) return;
    setEvalTick(0);
    const t = setInterval(() => setEvalTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [evalUi.running]);

  useEffect(() => {
    if (!searchQ.trim()) { setDebouncedQ(''); return; }
    const t = setTimeout(() => setDebouncedQ(searchQ), 320);
    return () => clearTimeout(t);
  }, [searchQ]);

  /* ── Load policies of this type ────────────────────────────────── */
  const loadPolicies = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const res = await discoveryAPI.listPolicies({
        page: 1,
        limit: 200,
        type: policyType,
        ...(debouncedQ.trim() ? { search: debouncedQ.trim() } : {}),
      });
      const d = res.data?.data || {};
      setPolicies(d.items || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load policies.');
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, [policyType, debouncedQ]);

  useEffect(() => { loadPolicies(); }, [loadPolicies]);

  /* ── Actions ──────────────────────────────────────────────────── */
  const handleDelete = async (p) => {
    if (!p?._id || !window.confirm(`Delete policy "${p.name}"? All results will be removed.`)) return;
    try {
      await discoveryAPI.deletePolicy(p._id);
      enqueueSnackbar('Policy deleted', { variant: 'success' });
      loadPolicies();
    } catch (e) {
      setError(e.response?.data?.message || 'Delete failed.');
    }
  };

  const handleClone = async (p) => {
    if (!p?._id) return;
    try {
      await discoveryAPI.clonePolicy(p._id);
      enqueueSnackbar('Policy cloned', { variant: 'success' });
      loadPolicies();
    } catch (e) {
      setError(e.response?.data?.message || 'Clone failed.');
    }
  };

  const handleEvaluate = async (p) => {
    if (evalUi.running) return;
    setEvalUi({ running: true, policyId: p._id });
    try {
      const res = await discoveryAPI.evaluatePolicy(p._id);
      const d = res.data?.data || {};
      enqueueSnackbar(`Matched ${d.matched ?? 0} of ${d.total ?? 0} entities`, { variant: 'success' });
      loadPolicies();
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Evaluation failed.', { variant: 'error' });
    } finally {
      setEvalUi({ running: false, policyId: null });
    }
  };

  const handleEvaluateAll = async () => {
    if (evalUi.running) return;
    setEvalUi({ running: true, policyId: 'all' });
    try {
      const res = await discoveryAPI.evaluateAll();
      const d = res.data?.data || {};
      enqueueSnackbar(`Evaluated ${d.policiesEvaluated ?? 0} policies. Total matches: ${d.totalMatched ?? 0}`, { variant: 'success' });
      loadPolicies();
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Evaluation failed.', { variant: 'error' });
    } finally {
      setEvalUi({ running: false, policyId: null });
    }
  };

  const closeMenu = () => { setActionAnchorEl(null); setActionPolicy(null); };

  /* ── Stats ──────────────────────────────────────────────────────── */
  const totalPolicies = policies.length;
  const totalMatches = policies.reduce((sum, p) => sum + (p.totalMatches || 0), 0);

  /* ── Filtered list ──────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    if (!debouncedQ.trim()) return policies;
    const q = debouncedQ.toLowerCase();
    return policies.filter((p) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.applicationName || '').toLowerCase().includes(q) ||
      (p.policyId || '').toLowerCase().includes(q)
    );
  }, [policies, debouncedQ]);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
      {/* ── Header ── */}
      <Box sx={{ mb: 4 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
          <Avatar sx={{ bgcolor: alpha(meta.color, 0.12), color: meta.color, width: 44, height: 44 }}>
            {meta.icon}
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em', color: 'text.primary' }}>
              {meta.label}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560 }}>
              {meta.desc}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={evalUi.running && evalUi.policyId === 'all' ? <CircularProgress size={16} /> : <PlayArrow />}
              onClick={handleEvaluateAll}
              disabled={evalUi.running || totalPolicies === 0}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              {evalUi.running && evalUi.policyId === 'all' ? 'Running…' : 'Run All'}
            </Button>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => navigate(`/governance/discovery/${slug}/new`)}
              sx={{ textTransform: 'none', fontWeight: 700, bgcolor: meta.color, '&:hover': { bgcolor: alpha(meta.color, 0.85) } }}
            >
              Create Policy
            </Button>
          </Stack>
        </Stack>

        {/* Evaluation progress */}
        {evalUi.running && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {evalUi.policyId === 'all' ? 'Evaluating all policies' : 'Evaluating policy'} • {evalTick}s
            </Typography>
            <LinearProgress sx={{ mt: 0.5, borderRadius: 4, height: 3, '& .MuiLinearProgress-bar': { bgcolor: meta.color } }} />
          </Box>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ── Quick Stats ── */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'Total Policies', value: totalPolicies, color: meta.color },
          { label: 'Total Detected', value: totalMatches, color: palette.status.error },
        ].map((stat) => (
          <Grid item xs={12} sm={6} key={stat.label}>
            <Paper
              sx={{
                p: 2.5,
                borderRadius: 3,
                border: '1px solid',
                borderColor: alpha(stat.color, 0.15),
                background: `linear-gradient(135deg, ${alpha(stat.color, 0.03)}, ${alpha(stat.color, 0.08)})`,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Box
                sx={{
                  width: 48, height: 48, borderRadius: '14px',
                  bgcolor: alpha(stat.color, 0.12),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <TrendingUp sx={{ color: stat.color, fontSize: 24 }} />
              </Box>
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {stat.label}
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 800, color: stat.color, lineHeight: 1.1 }}>
                  {stat.value}
                </Typography>
              </Box>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {/* ── Search ── */}
      <TextField
        size="small"
        placeholder="Search policies…"
        value={searchQ}
        onChange={(e) => setSearchQ(e.target.value)}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" sx={{ color: 'text.secondary' }} /></InputAdornment> }}
        sx={{ mb: 3, width: { xs: '100%', sm: 360 } }}
      />

      {/* ── Loading state ── */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress sx={{ color: meta.color }} />
        </Box>
      ) : filtered.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3, border: '1px dashed', borderColor: 'divider' }}>
          <Avatar sx={{ bgcolor: alpha(meta.color, 0.1), color: meta.color, width: 64, height: 64, mx: 'auto', mb: 2 }}>
            {meta.icon}
          </Avatar>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>No policies yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 400, mx: 'auto' }}>
            Create your first {meta.label.toLowerCase()} discovery policy to start detecting sensitive access patterns.
          </Typography>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => navigate(`/governance/discovery/${slug}/new`)}
            sx={{ textTransform: 'none', fontWeight: 700, bgcolor: meta.color, '&:hover': { bgcolor: alpha(meta.color, 0.85) } }}
          >
            Create Policy
          </Button>
        </Paper>
      ) : (
        /* ── Policy Cards ── */
        <Grid container spacing={2}>
          {filtered.map((policy) => {
            const isEvaluating = evalUi.running && evalUi.policyId === policy._id;

            return (
              <Grid item xs={12} sm={6} lg={4} key={policy._id}>
                <Card
                  sx={{
                    borderRadius: 3,
                    border: '1px solid',
                    borderColor: alpha(meta.color, 0.12),
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    overflow: 'visible',
                    '&:hover': {
                      borderColor: alpha(meta.color, 0.35),
                      boxShadow: `0 8px 32px ${alpha(meta.color, 0.12)}`,
                      transform: 'translateY(-2px)',
                    },
                  }}
                >
                  {/* Action menu trigger */}
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); setActionAnchorEl(e.currentTarget); setActionPolicy(policy); }}
                    sx={{ position: 'absolute', top: 12, right: 12, zIndex: 2, color: 'text.secondary' }}
                  >
                    <MoreVert fontSize="small" />
                  </IconButton>

                  <CardActionArea
                    onClick={() => navigate(`/governance/discovery/policy/${policy._id}`)}
                    sx={{ p: 2.5, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
                  >
                    {/* Top line: policy ID */}
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5, width: '100%' }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: '0.04em' }}>
                        {policy.policyId || '—'}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                    </Stack>

                    {/* Name */}
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3, mb: 0.5, pr: 3 }} noWrap>
                      {policy.name}
                    </Typography>

                    {/* Application */}
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }} noWrap>
                      {policy.applicationName || '—'}
                    </Typography>

                    {/* Bottom stats row */}
                    <Divider sx={{ width: '100%', mb: 1.5 }} />
                    <Stack direction="row" alignItems="center" spacing={2} sx={{ width: '100%' }}>
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', fontWeight: 600 }}>CONDITIONS</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{(policy.steps || []).length}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', fontWeight: 600 }}>DETECTED</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700, color: (policy.totalMatches || 0) > 0 ? palette.status.error : 'text.primary' }}>
                          {policy.totalMatches || 0}
                        </Typography>
                      </Box>
                      <Box sx={{ flex: 1 }} />
                      {isEvaluating && <CircularProgress size={18} sx={{ color: meta.color }} />}
                      {!isEvaluating && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>
                          {policy.lastEvaluatedAt ? `Last: ${new Date(policy.lastEvaluatedAt).toLocaleDateString()}` : 'Never evaluated'}
                        </Typography>
                      )}
                    </Stack>
                  </CardActionArea>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* ── Action Menu ── */}
      <Menu anchorEl={actionAnchorEl} open={Boolean(actionAnchorEl)} onClose={closeMenu}>
        <MenuItem onClick={() => { closeMenu(); navigate(`/governance/discovery/policy/${actionPolicy?._id}`); }}>
          <ListItemIcon><Search fontSize="small" /></ListItemIcon>
          <ListItemText>View Detected</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { closeMenu(); navigate(`/governance/discovery/${slug}/${actionPolicy?._id}/edit`); }}>
          <ListItemIcon><Edit fontSize="small" /></ListItemIcon>
          <ListItemText>Edit Policy</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { closeMenu(); handleEvaluate(actionPolicy); }}>
          <ListItemIcon><PlayArrow fontSize="small" /></ListItemIcon>
          <ListItemText>Run Evaluation</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { closeMenu(); handleClone(actionPolicy); }}>
          <ListItemIcon><ContentCopy fontSize="small" /></ListItemIcon>
          <ListItemText>Clone</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { closeMenu(); handleDelete(actionPolicy); }} sx={{ color: 'error.main' }}>
          <ListItemIcon><DeleteForever fontSize="small" sx={{ color: 'error.main' }} /></ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}
