import React from 'react';
import { Avatar, Box, Typography, IconButton, Tooltip } from '@mui/material';
import {
  Add,
  Remove,
  Shield,
  Person,
  Apps,
  ManageAccounts,
  VpnKey,
  SupervisorAccount,
} from '@mui/icons-material';
import { Handle, Position } from 'reactflow';

import { palette } from '../../../theme/palette';

/** Fixed layout box — Dagre uses the same dimensions. */
export const NODE_WIDTH = 384;
export const NODE_HEIGHT = 88;

/** Smaller pill used for deep leaf nodes (especially Entitlements). */
export const ENTITLEMENT_NODE_WIDTH = 320;
export const ENTITLEMENT_NODE_HEIGHT = 64;

/** Compact entitlement pills for radial layout. */
export const RADIAL_ENTITLEMENT_NODE_WIDTH = 200;
export const RADIAL_ENTITLEMENT_NODE_HEIGHT = 52;

export function pillNodeDimensions(nodeType) {
  const t = String(nodeType || '').trim().toLowerCase();
  if (t === 'entitlement') return { w: ENTITLEMENT_NODE_WIDTH, h: ENTITLEMENT_NODE_HEIGHT };
  return { w: NODE_WIDTH, h: NODE_HEIGHT };
}

export const EDGE_STYLE = {
  stroke: '#93A5C4',
  strokeWidth: 1.5,
};

/**
 * Typed edge stroke for hierarchy links.
 * @param {string} parentType
 * @param {string} childType
 * @param {{ isHubSpoke?: boolean, fromSubject?: boolean }} [opts]
 */
export function edgeStyleForLink(parentType, childType, opts = {}) {
  const p = String(parentType || '').trim().toLowerCase();
  const c = String(childType || '').trim().toLowerCase();
  const isHubSpoke = Boolean(opts.isHubSpoke) || Boolean(opts.fromSubject);

  if (isHubSpoke || (p === 'user' && c === 'application')) {
    return { stroke: '#A78BFA', strokeWidth: 2.5, opacity: 0.95 };
  }
  if (p === 'application' && c === 'account') {
    return { stroke: '#38D6EC', strokeWidth: 2, opacity: 0.9 };
  }
  if (p === 'account' && c === 'entitlement') {
    return { stroke: '#FB923C', strokeWidth: 1.9, opacity: 0.9 };
  }
  if (p === 'application' && c === 'entitlement') {
    return { stroke: '#FB923C', strokeWidth: 1.9, opacity: 0.9 };
  }
  if (p === 'user' || c === 'user') {
    return { stroke: '#93A5C4', strokeWidth: 1.9, opacity: 0.85 };
  }
  return { ...EDGE_STYLE, opacity: 0.85 };
}

export function pushTypedMindmapEdge(edges, {
  id,
  source,
  target,
  sourceHandle,
  targetHandle,
  parentType,
  childType,
  edgeType = 'smoothstep',
  fromSubject = false,
}) {
  edges.push({
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: edgeType,
    style: edgeStyleForLink(parentType, childType, { fromSubject, isHubSpoke: fromSubject }),
  });
}

/** Matches app theme — enterprise UI faces, strong screen readability. */
export const INDUSTRIAL_FONT_STACK = `"Plus Jakarta Sans", "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

/**
 * Distinct entity hues: User = blue family, Application = violet (not another blue),
 * Manager = slate, Account = teal, Entitlement = amber.
 */
export const NODE_VISUAL = {
  User: {
    border: '#3B82F6',
    dot: '#60A5FA',
    bg: 'rgba(20, 34, 64, 0.82)',
    label: '#EAF1FF',
    shadow: 'rgba(59, 130, 246, 0.45)',
  },
  Manager: {
    border: '#64748B',
    dot: '#94A3B8',
    bg: 'rgba(28, 38, 56, 0.82)',
    label: '#E2E8F0',
    shadow: 'rgba(100, 116, 139, 0.4)',
  },
  Application: {
    border: '#8B5CF6',
    dot: '#A78BFA',
    bg: 'rgba(35, 26, 66, 0.82)',
    label: '#F1ECFF',
    shadow: 'rgba(139, 92, 246, 0.5)',
  },
  Account: {
    border: '#22B8CF',
    dot: '#38D6EC',
    bg: 'rgba(12, 44, 58, 0.82)',
    label: '#E6FBFF',
    shadow: 'rgba(34, 211, 238, 0.45)',
  },
  Entitlement: {
    border: '#F97316',
    dot: '#FB923C',
    bg: 'rgba(56, 32, 12, 0.82)',
    label: '#FFEEDD',
    shadow: 'rgba(249, 115, 22, 0.5)',
  },
};

export function resolveNodeTypeKey(nodeType, attributes) {
  const rel = attributes?.relation;
  if (rel === 'manager') return 'Manager';
  const t = String(nodeType || '').trim().toLowerCase();
  if (t === 'application') return 'Application';
  if (t === 'account') return 'Account';
  if (t === 'entitlement') return 'Entitlement';
  if (t === 'manager') return 'Manager';
  if (t === 'user') return 'User';
  return NODE_VISUAL[nodeType] ? nodeType : 'User';
}

export function typeCaptionForNode(nodeType, attributes) {
  return resolveNodeTypeKey(nodeType, attributes).toUpperCase();
}

export function TypeIconForNode({ nodeType, attributes, sx }) {
  const key = resolveNodeTypeKey(nodeType, attributes);
  const common = { sx: { fontSize: 16, display: 'block', ...sx } };
  if (key === 'Application') return <Apps {...common} />;
  if (key === 'Account') return <ManageAccounts {...common} />;
  if (key === 'Entitlement') return <VpnKey {...common} />;
  if (key === 'Manager') return <SupervisorAccount {...common} />;
  return <Person {...common} />;
}

/**
 * Strip redundant type prefixes from graph labels so nodes show only the real name
 * (e.g. "Entitlement - itil" → "itil", "Account: foo" → "foo").
 */
export function sanitizeMindmapLabel(rawLabel, nodeType, attributes) {
  let text = String(rawLabel ?? '').trim();
  if (!text) return '—';

  const typeKey = resolveNodeTypeKey(nodeType, attributes);
  const prefixes = [
    typeKey,
    typeKey.toLowerCase(),
    typeKey.toUpperCase(),
    'Entitlement',
    'entitlement',
    'ENTITLEMENT',
    'Account',
    'account',
    'ACCOUNT',
    'Application',
    'application',
    'APPLICATION',
    'User',
    'user',
    'USER',
    'Manager',
    'manager',
    'MANAGER',
  ];

  for (const p of prefixes) {
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${escaped}\\s*[-–—:|/]+\\s*`, 'i');
    if (re.test(text)) {
      text = text.replace(re, '').trim();
      break;
    }
  }

  return text || String(rawLabel ?? '').trim() || '—';
}

