import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box, Typography, TextField, InputAdornment, Paper, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Chip, CircularProgress,
  Grid,
} from '@mui/material';
import { Search, AppsOutlined, CheckCircleOutline } from '@mui/icons-material';
import { applicationAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { resolveApplicationIconSrc } from '../../components/applications/ApplicationIconPicker';
import { CATALOG, catalogPageSx } from '../identities/catalog/catalogTheme';
import { InsightKpi } from '../identities/catalog/CatalogInsightPrimitives';
import { palette } from '../../theme/palette';
import { applicationViewPath } from './catalog/applicationViewTabs';
import { prefetchApplicationViewShell } from './catalog/applicationViewQueries';

function AppIconCell({ app }) {
  const src = resolveApplicationIconSrc(app?.icon);
  const initial = String(app?.name || '?').charAt(0).toUpperCase();
  return (
    <Box
      sx={{
        width: 36,
        height: 36,
        borderRadius: 1.25,
        border: `1px solid ${CATALOG.border}`,
        bgcolor: src ? '#fff' : (app?.color || '#DBEAFE'),
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        p: src ? 0.35 : 0,
        fontSize: 14,
        fontWeight: 800,
        color: app?.color || CATALOG.accent,
      }}
    >
      {src ? (
        <Box component="img" src={src} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : (
        initial
      )}
    </Box>
  );
}

export default function ApplicationViewList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['application-view', 'list', tenantId],
    queryFn: async () => {
      const res = await applicationAPI.list({
        tenantId,
        limit: 500,
        page: 1,
        fields: 'registry',
      });
      return res?.data?.data || res?.data || [];
    },
    staleTime: 60_000,
  });

  const apps = useMemo(() => {
    const list = Array.isArray(query.data) ? query.data : [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => {
      const hay = [a.name, a.type, a.connectorType, a.owner, a.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query.data, search]);

  const stats = useMemo(() => {
    const list = Array.isArray(query.data) ? query.data : [];
    return {
      total: list.length,
      active: list.filter((a) => String(a.status || '').toLowerCase() === 'active').length,
      authoritative: list.filter((a) => a.isAuthoritativeSource).length,
    };
  }, [query.data]);

  const openApp = (app) => {
    const id = app._id || app.id;
    if (!id) return;
    prefetchApplicationViewShell(queryClient, id);
    navigate(applicationViewPath(id));
  };

  return (
    <Box sx={catalogPageSx}>
      <Box sx={{ mb: 2.5 }}>
        <Typography
          sx={{
            fontWeight: 750,
            fontSize: { xs: '1.35rem', md: '1.55rem' },
            color: CATALOG.ink,
            letterSpacing: '-0.02em',
          }}
        >
          Application View
        </Typography>
        <Typography variant="body2" sx={{ color: CATALOG.inkFaint, mt: 0.5, maxWidth: 640 }}>
          Governance catalog for each application — users, entitlements, SoD, correlation, and data hygiene.
          Ops schema and recon stay on Applications.
        </Typography>
      </Box>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={6} md={4}>
          <InsightKpi
            dense
            label="Applications"
            value={stats.total}
            icon={<AppsOutlined />}
            accent={palette.brand.primary}
            subtitle="In this tenant"
          />
        </Grid>
        <Grid item xs={6} md={4}>
          <InsightKpi
            dense
            label="Active"
            value={stats.active}
            icon={<CheckCircleOutline />}
            accent={palette.status.success}
            subtitle="Status active"
          />
        </Grid>
        <Grid item xs={6} md={4}>
          <InsightKpi
            dense
            label="Authoritative"
            value={stats.authoritative}
            icon={<AppsOutlined />}
            accent={CATALOG.accentDeep}
            subtitle="Source of identity"
          />
        </Grid>
      </Grid>

      <Paper
        elevation={0}
        sx={{
          border: `1px solid ${CATALOG.border}`,
          borderRadius: `${CATALOG.radius}px`,
          overflow: 'hidden',
          boxShadow: CATALOG.cardShadow,
        }}
      >
        <Box sx={{ p: 2, borderBottom: `1px solid ${CATALOG.border}`, bgcolor: CATALOG.surface }}>
          <TextField
            size="small"
            placeholder="Search applications…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ maxWidth: 360, bgcolor: CATALOG.surfaceAlt, borderRadius: 2 }}
          />
        </Box>

        {query.isPending ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={32} />
          </Box>
        ) : null}

        {query.isError ? (
          <Box sx={{ p: 3 }}>
            <Typography color="error">
              {query.error?.message || 'Failed to load applications.'}
            </Typography>
          </Box>
        ) : null}

        {!query.isPending && !query.isError ? (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: CATALOG.surfaceAlt }}>
                  <TableCell sx={{ fontWeight: 700 }}>Application</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Connector</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Users</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {apps.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        No applications match your search.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  apps.map((app) => (
                    <TableRow
                      key={app._id || app.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => openApp(app)}
                      onMouseEnter={() => prefetchApplicationViewShell(queryClient, app._id || app.id)}
                    >
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                          <AppIconCell app={app} />
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {app.name}
                            </Typography>
                            {app.isAuthoritativeSource ? (
                              <Chip size="small" label="Authoritative" sx={{ height: 18, fontSize: '0.65rem', mt: 0.35 }} />
                            ) : null}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>{app.type || '—'}</TableCell>
                      <TableCell>{app.connectorType || '—'}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={app.status || '—'}
                          sx={{
                            height: 22,
                            fontWeight: 650,
                            textTransform: 'capitalize',
                            bgcolor: String(app.status).toLowerCase() === 'active'
                              ? 'rgba(5,150,105,0.12)'
                              : CATALOG.surfaceAlt,
                            color: String(app.status).toLowerCase() === 'active' ? '#059669' : CATALOG.inkMuted,
                          }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {app.totalUsers != null ? Number(app.totalUsers).toLocaleString() : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        ) : null}
      </Paper>
    </Box>
  );
}
