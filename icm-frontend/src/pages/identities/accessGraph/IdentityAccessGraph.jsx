/**
 * Identity Access Map.
 *
 * Radial React Flow mindmap: identity hub in the centre, applications on an
 * orbit ring, each app's accounts parked outward on the spoke with their
 * roles fanned beyond. Chrome: filters popover and zoom/fullscreen cluster.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactFlow, { ReactFlowProvider, useReactFlow } from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  Popover,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add,
  Close,
  FilterListOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  GppGoodOutlined,
  HubOutlined,
  Remove,
  SearchOutlined,
  ShieldOutlined,
  UnfoldLess,
  UnfoldMore,
} from '@mui/icons-material';

import { accessGraphNodeTypes } from './AccessGraphNodes';
import { accessGraphEdgeTypes } from './AccessGraphEdge';
import { GRAPH_COLORS, GRAPH_FONT, STORM_CANVAS_BG } from './accessGraphTheme';
import { MindmapStormBackdrop } from '../mindmapComponents/mindmapShared';
import {
  ORBIT_ID,
  buildAccessGraphModel,
  collectExpandableIds,
  collectSearchMatches,
  expandedIdsForMatches,
  layoutAccessGraph,
} from './accessGraphModel';

const FIT_VIEW_OPTIONS = { padding: 0.18, duration: 380, maxZoom: 1.1, minZoom: 0.25 };

/** Drop applications that hold no privileged entitlements. */
function filterModelToPrivileged(model) {
  if (!model?.identity) return model;
  const applications = model.applications
    .map((app) => {
      const accounts = app.accounts
        .map((account) => {
          const entitlements = account.entitlements.filter((e) => e.privileged);
          if (entitlements.length === 0) return null;
          return {
            ...account,
            entitlements,
            counts: { entitlements: entitlements.length, privileged: entitlements.length },
          };
        })
        .filter(Boolean);
      if (accounts.length === 0) return null;
      const entitlementCount = accounts.reduce((s, a) => s + a.counts.entitlements, 0);
      return {
        ...app,
        accounts,
        counts: { accounts: accounts.length, entitlements: entitlementCount, privileged: entitlementCount },
      };
    })
    .filter(Boolean);

  const totals = {
    applications: applications.length,
    accounts: applications.reduce((s, a) => s + a.counts.accounts, 0),
    entitlements: applications.reduce((s, a) => s + a.counts.entitlements, 0),
    privileged: applications.reduce((s, a) => s + a.counts.privileged, 0),
  };

  return {
    ...model,
    applications,
    totals,
    identity: { ...model.identity, counts: totals },
  };
}

/* ------------------------------------------------------------------ */
/* Overlay pieces                                                      */
/* ------------------------------------------------------------------ */

const overlayCardSx = {
  bgcolor: 'rgba(13, 21, 38, 0.88)',
  backdropFilter: 'blur(10px)',
  border: `1px solid ${GRAPH_COLORS.border}`,
  borderRadius: 3,
  boxShadow: '0 14px 34px rgba(2, 6, 18, 0.55)',
  color: GRAPH_COLORS.ink,
};

function MapHeader() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, pointerEvents: 'none' }}>
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 2.5,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          bgcolor: GRAPH_COLORS.identitySoft,
          border: `1px solid ${GRAPH_COLORS.identity}33`,
        }}
      >
        <GppGoodOutlined sx={{ fontSize: 22, color: GRAPH_COLORS.identity }} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontFamily: GRAPH_FONT,
            fontWeight: 800,
            fontSize: '1.12rem',
            color: GRAPH_COLORS.ink,
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
          }}
        >
          Identity Access Map
        </Typography>
        <Typography
          sx={{
            fontFamily: GRAPH_FONT,
            fontSize: '0.74rem',
            fontWeight: 600,
            color: GRAPH_COLORS.inkSoft,
            maxWidth: 260,
            lineHeight: 1.4,
          }}
        >
          Visualize accounts, applications and entitlements assigned to this identity.
        </Typography>
      </Box>
    </Box>
  );
}

