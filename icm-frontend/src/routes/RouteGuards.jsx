import { useLocation, Navigate } from 'react-router-dom';
import { Box, Typography, Paper, Button } from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { BRANDING } from '../constants/branding';

export function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (isAuthenticated) return children;
  const returnUrl = encodeURIComponent(location.pathname + location.search);
  return <Navigate to={`/login?returnUrl=${returnUrl}`} replace />;
}

export function PublicRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;

  const path = location.pathname || '';
  const isPasswordResetPath = path.startsWith('/reset-password');
  const isCreateOwnPasswordPath = path.startsWith('/create-own-password');

  if (isAuthenticated && !isPasswordResetPath && !isCreateOwnPasswordPath) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export function AdminRoute({ children }) {
  const { isPlatformAdmin, user } = useAuth();
  if (isPlatformAdmin) return children;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <Paper sx={{ p: 5, textAlign: 'center', maxWidth: 460 }}>
        <LockIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography variant="h5" fontWeight={700} gutterBottom>Access Denied</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          You need <strong>platform admin</strong> privileges to access this page.
        </Typography>
        <Typography variant="caption" color="text.disabled" display="block" sx={{ mb: 3 }}>
          Signed in as {user?.email} ({user?.role}) &middot; {BRANDING.domain}
        </Typography>
        <Button variant="outlined" href="/">Back to Dashboard</Button>
      </Paper>
    </Box>
  );
}

export function OrgAdminRoute({ children }) {
  const { isOrgAdmin, isPlatformAdmin, user, loading } = useAuth();
  if (loading) return null;
  // Strict org-admin plane only — platform admin / viewer / others are denied.
  if (isOrgAdmin && !isPlatformAdmin) return children;
  return (
    <Box
      sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}
      data-testid="org-admin-access-denied"
      role="alert"
    >
      <Paper sx={{ p: 5, textAlign: 'center', maxWidth: 460 }}>
        <LockIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography variant="h5" fontWeight={700} gutterBottom>Access Denied</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          You need org admin privileges to access this page.
        </Typography>
        {isPlatformAdmin && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Platform administrators cannot access org-admin Global Rule Sets.
          </Typography>
        )}
        <Typography variant="caption" color="text.disabled" display="block" sx={{ mb: 3 }}>
          Signed in as {user?.email} ({user?.role}) &middot; {BRANDING.domain}
        </Typography>
        <Button variant="outlined" href="/">Back to Dashboard</Button>
      </Paper>
    </Box>
  );
}

export function TenantAdminRoute({ children }) {
  const { isTenantAdmin, user } = useAuth();
  if (isTenantAdmin) return children;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <Paper sx={{ p: 5, textAlign: 'center', maxWidth: 460 }}>
        <LockIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography variant="h5" fontWeight={700} gutterBottom>Access Denied</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          You need <strong>tenant admin</strong> privileges to access this page.
        </Typography>
        <Typography variant="caption" color="text.disabled" display="block" sx={{ mb: 3 }}>
          Signed in as {user?.email} ({user?.role}) &middot; {BRANDING.domain}
        </Typography>
        <Button variant="outlined" href="/">Back to Dashboard</Button>
      </Paper>
    </Box>
  );
}

/** Blocks super admins — used for routes that must be available to other admin/report roles only */
export function NotSuperAdminReportPage({ children }) {
  const { user } = useAuth();
  if (user?.role === 'superAdmin') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Paper sx={{ p: 5, textAlign: 'center', maxWidth: 460 }}>
          <LockIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h5" fontWeight={700} gutterBottom>Access Denied</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            This report is not available for the super admin role.
          </Typography>
          <Typography variant="caption" color="text.disabled" display="block" sx={{ mb: 3 }}>
            Signed in as {user?.email} ({user?.role}) &middot; {BRANDING.domain}
          </Typography>
          <Button variant="outlined" href="/">Back to Dashboard</Button>
        </Paper>
      </Box>
    );
  }
  return children;
}

export function ReportsRoute({ children }) {
  const { isAdmin, isTenantAdmin, user } = useAuth();
  if (isAdmin || isTenantAdmin || user?.role === 'auditAnalytics') return children;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <Paper sx={{ p: 5, textAlign: 'center', maxWidth: 460 }}>
        <LockIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography variant="h5" fontWeight={700} gutterBottom>Access Denied</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          You need report access privileges to access this page.
        </Typography>
        <Typography variant="caption" color="text.disabled" display="block" sx={{ mb: 3 }}>
          Signed in as {user?.email} ({user?.role}) &middot; {BRANDING.domain}
        </Typography>
        <Button variant="outlined" href="/">Back to Dashboard</Button>
      </Paper>
    </Box>
  );
}

export function ComingSoon({ title }) {
  return (
    <Box sx={{ p: 5, textAlign: 'center' }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>{title}</Typography>
      <Typography variant="body2" color="text.secondary">
        This module will be built in upcoming sprints.
      </Typography>
      <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block' }}>
        {BRANDING.name} &middot; Identity &amp; Compliance Management
      </Typography>
    </Box>
  );
}
