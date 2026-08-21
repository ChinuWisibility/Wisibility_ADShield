import { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box, TextField, Button, Typography, Alert, CircularProgress,
  Link, Grid, InputAdornment, IconButton,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';

/* Shared clay field styling — same as Login */
const clayField = (extraMb = 2) => ({
  mb: extraMb,
  '& .MuiOutlinedInput-root': {
    background: '#f0f4ff',
    borderRadius: '14px',
    color: '#0f172a',
    transition: 'all 0.25s ease',
    boxShadow: '0 4px 0 rgba(37,99,235,0.18), 0 6px 12px rgba(0,0,0,0.05)',
    '& fieldset': {
      borderColor: 'rgba(37,99,235,0.25)',
      borderWidth: '1.5px',
      borderRadius: '14px',
      transition: 'border-color 0.25s ease',
    },
    '&:hover fieldset': {
      borderColor: 'rgba(37,99,235,0.5)',
    },
    '&.Mui-focused': {
      background: '#fff',
      boxShadow: '0 6px 0 rgba(37,99,235,0.28), 0 10px 20px rgba(0,0,0,0.07)',
      transform: 'translateY(-1px)',
    },
    '&.Mui-focused fieldset': {
      borderColor: '#2563EB',
      borderWidth: '2px',
    },
  },
  '& .MuiInputBase-input': {
    color: '#0f172a',
    fontWeight: 500,
    fontSize: '0.875rem',
    '&::placeholder': { color: '#94a3b8', opacity: 1, fontWeight: 400 },
  },
  '& .MuiInputAdornment-root .MuiIconButton-root': {
    color: '#94a3b8',
    '&:hover': { color: '#2563EB' },
  },
});

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '', confirmPassword: '', organizationCode: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await register({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
        ...(form.organizationCode.trim()
          ? { tenantCode: form.organizationCode.trim() }
          : {}),
      });
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  return (
    <Box>
      {/* Heading */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={900} sx={{
          mb: 0.5,
          color: '#0f172a',
          letterSpacing: '-0.02em',
          lineHeight: 1.25,
        }}>
          Create account ✨
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748b', fontWeight: 500 }}>
          Fill in your details to get started
        </Typography>
      </Box>

      {/* Error — clay style */}
      {error && (
        <Alert
          severity="error"
          sx={{
            mb: 2.5,
            background: '#fff5f5',
            border: '1.5px solid rgba(239,68,68,0.3)',
            borderRadius: '14px',
            color: '#b91c1c',
            boxShadow: '0 4px 0 rgba(239,68,68,0.15)',
            '& .MuiAlert-icon': { color: '#ef4444' },
            fontWeight: 500,
          }}
        >
          {error}
        </Alert>
      )}

      <Box component="form" onSubmit={handleSubmit}>
        {/* First + Last Name row */}
        <Grid container spacing={1.5} sx={{ mb: 0 }}>
          <Grid item xs={6}>
            <TextField
              fullWidth
              placeholder="First name"
              required
              value={form.firstName}
              onChange={update('firstName')}
              sx={clayField(2)}
              autoFocus
              variant="outlined"
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              fullWidth
              placeholder="Last name"
              required
              value={form.lastName}
              onChange={update('lastName')}
              sx={clayField(2)}
              variant="outlined"
            />
          </Grid>
        </Grid>

        {/* Email */}
        <TextField
          fullWidth
          placeholder="Email address"
          type="email"
          required
          value={form.email}
          onChange={update('email')}
          autoComplete="email"
          sx={clayField(2)}
          variant="outlined"
        />

        {/* Organization code (optional when a single tenant or SELF_REGISTER_TENANT_ID is configured) */}
        <TextField
          fullWidth
          placeholder="Organization code (if required)"
          value={form.organizationCode}
          onChange={update('organizationCode')}
          autoComplete="organization"
          sx={clayField(2)}
          variant="outlined"
          helperText="Required only when your administrator provides an organization code."
          FormHelperTextProps={{ sx: { mx: 0.5, color: '#94a3b8' } }}
        />

        {/* Password */}
        <TextField
          fullWidth
          placeholder="Password"
          required
          type={showPassword ? 'text' : 'password'}
          value={form.password}
          onChange={update('password')}
          autoComplete="new-password"
          sx={clayField(2)}
          variant="outlined"
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => setShowPassword(!showPassword)}
                  edge="end"
                  size="small"
                >
                  {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />

        {/* Confirm Password */}
        <TextField
          fullWidth
          placeholder="Confirm password"
          required
          type={showConfirm ? 'text' : 'password'}
          value={form.confirmPassword}
          onChange={update('confirmPassword')}
          autoComplete="new-password"
          sx={clayField(3)}
          variant="outlined"
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => setShowConfirm(!showConfirm)}
                  edge="end"
                  size="small"
                >
                  {showConfirm ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />

        {/* Clay button */}
        <Button
          fullWidth
          type="submit"
          variant="contained"
          size="large"
          disabled={loading}
          sx={{
            py: 1.65,
            mb: 3,
            borderRadius: '16px',
            background: loading
              ? '#eef2ff'
              : 'linear-gradient(145deg, #3b82f6 0%, #2563EB 100%)',
            color: loading ? '#2563EB' : '#fff',
            fontSize: 15.5,
            fontWeight: 800,
            letterSpacing: 0.2,
            textTransform: 'none',
            border: 'none',
            boxShadow: loading
              ? '0 4px 0 rgba(37,99,235,0.1)'
              : '0 8px 0 rgba(30,58,138,0.35), 0 12px 24px rgba(37,99,235,0.3)',
            transition: 'all 0.2s ease',
            '&:hover:not(:disabled)': {
              background: 'linear-gradient(145deg, #2563EB, #1d4ed8)',
              boxShadow: '0 10px 0 rgba(30,58,138,0.35), 0 16px 28px rgba(37,99,235,0.35)',
              transform: 'translateY(-2px)',
            },
            '&:active:not(:disabled)': {
              boxShadow: '0 4px 0 rgba(30,58,138,0.35)',
              transform: 'translateY(3px)',
            },
            '&.Mui-disabled': {
              background: '#eef2ff',
              color: '#2563EB',
              boxShadow: '0 4px 0 rgba(37,99,235,0.1)',
            },
          }}
        >
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <CircularProgress size={18} sx={{ color: '#2563EB' }} />
              <span style={{ fontWeight: 700 }}>Creating account…</span>
            </Box>
          ) : 'Create account →'}
        </Button>

        {/* Back to login */}
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="body2" sx={{ color: '#64748b', fontWeight: 500 }}>
            Already have an account?{' '}
            <Link
              component={RouterLink}
              to="/login"
              sx={{
                color: '#2563EB',
                fontWeight: 800,
                textDecoration: 'none',
                display: 'inline-block',
                px: 1, py: 0.25,
                borderRadius: '8px',
                transition: 'all 0.2s ease',
                '&:hover': {
                  background: 'rgba(37,99,235,0.1)',
                  color: '#1d4ed8',
                  transform: 'translateY(-1px)',
                },
              }}
            >
              Sign in
            </Link>
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
