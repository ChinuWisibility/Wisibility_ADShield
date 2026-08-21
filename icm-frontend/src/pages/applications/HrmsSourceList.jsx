import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Card,
  Chip,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  alpha,
  InputAdornment,
  Alert,
} from '@mui/material';
import { Add, Search as SearchIcon } from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import DataTable from '../../components/DataTable';
import { palette } from '../../theme/palette';
import { hrmsIntegrationAPI, identityProfileAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

function idStr(ref) {
  if (ref == null) return '';
  if (typeof ref === 'object' && ref._id != null) return String(ref._id);
  return String(ref);
}

/** Authoritative source id on an identity profile (application or legacy HRMS). */
function profileSourceId(p) {
  const s = p?.sourceApplicationId;
  const h = p?.hrmsSourceId;
  if (s) return idStr(s);
  if (h) return idStr(h);
  return '';
}

function connectorLabel(c) {
  if (c === 'delimited_file') return 'Delimited File';
  return 'OrangeHRM';
}

function oauthConnectionChip(connectionStatus) {
  const s = connectionStatus || 'disconnected';
  if (s === 'connected') {
    return (
      <Chip
        label="Connected"
        size="small"
        sx={{
          backgroundColor: alpha(palette.status.success, 0.12),
          color: palette.status.success,
          fontWeight: 600,
        }}
      />
    );
  }
  if (s === 'error') {
    return (
      <Chip
        label="Error"
        size="small"
        sx={{
          backgroundColor: alpha(palette.status.error, 0.12),
          color: palette.status.error,
          fontWeight: 600,
        }}
      />
    );
  }
  return (
    <Chip
      label="Disconnected"
      size="small"
      sx={{
        backgroundColor: alpha(palette.text.disabled, 0.15),
        color: palette.text.secondary,
        fontWeight: 600,
      }}
    />
  );
}

function enabledChip(isActive) {
  const on = isActive !== false;
  return (
    <Chip
      label={on ? 'Active' : 'Inactive'}
      size="small"
      sx={{
        backgroundColor: on ? alpha(palette.status.success, 0.12) : alpha(palette.text.disabled, 0.15),
        color: on ? palette.status.success : palette.text.secondary,
        fontWeight: 600,
      }}
    />
  );
}

export default function HrmsSourceList() {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [rows, setRows] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', description: '', connector: 'orangehrm' });

  const profilesBySourceId = useMemo(() => {
    const m = {};
    for (const p of profiles) {
      const sid = profileSourceId(p);
      if (!sid) continue;
      if (!m[sid]) m[sid] = [];
      m[sid].push({ _id: p._id, name: p.name || 'Unnamed profile' });
    }
    return m;
  }, [profiles]);

  const fetchSources = async () => {
    if (!tenantId) {
      setRows([]);
      setProfiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [srcRes, profRes] = await Promise.all([
        hrmsIntegrationAPI.listSources({
          tenantId,
          profileSourcesOnly: true,
        }),
        identityProfileAPI.list({ tenantId }),
      ]);
      setRows(srcRes.data?.data || []);
      setProfiles(profRes.data?.data || []);
    } catch (e) {
      enqueueSnackbar(e.response?.data?.error?.message || e.response?.data?.message || 'Failed to load HRMS sources', {
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, [tenantId]);

  useEffect(() => {
    const err = searchParams.get('hrms_error');
    if (err) {
      enqueueSnackbar(decodeURIComponent(err), { variant: 'error' });
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, enqueueSnackbar]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => {
      const id = String(r._id);
      const profLabels = (profilesBySourceId[id] || []).map((p) => p.name.toLowerCase()).join(' ');
      return (
        (r.name && String(r.name).toLowerCase().includes(q)) ||
        (r.description && String(r.description).toLowerCase().includes(q)) ||
        connectorLabel(r.connector).toLowerCase().includes(q) ||
        profLabels.includes(q)
      );
    });
  }, [rows, search, profilesBySourceId]);

  const submitAdd = async () => {
    const name = addForm.name.trim();
    if (!name) {
      enqueueSnackbar('Name is required', { variant: 'warning' });
      return;
    }
    try {
      await hrmsIntegrationAPI.createSource({
        tenantId,
        name,
        description: addForm.description.trim() || undefined,
        connector: addForm.connector,
      });
      enqueueSnackbar('Source created', { variant: 'success' });
      setAddOpen(false);
      setAddForm({ name: '', description: '', connector: 'orangehrm' });
      fetchSources();
    } catch (e) {
      enqueueSnackbar(e.response?.data?.error?.message || e.response?.data?.message || 'Create failed', {
        variant: 'error',
      });
    }
  };

  const columns = [
    {
      field: 'name',
      headerName: 'Name',
      minWidth: 200,
      renderCell: (row) => (
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: palette.brand.primary,
            cursor: 'pointer',
            '&:hover': { textDecoration: 'underline' },
          }}
          onClick={() => navigate(`/applications/${row._id}`)}
        >
          {row.name}
        </Typography>
      ),
    },
    {
      field: 'identityProfiles',
      headerName: 'Identity profiles',
      minWidth: 280,
      sortable: false,
      renderCell: (row) => {
        const list = profilesBySourceId[String(row._id)] || [];
        if (list.length === 0) {
          return (
            <Typography variant="body2" color="text.secondary">
              —
            </Typography>
          );
        }
        return (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', py: 0.25 }}>
            {list.map((p) => (
              <Chip
                key={String(p._id)}
                size="small"
                label={p.name}
                variant="outlined"
                onClick={() => navigate(`/identities/profiles/${p._id}`)}
                sx={{ cursor: 'pointer', fontWeight: 600 }}
              />
            ))}
          </Box>
        );
      },
    },
    {
      field: 'description',
      headerName: 'Description',
      minWidth: 260,
      renderCell: (row) => (
        <Typography variant="body2" color="text.secondary" noWrap>
          {row.description || '—'}
        </Typography>
      ),
    },
    {
      field: 'connector',
      headerName: 'Connector',
      minWidth: 160,
      renderCell: (row) => <Typography variant="body2">{connectorLabel(row.connector)}</Typography>,
    },
    {
      field: 'isActive',
      headerName: 'Enabled',
      minWidth: 100,
      sortable: false,
      renderCell: (row) => enabledChip(row.isActive),
    },
    {
      field: 'connectionStatus',
      headerName: 'OAuth / link',
      minWidth: 130,
      sortable: false,
      renderCell: (row) =>
        row.connector === 'delimited_file' ? (
          <Typography variant="body2" color="text.secondary">
            CSV
          </Typography>
        ) : (
          oauthConnectionChip(row.connectionStatus)
        ),
    },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
            HRMS Source
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage HR systems used as authoritative sources. Only applications currently selected as the source on an
            identity profile are listed here.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setAddOpen(true)}
          disabled={!tenantId}
          sx={{ fontWeight: 600, px: 3, height: 40 }}
        >
          Add new source
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2, py: 0.75 }}>
        Sources appear here after you choose them under <strong>Identities → Identity Profiles</strong> (create or edit
        a profile and set <strong>Source</strong>). Add HRMS entries in App Registry or via Add new source, then link
        them from an identity profile.
      </Alert>

      {!tenantId ? (
        <Card
          elevation={0}
          sx={{
            border: `1px solid ${palette.border.default}`,
            p: 6,
            textAlign: 'center',
            backgroundColor: '#f8fafc',
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>
            No tenant associated
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Your user account is not associated with any tenant.
          </Typography>
        </Card>
      ) : (
        <>
          <TextField
            fullWidth
            size="small"
            placeholder="Search HRMS sources"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ mb: 2 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 20, color: palette.text.secondary }} />
                </InputAdornment>
              ),
            }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {filtered.length} {filtered.length === 1 ? 'Result' : 'Results'}
          </Typography>
          <Card elevation={0} sx={{ border: `1px solid ${palette.border.default}` }}>
            <DataTable
              title=""
              columns={columns}
              rows={filtered}
              loading={loading}
              onRefresh={fetchSources}
              searchable={false}
              defaultSort="name"
              emptyMessage="No HRMS sources match. Select an application as the source on an identity profile first, or adjust your search."
            />
          </Card>
        </>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add HRMS source</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label="Name"
            required
            fullWidth
            size="small"
            value={addForm.name}
            onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
          />
          <TextField
            label="Description"
            fullWidth
            size="small"
            multiline
            minRows={2}
            value={addForm.description}
            onChange={(e) => setAddForm((p) => ({ ...p, description: e.target.value }))}
          />
          <TextField
            select
            label="Connector"
            fullWidth
            size="small"
            value={addForm.connector}
            onChange={(e) => setAddForm((p) => ({ ...p, connector: e.target.value }))}
          >
            <MenuItem value="orangehrm">OrangeHRM</MenuItem>
            <MenuItem value="delimited_file">Delimited File</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submitAdd}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
