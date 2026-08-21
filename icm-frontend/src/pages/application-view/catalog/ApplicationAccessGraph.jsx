/**
 * Application-rooted access graph: application hub → junction → entitlements.
 * Reuses Identity Access Graph nodes and fork edges.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Controls,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Box, Typography, Chip } from '@mui/material';
import { AppsOutlined } from '@mui/icons-material';
import { accessGraphNodeTypes } from '../../identities/accessGraph/AccessGraphNodes';
import { accessGraphEdgeTypes } from '../../identities/accessGraph/AccessGraphEdge';
import {
  GRAPH_COLORS,
  GRAPH_FONT,
  NODE_SIZE,
  STORM_CANVAS_BG,
} from '../../identities/accessGraph/accessGraphTheme';
import {
  MindmapStormBackdrop,
  mindmapControlsStyle,
} from '../../identities/mindmapComponents/mindmapShared';
import { normalizePrivilegeBoolean } from '../../../services/accessCertificationService';
import { CATALOG } from '../../identities/catalog/catalogTheme';

const ROOT_ID = 'application';
const MAX_ENTS = 150;

function topLeft(cx, cy, size) {
  return { x: cx - size.w / 2, y: cy - size.h / 2 };
}

function entLabel(row) {
  return (
    row.entitlement_name
    || row.entitlementName
    || row.name
    || row.entitlement_id
    || row.entitlementId
    || 'Entitlement'
  );
}

function layoutAppGraph(application, entitlements, expanded) {
  const nodes = [];
  const edges = [];
  const ents = (entitlements || []).slice(0, MAX_ENTS);
  const rootExpanded = expanded.has(ROOT_ID) && ents.length > 0;

  const appModel = {
    id: ROOT_ID,
    name: application?.name || 'Application',
    icon: application?.icon,
    color: application?.color,
    type: application?.type || application?.connectorType,
    counts: {
      accounts: 0,
      entitlements: ents.length,
      privileged: ents.filter((e) => normalizePrivilegeBoolean(e)).length,
    },
  };

  nodes.push({
    id: ROOT_ID,
    type: 'applicationNode',
    position: topLeft(0, 0, NODE_SIZE.application),
    width: NODE_SIZE.application.w,
    height: NODE_SIZE.application.h,
    style: { width: NODE_SIZE.application.w, height: NODE_SIZE.application.h },
    data: {
      application: appModel,
      expanded: rootExpanded,
      hasChildren: ents.length > 0,
      angle: -Math.PI / 2,
    },
    draggable: false,
    zIndex: 20,
  });

  if (!rootExpanded) return { nodes, edges };

  const angle = -Math.PI / 2;
  const ux = Math.cos(angle);
  const junctionDist = NODE_SIZE.application.h / 2 + 28;
  const jx = ux * junctionDist;
  // Junction sits below the hub (+y), matching the entitlement fan-out direction below.
  const jy = junctionDist;
  const junctionId = `${ROOT_ID}-fork`;

  nodes.push({
    id: junctionId,
    type: 'junctionNode',
    position: topLeft(jx, jy, NODE_SIZE.junction),
    width: NODE_SIZE.junction.w,
    height: NODE_SIZE.junction.h,
    style: { width: NODE_SIZE.junction.w, height: NODE_SIZE.junction.h },
    data: {},
    draggable: false,
    selectable: false,
    zIndex: 12,
  });

  edges.push({
    id: `e-${ROOT_ID}-${junctionId}`,
    source: ROOT_ID,
    target: junctionId,
    type: 'accessEdge',
    data: { variant: 'application-junction', animated: true },
  });

  const nEnt = ents.length;
  // Lateral spacing fans entitlements out side-by-side within a row, so it must clear pill width.
  const rowStep = NODE_SIZE.entitlement.w + 24;
  const maxRows = 8;
  const cols = Math.max(1, Math.ceil(nEnt / maxRows));
  const rows = Math.ceil(nEnt / cols);
  const branchBase = junctionDist + NODE_SIZE.junction.h / 2 + NODE_SIZE.entitlement.h / 2 + 36;

  // Per band (row), track the row's y and its leftmost/rightmost entitlement id so a
  // single shared spine + one horizontal bus per row can stand in for what used to be
  // one point-to-point branch per entitlement (28 of those all converging on one origin
  // point produced an unreadable tangle once a row held more than a couple of items).
  const bands = [];

  ents.forEach((row, index) => {
    const col = Math.floor(index / rows);
    const rowIdx = index % rows;
    const countInCol = Math.min(rows, nEnt - col * rows);
    const lateral = (rowIdx - (countInCol - 1) / 2) * rowStep;
    // Successive rows stack downward, so this step only needs to clear pill height.
    const dist = branchBase + col * (NODE_SIZE.entitlement.h + 20);
    const cx = lateral;
    const cy = dist;
    const id = `ent-${row._id || index}`;
    const privileged = normalizePrivilegeBoolean(row);

    nodes.push({
      id,
      type: 'entitlementNode',
      position: topLeft(cx, cy, NODE_SIZE.entitlement),
      width: NODE_SIZE.entitlement.w,
      height: NODE_SIZE.entitlement.h,
      style: { width: NODE_SIZE.entitlement.w, height: NODE_SIZE.entitlement.h },
      data: {
        entitlement: {
          id,
          name: entLabel(row),
          privileged,
          kind: 'entitlement',
        },
      },
      draggable: false,
      zIndex: 10,
    });

    if (!bands[col]) bands[col] = { y: cy, leftId: id, rightId: id };
    else bands[col].rightId = id;
  });

  let spineSource = junctionId;
  bands.forEach((band, col) => {
    if (!band) return;
    const bandAnchorId = `${junctionId}-row-${col}`;
    nodes.push({
      id: bandAnchorId,
      type: 'junctionNode',
      position: topLeft(0, band.y, NODE_SIZE.junction),
      width: NODE_SIZE.junction.w,
      height: NODE_SIZE.junction.h,
      style: { width: NODE_SIZE.junction.w, height: NODE_SIZE.junction.h },
      data: {},
      draggable: false,
      selectable: false,
      zIndex: 5,
    });

    edges.push({
      id: `e-${spineSource}-${bandAnchorId}`,
      source: spineSource,
      target: bandAnchorId,
      type: 'accessEdge',
      data: { variant: 'app-spine', animated: false },
    });
    spineSource = bandAnchorId;

    if (band.leftId !== band.rightId) {
      edges.push({
        id: `e-row-${col}`,
        source: band.leftId,
        target: band.rightId,
        type: 'accessEdge',
        data: { variant: 'app-bus', animated: false },
      });
    }
  });

  return { nodes, edges };
}

function LegendDot({ color, label }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography sx={{ fontSize: '0.7rem', color: GRAPH_COLORS.inkSoft, fontWeight: 600 }}>{label}</Typography>
    </Box>
  );
}

function Legend() {
  return (
    <Box
      sx={{
        position: 'absolute',
        zIndex: 5,
        top: 10,
        right: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.6,
        px: 1.5,
        py: 1,
        borderRadius: 1.5,
        border: `1px solid ${GRAPH_COLORS.border}`,
        bgcolor: 'rgba(13, 21, 38, 0.92)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <LegendDot color={GRAPH_COLORS.application} label="Application" />
      <LegendDot color={GRAPH_COLORS.entitlement} label="Entitlement" />
      <LegendDot color={GRAPH_COLORS.privileged} label="Privileged entitlement" />
    </Box>
  );
}

function Canvas({ application, entitlements }) {
  const { fitView } = useReactFlow();
  const [expanded, setExpanded] = useState(() => new Set());

  const { nodes: layoutNodes, edges } = useMemo(
    () => layoutAppGraph(application, entitlements, expanded),
    [application, entitlements, expanded],
  );

  const nodes = useMemo(
    () => layoutNodes.map((n) => {
      if (n.id !== ROOT_ID) return n;
      return {
        ...n,
        data: {
          ...n.data,
          onToggle: () => {
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(ROOT_ID)) next.delete(ROOT_ID);
              else next.add(ROOT_ID);
              return next;
            });
          },
        },
      };
    }),
    [layoutNodes],
  );

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.28, duration: 280 }), 40);
    return () => clearTimeout(t);
  }, [nodes, edges, fitView]);

  const onNodeClick = useCallback((_, node) => {
    if (node.id !== ROOT_ID) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ROOT_ID)) next.delete(ROOT_ID);
      else next.add(ROOT_ID);
      return next;
    });
  }, []);

  const privCount = (entitlements || []).filter((e) => normalizePrivilegeBoolean(e)).length;

  return (
    <Box
      sx={{
        height: 520,
        position: 'relative',
        borderRadius: 2,
        overflow: 'hidden',
        border: `1px solid ${CATALOG.border}`,
        bgcolor: GRAPH_COLORS.canvas,
        backgroundImage: STORM_CANVAS_BG,
      }}
    >
      <MindmapStormBackdrop />
      <Box
        sx={{
          position: 'absolute',
          zIndex: 5,
          top: 10,
          left: 12,
          display: 'flex',
          gap: 1,
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <Chip
          size="small"
          icon={<AppsOutlined />}
          label={`${(entitlements || []).length} entitlements`}
          sx={{
            fontWeight: 650,
            pointerEvents: 'auto',
            bgcolor: 'rgba(13, 21, 38, 0.92)',
            color: GRAPH_COLORS.ink,
            border: `1px solid ${GRAPH_COLORS.border}`,
            '& .MuiChip-icon': { color: GRAPH_COLORS.application },
          }}
        />
        {privCount > 0 ? (
          <Chip
            size="small"
            label={`${privCount} privileged`}
            sx={{
              fontWeight: 650,
              pointerEvents: 'auto',
              bgcolor: GRAPH_COLORS.privilegedSoft,
              color: GRAPH_COLORS.privileged,
              border: `1px solid ${GRAPH_COLORS.privileged}55`,
            }}
          />
        ) : null}
        <Typography variant="caption" sx={{ color: GRAPH_COLORS.inkFaint, ml: 0.5 }}>
          Click the application to expand
        </Typography>
      </Box>
      <Legend />
      <Box sx={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={accessGraphNodeTypes}
          edgeTypes={accessGraphEdgeTypes}
          onNodeClick={onNodeClick}
          fitView
          minZoom={0.35}
          maxZoom={1.6}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          style={{ width: '100%', height: '100%', background: 'transparent', fontFamily: GRAPH_FONT }}
        >
          <Controls showInteractive={false} style={mindmapControlsStyle} />
        </ReactFlow>
      </Box>
    </Box>
  );
}

export default function ApplicationAccessGraph({ application, entitlements }) {
  return (
    <ReactFlowProvider>
      <Canvas application={application} entitlements={entitlements} />
    </ReactFlowProvider>
  );
}
