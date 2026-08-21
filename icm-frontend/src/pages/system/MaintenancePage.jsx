import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import { systemAPI } from '../../services/api';

const POLL_INTERVAL_MS = 20000;

function readMaintenanceHint() {
  try {
    return JSON.parse(sessionStorage.getItem('iga_maintenance') || '{}');
  } catch {
    return {};
  }
}

function resolveReturnPath() {
  const requested = sessionStorage.getItem('iga_maintenance_return');
  if (requested && requested.startsWith('/') && requested !== '/maintenance') {
    return requested;
  }
  return localStorage.getItem('icm_token') ? '/' : '/login';
}

export default function MaintenancePage() {
  const hint = useRef(readMaintenanceHint()).current;
  const [status, setStatus] = useState('checking');
  const [details, setDetails] = useState({
    message: hint.message || '',
    supportEmail: hint.supportEmail || '',
  });

  useEffect(() => {
    document.title = 'Maintenance — ADSecurity';
  }, []);

  const leaveMaintenance = useCallback(() => {
    const target = resolveReturnPath();
    sessionStorage.removeItem('iga_maintenance');
    sessionStorage.removeItem('iga_maintenance_return');
    window.location.replace(target);
  }, []);

  const verify = useCallback(async () => {
    setStatus((previous) => (previous === 'checking' ? previous : 'rechecking'));
    try {
      const maintenance = (await systemAPI.info()).data?.data?.maintenance;
      if (!maintenance?.enabled) {
        leaveMaintenance();
        return;
      }
      setDetails({
        message: maintenance.message || '',
        supportEmail: maintenance.supportEmail || '',
      });
      setStatus('maintenance');
    } catch {
      setStatus('unreachable');
    }
  }, [leaveMaintenance]);

  useEffect(() => {
    verify();
    const timer = setInterval(verify, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [verify]);

  const busy = status === 'checking' || status === 'rechecking';
  const unreachable = status === 'unreachable';

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'background.default',
        p: 3,
      }}
    >
      <Paper variant="outlined" sx={{ p: 5, maxWidth: 560, textAlign: 'center' }}>
        {status === 'checking' ? (
          <Stack spacing={2} alignItems="center">
            <CircularProgress />
            <Typography color="text.secondary">Checking service status...</Typography>
          </Stack>
        ) : (
          <>
            {unreachable ? (
              <CloudOffOutlinedIcon color="warning" sx={{ fontSize: 56, mb: 2 }} />
            ) : (
              <BuildOutlinedIcon color="primary" sx={{ fontSize: 56, mb: 2 }} />
            )}

            <Typography variant="h4" fontWeight={700} gutterBottom>
              {unreachable ? 'Service unavailable' : 'Scheduled maintenance'}
            </Typography>

            <Typography color="text.secondary" sx={{ mb: 3 }}>
              {unreachable
                ? 'The server is not responding right now. This page will keep retrying automatically.'
                : details.message}
            </Typography>

            {!unreachable && details.supportEmail && (
              <Typography variant="body2" sx={{ mb: 3 }}>
                Need help? <a href={`mailto:${details.supportEmail}`}>{details.supportEmail}</a>
              </Typography>
            )}

            <Button variant="contained" onClick={verify} disabled={busy}>
              {busy ? <CircularProgress size={22} color="inherit" /> : 'Check again'}
            </Button>

            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
              You will be returned automatically once the service is back.
            </Typography>
          </>
        )}
      </Paper>
    </Box>
  );
}
