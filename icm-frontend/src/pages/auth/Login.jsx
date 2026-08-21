import { useState } from 'react';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import {
  Box, TextField, Button, Typography, Alert, CircularProgress,
  InputAdornment, IconButton, Link,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { palette } from '../../theme/palette';

/* Clay text field — white bg, blue colored shadow on focus */
const clayField = {
  mb: 2.5,
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
    '&::placeholder': { color: '#94a3b8', opacity: 1, fontWeight: 400 },
  },
  '& .MuiInputAdornment-root .MuiIconButton-root': {
    color: '#94a3b8',
    '&:hover': { color: '#2563EB' },
  },
};

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, completeMfaLogin } = useAuth();
  const [form, setForm] = useState({
    email: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState(null);
  const [mfaCode, setMfaCode] = useState('');

  const goToPostLoginRoute = (loggedInUser) => {
    const params = new URLSearchParams(location.search);
    const returnUrl = params.get('returnUrl');
    const defaultRoute = loggedInUser?.role === 'superAdmin' ? '/admin/users' : '/';
    navigate(returnUrl ? decodeURIComponent(returnUrl) : defaultRoute, { replace: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(form.email, form.password);
      if (result?.mfaRequired) {
        setMfaToken(result.mfaToken);
        return;
      }
      goToPostLoginRoute(result);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const loggedInUser = await completeMfaLogin(mfaToken, mfaCode);
      goToPostLoginRoute(loggedInUser);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Invalid or expired code.');
    } finally {
      setLoading(false);
    }
  };

  if (mfaToken) {
    return (
      <Box>
        <Box sx={{ mb: 3.5 }}>
          <Typography variant="h5" fontWeight={900} sx={{
            mb: 0.5,
            color: '#0f172a',
            letterSpacing: '-0.02em',
            lineHeight: 1.25,
          }}>
            Two-factor verification
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748b', fontWeight: 500 }}>
            Enter the 6-digit code from your authenticator app
          </Typography>
        </Box>

        {error && (
          <Alert
            severity="error"
            sx={{
              mb: 3,
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

        <Box component="form" onSubmit={handleMfaSubmit}>
          <TextField
            fullWidth
            placeholder="123456"
            inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6 }}
            required
            autoFocus
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            sx={{ ...clayField, mb: 3.5 }}
            variant="outlined"
          />
          <Button
            fullWidth
            type="submit"
            variant="contained"
            size="large"
            disabled={loading || mfaCode.length !== 6}
            sx={{
              py: 1.65,
              borderRadius: '16px',
              background: 'linear-gradient(145deg, #3b82f6 0%, #2563EB 100%)',
              color: '#fff',
              fontSize: 15.5,
              fontWeight: 800,
              textTransform: 'none',
              border: 'none',
            }}
          >
            {loading ? 'Verifying…' : 'Verify →'}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      {/* Heading */}
      <Box sx={{ mb: 3.5 }}>
        <Typography variant="h5" fontWeight={900} sx={{
          mb: 0.5,
          color: '#0f172a',
          letterSpacing: '-0.02em',
          lineHeight: 1.25,
        }}>
          Welcome back 👋
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748b', fontWeight: 500 }}>
          Sign in with your email or User ID
        </Typography>
      </Box>

      {/* Error — clay style */}
      {error && (
        <Alert
          severity="error"
          sx={{
            mb: 3,
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
        <TextField
          fullWidth
          placeholder="Email or User ID"
          type="text"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          sx={clayField}
          autoComplete="username"
          autoFocus
          variant="outlined"
        />

        <TextField
          fullWidth
          placeholder="Password"
          required
          type={showPassword ? 'text' : 'password'}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          sx={{ ...clayField, mb: 3.5 }}
          autoComplete="current-password"
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => setShowPassword(!showPassword)}
                  edge="end"
                  size="small"
                >
                  {showPassword
                    ? <VisibilityOff fontSize="small" />
                    : <Visibility fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
          variant="outlined"
        />

        {/* Clay Sign in button */}
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
              boxShadow: '0 4px 0 rgba(30,58,138,0.35), 0 6px 14px rgba(37,99,235,0.25)',
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
              <span style={{ fontWeight: 700 }}>Signing in…</span>
            </Box>
          ) : 'Sign in →'}
        </Button>

        {/* Divider */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1.5, mb: 3,
        }}>
          <Box sx={{ flex: 1, height: '1.5px', background: 'linear-gradient(to right, transparent, rgba(37,99,235,0.18))' }} />
          <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 600, letterSpacing: 0.8 }}>OR</Typography>
          <Box sx={{ flex: 1, height: '1.5px', background: 'linear-gradient(to left, transparent, rgba(37,99,235,0.18))' }} />
        </Box>

        {/* Footer links */}
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="body2" sx={{ color: '#64748b', fontWeight: 500, mb: 0.5 }}>
            <Link
              component={RouterLink}
              to="/reset-password"
              sx={{
                color: '#2563EB',
                fontWeight: 700,
                textDecoration: 'none',
                '&:hover': {
                  textDecoration: 'underline',
                  color: '#1d4ed8',
                },
              }}
            >
              Forgot your password?
            </Link>
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
