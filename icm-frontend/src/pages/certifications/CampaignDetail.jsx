import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Grid, Typography, Button, Card, CardContent, LinearProgress, Chip,
  IconButton, Tooltip, CircularProgress, alpha, TextField, MenuItem, Dialog,
  DialogTitle, DialogContent, DialogActions, ButtonGroup,
} from '@mui/material';
import {
  CheckCircle, Cancel, SwapHoriz, ThumbUp, ThumbDown, ArrowBack,
  Timer, Assignment, Person,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import StatCard from '../../components/StatCard';
import RiskBadge from '../../components/RiskBadge';
import StatusChip from '../../components/StatusChip';
import { palette } from '../../theme/palette';
import api from '../../services/api';

const decisionColors = {
  approved: palette.status.success,
  revoked: palette.status.error,
  pending: palette.status.warning,
  reassigned: palette.status.info,
};

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState([]);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState('');
  const [reassignItemId, setReassignItemId] = useState(null);

  const resolveItemIdentityName = (item) => {
    if (!item) return 'Unknown User';
    const candidates = [
      item.identityName, item.name, item.displayName, item.userName,
      item.itemName, item.identity?.displayName, item.identity?.name,
    ];
    for (const c of candidates) {
      const s = String(c || '').trim();
      if (s && s !== '—' && s !== '-') return s;
    }
    return 'Unknown User';
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [campaignRes, itemsRes] = await Promise.all([
        api.get(`/certifications/campaigns/${id}`),
        api.get(`/certifications/campaigns/${id}/items`),
      ]);
      setCampaign(campaignRes.data.data || campaignRes.data);
      const rawItems = itemsRes.data.data || itemsRes.data || [];
      setItems(
        (Array.isArray(rawItems) ? rawItems : []).map((item) => ({
          ...item,
          identityName: resolveItemIdentityName(item),
        })),
      );
    } catch (err) {
      console.error('Failed to fetch campaign:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [id]);

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => (i.decision || 'pending').toLowerCase() === filter);
  }, [items, filter]);

  const stats = useMemo(() => {
    const total = items.length;
    const approved = items.filter((i) => i.decision === 'approved').length;
    const revoked = items.filter((i) => i.decision === 'revoked').length;
    const pending = items.filter((i) => !i.decision || i.decision === 'pending').length;
    return { total, approved, revoked, pending };
  }, [items]);

  const daysRemaining = useMemo(() => {
    if (!campaign?.dueDate) return null;
    const diff = Math.ceil((new Date(campaign.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
    return diff;
  }, [campaign]);

  const handleDecision = async (itemId, decision) => {
    try {
      await api.put(`/certifications/campaigns/${id}/items/${itemId}/decide`, { decision });
      fetchData();
    } catch (err) {
      console.error('Failed to submit decision:', err);
    }
  };

  const handleBulkDecision = async (decision) => {
    try {
      await Promise.all(
        selected.map((itemId) =>
          api.put(`/certifications/campaigns/${id}/items/${itemId}/decide`, { decision })
        )
      );
      setSelected([]);
      fetchData();
    } catch (err) {
      console.error('Failed to submit bulk decision:', err);
    }
  };

  const handleReassign = async () => {
    try {
      await api.put(`/certifications/campaigns/${id}/items/${reassignItemId}/reassign`, {
        reviewer: reassignTarget,
      });
      setReassignOpen(false);
      setReassignTarget('');
      setReassignItemId(null);
      fetchData();
    } catch (err) {
      console.error('Failed to reassign:', err);
    }
  };

  const columns = [
    { field: 'identityName', headerName: 'Identity', minWidth: 150 },
    { field: 'entitlement', headerName: 'Entitlement', minWidth: 180 },
    { field: 'application', headerName: 'Application', minWidth: 140 },
    {
      field: 'riskLevel', headerName: 'Risk Level', minWidth: 110,
      renderCell: (row) => <RiskBadge level={row.riskLevel} />,
    },
    {
      field: 'decision', headerName: 'Decision', minWidth: 120,
      renderCell: (row) => {
        const d = row.decision || 'pending';
        return (
          <Chip
            label={d.charAt(0).toUpperCase() + d.slice(1)}
            size="small"
            sx={{
              backgroundColor: alpha(decisionColors[d] || palette.text.secondary, 0.15),
              color: decisionColors[d] || palette.text.secondary,
              fontWeight: 700, fontSize: '0.7rem', borderRadius: 1,
            }}
          />
        );
      },
    },
    { field: 'decidedBy', headerName: 'Decided By', minWidth: 140 },
    { field: 'comments', headerName: 'Comments', minWidth: 160 },
    {
      field: 'actions', headerName: 'Actions', sortable: false, minWidth: 140,
      renderCell: (row) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Approve">
            <IconButton size="small" onClick={() => handleDecision(row._id || row.id, 'approved')}
              sx={{ color: palette.status.success }}>
              <CheckCircle fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Revoke">
            <IconButton size="small" onClick={() => handleDecision(row._id || row.id, 'revoked')}
              sx={{ color: palette.status.error }}>
              <Cancel fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Reassign">
            <IconButton size="small" onClick={() => { setReassignItemId(row._id || row.id); setReassignOpen(true); }}
              sx={{ color: palette.status.info }}>
              <SwapHoriz fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ];

  if (loading && !campaign) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!campaign) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h6" color="text.secondary">Campaign not found</Typography>
      </Box>
    );
  }

  const progressPct = campaign.progress ?? (stats.total > 0 ? Math.round(((stats.approved + stats.revoked) / stats.total) * 100) : 0);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
        <IconButton onClick={() => navigate(-1)} sx={{ color: palette.text.secondary }}>
          <ArrowBack />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>{campaign.name}</Typography>
            <StatusChip status={campaign.status} />
          </Box>
          <Typography variant="body2" color="text.secondary">{campaign.description}</Typography>
        </Box>
        {daysRemaining !== null && (
          <Chip
            icon={<Timer sx={{ fontSize: 16 }} />}
            label={daysRemaining > 0 ? `${daysRemaining} days remaining` : daysRemaining === 0 ? 'Due today' : `${Math.abs(daysRemaining)} days overdue`}
            sx={{
              backgroundColor: alpha(
                daysRemaining > 7 ? palette.status.success : daysRemaining > 0 ? palette.status.warning : palette.status.error,
                0.15
              ),
              color: daysRemaining > 7 ? palette.status.success : daysRemaining > 0 ? palette.status.warning : palette.status.error,
              fontWeight: 600,
            }}
          />
        )}
      </Box>

      {/* Progress Bar */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ py: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">Overall Progress</Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{progressPct}%</Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progressPct}
            sx={{
              height: 10, borderRadius: 5,
              backgroundColor: alpha(palette.brand.primary, 0.15),
              '& .MuiLinearProgress-bar': {
                borderRadius: 5,
                backgroundColor: progressPct >= 80 ? palette.status.success : progressPct >= 50 ? palette.status.warning : palette.brand.primary,
              },
            }}
          />
        </CardContent>
      </Card>

      {/* Stats */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="TOTAL ITEMS" value={stats.total} icon={<Assignment />} color={palette.brand.primary} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="APPROVED" value={stats.approved} icon={<ThumbUp />} color={palette.status.success} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="REVOKED" value={stats.revoked} icon={<ThumbDown />} color={palette.status.error} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="PENDING" value={stats.pending} icon={<Timer />} color={palette.status.warning} />
        </Grid>
      </Grid>

      {/* Filter & Bulk Actions */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
        <ButtonGroup size="small">
          {['all', 'pending', 'approved', 'revoked'].map((f) => (
            <Button
              key={f}
              variant={filter === f ? 'contained' : 'outlined'}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
        </ButtonGroup>
        <Box sx={{ flex: 1 }} />
        {selected.length > 0 && (
          <>
            <Button variant="contained" size="small" startIcon={<ThumbUp />}
              sx={{ backgroundColor: palette.status.success, '&:hover': { backgroundColor: palette.status.success } }}
              onClick={() => handleBulkDecision('approved')}>
              Bulk Approve ({selected.length})
            </Button>
            <Button variant="contained" size="small" startIcon={<ThumbDown />}
              sx={{ backgroundColor: palette.status.error, '&:hover': { backgroundColor: palette.status.error } }}
              onClick={() => handleBulkDecision('revoked')}>
              Bulk Revoke ({selected.length})
            </Button>
          </>
        )}
      </Box>

      {/* Table */}
      <DataTable
        columns={columns}
        rows={filteredItems}
        loading={loading}
        onRefresh={fetchData}
        selectable
        onSelectionChange={setSelected}
        defaultSort="identityName"
      />

      {/* Reassign Dialog */}
      <Dialog open={reassignOpen} onClose={() => setReassignOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Reassign Review Item</DialogTitle>
        <DialogContent sx={{ pt: '16px !important' }}>
          <TextField
            label="Reassign To (email)"
            fullWidth
            value={reassignTarget}
            onChange={(e) => setReassignTarget(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setReassignOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleReassign} disabled={!reassignTarget}>
            Reassign
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
