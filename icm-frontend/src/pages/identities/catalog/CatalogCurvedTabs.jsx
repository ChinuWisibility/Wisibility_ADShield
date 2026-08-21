import React, { useEffect, useRef } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { CATALOG } from './catalogTheme';

const TRACK = '#E8EEF5';
const SCOOP = 14;

/**
 * Chrome-style folder tabs with visible concave scoops.
 * Tabs flex to fill the bar; the active tab scrolls into view on click.
 */
export default function CatalogCurvedTabs({ value, onChange, tabs }) {
  const listRef = useRef(null);
  const tabRefs = useRef([]);

  useEffect(() => {
    const el = tabRefs.current[value];
    if (!el) return;
    el.scrollIntoView({
      behavior: 'smooth',
      inline: 'nearest',
      block: 'nearest',
    });
  }, [value]);

  return (
    <Box
      ref={listRef}
      role="tablist"
      sx={{
        display: 'flex',
        alignItems: 'flex-end',
        width: '100%',
        gap: `${SCOOP}px`,
        px: `${SCOOP + 2}px`,
        pt: 1,
        mb: 0,
        bgcolor: TRACK,
        borderRadius: '12px 12px 0 0',
        border: `1px solid ${CATALOG.border}`,
        borderBottom: 'none',
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      {tabs.map((tab, index) => {
        const selected = value === index;
        const showDivider = index > 0;

        return (
          <React.Fragment key={tab.id || index}>
            {showDivider ? (
              <Box
                aria-hidden
                sx={{
                  alignSelf: 'center',
                  width: '1px',
                  height: 22,
                  mb: 0.85,
                  flexShrink: 0,
                  bgcolor: CATALOG.borderStrong || 'rgba(15, 23, 42, 0.18)',
                  opacity: selected || value === index - 1 ? 0.25 : 0.95,
                  transition: 'opacity 0.15s ease',
                }}
              />
            ) : null}
            <ButtonBase
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              role="tab"
              aria-selected={selected}
              onClick={(e) => onChange(e, index)}
              onMouseEnter={tab.onMouseEnter}
              onFocus={tab.onFocus}
              disableRipple
              sx={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.75,
                // Share bar width; grow/shrink with content when selected
                flex: '1 1 0',
                minWidth: 'max-content',
                maxWidth: '100%',
                px: { xs: 1.25, md: 1.75 },
                py: 1.2,
                minHeight: 44,
                borderRadius: selected ? `${SCOOP}px ${SCOOP}px 0 0` : '8px 8px 0 0',
                bgcolor: selected ? CATALOG.surface : 'transparent',
                color: selected ? CATALOG.accent : CATALOG.inkFaint,
                fontWeight: selected ? 700 : 550,
                zIndex: selected ? 4 : 1,
                transition:
                  'flex-grow 0.2s ease, color 0.15s ease, background-color 0.15s ease, padding 0.15s ease',
                '&:hover': {
                  color: selected ? CATALOG.accent : CATALOG.ink,
                  bgcolor: selected ? CATALOG.surface : 'rgba(255,255,255,0.45)',
                },
                ...(selected
                  ? {
                      flexGrow: 1.35,
                      '&::before, &::after': {
                        content: '""',
                        position: 'absolute',
                        bottom: 0,
                        width: SCOOP,
                        height: SCOOP,
                        pointerEvents: 'none',
                        zIndex: 0,
                      },
                      '&::before': {
                        left: -SCOOP,
                        background: `radial-gradient(circle at top left, transparent ${SCOOP - 0.5}px, ${CATALOG.surface} ${SCOOP}px)`,
                      },
                      '&::after': {
                        right: -SCOOP,
                        background: `radial-gradient(circle at top right, transparent ${SCOOP - 0.5}px, ${CATALOG.surface} ${SCOOP}px)`,
                      },
                    }
                  : {}),
              }}
            >
              {tab.icon ? (
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    flexShrink: 0,
                    '& .MuiSvgIcon-root': { fontSize: 18, opacity: selected ? 1 : 0.75 },
                  }}
                >
                  {tab.icon}
                </Box>
              ) : null}
              {typeof tab.label === 'string' ? (
                <Typography
                  component="span"
                  sx={{
                    fontSize: '0.875rem',
                    fontWeight: 'inherit',
                    letterSpacing: '-0.01em',
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                </Typography>
              ) : (
                <Box component="span" sx={{ whiteSpace: 'nowrap', display: 'inline-flex' }}>
                  {tab.label}
                </Box>
              )}
            </ButtonBase>
          </React.Fragment>
        );
      })}
    </Box>
  );
}
