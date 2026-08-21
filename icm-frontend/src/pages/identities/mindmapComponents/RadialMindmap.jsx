import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import ReactFlow, { Controls, useEdgesState, useNodesState, useReactFlow } from 'reactflow';

import {
  EDGE_STYLE,
  SUBJECT_STABLE_ID,
  NODE_WIDTH,
  NODE_HEIGHT,
  RADIAL_ENTITLEMENT_NODE_WIDTH,
  RADIAL_ENTITLEMENT_NODE_HEIGHT,
  RADIAL_NODE_DIAMETER,
  RADIAL_SUBJECT_DIAMETER,
  mindmapCanvasFrameSx,
  mindmapReactFlowStyle,
  mindmapControlsStyle,
  MindmapCanvasAtmosphere,
  MindmapStormBackdrop,
  edgeStyleForLink,
  normalizeMindmapPayload,
  collapseExpandedBranch,
  expandMindmapWithApplicationCascade,
  isFullMindmapAccessExpansion,
  collectExpandableStableIds,
  IdentityMindmapPillNode,
  RadialRingDecoration,
} from './mindmapShared.jsx';

/** Accounts (smaller disks on outer rings). */
const RADIAL_DEPTH_NODE_DIAMETER = 104;

/** Empty space between hub disk rim and first-ring spoke disk rim (along the spoke). */
const HUB_SPOKE_GAP = 72;

/** Rim-to-rim gap along the spoke between parent and child (depth ≥ 2). */
const INTER_LEVEL_GAP = 64;

/** Extra space between adjacent sibling disk edges (perpendicular stack). */
const SIBLING_EDGE_GAP = 36;

/** Extra spacing for entitlement pills. */
const ENTITLEMENT_SIBLING_EDGE_GAP = 72;

/** Mild push for account → entitlement layer. */
const ACCOUNT_ENTITLEMENT_EXTRA_ALONG = 48;

/** Extra margin in angular spacing formula so first-ring nodes stay farther apart when n is large. */
const FIRST_RING_ANGULAR_MARGIN = 48;

const nodeTypes = { identityPill: IdentityMindmapPillNode, radialRing: RadialRingDecoration };

const MIN_READABLE_ZOOM = 0.22;
const AUTO_FIT_MAX_ZOOM = 1.2;

function halfExtentAlong(w, h, ux, uy) {
  return (w / 2) * Math.abs(ux) + (h / 2) * Math.abs(uy);
}

function normType(attrs) {
  return String(attrs?.type || '').trim().toLowerCase();
}

function dimensionsForRadialNode(treeNode, accessTreeDepth) {
  const typ = normType(treeNode?.attributes);
  if (typ === 'entitlement') {
    return { w: RADIAL_ENTITLEMENT_NODE_WIDTH, h: RADIAL_ENTITLEMENT_NODE_HEIGHT, shape: 'pill' };
  }
  if (typ === 'account') {
    return { w: RADIAL_DEPTH_NODE_DIAMETER, h: RADIAL_DEPTH_NODE_DIAMETER, shape: 'circle' };
  }
  const d = accessTreeDepth >= 2 ? RADIAL_DEPTH_NODE_DIAMETER : RADIAL_NODE_DIAMETER;
  return { w: d, h: d, shape: 'circle' };
}

/** Walk natural children — Application → Account → Entitlement (matches legend). */
function getRadialChildEntries(node, stableId) {
  const raw = Array.isArray(node?.children) ? node.children : [];
  return raw.map((ch, i) => ({ node: ch, stableId: `${stableId}-${i}` }));
}

function outwardUnitForChildren(theta) {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  if (Math.abs(cosT) < 0.22) {
    if (sinT < 0) return { ux: 0, uy: -1 };
    return { ux: 0, uy: 1 };
  }
  return { ux: cosT, uy: sinT };
}

function perpUnit(ux, uy) {
  return { px: -uy, py: ux };
}

function cardinalFromAngle(angleRad) {
  const a = Math.atan2(Math.sin(angleRad), Math.cos(angleRad));
  if (a >= -Math.PI / 4 && a < Math.PI / 4) return 'right';
  if (a >= Math.PI / 4 && a < (3 * Math.PI) / 4) return 'bottom';
  if (a >= (3 * Math.PI) / 4 || a < (-3 * Math.PI) / 4) return 'left';
  return 'top';
}

