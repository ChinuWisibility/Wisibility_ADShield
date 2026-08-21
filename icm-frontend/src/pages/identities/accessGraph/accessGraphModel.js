/**
 * Access graph data model + radial mindmap layout.
 *
 * Converts the `/identities/:id/graph` payload into a typed model
 * (identity -> applications -> accounts -> roles) and turns the expanded
 * subset into React Flow nodes/edges: identity hub in the centre, apps on a
 * ring, each app's account parked outward along its spoke and the account's
 * roles fanned out beyond it, perpendicular to the spoke.
 */

import { NODE_SIZE, RING } from './accessGraphTheme';

export const ROOT_ID = 'identity';
export const ORBIT_ID = 'orbit-rings';

function attrs(node) {
  return node && typeof node.attributes === 'object' && node.attributes ? node.attributes : {};
}

function typeOf(node) {
  return String(attrs(node).type || '').trim().toLowerCase();
}

function childrenOf(node) {
  return Array.isArray(node?.children) ? node.children : [];
}

function cleanLabel(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '—';
  return text.replace(/^(entitlement|account|application|user|manager)\s*[-–—:|/]+\s*/i, '').trim() || text;
}

function isPrivileged(node) {
  const a = attrs(node);
  return a.isPrivileged === true || a.privileged === true;
}

/** `{ subject, managerChain }` (current API) or a bare subject tree (legacy). */
export function normalizeGraphPayload(payload) {
  if (!payload) return { subject: null, managerChain: [] };
  if (payload.subject && typeof payload.subject === 'object') {
    return {
      subject: payload.subject,
      managerChain: Array.isArray(payload.managerChain) ? payload.managerChain : [],
    };
  }
  return { subject: payload, managerChain: [] };
}

/**
 * @returns {{
 *   identity: object|null,
 *   applications: object[],
 *   totals: { applications: number, accounts: number, entitlements: number, privileged: number }
 * }}
 */
export function buildAccessGraphModel(payload) {
  const { subject } = normalizeGraphPayload(payload);
  if (!subject) {
    return {
      identity: null,
      applications: [],
      totals: { applications: 0, accounts: 0, entitlements: 0, privileged: 0 },
    };
  }

  const subjectAttrs = attrs(subject);
  const applications = childrenOf(subject)
    .filter((appNode) => typeOf(appNode) === 'application' || childrenOf(appNode).length > 0)
    .map((appNode, appIndex) => {
      const appId = `app-${appIndex}`;
      const appAttrs = attrs(appNode);

      const accounts = childrenOf(appNode).map((accNode, accIndex) => {
        const accountId = `${appId}-acc-${accIndex}`;
        const accAttrs = attrs(accNode);

        const entitlements = childrenOf(accNode).map((entNode, entIndex) => ({
          id: `${accountId}-ent-${entIndex}`,
          kind: 'entitlement',
          parentId: accountId,
          name: cleanLabel(entNode.name),
          privileged: isPrivileged(entNode),
          sourceField: attrs(entNode).sourceField || null,
        }));

        return {
          id: accountId,
          kind: 'account',
          parentId: appId,
          name: cleanLabel(accNode.name),
          status: accAttrs.status || 'Active',
          unresolved: accAttrs.unresolved === true,
          correlationField: accAttrs.correlationField || null,
          entitlements,
          counts: {
            entitlements: entitlements.length,
            privileged: entitlements.filter((e) => e.privileged).length,
          },
        };
      });

      const entitlementCount = accounts.reduce((sum, a) => sum + a.counts.entitlements, 0);
      const privilegedCount = accounts.reduce((sum, a) => sum + a.counts.privileged, 0);

      return {
        id: appId,
        kind: 'application',
        parentId: ROOT_ID,
        name: cleanLabel(appNode.name),
        applicationId: appAttrs.applicationId || null,
        icon: appAttrs.icon || null,
        color: appAttrs.color || null,
        applicationType: appAttrs.applicationType || null,
        accounts,
        counts: {
          accounts: accounts.length,
          entitlements: entitlementCount,
          privileged: privilegedCount,
        },
      };
    });

  const totals = {
    applications: applications.length,
    accounts: applications.reduce((s, a) => s + a.counts.accounts, 0),
    entitlements: applications.reduce((s, a) => s + a.counts.entitlements, 0),
    privileged: applications.reduce((s, a) => s + a.counts.privileged, 0),
  };

  return {
    identity: {
      id: ROOT_ID,
      kind: 'identity',
      name: cleanLabel(subject.name),
      email: subjectAttrs.email || null,
      employeeId: subjectAttrs.employeeId || null,
      jobTitle: subjectAttrs.jobTitle || null,
      department: subjectAttrs.department || null,
      riskScore: subjectAttrs.riskScore ?? null,
      riskLevel: subjectAttrs.riskLevel || null,
      lifecycleState: subjectAttrs.lifecycleState || null,
      isActive: subjectAttrs.isActive !== false,
      identityId: subjectAttrs.identityId || null,
      lastLogin: subjectAttrs.lastLogin || null,
      lastSyncedAt: subjectAttrs.lastSyncedAt || null,
      counts: totals,
    },
    applications,
    totals,
  };
}

