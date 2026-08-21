/**
 * Reusable identity mindmap panel — loads graph for identityId and renders tree/radial views.
 * Used by catalog Mind Map tab and standalone /identities/mindmap/:identityId page.
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  FormControlLabel,
  Checkbox,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  AccountTree,
  HubOutlined,
  PersonOutline,
  AppsOutlined,
  ManageAccountsOutlined,
  VpnKeyOutlined,
  SecurityOutlined,
  UnfoldMore,
  UnfoldLess,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';

import { palette } from '../../../theme/palette';
import TreeMindmap from '../mindmapComponents/TreeMindmap';
import RadialMindmap from '../mindmapComponents/RadialMindmap';
import IdentityAccessGraph from '../accessGraph/IdentityAccessGraph';
import {
  INDUSTRIAL_FONT_STACK,
  NODE_VISUAL,
  MINDMAP_CANVAS_BG,
  PRIVILEGED_ENTITLEMENT_VISUAL,
  normalizeMindmapPayload,
  filterMindmapToPrivilegedAccess,
  collectExpandableStableIds,
} from '../mindmapComponents/mindmapShared.jsx';
import {
  fetchIdentityGraph,
  identityGraphQueryKey,
  IDENTITY_GRAPH_STALE_MS,
} from './identityCatalogQueries';
import { useIdentityProfilePhoto } from './useIdentityProfilePhoto';

const LEGEND_ITEMS = [
  { t: 'User', c: NODE_VISUAL.User.dot, Icon: PersonOutline },
  { t: 'Application', c: NODE_VISUAL.Application.dot, Icon: AppsOutlined },
  { t: 'Account', c: NODE_VISUAL.Account.dot, Icon: ManageAccountsOutlined },
  { t: 'Entitlement', c: NODE_VISUAL.Entitlement.dot, Icon: VpnKeyOutlined },
  { t: 'Privileged', c: PRIVILEGED_ENTITLEMENT_VISUAL.dot, Icon: SecurityOutlined },
];

const EXPANSION_BUTTON_SX = {
  width: 34,
  height: 34,
  borderRadius: 1.5,
  border: '1px solid #e2e8f0',
  bgcolor: '#fff',
  color: '#475569',
  '&:hover': {
    bgcolor: 'rgba(37,99,235,0.08)',
    color: '#1D4ED8',
    borderColor: 'rgba(37,99,235,0.28)',
  },
};

function MindmapEntityTypesLegend() {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        flexWrap: 'wrap',
      }}
      aria-label="Entity types legend"
    >
      {LEGEND_ITEMS.map(({ t, c, Icon }) => (
        <Box
          key={t}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            px: 0.85,
            py: 0.35,
            borderRadius: 999,
            bgcolor: `${c}14`,
            border: `1px solid ${c}40`,
          }}
        >
          <Icon sx={{ fontSize: 14, color: c }} />
          <Typography
            component="span"
            sx={{
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.02em',
              color: '#334155',
              fontFamily: INDUSTRIAL_FONT_STACK,
              lineHeight: 1,
            }}
          >
            {t}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function MindmapToolbar({
  title = 'Access graph',
  layoutMode,
  onLayoutModeChange,
  graphScope,
  onGraphScopeChange,
  showManagerToggle,
  showManagerSpine,
  onShowManagerSpineChange,
  showScopeToggle = true,
  showLegend = true,
  onExpandAll,
  onCollapseAll,
}) {
  return (
    <Box
      sx={{
        flexShrink: 0,
        px: { xs: 1.25, sm: 1.75 },
        py: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.85,
        bgcolor: 'rgba(255,255,255,0.96)',
        borderBottom: '1px solid #e2e8f0',
        backgroundImage:
          'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.25,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: 1.25,
              display: 'grid',
              placeItems: 'center',
              bgcolor: graphScope === 'privileged'
                ? 'rgba(220,38,38,0.1)'
                : 'rgba(37,99,235,0.1)',
              border: graphScope === 'privileged'
                ? '1px solid rgba(220,38,38,0.28)'
                : '1px solid rgba(37,99,235,0.22)',
              flexShrink: 0,
            }}
          >
            {graphScope === 'privileged' ? (
              <SecurityOutlined sx={{ fontSize: 17, color: '#DC2626' }} />
            ) : (
              <AccountTree sx={{ fontSize: 17, color: palette.brand?.primary || '#2563eb' }} />
            )}
          </Box>
          <Typography
            sx={{
              fontWeight: 800,
              fontSize: '0.98rem',
              color: '#0f172a',
              fontFamily: INDUSTRIAL_FONT_STACK,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          <Tooltip title="Expand all" arrow>
            <IconButton
              size="small"
              onClick={() => onExpandAll?.()}
              aria-label="Expand all"
              sx={EXPANSION_BUTTON_SX}
            >
              <UnfoldMore sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Collapse all" arrow>
            <IconButton
              size="small"
              onClick={() => onCollapseAll?.()}
              aria-label="Collapse all"
              sx={EXPANSION_BUTTON_SX}
            >
              <UnfoldLess sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.25,
          flexWrap: 'wrap',
          pt: 0.85,
          borderTop: '1px solid #eef2f7',
        }}
      >
        {showLegend ? <MindmapEntityTypesLegend /> : <Box />}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={graphScope}
          onChange={(_, value) => {
            if (value) onGraphScopeChange?.(value);
          }}
          aria-label="Graph scope"
          sx={{
            display: showScopeToggle ? undefined : 'none',
            bgcolor: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 2,
            p: 0.35,
            gap: 0.35,
            '& .MuiToggleButtonGroup-grouped': {
              border: 0,
              borderRadius: '8px !important',
              px: 1.1,
              py: 0.45,
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.75rem',
              fontFamily: INDUSTRIAL_FONT_STACK,
              color: '#64748b',
              '&.Mui-selected': {
                bgcolor: graphScope === 'privileged' ? 'rgba(220,38,38,0.1)' : 'rgba(37,99,235,0.1)',
                color: graphScope === 'privileged' ? '#B91C1C' : '#1D4ED8',
                '&:hover': {
                  bgcolor: graphScope === 'privileged' ? 'rgba(220,38,38,0.16)' : 'rgba(37,99,235,0.16)',
                },
              },
            },
          }}
        >
          <ToggleButton value="all" aria-label="Full access graph">
            <Tooltip title="Show all applications, accounts, and entitlements">
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                All access
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="privileged" aria-label="Privileged entitlement graph">
            <Tooltip title="Show only paths that lead to privileged entitlements">
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                <SecurityOutlined sx={{ fontSize: 14 }} />
                Privileged
              </Box>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>

        {showManagerToggle ? (
          <FormControlLabel
            sx={{
              m: 0,
              mr: 0.5,
              px: 1,
              py: 0.15,
              borderRadius: 999,
              border: '1px solid #e2e8f0',
              bgcolor: '#fff',
              '& .MuiFormControlLabel-label': {
                fontSize: '0.8125rem',
                fontWeight: 600,
                fontFamily: INDUSTRIAL_FONT_STACK,
                color: '#475569',
              },
            }}
            control={
              <Checkbox
                size="small"
                checked={showManagerSpine}
                onChange={(e) => onShowManagerSpineChange?.(e.target.checked)}
                sx={{ py: 0.35 }}
                inputProps={{ 'aria-label': 'Show manager graph on the left' }}
              />
            }
            label="Managers"
            title="Show the reporting line on the left of the tree"
          />
        ) : null}

        <ToggleButtonGroup
          size="small"
          exclusive
          value={layoutMode}
          onChange={(_, value) => {
            if (value) onLayoutModeChange?.(value);
          }}
          aria-label="Graph layout"
          sx={{
            bgcolor: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 2,
            p: 0.35,
            gap: 0.35,
            '& .MuiToggleButtonGroup-grouped': {
              border: 0,
              borderRadius: '8px !important',
              px: 1.25,
              py: 0.45,
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.8125rem',
              fontFamily: INDUSTRIAL_FONT_STACK,
              color: '#64748b',
              '&.Mui-selected': {
                bgcolor: layoutMode === 'radial' ? 'rgba(225,29,72,0.1)' : 'rgba(37,99,235,0.1)',
                color: layoutMode === 'radial' ? '#BE123C' : '#1D4ED8',
                '&:hover': {
                  bgcolor: layoutMode === 'radial' ? 'rgba(225,29,72,0.16)' : 'rgba(37,99,235,0.16)',
                },
              },
            },
          }}
        >
          <ToggleButton value="graph" aria-label="Relationship graph layout">
            <Tooltip title="Premium radial access relationship graph">
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
                <HubOutlined sx={{ fontSize: 16 }} />
                Graph
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="tree" aria-label="Tree layout">
            <Tooltip title="Left-to-right hierarchy">
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
                <AccountTree sx={{ fontSize: 16 }} />
                Tree
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="radial" aria-label="Radial spider-web layout">
            <Tooltip title="Radial spider-web view">
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
                <HubOutlined sx={{ fontSize: 16 }} />
                Radial
              </Box>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
        </Box>
      </Box>
    </Box>
  );
}

function IdentityMindmapGraphShell({ graphData, onNodeMeta, profilePhotoSrc = null }) {
  const [layoutMode, setLayoutMode] = useState('graph');
  const [graphScope, setGraphScope] = useState('all');
  const [showManagerSpine, setShowManagerSpine] = useState(true);
  const [expansionRequest, setExpansionRequest] = useState(null);

  const requestExpandAll = useCallback(() => {
    setExpansionRequest((prev) => ({ action: 'expand', seq: (prev?.seq || 0) + 1 }));
  }, []);

  const requestCollapseAll = useCallback(() => {
    setExpansionRequest((prev) => ({ action: 'collapse', seq: (prev?.seq || 0) + 1 }));
  }, []);

  const hasManagerChain = useMemo(() => {
    const chain = normalizeMindmapPayload(graphData).managerChain || [];
    return chain.length > 0;
  }, [graphData]);

  const scopedGraphData = useMemo(() => {
    if (!graphData || graphScope !== 'privileged') return graphData;
    const { subject, managerChain } = normalizeMindmapPayload(graphData);
    const filteredSubject = filterMindmapToPrivilegedAccess(subject);
    if (graphData.subject && typeof graphData.subject === 'object') {
      return { ...graphData, subject: filteredSubject, managerChain };
    }
    return filteredSubject;
  }, [graphData, graphScope]);

  const autoExpandIds = useMemo(() => {
    if (graphScope !== 'privileged' || !scopedGraphData) return null;
    const { subject } = normalizeMindmapPayload(scopedGraphData);
    return collectExpandableStableIds(subject);
  }, [graphScope, scopedGraphData]);

  const privilegedChildCount = useMemo(() => {
    if (graphScope !== 'privileged' || !scopedGraphData) return null;
    const { subject } = normalizeMindmapPayload(scopedGraphData);
    return Array.isArray(subject?.children) ? subject.children.length : 0;
  }, [graphScope, scopedGraphData]);

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        height: '100%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <MindmapToolbar
        title={
          layoutMode === 'graph'
            ? 'Access relationship graph'
            : graphScope === 'privileged'
              ? 'Privileged entitlement graph'
              : 'Access graph'
        }
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        graphScope={graphScope}
        onGraphScopeChange={setGraphScope}
        showScopeToggle={layoutMode !== 'graph'}
        showLegend={layoutMode !== 'graph'}
        showManagerToggle={layoutMode === 'tree' && hasManagerChain && graphScope === 'all'}
        showManagerSpine={showManagerSpine}
        onShowManagerSpineChange={setShowManagerSpine}
        onExpandAll={requestExpandAll}
        onCollapseAll={requestCollapseAll}
      />
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {layoutMode === 'graph' ? (
          <IdentityAccessGraph
            graphData={graphData}
            photoSrc={profilePhotoSrc}
            onNodeSelect={onNodeMeta}
            expansionRequest={expansionRequest}
          />
        ) : graphScope === 'privileged' && privilegedChildCount === 0 ? (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              px: 2,
              color: 'text.secondary',
            }}
          >
            <SecurityOutlined sx={{ fontSize: 40, color: '#FCA5A5' }} />
            <Typography sx={{ fontWeight: 700, color: '#334155', fontFamily: INDUSTRIAL_FONT_STACK }}>
              No privileged entitlements
            </Typography>
            <Typography variant="body2" sx={{ textAlign: 'center', maxWidth: 360 }}>
              This identity has no privileged entitlement paths in the access graph.
            </Typography>
          </Box>
        ) : (
          <ReactFlowProvider>
            {layoutMode === 'radial' ? (
              <RadialMindmap
                key={`radial-${graphScope}`}
                graphData={scopedGraphData}
                onNodeMeta={onNodeMeta}
                profilePhotoSrc={profilePhotoSrc}
                initialExpandedIds={autoExpandIds}
                expansionRequest={expansionRequest}
              />
            ) : (
              <TreeMindmap
                key={`tree-${graphScope}`}
                graphData={scopedGraphData}
                onNodeMeta={onNodeMeta}
                showManagerSpine={graphScope === 'all' ? showManagerSpine : false}
                onShowManagerSpineChange={setShowManagerSpine}
                hideManagerToolbar
                profilePhotoSrc={profilePhotoSrc}
                initialExpandedIds={autoExpandIds}
                expansionRequest={expansionRequest}
              />
            )}
          </ReactFlowProvider>
        )}
      </Box>
    </Box>
  );
}

/**
 * @param {object} props
 * @param {string} props.identityId
 * @param {string} [props.identityLabel]
 * @param {boolean} [props.hasUploadedPhoto]
 * @param {boolean} [props.hideChrome] — when true (catalog tab), omit outer title bar / use compact height
 * @param {number|string} [props.height] — container height override
 */