/** Normalize for fuzzy substring / word-boundary checks. */
function normalizeEntitlementText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PRIVILEGED_ENTITLEMENT_PHRASES = [
  'privileged',
  'privilege',
  'privilig',
  'privilige',
  'domain admin',
  'enterprise admin',
  'global admin',
  'security admin',
  'schema admin',
  'sys admin',
  'super user',
  'superuser',
  'break glass',
  'breakglass',
  'emergency access',
  'tier 0',
  'tier0',
  'full access',
  'elevated access',
  'administrator',
  'global administrator',
  'power user',
  'schemaadmin',
  'sysadmin',
  'god mode',
  'root access',
];

export function isLikelyPrivilegedEntitlement(name, attributes = {}) {
  const a = attributes && typeof attributes === 'object' ? attributes : {};
  if (a.privileged === true || a.isPrivileged === true || a.isPrivilegedAccess === true) return true;
  if (a.risk === 'high' || a.risk === 'critical') return true;

  const combined = normalizeEntitlementText([name, a.sourceField, a.displayName, a.label].filter(Boolean).join(' '));
  if (!combined) return false;

  for (const phrase of PRIVILEGED_ENTITLEMENT_PHRASES) {
    if (combined.includes(phrase)) return true;
  }

  if (/\badmin\b/.test(combined)) return true;
  if (/\broot\b/.test(combined)) return true;
  if (/\bowner\b/.test(combined)) return true;
  if (/\bsudo\b/.test(combined)) return true;

  const hasPrivToken =
    /\bpriv\b/.test(combined) ||
    combined.includes(' priv') ||
    combined.includes('priv ') ||
    combined.startsWith('priv ') ||
    combined.endsWith(' priv') ||
    /[_-]priv\b/.test(combined) ||
    /\bpriv[_-]/.test(combined) ||
    /\bprivil/.test(combined);

  if (hasPrivToken) {
    if (/\bprivate\b/.test(combined) || /\bprivacy\b/.test(combined) || /\bdepriv/.test(combined)) {
      return /\bprivileged\b/.test(combined) || /\bprivilege\b/.test(combined);
    }
    return true;
  }

  return false;
}

/** Remove a node and any expanded descendants from the set (path keys: 0, 0-0, 0-1, …). */
export function collapseExpandedBranch(expandedIds, stableId) {
  const root = String(stableId);
  const next = new Set();
  for (const id of expandedIds) {
    const key = String(id);
    if (key === root) continue;
    if (key.startsWith(`${root}-`)) continue;
    next.add(key);
  }
  return next;
}

/** Resolve a node in the subject access tree by stable path id (SUB, SUB-0, SUB-0-1, …). */
export function findMindmapNodeByStableId(apiPayload, stableId) {
  const { subject } = normalizeMindmapPayload(apiPayload);
  if (!subject) return null;
  const root = String(stableId || '');
  if (!root || root === SUBJECT_STABLE_ID) return subject;

  const prefix = `${SUBJECT_STABLE_ID}-`;
  if (!root.startsWith(prefix)) return null;
  const parts = root.slice(prefix.length).split('-').map((p) => Number(p));
  if (parts.some((n) => !Number.isInteger(n) || n < 0)) return null;

  let cursor = subject;
  for (const idx of parts) {
    const children = Array.isArray(cursor?.children) ? cursor.children : [];
    cursor = children[idx];
    if (!cursor) return null;
  }
  return cursor;
}

