/**
 * Floating edge renderer for the access graph.
 *
 * App → entitlements use a real tree: one trunk into a junction hub, then
 * dashed rounded branches out to each entitlement (shared-spine fork).
 */

import { memo } from 'react';
import { getBezierPath, Position, useStore } from 'reactflow';
import { GRAPH_COLORS, NODE_SIZE } from './accessGraphTheme';

/**
 * Flowing dots travel the whole chain (identity → application → account →
 * entitlement); `dotBegin` staggers each hop so the pulse reads as one journey.
 */
const VARIANT_STYLE = {
  /** Identity hub → application: solid purple "inheritance" spoke. */
  'identity-application': {
    stroke: GRAPH_COLORS.application,
    width: 2.4,
    path: 'bezier',
    curvature: 0.12,
    dot: true,
    dotBegin: '0s',
    dotColor: '#C4B5FD',
    glow: true,
    sourceDot: GRAPH_COLORS.application,
    targetDot: GRAPH_COLORS.application,
  },
  /** Application → account: dotted "direct relationship" link. */
  'application-account': {
    stroke: GRAPH_COLORS.link,
    width: 1.8,
    path: 'bezier',
    curvature: 0.18,
    dash: '2 6',
    dot: true,
    dotBegin: '0.8s',
    dotColor: GRAPH_COLORS.account,
    glow: false,
    sourceDot: GRAPH_COLORS.account,
    targetDot: GRAPH_COLORS.account,
  },
  /** Account → role: dotted fan link, orange landing dot. */
  'account-entitlement': {
    stroke: GRAPH_COLORS.link,
    width: 1.7,
    path: 'bezier',
    curvature: 0.3,
    dash: '2 6',
    dot: true,
    dotBegin: '1.6s',
    dotColor: GRAPH_COLORS.entitlementDot,
    glow: false,
    sourceDot: GRAPH_COLORS.account,
    targetDot: GRAPH_COLORS.entitlementDot,
  },
  'application-junction': {
    stroke: GRAPH_COLORS.link,
    width: 1.8,
    path: 'straight',
    dot: true,
    dotBegin: '0.8s',
    dotColor: GRAPH_COLORS.account,
    glow: false,
    sourceDot: GRAPH_COLORS.account,
    targetDot: GRAPH_COLORS.account,
  },
  'junction-entitlement': {
    stroke: GRAPH_COLORS.link,
    width: 1.6,
    path: 'fork',
    dash: '2 6',
    forkOffset: 14,
    cornerRadius: 10,
    dot: true,
    dotBegin: '1.6s',
    dotColor: GRAPH_COLORS.entitlementDot,
    glow: false,
    sourceDot: GRAPH_COLORS.account,
    targetDot: GRAPH_COLORS.entitlementDot,
  },
  'application-entitlement': {
    stroke: GRAPH_COLORS.link,
    width: 1.6,
    path: 'fork',
    dash: '2 6',
    forkOffset: 14,
    cornerRadius: 10,
    dot: true,
    dotBegin: '1.2s',
    dotColor: GRAPH_COLORS.entitlementDot,
    glow: false,
    sourceDot: GRAPH_COLORS.account,
    targetDot: GRAPH_COLORS.entitlementDot,
  },
  /** Shared vertical spine linking the junction down through each entitlement row. */
  'app-spine': {
    stroke: GRAPH_COLORS.link,
    width: 1.8,
    path: 'straight',
    dot: true,
    dotBegin: '1.2s',
    dotColor: GRAPH_COLORS.account,
    glow: false,
    sourceDot: GRAPH_COLORS.account,
    targetDot: GRAPH_COLORS.account,
  },
  /** Horizontal bus a row's entitlements sit on, in place of one branch per entitlement. */
  'app-bus': {
    stroke: GRAPH_COLORS.link,
    width: 1.5,
    path: 'straight',
    dash: '2 6',
    dot: true,
    dotBegin: '1.6s',
    dotColor: GRAPH_COLORS.entitlementDot,
    glow: false,
    sourceDot: GRAPH_COLORS.account,
    targetDot: GRAPH_COLORS.account,
  },
};

