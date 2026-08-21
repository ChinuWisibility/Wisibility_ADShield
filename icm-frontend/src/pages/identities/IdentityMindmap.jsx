/**
 * Identity Graph Explorer - Results page (standalone).
 * Loads graph for :identityId and renders mindmap. Back returns to search.
 */

import React, { useEffect, useMemo } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { ArrowBack, AccountTree } from '@mui/icons-material';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { palette } from '../../theme/palette';
import IdentityMindmapPanel from './catalog/IdentityMindmapPanel';
import { INDUSTRIAL_FONT_STACK } from './mindmapComponents/mindmapShared.jsx';

export default function IdentityGraphViewer() {
  const navigate = useNavigate();
  const location = useLocation();
  const { identityId } = useParams();

  const identityLabel = useMemo(() => location.state?.identityLabel, [location.state]);

  useEffect(() => {
    if (!identityId) {
      navigate('/identities/mindmap', { replace: true });
    }
  }, [identityId, navigate]);

  if (!identityId) {
    return null;
  }

  return (
    <Box sx={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', bgcolor: '#f8fafc' }}>
      <Box
        sx={{
          height: 56,
          px: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: '#ffffff',
          borderBottom: `1px solid ${palette.border?.default || '#e2e8f0'}`,
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Button
            startIcon={<ArrowBack />}
            onClick={() => navigate('/identities/mindmap')}
            sx={{ textTransform: 'none', color: 'text.secondary', fontSize: '0.98rem', fontWeight: 700 }}
          >
            Back to Search
          </Button>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <AccountTree sx={{ color: palette.brand?.primary || '#2563eb' }} />
            <Typography
              sx={{
                fontFamily: INDUSTRIAL_FONT_STACK,
                fontSize: '1.05rem',
                fontWeight: 800,
                color: '#0f172a',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={identityLabel || identityId}
            >
              Identity Graph{identityLabel ? `: ${identityLabel}` : ''}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        <IdentityMindmapPanel
          identityId={identityId}
          identityLabel={identityLabel}
          hideChrome
          height="100%"
        />
      </Box>
    </Box>
  );
}