/**
 * When expanding an Application, also expand its Account children so entitlements
 * appear in the same click (App → Account → Entitlement).
 */
export function expandMindmapWithApplicationCascade(apiPayload, expandedIds, stableId) {
  const next = new Set(expandedIds);
  next.add(stableId);
  const node = findMindmapNodeByStableId(apiPayload, stableId);
  const type = String(node?.attributes?.type || '').trim().toLowerCase();
  if (type !== 'application') return next;

  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child, i) => {
    const childType = String(child?.attributes?.type || '').trim().toLowerCase();
    if (childType === 'account' && Array.isArray(child.children) && child.children.length > 0) {
      next.add(`${stableId}-${i}`);
    }
  });
  return next;
}

export function resolvePillVisual(nodeType, attributes) {
  const key = resolveNodeTypeKey(nodeType, attributes);
  return NODE_VISUAL[key] || NODE_VISUAL.User;
}

export const SUBJECT_STABLE_ID = 'SUB';

/** Extra rem added to pill labels when the access tree is expanded through accounts (entitlements visible). */
const FULL_EXPANSION_FONT_REM = 0.22;

function addRem(remStr, delta) {
  const m = /^([\d.]+)rem$/.exec(String(remStr));
  if (!m) return remStr;
  const next = Math.round((parseFloat(m[1], 10) + delta) * 1000) / 1000;
  return `${next}rem`;
}

function scaleRem(remStr, factor) {
  const m = /^([\d.]+)rem$/.exec(String(remStr));
  if (!m) return remStr;
  const f = typeof factor === 'number' && Number.isFinite(factor) ? factor : 1;
  if (f === 1) return remStr;
  const next = Math.round(parseFloat(m[1], 10) * f * 1000) / 1000;
  return `${next}rem`;
}

export function withMindmapFullExpansionFont(remStr, fullExpansionBoost) {
  return fullExpansionBoost ? addRem(remStr, FULL_EXPANSION_FONT_REM) : remStr;
}

export function isFullMindmapAccessExpansion(expandedIds) {
  if (!(expandedIds instanceof Set) || !expandedIds.has(SUBJECT_STABLE_ID)) return false;
  for (const id of expandedIds) {
    if (String(id).split('-').length >= 3) return true;
  }
  return false;
}

/** New API: { subject, managerChain }. Legacy: root tree only → treated as subject with no managers. */
export function normalizeMindmapPayload(data) {
  if (!data) return { subject: null, managerChain: [] };
  if (data.subject && typeof data.subject === 'object') {
    return {
      subject: data.subject,
      managerChain: Array.isArray(data.managerChain) ? data.managerChain : [],
    };
  }
  return { subject: data, managerChain: [] };
}

function nodeTypeLower(node) {
  return String(node?.attributes?.type || '').trim().toLowerCase();
}

/**
 * Keep only paths that end in privileged entitlements (plus ancestors).
 * Subject root is always retained so the canvas still has a hub.
 */
export function filterMindmapToPrivilegedAccess(subject) {
  if (!subject || typeof subject !== 'object') return subject;

  const filterNode = (node, isRoot = false) => {
    if (!node || typeof node !== 'object') return null;
    const type = nodeTypeLower(node);
    const children = Array.isArray(node.children) ? node.children : [];

    if (type === 'entitlement') {
      if (!isLikelyPrivilegedEntitlement(node.name, node.attributes)) return null;
      return { ...node, children: [], attributes: { ...(node.attributes || {}), isPrivileged: true } };
    }

    const nextChildren = children
      .map((child) => filterNode(child, false))
      .filter(Boolean);

    if (!isRoot && nextChildren.length === 0) return null;
    return { ...node, children: nextChildren };
  };

  return filterNode(subject, true);
}

/** Stable expand ids for every node that still has children (for privileged-only auto-expand). */
export function collectExpandableStableIds(node, stableId = SUBJECT_STABLE_ID, into = new Set()) {
  if (!node) return into;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length > 0) {
    into.add(stableId);
    children.forEach((child, i) => {
      collectExpandableStableIds(child, `${stableId}-${i}`, into);
    });
  }
  return into;
}

export const PRIVILEGED_ENTITLEMENT_VISUAL = {
  border: '#EF4444',
  dot: '#F87171',
  bg: 'rgba(60, 16, 16, 0.85)',
  label: '#FFE4E4',
  shadow: 'rgba(239, 68, 68, 0.5)',
};

