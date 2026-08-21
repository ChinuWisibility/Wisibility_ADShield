import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Paper,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  ListSubheader,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Alert,
  TextField,
  Stack,
  IconButton,
  Chip,
  Tooltip,
} from '@mui/material';
import { Add, Preview, Save, ArrowBack, DragIndicator, Drafts as DraftsIcon } from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { identityProfileAPI, hrmsIntegrationAPI, applicationAPI } from '../../services/api';
import { palette } from '../../theme/palette';
import { ORANGEHRM_SUGGESTED_ATTRIBUTES } from '../../constants/identityProfileTargets';

/** App Registry row (connector + delimited fields on `hrms`). */
function mapApplicationToMappingSource(app) {
  const h = app.hrms || {};
  return {
    _id: app._id,
    name: app.name,
    connector: h.connector,
    delimitedCsvHeaders: h.delimitedCsvHeaders || [],
    delimitedPreviewRows: h.delimitedPreviewRows || [],
    isActive: app.status !== 'decommissioned',
  };
}

/** Normalize populated `applicationId` / `hrmsSourceId` from API to a string for Select keys and schema cache. */
function coerceApplicationId(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'object' && raw._id != null) return String(raw._id);
  return String(raw);
}

/** Collapse for loose column ↔ target matching (user_id / userId / USER ID). */
function normFieldKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function variantsForMatching(id) {
  const raw = String(id || '').trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const squeezed = lower.replace(/[^a-z0-9]/g, '');
  const snake = raw
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  const snakeSqueeze = snake.replace(/_/g, '');
  return [...new Set([raw, lower, squeezed, snake, snakeSqueeze, normFieldKey(raw)])].filter(Boolean);
}

/**
 * Pick a source column when the user has not chosen one yet (e.g. after choosing app or when schema loads).
 */
function pickAutoSourceAttribute(targetKey, targetLabel, options, metaTargets = []) {
  if (!Array.isArray(options) || !options.length) return '';
  const normToOriginal = new Map();
  for (const o of options) {
    const n = normFieldKey(o);
    if (n && !normToOriginal.has(n)) normToOriginal.set(n, o);
  }
  const tryNorms = [];
  const pushAll = (id) => {
    for (const v of variantsForMatching(id)) {
      const n = normFieldKey(v);
      if (n) tryNorms.push(n);
    }
  };
  pushAll(targetKey);
  pushAll(targetLabel);
  const metaLabel = metaTargets.find((t) => t.key === targetKey)?.label;
  if (metaLabel) pushAll(metaLabel);
  const paren = String(targetLabel || '').match(/\(([^)]+)\)/);
  if (paren) pushAll(paren[1]);

  const seen = new Set();
  for (const n of tryNorms) {
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (normToOriginal.has(n)) return normToOriginal.get(n);
  }
  return '';
}

function displayPreviewValue(resolved) {
  if (resolved === null || resolved === undefined || resolved === '') return '—';
  return String(resolved);
}

