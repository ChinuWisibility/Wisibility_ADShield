import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Card, Alert, Chip, InputAdornment, TextField } from '@mui/material';
import { Search as SearchIcon, OpenInNew } from '@mui/icons-material';
import DataTable from '../../components/DataTable';
import { palette } from '../../theme/palette';
import { identityProfileAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

export default function IdentityProfileSourceApps() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await identityProfileAPI.getProfileSourceApplications({ tenantId });
      setRows(res.data?.data || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        (r.name && String(r.name).toLowerCase().includes(q)) ||
        (r.description && String(r.description).toLowerCase().includes(q)) ||
        (r.connectorType && String(r.connectorType).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns = [
    {
      field: 'name',
      headerName: 'Application / source',
      minWidth: 220,
      renderCell: (row) => (
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: row.kind === 'application' ? palette.brand.primary : 'text.primary',
            cursor: row.kind === 'application' ? 'pointer' : 'default',
            '&:hover':
              row.kind === 'application' ? { textDecoration: 'underline' } : undefined,
          }}
          onClick={() => {
            if (row.kind === 'application') navigate(`/applications/${row._id}`);
          }}
        >
          {row.name}
        </Typography>
      ),
    },
    {
      field: 'kind',
      headerName: 'Type',
      minWidth: 120,
      renderCell: (row) => (
        <Chip
          size="small"
          label={row.kind === 'legacy_hrms' ? 'Legacy HRMS' : 'Application'}
          variant="outlined"
          sx={{ fontWeight: 600 }}
        />
      ),
    },
    {
      field: 'profileCount',
      headerName: 'Identity profiles',
      minWidth: 140,
      renderCell: (row) => (
        <Typography variant="body2" fontWeight={600}>
          {row.profileCount ?? 0}
        </Typography>
      ),
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
      field: 'actions',
      headerName: '',
      minWidth: 100,
      sortable: false,
      renderCell: (row) =>
        row.kind === 'application' ? (
          <OpenInNew
            fontSize="small"
            sx={{ color: palette.text.secondary, cursor: 'pointer' }}
            onClick={() => navigate(`/applications/${row._id}`)}
          />
        ) : (
          '—'
        ),
    },
  ];

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        Profile sources
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Applications (and legacy HRMS records) currently selected as the authoritative source on at least one
        identity profile.
      </Typography>

      {!tenantId ? (
        <Alert severity="warning">No tenant associated with your account.</Alert>
      ) : (
        <>
          <Alert severity="info" sx={{ mb: 2, py: 0.75 }}>
            To add a source here, create or edit an identity profile and choose a source application under
            Settings. This list only includes sources already tied to a profile.
          </Alert>
          <TextField
            fullWidth
            size="small"
            placeholder="Search by name or description"
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
            {filtered.length} {filtered.length === 1 ? 'source' : 'sources'}
          </Typography>
          <Card elevation={0} sx={{ border: `1px solid ${palette.border.default}` }}>
            <DataTable
              title=""
              columns={columns}
              rows={filtered}
              loading={loading}
              onRefresh={load}
              searchable={false}
              defaultSort="name"
              emptyMessage="No profile sources yet. Configure a source on an identity profile first."
            />
          </Card>
        </>
      )}
    </Box>
  );
}