export function pillLabelFontSize(accessTreeDepth, isSubject, isManagerChainNode, nodeType, fullExpansionBoost) {
  const t = String(nodeType || '').trim().toLowerCase();
  let out;
  if (t === 'entitlement') {
    if (typeof accessTreeDepth === 'number' && accessTreeDepth >= 3) out = '0.95rem';
    else if (typeof accessTreeDepth === 'number' && accessTreeDepth >= 2) out = '1rem';
    else out = '1.05rem';
  } else if (typeof accessTreeDepth === 'number' && accessTreeDepth >= 1) {
    if (accessTreeDepth === 1) out = '1.28rem';
    else if (accessTreeDepth === 2) out = '1.2rem';
    else out = '1.15rem';
  } else if (isSubject) out = '1.28rem';
  else if (isManagerChainNode) out = '1.2rem';
  else out = '1.2rem';

  return fullExpansionBoost ? addRem(out, FULL_EXPANSION_FONT_REM) : out;
}

export function circleLabelFontSize(accessTreeDepth, isSubject, diameterPx, photoHero = false) {
  const smallDisk = typeof diameterPx === 'number' && diameterPx < 102;
  if (isSubject && photoHero) return '0.8rem';
  if (isSubject) return '1.05rem';
  if (typeof accessTreeDepth === 'number' && accessTreeDepth >= 2) {
    return smallDisk ? '0.8125rem' : '0.875rem';
  }
  return smallDisk ? '0.875rem' : '0.9375rem';
}

/** Hub + first-ring application nodes (larger). */
export const RADIAL_NODE_DIAMETER = 128;
/** Subject hub — roomy enough to showcase profile photo. */
export const RADIAL_SUBJECT_DIAMETER = 176;

/** Canvas surface — deep storm-night workspace. */
export const MINDMAP_CANVAS_BG = '#070b16';

/** Outer frame for the React Flow workspace. */
export const mindmapCanvasFrameSx = {
  width: '100%',
  height: '100%',
  minHeight: 0,
  flex: 1,
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  bgcolor: MINDMAP_CANVAS_BG,
  backgroundImage: `
    radial-gradient(ellipse 92% 70% at 50% 36%, rgba(59, 86, 178, 0.22) 0%, transparent 60%),
    radial-gradient(ellipse 72% 62% at 78% 78%, rgba(124, 58, 237, 0.18) 0%, transparent 62%),
    linear-gradient(160deg, #0a0f20 0%, #070b16 55%, #04060d 100%)
  `,
};

export const mindmapReactFlowStyle = {
  width: '100%',
  height: '100%',
  background: 'transparent',
};

export const mindmapControlsStyle = {
  background: 'rgba(255,255,255,0.95)',
  backdropFilter: 'blur(8px)',
  border: `1px solid ${palette.border?.default || '#e2e8f0'}`,
  boxShadow: '0 10px 28px rgba(15, 23, 42, 0.1), 0 1px 0 rgba(255,255,255,0.8) inset',
  borderRadius: 12,
  overflow: 'hidden',
};

/** No graph grid — soft wash only (handled by frame gradient). */
export function MindmapCanvasAtmosphere() {
  return null;
}

/** Twinkling starfield (deterministic dot layer). */
const MINDMAP_STARFIELD = [
  '1.5px 1.5px at 8% 18%, rgba(255,255,255,0.85)',
  '1px 1px at 17% 62%, rgba(191,219,254,0.7)',
  '1.5px 1.5px at 24% 34%, rgba(255,255,255,0.6)',
  '1px 1px at 31% 82%, rgba(199,210,254,0.65)',
  '2px 2px at 39% 12%, rgba(255,255,255,0.9)',
  '1px 1px at 46% 48%, rgba(191,219,254,0.55)',
  '1.5px 1.5px at 55% 72%, rgba(255,255,255,0.7)',
  '1px 1px at 62% 26%, rgba(224,231,255,0.7)',
  '1.5px 1.5px at 69% 58%, rgba(255,255,255,0.6)',
  '2px 2px at 74% 88%, rgba(255,255,255,0.85)',
  '1px 1px at 81% 20%, rgba(191,219,254,0.6)',
  '1.5px 1.5px at 88% 44%, rgba(255,255,255,0.75)',
  '1px 1px at 92% 70%, rgba(199,210,254,0.6)',
  '1px 1px at 12% 90%, rgba(255,255,255,0.55)',
  '1.5px 1.5px at 34% 66%, rgba(255,255,255,0.65)',
  '1px 1px at 58% 8%, rgba(224,231,255,0.6)',
]
  .map((spec) => `radial-gradient(${spec}, transparent)`)
  .join(', ');

/**
 * Static storm backdrop for the mindmap graph — layered nebula wash and a
 * starfield. Deliberately animation-free: this sits behind the React Flow pane
 * and any animated blur/blend layer here repaints the whole canvas on every
 * frame, which makes panning and zooming stutter on large graphs.
 */