/** Ids of every expandable node (identity, apps with accounts, accounts with roles). */
export function collectExpandableIds(model) {
  const ids = new Set();
  if (!model?.identity) return ids;
  if (model.applications.length > 0) ids.add(ROOT_ID);
  for (const app of model.applications) {
    if (app.accounts.length > 0) ids.add(app.id);
    for (const account of app.accounts) {
      if (account.entitlements.length > 0) ids.add(account.id);
    }
  }
  return ids;
}

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}

/** Flatten account → entitlement under an app (legacy helper, still exported). */
export function flatEntitlements(app) {
  if (!app) return [];
  const out = [];
  const seen = new Set();
  for (const account of app.accounts || []) {
    for (const ent of account.entitlements || []) {
      const key = `${String(ent.name).toLowerCase()}\0${ent.privileged ? 1 : 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...ent, accountId: account.id, accountName: account.name });
    }
  }
  return out;
}

/** Ids whose label matches the query (identity, apps, accounts, roles). */
export function collectSearchMatches(model, query) {
  const q = normalizeSearch(query);
  const matches = new Set();
  if (!q || !model?.identity) return matches;

  if (normalizeSearch(model.identity.name).includes(q)) matches.add(ROOT_ID);
  for (const app of model.applications) {
    if (normalizeSearch(app.name).includes(q)) matches.add(app.id);
    for (const account of app.accounts) {
      if (normalizeSearch(account.name).includes(q)) matches.add(account.id);
      for (const ent of account.entitlements) {
        if (normalizeSearch(ent.name).includes(q)) matches.add(ent.id);
      }
    }
  }
  return matches;
}

/** Every ancestor that must be expanded for `matches` to be visible. */
export function expandedIdsForMatches(model, matches) {
  const ids = new Set();
  if (!matches?.size || !model?.identity) return ids;
  for (const app of model.applications) {
    if (matches.has(app.id)) ids.add(ROOT_ID);
    for (const account of app.accounts) {
      if (matches.has(account.id)) {
        ids.add(ROOT_ID);
        ids.add(app.id);
      }
      if (account.entitlements.some((ent) => matches.has(ent.id))) {
        ids.add(ROOT_ID);
        ids.add(app.id);
        ids.add(account.id);
      }
    }
  }
  return ids;
}

const TAU = Math.PI * 2;

/** React Flow positions from a node centre point. */
function topLeft(cx, cy, size) {
  return { x: cx - size.w / 2, y: cy - size.h / 2 };
}

function ringRadius(count, nodeWidth, minRadius) {
  if (count <= 1) return minRadius;
  const spacing = nodeWidth * 1.35;
  const needed = (spacing * count) / TAU;
  return Math.max(minRadius, needed);
}

/**
 * Per-app branch geometry for a given spoke angle: perpendicular fan steps,
 * band capacity and along-spoke offsets, plus the branch's lateral half-width.
 * Placement and ring-clearance both read from here so they cannot drift apart.
 */
function appFanGeometry(app, angle, expanded) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const tx = -uy;
  const ty = ux;
  const ent = NODE_SIZE.entitlement;
  const acc = NODE_SIZE.account;

  // Perpendicular extents (fan direction) and along-spoke extents.
  const roleHalfExtent = (Math.abs(tx) * ent.w + Math.abs(ty) * ent.h) / 2;
  const accountHalfExtent = (Math.abs(tx) * acc.w + Math.abs(ty) * acc.h) / 2;
  const roleStep = roleHalfExtent * 2 + 16;
  const perBand = Math.min(5, Math.max(2, Math.floor(600 / roleStep)));

  const fanHalfWidthOf = (account) => {
    const n = account.entitlements.length;
    if (n === 0 || !(expanded instanceof Set) || !expanded.has(account.id)) return accountHalfExtent;
    const bands = Math.max(1, Math.ceil(n / perBand));
    const rows = Math.ceil(n / bands);
    return ((rows - 1) / 2) * roleStep + roleHalfExtent;
  };

  const accounts = app.accounts;
  const accountStep =
    accounts.length > 1
      ? Math.max(
          accountHalfExtent * 2 + 24,
          Math.max(...accounts.map((a) => fanHalfWidthOf(a) * 2)) + 28,
        )
      : 0;

  const halfWidth = accounts.length
    ? Math.max(
        ...accounts.map(
          (a, i) =>
            Math.abs((i - (accounts.length - 1) / 2) * accountStep) +
            Math.max(fanHalfWidthOf(a), accountHalfExtent),
        ),
      )
    : NODE_SIZE.application.w / 2;

  const accountDist = Math.max(
    RING.accountOffset,
    NODE_SIZE.application.w / 2 +
      (Math.abs(ux) * acc.w + Math.abs(uy) * acc.h) / 2 +
      34,
  );
  const entDist = Math.max(
    RING.entitlementOffset,
    (Math.abs(ux) * (acc.w + ent.w) + Math.abs(uy) * (acc.h + ent.h)) / 2 + 44,
  );
  const bandDepth = Math.abs(ux) * ent.w + Math.abs(uy) * ent.h + 22;

  return { ux, uy, tx, ty, roleStep, perBand, accountStep, accountDist, entDist, bandDepth, halfWidth, fanHalfWidthOf };
}

/**
 * Minimum app-ring radius so adjacent branches (accounts + role fans) do not
 * collide. Branch material starts at `appRadius + accountOffset`, where the
 * gap between neighbouring spokes is `2 * (R + offset) * sin(π/n)`.
 */
function fanClearanceRadius(apps, expanded, appCount, startAngle) {
  if (appCount <= 1) return 0;
  const halves = apps.map((app, index) => {
    if (!expanded.has(app.id) || app.accounts.length === 0) {
      return NODE_SIZE.application.w / 2;
    }
    const angle = startAngle + (TAU * index) / appCount;
    return appFanGeometry(app, angle, expanded).halfWidth;
  });
  const sinHalf = Math.sin(Math.PI / appCount);
  let required = 0;
  for (let i = 0; i < appCount; i += 1) {
    const j = (i + 1) % appCount;
    const need = (halves[i] + halves[j] + 40) / (2 * sinHalf) - RING.accountOffset;
    required = Math.max(required, need);
  }
  return Math.max(0, required);
}

/**
 * Radial mindmap layout.
 *
 * @param {object} model result of `buildAccessGraphModel`
 * @param {Set<string>} expanded ids currently expanded
 * @param {{ matches?: Set<string>, dimUnmatched?: boolean, focusId?: string|null }} [options]
 */
export function layoutAccessGraph(model, expanded, options = {}) {
  const nodes = [];
  const edges = [];
  if (!model?.identity) return { nodes, edges };

  const matches = options.matches instanceof Set ? options.matches : new Set();
  const dimUnmatched = Boolean(options.dimUnmatched && matches.size > 0);
  const focusId = options.focusId || null;

  const decorate = (id) => ({
    isMatch: matches.has(id),
    isDimmed: dimUnmatched && !matches.has(id),
    isFocused: focusId === id,
  });

  const apps = model.applications;
  const rootExpanded = expanded.has(ROOT_ID) && apps.length > 0;

  nodes.push({
    id: ROOT_ID,
    type: 'identityNode',
    position: topLeft(0, 0, NODE_SIZE.identity),
    width: NODE_SIZE.identity.w,
    height: NODE_SIZE.identity.h,
    style: { width: NODE_SIZE.identity.w, height: NODE_SIZE.identity.h },
    data: {
      identity: model.identity,
      expanded: rootExpanded,
      hasChildren: apps.length > 0,
      ...decorate(ROOT_ID),
    },
    draggable: false,
    zIndex: 20,
  });

  if (!rootExpanded) return { nodes, edges };

  const startAngle = -Math.PI / 2;
  const identityClearance =
    Math.hypot(NODE_SIZE.identity.w / 2, NODE_SIZE.identity.h / 2) +
    NODE_SIZE.application.w / 2 +
    26;
  const appRadius = ringRadius(
    apps.length,
    NODE_SIZE.application.w,
    Math.max(
      RING.appMin,
      identityClearance,
      fanClearanceRadius(apps, expanded, apps.length, startAngle),
    ),
  );

  // Decorative spider-web: concentric rings + radial spokes through apps.
  // Rendered as one background OrbitNode.
  const innerOrbit = Math.hypot(NODE_SIZE.identity.w / 2, NODE_SIZE.identity.h / 2) + 22;
  const orbitSpan = (appRadius + 30) * 2;
  nodes.push({
    id: ORBIT_ID,
    type: 'orbitNode',
    position: topLeft(0, 0, { w: orbitSpan, h: orbitSpan }),
    width: orbitSpan,
    height: orbitSpan,
    style: { width: orbitSpan, height: orbitSpan },
    data: {
      innerRadius: innerOrbit,
      outerRadius: appRadius,
      angles: apps.map((_, index) => startAngle + (TAU * index) / Math.max(apps.length, 1)),
      dimmed: dimUnmatched,
    },
    draggable: false,
    selectable: false,
    zIndex: 0,
  });

  apps.forEach((app, index) => {
    const angle = startAngle + (TAU * index) / Math.max(apps.length, 1);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const tx = -uy;
    const ty = ux;
    const cx = ux * appRadius;
    const cy = uy * appRadius;
    const appExpanded = expanded.has(app.id) && app.accounts.length > 0;
    const appDimmed = dimUnmatched && !matches.has(app.id);

    nodes.push({
      id: app.id,
      type: 'applicationNode',
      position: topLeft(cx, cy, NODE_SIZE.application),
      width: NODE_SIZE.application.w,
      height: NODE_SIZE.application.h,
      style: { width: NODE_SIZE.application.w, height: NODE_SIZE.application.h },
      data: {
        application: app,
        expanded: appExpanded,
        hasChildren: app.accounts.length > 0,
        angle,
        ...decorate(app.id),
      },
      draggable: false,
      zIndex: 15,
    });

    edges.push({
      id: `e-${ROOT_ID}-${app.id}`,
      source: ROOT_ID,
      target: app.id,
      type: 'accessEdge',
      data: {
        variant: 'identity-application',
        animated: true,
        dimmed: appDimmed,
      },
    });

    if (!appExpanded) return;

    const accounts = app.accounts;
    const geo = appFanGeometry(app, angle, expanded);

    accounts.forEach((account, accIndex) => {
      const accLateral = (accIndex - (accounts.length - 1) / 2) * geo.accountStep;
      const acx = cx + ux * geo.accountDist + tx * accLateral;
      const acy = cy + uy * geo.accountDist + ty * accLateral;
      const accountDimmed = dimUnmatched && !matches.has(account.id);
      const accountExpanded = expanded.has(account.id) && account.entitlements.length > 0;

      nodes.push({
        id: account.id,
        type: 'accountNode',
        position: topLeft(acx, acy, NODE_SIZE.account),
        width: NODE_SIZE.account.w,
        height: NODE_SIZE.account.h,
        style: { width: NODE_SIZE.account.w, height: NODE_SIZE.account.h },
        data: {
          account,
          application: app,
          expanded: accountExpanded,
          hasChildren: account.entitlements.length > 0,
          ...decorate(account.id),
        },
        draggable: false,
        zIndex: 12,
      });

      edges.push({
        id: `e-${app.id}-${account.id}`,
        source: app.id,
        target: account.id,
        type: 'accessEdge',
        data: {
          variant: 'application-account',
          animated: false,
          dimmed: appDimmed && accountDimmed,
        },
      });

      if (!accountExpanded) return;

      const ents = account.entitlements;
      const bands = Math.max(1, Math.ceil(ents.length / geo.perBand));
      const rows = Math.ceil(ents.length / bands);

      ents.forEach((ent, entIndex) => {
        const band = Math.floor(entIndex / rows);
        const row = entIndex % rows;
        const countInBand = Math.min(rows, ents.length - band * rows);
        const lateral = (row - (countInBand - 1) / 2) * geo.roleStep;
        const dist = geo.entDist + band * geo.bandDepth;
        const ex = acx + ux * dist + tx * lateral;
        const ey = acy + uy * dist + ty * lateral;

        nodes.push({
          id: ent.id,
          type: 'entitlementNode',
          position: topLeft(ex, ey, NODE_SIZE.entitlement),
          width: NODE_SIZE.entitlement.w,
          height: NODE_SIZE.entitlement.h,
          style: { width: NODE_SIZE.entitlement.w, height: NODE_SIZE.entitlement.h },
          data: {
            entitlement: ent,
            account,
            application: app,
            ...decorate(ent.id),
          },
          draggable: false,
          zIndex: 10,
        });

        edges.push({
          id: `e-${account.id}-${ent.id}`,
          source: account.id,
          target: ent.id,
          type: 'accessEdge',
          data: {
            variant: 'account-entitlement',
            animated: false,
            dimmed: dimUnmatched && !matches.has(ent.id),
            privileged: ent.privileged,
          },
        });
      });
    });
  });

  return { nodes, edges };
}
