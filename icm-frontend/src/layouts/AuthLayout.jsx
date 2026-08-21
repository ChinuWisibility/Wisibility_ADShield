import { Box, Typography, Chip, IconButton } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Shield as ShieldIcon,
  Lock as LockIcon,
  Fingerprint as FingerprintIcon,
  Security as SecurityIcon,
  VerifiedUser as VerifiedUserIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import AuthLottiePlayer from '../components/AuthLottiePlayer';
import { BRANDING } from '../constants/branding';
import { useBranding } from '../contexts/BrandingContext';

const CYBER_FEATURES = [
  { icon: <ShieldIcon sx={{ fontSize: 14 }} />, label: 'Zero-Trust Architecture' },
  { icon: <LockIcon sx={{ fontSize: 14 }} />, label: 'AES-256 Encryption' },
  { icon: <VerifiedUserIcon sx={{ fontSize: 14 }} />, label: 'SOC 2 Compliant' },
];

const clayStyles = `
  @keyframes floatBlob1 {
    0%, 100% { transform: translateY(0px) scale(1); }
    50% { transform: translateY(-22px) scale(1.04); }
  }
  @keyframes floatBlob2 {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(18px) rotate(8deg); }
  }
  @keyframes floatBlob3 {
    0%, 100% { transform: translateY(0px) scale(1); }
    60% { transform: translateY(-14px) scale(0.96); }
  }
  @keyframes floatCard {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
  }
  @keyframes spinSlow {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes bounceDot {
    0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
    40% { transform: scale(1.2); opacity: 1; }
  }
`;