const FALLBACK_SIZE = {
  identityNode: NODE_SIZE.identity,
  applicationNode: NODE_SIZE.application,
  accountNode: NODE_SIZE.account,
  entitlementNode: NODE_SIZE.entitlement,
  junctionNode: NODE_SIZE.junction,
};

function nodeGeometry(node) {
  const fallback = FALLBACK_SIZE[node.type] || NODE_SIZE.entitlement;
  const width = node.width || node.measured?.width || node.style?.width || fallback.w;
  const height = node.height || node.measured?.height || node.style?.height || fallback.h;
  const x = node.positionAbsolute?.x ?? node.position?.x ?? 0;
  const y = node.positionAbsolute?.y ?? node.position?.y ?? 0;
  return {
    cx: x + Number(width) / 2,
    cy: y + Number(height) / 2,
    halfW: Number(width) / 2,
    halfH: Number(height) / 2,
    circular: node.type === 'applicationNode' || node.type === 'junctionNode',
  };
}

function boundaryPoint(from, toCx, toCy, inset = 1) {
  const dx = toCx - from.cx;
  const dy = toCy - from.cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  if (from.circular) {
    const r = Math.max(3, Math.min(from.halfW, from.halfH) - (from.halfW <= 6 ? 0 : 1));
    return { x: from.cx + ux * r, y: from.cy + uy * r };
  }

  const scaleX = from.halfW === 0 ? Infinity : Math.abs((from.halfW + inset) / (ux || 1e-6));
  const scaleY = from.halfH === 0 ? Infinity : Math.abs((from.halfH + inset) / (uy || 1e-6));
  const scale = Math.min(scaleX, scaleY);
  return { x: from.cx + ux * scale, y: from.cy + uy * scale };
}

function bearingPosition(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? Position.Right : Position.Left;
  return dy > 0 ? Position.Bottom : Position.Top;
}

/** Shared-spine rounded fork (trunk already ends at junction). */
function buildForkPath(sx, sy, tx, ty, forkOffset = 14, cornerRadius = 10) {
  const goingRight = tx >= sx;
  const dir = goingRight ? 1 : -1;
  const gap = Math.abs(tx - sx);
  const midX = sx + dir * Math.max(10, Math.min(forkOffset, gap * 0.4));

  if (Math.abs(ty - sy) < 2) {
    return `M ${sx},${sy} L ${tx},${ty}`;
  }

  const signY = ty > sy ? 1 : -1;
  const r = Math.min(
    cornerRadius,
    Math.abs(midX - sx) * 0.9,
    Math.abs(ty - sy) / 2,
    Math.abs(tx - midX) * 0.9,
  );

  if (r < 2) {
    return `M ${sx},${sy} L ${midX},${sy} L ${midX},${ty} L ${tx},${ty}`;
  }

  return [
    `M ${sx},${sy}`,
    `L ${midX - dir * r},${sy}`,
    `Q ${midX},${sy} ${midX},${sy + signY * r}`,
    `L ${midX},${ty - signY * r}`,
    `Q ${midX},${ty} ${midX + dir * r},${ty}`,
    `L ${tx},${ty}`,
  ].join(' ');
}

function sideAnchors(s, t) {
  const dx = t.cx - s.cx;
  const dy = t.cy - s.cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const goingRight = dx >= 0;
    return {
      sourceX: goingRight ? s.cx + s.halfW : s.cx - s.halfW,
      sourceY: s.cy,
      targetX: goingRight ? t.cx - t.halfW : t.cx + t.halfW,
      targetY: t.cy,
    };
  }
  const goingDown = dy >= 0;
  return {
    sourceX: s.cx,
    sourceY: goingDown ? s.cy + s.halfH : s.cy - s.halfH,
    targetX: t.cx,
    targetY: goingDown ? t.cy - t.halfH : t.cy + t.halfH,
  };
}

