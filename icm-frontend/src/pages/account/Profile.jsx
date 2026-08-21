import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Paper,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  InputAdornment,
  IconButton,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { authAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { palette } from '../../theme/palette';

/** E.164-ish: optional +, then 8–15 digits starting 1–9 (spaces/dashes stripped). */
function normalizePhone(value) {
  return String(value || '').replace(/[\s()-]/g, '');
}

function isValidPhoneNumber(value) {
  const normalized = normalizePhone(value);
  if (!normalized) return true; // optional
  return /^\+?[1-9]\d{7,14}$/.test(normalized);
}

function apiErrorMessage(err, fallback) {
  return (
    err.response?.data?.error?.message ||
    err.response?.data?.message ||
    err.response?.data?.errors?.[0]?.message ||
    fallback
  );
}

/** Hide Edge/IE native password reveal so it doesn't stack with our eye icon. */
const passwordFieldSx = {
  '& .MuiOutlinedInput-root': { borderRadius: 1.5 },
  '& input::-ms-reveal': { display: 'none' },
  '& input::-ms-clear': { display: 'none' },
  '& input::-webkit-credentials-auto-fill-button': {
    visibility: 'hidden',
    display: 'none',
    pointerEvents: 'none',
  },
};

export default function Profile() {
  const { user, logout, refreshProfile } = useAuth();
  const { enqueueSnackbar } = useSnackbar();

  const [profile, setProfile] = useState({
    firstName: '',
    lastName: '',
    email: '',
    department: '',
    phoneNumber: '',
  });
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [phoneFieldError, setPhoneFieldError] = useState('');

  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    next: false,
    confirm: false,
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [useOtp, setUseOtp] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const OTP_LENGTH = 6;
  const otpInputsRef = useRef([]);

  const resetPasswordDialogState = () => {
    setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setShowPasswords({ current: false, next: false, confirm: false });
    setPasswordError('');
    setPasswordSuccess('');
    setOtpCode('');
    setOtpRequested(false);
    setSendingCode(false);
    setUseOtp(false);
  };

  const handleSendOtpCode = async () => {
    setPasswordError('');
    setSendingCode(true);
    try {
      await authAPI.requestPasswordOtp(profile.email, 'change');
      setOtpRequested(true);
      setOtpCode('');
      enqueueSnackbar('If your email is valid, a verification code has been sent.', {
        variant: 'info',
      });
      // Focus first OTP box after send
      setTimeout(() => otpInputsRef.current[0]?.focus?.(), 50);
    } catch (err) {
      setPasswordError(apiErrorMessage(err, 'We were unable to send a verification code. Try again shortly.'));
    } finally {
      setSendingCode(false);
    }
  };

  const fetchProfile = useCallback(async () => {
    setLoadingProfile(true);
    setProfileError('');
    try {
      const res = await authAPI.getProfile();
      const data = res.data.data;
      setProfile({
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        email: data.email || '',
        department: data.department || '',
        phoneNumber: data.phoneNumber || '',
      });
    } catch (err) {
      setProfileError(apiErrorMessage(err, 'Failed to load profile'));
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleProfileChange = (field, value) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
    if (field === 'phoneNumber') setPhoneFieldError('');
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setProfileError('');
    setPhoneFieldError('');

    if (!profile.firstName?.trim() || profile.firstName.trim().length < 2) {
      setProfileError('First name must be between 2 and 50 characters');
      return;
    }
    if (!profile.lastName?.trim() || profile.lastName.trim().length < 2) {
      setProfileError('Last name must be between 2 and 50 characters');
      return;
    }
    if (!isValidPhoneNumber(profile.phoneNumber)) {
      setPhoneFieldError('Invalid phone number');
      setProfileError('Invalid phone number');
      return;
    }

    setSavingProfile(true);
    try {
      const payload = {
        firstName: profile.firstName.trim(),
        lastName: profile.lastName.trim(),
        department: profile.department?.trim() || '',
        phoneNumber: normalizePhone(profile.phoneNumber),
      };
      const res = await authAPI.updateProfile(payload);
      const updated = res.data.data;
      setProfile({
        firstName: updated.firstName || '',
        lastName: updated.lastName || '',
        email: updated.email || profile.email,
        department: updated.department || '',
        phoneNumber: updated.phoneNumber || '',
      });
      if (typeof refreshProfile === 'function') {
        await refreshProfile();
      }
      enqueueSnackbar('Profile updated successfully', { variant: 'success' });
    } catch (err) {
      setProfileError(apiErrorMessage(err, 'Failed to update profile'));
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordChange = (field, value) => {
    setPasswords((prev) => ({ ...prev, [field]: value }));
    setPasswordError('');
    setPasswordSuccess('');
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!useOtp) {
      if (!passwords.currentPassword || !passwords.newPassword) {
        setPasswordError('Please enter your current and new password.');
        return;
      }
      if (passwords.newPassword !== passwords.confirmPassword) {
        setPasswordError('New password and confirmation do not match.');
        return;
      }
      setChangingPassword(true);
      setPasswordError('');
      setPasswordSuccess('');
      try {
        await authAPI.changePassword({
          oldPassword: passwords.currentPassword,
          newPassword: passwords.newPassword,
        });
        setPasswordSuccess('Password changed successfully. You will use the new password on next login.');
        setPasswords({
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        });
        enqueueSnackbar('Password changed successfully', { variant: 'success' });
        setPasswordDialogOpen(false);
      } catch (err) {
        setPasswordError(apiErrorMessage(err, 'Failed to change password'));
      } finally {
        setChangingPassword(false);
      }
    } else {
      if (otpCode.length !== OTP_LENGTH || !passwords.newPassword || !passwords.confirmPassword) {
        setPasswordError('Please enter the full verification code and your new password.');
        return;
      }
      if (passwords.newPassword !== passwords.confirmPassword) {
        setPasswordError('New password and confirmation do not match.');
        return;
      }
      setChangingPassword(true);
      setPasswordError('');
      setPasswordSuccess('');
      try {
        await authAPI.resetPasswordWithOtp({
          email: profile.email,
          otpCode,
          newPassword: passwords.newPassword,
        });
        setPasswordSuccess('Password changed successfully using email code.');
        setOtpCode('');
        setPasswords({
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        });
        enqueueSnackbar('Password changed successfully', { variant: 'success' });
        setPasswordDialogOpen(false);
      } catch (err) {
        setPasswordError(apiErrorMessage(err, 'Failed to change password using code'));
      } finally {
        setChangingPassword(false);
      }
    }
  };

  const handleDialogOtpChange = (index, value) => {
    if (!/^\d?$/.test(value)) return;

    const otpArray = otpCode.split('');
    otpArray[index] = value;
    const nextOtp = otpArray.join('').slice(0, OTP_LENGTH);
    setOtpCode(nextOtp);

    if (value && index < OTP_LENGTH - 1) {
      const nextInput = otpInputsRef.current[index + 1];
      if (nextInput) nextInput.focus();
    }
  };

  const handleDialogOtpKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !otpCode[index] && index > 0) {
      const prevInput = otpInputsRef.current[index - 1];
      if (prevInput) prevInput.focus();
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            My Profile
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage your personal details and password for the ADSecurity IGA platform.
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" align="right">
            Signed in as
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {user?.email}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Role: {user?.role}
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              borderRadius: 3,
              border: `1px solid ${palette.border?.default || '#e2e8f0'}`,
              background:
                'linear-gradient(135deg, rgba(248,250,252,0.96), rgba(241,245,249,0.96))',
            }}
          >
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Personal information
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
              These details are used across dashboards, notifications and approvals.
            </Typography>

            {profileError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {profileError}
              </Alert>
            )}

            <Box
              component="form"
              onSubmit={handleSaveProfile}
              sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}
            >
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <TextField
                  label="First name"
                  value={profile.firstName}
                  onChange={(e) => handleProfileChange('firstName', e.target.value)}
                  size="small"
                  required
                  fullWidth
                />
                <TextField
                  label="Last name"
                  value={profile.lastName}
                  onChange={(e) => handleProfileChange('lastName', e.target.value)}
                  size="small"
                  required
                  fullWidth
                />
              </Box>

              <TextField
                label="Email"
                type="email"
                value={profile.email}
                size="small"
                required
                fullWidth
                disabled
                helperText="Email cannot be changed from this page."
              />

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <TextField
                  label="Department"
                  value={profile.department}
                  onChange={(e) => handleProfileChange('department', e.target.value)}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Phone number"
                  value={profile.phoneNumber}
                  onChange={(e) => handleProfileChange('phoneNumber', e.target.value)}
                  size="small"
                  fullWidth
                  error={Boolean(phoneFieldError)}
                  helperText={phoneFieldError || 'Use international format, e.g. +15551234567'}
                  placeholder="+15551234567"
                />
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={savingProfile || loadingProfile}
                >
                  {savingProfile ? 'Saving…' : 'Save changes'}
                </Button>
              </Box>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={5}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              borderRadius: 3,
              border: `1px solid ${palette.border?.default || '#e2e8f0'}`,
              backgroundColor: '#0f172a',
              color: '#e5e7eb',
            }}
          >
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Security
            </Typography>
            <Typography
              variant="caption"
              sx={{ mb: 2, display: 'block', color: '#9ca3af', lineHeight: 1.5 }}
            >
              Keep your ADSecurity IGA account secure by using a strong, unique password.
            </Typography>
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => {
                resetPasswordDialogState();
                setPasswordDialogOpen(true);
              }}
            >
              Change password
            </Button>
          </Paper>
        </Grid>
      </Grid>

      <Dialog
        open={passwordDialogOpen}
        onClose={changingPassword ? undefined : () => {
          setPasswordDialogOpen(false);
          resetPasswordDialogState();
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle sx={{ pb: 1, pt: 2.5, px: 3 }}>
          <Typography variant="h6" fontWeight={800} sx={{ letterSpacing: '-0.02em' }}>
            {useOtp ? 'Reset with email code' : 'Change password'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, fontWeight: 400 }}>
            {useOtp
              ? otpRequested
                ? 'Enter the 6-digit code from your email, then choose a new password.'
                : 'We will send a one-time code to your account email.'
              : 'Enter your current password, then choose a new one.'}
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ px: 3, pt: 1.5, pb: 1 }}>
          {passwordError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPasswordError('')}>
              {passwordError}
            </Alert>
          )}
          {passwordSuccess && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {passwordSuccess}
            </Alert>
          )}

          <Box
            component="form"
            onSubmit={handleChangePassword}
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            {!useOtp && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: (t) => (t.palette.mode === 'dark' ? 'action.hover' : '#f8fafc'),
                  borderColor: 'divider',
                }}
              >
                <Typography
                  variant="caption"
                  fontWeight={700}
                  color="text.secondary"
                  sx={{ letterSpacing: 0.4, display: 'block', mb: 1.25 }}
                >
                  VERIFY IT’S YOU
                </Typography>
                <TextField
                  label="Current password"
                  type={showPasswords.current ? 'text' : 'password'}
                  size="small"
                  value={passwords.currentPassword}
                  onChange={(e) => handlePasswordChange('currentPassword', e.target.value)}
                  fullWidth
                  autoFocus
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          edge="end"
                          aria-label={showPasswords.current ? 'Hide current password' : 'Show current password'}
                          onClick={() => setShowPasswords((p) => ({ ...p, current: !p.current }))}
                        >
                          {showPasswords.current ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  sx={{
                    ...passwordFieldSx,
                    '& .MuiOutlinedInput-root': {
                      ...passwordFieldSx['& .MuiOutlinedInput-root'],
                      bgcolor: 'background.paper',
                    },
                  }}
                />
              </Paper>
            )}

            {useOtp && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: (t) => (t.palette.mode === 'dark' ? 'action.hover' : '#f8fafc'),
                  borderColor: 'divider',
                }}
              >
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 0.4 }}>
                  ACCOUNT EMAIL
                </Typography>
                <Typography variant="body2" fontWeight={600} sx={{ mt: 0.5, mb: 1.75 }}>
                  {profile.email || '—'}
                </Typography>

                {!otpRequested ? (
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={handleSendOtpCode}
                    disabled={sendingCode || !profile.email}
                    sx={{ textTransform: 'none', fontWeight: 700, py: 1.1 }}
                  >
                    {sendingCode ? 'Sending code…' : 'Send verification code'}
                  </Button>
                ) : (
                  <>
                    <Alert severity="success" variant="outlined" sx={{ mb: 2, py: 0.5 }}>
                      Code sent. Check your inbox (and spam folder).
                    </Alert>
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      VERIFICATION CODE
                    </Typography>
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: { xs: 0.75, sm: 1 },
                        mb: 1.25,
                      }}
                    >
                      {Array.from({ length: OTP_LENGTH }).map((_, index) => (
                        <TextField
                          key={index}
                          size="small"
                          inputRef={(el) => {
                            otpInputsRef.current[index] = el;
                          }}
                          value={otpCode[index] || ''}
                          onChange={(e) => handleDialogOtpChange(index, e.target.value)}
                          onKeyDown={(e) => handleDialogOtpKeyDown(index, e)}
                          onPaste={(e) => {
                            const pasted = e.clipboardData
                              .getData('text')
                              .replace(/\D/g, '')
                              .slice(0, OTP_LENGTH);
                            if (!pasted) return;
                            e.preventDefault();
                            setOtpCode(pasted);
                            const targetIndex = Math.min(pasted.length - 1, OTP_LENGTH - 1);
                            const targetInput = otpInputsRef.current[targetIndex];
                            if (targetInput) targetInput.focus();
                          }}
                          inputProps={{
                            maxLength: 1,
                            inputMode: 'numeric',
                            'aria-label': `Digit ${index + 1}`,
                            style: {
                              textAlign: 'center',
                              fontSize: '1.25rem',
                              fontWeight: 700,
                              padding: '10px 0',
                            },
                          }}
                          sx={{
                            flex: 1,
                            maxWidth: 52,
                            '& .MuiOutlinedInput-root': {
                              borderRadius: 1.5,
                              bgcolor: 'background.paper',
                            },
                          }}
                        />
                      ))}
                    </Box>
                    <Button
                      size="small"
                      onClick={handleSendOtpCode}
                      disabled={sendingCode}
                      sx={{ textTransform: 'none', fontWeight: 600, px: 0 }}
                    >
                      {sendingCode ? 'Resending…' : 'Resend code'}
                    </Button>
                  </>
                )}
              </Paper>
            )}

            {(!useOtp || otpRequested) && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 2,
                  borderColor: 'divider',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <Typography
                  variant="caption"
                  fontWeight={700}
                  color="text.secondary"
                  sx={{ letterSpacing: 0.4 }}
                >
                  NEW PASSWORD
                </Typography>
                <TextField
                  label="New password"
                  type={showPasswords.next ? 'text' : 'password'}
                  size="small"
                  value={passwords.newPassword}
                  onChange={(e) => handlePasswordChange('newPassword', e.target.value)}
                  fullWidth
                  helperText="At least 8 characters. Prefer a unique passphrase."
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          edge="end"
                          aria-label={showPasswords.next ? 'Hide new password' : 'Show new password'}
                          onClick={() => setShowPasswords((p) => ({ ...p, next: !p.next }))}
                        >
                          {showPasswords.next ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  sx={passwordFieldSx}
                />
                <TextField
                  label="Confirm new password"
                  type={showPasswords.confirm ? 'text' : 'password'}
                  size="small"
                  value={passwords.confirmPassword}
                  onChange={(e) => handlePasswordChange('confirmPassword', e.target.value)}
                  fullWidth
                  error={
                    Boolean(passwords.confirmPassword)
                    && passwords.confirmPassword !== passwords.newPassword
                  }
                  helperText={
                    passwords.confirmPassword && passwords.confirmPassword !== passwords.newPassword
                      ? 'Passwords do not match'
                      : ' '
                  }
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          edge="end"
                          aria-label={showPasswords.confirm ? 'Hide confirm password' : 'Show confirm password'}
                          onClick={() => setShowPasswords((p) => ({ ...p, confirm: !p.confirm }))}
                        >
                          {showPasswords.confirm ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  sx={passwordFieldSx}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
                  You may need to sign in again on other devices after this change.
                </Typography>
              </Paper>
            )}
          </Box>
        </DialogContent>

        <DialogActions
          sx={{
            px: 3,
            py: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Button
            size="small"
            color="inherit"
            disabled={changingPassword || sendingCode}
            onClick={() => {
              setUseOtp((prev) => !prev);
              setPasswordError('');
              setPasswordSuccess('');
              setOtpCode('');
              setOtpRequested(false);
              setPasswords((p) => ({ ...p, currentPassword: '' }));
            }}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            {useOtp ? '← Use current password' : "I don't remember my password"}
          </Button>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              onClick={() => {
                setPasswordDialogOpen(false);
                resetPasswordDialogState();
              }}
              disabled={changingPassword}
              sx={{ textTransform: 'none' }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleChangePassword}
              disabled={
                changingPassword
                || (useOtp
                  ? (!otpRequested || otpCode.length !== OTP_LENGTH || !passwords.newPassword || !passwords.confirmPassword || passwords.newPassword !== passwords.confirmPassword)
                  : (!passwords.currentPassword || !passwords.newPassword || !passwords.confirmPassword || passwords.newPassword !== passwords.confirmPassword))
              }
              sx={{ textTransform: 'none', fontWeight: 700, minWidth: 140 }}
            >
              {changingPassword ? 'Updating…' : 'Update password'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

