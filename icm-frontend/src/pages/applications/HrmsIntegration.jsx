import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  TextField,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  FormControlLabel,
  Checkbox,
  Divider,
} from '@mui/material';
import { ArrowBack, Save, Link as LinkIcon, Science, Sync } from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { hrmsIntegrationAPI, applicationAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

export default function HrmsIntegration() {
  const { sourceId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { enqueueSnackbar } = useSnackbar();
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [applications, setApplications] = useState([]);

  const [form, setForm] = useState({
    baseUrl: '',
    clientId: '',
    clientSecret: '',
    authorizePath: '/web/index.php/oauth2/authorize',
    tokenPath: '/web/index.php/oauth2/token',
    employeesApiPath: '',
    authoritativeIdentitySource: false,
    directoryTargetApplicationId: '',
  });
  const [meta, setMeta] = useState({
    connectionStatus: 'disconnected',
    hasClientSecret: false,
    callbackUrl: '',
    name: '',
    connector: 'orangehrm',
  });

  const loadApplications = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await applicationAPI.list({ tenantId, limit: 500, page: 1 });
      const list = res.data?.data || res.data?.applications || [];
      setApplications(Array.isArray(list) ? list : []);
    } catch {
      setApplications([]);
    }
  }, [tenantId]);

  const loadConfig = useCallback(async () => {
    if (!tenantId || !sourceId) return;
    setLoading(true);
    try {
      const res = await hrmsIntegrationAPI.getConfig({ tenantId, sourceId });
      const d = res.data?.data;
      if (!d) return;
      setMeta({
        connectionStatus: d.connectionStatus || 'disconnected',
        hasClientSecret: !!d.hasClientSecret,
        callbackUrl: d.callbackUrl || '',
        name: d.name || '',
        connector: d.connector || 'orangehrm',
      });
      setForm({
        baseUrl: d.baseUrl || '',
        clientId: d.clientId || '',
        clientSecret: '',
        authorizePath: d.authorizePath || '/web/index.php/oauth2/authorize',
        tokenPath: d.tokenPath || '/web/index.php/oauth2/token',
        employeesApiPath: d.employeesApiPath || '',
        authoritativeIdentitySource: !!d.authoritativeIdentitySource,
        directoryTargetApplicationId: d.directoryTargetApplicationId ? String(d.directoryTargetApplicationId) : '',
      });
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Failed to load HRMS configuration', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [tenantId, sourceId, enqueueSnackbar]);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const err = searchParams.get('hrms_error');
    const ok = searchParams.get('hrms_connected');
    if (err) {
      enqueueSnackbar(decodeURIComponent(err), { variant: 'error' });
      setSearchParams({}, { replace: true });
    } else if (ok) {
      enqueueSnackbar('OrangeHRM connected successfully.', { variant: 'success' });
      setSearchParams({}, { replace: true });
      loadConfig();
    }
  }, [searchParams, setSearchParams, enqueueSnackbar, loadConfig]);

  const isDelimited = meta.connector === 'delimited_file';

  const handleSave = async () => {
    if (!tenantId || !sourceId) return;
    setSaving(true);
    try {
      await hrmsIntegrationAPI.updateConfig({
        tenantId,
        sourceId,
        baseUrl: form.baseUrl.trim(),
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret.trim() || undefined,
        authorizePath: form.authorizePath.trim(),
        tokenPath: form.tokenPath.trim(),
        employeesApiPath: form.employeesApiPath.trim(),
        authoritativeIdentitySource: form.authoritativeIdentitySource,
        directoryTargetApplicationId: form.directoryTargetApplicationId || null,
      });
      enqueueSnackbar('Settings saved', { variant: 'success' });
      setForm((f) => ({ ...f, clientSecret: '' }));
      loadConfig();
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Save failed', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleAuthorize = async () => {
    if (!tenantId || !sourceId) return;
    try {
      const res = await hrmsIntegrationAPI.startOAuth({
        tenantId,
        sourceId,
        baseUrl: form.baseUrl.trim(),
        clientId: form.clientId.trim(),
        authorizePath: form.authorizePath.trim(),
      });
      const url = res.data?.data?.authorizeUrl;
      if (url) window.location.href = url;
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Could not start OAuth', { variant: 'error' });
    }
  };

  const handleTest = async () => {
    if (!tenantId || !sourceId) return;
    setTesting(true);
    try {
      const res = await hrmsIntegrationAPI.testConnection({ tenantId, sourceId });
      const d = res.data?.data;
      if (d?.ok) {
        enqueueSnackbar(`API reachable: ${d.url || 'OK'}`, { variant: 'success' });
      } else {
        enqueueSnackbar(d?.message || 'Test failed', { variant: 'warning' });
      }
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Test failed', { variant: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    if (!tenantId || !sourceId) return;
    setSyncing(true);
    try {
      const res = await hrmsIntegrationAPI.syncIdentities({ tenantId, sourceId });
      const n = res.data?.data?.upserted ?? res.data?.data?.created;
      enqueueSnackbar(
        typeof n === 'number' ? `Identity sync completed (${n} processed).` : 'Identity sync completed.',
        { variant: 'success' }
      );
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Sync failed', { variant: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">No tenant associated with your account.</Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, maxWidth: 900 }}>
      <Button variant="text" onClick={() => navigate('/applications/hrms-sources')} sx={{ mb: 2 }}>
        <ArrowBack sx={{ mr: 0.5, fontSize: 20 }} /> HRMS sources
      </Button>

      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        {meta.name || 'HRMS integration'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Connector: {isDelimited ? 'Delimited File' : 'OrangeHRM'} · Status: {meta.connectionStatus}
      </Typography>

      {isDelimited ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Delimited File sources use CSV upload instead of OAuth.{' '}
          <Button size="small" onClick={() => navigate(`/applications/upload?hrmsSourceId=${sourceId}`)}>
            Open upload
          </Button>
        </Alert>
      ) : (
        <>
          {meta.callbackUrl && (
            <Alert severity="info" sx={{ mb: 2 }}>
              OAuth redirect URI in OrangeHRM must be <strong>exactly</strong>:{' '}
              <code style={{ wordBreak: 'break-all' }}>{meta.callbackUrl}</code>
            </Alert>
          )}

          <Card sx={{ mb: 2 }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Base URL"
                fullWidth
                size="small"
                value={form.baseUrl}
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                placeholder="https://your-orangehrm.example.com"
              />
              <TextField
                label="OAuth client ID"
                fullWidth
                size="small"
                value={form.clientId}
                onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
              />
              <TextField
                label={meta.hasClientSecret ? 'Client secret (leave blank to keep)' : 'Client secret'}
                fullWidth
                size="small"
                type="password"
                value={form.clientSecret}
                onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))}
              />
              <TextField
                label="Authorize path"
                fullWidth
                size="small"
                value={form.authorizePath}
                onChange={(e) => setForm((f) => ({ ...f, authorizePath: e.target.value }))}
              />
              <TextField
                label="Token path"
                fullWidth
                size="small"
                value={form.tokenPath}
                onChange={(e) => setForm((f) => ({ ...f, tokenPath: e.target.value }))}
              />
              <TextField
                label="Employees API path (optional)"
                fullWidth
                size="small"
                value={form.employeesApiPath}
                onChange={(e) => setForm((f) => ({ ...f, employeesApiPath: e.target.value }))}
                helperText="Relative to base URL, if your REST plugin uses a custom path."
              />

              <FormControl fullWidth size="small">
                <InputLabel id="hrms-ad-target">Directory / AD target application</InputLabel>
                <Select
                  labelId="hrms-ad-target"
                  label="Directory / AD target application"
                  value={form.directoryTargetApplicationId || ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, directoryTargetApplicationId: e.target.value || '' }))
                  }
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {applications.map((a) => (
                    <MenuItem key={a._id} value={a._id}>
                      {a.name} {a.hrmsDirectoryTarget ? '(linked)' : ''} · {a.type || 'app'}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.authoritativeIdentitySource}
                    onChange={(e) => setForm((f) => ({ ...f, authoritativeIdentitySource: e.target.checked }))}
                  />
                }
                label="Authoritative identity source (HRMS → IGA)"
              />

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Button
                  variant="contained"
                  startIcon={<Save />}
                  onClick={handleSave}
                  disabled={saving}
                  sx={{ fontWeight: 600 }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<LinkIcon />}
                  onClick={handleAuthorize}
                  disabled={!form.baseUrl.trim() || !form.clientId.trim()}
                  sx={{ fontWeight: 600 }}
                >
                  Authorize (OAuth)
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<Science />}
                  onClick={handleTest}
                  disabled={testing}
                >
                  {testing ? 'Testing…' : 'Test API'}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<Sync />}
                  onClick={handleSync}
                  disabled={syncing}
                  color="secondary"
                >
                  {syncing ? 'Syncing…' : 'Sync identities'}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </>
      )}

      {!isDelimited && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="body2" color="text.secondary">
            After saving OAuth client settings, use <strong>Authorize</strong> to complete the browser flow. Then run{' '}
            <strong>Test API</strong> and <strong>Sync identities</strong> as needed.
          </Typography>
        </>
      )}
    </Box>
  );
}