export default function IdentityMindmapPanel({
  identityId,
  identityLabel,
  hasUploadedPhoto = false,
  hideChrome = false,
  height,
}) {
  const graphQuery = useQuery({
    queryKey: identityGraphQueryKey(identityId),
    queryFn: () => fetchIdentityGraph(identityId),
    enabled: Boolean(identityId),
    staleTime: IDENTITY_GRAPH_STALE_MS,
    gcTime: 15 * 60_000,
  });

  const { photoSrc: profilePhotoSrc } = useIdentityProfilePhoto(identityId, {
    enabled: Boolean(identityId),
    hasUploadedPhoto,
  });

  const graphData = graphQuery.data ?? null;
  const loadingGraph = graphQuery.isLoading || (graphQuery.isFetching && !graphData);
  const error = !identityId
    ? 'No identity selected.'
    : graphQuery.error
      ? (graphQuery.error.response?.data?.message || graphQuery.error.message || 'Failed to load identity graph.')
      : null;

  const titleLabel = useMemo(() => {
    const fallback = identityLabel || identityId;
    if (!graphData) return fallback;
    const { subject } = normalizeMindmapPayload(graphData);
    const attrs = subject?.attributes || {};
    return attrs.email || attrs.userPrincipalName || attrs.username || attrs.uid || subject?.name || fallback;
  }, [graphData, identityId, identityLabel]);

  const containerHeight = height || (hideChrome ? 560 : 'calc(100vh - 64px)');

  return (
    <Box
      sx={{
        height: containerHeight,
        minHeight: hideChrome ? 480 : undefined,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: MINDMAP_CANVAS_BG,
        backgroundImage: `
          radial-gradient(ellipse 85% 65% at 50% 42%, rgba(37, 99, 235, 0.05) 0%, transparent 58%),
          linear-gradient(165deg, #FFFFFF 0%, #F1F5F9 55%, #E8EEF5 100%)
        `,
        border: hideChrome ? `1px solid ${palette.border?.default || '#e2e8f0'}` : undefined,
        borderRadius: hideChrome ? 2 : 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {graphQuery.isFetching && graphData && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 6,
            height: 3,
            bgcolor: 'primary.main',
            opacity: 0.85,
          }}
        />
      )}
      {!hideChrome && (
        <Box
          sx={{
            height: 56,
            px: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            bgcolor: '#ffffff',
            borderBottom: `1px solid ${palette.border?.default || '#e2e8f0'}`,
          }}
        >
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
              title={titleLabel}
            >
              Identity Graph{titleLabel ? `: ${titleLabel}` : ''}
            </Typography>
          </Box>
        </Box>
      )}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          bgcolor: 'transparent',
        }}
      >
        {loadingGraph ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
              flex: 1,
              gap: 1.5,
            }}
          >
            <CircularProgress />
            <Typography color="text.secondary" sx={{ fontSize: '1.0625rem' }}>
              Generating Identity Graph...
            </Typography>
          </Box>
        ) : error ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flex: 1, p: 2 }}>
            <Typography color="error" sx={{ fontSize: '1.0625rem', textAlign: 'center', maxWidth: 560 }}>
              {error}
            </Typography>
          </Box>
        ) : graphData ? (
          <Box sx={{ minHeight: '100%', height: '100%' }}>
            <IdentityMindmapGraphShell graphData={graphData} profilePhotoSrc={profilePhotoSrc} />
          </Box>
        ) : (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
              flex: 1,
              color: 'text.disabled',
              px: 1.5,
            }}
          >
            <AccountTree sx={{ fontSize: 64, mb: 1.25, opacity: 0.5 }} />
            <Typography variant="h6" sx={{ fontSize: '1.375rem', fontWeight: 700 }}>
              No Graph Data
            </Typography>
            <Typography variant="body2" textAlign="center" sx={{ fontSize: '1.0625rem', maxWidth: 420, lineHeight: 1.55 }}>
              Select an identity to map their access.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