function buildPath(variant, sourceX, sourceY, targetX, targetY, sourcePos, targetPos) {
  if (variant.path === 'fork') {
    return buildForkPath(
      sourceX,
      sourceY,
      targetX,
      targetY,
      variant.forkOffset ?? 14,
      variant.cornerRadius ?? 10,
    );
  }
  if (variant.path === 'straight' || !variant.curvature) {
    return `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
  }
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
    curvature: variant.curvature,
  });
  return path;
}

function AccessGraphEdge({ id, source, target, data, markerEnd }) {
  const sourceNode = useStore((store) => store.nodeInternals.get(source));
  const targetNode = useStore((store) => store.nodeInternals.get(target));

  if (!sourceNode || !targetNode) return null;

  const s = nodeGeometry(sourceNode);
  const t = nodeGeometry(targetNode);

  if (!Number.isFinite(s.cx) || !Number.isFinite(t.cx)) return null;
  if (Math.hypot(t.cx - s.cx, t.cy - s.cy) < 2) return null;

  const start = boundaryPoint(s, t.cx, t.cy);
  const end = boundaryPoint(t, s.cx, s.cy);

  const variant = VARIANT_STYLE[data?.variant] || VARIANT_STYLE['junction-entitlement'];
  // High-risk roles keep the same line style — only the landing dot turns red.
  const stroke = variant.stroke;
  const dimmed = Boolean(data?.dimmed);

  let sourceX = start.x;
  let sourceY = start.y;
  let targetX = end.x;
  let targetY = end.y;

  if (variant.path === 'fork' || variant.path === 'straight') {
    const side = sideAnchors(s, t);
    sourceX = side.sourceX;
    sourceY = side.sourceY;
    targetX = side.targetX;
    targetY = side.targetY;
    // Junction is tiny — keep centre as the hub point.
    if (sourceNode.type === 'junctionNode') {
      sourceX = s.cx;
      sourceY = s.cy;
    }
    if (targetNode.type === 'junctionNode') {
      targetX = t.cx;
      targetY = t.cy;
    }
  } else {
    const along = (end.x - s.cx) * (t.cx - s.cx) + (end.y - s.cy) * (t.cy - s.cy);
    const startAlong = (start.x - s.cx) * (t.cx - s.cx) + (start.y - s.cy) * (t.cy - s.cy);
    if (startAlong > along || Math.hypot(end.x - start.x, end.y - start.y) < 8) {
      const midX = (s.cx + t.cx) / 2;
      const midY = (s.cy + t.cy) / 2;
      const ux = (t.cx - s.cx) / (Math.hypot(t.cx - s.cx, t.cy - s.cy) || 1);
      const uy = (t.cy - s.cy) / (Math.hypot(t.cx - s.cx, t.cy - s.cy) || 1);
      sourceX = midX - ux * 10;
      sourceY = midY - uy * 10;
      targetX = midX + ux * 10;
      targetY = midY + uy * 10;
    }
  }

  const sourcePos = bearingPosition(t.cx - s.cx, t.cy - s.cy);
  const targetPos = bearingPosition(s.cx - t.cx, s.cy - t.cy);
  const path = buildPath(variant, sourceX, sourceY, targetX, targetY, sourcePos, targetPos);

  const opacity = dimmed ? 0.12 : 0.92;
  const sourceDot = variant.sourceDot || stroke;
  const targetDot = data?.privileged ? GRAPH_COLORS.privileged : (variant.targetDot || stroke);
  const dotFill = data?.privileged ? GRAPH_COLORS.privileged : (variant.dotColor || stroke);
  const jointR = variant.path === 'fork' ? 2.3 : variant.path === 'straight' ? 2.1 : 3.0;

  return (
    <g style={{ transition: 'opacity 200ms ease' }} opacity={opacity}>
      {variant.glow ? (
        <path
          id={`${id}-glow`}
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={variant.width * 2.8}
          strokeOpacity={0.24}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      <path
        id={id}
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={variant.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={variant.dash || undefined}
        markerEnd={markerEnd}
      />
      <circle cx={sourceX} cy={sourceY} r={jointR} fill={sourceDot} opacity={dimmed ? 0.2 : 1} />
      <circle cx={targetX} cy={targetY} r={jointR} fill={targetDot} opacity={dimmed ? 0.2 : 1} />
      {variant.dot && data?.animated !== false && !dimmed ? (
        <circle r={3} fill={dotFill}>
          <animateMotion dur="2.6s" begin={variant.dotBegin || '0s'} repeatCount="indefinite" path={path} />
        </circle>
      ) : null}
    </g>
  );
}

export default memo(AccessGraphEdge);

export const accessGraphEdgeTypes = {
  accessEdge: memo(AccessGraphEdge),
};