function edgeHandles(sourceTopLeftX, sourceTopLeftY, sw, sh, targetTopLeftX, targetTopLeftY, tw, th) {
  const scx = sourceTopLeftX + sw / 2;
  const scy = sourceTopLeftY + sh / 2;
  const tcx = targetTopLeftX + tw / 2;
  const tcy = targetTopLeftY + th / 2;
  const dx = tcx - scx;
  const dy = tcy - scy;
  const angOut = Math.atan2(dy, dx);
  const angIn = Math.atan2(-dy, -dx);
  return {
    sourceHandle: `${cardinalFromAngle(angOut)}-src`,
    targetHandle: cardinalFromAngle(angIn),
  };
}

function pushRadialEdge(edges, id, source, target, sx, sy, sw, sh, tx, ty, tw, th, parentType, childType, fromSubject = false) {
  edges.push({
    id,
    source,
    target,
    ...edgeHandles(sx, sy, sw, sh, tx, ty, tw, th),
    type: 'smoothstep',
    animated: true,
    style: edgeStyleForLink(parentType, childType, { fromSubject }),
  });
}

function mindmapToRadialElements(apiPayload, expandedIds, animateParents = new Set()) {
  const { subject } = normalizeMindmapPayload(apiPayload);
  const nodes = [];
  const edges = [];
  let seq = 0;
  const nextRfId = () => {
    seq += 1;
    return `ig-${seq}`;
  };

  if (!subject) return { nodes, edges };

  const subChildren = Array.isArray(subject.children) ? subject.children : [];
  const n = subChildren.length;
  const hasRight = n > 0;
  const rightExpanded = hasRight && expandedIds.has(SUBJECT_STABLE_ID);

  const subjectD = RADIAL_SUBJECT_DIAMETER;
  const subjectHalf = subjectD / 2;
  const appHalf = RADIAL_NODE_DIAMETER / 2;

  let R1 = 0;
  if (n > 0) {
    const minAlongSpoke = (subjectD + RADIAL_NODE_DIAMETER) / 2 + HUB_SPOKE_GAP;
    const extraAngularGap = Math.max(0, n - 8) * 14;
    const requiredChord = RADIAL_NODE_DIAMETER + FIRST_RING_ANGULAR_MARGIN + extraAngularGap;
    const minAngular = n <= 1 ? minAlongSpoke : requiredChord / (2 * Math.sin(Math.PI / n));
    R1 = Math.max(minAlongSpoke, minAngular);
    if (n >= 10) R1 += RADIAL_NODE_DIAMETER * 0.28;
    else if (n >= 8) R1 += RADIAL_NODE_DIAMETER * 0.16;
  }

  const subPx = -subjectHalf;
  const subPy = -subjectHalf;
  const subRfId = nextRfId();
  const subjectType = subject?.attributes?.type || 'User';

  if (rightExpanded && n > 0) {
    const diameter = 2 * R1;
    nodes.push({
      id: 'ring',
      type: 'radialRing',
      position: { x: -R1, y: -R1 },
      width: diameter,
      height: diameter,
      draggable: false,
      selectable: false,
      zIndex: -1,
      data: { radius: R1, spokeCount: n },
    });
  }

  nodes.push({
    id: subRfId,
    type: 'identityPill',
    position: { x: subPx, y: subPy },
    width: subjectD,
    height: subjectD,
    data: {
      nodeShape: 'circle',
      nodeDiameter: subjectD,
      stableId: SUBJECT_STABLE_ID,
      label: subject?.name != null ? String(subject.name) : '—',
      nodeType: subjectType,
      attributes: subject?.attributes || {},
      hasChildren: hasRight,
      hasAccessChildren: hasRight,
      expanded: rightExpanded,
      childCount: subChildren.length,
      isSubject: true,
      managerChainLength: 0,
      showSubjectManagerReveal: false,
    },
  });

  function walkFromParent(
    node,
    parentRfId,
    parentPx,
    parentPy,
    parentW,
    parentH,
    parentType,
    stableId,
    accessTreeDepth,
    theta,
    px,
    py,
    opts = {},
  ) {
    if (!node) return;

    const { w: myW, h: myH, shape: myShape } = dimensionsForRadialNode(node, accessTreeDepth);
    const rfId = nextRfId();
    const childEntries = getRadialChildEntries(node, stableId);
    const hasCh = childEntries.length > 0;
    const forceExpanded = Boolean(opts.forceExpanded);
    const suppressToggle = Boolean(opts.suppressToggle);
    const animateIn = Boolean(opts.animateIn);
    const appearDelayMs = typeof opts.appearDelayMs === 'number' ? opts.appearDelayMs : 0;
    const fromSubject = Boolean(opts.fromSubject);
    const expanded = hasCh && (forceExpanded || expandedIds.has(stableId));
    const nodeType = node?.attributes?.type || 'User';
    const typ = normType(node?.attributes);
    const label = node?.name != null ? String(node.name) : '—';

    const circleData = myShape === 'circle' ? { nodeShape: 'circle', nodeDiameter: myW } : {};

    nodes.push({
      id: rfId,
      type: 'identityPill',
      position: { x: px, y: py },
      width: myW,
      height: myH,
      data: {
        ...circleData,
        stableId,
        label,
        nodeType,
        attributes: node?.attributes || {},
        hasChildren: suppressToggle ? false : hasCh,
        expanded,
        childCount: childEntries.length,
        accessTreeDepth,
        ...(myShape === 'pill' ? { nodeWidth: myW, nodeHeight: myH } : {}),
        ...(animateIn ? { animateIn: true, appearDelayMs } : {}),
      },
    });

    pushRadialEdge(
      edges,
      `e-${parentRfId}-${rfId}`,
      parentRfId,
      rfId,
      parentPx,
      parentPy,
      parentW,
      parentH,
      px,
      py,
      myW,
      myH,
      parentType,
      nodeType,
      fromSubject,
    );

    if (!expanded) return;

    const m = childEntries.length;
    const { ux, uy } = outwardUnitForChildren(theta);
    const { px: perpX, py: perpY } = perpUnit(ux, uy);
    const nextTheta = Math.atan2(uy, ux);
    const myCx = px + myW / 2;
    const myCy = py + myH / 2;

    for (let j = 0; j < m; j += 1) {
      const { node: childNode, stableId: childStableId } = childEntries[j];
      const childDepth = accessTreeDepth + 1;
      const childTyp = normType(childNode?.attributes);
      const { w: cw, h: ch } = dimensionsForRadialNode(childNode, childDepth);
      const extraAlong =
        typ === 'account' && childTyp === 'entitlement' ? ACCOUNT_ENTITLEMENT_EXTRA_ALONG : 0;
      const stepAlong =
        halfExtentAlong(myW, myH, ux, uy) + INTER_LEVEL_GAP + extraAlong + halfExtentAlong(cw, ch, ux, uy);
      const sibGap = childTyp === 'entitlement' ? ENTITLEMENT_SIBLING_EDGE_GAP : SIBLING_EDGE_GAP;
      const siblingSpacing = 2 * halfExtentAlong(cw, ch, perpX, perpY) + sibGap;
      const ox = (j - (m - 1) / 2) * siblingSpacing;
      const ccx = myCx + stepAlong * ux + ox * perpX;
      const ccy = myCy + stepAlong * uy + ox * perpY;
      const cpx = ccx - cw / 2;
      const cpy = ccy - ch / 2;

      // When this node was just expanded, stagger its children in so the reveal
      // flows outward: application → account → entitlement (the end of the chain).
      const childOpts = {};
      if (animateParents.has(stableId)) {
        const typeBase = childTyp === 'entitlement' ? 220 : childTyp === 'account' ? 60 : 0;
        childOpts.animateIn = true;
        childOpts.appearDelayMs = typeBase + j * 70;
      }

      // Application cascade expands accounts so entitlements show with the same + click.
      walkFromParent(
        childNode,
        rfId,
        px,
        py,
        myW,
        myH,
        nodeType,
        childStableId,
        childDepth,
        nextTheta,
        cpx,
        cpy,
        childOpts,
      );
    }
  }

  if (rightExpanded) {
    const animateRing = animateParents.has(SUBJECT_STABLE_ID);
    subChildren.forEach((child, i) => {
      const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const cx = R1 * Math.cos(theta);
      const cy = R1 * Math.sin(theta);
      const px = cx - appHalf;
      const py = cy - appHalf;
      const appearDelayMs = animateRing ? 80 + i * 90 : 0;
      walkFromParent(
        child,
        subRfId,
        subPx,
        subPy,
        subjectD,
        subjectD,
        subjectType,
        `${SUBJECT_STABLE_ID}-${i}`,
        1,
        theta,
        px,
        py,
        animateRing
          ? { animateIn: true, appearDelayMs, fromSubject: true }
          : { fromSubject: true },
      );
    });
  }

  return { nodes, edges };
}

