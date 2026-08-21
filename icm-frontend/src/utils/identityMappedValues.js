import { canonicalIdentityMappingTargetKey } from './canonicalIdentityTargetKey.js';
export function normalizeDigitLikeDisplayValue(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const r = Math.round(value);
    if (Number.isInteger(value) || Math.abs(value - r) < 1e-9) {
      try {
        return globalThis.BigInt(r).toString();
      } catch {
        return String(r);
      }
    }
    return String(value);
  }
  const s = String(value).trim();
  if (/^[+-]?(?:\d+\.?\d*|\d*\.\d+)[eE][+-]?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return normalizeDigitLikeDisplayValue(n);
  }
  return s;
}

/**
 * Display for "manager id" style columns: source / correlation values from HR, not the MongoDB `managerId` ref
 * (list API may populate `managerId` as `{ _id, displayName }`, which must not be JSON-stringified in grids).
 */
export function getManagerIdentifierDisplayValue(identity) {
  if (!identity) return '';
  const me = identity.managerEmployeeId;
  const mem = identity.managerEmail;
  const raw = identity.managerKeyRaw;
  const attrMid = identity.attributes?.managerId;
  if (me != null && String(me).trim()) return normalizeDigitLikeDisplayValue(me);
  if (mem != null && String(mem).trim()) return String(mem).trim();
  if (raw != null && String(raw).trim()) return String(raw).trim();
  if (attrMid != null && attrMid !== undefined && typeof attrMid !== 'object') {
    const s = normalizeDigitLikeDisplayValue(attrMid).trim();
    if (s) return s;
  }
  const mid = identity.managerId;
  if (mid != null && typeof mid === 'object') {
    if (mid.displayName != null && String(mid.displayName).trim()) return String(mid.displayName).trim();
    if (mid.email != null && String(mid.email).trim()) return String(mid.email).trim();
    if (mid._id != null) return String(mid._id);
  }
  if (mid != null && typeof mid !== 'object') return String(mid);
  return '';
}

/** Mapping target keys that represent manager / hierarchy fields (no separate “Manager” column). */
export function isManagerRelatedTargetKey(targetKey) {
  const s = String(targetKey || '').trim().toLowerCase();
  if (!s) return false;
  if (['managerid', 'manageremail', 'manageremployeeid'].includes(s)) return true;
  if (s.startsWith('manager')) return true;
  return false;
}

function isManagerNameLikeTargetKey(targetKey) {
  const s = String(targetKey || '').trim().toLowerCase();
  if (!s.includes('manager')) return false;
  return s.includes('name');
}

/**
 * When `managerResolutionStatus` is set, surface root / unresolved / resolved manager state in manager
 * mapped columns only (not a dedicated grid column).
 */
export function applyManagerHierarchyDisplay(identity, targetKey, computedValue) {
  if (!identity || !isManagerRelatedTargetKey(targetKey)) return computedValue ?? '';
  const st = identity.managerResolutionStatus;
  const k = String(targetKey || '').trim();

  if (st === 'root') {
    return 'No Manager';
  }
  if (st === 'unresolved') {
    const raw = identity.managerKeyRaw != null ? String(identity.managerKeyRaw).trim() : '';
    if (isManagerNameLikeTargetKey(k)) {
      return raw || 'Unresolved';
    }
    const idDisp = getManagerIdentifierDisplayValue(identity);
    return idDisp || raw || '—';
  }
  /**
   * For name-like manager columns (e.g. managerName ← source `manager_name`), prefer the value from
   * mappings / `attributes.*` (HR feed). Replacing it with the linked manager Identity’s `displayName`
   * was meant as enrichment but often shows an employee id (EMP…) when that identity’s displayName is id-based.
   */
  if (st === 'resolved' && isManagerNameLikeTargetKey(k)) {
    const hr = String(computedValue ?? '').trim();
    if (hr) return hr;
    const m = identity.managerId;
    if (m && typeof m === 'object' && m.displayName != null && String(m.displayName).trim()) {
      return String(m.displayName).trim();
    }
  }
  return computedValue ?? '';
}