const LEGEND_TYPES = [
  { label: 'Identity', color: GRAPH_COLORS.identity },
  { label: 'Applications', color: GRAPH_COLORS.application },
  { label: 'Accounts', color: GRAPH_COLORS.account },
  { label: 'Roles / Groups', color: GRAPH_COLORS.entitlement },
  { label: 'High Risk', color: GRAPH_COLORS.privileged },
];

function LegendCard() {
  return (
    <Box sx={{ ...overlayCardSx, px: 1.75, py: 1.4, width: 172 }}>
      <Typography
        sx={{
          fontFamily: GRAPH_FONT,
          fontWeight: 800,
          fontSize: '0.82rem',
          color: GRAPH_COLORS.ink,
          mb: 0.9,
        }}
      >
        Legend
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.7 }}>
        {LEGEND_TYPES.map(({ label, color }) => (
          <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                border: `2.5px solid ${color}`,
                bgcolor: GRAPH_COLORS.surfaceRing,
                flexShrink: 0,
              }}
            />
            <Typography
              sx={{ fontFamily: GRAPH_FONT, fontSize: '0.73rem', fontWeight: 600, color: GRAPH_COLORS.inkSoft }}
            >
              {label}
            </Typography>
          </Box>
        ))}
      </Box>
      <Divider sx={{ my: 1.1 }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.7 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 22, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <Box
              component="svg"
              viewBox="0 0 22 4"
              sx={{ width: 22, height: 4, display: 'block' }}
            >
              <line
                x1="1"
                y1="2"
                x2="21"
                y2="2"
                stroke={GRAPH_COLORS.link}
                strokeWidth="2"
                strokeDasharray="2 4"
                strokeLinecap="round"
              />
            </Box>
          </Box>
          <Typography sx={{ fontFamily: GRAPH_FONT, fontSize: '0.71rem', fontWeight: 600, color: GRAPH_COLORS.inkSoft }}>
            Direct Relationship
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 22, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <Box component="svg" viewBox="0 0 22 4" sx={{ width: 22, height: 4, display: 'block' }}>
              <line
                x1="1"
                y1="2"
                x2="21"
                y2="2"
                stroke={GRAPH_COLORS.application}
                strokeWidth="2"
                strokeLinecap="round"
              />
            </Box>
          </Box>
          <Typography sx={{ fontFamily: GRAPH_FONT, fontSize: '0.71rem', fontWeight: 600, color: GRAPH_COLORS.inkSoft }}>
            Inheritance
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

const controlButtonSx = {
  width: 34,
  height: 34,
  borderRadius: 2,
  color: GRAPH_COLORS.inkSoft,
  '&:hover': { bgcolor: GRAPH_COLORS.identitySoft, color: GRAPH_COLORS.identity },
};

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

function AccessGraphCanvas({ graphData, photoSrc, onNodeSelect, expansionRequest = null }) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const [scope, setScope] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(() => new Set()); // identity only; + expands layers
  const [selectedId, setSelectedId] = useState(null);
  const [filterAnchor, setFilterAnchor] = useState(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const fullModel = useMemo(() => buildAccessGraphModel(graphData), [graphData]);
  const model = useMemo(
    () => (scope === 'privileged' ? filterModelToPrivileged(fullModel) : fullModel),
    [fullModel, scope],
  );

  // Start from the identity hub — expand applications, then accounts, then roles.
  const effectiveExpanded = useMemo(
    () => expanded ?? collectExpandableIds(model),
    [expanded, model],
  );

  useEffect(() => {
    setExpanded(new Set());
  }, [graphData, scope]);

  const matches = useMemo(() => collectSearchMatches(model, search), [model, search]);

  // Reveal search hits by expanding their ancestors.
  useEffect(() => {
    if (!search.trim() || matches.size === 0) return;
    const needed = expandedIdsForMatches(model, matches);
    if (needed.size === 0) return;
    setExpanded((prev) => {
      if (prev === null) return prev; // everything already visible
      let changed = false;
      const next = new Set(prev);
      needed.forEach((id) => {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [search, matches, model]);

  const handleToggle = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev ?? collectExpandableIds(model));
      if (next.has(id)) {
        next.delete(id);
        for (const key of [...next]) {
          if (key.startsWith(`${id}-`)) next.delete(key);
        }
      } else {
        next.add(id);
      }
      return next;
    });
  }, [model]);

  const handleViewDetails = useCallback(
    (identity) => {
      if (identity?.identityId) navigate(`/identities/${identity.identityId}`);
    },
    [navigate],
  );

  const { nodes, edges } = useMemo(() => {
    const laid = layoutAccessGraph(model, effectiveExpanded, {
      matches,
      dimUnmatched: Boolean(search.trim()),
      focusId: selectedId,
    });
    return {
      nodes: laid.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onToggle: handleToggle,
          photoSrc,
          ...(node.id === 'identity' ? { onViewDetails: handleViewDetails } : {}),
        },
      })),
      edges: laid.edges,
    };
  }, [model, effectiveExpanded, matches, search, selectedId, handleToggle, handleViewDetails, photoSrc]);

  const nodeCount = nodes.length;
  const expandKey = [...effectiveExpanded].sort().join('|');
  const fitKey = `${scope}-${nodeCount}-${expandKey}`;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      fitView(FIT_VIEW_OPTIONS);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [fitKey, fitView]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      window.setTimeout(() => fitView(FIT_VIEW_OPTIONS), 120);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [fitView]);

  const handleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen?.();
    }
  }, []);

  const handleExpandAll = useCallback(() => setExpanded(null), []);
  const handleCollapseAll = useCallback(() => setExpanded(new Set()), []);

  useEffect(() => {
    if (!expansionRequest?.action) return;
    if (expansionRequest.action === 'expand') setExpanded(null);
    else if (expansionRequest.action === 'collapse') setExpanded(new Set());
  }, [expansionRequest]);

  const handleNodeClick = useCallback(
    (_event, node) => {
      if (node.id === ORBIT_ID) return;
      setSelectedId(node.id);
      onNodeSelect?.(node);
    },
    [onNodeSelect],
  );

  const handleMove = useCallback((_event, viewport) => {
    if (viewport?.zoom) setZoomPct(Math.round(viewport.zoom * 100));
  }, []);

  const filtersActive = scope === 'privileged' || Boolean(search.trim());
  const isEmpty = !model?.identity || (scope === 'privileged' && model.applications.length === 0);

  return (
    <Box
      ref={containerRef}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        position: 'relative',
        bgcolor: GRAPH_COLORS.canvas,
        backgroundImage: STORM_CANVAS_BG,
        overflow: 'hidden',
      }}
    >
      <MindmapStormBackdrop />
      {isEmpty ? (
        <Box
          sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            color: GRAPH_COLORS.inkSoft,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <HubOutlined sx={{ fontSize: 44, opacity: 0.45 }} />
          <Typography sx={{ fontFamily: GRAPH_FONT, fontWeight: 800, color: GRAPH_COLORS.ink }}>
            {scope === 'privileged' ? 'No high risk access' : 'No access to map'}
          </Typography>
          <Typography sx={{ fontFamily: GRAPH_FONT, fontSize: '0.82rem', maxWidth: 380, textAlign: 'center' }}>
            {scope === 'privileged'
              ? 'This identity holds no high risk roles in the current graph.'
              : 'This identity has no correlated application accounts yet.'}
          </Typography>
          {scope === 'privileged' ? (
            <Button size="small" onClick={() => setScope('all')} sx={{ fontFamily: GRAPH_FONT, fontWeight: 700 }}>
              Show all access
            </Button>
          ) : null}
        </Box>
      ) : (
        <Box sx={{ position: 'absolute', top: 4, left: 0, right: 0, bottom: 8, zIndex: 1 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={accessGraphNodeTypes}
            edgeTypes={accessGraphEdgeTypes}
            onNodeClick={handleNodeClick}
            onMove={handleMove}
            proOptions={{ hideAttribution: true }}
            minZoom={0.22}
            maxZoom={1.75}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            zoomOnScroll
            zoomOnPinch
            zoomOnDoubleClick={false}
            panOnScroll={false}
            panOnDrag
            selectionOnDrag={false}
            defaultEdgeOptions={{ type: 'accessEdge' }}
            style={{ width: '100%', height: '100%', background: 'transparent' }}
          />
        </Box>
      )}

      {/* Top-left: header + legend */}
      {/* <Box
        sx={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          pointerEvents: 'none',
          '& > *': { pointerEvents: 'auto' },
        }}
      >
        <MapHeader />
        {!isEmpty && <LegendCard />}
      </Box> */}

      {/* Top-right: filters + zoom + fullscreen */}
      <Box
        sx={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Button
          onClick={(event) => setFilterAnchor(event.currentTarget)}
          startIcon={<FilterListOutlined sx={{ fontSize: 18 }} />}
          sx={{
            ...overlayCardSx,
            borderRadius: 2.5,
            px: 1.75,
            py: 0.65,
            textTransform: 'none',
            fontFamily: GRAPH_FONT,
            fontWeight: 700,
            fontSize: '0.8rem',
            color: filtersActive ? GRAPH_COLORS.identity : GRAPH_COLORS.ink,
            '&:hover': { bgcolor: 'rgba(30, 44, 74, 0.95)' },
          }}
        >
          Filters
          {filtersActive ? (
            <Box
              sx={{
                ml: 0.75,
                width: 7,
                height: 7,
                borderRadius: '50%',
                bgcolor: GRAPH_COLORS.identity,
              }}
            />
          ) : null}
        </Button>

        <Box sx={{ ...overlayCardSx, borderRadius: 2.5, display: 'flex', alignItems: 'center', px: 0.5 }}>
          <Tooltip title="Zoom out" arrow>
            <IconButton size="small" onClick={() => zoomOut({ duration: 200 })} sx={controlButtonSx} aria-label="Zoom out">
              <Remove sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Typography
            sx={{
              fontFamily: GRAPH_FONT,
              fontWeight: 800,
              fontSize: '0.78rem',
              color: GRAPH_COLORS.ink,
              width: 48,
              textAlign: 'center',
            }}
          >
            {zoomPct}%
          </Typography>
          <Tooltip title="Zoom in" arrow>
            <IconButton size="small" onClick={() => zoomIn({ duration: 200 })} sx={controlButtonSx} aria-label="Zoom in">
              <Add sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ ...overlayCardSx, borderRadius: 2.5, display: 'flex', px: 0.5 }}>
          <Tooltip title={isFullscreen ? 'Exit full screen' : 'Full screen'} arrow>
            <IconButton
              size="small"
              onClick={handleFullscreen}
              sx={controlButtonSx}
              aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
            >
              {isFullscreen ? (
                <FullscreenExitOutlined sx={{ fontSize: 19 }} />
              ) : (
                <FullscreenOutlined sx={{ fontSize: 19 }} />
              )}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Popover
        open={Boolean(filterAnchor)}
        anchorEl={filterAnchor}
        onClose={() => setFilterAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              borderRadius: 3,
              width: 300,
              p: 2,
              bgcolor: 'rgba(13, 21, 38, 0.96)',
              backgroundImage: 'none',
              border: `1px solid ${GRAPH_COLORS.border}`,
              boxShadow: '0 18px 44px rgba(2, 6, 18, 0.6)',
              color: GRAPH_COLORS.ink,
            },
          },
        }}
      >
        <Typography sx={{ fontFamily: GRAPH_FONT, fontWeight: 800, fontSize: '0.88rem', color: GRAPH_COLORS.ink, mb: 1.25 }}>
          Filter the map
        </Typography>
        <TextField
          fullWidth
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search apps, accounts, roles…"
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 2,
              fontFamily: GRAPH_FONT,
              color: GRAPH_COLORS.ink,
              bgcolor: 'rgba(255,255,255,0.04)',
              '& fieldset': { borderColor: GRAPH_COLORS.border },
              '&:hover fieldset': { borderColor: `${GRAPH_COLORS.identity}66` },
            },
            '& .MuiOutlinedInput-input::placeholder': { color: GRAPH_COLORS.inkFaint, opacity: 1 },
            '& .MuiIconButton-root': { color: GRAPH_COLORS.inkSoft },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlined sx={{ fontSize: 18, color: GRAPH_COLORS.inkFaint }} />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setSearch('')} aria-label="Clear search">
                  <Close sx={{ fontSize: 16 }} />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
        />
        {search.trim() ? (
          <Chip
            size="small"
            label={`${matches.size} match${matches.size === 1 ? '' : 'es'}`}
            sx={{
              mt: 1,
              height: 22,
              fontFamily: GRAPH_FONT,
              fontWeight: 800,
              bgcolor: `${GRAPH_COLORS.match}1A`,
              color: GRAPH_COLORS.match,
            }}
          />
        ) : null}

        <Typography sx={{ fontFamily: GRAPH_FONT, fontWeight: 700, fontSize: '0.72rem', color: GRAPH_COLORS.inkSoft, mt: 1.75, mb: 0.6 }}>
          Scope
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          fullWidth
          value={scope}
          onChange={(_, value) => value && setScope(value)}
          sx={{
            bgcolor: 'rgba(255,255,255,0.04)',
            border: `1px solid ${GRAPH_COLORS.border}`,
            borderRadius: 2,
            p: 0.3,
            gap: 0.3,
            '& .MuiToggleButtonGroup-grouped': {
              border: 0,
              borderRadius: '8px !important',
              py: 0.5,
              textTransform: 'none',
              fontFamily: GRAPH_FONT,
              fontWeight: 700,
              fontSize: '0.74rem',
              color: GRAPH_COLORS.inkSoft,
              '&.Mui-selected': {
                bgcolor: scope === 'privileged' ? GRAPH_COLORS.privilegedSoft : GRAPH_COLORS.identitySoft,
                color: scope === 'privileged' ? GRAPH_COLORS.privileged : GRAPH_COLORS.identity,
              },
            },
          }}
        >
          <ToggleButton value="all">All access</ToggleButton>
          <ToggleButton value="privileged">
            <ShieldOutlined sx={{ fontSize: 14, mr: 0.5 }} />
            High risk
          </ToggleButton>
        </ToggleButtonGroup>

        <Box sx={{ display: 'flex', gap: 1, mt: 1.75 }}>
          <Button
            fullWidth
            size="small"
            startIcon={<UnfoldMore sx={{ fontSize: 16 }} />}
            onClick={handleExpandAll}
            sx={{
              textTransform: 'none',
              fontFamily: GRAPH_FONT,
              fontWeight: 700,
              fontSize: '0.74rem',
              border: `1px solid ${GRAPH_COLORS.border}`,
              borderRadius: 2,
              color: GRAPH_COLORS.inkSoft,
            }}
          >
            Expand all
          </Button>
          <Button
            fullWidth
            size="small"
            startIcon={<UnfoldLess sx={{ fontSize: 16 }} />}
            onClick={handleCollapseAll}
            sx={{
              textTransform: 'none',
              fontFamily: GRAPH_FONT,
              fontWeight: 700,
              fontSize: '0.74rem',
              border: `1px solid ${GRAPH_COLORS.border}`,
              borderRadius: 2,
              color: GRAPH_COLORS.inkSoft,
            }}
          >
            Collapse
          </Button>
        </Box>
      </Popover>

    </Box>
  );
}

/**
 * @param {object} props
 * @param {object} props.graphData `/identities/:id/graph` payload
 * @param {string} [props.photoSrc] identity profile photo
 * @param {(node: object) => void} [props.onNodeSelect]
 * @param {{ action: 'expand'|'collapse', seq: number }|null} [props.expansionRequest]
 */
export default function IdentityAccessGraph(props) {
  return (
    <ReactFlowProvider>
      <AccessGraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
