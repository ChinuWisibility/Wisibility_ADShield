import { useMemo, useState } from 'react';
import {
  Box,
  Collapse,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import { postureCardAnimate } from './identityPostureTheme';
import { IDENTITY_ATTRIBUTES_TITLE } from '../identityPostureLabels';

function AttributeCheck({ label, ok }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        py: 0.75,
        animation: 'attrCheckIn 0.4s ease-out both',
        '@keyframes attrCheckIn': {
          from: { opacity: 0, transform: 'translateX(-8px)' },
          to: { opacity: 1, transform: 'translateX(0)' },
        },
      }}
    >
      {ok ? (
        <CheckCircleIcon sx={{ fontSize: 22, color: '#22c55e' }} />
      ) : (
        <CancelIcon sx={{ fontSize: 22, color: '#ef4444' }} />
      )}
      <Typography variant="body1" sx={{ fontWeight: 500, fontSize: '0.95rem' }}>
        {label}
      </Typography>
    </Box>
  );
}

export default function IdentityAttributesPostureCard({
  attributeChecks,
  animateIndex = 4,
}) {
  const [showAttributes, setShowAttributes] = useState(false);
  const checks = Array.isArray(attributeChecks) ? attributeChecks : [];
  const passCount = useMemo(() => checks.filter((c) => c.ok).length, [checks]);

  return (
    <Paper sx={{ ...postureCardAnimate(animateIndex), p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          mb: showAttributes ? 1.5 : 0,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {IDENTITY_ATTRIBUTES_TITLE}
          </Typography>
          {!showAttributes && checks.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>
              {passCount} of {checks.length} present · click to view
            </Typography>
          )}
        </Box>
        <Tooltip title={showAttributes ? 'Hide attributes' : 'View attributes'}>
          <IconButton
            size="small"
            onClick={() => setShowAttributes((prev) => !prev)}
            aria-label={showAttributes ? 'Hide identity attributes' : 'View identity attributes'}
            aria-expanded={showAttributes}
            sx={{
              color: showAttributes ? 'primary.main' : 'text.secondary',
              bgcolor: showAttributes ? 'action.selected' : 'transparent',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            {showAttributes ? (
              <VisibilityOffOutlinedIcon fontSize="small" />
            ) : (
              <VisibilityOutlinedIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      </Box>

      <Collapse in={showAttributes}>
        {checks.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ pt: 0.5 }}>
            No attributes configured in Identity posture rules.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', pt: 0.5 }}>
            {checks.map((item, i) => (
              <Box key={item.id} sx={{ animationDelay: `${i * 0.08}s` }}>
                <AttributeCheck label={item.label} ok={item.ok} />
              </Box>
            ))}
          </Box>
        )}
      </Collapse>
    </Paper>
  );
}
