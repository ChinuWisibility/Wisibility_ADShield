import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  InputAdornment,
  IconButton,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { authAPI } from '../../services/api';

/** Hide Edge/Chrome native password reveal so it doesn't stack with our eye icon. */
const passwordFieldSx = {
  mb: 2,
  '& input::-ms-reveal': { display: 'none' },
  '& input::-ms-clear': { display: 'none' },
  '& input::-webkit-credentials-auto-fill-button': {
    visibility: 'hidden',
    display: 'none',
    pointerEvents: 'none',
  },
};

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [otp, setOtp] = useState('');
  const [passwords, setPasswords] = useState({ newPassword: '', confirmPassword: '' });
  const [showPasswords, setShowPasswords] = useState({ next: false, confirm: false });

  const OTP_LENGTH = 6;
  const OTP_GENERIC_MESSAGE =
    'If an account exists for this email, a one-time code will be sent shortly.';
  const otpInputsRef = useRef([]);

  const currentTitle =
    step === 1
      ? 'Reset your password'
      : step === 2
        ? 'Check your email'
        : 'Choose a new password';

  const currentSubtitle =
    step === 1
      ? 'Enter your work email and we’ll send you a secure one-time code to reset your password.'
      : step === 2
        ? 'Enter the verification code we emailed you to continue.'
        : 'Create a strong password that you don’t use anywhere else.';

  const passwordsMatch =
    !passwords.confirmPassword || passwords.confirmPassword === passwords.newPassword;
  const canSubmitNewPassword =
    passwords.newPassword.length >= 8
    && passwords.confirmPassword
    && passwordsMatch;

  const handleRequestCode = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage('');
    setError('');
    try {
      await authAPI.requestPasswordOtp(email, 'forgot');
    } catch {
      // Ignore transport/API errors for enumeration safety.
    } finally {
      setMessage(OTP_GENERIC_MESSAGE);
      setStep(2);
      setSubmitting(false);
    }
  };

  const handleConfirmCode = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!otp || otp.length !== OTP_LENGTH) {
      setError(`Please enter the ${OTP_LENGTH}-digit verification code sent to your email.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await authAPI.verifyPasswordOtp(email, otp, 'forgot');
      setMessage(
        res.data?.data?.message ||
        'Code verified. You can now create a new password.'
      );
      setStep(3);
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
        'Invalid or expired code. Please check the code and try again, or request a new one.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (!/^\d?$/.test(value)) return;

    const otpArray = otp.split('');
    otpArray[index] = value;
    const nextOtp = otpArray.join('').slice(0, OTP_LENGTH);
    setOtp(nextOtp);

    if (value && index < OTP_LENGTH - 1) {
      const nextInput = otpInputsRef.current[index + 1];
      if (nextInput) nextInput.focus();
    }
  };

  const handleOtpKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !otp[index] && index > 0) {
      const prevInput = otpInputsRef.current[index - 1];
      if (prevInput) prevInput.focus();
    }
  };

  const handleResetWithCode = async (e) => {
    e.preventDefault();
    if (!passwords.newPassword || !passwords.confirmPassword) {
      setError('Please enter and confirm your new password.');
      return;
    }
    if (passwords.newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (passwords.newPassword !== passwords.confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await authAPI.resetPasswordWithOtp({
        email,
        otpCode: otp,
        newPassword: passwords.newPassword,
      });
      setMessage('Your password has been reset successfully. Redirecting you to sign in…');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
        'We were unable to reset your password. Please request a new code and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 3.5 }}>
        <Typography variant="h5" fontWeight={900} sx={{ mb: 0.5 }}>
          {currentTitle}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {currentSubtitle}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {message && (
        <Alert severity="success" sx={{ mb: 2 }} data-testid="password-otp-generic-message">
          {message}
        </Alert>
      )}

      {step === 1 && (
        <Box component="form" onSubmit={handleRequestCode}>
          <TextField
            fullWidth
            label="Work email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            sx={{ mb: 2.5 }}
          />
          <Button
            fullWidth
            type="submit"
            variant="contained"
            disabled={submitting || !email}
            sx={{ textTransform: 'none', fontWeight: 700, py: 1.25 }}
          >
            {submitting ? 'Sending code…' : 'Send code'}
          </Button>
        </Box>
      )}

      {step === 2 && (
        <Box component="form" onSubmit={handleConfirmCode}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              gap: 1,
              mb: 1.5,
            }}
          >
            {Array.from({ length: OTP_LENGTH }).map((_, index) => (
              <TextField
                key={index}
                inputRef={(el) => {
                  otpInputsRef.current[index] = el;
                }}
                value={otp[index] || ''}
                onChange={(e) => handleOtpChange(index, e.target.value)}
                onKeyDown={(e) => handleOtpKeyDown(index, e)}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
                  if (!pasted) return;
                  e.preventDefault();
                  setOtp(pasted);
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
                    fontSize: '1.3rem',
                    fontWeight: 700,
                    padding: '10px 0',
                  },
                }}
                sx={{ width: 48 }}
              />
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2.5 }}>
            Enter the 6-digit code we emailed you. It expires after a short time for security.
          </Typography>
          <Button
            fullWidth
            type="submit"
            variant="contained"
            disabled={submitting || otp.length !== OTP_LENGTH}
            sx={{ textTransform: 'none', fontWeight: 700, py: 1.25 }}
          >
            {submitting ? 'Verifying…' : 'Continue'}
          </Button>
        </Box>
      )}

      {step === 3 && (
        <Box component="form" onSubmit={handleResetWithCode}>
          <TextField
            fullWidth
            label="New password"
            type={showPasswords.next ? 'text' : 'password'}
            autoComplete="new-password"
            value={passwords.newPassword}
            onChange={(e) => {
              setError('');
              setPasswords((p) => ({ ...p, newPassword: e.target.value }));
            }}
            helperText="Use at least 8 characters, with a mix of letters, numbers, and symbols."
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
            fullWidth
            label="Confirm new password"
            type={showPasswords.confirm ? 'text' : 'password'}
            autoComplete="new-password"
            value={passwords.confirmPassword}
            onChange={(e) => {
              setError('');
              setPasswords((p) => ({ ...p, confirmPassword: e.target.value }));
            }}
            error={Boolean(passwords.confirmPassword) && !passwordsMatch}
            helperText={
              passwords.confirmPassword && !passwordsMatch
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
            sx={{ ...passwordFieldSx, mb: 2.5 }}
          />
          <Button
            fullWidth
            type="submit"
            variant="contained"
            disabled={submitting || !canSubmitNewPassword}
            sx={{ textTransform: 'none', fontWeight: 700, py: 1.25 }}
          >
            {submitting ? 'Updating password…' : 'Update password'}
          </Button>
        </Box>
      )}
    </Box>
  );
}
