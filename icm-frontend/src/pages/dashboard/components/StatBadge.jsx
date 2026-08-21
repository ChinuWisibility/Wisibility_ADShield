import { Box, Typography, Stack } from '@mui/material';
import { TrendingUp, TrendingDown } from '@mui/icons-material';

/**
 * Reusable stat badge with icon, label, value, subtitle, and optional trend.
 *
 * Props:
 *   icon       — React element (MUI icon)
 *   iconBg     — background color for the icon circle
 *   label      — title/label text
 *   value      — main numeric value (string or number)
 *   subtitle   — secondary text below the value
 *   trend      — { direction: 'up'|'down', value: string, positive: boolean }
 *   sx         — extra sx overrides
 */
export default function StatBadge({ icon, iconBg, label, value, subtitle, trend, sx }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        ...sx,
      }}
    >
      {icon && (
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: '12px',
            background: iconBg || 'rgba(100,180,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          {icon}
        </Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {label && (
          <Typography
            sx={{
              color: '#8898aa',
              fontSize: '0.7rem',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              mb: 0.3,
            }}
          >
            {label}
          </Typography>
        )}
        <Typography
          sx={{
            color: '#e8edf5',
            fontSize: '1.5rem',
            fontWeight: 800,
            lineHeight: 1.1,
          }}
        >
          {value}
        </Typography>
        {subtitle && (
          <Typography
            sx={{
              color: '#6b7a8d',
              fontSize: '0.7rem',
              fontWeight: 500,
              mt: 0.3,
            }}
          >
            {subtitle}
          </Typography>
        )}
        {trend && (
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5 }}>
            {trend.direction === 'up' ? (
              <TrendingUp sx={{ fontSize: 14, color: trend.positive ? '#00cc88' : '#ff4444' }} />
            ) : (
              <TrendingDown sx={{ fontSize: 14, color: trend.positive ? '#00cc88' : '#ff4444' }} />
            )}
            <Typography
              sx={{
                fontSize: '0.68rem',
                fontWeight: 700,
                color: trend.positive ? '#00cc88' : '#ff4444',
              }}
            >
              {trend.value}
            </Typography>
          </Stack>
        )}
      </Box>
    </Box>
  );
}
