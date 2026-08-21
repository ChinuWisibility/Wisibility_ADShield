import { useEffect, useState } from 'react';
import { useLocation, Link as RouterLink } from 'react-router-dom';
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

export default function CreateOwnPassword() {
  const query = useQuery();
  const token = query.get('token') || '';

  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [passwords, setPasswords] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const verify = async () => {
      if (!token) {
        if (!cancelled) {
          setStatus('invalid');
          setError('This password creation link is invalid.');
        }
        return;
      }
      try {
        await authAPI.verifyCreateOwnPasswordToken(token);
        if (!cancelled) setStatus('valid');
      } catch (err) {
        if (!cancelled) {
          setStatus('invalid');
          setError(
            err.response?.data?.error?.message ||
              'This password creation link is invalid.',
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
    if (!passwords.oldPassword || !passwords.newPassword || !passwords.confirmPassword) {
      setError('Please enter Older Password, New Password, and Confirm New Password.');
      return;
    }
    if (passwords.newPassword !== passwords.confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await authAPI.completeCreateOwnPassword({
        token,
        oldPassword: passwords.oldPassword,
        newPassword: passwords.newPassword,
        confirmPassword: passwords.confirmPassword,
      });
      setSuccessMessage(
        res.data?.data?.message ||
          'Your password has been created successfully. You can now log in to ADSecurity using your email address or User ID.',
      );
      setStatus('success');
      setPasswords({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
          'We were unable to create your password. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'checking') {
    return (
      <Box>
        <Typography variant="h6" sx={{ mb: 1.5 }}>
          Validating password creation link…
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Please wait while we confirm that this link is still valid.
        </Typography>
      </Box>
    );
  }

  if (status === 'invalid') {
    return (
      <Box data-testid="create-own-password-invalid" role="alert">
        <Typography variant="h5" fontWeight={800} sx={{ mb: 1 }}>
          Password creation unavailable
        </Typography>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || 'This password creation link has expired.'}
        </Alert>
        <Button component={RouterLink} to="/login" variant="contained">
          Go to Login
        </Button>
      </Box>
    );
  }

  if (status === 'success') {
    return (
      <Box>
        <Typography variant="h5" fontWeight={900} sx={{ mb: 1 }}>
          Password created
        </Typography>
        <Alert severity="success" sx={{ mb: 2 }}>
          {successMessage}
        </Alert>
        <Button component={RouterLink} to="/login" variant="contained">
          Go to Login
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3.5 }}>
        <Typography variant="h5" fontWeight={900} sx={{ mb: 0.5 }}>
          Create Your Own Password
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Enter the temporary password from your welcome email as Older Password, then choose a new password.
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
          label="Older Password"
          type={showOld ? 'text' : 'password'}
          sx={{ mb: 2 }}
          value={passwords.oldPassword}
          onChange={(e) => handleChange('oldPassword', e.target.value)}
          autoComplete="current-password"
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setShowOld((p) => !p)} edge="end">
                  {showOld ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        <TextField
          fullWidth
          label="New Password"
          type={showNew ? 'text' : 'password'}
          sx={{ mb: 2 }}
          value={passwords.newPassword}
          onChange={(e) => handleChange('newPassword', e.target.value)}
          autoComplete="new-password"
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
          label="Confirm New Password"
          type={showConfirm ? 'text' : 'password'}
          sx={{ mb: 2.5 }}
          value={passwords.confirmPassword}
          onChange={(e) => handleChange('confirmPassword', e.target.value)}
          autoComplete="new-password"
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
        <Button fullWidth type="submit" variant="contained" disabled={submitting}>
          {submitting ? 'Saving password…' : 'Save Password'}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
          Already finished setup?{' '}
          <Link component={RouterLink} to="/login">
            Back to sign in
          </Link>
        </Typography>
      </Box>
    </Box>
  );
}