function computeIdentityValueByTargetKeyCore(identity, k) {
  switch (k) {
    case 'uid': {
      const u =
        identity.attributes?.uid ??
        identity.attributes?.username ??
        identity.email ??
        '';
      return normalizeDigitLikeDisplayValue(u);
    }
    case 'email':
      return identity.email ?? '';
    case 'lastname':
      return identity.lastName ?? '';
    case 'firstname':
      return identity.firstName ?? '';
    case 'displayName': {
      const dn = String(identity.displayName ?? '').trim();
      if (dn) return dn;
      const parts = [identity.firstName, identity.lastName].filter(Boolean);
      if (parts.length) return parts.join(' ').trim();
      const attrs = identity.attributes && typeof identity.attributes === 'object' ? identity.attributes : {};
      const fromAttr = attrs.display_name ?? attrs.displayName ?? attrs.displayname;
      if (fromAttr != null && String(fromAttr).trim()) return String(fromAttr).trim();
      return '';
    }
    case 'employeeId':
      return normalizeDigitLikeDisplayValue(identity.employeeId ?? '');
    case 'department':
      return identity.department ?? '';
    case 'title':
      return identity.title ?? '';
    case 'phone':
      return normalizeDigitLikeDisplayValue(identity.phoneNumber ?? '');
    case 'managerEmail':
      return identity.managerEmail ?? '';
    case 'managerEmployeeId':
      return identity.managerEmployeeId != null ? normalizeDigitLikeDisplayValue(identity.managerEmployeeId) : '';
    /** ObjectId ref — show HR / correlation identifiers, not populated sub-doc JSON. */
    case 'managerId':
      return getManagerIdentifierDisplayValue(identity);
    case 'startDate': {
      const d = identity.startDate;
      if (!d) return '';
      try {
        const dt = d instanceof Date ? d : new Date(d);
        return Number.isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString();
      } catch {
        return String(d);
      }
    }
    case 'status':
      return identity.lifecycleState ?? '';
    default: {
      if (identity[k] !== undefined && identity[k] !== null) {
        const v = identity[k];
        if (typeof v === 'object') {
          if (v && typeof v === 'object' && (v._id != null || v.displayName != null)) {
            if (String(k).toLowerCase() === 'managerid') {
              return getManagerIdentifierDisplayValue(identity);
            }
          }
          return JSON.stringify(v);
        }
        return normalizeDigitLikeDisplayValue(v);
      }
      const av = identity.attributes?.[k];
      if (av !== undefined && av !== null) {
        return typeof av === 'object' ? JSON.stringify(av) : normalizeDigitLikeDisplayValue(av);
      }
      return '';
    }
  }
}

/**
 * Resolve Identity Profile mapping targetKey → display value from an Identity document.
 * Keys align with backend `identityProfileTargets` / mapping UI.
 */
export function getIdentityValueByTargetKey(identity, targetKey) {
  if (!identity) return '';
  const raw = String(targetKey || '').trim();
  const k = canonicalIdentityMappingTargetKey(raw);
  const core = computeIdentityValueByTargetKeyCore(identity, k);
  const withMgr = applyManagerHierarchyDisplay(identity, raw, core);
  return normalizeDigitLikeDisplayValue(withMgr);
}

/** Augment row with synthetic `targetKey` properties for table sort/search. */
export function augmentIdentityRowWithMappedKeys(identity, mappedFields) {
  const base = { ...identity, id: identity._id || identity.id };
  if (!mappedFields?.length) return base;
  for (const f of mappedFields) {
    const tk = f.targetKey;
    if (!tk) continue;
    base[tk] = getIdentityValueByTargetKey(identity, tk);
  }
  return base;
}
