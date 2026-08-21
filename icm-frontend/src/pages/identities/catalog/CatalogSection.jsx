import React from 'react';
import { Box, Typography } from '@mui/material';
import { CATALOG, catalogLabelSx, catalogPanelSx } from './catalogTheme';

/**
 * Catalog section chrome — eyebrow + title + optional actions, ops-panel body.
 */
export default function CatalogSection({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  sx,
  bodySx,
  dense = false,
}) {
  return (
    <Box sx={{ ...catalogPanelSx, ...sx }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          px: dense ? 2 : 2.5,
          py: dense ? 1.5 : 1.75,
          borderBottom: `1px solid ${CATALOG.border}`,
          background: `linear-gradient(90deg, ${CATALOG.accentSoft} 0%, ${CATALOG.surface} 42%)`,
          borderLeft: `3px solid ${CATALOG.accent}`,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          {eyebrow && (
            <Typography sx={{ ...catalogLabelSx, mb: 0.35, color: CATALOG.accent }}>
              {eyebrow}
            </Typography>
          )}
          {title && (
            <Typography
              sx={{
                fontWeight: 600,
                fontSize: dense ? '0.95rem' : '1.05rem',
                color: CATALOG.ink,
                letterSpacing: '-0.01em',
                lineHeight: 1.25,
              }}
            >
              {title}
            </Typography>
          )}
          {subtitle && (
            <Typography variant="body2" sx={{ color: CATALOG.inkFaint, mt: 0.35, fontSize: '0.8rem', fontWeight: 400 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {actions ? <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1 }}>{actions}</Box> : null}
      </Box>
      <Box sx={{ p: dense ? 2 : 2.5, ...bodySx }}>{children}</Box>
    </Box>
  );
}