export function MindmapStormBackdrop() {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            radial-gradient(38% 34% at 28% 30%, rgba(56, 96, 210, 0.28), transparent 62%),
            radial-gradient(44% 40% at 74% 66%, rgba(124, 58, 237, 0.24), transparent 64%),
            radial-gradient(30% 28% at 52% 82%, rgba(14, 116, 144, 0.18), transparent 66%)
          `,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundImage: MINDMAP_STARFIELD,
          backgroundRepeat: 'no-repeat',
          opacity: 0.7,
        }}
      />
    </Box>
  );
}

/** Concentric rings + radial spokes — spider-web backdrop for Radial layout. */
export function RadialRingDecoration({ data }) {
  const r = typeof data?.radius === 'number' ? data.radius : 0;
  const d = 2 * r;
  if (d <= 0) return null;

  const c = r;
  const spokeCount = Math.max(6, Math.min(24, Number(data?.spokeCount) || 12));
  const innerR = Math.max(40, r * 0.28);
  const midRadii = [0.45, 0.65, 0.82].map((t) => innerR + (r - innerR) * t);
  const spokeAngles = Array.from({ length: spokeCount }, (_, i) => (Math.PI * 2 * i) / spokeCount - Math.PI / 2);

  return (
    <Box
      sx={{
        width: d,
        height: d,
        pointerEvents: 'none',
        position: 'relative',
      }}
    >
      <svg width={d} height={d} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <radialGradient id="radial-spider-wash" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(139,92,246,0.08)" />
            <stop offset="50%" stopColor="rgba(37,99,235,0.04)" />
            <stop offset="100%" stopColor="rgba(247,250,253,0)" />
          </radialGradient>
        </defs>
        <circle cx={c} cy={c} r={r} fill="url(#radial-spider-wash)" />
        {spokeAngles.map((angle, index) => (
          <line
            key={`rs-${index}`}
            x1={c + Math.cos(angle) * innerR * 0.4}
            y1={c + Math.sin(angle) * innerR * 0.4}
            x2={c + Math.cos(angle) * r}
            y2={c + Math.sin(angle) * r}
            stroke="rgba(139, 92, 246, 0.28)"
            strokeWidth={1.1}
            strokeLinecap="round"
          />
        ))}
        {midRadii.map((mr, index) => (
          <circle
            key={`rm-${index}`}
            cx={c}
            cy={c}
            r={mr}
            fill="none"
            stroke="rgba(125, 184, 232, 0.45)"
            strokeWidth={1.1}
            strokeDasharray={index % 2 === 0 ? '4 7' : '2 6'}
            strokeLinecap="round"
          />
        ))}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="rgba(139, 92, 246, 0.5)"
          strokeWidth={1.5}
          strokeDasharray="3 8"
          strokeLinecap="round"
        />
        <circle
          cx={c}
          cy={c}
          r={innerR}
          fill="none"
          stroke="rgba(37, 99, 235, 0.4)"
          strokeWidth={2}
          strokeDasharray="28 10"
          strokeLinecap="round"
        />
      </svg>
    </Box>
  );
}

export function IdentityMindmapPillNode({ data, selected }) {
  const v = resolvePillVisual(data.nodeType, data.attributes);
  const nodeType = data.nodeType;
  const typeKey = resolveNodeTypeKey(nodeType, data.attributes);
  const text = sanitizeMindmapLabel(data.label || '—', nodeType, data.attributes);
  const isEntitlement = typeKey === 'Entitlement';
  const isAccount = typeKey === 'Account';
  const isCircle = data.nodeShape === 'circle';
  const D = isCircle ? (typeof data.nodeDiameter === 'number' ? data.nodeDiameter : RADIAL_NODE_DIAMETER) : null;
  const hasChildren = Boolean(data.hasChildren);
  const isExpanded = Boolean(data.expanded);
  const onToggleExpand = data.onToggleExpand;
  const stableId = data.stableId;
  const isSubject = Boolean(data.isSubject);
  const hasAccessChildren = Boolean(data.hasAccessChildren ?? data.hasChildren);
  const isManagerChainNode = Boolean(data.isManagerChainNode);
  const accessTreeDepth = data.accessTreeDepth;
  const fullAccessExpanded = Boolean(data.fullAccessExpanded);
  const profilePhotoSrc = typeof data.profilePhotoSrc === 'string' && data.profilePhotoSrc
    ? data.profilePhotoSrc
    : null;
  const showPhoto = Boolean(profilePhotoSrc) && (isSubject || typeKey === 'User');
  const photoHero = Boolean(isSubject && isCircle && showPhoto);
  const labelFontSize = isCircle
    ? withMindmapFullExpansionFont(
      circleLabelFontSize(accessTreeDepth, isSubject, D, photoHero),
      fullAccessExpanded,
    )
    : pillLabelFontSize(accessTreeDepth, isSubject, isManagerChainNode, nodeType, fullAccessExpanded);
  const fontScale = typeof data?.fontScale === 'number' ? data.fontScale : 1;
  const scaledLabelFontSize = scaleRem(labelFontSize, fontScale);
  const labelColor = v.label ?? '#EAF1FF';
  const avatarPx = photoHero
    ? Math.round((D || RADIAL_SUBJECT_DIAMETER) * 0.58)
    : isCircle
      ? (isSubject ? Math.min(64, Math.round((D || 120) * 0.42)) : 28)
      : isSubject
        ? 44
        : 22;
  const dotPx = isCircle ? 10 : isEntitlement ? 9 : 10;
  const expandIconPx = isCircle
    ? 20
    : isEntitlement
      ? 17
      : 18;
  const chainIndex = data.chainIndex;
  const showExpandManagerParent = Boolean(data.showExpandManagerParent);
  const showCollapseManager = Boolean(data.showCollapseManager);
  const onExpandManagerParent = data.onExpandManagerParent;
  const onCollapseManagerFrom = data.onCollapseManagerFrom;
  const onRevealDirectManager = data.onRevealDirectManager;
  const showSubjectManagerReveal = Boolean(data.showSubjectManagerReveal);

  const showRightExpand = isSubject || hasChildren;
  const rightExpandDisabled = isSubject && !hasAccessChildren;

  const privilegedEntitlement = isEntitlement && isLikelyPrivilegedEntitlement(text, data.attributes);
  const privIconPx = isEntitlement ? 17 : 18;

  const handleToggleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (rightExpandDisabled) return;
    if (stableId != null && typeof onToggleExpand === 'function') {
      onToggleExpand(stableId);
    }
  };

  const handleRevealDirectManager = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (typeof onRevealDirectManager === 'function') onRevealDirectManager();
  };

  const handleExpandManagerParent = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (chainIndex != null && typeof onExpandManagerParent === 'function') {
      onExpandManagerParent(chainIndex);
    }
  };

  const handleCollapseManagerFrom = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (chainIndex != null && typeof onCollapseManagerFrom === 'function') {
      onCollapseManagerFrom(chainIndex);
    }
  };

  const handleStyle = {
    width: 8,
    height: 8,
    border: 'none',
    background: 'transparent',
    opacity: 0,
  };

  const expandBtnSx = {
    flexShrink: 0,
    p: 0.3,
    border: '1px solid',
    borderColor: v.border,
    bgcolor: 'rgba(15, 23, 42, 0.88)',
    color: '#CBD5E1',
    '&:hover': { bgcolor: 'rgba(30, 41, 59, 0.98)' },
  };

  const labelMaxLen = isEntitlement ? 28 : isAccount ? 36 : 42;

  const appearDelayMs = typeof data?.appearDelayMs === 'number' ? data.appearDelayMs : 0;
  const animateIn = Boolean(data?.animateIn);
  const enterAnimSx = animateIn
    ? {
        '@keyframes mindmapEnter': {
          from: { opacity: 0, transform: 'translateY(10px) scale(0.99)' },
          to: { opacity: 1, transform: 'translateY(0px) scale(1)' },
        },
        animation: 'mindmapEnter 280ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        animationDelay: `${Math.max(0, appearDelayMs)}ms`,
      }
    : null;

  const typeDot = showPhoto ? (
    <Avatar
      src={profilePhotoSrc}
      alt=""
      imgProps={{ style: { objectFit: 'cover' } }}
      sx={{
        width: avatarPx,
        height: avatarPx,
        flexShrink: 0,
        border: photoHero ? '3px solid #fff' : `2px solid ${v.border}`,
        outline: photoHero ? `2px solid ${v.border}` : 'none',
        outlineOffset: photoHero ? 1 : 0,
        boxShadow: photoHero
          ? `0 6px 18px rgba(37, 99, 235, 0.28), 0 2px 6px rgba(15, 23, 42, 0.12)`
          : '0 2px 8px rgba(15, 23, 42, 0.12)',
        bgcolor: v.dot,
        fontSize: Math.round(avatarPx * 0.36),
        fontWeight: 700,
      }}
    >
      {String(text || '?').trim().charAt(0).toUpperCase() || '?'}
    </Avatar>
  ) : (
    <Box
      sx={{
        width: dotPx,
        height: dotPx,
        borderRadius: '50%',
        bgcolor: v.dot,
        flexShrink: 0,
      }}
      aria-hidden
    />
  );

  return (
    <>
      <Handle id="top" type="target" position={Position.Top} style={handleStyle} />
      <Handle id="top-src" type="source" position={Position.Top} style={handleStyle} />
      <Handle id="right" type="target" position={Position.Right} style={handleStyle} />
      <Handle id="right-src" type="source" position={Position.Right} style={handleStyle} />
      <Handle id="bottom" type="target" position={Position.Bottom} style={handleStyle} />
      <Handle id="bottom-src" type="source" position={Position.Bottom} style={handleStyle} />
      <Handle id="left" type="target" position={Position.Left} style={handleStyle} />
      <Handle id="left-src" type="source" position={Position.Left} style={handleStyle} />
      {isCircle ? (
        <Box
          sx={{
            position: 'relative',
            width: D,
            height: D,
            borderRadius: '50%',
            boxSizing: 'border-box',
            bgcolor: photoHero ? undefined : v.bg,
            background: photoHero
              ? 'linear-gradient(165deg, rgba(37,99,235,0.38) 0%, rgba(23,37,66,0.92) 60%, rgba(12,18,38,0.95) 100%)'
              : undefined,
            border: `2px solid ${v.border}`,
            boxShadow: isSubject
              ? photoHero
                ? `0 0 0 7px rgba(59,130,246,0.20), 0 14px 34px rgba(2,6,23,0.6), 0 0 30px ${v.shadow}`
                : `0 0 0 6px rgba(59,130,246,0.18), 0 12px 30px rgba(2,6,23,0.55), 0 0 26px ${v.shadow}`
              : selected
                ? `0 12px 28px rgba(2,6,23,0.6), 0 0 24px ${v.shadow}`
                : `0 6px 18px rgba(2,6,23,0.5), 0 0 16px ${v.shadow}`,
            cursor: 'default',
            transition: 'box-shadow 160ms ease, transform 160ms ease',
            transform: selected ? 'translateY(-2px)' : 'none',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: isSubject
                ? `0 0 0 7px rgba(59,130,246,0.24), 0 14px 34px rgba(2,6,23,0.65), 0 0 32px ${v.shadow}`
                : `0 12px 26px rgba(2,6,23,0.6), 0 0 26px ${v.shadow}`,
            },
            ...(enterAnimSx || {}),
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              top: photoHero ? 12 : 8,
              left: 0,
              right: 0,
              bottom: showRightExpand ? (photoHero ? 30 : 36) : (photoHero ? 10 : 8),
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: photoHero ? 'flex-start' : 'center',
              gap: photoHero ? 0.55 : showPhoto ? 0.65 : 0.45,
              pt: photoHero ? 0.25 : 0,
              px: photoHero ? 1.25 : 1.1,
              boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
          >
            {typeDot}
            <Typography
              component="span"
              sx={{
                fontWeight: photoHero ? 700 : 800,
                fontSize: scaledLabelFontSize,
                fontFamily: INDUSTRIAL_FONT_STACK,
                lineHeight: 1.2,
                color: labelColor,
                textAlign: 'center',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
                width: '100%',
                maxHeight: photoHero ? '2.5em' : '3.4em',
                overflow: 'hidden',
                WebkitFontSmoothing: 'antialiased',
                MozOsxFontSmoothing: 'grayscale',
                pointerEvents: 'auto',
                display: 'block',
                letterSpacing: photoHero ? '-0.01em' : undefined,
              }}
              title={text}
            >
              {text}
            </Typography>
          </Box>
          {showSubjectManagerReveal ? (
            <IconButton
              size="small"
              onClick={handleRevealDirectManager}
              aria-label="Show direct manager"
              title="Show direct manager"
              sx={{
                ...expandBtnSx,
                position: 'absolute',
                top: 4,
                left: 4,
                pointerEvents: 'auto',
              }}
            >
              <Add sx={{ fontSize: expandIconPx }} />
            </IconButton>
          ) : null}
          {isManagerChainNode && showExpandManagerParent ? (
            <IconButton
              size="small"
              onClick={handleExpandManagerParent}
              aria-label="Show this person's manager"
              title="Show manager above"
              sx={{
                ...expandBtnSx,
                position: 'absolute',
                top: 4,
                left: 4,
                pointerEvents: 'auto',
              }}
            >
              <Add sx={{ fontSize: expandIconPx }} />
            </IconButton>
          ) : null}
          {isManagerChainNode && showCollapseManager ? (
            <IconButton
              size="small"
              onClick={handleCollapseManagerFrom}
              aria-label="Hide managers from here toward org top"
              title="Hide this level and levels above"
              sx={{
                ...expandBtnSx,
                position: 'absolute',
                top: 4,
                right: 4,
                pointerEvents: 'auto',
              }}
            >
              <Remove sx={{ fontSize: expandIconPx }} />
            </IconButton>
          ) : null}
          {showRightExpand ? (
            <IconButton
              size="small"
              disabled={rightExpandDisabled}
              onClick={handleToggleClick}
              title={
                rightExpandDisabled
                  ? 'No linked applications or entitlements for this identity'
                  : isExpanded
                    ? 'Collapse applications and access'
                    : 'Expand applications and access'
              }
              aria-label={
                rightExpandDisabled
                  ? 'No linked access to expand'
                  : isExpanded
                    ? 'Collapse applications and access'
                    : 'Expand applications and access'
              }
              sx={{
                position: 'absolute',
                bottom: 4,
                left: '50%',
                transform: 'translateX(-50%)',
                flexShrink: 0,
                p: 0.25,
                border: '1px solid',
                borderColor: v.border,
                bgcolor: 'rgba(15, 23, 42, 0.9)',
                color: '#CBD5E1',
                pointerEvents: 'auto',
                '&:hover': { bgcolor: 'rgba(30, 41, 59, 1)' },
                '&.Mui-disabled': { opacity: 0.4 },
              }}
            >
              {isExpanded && hasAccessChildren ? (
                <Remove sx={{ fontSize: expandIconPx }} />
              ) : (
                <Add sx={{ fontSize: expandIconPx }} />
              )}
            </IconButton>
          ) : null}
        </Box>
      ) : (
        <Box
          sx={{
            width: typeof data.nodeWidth === 'number' ? data.nodeWidth : NODE_WIDTH,
            minHeight: typeof data.nodeHeight === 'number' ? data.nodeHeight : NODE_HEIGHT,
            px: isEntitlement ? 1.25 : 1.75,
            py: isEntitlement ? 0.7 : 1,
            borderRadius: isEntitlement ? 2.5 : 999,
            bgcolor: privilegedEntitlement ? PRIVILEGED_ENTITLEMENT_VISUAL.bg : v.bg,
            border: `1.5px solid ${privilegedEntitlement ? PRIVILEGED_ENTITLEMENT_VISUAL.border : v.border}`,
            boxShadow: selected
              ? `0 12px 26px rgba(2,6,23,0.6), 0 0 22px ${privilegedEntitlement ? PRIVILEGED_ENTITLEMENT_VISUAL.shadow : v.shadow}`
              : `0 6px 16px rgba(2,6,23,0.5), 0 0 14px ${privilegedEntitlement ? PRIVILEGED_ENTITLEMENT_VISUAL.shadow : v.shadow}`,
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            fontWeight: 600,
            fontSize: scaledLabelFontSize,
            fontFamily: INDUSTRIAL_FONT_STACK,
            letterSpacing: 0.01,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            color: labelColor,
            cursor: 'default',
            transition: 'box-shadow 160ms ease, transform 160ms ease',
            transform: selected ? 'translateY(-2px)' : 'none',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: `0 12px 24px rgba(2,6,23,0.6), 0 0 20px ${privilegedEntitlement ? PRIVILEGED_ENTITLEMENT_VISUAL.shadow : v.shadow}`,
            },
            ...(enterAnimSx || {}),
          }}
        >
          {showSubjectManagerReveal ? (
            <IconButton
              size="small"
              onClick={handleRevealDirectManager}
              aria-label="Show direct manager"
              title="Show direct manager"
              sx={{ ...expandBtnSx, flexShrink: 0, mr: 0.125 }}
            >
              <Add sx={{ fontSize: expandIconPx }} />
            </IconButton>
          ) : null}
          {isManagerChainNode && showExpandManagerParent ? (
            <IconButton
              size="small"
              onClick={handleExpandManagerParent}
              aria-label="Show this person's manager"
              title="Show manager above"
              sx={{ ...expandBtnSx, flexShrink: 0, mr: 0.125 }}
            >
              <Add sx={{ fontSize: expandIconPx }} />
            </IconButton>
          ) : null}
          {typeDot}
          <Typography
            component="span"
            sx={{
              fontWeight: 700,
              fontSize: scaledLabelFontSize,
              fontFamily: INDUSTRIAL_FONT_STACK,
              lineHeight: 1.3,
              color: labelColor,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
              textAlign: 'left',
              WebkitFontSmoothing: 'antialiased',
              MozOsxFontSmoothing: 'grayscale',
            }}
            title={text.length > labelMaxLen ? text : undefined}
          >
            {text.length > labelMaxLen ? `${text.slice(0, labelMaxLen)}…` : text}
          </Typography>
          {privilegedEntitlement ? (
            <Tooltip title="Privileged" placement="top" arrow>
              <Shield
                sx={{
                  fontSize: privIconPx,
                  color: palette.status.error,
                  flexShrink: 0,
                  display: 'block',
                  filter: 'drop-shadow(0 0 1px rgba(220,38,38,0.35))',
                }}
                aria-label="Privileged entitlement"
              />
            </Tooltip>
          ) : null}
          {isManagerChainNode && showCollapseManager ? (
            <IconButton
              size="small"
              onClick={handleCollapseManagerFrom}
              aria-label="Hide managers from here toward org top"
              title="Hide this level and levels above"
              sx={{ ...expandBtnSx, flexShrink: 0, ml: 0.125 }}
            >
              <Remove sx={{ fontSize: expandIconPx }} />
            </IconButton>
          ) : null}
          {showRightExpand ? (
            <IconButton
              size="small"
              disabled={rightExpandDisabled}
              onClick={handleToggleClick}
              title={
                rightExpandDisabled
                  ? 'No linked applications or entitlements for this identity'
                  : isExpanded
                    ? 'Collapse applications and access'
                    : 'Expand applications and access'
              }
              aria-label={
                rightExpandDisabled
                  ? 'No linked access to expand'
                  : isExpanded
                    ? 'Collapse applications and access'
                    : 'Expand applications and access'
              }
              sx={{
                flexShrink: 0,
                p: 0.3,
                ml: 0.125,
                border: '1px solid',
                borderColor: v.border,
                bgcolor: 'rgba(15, 23, 42, 0.88)',
                color: '#CBD5E1',
                '&:hover': { bgcolor: 'rgba(30, 41, 59, 0.98)' },
                '&.Mui-disabled': { opacity: 0.4 },
              }}
            >
              {isExpanded && hasAccessChildren ? (
                <Remove sx={{ fontSize: expandIconPx }} />
              ) : (
                <Add sx={{ fontSize: expandIconPx }} />
              )}
            </IconButton>
          ) : null}
        </Box>
      )}
    </>
  );
}