/** "User Name" → "UserName" (PascalCase words). */
function attributeNameToPascalTechnical(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/** PascalCase → camelCase for stored targetKey (matches backend / built-in keys like email, uid). */
function pascalToCamelCase(pascal) {
  const p = String(pascal || '').trim();
  if (!p) return '';
  return p.charAt(0).toLowerCase() + p.slice(1);
}

const TARGET_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

/** Map common display labels to canonical identity keys so "Work Email" → email (not workEmail → synthetic @unmapped.local). */
function inferCanonicalTargetKeyFromLabel(label, derivedKey) {
  const L = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (/^(work email|email|e-mail)$/.test(L)) return 'email';
  if (/^(given name|first name)$/.test(L)) return 'firstname';
  if (/^(family name|last name|surname)$/.test(L)) return 'lastname';
  if (/^display name$/.test(L) || L === 'displayname') return 'displayName';
  if (/^(employee id|emp id)$/.test(L)) return 'employeeId';
  // Do not map "User Name" / "Username" → uid; respect derived keys (e.g. userName). Only literal "uid" → uid.
  if (/^uid$/.test(L)) return 'uid';
  if (/^department$/.test(L)) return 'department';
  if (/^(job title|title)$/.test(L)) return 'title';
  if (/^(phone|mobile)$/.test(L)) return 'phone';
  return derivedKey;
}

export default function IdentityProfileMappingTab({
  profileId,
  tenantId,
  profile,
  /** From parent to avoid a second application list fetch (limit 500) on this screen. */
  sourceApplications: sourceApplicationsProp,
  onSaved,
  onLiveMappingTargetsChange,
}) {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [meta, setMeta] = useState({
    targets: [],
    transforms: ['none', 'toLower', 'toUpper', 'trim'],
    customTransforms: [],
    mappingSourceModes: [],
  });
  const [hrmsSources, setHrmsSources] = useState([]);
  const [managerLinkBy, setManagerLinkBy] = useState('email');
  const [lifecycleRulesJson, setLifecycleRulesJson] = useState('{}');
  const [attributeAuthorityJson, setAttributeAuthorityJson] = useState('[]');
  const [readiness, setReadiness] = useState(null);
  const [aggregateLoading, setAggregateLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [mappingDragIndex, setMappingDragIndex] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewRowIndex, setPreviewRowIndex] = useState(0);
  /** Populated from preview API when backend has rows (e.g. materialized accounts) without local CSV preview. */
  const [previewMeta, setPreviewMeta] = useState({ labels: [], hint: null, rowCount: 0 });
  const [schemaBySource, setSchemaBySource] = useState({});
  /** Application.userMappings from Application schema (per source app id) */
  const [appBlueprintById, setAppBlueprintById] = useState({});
  const [addTargetOpen, setAddTargetOpen] = useState(false);
  const [addAttrName, setAddAttrName] = useState('');
  const lastHydratedProfileIdRef = useRef(null);
  /** Server tenant lock — same as Identities page; blocks Save mappings + refresh while another sync runs. */
  const [materializationLock, setMaterializationLock] = useState({ active: false });
  /** Draft state */
  const [isDraft, setIsDraft] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  /** Track rows at last save/load to detect dirty state */
  const lastSavedRowsRef = useRef(null);

  /** App Registry HR uses sourceApplicationId + mapping.applicationId; legacy rows use hrmsSourceId. */
  const defaultHrmsId = coerceApplicationId(
    profile?.sourceApplicationId?._id ||
      profile?.sourceApplicationId ||
      profile?.hrmsSourceId?._id ||
      profile?.hrmsSourceId ||
      '',
  );

  useEffect(() => {
    if (!profile) return;
    setManagerLinkBy(profile.managerLinkBy === 'employeeId' ? 'employeeId' : 'email');
    try {
      setLifecycleRulesJson(JSON.stringify(profile.lifecycleRules || {}, null, 2));
    } catch {
      setLifecycleRulesJson('{}');
    }
    try {
      setAttributeAuthorityJson(JSON.stringify(profile.attributeAuthority || [], null, 2));
    } catch {
      setAttributeAuthorityJson('[]');
    }
  }, [profile]);

  const loadReadiness = useCallback(async () => {
    if (!profileId) return;
    try {
      const res = await identityProfileAPI.getReadiness(profileId);
      setReadiness(res.data?.data || null);
    } catch {
      setReadiness(null);
    }
  }, [profileId]);

  useEffect(() => {
    const keys = rows.map((r) => String(r.targetKey || '').trim()).filter(Boolean);
    onLiveMappingTargetsChange?.(keys);
  }, [rows, onLiveMappingTargetsChange]);

  const loadMaterializationLockStatus = useCallback(async () => {
    if (!tenantId) {
      setMaterializationLock({ active: false });
      return;
    }
    try {
      const res = await identityProfileAPI.getMaterializationLockStatus({ tenantId });
      setMaterializationLock(res.data?.data || { active: false });
    } catch {
      /* keep last known lock state on transient poll errors */
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return undefined;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await loadMaterializationLockStatus();
    };
    tick();
    const interval = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tenantId, loadMaterializationLockStatus]);

  /** Sync source app list from parent — avoids a second GET /applications?limit=500 on this page. */
  useEffect(() => {
    if (sourceApplicationsProp?.length) {
      setHrmsSources(sourceApplicationsProp.map(mapApplicationToMappingSource));
    }
  }, [sourceApplicationsProp]);

  const loadMeta = useCallback(async () => {
    try {
      const res = await identityProfileAPI.getMappingMeta(tenantId ? { tenantId } : {});
      const d = res.data?.data;
      if (d) {
        setMeta((m) => ({
          ...m,
          targets: d.targets || m.targets,
          transforms: d.transforms || m.transforms,
          customTransforms: Array.isArray(d.customTransforms) ? d.customTransforms : [],
          mappingSourceModes: d.mappingSourceModes || m.mappingSourceModes,
        }));
      }
    } catch {
      /* ignore */
    }
  }, [tenantId]);

  const ensureSchema = useCallback(
    async (hrmsSourceId) => {
      const sid = hrmsSourceId != null ? String(hrmsSourceId) : '';
      if (!sid) return;
      try {
        const [appRes, schemaRes] = await Promise.all([
          applicationAPI.getById(sid),
          hrmsIntegrationAPI.getDelimitedSchema(sid, { tenantId }).catch(() => ({ data: {} })),
        ]);
        const app = appRes.data?.data;
        const um = app?.userMappings || [];
        setAppBlueprintById((prev) => ({ ...prev, [sid]: um.length ? um : prev[sid] || [] }));
        const d = schemaRes?.data?.data;
        setSchemaBySource((prev) => ({
          ...prev,
          [sid]: {
            headers: d?.headers || [],
            previewRows: d?.previewRows || [],
          },
        }));
      } catch {
        setAppBlueprintById((prev) => ({ ...prev, [sid]: prev[sid] || [] }));
        setSchemaBySource((prev) => ({
          ...prev,
          [sid]: prev[sid] || { headers: [], previewRows: [] },
        }));
      }
    },
    [tenantId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profileId || !tenantId || !profile) return;
      setLoading(true);
      try {
        await loadMeta();
        if (cancelled) return;
        const profileChanged = lastHydratedProfileIdRef.current !== profileId;
        lastHydratedProfileIdRef.current = profileId;

        // Check for a saved draft first — if present, restore draft rows instead of attributeMappings
        const draft = profile?.mappingDraft;
        const hasDraft = draft?.isDraft === true && Array.isArray(draft?.mappingDraftData) && draft.mappingDraftData.length > 0;

        if (hasDraft && profileChanged) {
          const draftRows = draft.mappingDraftData.map((m) => ({
            targetKey: m.targetKey || '',
            targetLabel: m.targetLabel || '',
            hrmsSourceId: coerceApplicationId(
              m.applicationId?._id || m.applicationId || m.hrmsSourceId?._id || m.hrmsSourceId || '',
            ),
            sourceAttribute: m.sourceAttribute || '',
            transform: m.transform || 'none',
            transformDefault: m.transformDefault || '',
            customTransformId: coerceApplicationId(m.customTransformId?._id || m.customTransformId || ''),
          }));
          setRows(draftRows);
          setIsDraft(true);
          setLastDraftSavedAt(draft.draftSavedAt ? new Date(draft.draftSavedAt).toLocaleTimeString() : null);
          lastSavedRowsRef.current = JSON.stringify(draftRows);
          setHasUnsavedChanges(false);
          setAppBlueprintById((prev) => {
            const next = { ...prev };
            for (const row of draftRows) {
              const sid = coerceApplicationId(row.hrmsSourceId);
              const sa = String(row.sourceAttribute || '').trim();
              if (!sid || !sa) continue;
              const existing = next[sid] || [];
              const fields = new Set(existing.map((m) => String(m.standardField || '').trim()).filter(Boolean));
              if (!fields.has(sa)) {
                next[sid] = [...existing, { standardField: sa, csvColumn: sa }];
              }
            }
            return next;
          });
          enqueueSnackbar('Draft restored — your previously saved draft has been loaded.', { variant: 'info', autoHideDuration: 6000 });
          const ids = [...new Set(draftRows.map((r) => r.hrmsSourceId).filter(Boolean))];
          if (ids.length) await Promise.all(ids.map((id) => ensureSchema(id)));
          return;
        }

        const list = profile?.attributeMappings;
        // Do not replace in-progress mapping rows with [] when Settings save refreshes `profile` but
        // attributeMappings were never persisted yet (server still has no rows).
        if (!list || !list.length) {
          if (profileChanged) {
            setRows([]);
            lastSavedRowsRef.current = JSON.stringify([]);
          } else {
            setRows((prev) => (prev.length > 0 ? prev : []));
          }
        } else {
          const mapped = list.map((m) => ({
            targetKey: m.targetKey || '',
            targetLabel: m.targetLabel || '',
            hrmsSourceId: coerceApplicationId(
              m.applicationId?._id || m.applicationId || m.hrmsSourceId?._id || m.hrmsSourceId || '',
            ),
            sourceAttribute: m.sourceAttribute || '',
            transform: m.transform || 'none',
            transformDefault: m.transformDefault || '',
            customTransformId: coerceApplicationId(m.customTransformId?._id || m.customTransformId || ''),
          }));
          setRows(mapped);
          lastSavedRowsRef.current = JSON.stringify(mapped);
          setHasUnsavedChanges(false);
          // Seed attribute options from saved mappings so Select shows values before schema API returns.
          setAppBlueprintById((prev) => {
            const next = { ...prev };
            for (const row of mapped) {
              const sid = coerceApplicationId(row.hrmsSourceId);
              const sa = String(row.sourceAttribute || '').trim();
              if (!sid || !sa) continue;
              const existing = next[sid] || [];
              const fields = new Set(existing.map((m) => String(m.standardField || '').trim()).filter(Boolean));
              if (!fields.has(sa)) {
                next[sid] = [...existing, { standardField: sa, csvColumn: sa }];
              }
            }
            return next;
          });
          const ids = [...new Set(mapped.map((r) => r.hrmsSourceId).filter(Boolean))];
          if (ids.length) {
            await Promise.all(ids.map((id) => ensureSchema(id)));
          }
        }

        // Restore draft status from profile even if no rows (draft was cleared)
        if (profileChanged) {
          setIsDraft(draft?.isDraft === true && Array.isArray(draft?.mappingDraftData) && draft.mappingDraftData.length > 0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, tenantId, profile, loadMeta, ensureSchema, enqueueSnackbar]);

  /** Every distinct Source on mapping rows must load schema — e.g. new row with profile default app never hit updateRow(). */
  const rowSourceIdKey = useMemo(() => {
    const ids = [...new Set(rows.map((r) => coerceApplicationId(r.hrmsSourceId)).filter(Boolean))].sort();
    return ids.join('|');
  }, [rows]);

  useEffect(() => {
    if (!tenantId || !profileId) return;
    const ids = rowSourceIdKey ? rowSourceIdKey.split('|').filter(Boolean) : [];
    if (!ids.length) return;
    let cancelled = false;
    (async () => {
      await Promise.all(ids.map((id) => ensureSchema(id)));
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [rowSourceIdKey, tenantId, profileId, ensureSchema]);

  const hrmsById = useMemo(() => {
    const m = {};
    hrmsSources.forEach((h) => {
      m[String(h._id)] = h;
    });
    return m;
  }, [hrmsSources]);

  const attributeOptionsFor = useCallback(
    (hrmsSourceId, currentSourceAttribute = '') => {
      const sid = coerceApplicationId(hrmsSourceId);
      if (!sid) return [];

      const h = hrmsById[sid];
      const um = appBlueprintById[sid] || [];
      const systemFields = um.map((m) => String(m.standardField || '').trim()).filter(Boolean);

      let options = [];
      // If Schema Management has defined system fields, ONLY return those system fields
      if (systemFields.length > 0) {
        options = [...new Set(systemFields)];
      } else if (h?.connector === 'orangehrm') {
        options = [...new Set([...ORANGEHRM_SUGGESTED_ATTRIBUTES])];
      } else {
        /**
         * Delimited / generic: headers from getDelimitedSchema + Application.hrms.delimitedCsvHeaders.
         * Do not require `h` (App list row): `ensureSchema` can finish before `sourceApplications` loads,
         * and excluding the app from the first 500 results would otherwise leave this list empty forever.
         */
        const cached = schemaBySource[sid];
        const fromApi = cached?.headers || [];
        const fromList = h?.delimitedCsvHeaders || [];
        options = [...new Set([...fromApi, ...fromList])];
      }

      // Saved mappings must appear even before schema fetch completes (MUI Select hides unknown values).
      const saved = String(currentSourceAttribute || '').trim();
      if (saved && !options.includes(saved)) {
        options = [saved, ...options];
      }

      return options.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    },
    [hrmsById, appBlueprintById, schemaBySource],
  );

  /** When source + schema are ready, fill Attribute from target key/label (e.g. userId → user_id on CSV). */
  useEffect(() => {
    if (loading) return;
    setRows((prev) => {
      let dirty = false;
      const next = prev.map((row) => {
        if (String(row.sourceAttribute || '').trim()) return row;
        const sid = coerceApplicationId(row.hrmsSourceId);
        if (!sid || !String(row.targetKey || '').trim()) return row;
        const opts = attributeOptionsFor(sid, row.sourceAttribute);
        const pick = pickAutoSourceAttribute(row.targetKey, row.targetLabel, opts, meta.targets || []);
        if (!pick) return row;
        dirty = true;
        return { ...row, sourceAttribute: pick };
      });
      return dirty ? next : prev;
    });
  }, [loading, attributeOptionsFor, meta.targets]);

  /** Record labels from preview API only (aligned with server row count and resolution). */
  const previewRecordLabels = Array.isArray(previewMeta.labels) ? previewMeta.labels : [];

  const previewRowIndexClamped =
    previewRecordLabels.length > 0
      ? Math.min(previewRowIndex, previewRecordLabels.length - 1)
      : 0;

  const addTechnicalPreview = useMemo(
    () => attributeNameToPascalTechnical(addAttrName),
    [addAttrName],
  );

  const storedTargetKeyPreview = useMemo(
    () => pascalToCamelCase(addTechnicalPreview),
    [addTechnicalPreview],
  );

  const handleAddRow = () => {
    setAddAttrName('');
    setAddTargetOpen(true);
  };

  const submitAddAttributeForm = () => {
    const label = addAttrName.trim();
    if (!label) {
      enqueueSnackbar('Enter an attribute name.', { variant: 'warning' });
      return;
    }
    let key = pascalToCamelCase(addTechnicalPreview);
    key = inferCanonicalTargetKeyFromLabel(label, key);
    if (!key || !TARGET_KEY_PATTERN.test(key)) {
      enqueueSnackbar(
        'Technical name must be letters, numbers, underscore, or dot (e.g. "My Field" → myField).',
        { variant: 'warning' },
      );
      return;
    }
    if (rows.some((r) => r.targetKey === key)) {
      enqueueSnackbar('That attribute is already mapped.', { variant: 'warning' });
      return;
    }
    setRows((prev) => [
      ...prev,
      {
        targetKey: key,
        targetLabel: label,
        hrmsSourceId: defaultHrmsId || '',
        sourceAttribute: '',
        transform: 'none',
        customTransformId: '',
      },
    ]);
    setAddTargetOpen(false);
    setAddAttrName('');
    enqueueSnackbar(`Added ${label} (${key})`, { variant: 'success' });
  };

  const handleRemove = (index) => {
    setRows((r) => r.filter((_, i) => i !== index));
  };

  const updateRow = (index, field, value) => {
    setRows((r) => {
      const next = [...r];
      if (field === 'transform') {
        const v = String(value || '');
        if (v.startsWith('studio:')) {
          next[index] = {
            ...next[index],
            customTransformId: v.slice('studio:'.length),
            transform: 'none',
          };
        } else {
          next[index] = {
            ...next[index],
            customTransformId: '',
            transform: v || 'none',
          };
        }
      } else {
        next[index] = { ...next[index], [field]: value };
      }
      if (field === 'hrmsSourceId') {
        next[index].sourceAttribute = '';
        ensureSchema(value);
      }
      return next;
    });
  };

  /** @param {typeof rows} [rowList] defaults to current `rows` (order preserved). */
  const payloadMappings = (rowList = rows) =>
    rowList
      .filter((row) => row.targetKey && row.hrmsSourceId)
      .map((row) => ({
        targetKey: row.targetKey,
        targetLabel: row.targetLabel || meta.targets?.find((t) => t.key === row.targetKey)?.label || '',
        /** Backend accepts applicationId or hrmsSourceId (both resolve to App Registry / legacy HRMS). */
        applicationId: String(row.hrmsSourceId),
        sourceAttribute: row.sourceAttribute || '',
        transform: row.customTransformId ? 'none' : row.transform || 'none',
        transformDefault: row.transformDefault || '',
        ...(row.customTransformId ? { customTransformId: String(row.customTransformId) } : {}),
      }));

  const correlationReady = useMemo(() => {
    const ma = String(profile?.managerCorrelation?.managerAttribute || '').trim();
    const ra = String(profile?.managerCorrelation?.referenceAttribute || '').trim();
    return Boolean(ma && ra && ma !== ra);
  }, [profile?.managerCorrelation?.managerAttribute, profile?.managerCorrelation?.referenceAttribute]);

  /** Track dirty state whenever rows change after initial load */
  useEffect(() => {
    if (loading) return;
    const current = JSON.stringify(rows);
    if (lastSavedRowsRef.current === null) {
      lastSavedRowsRef.current = current;
      return;
    }
    setHasUnsavedChanges(current !== lastSavedRowsRef.current);
  }, [rows, loading]);

  /** Auto-save draft every 30 seconds if there are unsaved changes */
  useEffect(() => {
    if (!profileId || loading) return;
    const interval = setInterval(async () => {
      if (!hasUnsavedChanges || rows.length === 0) return;
      try {
        const res = await identityProfileAPI.saveDraft(profileId, { mappingDraftData: payloadMappings(rows) });
        const d = res.data?.data;
        setIsDraft(true);
        setLastDraftSavedAt(d?.draftSavedAt ? new Date(d.draftSavedAt).toLocaleTimeString() : new Date().toLocaleTimeString());
        lastSavedRowsRef.current = JSON.stringify(rows);
        setHasUnsavedChanges(false);
      } catch {
        /* silent — auto-save failures are non-fatal */
      }
    }, 30000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, loading, hasUnsavedChanges, rows]);

  /** Navigation guard — warn before leaving with unsaved changes */
  useEffect(() => {
    const handler = (e) => {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = 'You have unsaved mapping changes. Are you sure you want to leave?';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  /** Save as Draft handler — saves without manager correlation validation */
  const handleSaveDraft = async () => {
    setDraftSaving(true);
    try {
      const res = await identityProfileAPI.saveDraft(profileId, { mappingDraftData: payloadMappings(rows) });
      const d = res.data?.data;
      setIsDraft(true);
      setLastDraftSavedAt(d?.draftSavedAt ? new Date(d.draftSavedAt).toLocaleTimeString() : new Date().toLocaleTimeString());
      lastSavedRowsRef.current = JSON.stringify(rows);
      setHasUnsavedChanges(false);
      enqueueSnackbar('Draft saved successfully', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Failed to save draft', { variant: 'error' });
    } finally {
      setDraftSaving(false);
    }
  };

  const handleSave = async () => {
    let lifecycleRules = {};
    let attributeAuthority = [];
    try {
      lifecycleRules = lifecycleRulesJson.trim() ? JSON.parse(lifecycleRulesJson) : {};
    } catch {
      enqueueSnackbar('Lifecycle rules must be valid JSON (object).', { variant: 'error' });
      return;
    }
    try {
      attributeAuthority = attributeAuthorityJson.trim() ? JSON.parse(attributeAuthorityJson) : [];
      if (!Array.isArray(attributeAuthority)) throw new Error('not array');
    } catch {
      enqueueSnackbar('Attribute authority must be a valid JSON array.', { variant: 'error' });
      return;
    }
    if (!correlationReady) {
      enqueueSnackbar(
        'Choose Manager key field and Reference field on the Settings tab (and save) before saving mappings.',
        { variant: 'warning', autoHideDuration: 8000 },
      );
      return;
    }
    if (materializationLock.active) {
      const who = materializationLock.ownerDisplayName || 'another user';
      enqueueSnackbar(`Identity sync is already running (${who}). Wait until it finishes, then save again.`, {
        variant: 'warning',
        autoHideDuration: 10000,
      });
      return;
    }

    setSaving(true);

    try {
      const saveRes = await identityProfileAPI.putMappings(
        profileId,
        {
          attributeMappings: payloadMappings(),
          mappingSourceMode: profile?.mappingSourceMode ?? 'application_account_schema',
          managerLinkBy,
          lifecycleRules,
          attributeAuthority,
          /** Single server-side pipeline: save + refresh under one tenant lock (no gap for a second client). */
          syncIdentities: true,
        },
        { timeout: 600000 },
      );

      // Clear draft now that final save succeeded
      setIsDraft(false);
      setHasUnsavedChanges(false);
      lastSavedRowsRef.current = JSON.stringify(rows);
      try {
        await identityProfileAPI.clearDraft(profileId);
      } catch {
        /* non-fatal */
      }

      onSaved?.();
      await loadReadiness();
      const d = saveRes.data?.syncResult || {};
      await loadMaterializationLockStatus();
      const upserted = d.identitiesUpserted ?? 0;
      const rowsProcessed = d.rowsProcessed ?? 0;
      const managers = d.managersLinked ?? 0;

      if (upserted === 0 && rowsProcessed > 0) {
        enqueueSnackbar(
          d.hint ||
            'No identities were created — every row was skipped. Map email and correlation fields to match Application schema and your data.',
          { variant: 'warning', autoHideDuration: 14000 },
        );
        return;
      }

      const detail =
        managers > 0
          ? `Synced ${upserted} identities (${managers} managers linked) from your mappings.`
          : `Synced ${upserted} identities from your mappings.`;
      navigate('/identities', { state: { identitySyncMessage: detail } });
    } catch (e) {
      if (e.response?.status === 409) {
        const who = e.response?.data?.lock?.ownerDisplayName || 'another user';
        enqueueSnackbar(`${e.response?.data?.message || 'Locked.'} (${who})`, {
          variant: 'warning',
          autoHideDuration: 12000,
        });
        await loadMaterializationLockStatus();
      } else {
        enqueueSnackbar(e.response?.data?.message || 'Failed to save or sync identities', { variant: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAggregateCheck = async () => {
    setAggregateLoading(true);
    try {
      const res = await identityProfileAPI.aggregateDelimited(profileId);
      const d = res.data?.data || {};
      enqueueSnackbar(
        d.aggregated
          ? `Aggregation: ${d.rowCount} row(s) loaded for ${d.sourceName || 'source'}.`
          : 'No CSV rows on this delimited source. Import via Application → Application schema or your connector, then retry.',
        { variant: d.aggregated ? 'success' : 'warning' },
      );
      loadReadiness();
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Aggregation check failed', { variant: 'error' });
    } finally {
      setAggregateLoading(false);
    }
  };

  const mappingSourceModeEffective = profile?.mappingSourceMode ?? 'application_account_schema';

  /** @param {number} rowIndex preview sample row
   *  @param {typeof rows} [rowListOverride] when set, use this order instead of current `rows` (e.g. after drag-reorder). */
  const fetchPreviewAt = async (rowIndex, rowListOverride) => {
    setPreviewLoading(true);
    try {
      const res = await identityProfileAPI.previewMappings(profileId, {
        attributeMappings: payloadMappings(rowListOverride),
        previewRowIndex: rowIndex,
        mappingSourceMode: mappingSourceModeEffective,
      });
      const data = res.data?.data || {};
      setPreviewData(data.rows || []);
      setPreviewMeta({
        labels: Array.isArray(data.previewRowLabels) ? data.previewRowLabels : [],
        hint: data.hint || null,
        rowCount: Number(data.previewRowCount ?? 0) || 0,
      });
    } catch (e) {
      setPreviewData([]);
      setPreviewMeta({ labels: [], hint: null, rowCount: 0 });
      enqueueSnackbar(e.response?.data?.message || 'Preview failed', { variant: 'error' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePreview = async () => {
    const maps = payloadMappings();
    if (!maps.length) return;
    setPreviewRowIndex(0);
    setPreviewOpen(true);
    setPreviewData(null);
    setPreviewMeta({ labels: [], hint: null, rowCount: 0 });
    await fetchPreviewAt(0);
  };

  const handlePreviewIdentityChange = async (index) => {
    const idx = Math.max(0, Number(index) || 0);
    setPreviewRowIndex(idx);
    await fetchPreviewAt(idx);
  };

  const handleMappingDragStart = (index) => {
    setMappingDragIndex(index);
  };

  const handleMappingDragEnd = () => {
    setMappingDragIndex(null);
  };

  const handleMappingDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleMappingDrop = (e, dropIndex) => {
    e.preventDefault();
    const fromStr = e.dataTransfer.getData('text/plain');
    const from = Number.parseInt(fromStr, 10);
    if (fromStr === '' || Number.isNaN(from) || from === dropIndex) return;

    setRows((prev) => {
      const next = [...prev];
      const [removed] = next.splice(from, 1);
      next.splice(dropIndex, 0, removed);
      if (previewOpen) {
        queueMicrotask(() => {
          fetchPreviewAt(previewRowIndex, next);
        });
      }
      return next;
    });
    setMappingDragIndex(null);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={36} />
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', minWidth: 0 }}>
      {materializationLock.active ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Identity sync is in progress for this tenant (started by{' '}
          <strong>{materializationLock.ownerDisplayName || 'another user'}</strong>
          {materializationLock.ownerEmail ? ` — ${materializationLock.ownerEmail}` : ''}). Save mappings is disabled until
          it completes.
        </Alert>
      ) : null}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Button
            variant="text"
            startIcon={<ArrowBack />}
            onClick={() => navigate('/identities/profiles')}
            sx={{ textTransform: 'none', fontWeight: 600, color: 'text.secondary' }}
          >
            Identity Profiles
          </Button>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, borderLeft: '2px solid', borderColor: 'divider', pl: 2 }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary' }}>
              {profile?.name || 'Loading...'}
            </Typography>
            {isDraft && (
              <Tooltip title={lastDraftSavedAt ? `Last draft saved at ${lastDraftSavedAt}` : 'Draft — not yet finally saved'} arrow>
                <Chip
                  label="Draft"
                  size="small"
                  icon={<DraftsIcon sx={{ fontSize: '14px !important' }} />}
                  sx={{
                    bgcolor: 'warning.light',
                    color: 'warning.dark',
                    fontWeight: 700,
                    fontSize: '0.7rem',
                    height: 22,
                    border: '1px solid',
                    borderColor: 'warning.main',
                    '& .MuiChip-icon': { color: 'warning.dark' },
                  }}
                />
              </Tooltip>
            )}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button variant="outlined" startIcon={<Add />} onClick={handleAddRow} size="small">
              Add New Attribute
            </Button>
            <Button variant="outlined" startIcon={<Preview />} onClick={handlePreview} disabled={!payloadMappings().length} size="small">
              Preview
            </Button>
            <Tooltip title={rows.length === 0 ? 'Add at least one attribute before saving draft' : 'Save progress without requiring Manager correlation settings'} arrow>
              <span>
                <Button
                  variant="outlined"
                  startIcon={draftSaving ? <CircularProgress size={14} /> : <DraftsIcon />}
                  onClick={handleSaveDraft}
                  disabled={draftSaving || rows.length === 0}
                  size="small"
                  sx={{
                    borderColor: 'warning.main',
                    color: 'warning.dark',
                    '&:hover': { borderColor: 'warning.dark', bgcolor: 'warning.light' },
                  }}
                >
                  {draftSaving ? 'Saving…' : 'Save as Draft'}
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<Save />}
              onClick={handleSave}
              disabled={saving || !correlationReady || materializationLock.active}
              size="small"
            >
              {saving ? 'Saving & syncing…' : 'Save mappings'}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" align="right" display="block">
            Drag cards by the handle to change order. Preview follows this order after you reorder.
            {!correlationReady && (
              <span>
                {' '}
                <strong>Settings:</strong> pick Manager key field and Reference field (and save) to enable Save mappings.
              </span>
            )}
            {hasUnsavedChanges && !isDraft && (
              <span style={{ color: '#d97706', marginLeft: 8 }}>● Unsaved changes</span>
            )}
          </Typography>
        </Box>
      </Box>

      {rows.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No mappings yet. Click <strong>Add New Attribute</strong> to set up an identity profile mapping.
        </Alert>
      )}

      {rows.map((row, index) => (
        <Paper
          key={row.targetKey || `row-${index}`}
          variant="outlined"
          onDragOver={handleMappingDragOver}
          onDrop={(e) => handleMappingDrop(e, index)}
          sx={{
            mb: 2,
            borderRadius: 2,
            borderColor: palette.border?.default || '#e0e0e0',
            overflow: 'hidden',
            opacity: mappingDragIndex === index ? 0.65 : 1,
            transition: 'opacity 0.15s ease',
          }}
        >
          <Box
            sx={{
              bgcolor: palette.background?.default || '#fcfcfc',
              p: 1.5,
              borderBottom: `1px solid ${palette.border?.default || '#e0e0e0'}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
              <IconButton
                size="small"
                draggable
                aria-label="Drag to reorder mapping"
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', String(index));
                  e.dataTransfer.effectAllowed = 'move';
                  handleMappingDragStart(index);
                }}
                onDragEnd={handleMappingDragEnd}
                sx={{ cursor: 'grab', flexShrink: 0, '&:active': { cursor: 'grabbing' } }}
              >
                <DragIndicator fontSize="small" />
              </IconButton>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {row.targetLabel?.trim() ||
                    (meta.targets || []).find((t) => t.key === row.targetKey)?.label ||
                    row.targetKey ||
                    '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', display: 'block' }}>
                  {row.targetKey}
                </Typography>
              </Box>
            </Box>
            <Button size="small" aria-label="remove mapping" onClick={() => handleRemove(index)} sx={{ color: 'text.secondary', textTransform: 'none', flexShrink: 0 }}>
              Remove
            </Button>
          </Box>

          <Box sx={{ p: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Source</InputLabel>
                  <Select
                    label="Source"
                    value={row.hrmsSourceId != null && row.hrmsSourceId !== '' ? String(row.hrmsSourceId) : ''}
                    onChange={(e) => updateRow(index, 'hrmsSourceId', e.target.value)}
                  >
                    <MenuItem value="">
                      <em>Select application</em>
                    </MenuItem>
                    {hrmsSources.map((h) => (
                      <MenuItem key={String(h._id)} value={String(h._id)}>
                        {h.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth size="small" disabled={!row.hrmsSourceId}>
                  <InputLabel>Attribute</InputLabel>
                  <Select
                    label="Attribute"
                    value={row.sourceAttribute}
                    onChange={(e) => updateRow(index, 'sourceAttribute', e.target.value)}
                  >
                    <MenuItem value="">
                      <em>Select column / field</em>
                    </MenuItem>
                    {attributeOptionsFor(row.hrmsSourceId, row.sourceAttribute).map((col) => (
                      <MenuItem key={col} value={col}>
                        {col}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Transform</InputLabel>
                  <Select
                    label="Transform"
                    value={
                      row.customTransformId
                        ? `studio:${row.customTransformId}`
                        : row.transform || 'none'
                    }
                    onChange={(e) => updateRow(index, 'transform', e.target.value)}
                  >
                    <ListSubheader disableSticky sx={{ fontWeight: 700, lineHeight: 2.25 }}>
                      Quick (column)
                    </ListSubheader>
                    {(meta.transforms || ['none', 'toLower', 'toUpper', 'trim']).map((t) => (
                      <MenuItem key={t} value={t}>
                        {t}
                      </MenuItem>
                    ))}
                    <Divider component="li" sx={{ my: 0.5 }} />
                    <ListSubheader disableSticky sx={{ fontWeight: 700, lineHeight: 2.25 }}>
                      Transform Studio
                    </ListSubheader>
                    {(meta.customTransforms || []).map((ct) => (
                      <MenuItem key={String(ct._id)} value={`studio:${ct._id}`}>
                        {ct.name || String(ct._id)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            {!row.customTransformId && row.transform === 'defaultIfEmpty' && (
              <Grid container spacing={2} sx={{ mt: 1.5 }}>
                <Grid item xs={12} md={4} sx={{ ml: 'auto' }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Default if empty"
                    value={row.transformDefault || ''}
                    onChange={(e) => updateRow(index, 'transformDefault', e.target.value)}
                  />
                </Grid>
              </Grid>
            )}
          </Box>
        </Paper>
      ))}

      <Dialog
        open={addTargetOpen}
        onClose={() => {
          setAddTargetOpen(false);
          setAddAttrName('');
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Add New Attribute</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="Attribute name"
              placeholder="e.g. User Name"
              value={addAttrName}
              onChange={(e) => setAddAttrName(e.target.value)}
              helperText="Shown on the mapping card."
            />
            <TextField
              fullWidth
              size="small"
              label="Technical name (preview)"
              value={addTechnicalPreview}
              InputProps={{ readOnly: true }}
              helperText={
                storedTargetKeyPreview && TARGET_KEY_PATTERN.test(storedTargetKeyPreview)
                  ? `Stored key: ${storedTargetKeyPreview}`
                  : 'Enter a name that produces a valid key (letters, numbers, _, .).'
              }
              sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace' } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => {
              setAddTargetOpen(false);
              setAddAttrName('');
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={
              !addAttrName.trim() ||
              !storedTargetKeyPreview ||
              !TARGET_KEY_PATTERN.test(storedTargetKeyPreview)
            }
            onClick={submitAddAttributeForm}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        maxWidth="lg"
        fullWidth
        scroll="paper"
        PaperProps={{ sx: { minHeight: '70vh', borderRadius: 2 } }}
      >
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2, pb: 3 }}>
            <Button
              startIcon={<ArrowBack fontSize="small" />}
              onClick={() => setPreviewOpen(false)}
              sx={{ mb: 1, px: 0, textTransform: 'none', color: 'text.secondary' }}
            >
              Mappings
            </Button>
            <Typography variant="h5" component="h2" sx={{ fontWeight: 600, mb: 3 }}>
              Preview Mappings
            </Typography>

            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
              Identity to preview
            </Typography>
            <FormControl
              fullWidth
              size="small"
              sx={{ maxWidth: 560, mb: 1 }}
              disabled={!previewRecordLabels.length || previewLoading}
            >
              <InputLabel id="preview-identity-label">Select record</InputLabel>
              <Select
                labelId="preview-identity-label"
                label="Select record"
                value={previewRecordLabels.length ? previewRowIndexClamped : ''}
                onChange={(e) => handlePreviewIdentityChange(Number(e.target.value))}
              >
                {previewRecordLabels.map((label, idx) => (
                  <MenuItem key={idx} value={idx}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {previewMeta.hint && (
              <Alert severity="warning" sx={{ mb: 2, maxWidth: 720 }}>
                {previewMeta.hint}
              </Alert>
            )}
            {!previewMeta.hint && !previewRecordLabels.length && !previewLoading && (
              <Alert severity="info" sx={{ mb: 2, maxWidth: 560 }}>
                Open the linked application → Application schema to define user mappings and import users, and/or run
                connector sync so accounts appear under Application → Users. Delimited sources can still load preview
                rows from the integration record when configured.
              </Alert>
            )}

            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2, mt: 2 }}>
              Preview
            </Typography>
            {previewLoading ? (
              <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress />
              </Box>
            ) : (
              <Grid container spacing={3}>
                {(previewData || []).map((r, i) => (
                  <Grid item xs={12} sm={6} md={3} key={`${r.targetKey}-${i}`}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        display: 'block',
                        mb: 0.75,
                        fontWeight: 500,
                      }}
                    >
                      {(r.targetLabel || r.targetKey || '').replace(/\s+/g, ' ').toUpperCase()}
                    </Typography>
                    <Typography variant="body1" sx={{ wordBreak: 'break-word', lineHeight: 1.4 }}>
                      {displayPreviewValue(r.resolved)}
                    </Typography>
                  </Grid>
                ))}
              </Grid>
            )}
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
