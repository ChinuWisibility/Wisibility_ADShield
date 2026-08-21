import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Checkbox, FormControlLabel } from '@mui/material';
import dagre from '@dagrejs/dagre';
import ReactFlow, { Controls, useEdgesState, useNodesState, useReactFlow } from 'reactflow';

import { palette } from '../../../theme/palette';
import {
  EDGE_STYLE,
  NODE_WIDTH,
  NODE_HEIGHT,
  INDUSTRIAL_FONT_STACK,
  SUBJECT_STABLE_ID,
  mindmapCanvasFrameSx,
  mindmapReactFlowStyle,
  mindmapControlsStyle,
  MindmapCanvasAtmosphere,
  MindmapStormBackdrop,
  pillNodeDimensions,
  edgeStyleForLink,
  normalizeMindmapPayload,
  collapseExpandedBranch,
  expandMindmapWithApplicationCascade,
  isFullMindmapAccessExpansion,
  collectExpandableStableIds,
  IdentityMindmapPillNode,
} from './mindmapShared.jsx';

const DAGRE_OPTS = {
  rankdir: 'LR',
  ranksep: 260,
  nodesep: 148,
  marginx: 64,
  marginy: 64,
};

const nodeTypes = { identityPill: IdentityMindmapPillNode };

// Keep text readable. We allow users to zoom in, but we don't auto-zoom out below this.
const MIN_READABLE_ZOOM = 0.22;
// Prevent auto-fit from "zooming in" on small graphs (e.g., only the subject node).
const AUTO_FIT_MAX_ZOOM = 1.2;

function mindmapToFlowElements(apiPayload, expandedIds, visibleManagerIndices, showManagerSpine) {
  const { subject, managerChain } = normalizeMindmapPayload(apiPayload);
  const nodes = [];
  const edges = [];
  let seq = 0;
  const nextRfId = () => {
    seq += 1;
    return `ig-${seq}`;
  };

  if (!subject) return { nodes, edges };

  const chain = managerChain || [];
  const effectiveVisible = showManagerSpine ? visibleManagerIndices : new Set();
  const indicesToShow = [...effectiveVisible]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < chain.length)
    .sort((a, b) => a - b);

  let prevRfId = null;
  indicesToShow.forEach((chainIndex) => {
    const mgrTree = chain[chainIndex];
    const rfId = nextRfId();
    const nodeType = mgrTree?.attributes?.type || 'User';
    const label = mgrTree?.name != null ? String(mgrTree.name) : '—';
    const showExpandManagerParent = chainIndex > 0 && !effectiveVisible.has(chainIndex - 1);

    nodes.push({
      id: rfId,
      type: 'identityPill',
      position: { x: 0, y: 0 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: {
        nodeWidth: NODE_WIDTH,
        nodeHeight: NODE_HEIGHT,
        stableId: `M-${chainIndex}`,
        label,
        nodeType,
        attributes: { ...(mgrTree?.attributes || {}), relation: 'manager' },
        hasChildren: false,
        expanded: false,
        childCount: 0,
        isManagerChainNode: true,
        chainIndex,
        showExpandManagerParent,
        showCollapseManager: true,
      },
    });

    if (prevRfId) {
      edges.push({
        id: `e-${prevRfId}-${rfId}`,
        source: prevRfId,
        target: rfId,
        sourceHandle: 'right-src',
        targetHandle: 'left',
        type: 'smoothstep',
        style: edgeStyleForLink('User', 'User'),
      });
    }
    prevRfId = rfId;
  });

  const subRfId = nextRfId();
  const subChildren = Array.isArray(subject.children) ? subject.children : [];
  const hasRight = subChildren.length > 0;
  const rightExpanded = hasRight && expandedIds.has(SUBJECT_STABLE_ID);
  const subjectType = subject?.attributes?.type || 'User';

  nodes.push({
    id: subRfId,
    type: 'identityPill',
    position: { x: 0, y: 0 },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      nodeWidth: NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
      stableId: SUBJECT_STABLE_ID,
      label: subject?.name != null ? String(subject.name) : '—',
      nodeType: subjectType,
      attributes: subject?.attributes || {},
      hasChildren: hasRight,
      hasAccessChildren: hasRight,
      expanded: rightExpanded,
      childCount: subChildren.length,
      isSubject: true,
      managerChainLength: chain.length,
      showSubjectManagerReveal: Boolean(showManagerSpine) && chain.length > 0 && indicesToShow.length === 0,
    },
  });

  if (prevRfId) {
    edges.push({
      id: `e-${prevRfId}-${subRfId}`,
      source: prevRfId,
      target: subRfId,
      sourceHandle: 'right-src',
      targetHandle: 'left',
      type: 'smoothstep',
      animated: true,
      style: edgeStyleForLink('User', subjectType),
    });
  }

  function walkRight(node, parentRfId, parentType, stableId, accessTreeDepth, appearDelayMs = 0, fromSubject = false) {
    if (!node) return;

    const nodeType = node?.attributes?.type || 'User';
    const { w: boxW, h: boxH } = pillNodeDimensions(nodeType);
    const rfId = nextRfId();
    const children = Array.isArray(node?.children) ? node.children : [];
    const hasCh = children.length > 0;
    const expanded = hasCh && expandedIds.has(stableId);
    const label = node?.name != null ? String(node.name) : '—';
    const animateIn = accessTreeDepth >= 1;

    nodes.push({
      id: rfId,
      type: 'identityPill',
      position: { x: 0, y: 0 },
      width: boxW,
      height: boxH,
      data: {
        stableId,
        label,
        nodeType,
        attributes: node?.attributes || {},
        hasChildren: hasCh,
        expanded,
        childCount: children.length,
        accessTreeDepth,
        nodeWidth: boxW,
        nodeHeight: boxH,
        ...(animateIn ? { animateIn: true, appearDelayMs } : {}),
      },
    });

    edges.push({
      id: `e-${parentRfId}-${rfId}`,
      source: parentRfId,
      target: rfId,
      sourceHandle: 'right-src',
      targetHandle: 'left',
      type: 'smoothstep',
      animated: true,
      style: edgeStyleForLink(parentType, nodeType, { fromSubject }),
    });

    if (!expanded) return rfId;

    // Application + opens accounts and their entitlements in one step (via cascade expand).
    children.forEach((child, i) => {
      walkRight(child, rfId, nodeType, `${stableId}-${i}`, accessTreeDepth + 1, appearDelayMs + 90 + i * 80);
    });
    return rfId;
  }

  if (rightExpanded) {
    subChildren.forEach((child, i) => {
      walkRight(child, subRfId, subjectType, `${SUBJECT_STABLE_ID}-${i}`, 1, 60 + i * 90, true);
    });
  }

  return { nodes, edges };
}