export default function AuthLayout() {
  const { branding } = useBranding();
  const brandColor = branding.primaryColor || '#2563EB';
  const location = useLocation();
  const navigate = useNavigate();

  const isLoginPage = location.pathname === '/login';

  const handleBack = () => {
    navigate('/login');
  };

  return (
    <>
      <style>{clayStyles}</style>
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          // Unified background so left + right don’t feel separated
          background: 'linear-gradient(160deg, #f8fafc 0%, #eef2ff 45%, #e0e7ff 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* ══════════════════════════════════════
            LEFT PANEL — Illustration & hero
        ══════════════════════════════════════ */}
        <Box
          sx={{
            flex: '0 0 60%',
            display: { xs: 'none', md: 'flex' },
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
            // Transparent so it blends with the shared app background
            background: 'transparent',
            px: 6,
            py: 6,
          }}
        >
          {/* Clay blobs — decorative puffy shapes */}
          <Box sx={{
            position: 'absolute', top: '-60px', left: '-60px',
            width: 260, height: 260, borderRadius: '60% 40% 70% 30% / 50% 60% 40% 50%',
            background: 'rgba(255,255,255,0.12)',
            boxShadow: 'inset 0 -8px 20px rgba(0,0,0,0.1), 0 20px 40px rgba(0,0,0,0.15)',
            animation: 'floatBlob1 6s ease-in-out infinite',
          }} />
          <Box sx={{
            position: 'absolute', bottom: '-80px', right: '-50px',
            width: 300, height: 300, borderRadius: '40% 60% 30% 70% / 60% 40% 70% 30%',
            background: 'rgba(255,255,255,0.1)',
            boxShadow: 'inset 0 -8px 20px rgba(0,0,0,0.08), 0 16px 32px rgba(0,0,0,0.12)',
            animation: 'floatBlob2 8s ease-in-out infinite',
          }} />
          <Box sx={{
            position: 'absolute', top: '40%', right: '-30px',
            width: 160, height: 160, borderRadius: '50% 50% 40% 60% / 40% 70% 30% 60%',
            background: 'rgba(59,130,246,0.2)',
            boxShadow: 'inset 0 -6px 16px rgba(0,0,0,0.08)',
            animation: 'floatBlob3 7s ease-in-out infinite',
          }} />
          <Box sx={{
            position: 'absolute', bottom: '25%', left: '-20px',
            width: 120, height: 120, borderRadius: '60% 40% 50% 50% / 50% 40% 60% 50%',
            background: 'rgba(255,255,255,0.15)',
            boxShadow: 'inset 0 -4px 12px rgba(0,0,0,0.1)',
            animation: 'floatBlob1 9s ease-in-out infinite 1s',
          }} />

          {/* Small floating dots */}
          {[
            { top: '18%', left: '20%', size: 14, delay: '0s' },
            { top: '70%', left: '35%', size: 10, delay: '0.5s' },
            { top: '32%', right: '20%', size: 12, delay: '1s' },
            { top: '80%', right: '30%', size: 8, delay: '0.3s' },
          ].map((dot, i) => (
            <Box key={i} sx={{
              position: 'absolute',
              top: dot.top, left: dot.left, right: dot.right,
              width: dot.size, height: dot.size,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.5)',
              boxShadow: '0 4px 8px rgba(0,0,0,0.15), inset 0 -2px 4px rgba(0,0,0,0.1)',
              animation: `floatBlob3 ${5 + i}s ease-in-out infinite ${dot.delay}`,
            }} />
          ))}

          {/* Brand header */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              mb: 3,
              zIndex: 1,
              alignSelf: 'flex-start',
            }}
          >
            {/* Clay icon bubble */}
            <Box sx={{
              width: 46, height: 46, borderRadius: '14px',
              background: 'linear-gradient(145deg, #fff, #eef2ff)',
              boxShadow: '0 8px 0 rgba(30,58,138,0.35), 0 12px 20px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.9)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <SecurityIcon sx={{ color: '#2563EB', fontSize: 22 }} />
            </Box>
            <Typography
              variant="h6"
              fontWeight={800}
              sx={{
                color: '#0f172a',
                letterSpacing: 0.2,
              }}
            >
              {branding.companyName || BRANDING.name}
            </Typography>
          </Box>

          {/* Lottie illustration — free-floating, no hard container */}
          <Box
            sx={{
              width: '100%',
              maxWidth: 420,
              zIndex: 1,
              mb: 4,
              animation: 'floatCard 5s ease-in-out infinite',
            }}
          >
            <AuthLottiePlayer animationPath="/lottie/login.json" height={500} />
          </Box>

          {/* Headline */}
          {/* <Typography
            variant="h4"
            fontWeight={900}
            sx={{
              color: '#0f172a',
              textAlign: 'center',
              mb: 1.5,
              zIndex: 1,
              lineHeight: 1.25,
              letterSpacing: '-0.01em',
            }}
          >
            Secure Identity &<br />Access Management
          </Typography> */}

          {/* <Typography
            variant="body2"
            sx={{
              color: '#4b5563',
              textAlign: 'center',
              mb: 3.5,
              zIndex: 1,
              maxWidth: 360,
              lineHeight: 1.8,
            }}
          >
            Enterprise-grade governance with end-to-end visibility, compliance automation,
            and real-time threat detection.
          </Typography> */}

          {/* Feature chips — clay style */}
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', justifyContent: 'center', zIndex: 1 }}>
            {CYBER_FEATURES.map((f) => (
              <Chip
                key={f.label}
                icon={f.icon}
                label={f.label}
                size="small"
                sx={{
                  bgcolor: '#fff',
                  border: 'none',
                  color: '#1e3a8a',
                  '& .MuiChip-icon': { color: '#2563EB' },
                  fontSize: 11.5,
                  fontWeight: 700,
                  px: 0.75,
                  py: 0.25,
                  borderRadius: '12px',
                  boxShadow: '0 4px 0 rgba(30,58,138,0.25), 0 6px 12px rgba(0,0,0,0.1)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: '0 6px 0 rgba(30,58,138,0.25), 0 10px 16px rgba(0,0,0,0.12)',
                  },
                }}
              />
            ))}
          </Box>
        </Box>

        {/* ══════════════════════════════════════
            RIGHT PANEL — White, clean, professional
        ══════════════════════════════════════ */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            p: { xs: 2, sm: 4 },
            // Transparent so it sits on the same shared gradient as the left
            background: 'transparent',
            position: 'relative',
            overflow: 'hidden',
            height: '100vh',       /* ← lock height so no page scrollbar */
          }}
        >
          {/* Subtle bg decorations */}
          <Box sx={{
            position: 'absolute', top: '-40px', right: '-40px',
            width: 200, height: 200,
            borderRadius: '50% 40% 60% 50% / 60% 50% 40% 50%',
            background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(124,58,237,0.08))',
            animation: 'floatBlob1 8s ease-in-out infinite',
          }} />
          <Box sx={{
            position: 'absolute', bottom: '10%', left: '-30px',
            width: 150, height: 150,
            borderRadius: '40% 60% 50% 50% / 50% 40% 60% 50%',
            background: 'rgba(37,99,235,0.08)',
            animation: 'floatBlob2 10s ease-in-out infinite',
          }} />

          {/* Main Clay Card — fixed height so no page scrollbar on form switch */}
          <Box
            sx={{
              width: '100%',
              maxWidth: 480,
              maxHeight: 'calc(100vh - 48px)',
              overflowY: 'auto',
              position: 'relative',
              zIndex: 1,
              background: '#ffffff',
              borderRadius: '28px',
              boxShadow: `
                0 16px 0 rgba(37, 99, 235, 0.22),
                0 24px 48px rgba(0, 0, 0, 0.10),
                inset 0 2px 0 rgba(255,255,255,0.9)
              `,
              border: '1.5px solid rgba(37,99,235,0.15)',
              p: { xs: 3.5, sm: 5 },
              /* Thin teal scrollbar inside the card */
              '&::-webkit-scrollbar': { width: 5 },
              '&::-webkit-scrollbar-track': { background: 'transparent' },
              '&::-webkit-scrollbar-thumb': {
                background: 'rgba(37,99,235,0.3)',
                borderRadius: 99,
              },
              '&::-webkit-scrollbar-thumb:hover': {
                background: 'rgba(37,99,235,0.55)',
              },
            }}
          >
            {/* Back button */}
            {!isLoginPage && (
              <Box sx={{ mb: 2, ml: -1 }}>
                <IconButton
                  onClick={handleBack}
                  sx={{
                    color: 'text.primary',
                    p: 0.5,
                    '&:hover': { bgcolor: 'action.hover' }
                  }}
                  aria-label="Go back"
                >
                  <ArrowBackIcon />
                </IconButton>
              </Box>
            )}

            {/* Logo area */}
            <Box sx={{ textAlign: 'center', mb: 4 }}>
              {branding.logoUrl ? (
                <Box
                  component="img"
                  src={branding.logoUrl}
                  alt={branding.companyName || BRANDING.name}
                  sx={{ height: 52, maxWidth: 200, objectFit: 'contain', mb: 1.5 }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              ) : (
                <Box sx={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 58, height: 58, borderRadius: '18px', mb: 1.5,
                  background: 'linear-gradient(145deg, #3b82f6, #2563EB)',
                  boxShadow: '0 8px 0 rgba(30,58,138,0.3), 0 12px 24px rgba(37,99,235,0.25), inset 0 2px 0 rgba(255,255,255,0.3)',
                }}>
                  <FingerprintIcon sx={{ color: '#fff', fontSize: 30 }} />
                </Box>
              )}
              <Typography variant="h6" fontWeight={800} sx={{
                color: '#0f172a',
                letterSpacing: 0.1,
              }}>
                {branding.companyName || BRANDING.name}
              </Typography>
            </Box>

            <Outlet />

            <Typography variant="caption" sx={{
              color: '#94a3b8',
              mt: 4, textAlign: 'center', display: 'block',
              letterSpacing: 0.4,
              fontWeight: 500,
            }}>
              {BRANDING.copyright} · {BRANDING.domain}
            </Typography>
          </Box>
        </Box>
      </Box>
    </>
  );
}
