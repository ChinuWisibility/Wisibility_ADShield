import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import {
  Add as AddIcon,
  Assessment as AssessmentIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import DataTable from '../../components/DataTable';
import { complianceFrameworkAPI } from '../../services/api';

const emptyControl = () => ({
  controlId: '',
  title: '',
  description: '',
  category: '',
  severity: '',
});

export default function ComplianceFrameworks() {
  const { enqueueSnackbar } = useSnackbar();
  const [frameworks, setFrameworks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [frameworkDetail, setFrameworkDetail] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [form, setForm] = useState({
    frameworkCode: '',
    frameworkName: '',
    frameworkVersion: '',
    description: '',
    controls: [emptyControl()],
  });

  const fetchFrameworks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await complianceFrameworkAPI.list();
      const payload = res?.data?.data;
      const rows = Array.isArray(payload) ? payload : payload?.items || [];
      setFrameworks(rows);
      if (!selectedId && rows.length) {
        setSelectedId(rows[0]._id);
      }
    } catch {
      enqueueSnackbar('Failed to load compliance frameworks', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [enqueueSnackbar, selectedId]);

  const fetchFrameworkDetails = useCallback(async (frameworkId) => {
    if (!frameworkId) return;
    setDetailLoading(true);
    try {
      const [detailRes, coverageRes] = await Promise.all([
        complianceFrameworkAPI.getById(frameworkId),
        complianceFrameworkAPI.getCoverage(frameworkId),
      ]);
      setFrameworkDetail(detailRes?.data?.data || null);
      setCoverage(coverageRes?.data?.data || null);
    } catch {
      enqueueSnackbar('Failed to load framework detail or coverage', { variant: 'error' });
      setFrameworkDetail(null);
      setCoverage(null);
    } finally {
      setDetailLoading(false);
    }
  }, [enqueueSnackbar]);

  useEffect(() => {
    fetchFrameworks();
  }, [fetchFrameworks]);

  useEffect(() => {
    if (selectedId) fetchFrameworkDetails(selectedId);
  }, [selectedId, fetchFrameworkDetails]);

  const rows = useMemo(() => frameworks.map((item) => ({
    ...item,
    displayCode: item.frameworkCode || 'CUSTOM',
  })), [frameworks]);

  const summary = useMemo(() => {
    const activeCount = frameworks.filter((item) => item.isActive).length;
    const totalControls = frameworks.reduce((sum, item) => sum + Number(item.controlCount || 0), 0);
    return {
      totalFrameworks: frameworks.length,
      activeFrameworks: activeCount,
      totalControls,
      selectedCoverage: Number(coverage?.coveragePercent || 0),
    };
  }, [frameworks, coverage]);

  const columns = [
    { field: 'displayCode', headerName: 'CODE', width: 110 },
    { field: 'frameworkName', headerName: 'FRAMEWORK', minWidth: 260 },
    { field: 'frameworkVersion', headerName: 'VERSION', width: 130 },
    {
      field: 'controlCount',
      headerName: 'CONTROLS',
      width: 120,
      renderCell: (row) => (
        <Chip 
          size="small" 
          label={row.controlCount || 0} 
          sx={{ 
            fontWeight: 600, 
            borderRadius: '50%', 
            width: 28, 
            height: 28,
            bgcolor: 'transparent',
            border: '1px solid',
            borderColor: '#29b6f6', // Light blue outline
            color: '#0288d1'
          }} 
        />
      ),
    },
    {
      field: 'isActive',
      headerName: 'STATUS',
      width: 120,
      renderCell: (row) => (
        <Chip 
          size="small" 
          label={row.isActive ? 'Active' : 'Inactive'} 
          sx={{ 
            fontWeight: 600, 
            bgcolor: row.isActive ? '#e8f5e9' : 'action.disabledBackground', 
            color: row.isActive ? '#2e7d32' : 'text.disabled',
            borderRadius: 1.5
          }} 
        />
      ),
    },
    {
      field: 'actions',
      headerName: '',
      width: 80,
      sortable: false,
      renderCell: (row) => {
        const isSelected = selectedId === row._id;
        return (
          <IconButton
            size="small"
            onClick={() => setSelectedId(row._id)}
            sx={{ 
              bgcolor: isSelected ? 'primary.main' : 'transparent',
              color: isSelected ? 'white' : 'primary.main',
              '&:hover': {
                bgcolor: isSelected ? 'primary.dark' : 'rgba(25, 118, 210, 0.04)',
              }
            }}
          >
            <VisibilityIcon fontSize="small" />
          </IconButton>
        );
      },
    },
  ];

  const updateControl = (index, field, value) => {
    setForm((prev) => {
      const nextControls = [...prev.controls];
      nextControls[index] = { ...nextControls[index], [field]: value };
      return { ...prev, controls: nextControls };
    });
  };

  const addControl = () => {
    setForm((prev) => ({ ...prev, controls: [...prev.controls, emptyControl()] }));
  };

  const removeControl = (index) => {
    setForm((prev) => {
      const nextControls = prev.controls.filter((_, i) => i !== index);
      return { ...prev, controls: nextControls.length ? nextControls : [emptyControl()] };
    });
  };

  const resetForm = () => {
    setForm({
      frameworkCode: '',
      frameworkName: '',
      frameworkVersion: '',
      description: '',
      controls: [emptyControl()],
    });
  };

  const handleCreateFramework = async () => {
    if (!form.frameworkName.trim()) {
      enqueueSnackbar('Framework name is required', { variant: 'warning' });
      return;
    }

    const cleanControls = form.controls
      .map((c) => ({
        controlId: c.controlId.trim(),
        title: c.title.trim(),
        description: c.description.trim(),
        category: c.category.trim(),
        severity: c.severity.trim(),
      }))
      .filter((c) => c.controlId && c.title);

    if (!cleanControls.length) {
      enqueueSnackbar('At least one valid control is required', { variant: 'warning' });
      return;
    }

    setCreateBusy(true);
    try {
      const payload = {
        frameworkCode: form.frameworkCode.trim() || undefined,
        frameworkName: form.frameworkName.trim(),
        frameworkVersion: form.frameworkVersion.trim() || undefined,
        description: form.description.trim() || undefined,
        controls: cleanControls,
      };

      const res = await complianceFrameworkAPI.create(payload);
      const created = res?.data?.data;

      enqueueSnackbar('Compliance framework created', { variant: 'success' });
      setCreateOpen(false);
      resetForm();
      await fetchFrameworks();
      if (created?._id) {
        setSelectedId(created._id);
      }
    } catch (err) {
      const msg = err?.response?.data?.error?.message || 'Failed to create framework';
      enqueueSnackbar(msg, { variant: 'error' });
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#f8fafc', minHeight: '100vh' }}>
      
      {/* Header Area */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight={700} color="text.primary" sx={{ mb: 0.5 }}>
            Compliance Frameworks
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Control catalogs and IGA evidence coverage across SOX, GDPR, HIPAA, PCI-DSS, and custom frameworks.
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ width: { xs: '100%', sm: 'auto' } }}>
          <Button 
            variant="outlined" 
            startIcon={<RefreshIcon />} 
            onClick={fetchFrameworks}
            sx={{ bgcolor: 'background.paper', borderRadius: 8, textTransform: 'none', fontWeight: 600, color: 'text.secondary', borderColor: '#e2e8f0' }}
          >
            Refresh
          </Button>
          <Button 
            variant="contained" 
            startIcon={<AddIcon />} 
            onClick={() => setCreateOpen(true)}
            sx={{ borderRadius: 8, textTransform: 'none', fontWeight: 600, boxShadow: 'none' }}
          >
            Create Framework
          </Button>
        </Stack>
      </Box>

      {/* Summary Stats Bar */}
      <Paper variant="outlined" sx={{ mb: 3, display: 'inline-flex', borderRadius: 4, px: 3, py: 1.5, borderColor: '#e2e8f0', boxShadow: 'none' }}>
        <Stack direction="row" spacing={5}>
          <Box>
            <Typography variant="body2" color="text.secondary" display="block">Frameworks</Typography>
            <Typography variant="subtitle1" fontWeight={700}>{summary.totalFrameworks}</Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary" display="block">Active</Typography>
            <Typography variant="subtitle1" fontWeight={700}>{summary.activeFrameworks}</Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary" display="block">Controls</Typography>
            <Typography variant="subtitle1" fontWeight={700}>{summary.totalControls}</Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary" display="block">Selected Coverage</Typography>
            <Typography variant="subtitle1" fontWeight={700}>{summary.selectedCoverage}%</Typography>
          </Box>
        </Stack>
      </Paper>

      {/* Main Content Split */}
      <Grid container spacing={3} alignItems="stretch">
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper variant="outlined" sx={{ borderRadius: 4, overflow: 'hidden', borderColor: '#e2e8f0', boxShadow: 'none' }}>
            <DataTable
              title="Framework Catalog"
              columns={columns}
              rows={rows}
              loading={loading}
              onRefresh={fetchFrameworks}
              emptyMessage="No compliance frameworks found"
              defaultSort="frameworkName"
            />
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Paper
            variant="outlined"
            sx={{
              p: 3,
              borderRadius: 4, // Highly rounded
              minHeight: 520,
              position: { md: 'sticky' },
              top: { md: 24 },
              bgcolor: 'background.paper',
              borderColor: '#e2e8f0',
              boxShadow: 'none'
            }}
          >
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>Framework Detail</Typography>

            {detailLoading && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

            {!selectedId && !detailLoading && (
              <Alert severity="info" sx={{ borderRadius: 3 }}>Select a framework to view details and coverage.</Alert>
            )}

            {selectedId && !detailLoading && !frameworkDetail && (
              <Alert severity="warning" sx={{ borderRadius: 3 }}>Unable to load selected framework.</Alert>
            )}

            {frameworkDetail && (
              <Stack spacing={3}>
                <Box>
                  <Typography variant="body1" fontWeight={700} sx={{ mb: 0.5, color: 'text.primary' }}>
                    {frameworkDetail.frameworkName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {frameworkDetail.frameworkCode || 'CUSTOM'}
                    {frameworkDetail.frameworkVersion ? ` | ${frameworkDetail.frameworkVersion}` : ''}
                  </Typography>
                  {frameworkDetail.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, lineHeight: 1.5 }}>
                      {frameworkDetail.description}
                    </Typography>
                  )}
                </Box>

                {coverage && (
                  <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 4, borderColor: '#e2e8f0', boxShadow: 'none' }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, color: '#1976d2' }}>
                      <AssessmentIcon fontSize="small" />
                      <Typography variant="overline" fontWeight={800} sx={{ lineHeight: 1, letterSpacing: 0.5 }}>COVERAGE</Typography>
                    </Stack>
                    
                    <Typography variant="h5" fontWeight={800} sx={{ mb: 1 }}>
                      {coverage.coveragePercent || 0}%
                    </Typography>
                    
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, Number(coverage.coveragePercent || 0))}
                      sx={{ height: 8, borderRadius: 4, mb: 1.5, bgcolor: '#f1f5f9' }}
                    />
                    
                    <Typography variant="body2" color="text.secondary">
                      {coverage.coveredControls || 0} / {coverage.totalControls || 0} controls mapped with evidence
                    </Typography>
                    
                    {!!coverage.uncoveredControls && (
                      <Typography variant="body2" sx={{ color: '#d97706', fontWeight: 600, mt: 0.5 }}>
                        {coverage.uncoveredControls} controls still uncovered
                      </Typography>
                    )}
                  </Paper>
                )}

                <Box>
                  <Typography variant="overline" color="text.secondary" fontWeight={700} sx={{ display: 'block', mb: 1.5, letterSpacing: 0.5 }}>
                    CONTROLS ({frameworkDetail.controls?.length || 0})
                  </Typography>
                  
                  <Stack spacing={2} sx={{ maxHeight: 420, overflowY: 'auto', pr: 0.5 }}>
                    {(frameworkDetail.controls || []).map((control, idx) => (
                      <Paper key={`${control.controlId || 'ctrl'}-${idx}`} variant="outlined" sx={{ p: 2, borderRadius: 3, borderColor: '#e2e8f0', boxShadow: 'none' }}>
                        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
                          <Typography variant="body2" fontWeight={700} sx={{ color: '#475569', textTransform: 'uppercase' }}>
                            {control.controlId} | {control.title}
                          </Typography>
                          {control.category && (
                            <Chip 
                              size="small" 
                              label={control.category} 
                              variant="outlined" 
                              sx={{ height: 24, fontSize: '0.75rem', fontWeight: 600, borderRadius: 6, borderColor: '#cbd5e1' }} 
                            />
                          )}
                        </Stack>
                        {control.description && (
                          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                            {control.description}
                          </Typography>
                        )}
                      </Paper>
                    ))}
                  </Stack>
                </Box>
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Create Framework Dialog */}
      <Dialog 
        open={createOpen} 
        onClose={() => !createBusy && setCreateOpen(false)} 
        maxWidth="md" 
        fullWidth
        PaperProps={{ sx: { borderRadius: 4 } }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Create Compliance Framework</DialogTitle>
        <DialogContent dividers sx={{ p: 3 }}>
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                size="small"
                label="Framework Code"
                placeholder="SOX-CUSTOM"
                value={form.frameworkCode}
                onChange={(e) => setForm((prev) => ({ ...prev, frameworkCode: e.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField
                fullWidth
                size="small"
                required
                label="Framework Name"
                value={form.frameworkName}
                onChange={(e) => setForm((prev) => ({ ...prev, frameworkName: e.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <TextField
                fullWidth
                size="small"
                label="Version"
                value={form.frameworkVersion}
                onChange={(e) => setForm((prev) => ({ ...prev, frameworkVersion: e.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                size="small"
                multiline
                minRows={3}
                label="Description"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </Grid>
          </Grid>

          <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 4, mb: 1.5 }}>
            Framework Controls
          </Typography>
          <Stack spacing={2}>
            {form.controls.map((control, idx) => (
              <Paper key={`new-control-${idx}`} variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: '#f8fafc', borderColor: '#e2e8f0' }}>
                <Grid container spacing={2} alignItems="center">
                  <Grid size={{ xs: 12, sm: 3 }}>
                    <TextField
                      fullWidth
                      required
                      size="small"
                      label="Control ID"
                      value={control.controlId}
                      onChange={(e) => updateControl(idx, 'controlId', e.target.value)}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      fullWidth
                      required
                      size="small"
                      label="Title"
                      value={control.title}
                      onChange={(e) => updateControl(idx, 'title', e.target.value)}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 3 }}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Category"
                      value={control.category}
                      onChange={(e) => updateControl(idx, 'category', e.target.value)}
                    />
                  </Grid>
                  <Grid size={{ xs: 10, sm: 1.5 }}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Severity"
                      value={control.severity}
                      onChange={(e) => updateControl(idx, 'severity', e.target.value)}
                    />
                  </Grid>
                  <Grid size={{ xs: 2, sm: 0.5 }} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <IconButton
                      color="error"
                      onClick={() => removeControl(idx)}
                      sx={{ p: 1, borderRadius: 2 }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Description"
                      value={control.description}
                      onChange={(e) => updateControl(idx, 'description', e.target.value)}
                    />
                  </Grid>
                </Grid>
              </Paper>
            ))}
          </Stack>

          <Button 
            sx={{ mt: 2, borderRadius: 6, textTransform: 'none', fontWeight: 600 }} 
            startIcon={<AddIcon />} 
            onClick={addControl}
          >
            Add Control
          </Button>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setCreateOpen(false)} disabled={createBusy} sx={{ textTransform: 'none', fontWeight: 600, color: 'text.secondary', borderRadius: 6 }}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleCreateFramework} disabled={createBusy} sx={{ borderRadius: 6, textTransform: 'none', fontWeight: 600, boxShadow: 'none' }}>
            {createBusy ? <CircularProgress size={20} color="inherit" /> : 'Create Framework'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}