function layoutWithDagre(nodes, edges) {
  if (!nodes.length) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph(DAGRE_OPTS);

  nodes.forEach((n) => {
    const w = typeof n.width === 'number' ? n.width : NODE_WIDTH;
    const h = typeof n.height === 'number' ? n.height : NODE_HEIGHT;
    g.setNode(n.id, { width: w, height: h });
  });
  edges.forEach((e) => {
    g.setEdge(e.source, e.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const w = typeof node.width === 'number' ? node.width : NODE_WIDTH;
    const h = typeof node.height === 'number' ? node.height : NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });
}

export default function TreeMindmap({
  graphData,
  onNodeMeta,
  showManagerSpine: showManagerSpineProp,
  onShowManagerSpineChange,
  hideManagerToolbar = false,
  profilePhotoSrc = null,
  initialExpandedIds = null,
  expansionRequest = null,
}) {
  const { setViewport } = useReactFlow();
  const containerRef = useRef(null);
  const fitDebounceRef = useRef(null);
  const hasNodesRef = useRef(false);
  const didInitialFitRef = useRef(false);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [visibleManagerIndices, setVisibleManagerIndices] = useState(() => new Set());
  const [showManagerSpineInternal, setShowManagerSpineInternal] = useState(true);

  const showManagerSpine =
    typeof showManagerSpineProp === 'boolean' ? showManagerSpineProp : showManagerSpineInternal;
  const setShowManagerSpine = useCallback(
    (next) => {
      const value = typeof next === 'function' ? next(showManagerSpine) : next;
      if (typeof onShowManagerSpineChange === 'function') onShowManagerSpineChange(value);
      else setShowManagerSpineInternal(value);
    },
    [onShowManagerSpineChange, showManagerSpine],
  );

  const fullAccessExpanded = useMemo(() => isFullMindmapAccessExpansion(expandedIds), [expandedIds]);

  const toggleExpand = useCallback((stableId) => {
    setExpandedIds((prev) => {
      if (prev.has(stableId)) return collapseExpandedBranch(prev, stableId);
      return expandMindmapWithApplicationCascade(graphData, prev, stableId);
    });
  }, [graphData]);

  useEffect(() => {
    if (!expansionRequest?.action) return;
    if (expansionRequest.action === 'collapse') {
      setExpandedIds(new Set());
      return;
    }
    if (expansionRequest.action === 'expand') {
      const { subject } = normalizeMindmapPayload(graphData);
      setExpandedIds(collectExpandableStableIds(subject));
    }
  }, [expansionRequest, graphData]);

  const onExpandManagerParent = useCallback((chainIndex) => {
    setVisibleManagerIndices((prev) => {
      const next = new Set(prev);
      if (chainIndex > 0) next.add(chainIndex - 1);
      return next;
    });
  }, []);

  const onCollapseManagerFrom = useCallback(
    (chainIndex) => {
      const len = normalizeMindmapPayload(graphData).managerChain?.length || 0;
      const directIdx = len > 0 ? len - 1 : -1;
      setVisibleManagerIndices((prev) => {
        const next = new Set(prev);
        if (chainIndex === directIdx) {
          next.clear();
        } else {
          for (const j of [...next]) {
            if (j <= chainIndex) next.delete(j);
          }
        }
        return next;
      });
    },
    [graphData],
  );

  const onRevealDirectManager = useCallback(() => {
    const len = normalizeMindmapPayload(graphData).managerChain?.length || 0;
    if (len > 0) setVisibleManagerIndices(new Set([len - 1]));
  }, [graphData]);

  const managerChain = useMemo(() => {
    if (!graphData) return [];
    return normalizeMindmapPayload(graphData).managerChain || [];
  }, [graphData]);

  useEffect(() => {
    // Start collapsed on the subject — expand via + only.
    // Privileged-only mode may pass initialExpandedIds to reveal privileged paths immediately.
    setExpandedIds(
      initialExpandedIds instanceof Set && initialExpandedIds.size > 0
        ? new Set(initialExpandedIds)
        : new Set(),
    );
    if (!graphData) {
      setVisibleManagerIndices(new Set());
      setShowManagerSpine(true);
      didInitialFitRef.current = false;
      return;
    }
    setVisibleManagerIndices(new Set());
    setShowManagerSpine(true);
    didInitialFitRef.current = false;
  }, [graphData, initialExpandedIds]);

  const runFitView = useCallback(() => {
    const el = containerRef.current;
    if (!el || !nodes.length) return;

    // Compute node bounds in graph coordinates.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const x = n.position?.x ?? 0;
      const y = n.position?.y ?? 0;
      const w = typeof n.width === 'number' ? n.width : NODE_WIDTH;
      const h = typeof n.height === 'number' ? n.height : NODE_HEIGHT;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }

    const rect = el.getBoundingClientRect();
    const vw = Math.max(1, rect.width);
    const vh = Math.max(1, rect.height);
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);

    // Demo-safe padding (accounts for node shadows/handles and UI overlays).
    const padPx = 96;
    const availW = Math.max(1, vw - 2 * padPx);
    const availH = Math.max(1, vh - 2 * padPx);
    const scale = Math.min(availW / bw, availH / bh);
    const zoom = Math.max(MIN_READABLE_ZOOM, Math.min(AUTO_FIT_MAX_ZOOM, scale));

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const x = vw / 2 - cx * zoom;
    const y = vh / 2 - cy * zoom;

    setViewport({ x, y, zoom }, { duration: 220 });
  }, [nodes, setViewport]);

  const scheduleFitView = useCallback(() => {
    if (!hasNodesRef.current) return;
    if (fitDebounceRef.current) clearTimeout(fitDebounceRef.current);
    fitDebounceRef.current = setTimeout(() => {
      fitDebounceRef.current = null;
      requestAnimationFrame(runFitView);
    }, 120);
  }, [runFitView]);

  useEffect(() => {
    if (!graphData) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const { nodes: rawNodes, edges: rawEdges } = mindmapToFlowElements(
      graphData,
      expandedIds,
      visibleManagerIndices,
      showManagerSpine,
    );
    const laidOut = layoutWithDagre(rawNodes, rawEdges);
    setNodes(
      laidOut.map((n) => ({
        ...n,
        data: {
          ...n.data,
          fullAccessExpanded,
          onToggleExpand: toggleExpand,
          ...(n.data.isSubject && profilePhotoSrc ? { profilePhotoSrc } : {}),
          ...(n.data.isManagerChainNode ? { onExpandManagerParent, onCollapseManagerFrom } : {}),
          ...(n.data.isSubject && n.data.showSubjectManagerReveal ? { onRevealDirectManager } : {}),
        },
      })),
    );
    setEdges(rawEdges);
  }, [
    graphData,
    expandedIds,
    visibleManagerIndices,
    showManagerSpine,
    toggleExpand,
    onExpandManagerParent,
    onCollapseManagerFrom,
    onRevealDirectManager,
    fullAccessExpanded,
    profilePhotoSrc,
    setEdges,
    setNodes,
  ]);

  useEffect(() => {
    hasNodesRef.current = nodes.length > 0;
  }, [nodes.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => scheduleFitView());
    ro.observe(el);

    const onViewportResize = () => scheduleFitView();
    window.visualViewport?.addEventListener('resize', onViewportResize);
    window.addEventListener('resize', onViewportResize);

    return () => {
      ro.disconnect();
      window.visualViewport?.removeEventListener('resize', onViewportResize);
      window.removeEventListener('resize', onViewportResize);
      if (fitDebounceRef.current) clearTimeout(fitDebounceRef.current);
    };
  }, [scheduleFitView]);

  // Auto-fit exactly once when nodes first appear for a graph (prevents "blank canvas"),
  // but never refit on expand/collapse (prevents unreadable shrinking).
  useEffect(() => {
    if (!graphData || !nodes.length) return;
    if (didInitialFitRef.current) return;
    didInitialFitRef.current = true;
    const raf = requestAnimationFrame(runFitView);
    // Run again shortly after layout paints to avoid "off-screen" first fit.
    const t = setTimeout(() => requestAnimationFrame(runFitView), 220);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [graphData, nodes.length, runFitView]);

  // Keep the graph framed after expand/collapse so new nodes stay visible.
  useEffect(() => {
    if (!didInitialFitRef.current || !nodes.length) return;
    scheduleFitView();
  }, [expandedIds, nodes.length, scheduleFitView]);

  const onNodeClick = useCallback(
    (_, node) => {
      const stableId = node?.data?.stableId;
      const typ = String(node?.data?.attributes?.type || node?.data?.nodeType || '').trim().toLowerCase();
      // Clicking a collapsed expandable node expands one level (same as +).
      if (
        stableId &&
        node?.data?.hasChildren &&
        !node?.data?.expanded &&
        (typ === 'user' || typ === 'application' || typ === 'account' || node?.data?.isSubject)
      ) {
        toggleExpand(stableId);
      }
      if (typeof onNodeMeta !== 'function') return;
      onNodeMeta({
        id: node.id,
        stableId: node.data?.stableId,
        label: node.data?.label,
        nodeType: node.data?.nodeType,
        attributes: node.data?.attributes || {},
      });
    },
    [onNodeMeta, toggleExpand],
  );

  const onNodeDoubleClick = useCallback(
    (_, node) => {
      const stableId = node?.data?.stableId;
      const typ = String(node?.data?.attributes?.type || node?.data?.nodeType || '').trim().toLowerCase();
      // Tree requirement: Application pill double-click collapses (only).
      if (typ === 'application' && stableId && node?.data?.expanded) {
        toggleExpand(stableId);
      }
    },
    [toggleExpand],
  );

  // Horizontal scrollbar removed per request.

  return (
    <Box
      ref={containerRef}
      sx={mindmapCanvasFrameSx}
    >
      <MindmapStormBackdrop />
      {!hideManagerToolbar && managerChain.length > 0 ? (
        <Box
          sx={{
            position: 'relative',
            zIndex: 1,
            flexShrink: 0,
            px: 1.5,
            py: 0.65,
            borderBottom: `1px solid ${palette.border?.default || '#e2e8f0'}`,
            bgcolor: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <FormControlLabel
            sx={{
              mr: 0,
              ml: 0,
              '& .MuiFormControlLabel-label': {
                fontSize: '0.9375rem',
                fontWeight: 600,
                fontFamily: INDUSTRIAL_FONT_STACK,
              },
            }}
            control={
              <Checkbox
                size="small"
                checked={showManagerSpine}
                onChange={(e) => setShowManagerSpine(e.target.checked)}
                inputProps={{ 'aria-label': 'Show manager graph on the left' }}
              />
            }
            label="Show manager graph"
            title="When on, the reporting line appears on the left. When off, only the selected identity and access tree are shown."
          />
        </Box>
      ) : null}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', zIndex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          minZoom={MIN_READABLE_ZOOM}
          maxZoom={2}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          panOnScroll={false}
          panOnDrag
          style={mindmapReactFlowStyle}
          defaultEdgeOptions={{ type: 'smoothstep', style: EDGE_STYLE }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
        >
          <Controls
            position="bottom-right"
            showZoom
            showFitView
            showInteractive={false}
            style={mindmapControlsStyle}
          />
          <MindmapCanvasAtmosphere />
        </ReactFlow>
      </Box>
    </Box>
  );
}