export default function RadialMindmap({
  graphData,
  onNodeMeta,
  profilePhotoSrc = null,
  initialExpandedIds = null,
  expansionRequest = null,
}) {
  const { setViewport } = useReactFlow();
  const containerRef = useRef(null);
  const fitDebounceRef = useRef(null);
  const hasNodesRef = useRef(false);
  const didInitialFitRef = useRef(false);
  const prevExpandedRef = useRef(new Set());

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());

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

  useEffect(() => {
    // Start collapsed on the subject — expand via + only.
    setExpandedIds(
      initialExpandedIds instanceof Set && initialExpandedIds.size > 0
        ? new Set(initialExpandedIds)
        : new Set(),
    );
    didInitialFitRef.current = false;
    prevExpandedRef.current = new Set();
  }, [graphData, initialExpandedIds]);

  const runFitView = useCallback(() => {
    const el = containerRef.current;
    if (!el || !nodes.length) return;

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

    const padPx = 72;
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
    // Parents whose children were just revealed by this expand — used to stagger
    // the pop-in animation outward (identity → application → account → entitlement).
    const prevExpanded = prevExpandedRef.current;
    const animateParents = new Set();
    for (const id of expandedIds) {
      if (!prevExpanded.has(id)) animateParents.add(id);
    }
    prevExpandedRef.current = new Set(expandedIds);

    const { nodes: rawNodes, edges: rawEdges } = mindmapToRadialElements(graphData, expandedIds, animateParents);
    setNodes(
      rawNodes.map((n) =>
        n.type === 'identityPill'
          ? {
              ...n,
              data: {
                ...n.data,
                fullAccessExpanded,
                onToggleExpand: toggleExpand,
                ...(n.data?.isSubject && profilePhotoSrc ? { profilePhotoSrc } : {}),
                fontScale: (() => {
                  const t = String(n.data?.attributes?.type || n.data?.nodeType || '').trim().toLowerCase();
                  if (t === 'application') return 1.08;
                  if (t === 'account') return 1.04;
                  if (t === 'entitlement') return 1.02;
                  return 1;
                })(),
              },
            }
          : n,
      ),
    );
    setEdges(rawEdges);
  }, [expandedIds, fullAccessExpanded, graphData, profilePhotoSrc, setEdges, setNodes, toggleExpand]);

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

  useEffect(() => {
    if (!graphData || !nodes.length) return;
    if (didInitialFitRef.current) return;
    didInitialFitRef.current = true;
    const raf = requestAnimationFrame(runFitView);
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
      if (node?.type === 'radialRing' || node?.type === 'spiderWeb') return;
      const stableId = node?.data?.stableId;
      const typ = String(node?.data?.attributes?.type || node?.data?.nodeType || '').trim().toLowerCase();
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
      if (node?.type === 'radialRing' || node?.type === 'spiderWeb') return;
      const stableId = node?.data?.stableId;
      if (stableId && node?.data?.expanded && node?.data?.hasChildren) {
        toggleExpand(stableId);
      }
    },
    [toggleExpand],
  );

  return (
    <Box
      ref={containerRef}
      sx={mindmapCanvasFrameSx}
    >
      <MindmapStormBackdrop />
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
