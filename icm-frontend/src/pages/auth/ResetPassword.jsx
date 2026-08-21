import { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  Link,
  IconButton,
  InputAdornment,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { authAPI } from '../../services/api';

function useQuery() {
  const { search } = useLocation();
  return new URLSearchParams(search);
}

export default function ResetPassword() {
  const query = useQuery();
  const navigate = useNavigate();
  const token = query.get('token') || '';

  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');
  const [passwords, setPasswords] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const verify = async () => {
      if (!token) {
        if (!cancelled) {
          setStatus('invalid');
          setError('Invalid or expired reset link');
        }
        return;
      }
      try {
        await authAPI.verifyResetToken(token);
        if (!cancelled) setStatus('valid');
      } catch (err) {
        if (!cancelled) {
          setStatus('invalid');
          setError(
            err.response?.data?.error?.message ||
            'Invalid or expired reset link'
          );
        }
      }
    };
    verify();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleChange = (field, value) => {
    setPasswords((prev) => ({ ...prev, [field]: value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!passwords.newPassword || !passwords.confirmPassword) {
      setError('Please enter and confirm your new password.');
      return;
    }
    if (passwords.newPassword !== passwords.confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await authAPI.resetPasswordWithToken({
        token,
        newPassword: passwords.newPassword,
      });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
        'We were unable to update your password. Please request a new reset link and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'checking') {
    return (
      <Box>
        <Typography variant="h6" sx={{ mb: 1.5 }}>
          Validating reset link…
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Please wait while we confirm that this password reset link is still valid.
        </Typography>
      </Box>
    );
  }

  if (status === 'invalid') {
    return (
      <Box data-testid="reset-link-invalid" role="alert">
        <Typography variant="h5" fontWeight={800} sx={{ mb: 1 }}>
          Invalid or expired reset link
        </Typography>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || 'Invalid or expired reset link'}
        </Alert>
        <Typography variant="body2" sx={{ mb: 2 }}>
          You can request a new link from the forgot password page.
        </Typography>
        <Button
          component={RouterLink}
          to="/reset-password"
          variant="contained"
        >
          Request new link
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3.5 }}>
        <Typography variant="h5" fontWeight={900} sx={{ mb: 0.5 }}>
          Choose a new password
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Your new password will replace the old one for your ADSecurity IGA account.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box component="form" onSubmit={handleSubmit}>
        <TextField
          fullWidth
          label="New password"
          type={showNew ? 'text' : 'password'}
          sx={{ mb: 2 }}
          value={passwords.newPassword}
          onChange={(e) => handleChange('newPassword', e.target.value)}
          helperText="Minimum 8 characters is recommended."
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setShowNew((p) => !p)} edge="end">
                  {showNew ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        <TextField
          fullWidth
          label="Confirm new password"
          type={showConfirm ? 'text' : 'password'}
          sx={{ mb: 2.5 }}
          value={passwords.confirmPassword}
          onChange={(e) => handleChange('confirmPassword', e.target.value)}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setShowConfirm((p) => !p)} edge="end">
                  {showConfirm ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        <Button
          fullWidth
          type="submit"
          variant="contained"
          disabled={submitting}
        >
          {submitting ? 'Updating password…' : 'Update password'}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
          Already remember your password?{' '}
          <Link component={RouterLink} to="/login">
            Back to sign in
          </Link>
        </Typography>
      </Box>
    </Box>
  );
}

