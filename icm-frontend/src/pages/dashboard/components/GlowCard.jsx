import { Box } from '@mui/material';

/**
 * Dark glassmorphism card with subtle glow border and hover lift.
 * Props:
 *   sx        — extra MUI sx overrides
 *   children  — card content
 *   glow      — optional glow color override (default cyan-ish)
 *   noPad     — if true, removes default padding
 */
export default function GlowCard({ children, sx, glow, noPad, ...rest }) {
  return (
    <Box
      {...rest}
      sx={{
        background: '#ffffff',
        border: `1px solid rgba(0,0,0,0.08)`,
        borderRadius: '12px',
        padding: noPad ? 0 : '20px',
        boxShadow: `0 4px 24px rgba(0,0,0,0.04)`,
        transition: 'all 0.3s ease',
        position: 'relative',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: `0 8px 32px rgba(0,0,0,0.08)`,
          borderColor: 'rgba(0,0,0,0.12)',
        },
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}
