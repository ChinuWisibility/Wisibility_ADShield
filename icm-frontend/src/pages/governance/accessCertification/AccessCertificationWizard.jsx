import React, { useState, useMemo, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Card, CardActionArea, CardContent,
  Typography, Button, TextField, FormControl, Select, InputLabel, MenuItem,
  Alert,
  CircularProgress,
  RadioGroup,
  FormControlLabel,
  Radio,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Checkbox,
  Chip,
  Stack,
  Stepper,
  Step,
  StepLabel,
  Divider,
  alpha,
  Paper,
  Fade,
} from '@mui/material';
import { Person, Shield, ManageAccounts, Add, Delete, Gavel, Apps } from '@mui/icons-material';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';

import IdentitySelectionTable from './IdentitySelectionTable';
import AccessItemSelectionTable from './AccessItemSelectionTable';
import SodViolationSelectionTable from './SodViolationSelectionTable';
import ManagerSelectionTable from './ManagerSelectionTable';
import ProfileManagerSelectionTable from './ProfileManagerSelectionTable';
import CampaignReadinessModal from './CampaignReadinessModal';

import {
  sectionBox,
  sectionTitle,
  fieldLabel,
  summaryLabel,
  summaryValue
} from './AcessStyles';

import { Link as RouterLink } from 'react-router-dom';
import dayjs from 'dayjs';
import { applicationAPI, identityProfileAPI, tenantAPI } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import accessCertificationService from '../../../services/accessCertificationService';

const WIZARD_STEPS = ['Scope', 'Target & Category', 'Access Scope', 'Details', 'Review'];

/** Max rows shown on the Review step before “+N more”. */
const REVIEW_SCOPE_PREVIEW_LIMIT = 12;

/** Sidebar width and top bar height (align with Sidebar.jsx / TopBar) */
const LAYOUT_SIDEBAR_W = 265;
const LAYOUT_TOPBAR_H = 70;
const GAP_RIGHT = 30;
const GAP_BOTTOM = 40;

const toLinearStep = (s) => Math.max(0, Math.min(WIZARD_STEPS.length - 1, s - 1));

/** Frontend-only: flip to true only if you want to hide a flow in this UI */
const WIZARD_COMING_SOON = {
  profileLevel: false,
  uncorrelatedAccounts: true,
};

const SCOPE_ACCENTS = {
  APPLICATION: { main: '#1d4ed8', soft: '#eff6ff', border: '#bfdbfe' },
  PROFILE: { main: '#6d28d9', soft: '#f5f3ff', border: '#ddd6fe' },
};

/* -------------------- Reusable Option Card -------------------- */
const OptionCard = ({
  icon,
  title,
  description,
  selected,
  onClick,
  disabled = false,
  badgeText = '',
  comingSoon = false,
  compact = false,
  accent = SCOPE_ACCENTS.APPLICATION,
}) => (
  <Card
    elevation={selected ? 4 : 0}
    sx={{
      borderRadius: 2,
      border: selected ? '2px solid' : '1px solid',
      borderColor: selected ? accent.border : 'divider',
      bgcolor: selected ? accent.soft : 'background.paper',
      boxShadow: selected ? `0 0 0 3px ${alpha(accent.main, 0.14)}` : 'none',
      transition: 'all .2s ease',
      ...(compact
        ? { minHeight: 220, display: 'flex' }
        : { aspectRatio: '1 / 1', display: 'flex', width: '100%' }),
      opacity: disabled ? 0.55 : 1,
    }}
  >
    <CardActionArea
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      sx={{ display: 'flex', flex: 1, alignItems: 'flex-start', py: compact ? 1 : 2 }}
    >
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: compact ? 0.25 : 1, flex: 1, py: compact ? 1 : undefined, '&:last-child': { pb: compact ? 1 : 2 } }}>
        {(comingSoon || badgeText) && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignSelf: 'flex-start' }}>
            {comingSoon && (
              <Chip label="Coming soon" size="small" variant="outlined" color="default" sx={{ height: 20, fontWeight: 600 }} />
            )}
            {badgeText && (
              <Chip
                label={badgeText}
                size="small"
                sx={{ height: 20, fontWeight: 600 }}
              />
            )}
          </Box>
        )}
        {compact ? (
          <>
            <Box sx={{ color: selected ? accent.main : 'primary.main', display: 'flex', alignItems: 'center', gap: 1 }}>
              {icon}
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: selected ? accent.main : 'text.primary' }}>{title}</Typography>
            </Box>
            {description && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.35 }}>
                {description}
              </Typography>
            )}
          </>
        ) : (
          <>
            <Box sx={{ color: selected ? accent.main : 'primary.main' }}>{icon}</Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: selected ? accent.main : 'text.primary' }}>{title}</Typography>
            <Typography variant="body2" color="text.secondary">{description}</Typography>
          </>
        )}
      </CardContent>
    </CardActionArea>
  </Card>
);

const getReviewerName = (category) => {
  if (category === 'MANAGER') return 'Manager';
  if (category === 'IDENTITY') return 'Identity Owner';
  if (category === 'ACCESS_ITEMS') return 'Access Item Owner';
  if (category === 'UNCORRELATED_ACCOUNTS') return 'Source Owner';
  if (category === 'ROLE_COMPOSITION') return 'Role Owner';
  if (category === 'SOD') return 'SoD Reviewer';
  return 'Unknown';
};

/* -------------------- DYNAMIC TITLE HELPERS (pure helper) -------------------- */
const getCategoryLabel = (cat, accessFilter = 'ALL') => {
  if (!cat) return 'Access';
  if (cat === 'IDENTITY') return 'Identity';
  if (cat === 'ACCESS_ITEMS' && accessFilter === 'PRIVILEGED') return 'Privileges';
  if (cat === 'ACCESS_ITEMS') return 'Access Items';
  if (cat === 'UNCORRELATED_ACCOUNTS') return 'Uncorrelated Accounts';
  if (cat === 'ROLE_COMPOSITION') return 'Role Composition';
  if (cat === 'MANAGER') return 'Managers';
  if (cat === 'SOD') return 'SoD';
  return 'Access';
};

/** Human label after “Selected …” on the Review step (no trailing colon). */
const getScopeSelectionEntityLabel = (cat, accessFilter = 'ALL') => {
  if (!cat) return 'items';
  if (cat === 'IDENTITY') return 'identities';
  if (cat === 'ACCESS_ITEMS' && accessFilter === 'PRIVILEGED') return 'privileges';
  if (cat === 'ACCESS_ITEMS') return 'access items';
  if (cat === 'ROLE_COMPOSITION') return 'roles';
  if (cat === 'MANAGER') return 'managers';
  if (cat === 'UNCORRELATED_ACCOUNTS') return 'uncorrelated accounts';
  if (cat === 'LIFECYCLE_STATUS') return 'identities (lifecycle)';
  if (cat === 'ROLE_MEMBERSHIP') return 'role memberships';
  return getCategoryLabel(cat, accessFilter).toLowerCase();
};

// PROFILE scope only supports these 2 clean categories.
// APPLICATION scope retains the full category set.
const PROFILE_SUPPORTED_CATEGORIES = new Set(['IDENTITY', 'MANAGER']);

/* -------------------- Main Wizard -------------------- */
const AccessCertificationWizard = ({ open, onClose, onCampaignCreated }) => {
  const [step, setStep] = useState(1);

  // Auth context - get user and admin status
  const { user, isAdmin } = useAuth();
  const currentTenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;
  const roleNormalized = (user?.role ?? '')
    .toString()
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
  // Backend allows {admin, superAdmin, certAdmin}; if your tenant rules require, frontend can be
  // permissive and rely on backend for final enforcement.
  const canCreateCampaign = ['admin', 'superadmin', 'certadmin', 'sodadmin'].includes(
    roleNormalized,
  );

  // Data + app state
  const [applications, setApplications] = useState([]);
  const [applicationsGroupedByTenant, setApplicationsGroupedByTenant] = useState([]);
  const [selectedAppId, setSelectedAppId] = useState('');
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const [certificationLevel, setCertificationLevel] = useState('APPLICATION'); // APPLICATION | PROFILE
  const [category, setCategory] = useState('ACCESS_ITEMS');
  const [accessFilter, setAccessFilter] = useState('ALL'); // ALL or PRIVILEGED (for ACCESS_ITEMS)
  // identityMode is still used but chooser is now shown inline in Step 3 (not as a separate step)
  const [identityMode, setIdentityMode] = useState('SPECIFIC');
  const [identityFilter, setIdentityFilter] = useState('ALL'); // ✅ NEW: ALL, NHI, CONTRACTOR
  const [profileIdentityTotal, setProfileIdentityTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  /** Full rows for Review step (access items / roles); API still uses selectedIds. */
  const [selectedAccessObjects, setSelectedAccessObjects] = useState([]);
  /** Full rows for Review step (identities); API still uses selectedIds. */
  const [selectedIdentityObjects, setSelectedIdentityObjects] = useState([]);
  const [campaignName, setCampaignName] = useState('');
  const [campaignNameTouched, setCampaignNameTouched] = useState(false);
  const [campaignDescription, setCampaignDescription] = useState('');
  const [campaignDueDate, setCampaignDueDate] = useState(null);

  // REVIEWER (ACCESS_ITEMS + IDENTITY)
  const [reviewerMode, setReviewerMode] = useState('DEFAULT');
  const [availableManagers, setAvailableManagers] = useState([]);
  const [selectedManagerId, setSelectedManagerId] = useState(null);
  const [externalReviewerEmail, setExternalReviewerEmail] = useState('');
  const [externalReviewerName, setExternalReviewerName] = useState('');
  const [reviewers, setReviewers] = useState([]); // array of { reviewerType, id, name, email }
  const [identityProfiles, setIdentityProfiles] = useState([]);
  const [selectedIdentityProfileId, setSelectedIdentityProfileId] = useState('');
  // Backup routing — shown for DEFAULT reviewer mode
  const [backupManagerReviewerEmail, setBackupManagerReviewerEmail] = useState('');
  const [backupManagerReviewerName, setBackupManagerReviewerName] = useState('');
  const [backupReviewerMode, setBackupReviewerMode] = useState('EXTERNAL'); // INTERNAL | EXTERNAL
  const [backupManagerId, setBackupManagerId] = useState(null);

  // 🔔 Reminder (per campaign)
  const [reminderFrequency, setReminderFrequency] = useState("GLOBAL");

  // ── PROFILE + MANAGER certification ─────────────────────────────────────────
  /** Managers fetched from the selected identity profile (for PROFILE+MANAGER scope). */
  const [profileManagers, setProfileManagers] = useState([]);
  const [profileManagersLoading, setProfileManagersLoading] = useState(false);
  /** Selected manager ObjectId strings (used as scopeFilters.managerIds in payload). */
  const [selectedManagerIds, setSelectedManagerIds] = useState([]);
  /** Full manager row objects for the review step summary. */
  const [selectedManagerObjects, setSelectedManagerObjects] = useState([]);

  // ── Pre-activation readiness modal ──────────────────────────────────────────
  const [readinessModalOpen, setReadinessModalOpen] = useState(false);
  const [readinessData, setReadinessData] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [activatingCampaign, setActivatingCampaign] = useState(false);
  /** The newly created campaign id — stored so readiness check and activate can reference it. */
  const [pendingCampaignId, setPendingCampaignId] = useState(null);
  // ────────────────────────────────────────────────────────────────────────────

  // For APPLICATION scope, reviewer assignment is done in Step 4.
  // For PROFILE scope, reviewer is configured in Step 3 (and auto-assigned for MANAGER).
  const needsReviewerAssignment =
    certificationLevel !== 'PROFILE' && (
      category === 'ACCESS_ITEMS' ||
      category === 'IDENTITY' ||
      category === 'UNCORRELATED_ACCOUNTS' ||
      category === 'ROLE_COMPOSITION'
    );
  const profileCategoryEnabled = PROFILE_SUPPORTED_CATEGORIES.has(category);
  // ACCESS_ITEMS is no longer supported at PROFILE level
  const profileNeedsApplication = false;
  const isProfileIdentityCampaign =
    certificationLevel === 'PROFILE' && category === 'IDENTITY';
  const isProfileManagerCampaign =
    certificationLevel === 'PROFILE' && category === 'MANAGER';

  const selectedApp = useMemo(
    () => applications.find((a) => a.appId === selectedAppId || a._id === selectedAppId) || null,
    [selectedAppId, applications],
  );

  const categoryAccent = useMemo(
    () => SCOPE_ACCENTS[certificationLevel] || SCOPE_ACCENTS.APPLICATION,
    [certificationLevel],
  );

  const normalizeId = (v) => {
    if (v === undefined || v === null || v === '') return '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') {
      if (v.$oid) return String(v.$oid);
      if (v.oid) return String(v.oid);
      if (typeof v.toString === 'function') {
        const s = v.toString();
        if (s && s !== '[object Object]') return s;
      }
    }
    return String(v);
  };

  const isAuthoritativeSourceApp = (app) => Boolean(app?.authoritativeSource);

  /* -------------------- Fetch Tenants (Admin Only) -------------------- */
  useEffect(() => {
    if (!open) return;

    // Non-admin users use their own tenant
    if (!isAdmin) {
      setSelectedTenantId(currentTenantId || '');
      return;
    }

    const loadTenants = async () => {
      try {
        setError(null);
        const res = await tenantAPI.list();
        const raw = res.data?.data || res.data?.tenants || [];
        const list = Array.isArray(raw) ? raw : [];
        setTenants(list);

        // Prefer current user's tenant if present; otherwise fall back to first tenant
        const preferred = currentTenantId || (list[0]?._id || list[0]?.id || '');
        setSelectedTenantId(preferred || '');
      } catch (err) {
        console.error('Failed to load tenants:', err);
      }
    };

    loadTenants();
  }, [open, isAdmin, currentTenantId]);

  /* -------------------- Fetch Applications grouped by Tenant -------------------- */
  useEffect(() => {
    if (!open) return;

    const loadGroupedApps = async () => {
      try {
        setError(null);

        if (!currentTenantId) {
          setApplications([]);
          setApplicationsGroupedByTenant([]);
          setSelectedAppId('');
          return;
        }

        // Always pass tenantId so admins only see their own tenant.
        const [groupedRes, sourceRes] = await Promise.all([
          applicationAPI.getGroupedByTenant({ tenantId: currentTenantId }),
          identityProfileAPI
            .getProfileSourceApplications({ tenantId: currentTenantId })
            .catch(() => ({ data: { data: [] } })),
        ]);

        const groupsRaw = groupedRes?.data?.data || groupedRes?.data || [];
        const groups = Array.isArray(groupsRaw) ? groupsRaw : [];

        const sourceRows = Array.isArray(sourceRes?.data?.data)
          ? sourceRes.data.data
          : [];
        const authoritativeIds = new Set(
          sourceRows
            .filter((r) => r?.kind === 'application')
            .map((r) => normalizeId(r?._id || r?.id))
            .filter(Boolean),
        );

        const mappedGroups = groups.map((g) => {
          const tenantId = normalizeId(g?.tenantId ?? g?.tenant_id);
          const tenantName = g?.tenantName || g?.tenant_name || tenantId || 'Unknown tenant';
          const apps = Array.isArray(g?.applications) ? g.applications : [];

          const mappedApps = apps
            .map((app) => {
              const appId = normalizeId(app?.appId ?? app?._id ?? app?.id);
              if (!appId) return null;
              return {
                ...app,
                appId,
                _id: appId,
                applicationName: app.applicationName || app.name || '—',
                appType: app.appType || app.type || '',
                tenantId,
                tenantName,
              };
            })
            .filter(
              (app) =>
                app &&
                !isAuthoritativeSourceApp(app) &&
                !authoritativeIds.has(app.appId),
            )
            .filter(Boolean);

          return {
            tenantId,
            tenantName,
            tenantCode: g?.tenantCode,
            applications: mappedApps,
          };
        });

        const flat = mappedGroups.flatMap((g) => g.applications || []);

        setApplicationsGroupedByTenant(mappedGroups);
        setApplications(flat);

        // Preserve selected app when refetching; otherwise select first.
        setSelectedAppId((prev) => {
          if (prev && flat.some((a) => a.appId === prev)) return prev;
          return flat[0]?.appId || '';
        });
      } catch (err) {
        console.error('Failed to load applications (grouped by tenant):', err);
        setError('Failed to load applications');
        setApplications([]);
        setApplicationsGroupedByTenant([]);
        setSelectedAppId('');
      }
    };

    loadGroupedApps();
  }, [open, currentTenantId]);

  /* -------------------- Auto-name campaign -------------------- */
  useEffect(() => {
    if (campaignNameTouched) return;

    let autoName = '';
    if (certificationLevel !== 'PROFILE' && selectedAppId && applications.length > 0) {
      const app = applications.find((a) => a.appId === selectedAppId || a._id === selectedAppId);
      if (app) {
        autoName = category === 'UNCORRELATED_ACCOUNTS'
          ? `${app.applicationName} Uncorrelated Accounts Certification`
          : `${app.applicationName} Certification Campaign`;
      }
    }
    setCampaignName(autoName);
  }, [selectedAppId, applications, certificationLevel, category, campaignNameTouched]);

  /* -------------------- Pre-warm reviewer managers for Identity & Access Items */
  useEffect(() => {
    if (!selectedAppId || (step !== 3 && step !== 4) || !needsReviewerAssignment) return;

    accessCertificationService.controller.initializeCertification(
      (data) => {
        const mgrs = data?.managers || [];
        setAvailableManagers(mgrs);
      },
      () => { },
      selectedAppId
    );
  }, [selectedAppId, step, category, needsReviewerAssignment]);

  /* -------------------- Drop selections for frontend-disabled “coming soon” flows -------------------- */
  useEffect(() => {
    if (!open) return;
    if (WIZARD_COMING_SOON.profileLevel && certificationLevel === 'PROFILE') {
      setCertificationLevel('APPLICATION');
    }
    if (WIZARD_COMING_SOON.uncorrelatedAccounts && category === 'UNCORRELATED_ACCOUNTS') {
      setCategory('ACCESS_ITEMS');
      setAccessFilter('ALL');
    }
  }, [open, certificationLevel, category]);

  /* -------------------- Sync scope and category -------------------- */
  useEffect(() => {
    const PROFILE_CATS = ['IDENTITY', 'MANAGER', 'ACCESS_ITEMS', 'LIFECYCLE_STATUS'];
    const APPLICATION_CATS = ['IDENTITY', 'ACCESS_ITEMS'];
    if (certificationLevel === 'PROFILE') {
      if (!PROFILE_CATS.includes(category)) setCategory('IDENTITY');
    } else if (certificationLevel === 'APPLICATION') {
      if (!APPLICATION_CATS.includes(category) && !(category === 'ACCESS_ITEMS')) setCategory('ACCESS_ITEMS');
    }
  }, [certificationLevel, category]);

  /* -------------------- Reset reviewer state when not Identity / Access Items */
  useEffect(() => {
    if (!needsReviewerAssignment) {
      setReviewerMode('DEFAULT');
      setAvailableManagers([]);
      setSelectedManagerId(null);
      setExternalReviewerEmail('');
      setExternalReviewerName('');
      setReviewers([]);
    }
  }, [category, needsReviewerAssignment]);

  useEffect(() => {
    if (!open) return;
    if (certificationLevel !== 'PROFILE') {
      setIdentityProfiles([]);
      setSelectedIdentityProfileId('');
      return;
    }

    const loadIdentityProfiles = async () => {
      try {
        const res = await identityProfileAPI.list({ tenantId: currentTenantId });
        const raw = res?.data?.data || res?.data?.profiles || res?.data || [];
        const list = Array.isArray(raw) ? raw : [];
        setIdentityProfiles(list);
        setSelectedIdentityProfileId((prev) => {
          if (prev && list.some((p) => (p._id || p.id) === prev)) return prev;
          return list[0]?._id || list[0]?.id || '';
        });
      } catch (err) {
        setIdentityProfiles([]);
        setSelectedIdentityProfileId('');
      }
    };

    loadIdentityProfiles();
  }, [open, certificationLevel, currentTenantId]);

  // Profile-scope identity campaigns: fetch total identities for the selected identity profile
  useEffect(() => {
    let cancelled = false;
    const loadTotal = async () => {
      if (!open) return;
      if (!isProfileIdentityCampaign) {
        setProfileIdentityTotal(0);
        return;
      }
      if (!selectedIdentityProfileId) {
        setProfileIdentityTotal(0);
        return;
      }
      try {
        const res = await accessCertificationService.api.getProfileIdentities(
          selectedIdentityProfileId,
          { page: 1, limit: 10, identityFilter },
        );
        if (cancelled) return;
        const total = Number(res?.meta?.total || 0);
        setProfileIdentityTotal(Number.isFinite(total) ? total : 0);
      } catch {
        if (cancelled) return;
        setProfileIdentityTotal(0);
      }
    };
    loadTotal();
    return () => {
      cancelled = true;
    };
  }, [open, isProfileIdentityCampaign, selectedIdentityProfileId, identityFilter]);

  // ── Fetch profile managers for PROFILE + MANAGER certification ──────────────
  useEffect(() => {
    if (!open || !isProfileManagerCampaign || !selectedIdentityProfileId) {
      setProfileManagers([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setProfileManagersLoading(true);
      try {
        const res = await accessCertificationService.api.getProfileManagers(selectedIdentityProfileId);
        if (!cancelled) setProfileManagers(res.data || []);
      } catch {
        if (!cancelled) setProfileManagers([]);
      } finally {
        if (!cancelled) setProfileManagersLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, isProfileManagerCampaign, selectedIdentityProfileId]);
  // ────────────────────────────────────────────────────────────────────────────

  function isValidEmail(email) {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
  }

  /* -------------------- Validation -------------------- */
  const canContinue = useMemo(() => {
    if (step === 1) {
      return certificationLevel === 'APPLICATION' || certificationLevel === 'PROFILE';
    }

    if (step === 2) {
      if (certificationLevel === 'PROFILE') {
        if (!selectedIdentityProfileId) return false;
        if (category === 'ACCESS_ITEMS') return !!selectedAppId;
        return true;
      }
      if (category === 'SOD') return !!category;
      return !!category && !!selectedAppId;
    }

    if (step === 3) {
      if (category === 'SOD') return false;

      // PROFILE + IDENTITY: only population selection in step 3; reviewer routing is in step 4
      if (isProfileIdentityCampaign) {
        // In SPECIFIC mode, must select at least one identity
        if (identityMode === 'SPECIFIC' && selectedIds.length === 0) return false;
        return true;
      }

      // PROFILE + MANAGER: must select at least one manager
      if (isProfileManagerCampaign) {
        return selectedManagerIds.length > 0;
      }

      // APPLICATION scope: selection table
      return selectedIds.length > 0;
    }

    if (step === 4) {
      if (category === 'SOD') return false;
      const dueDateValid =
        !!campaignDueDate &&
        dayjs(campaignDueDate).startOf('day').valueOf() >=
        dayjs().startOf('day').valueOf();
      const isBasicInfoValid =
        !!campaignName && !!campaignDescription && dueDateValid;
      if (!isBasicInfoValid) return false;

      if (certificationLevel === 'PROFILE' && !selectedIdentityProfileId) return false;

      // PROFILE + IDENTITY: reviewer routing is configured in step 4
      if (isProfileIdentityCampaign) {
        if (reviewerMode === 'INTERNAL' && !selectedManagerId) return false;
        if (reviewerMode === 'EXTERNAL' && reviewers.length === 0) return false;
        if (reviewerMode === 'DEFAULT') {
          // Backup reviewer is optional — only validate format if the user has entered something
          if (backupReviewerMode === 'EXTERNAL' && backupManagerReviewerEmail && !isValidEmail(backupManagerReviewerEmail)) return false;
        }
      }

      // For APPLICATION scope: reviewer assignment in step 4
      if (needsReviewerAssignment) {
        if (reviewerMode === 'INTERNAL' && !selectedManagerId) return false;
        if (reviewerMode === 'EXTERNAL' && reviewers.length === 0) return false;
        // For all DEFAULT routing: backup is optional but must be valid email if EXTERNAL entered
        if (reviewerMode === 'DEFAULT' && backupReviewerMode === 'EXTERNAL' && backupManagerReviewerEmail && !isValidEmail(backupManagerReviewerEmail)) return false;
      }

      return true;
    }

    // Final action is server-protected (POST /campaigns)
    if (step === 5) return canCreateCampaign;

    return true;
  }, [
    step,
    category,
    selectedAppId,
    selectedIds,
    identityMode,
    campaignName,
    campaignDescription,
    campaignDueDate,
    reviewerMode,
    selectedManagerId,
    reviewers,
    needsReviewerAssignment,
    certificationLevel,
    canCreateCampaign,
    profileCategoryEnabled,
    profileNeedsApplication,
    selectedIdentityProfileId,
    backupManagerReviewerEmail,
    backupReviewerMode,
    backupManagerId,
    isProfileIdentityCampaign,
    isProfileManagerCampaign,
    selectedManagerIds,
  ]);
  /* -------------------- Step Navigation -------------------- */
  const handleBack = () => {
    setError(null);
    if (step === 1) return;
    if (step === 2) return setStep(1);
    if (step === 5) return setStep(4);
    if (step === 4) return setStep(3);
    if (step === 3) {
      setSelectedIds([]);
      setSelectedAccessObjects([]);
      setSelectedIdentityObjects([]);
      // Reset PROFILE+MANAGER selections when going back
      if (isProfileManagerCampaign) {
        setSelectedManagerIds([]);
        setSelectedManagerObjects([]);
      }
      setStep(2);
      return;
    }
  };

  const addExternalReviewer = () => {
    const email = (externalReviewerEmail || "").trim();
    const name = (externalReviewerName || "").trim();
    if (!isValidEmail(email)) {
      setError("Enter a valid reviewer email.");
      return;
    }
    setError(null);
    setReviewers(prev => [...prev, { reviewerType: "EXTERNAL", name: name || email, email }]);
    setExternalReviewerEmail("");
    setExternalReviewerName("");
  };

  const removeReviewerAt = (idx) => {
    setReviewers(prev => prev.filter((_, i) => i !== idx));
  };

  /* -------------------- DYNAMIC MEMOIZED VALUES (INSIDE COMPONENT) -------------------- */
  const selectedApplicationName = useMemo(() => {
    if (!selectedAppId || !applications || applications.length === 0) return null;
    const app = applications.find(a => a.appId === selectedAppId || a._id === selectedAppId);
    return app ? app.applicationName : null;
  }, [selectedAppId, applications]);

  const selectedIdentityProfile = useMemo(() => {
    if (!selectedIdentityProfileId) return null;
    return (
      identityProfiles.find(
        (p) => (p._id || p.id) === selectedIdentityProfileId,
      ) || null
    );
  }, [identityProfiles, selectedIdentityProfileId]);

  const dialogMainTitle = useMemo(() => {
    if (step === 1) return 'New certification campaign';
    const catLabel = getCategoryLabel(category, accessFilter);
    return `Create New ${catLabel} Certification Campaign`;
  }, [category, accessFilter, step]);

  const dialogSubtitle = useMemo(() => {
    if (step === 1) {
      return 'Step 1 — Choose certification level: Application (per app) or Profile (named profiles)';
    }
    if (step === 2 && certificationLevel === 'APPLICATION') return 'Step 2 — Pick the application and what to certify';
    if (step === 2 && certificationLevel === 'PROFILE') return 'Step 2 — Pick a category and select an identity profile';

    const categoryTail = () => {
      if (!category) {
        return certificationLevel === 'PROFILE'
          ? 'select an identity profile'
          : 'choose how to scope this campaign';
      }
      if (category === 'ACCESS_ITEMS') {
        return accessFilter === 'PRIVILEGED' ? 'privileges (high-risk access)' : 'access items';
      }
      if (category === 'IDENTITY') return 'identities';
      if (category === 'UNCORRELATED_ACCOUNTS') {
        return 'uncorrelated accounts (source-selected; Source Owner)';
      }
      if (category === 'ROLE_COMPOSITION') {
        return 'role composition (role-based; Role Owner)';
      }
      if (category === 'SOD') return 'SoD (preview)';
      if (category === 'MANAGER') return 'managers';
      if (category === 'LIFECYCLE_STATUS') return 'lifecycle status';
      if (category === 'ROLE_MEMBERSHIP') return 'role membership';
      return getCategoryLabel(category, accessFilter).toLowerCase();
    };

    const tail = categoryTail();
    if (certificationLevel === 'PROFILE') {
      return `Profile level · ${tail}`;
    }
    return `Application level · ${tail}`;
  }, [category, certificationLevel, accessFilter, step]);

  const orderedAccessReviewRows = useMemo(() => {
    if (!selectedIds.length || !selectedAccessObjects.length) return [];
    const byId = new Map(selectedAccessObjects.map((o) => [o.id, o]));
    return selectedIds.map((id) => byId.get(id)).filter(Boolean);
  }, [selectedIds, selectedAccessObjects]);

  const orderedIdentityReviewRows = useMemo(() => {
    if (!selectedIds.length || !selectedIdentityObjects.length) return [];
    const byId = new Map(selectedIdentityObjects.map((o) => [o.id, o]));
    return selectedIds.map((id) => byId.get(id)).filter(Boolean);
  }, [selectedIds, selectedIdentityObjects]);

  /* -------------------- Create Campaign -------------------- */
  const handleNext = async () => {
    setError(null);
    if (step === 1) return setStep(2);
    if (step === 2) return setStep(3);
    if (step === 3) return setStep(4);
    if (step === 4) return setStep(5);

    if (step === 5) {
      if (category === 'SOD') return;
      setLoading(true);
      try {
        let reviewersPayload = [];
        const assignReviewersInWizard =
          needsReviewerAssignment || isProfileIdentityCampaign;
        if (assignReviewersInWizard) {
          if (reviewerMode === 'INTERNAL' && selectedManagerId) {
            const selectedManager = availableManagers.find(
              (m) => m.id === selectedManagerId,
            );
            const selectedManagerEmail =
              selectedManager?.emails && selectedManager.emails[0]
                ? String(selectedManager.emails[0]).trim()
                : '';
            const selectedManagerName =
              selectedManager?.name || selectedManagerEmail || 'Manager';
            const managerReviewer = {
              reviewerType: 'MANAGER',
              ...(selectedManagerEmail ? { email: selectedManagerEmail } : {}),
              ...(selectedManagerName ? { name: selectedManagerName } : {}),
            };
            if (/^[a-f\d]{24}$/i.test(String(selectedManagerId || ''))) {
              managerReviewer.reviewerId = selectedManagerId;
            }
            reviewersPayload.push(managerReviewer);
          } else if (reviewerMode === 'EXTERNAL') {
            reviewersPayload = reviewers.filter((r) => r.reviewerType === 'EXTERNAL');
          }
        }

        const applicationName =
          (certificationLevel === "APPLICATION" || profileNeedsApplication) &&
            selectedAppId
            ? applications.find((a) => a.appId === selectedAppId || a._id === selectedAppId)?.applicationName || null
            : null;

        const payload = {
          certificationScope: certificationLevel,
          applicationId:
            certificationLevel === "APPLICATION"
              ? selectedAppId
              : undefined,
          applicationName: applicationName || undefined,
          name: campaignName,
          description: campaignDescription,
          dueDate: campaignDueDate ? dayjs(campaignDueDate).toISOString() : undefined,
          category,
          accessFilter,
          identityMode:
            isProfileManagerCampaign
              ? "ALL"  // PROFILE+MANAGER always certifies ALL direct reports of selected managers
              : (category === "IDENTITY" || category === "UNCORRELATED_ACCOUNTS"
                ? identityMode
                : null),
          identityFilter:
            category === "IDENTITY" || category === "UNCORRELATED_ACCOUNTS"
              ? identityFilter
              : "ALL",
          // PROFILE+MANAGER has no manual selectedIds (scoped via scopeFilters.managerIds)
          // PROFILE+IDENTITY in SPECIFIC mode sends actual selected identity IDs
          selectedIds: isProfileManagerCampaign ? [] : selectedIds,
          createdBy: "system",
          scheduled: false,
          startDate: new Date().toISOString(),
          reminderFrequency,
          identityProfileId:
            certificationLevel === "PROFILE" && selectedIdentityProfileId
              ? selectedIdentityProfileId
              : undefined,
          // PROFILE + MANAGER: scopeFilters carries selected manager ids
          ...(isProfileManagerCampaign && selectedManagerIds.length > 0
            ? { scopeFilters: { managerIds: selectedManagerIds } }
            : {}),

          // Reviewer routing (APPLICATION scope step 4, PROFILE+IDENTITY step 4)
          ...(assignReviewersInWizard ? { reviewerRoutingMode: reviewerMode } : {}),
          ...(reviewersPayload.length > 0 ? { reviewersAssigned: reviewersPayload } : {}),

          // Backup reviewer (for DEFAULT routing — any scope)
          ...(reviewerMode === 'DEFAULT' ? (() => {
            let bkEmail = '';
            let bkName = '';
            if (backupReviewerMode === 'INTERNAL' && backupManagerId) {
              const bkMgr = availableManagers.find((m) => m.id === backupManagerId);
              bkEmail = (bkMgr?.emails?.[0] || '').trim();
              bkName = (bkMgr?.name || '').trim();
              if (!bkEmail && isProfileIdentityCampaign) {
                throw new Error(
                  'The selected backup reviewer has no known email address. Please choose a different reviewer or switch to External mode.'
                );
              }
            } else {
              bkEmail = backupManagerReviewerEmail.trim();
              bkName = backupManagerReviewerName.trim();
            }
            return bkEmail ? {
              backupManagerReviewerEmail: bkEmail,
              backupReviewerSource: backupReviewerMode,
              ...(bkName ? { backupManagerReviewerName: bkName } : {}),
            } : {};
          })() : {}),
        };

        const createRes = await accessCertificationService.controller.createCampaign(payload);

        // For PROFILE-scope campaigns, show readiness modal before confirming activation
        if (certificationLevel === 'PROFILE') {
          // controller.createCampaign returns the backend data object: { success, data: campaign }
          const newCampaignId =
            createRes?.data?._id ||   // { data: { _id } }
            createRes?._id ||          // direct campaign object
            createRes?.campaign?._id;  // legacy shape
          if (newCampaignId) {
            setPendingCampaignId(newCampaignId);
            // Fetch readiness in parallel while modal opens
            setReadinessLoading(true);
            setReadinessModalOpen(true);
            try {
              const readinessRes = await accessCertificationService.api.checkCampaignReadiness(newCampaignId);
              setReadinessData(readinessRes.success ? readinessRes.data : null);
            } catch {
              setReadinessData(null);
            } finally {
              setReadinessLoading(false);
            }
            // Don't close wizard yet — wait for user to confirm in modal
            if (typeof onCampaignCreated === 'function') onCampaignCreated();
            setLoading(false);
            return;
          }
        }

        if (typeof onCampaignCreated === 'function') onCampaignCreated();
        resetAndClose();
      } catch (err) {
        console.error('❌ Campaign creation failed:', err);
        setError(`Failed to create campaign: ${err.message || String(err)}`);
      } finally {
        setLoading(false);
      }
    }
  };

  const resetAndClose = () => {
    setStep(1);
    setCertificationLevel('APPLICATION');
    setSelectedTenantId(currentTenantId || '');
    setSelectedAppId('');
    setApplicationsGroupedByTenant([]);
    setApplications([]);
    setCategory('ACCESS_ITEMS');
    setAccessFilter('ALL');
    setIdentityMode('SPECIFIC');
    setIdentityFilter('ALL');
    setSelectedIds([]);
    setSelectedAccessObjects([]);
    setSelectedIdentityObjects([]);
    setCampaignName('');
    setCampaignNameTouched(false);
    setCampaignDescription('');
    setCampaignDueDate(null);
    setError(null);
    setLoading(false);
    setReviewerMode('DEFAULT');
    setAvailableManagers([]);
    setSelectedManagerId(null);
    setExternalReviewerEmail('');
    setExternalReviewerName('');
    setReviewers([]);
    setIdentityProfiles([]);
    setSelectedIdentityProfileId('');
    setBackupManagerReviewerEmail('');
    setBackupManagerReviewerName('');
    setBackupReviewerMode('EXTERNAL');
    setBackupManagerId(null);
    // PROFILE + MANAGER state
    setProfileManagers([]);
    setProfileManagersLoading(false);
    setSelectedManagerIds([]);
    setSelectedManagerObjects([]);
    // Readiness modal state
    setReadinessModalOpen(false);
    setReadinessData(null);
    setReadinessLoading(false);
    setActivatingCampaign(false);
    setPendingCampaignId(null);
    if (typeof onClose === 'function') onClose();
  };

  /* -------------------- RENDER -------------------- */
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Dialog
        open={open}
        onClose={resetAndClose}
        fullWidth
        maxWidth={false}
        scroll="paper"
        sx={{
          '& .MuiDialog-container': {
            margin: 0,
            padding: 0,
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
          },
        }}
        PaperProps={{
          elevation: 8,
          sx: {
            position: 'fixed',
            left: { xs: 10, sm: LAYOUT_SIDEBAR_W },
            top: LAYOUT_TOPBAR_H,
            right: GAP_RIGHT,
            bottom: GAP_BOTTOM,
            m: 0,
            maxWidth: { xs: 'calc(100% - 20px)', sm: `calc(100vw - ${LAYOUT_SIDEBAR_W}px - ${GAP_RIGHT}px)` },
            width: { xs: 'auto', sm: `calc(100vw - ${LAYOUT_SIDEBAR_W}px - ${GAP_RIGHT}px)` },
            height: `calc(100vh - ${LAYOUT_TOPBAR_H}px - ${GAP_BOTTOM}px)`,
            maxHeight: 'none',
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, pb: 1 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ lineHeight: 1.2, fontWeight: 600 }}>
              {dialogMainTitle}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {dialogSubtitle}
            </Typography>
          </Box>
          <Button onClick={resetAndClose} color="inherit" size="small">
            Cancel
          </Button>
        </DialogTitle>

        <Box
          sx={{
            px: 2,
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
            '& .MuiStepIcon-root': { width: 24, height: 14, fontSize: '0.75rem' },
            '& .MuiStepLabel-label': { fontSize: '0.7rem', mt: 0.25 },
            '& .MuiStepConnector-line': { minHeight: 1 },
          }}
        >
          <Stepper activeStep={toLinearStep(step)} alternativeLabel>
            {WIZARD_STEPS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>

        {/* App context strip — visible on steps 2–5 for APPLICATION-level campaigns only */}
        {step > 1 && selectedApp && certificationLevel !== 'PROFILE' && (
          <Box sx={{
            px: 3, py: 0.75,
            bgcolor: '#f8fafc',
            borderBottom: '1px solid #e9eef4',
            display: 'flex', alignItems: 'center', gap: 1,
          }}>
            <Apps sx={{ fontSize: 13, color: '#94a3b8' }} />
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>
              Application
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>·</Typography>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#1e40af' }}>
              {selectedApp.applicationName}
            </Typography>
            {selectedApp.appType && (
              <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                — {selectedApp.appType}
              </Typography>
            )}
          </Box>
        )}

        <DialogContent sx={{ flex: 1, overflow: 'auto', pt: 1, px: { xs: 2, sm: 3 } }}>
          {/* key=step forces Fade to remount on every step change → no blink */}
          <Fade key={step} in timeout={180}>
          <Box>
          {/* STEP 1: Certification Scope */}
          {step === 1 && (() => {
            const SCOPES = [
              {
                key: 'APPLICATION',
                icon: <Apps sx={{ fontSize: 22 }} />,
                title: 'Application',
                subtitle: 'App-scoped certification',
                description: 'Scoped to a single application. Review who has access, what entitlements they hold, or privileged accounts within that app.',
                color: '#1d4ed8',
                bg: '#eff6ff',
                border: '#bfdbfe',
                accentBg: '#dbeafe',
                categories: ['Identity', 'Access Items', 'Privileged Access'],
                disabled: false,
                comingSoon: false,
              },
              {
                key: 'PROFILE',
                icon: <ManageAccounts sx={{ fontSize: 22 }} />,
                title: 'Identity Profile',
                subtitle: 'Population-based certification',
                description: 'Certify a defined group of people — Finance team, Contractors, India Region — using org hierarchy and named profiles.',
                color: '#6d28d9',
                bg: '#f5f3ff',
                border: '#ddd6fe',
                accentBg: '#ede9fe',
                categories: ['Identity', 'Manager Review', 'Access Items', 'Lifecycle Status'],
                disabled: WIZARD_COMING_SOON.profileLevel,
                comingSoon: WIZARD_COMING_SOON.profileLevel,
              },
            ];

            return (
              <Box sx={{ pt: 1 }}>
                <Box sx={{ mb: 2.5 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#0f172a', mb: 0.25 }}>
                    Choose Certification Scope
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Each scope unlocks its own categories in the next step.
                  </Typography>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, maxWidth: 720 }}>
                  {SCOPES.map((scope) => {
                    const isSelected = certificationLevel === scope.key;
                    return (
                      <Box
                        key={scope.key}
                        onClick={scope.disabled ? undefined : () => setCertificationLevel(scope.key)}
                        sx={{
                          position: 'relative',
                          borderRadius: '12px',
                          border: '1.5px solid',
                          borderColor: isSelected ? scope.color : '#e2e8f0',
                          bgcolor: isSelected ? scope.bg : '#fff',
                          cursor: scope.disabled ? 'default' : 'pointer',
                          opacity: scope.disabled ? 0.45 : 1,
                          overflow: 'hidden',
                          transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
                          boxShadow: isSelected
                            ? `0 0 0 3px ${scope.color}18, 0 2px 8px rgba(0,0,0,0.06)`
                            : '0 1px 3px rgba(0,0,0,0.05)',
                          '&:hover': scope.disabled ? {} : {
                            borderColor: scope.color,
                            boxShadow: `0 0 0 2px ${scope.color}14, 0 2px 8px rgba(0,0,0,0.06)`,
                          },
                        }}
                      >
                        {/* Left accent bar */}
                        <Box sx={{
                          position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                          bgcolor: isSelected ? scope.color : '#e9eef4',
                          borderRadius: '12px 0 0 12px',
                          transition: 'background 0.15s',
                        }} />

                        <Box sx={{ p: 2.5, pl: 3 }}>
                          {/* Icon row + radio indicator */}
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                            <Box sx={{
                              width: 36, height: 36, borderRadius: '9px',
                              bgcolor: isSelected ? `${scope.color}18` : '#f1f5f9',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: isSelected ? scope.color : '#94a3b8',
                              transition: 'all 0.15s',
                            }}>
                              {React.cloneElement(scope.icon, { sx: { fontSize: 19 } })}
                            </Box>
                            {scope.comingSoon ? (
                              <Chip label="Coming soon" size="small" sx={{ height: 20, fontSize: '0.62rem', fontWeight: 600, bgcolor: '#f1f5f9', color: '#94a3b8', border: 'none' }} />
                            ) : (
                              <Box sx={{
                                width: 18, height: 18, borderRadius: '50%',
                                border: `2px solid ${isSelected ? scope.color : '#cbd5e1'}`,
                                bgcolor: isSelected ? scope.color : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.15s',
                              }}>
                                {isSelected && <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#fff' }} />}
                              </Box>
                            )}
                          </Box>

                          {/* Title */}
                          <Typography sx={{ fontWeight: 700, fontSize: '0.93rem', color: '#0f172a', lineHeight: 1.3, mb: 0.3 }}>
                            {scope.title}
                          </Typography>
                          <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: scope.color, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>
                            {scope.subtitle}
                          </Typography>
                          <Typography sx={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.55, mb: 1.75 }}>
                            {scope.description}
                          </Typography>

                          {/* Categories */}
                          <Box sx={{ borderTop: '1px solid', borderColor: isSelected ? `${scope.color}22` : '#f1f5f9', pt: 1.25 }}>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                              {scope.categories.map((cat) => (
                                <Box key={cat} sx={{
                                  px: 0.9, py: 0.3, borderRadius: '5px',
                                  border: '1px solid',
                                  borderColor: isSelected ? `${scope.color}2e` : '#e8edf2',
                                  bgcolor: isSelected ? `${scope.color}08` : '#f4f6f9',
                                  fontSize: '0.68rem', fontWeight: 500,
                                  color: isSelected ? scope.color : '#64748b',
                                  whiteSpace: 'nowrap',
                                }}>
                                  {cat}
                                </Box>
                              ))}
                            </Box>
                          </Box>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            );
          })()}

          {/* STEP 2: Application + category OR Profile manager — content depends on level chosen in step 1 */}
          {step === 2 && (
            <Stack spacing={3} sx={{ pt: 0.5 }}>
              {certificationLevel === 'APPLICATION' && (
                <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.06 }}>
                    Application · Target &amp; Category
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2, lineHeight: 1.5 }}>
                    Select the application this campaign is scoped to, then choose what reviewers should certify within it.
                  </Typography>
                  <Box sx={{ mb: 3, maxWidth: 520 }}>
                    <Typography sx={{ ...fieldLabel, mb: 0.5 }}>Application</Typography>
                    <FormControl fullWidth size="small" disabled={applications.length === 0}>
                      <InputLabel id="app-select-label">Select application</InputLabel>
                      <Select
                        labelId="app-select-label"
                        label="Select application"
                        value={selectedAppId}
                        onChange={(e) => {
                          const value = e.target.value;
                          // Prevent selecting disabled tenant header items
                          if (typeof value === 'string' && value.startsWith('__tenant_header__')) return;
                          setSelectedAppId(normalizeId(value));
                        }}
                        displayEmpty
                        renderValue={(value) => {
                          const found = applications.find((a) => a.appId === value || a._id === value);
                          if (!value || !found) {
                            return <em style={{ color: '#9e9e9e' }}>Select application</em>;
                          }
                          return `${found.applicationName} — ${found.appType}`;
                        }}
                      >
                        {applicationsGroupedByTenant.flatMap((group) => [
                          ...(isAdmin
                            ? [
                              <MenuItem
                                key={`__tenant_header__${group.tenantId || group.tenantName}`}
                                value={`__tenant_header__${group.tenantId || group.tenantName}`}
                                disabled
                                sx={{ fontWeight: 800, opacity: 0.9 }}
                              >
                                {group.tenantName}
                              </MenuItem>,
                            ]
                            : []),
                          ...(group.applications || []).map((app) => (
                            <MenuItem
                              key={app.appId}
                              value={app.appId}
                              onClick={() => setSelectedAppId(normalizeId(app.appId))}
                            >
                              {app.applicationName} — {app.appType}
                            </MenuItem>
                          )),
                        ])}
                      </Select>
                    </FormControl>
                    {error && <Typography color="error" variant="body2" sx={{ mt: 1 }}>{error}</Typography>}
                  </Box>

                  <Typography variant="body2" sx={{ mb: 1.5, fontWeight: 700, color: 'text.primary' }}>
                    What should reviewers certify within this application?
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
                      gap: 1.5,
                    }}
                  >
                    <OptionCard
                      compact
                      icon={<Person fontSize="small" />}
                      title="Identity"
                      description="Certify selected user identities for this application (same reviewer options as other categories)."
                      selected={category === 'IDENTITY'}
                      accent={categoryAccent}
                      onClick={() => { setCategory('IDENTITY'); setAccessFilter('ALL'); }}
                    />
                    <OptionCard
                      compact
                      icon={<Shield fontSize="small" />}
                      title="Access Items"
                      description="Review entitlements, roles, and profiles — reviewers see each user’s access under the selected items."
                      selected={category === 'ACCESS_ITEMS' && accessFilter === 'ALL'}
                      accent={categoryAccent}
                      onClick={() => { setCategory('ACCESS_ITEMS'); setAccessFilter('ALL'); }}
                    />
                    <OptionCard
                      compact
                      icon={<Shield fontSize="small" />}
                      title="Privileges"
                      description="High-risk access only — admin, superuser, delete, billing, and other sensitive entitlements."
                      selected={category === 'ACCESS_ITEMS' && accessFilter === 'PRIVILEGED'}
                      accent={categoryAccent}
                      onClick={() => { setCategory('ACCESS_ITEMS'); setAccessFilter('PRIVILEGED'); }}
                    />
                  </Box>
                </Paper>
              )}

              {certificationLevel === 'PROFILE' && (
                <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.06 }}>
                    Identity Profile · Certification Type
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.5 }}>
                    Choose how you want to certify this profile, then select the Identity Profile that defines the population.
                  </Typography>

                  {/* Only 2 clean categories for PROFILE scope — same full-width grid as APPLICATION */}
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
                      gap: 1.5,
                    }}
                  >
                    <OptionCard
                      compact
                      icon={<Person fontSize="small" />}
                      title="Identity Certification"
                      description="Certify all identities in the profile — their accounts, roles, and entitlements. Reviewer routed to each user's direct manager."
                      selected={category === 'IDENTITY'}
                      accent={categoryAccent}
                      onClick={() => { setCategory('IDENTITY'); setAccessFilter('ALL'); }}
                    />
                    <OptionCard
                      compact
                      icon={<ManageAccounts fontSize="small" />}
                      title="Manager Certification"
                      description="Select specific managers — their direct reports are scoped. Each manager is automatically assigned as reviewer for their own team."
                      selected={category === 'MANAGER'}
                      accent={categoryAccent}
                      onClick={() => {
                        setCategory('MANAGER');
                        setAccessFilter('ALL');
                        // Reset manager selections when switching category
                        setSelectedManagerIds([]);
                        setSelectedManagerObjects([]);
                      }}
                    />
                  </Box>

                  {/* Identity Profile selector */}
                  <Box sx={{ mt: 3, maxWidth: 520 }}>
                    <Typography sx={fieldLabel}>Identity Profile *</Typography>
                    <FormControl fullWidth size="small">
                      <InputLabel id="profile-step2-select-label">Identity Profile</InputLabel>
                      <Select
                        labelId="profile-step2-select-label"
                        label="Identity Profile"
                        value={selectedIdentityProfileId}
                        onChange={(e) => {
                          setSelectedIdentityProfileId(e.target.value);
                          // Reset manager selections when profile changes
                          setSelectedManagerIds([]);
                          setSelectedManagerObjects([]);
                          setProfileManagers([]);
                        }}
                      >
                        {identityProfiles.map((profile) => {
                          const profileId = profile._id || profile.id;
                          return (
                            <MenuItem key={profileId} value={profileId}>
                              {profile.name}
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>

                    {identityProfiles.length === 0 && (
                      <Alert severity="warning" sx={{ mt: 1.5 }}>
                        No identity profiles found for this tenant.
                      </Alert>
                    )}
                  </Box>
                </Paper>
              )}

            </Stack>
          )}

          {/* ── STEP 3: PROFILE + IDENTITY — Population + Reviewer Routing ───────── */}
          {step === 3 && isProfileIdentityCampaign && (
            <Box sx={{ pt: 1 }}>

              {/* ── Population toggle (Specific | All) — mirrors application-level UX ── */}
              <Box sx={{
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2,
                mb: 2, px: 2, py: 1.25,
                bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    Population
                  </Typography>
                  <Box sx={{ display: 'flex', bgcolor: '#fff', borderRadius: 1.5, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                    {[
                      { value: 'SPECIFIC', label: 'Specific' },
                      { value: 'ALL', label: profileIdentityTotal ? `All (${profileIdentityTotal.toLocaleString()})` : 'All' },
                    ].map((opt, i) => (
                      <Box
                        key={opt.value}
                        onClick={() => {
                          setIdentityMode(opt.value);
                          if (opt.value === 'ALL') { setSelectedIds([]); setSelectedIdentityObjects([]); }
                        }}
                        sx={{
                          px: 1.5, py: 0.5, cursor: 'pointer', userSelect: 'none',
                          fontSize: '0.8rem', whiteSpace: 'nowrap',
                          fontWeight: identityMode === opt.value ? 600 : 400,
                          color: identityMode === opt.value ? '#6d28d9' : '#64748b',
                          bgcolor: identityMode === opt.value ? '#f5f3ff' : 'transparent',
                          borderRight: i === 0 ? '1px solid #e2e8f0' : 'none',
                          transition: 'background 0.12s, color 0.12s',
                          '&:hover': { bgcolor: identityMode === opt.value ? '#f5f3ff' : '#f1f5f9' },
                        }}
                      >
                        {opt.label}
                      </Box>
                    ))}
                  </Box>
                </Box>

                <Divider orientation="vertical" flexItem sx={{ borderColor: '#e2e8f0' }} />

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    Identity Type
                  </Typography>
                  <Box sx={{ display: 'flex', bgcolor: '#fff', borderRadius: 1.5, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                    {[
                      { value: 'ALL', label: 'All Users' },
                      { value: 'NHI', label: 'NHI Only' },
                      { value: 'CONTRACTOR', label: 'Contractors' },
                    ].map((opt, i) => (
                      <Box
                        key={opt.value}
                        onClick={() => setIdentityFilter(opt.value)}
                        sx={{
                          px: 1.5, py: 0.5, cursor: 'pointer', userSelect: 'none',
                          fontSize: '0.8rem', whiteSpace: 'nowrap',
                          fontWeight: identityFilter === opt.value ? 600 : 400,
                          color: identityFilter === opt.value ? '#6d28d9' : '#64748b',
                          bgcolor: identityFilter === opt.value ? '#f5f3ff' : 'transparent',
                          borderRight: i < 2 ? '1px solid #e2e8f0' : 'none',
                          transition: 'background 0.12s, color 0.12s',
                          '&:hover': { bgcolor: identityFilter === opt.value ? '#f5f3ff' : '#f1f5f9' },
                        }}
                      >
                        {opt.label}
                      </Box>
                    ))}
                  </Box>
                </Box>

                {identityFilter !== 'ALL' && (
                  <Typography variant="caption" sx={{ ml: 'auto', color: '#64748b', fontStyle: 'italic' }}>
                    {identityFilter === 'NHI' ? 'Non-human identities only' : 'Contractors only'}
                  </Typography>
                )}
              </Box>

              {/* ALL mode: informational alert */}
              {identityMode === 'ALL' && (
                <Alert severity="info" icon={false} sx={{ mb: 2, py: 0.75, fontSize: '0.8rem', borderRadius: 1.5 }}>
                  Certifies <strong>all identities</strong> in the selected profile
                  {profileIdentityTotal ? ` (${profileIdentityTotal.toLocaleString()} total)` : ''}.
                  No manual selection needed.
                </Alert>
              )}

              {/* SPECIFIC mode: identity selection table scoped to profile */}
              {identityMode === 'SPECIFIC' && (
                <Box sx={{ mb: 2.5 }}>
                  <IdentitySelectionTable
                    selectedIds={selectedIds}
                    onChangeSelectedIds={setSelectedIds}
                    selectedObjects={selectedIdentityObjects}
                    onChangeSelectedObjects={setSelectedIdentityObjects}
                    identityProfileId={selectedIdentityProfileId}
                    identityMode={identityMode}
                    identityFilter={identityFilter}
                    pageSize={50}
                  />
                </Box>
              )}

            </Box>
          )}

          {/* ── STEP 3: PROFILE + MANAGER — Manager Selection Table ─────────────── */}
          {step === 3 && isProfileManagerCampaign && (
            <Box sx={{ pt: 1 }}>
              <Alert severity="info" icon={false} sx={{ mb: 2, borderRadius: 2 }}>
                <Typography variant="body2">
                  Select one or more managers. Their direct reports within the selected profile will be certified.
                  <strong> Each manager is automatically assigned as reviewer for their own team</strong> — no
                  additional reviewer selection is needed.
                </Typography>
              </Alert>
              <ProfileManagerSelectionTable
                managers={profileManagers}
                loading={profileManagersLoading}
                selectedIds={selectedManagerIds}
                onChangeSelectedIds={setSelectedManagerIds}
                selectedObjects={selectedManagerObjects}
                onChangeSelectedObjects={setSelectedManagerObjects}
              />
            </Box>
          )}

          {/* ── STEP 3: APPLICATION scope (original logic) ───────────────────────── */}
          {step === 3 && !isProfileIdentityCampaign && !isProfileManagerCampaign && (
            <Box sx={{ pt: 1 }}>
              {/* If identity category, show identity-mode options right above the table (so user immediately sees table area) */}
              {/* Identity selection table always rendered immediately for identities */}
              {(category === 'IDENTITY' || category === 'UNCORRELATED_ACCOUNTS') && (
                <>
                  {category === 'UNCORRELATED_ACCOUNTS' && (
                    <Alert severity="info" sx={{ mb: 2, maxWidth: 720 }}>
                      Uncorrelated accounts are scoped to the selected application source. Default reviewer routing uses Source Owner when available; you can assign reviewers on the Details step.
                    </Alert>
                  )}
                  {/* Compact filter bar — Population Mode + Identity Type */}
                  <Box sx={{
                    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2,
                    mb: 2, px: 2, py: 1.25,
                    bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0',
                  }}>
                    {isProfileIdentityCampaign && (
                      <>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                            Population
                          </Typography>
                          <Box sx={{ display: 'flex', bgcolor: '#fff', borderRadius: 1.5, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                            {[
                              { value: 'SPECIFIC', label: 'Specific' },
                              { value: 'ALL', label: profileIdentityTotal ? `All (${profileIdentityTotal})` : 'All' },
                            ].map((opt, i) => (
                              <Box
                                key={opt.value}
                                onClick={() => {
                                  setIdentityMode(opt.value);
                                  if (opt.value === 'ALL') { setSelectedIds([]); setSelectedIdentityObjects([]); }
                                }}
                                sx={{
                                  px: 1.5, py: 0.5, cursor: 'pointer', userSelect: 'none',
                                  fontSize: '0.8rem', whiteSpace: 'nowrap',
                                  fontWeight: identityMode === opt.value ? 600 : 400,
                                  color: identityMode === opt.value ? '#1d4ed8' : '#64748b',
                                  bgcolor: identityMode === opt.value ? '#eff6ff' : 'transparent',
                                  borderRight: i === 0 ? '1px solid #e2e8f0' : 'none',
                                  transition: 'background 0.12s, color 0.12s',
                                  '&:hover': { bgcolor: identityMode === opt.value ? '#eff6ff' : '#f1f5f9' },
                                }}
                              >
                                {opt.label}
                              </Box>
                            ))}
                          </Box>
                        </Box>
                        <Divider orientation="vertical" flexItem sx={{ borderColor: '#e2e8f0' }} />
                      </>
                    )}

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                        Identity Type
                      </Typography>
                      <Box sx={{ display: 'flex', bgcolor: '#fff', borderRadius: 1.5, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                        {[
                          { value: 'ALL', label: 'All Users' },
                          { value: 'NHI', label: 'NHI Only' },
                          { value: 'CONTRACTOR', label: 'Contractors' },
                        ].map((opt, i) => (
                          <Box
                            key={opt.value}
                            onClick={() => setIdentityFilter(opt.value)}
                            sx={{
                              px: 1.5, py: 0.5, cursor: 'pointer', userSelect: 'none',
                              fontSize: '0.8rem', whiteSpace: 'nowrap',
                              fontWeight: identityFilter === opt.value ? 600 : 400,
                              color: identityFilter === opt.value ? '#1d4ed8' : '#64748b',
                              bgcolor: identityFilter === opt.value ? '#eff6ff' : 'transparent',
                              borderRight: i < 2 ? '1px solid #e2e8f0' : 'none',
                              transition: 'background 0.12s, color 0.12s',
                              '&:hover': { bgcolor: identityFilter === opt.value ? '#eff6ff' : '#f1f5f9' },
                            }}
                          >
                            {opt.label}
                          </Box>
                        ))}
                      </Box>
                    </Box>

                    {identityFilter !== 'ALL' && (
                      <Typography variant="caption" sx={{ ml: 'auto', color: '#64748b', fontStyle: 'italic' }}>
                        {identityFilter === 'NHI' ? 'Non-human identities only' : 'Contractors only'}
                      </Typography>
                    )}
                  </Box>

                  {isProfileIdentityCampaign && identityMode === 'ALL' && (
                    <Alert severity="info" icon={false} sx={{ mb: 2, py: 0.75, fontSize: '0.8rem', borderRadius: 1.5 }}>
                      Certifies the entire Identity Profile population — no manual selection needed.
                    </Alert>
                  )}

                  {!(isProfileIdentityCampaign && identityMode === 'ALL') && (
                    <IdentitySelectionTable
                      selectedIds={selectedIds}
                      onChangeSelectedIds={setSelectedIds}
                      selectedObjects={selectedIdentityObjects}
                      onChangeSelectedObjects={setSelectedIdentityObjects}
                      applicationId={certificationLevel === 'PROFILE' ? undefined : selectedAppId}
                      identityProfileId={certificationLevel === 'PROFILE' ? selectedIdentityProfileId : undefined}
                      identityMode={identityMode} // pass mode down so table can switch between query vs pick mode
                      identityFilter={identityFilter}
                      pageSize={50}
                    />
                  )}
                </>
              )}

              {/* Access Items: show table immediately. The table component should show its internal loader/skeleton */}
              {category === 'ACCESS_ITEMS' && (
                <AccessItemSelectionTable
                  selectedIds={selectedIds}
                  onChangeSelectedIds={setSelectedIds}
                  selectedObjects={selectedAccessObjects}
                  onChangeSelectedObjects={setSelectedAccessObjects}
                  applicationId={selectedAppId}
                  filterPrivilegedOnly={accessFilter === 'PRIVILEGED'}
                />
              )}

              {category === 'ROLE_COMPOSITION' && (
                <AccessItemSelectionTable
                  selectedIds={selectedIds}
                  onChangeSelectedIds={setSelectedIds}
                  selectedObjects={selectedAccessObjects}
                  onChangeSelectedObjects={setSelectedAccessObjects}
                  applicationId={selectedAppId}
                  filterRolesOnly
                />
              )}

              {/* Manager: show table (org-wide for profile level, app-scoped for application level) */}
              {category === 'MANAGER' && (
                <ManagerSelectionTable
                  selectedIds={selectedIds}
                  onChangeSelectedIds={setSelectedIds}
                  applicationId={certificationLevel === 'PROFILE' ? undefined : selectedAppId}
                />
              )}

              {category === 'SOD' && (
                <SodViolationSelectionTable
                  selectedIds={selectedIds}
                  onChangeSelectedIds={setSelectedIds}
                  selectedObjects={selectedIdentityObjects}
                  onChangeSelectedObjects={setSelectedIdentityObjects}
                />
              )}
            </Box>
          )}

          {/* STEP 4: Campaign details + Reviewer selection (ONLY for ACCESS_ITEMS) */}
          {step === 4 && (
            <Box sx={{ pt: 1 }}>
              <Box sx={sectionBox}>
                <Typography sx={sectionTitle}>Campaign Details</Typography>
                <Box sx={{ mb: 3 }}>
                  <Typography sx={fieldLabel}>Campaign Name *</Typography>
                  <TextField
                    fullWidth
                    size="small"
                    value={campaignName}
                    onChange={(e) => {
                      setCampaignNameTouched(true);
                      setCampaignName(e.target.value);
                    }}
                    helperText="Must be unique. Duplicate certification names are not allowed."
                  />
                </Box>
                <Box sx={{ mb: 3 }}>
                  <Typography sx={fieldLabel}>Campaign Description *</Typography>
                  <TextField fullWidth size="small" multiline rows={3}
                    value={campaignDescription} onChange={(e) => setCampaignDescription(e.target.value)} />
                </Box>
                <Box sx={{ mb: 2, maxWidth: '40%' }}>
                  <Typography sx={fieldLabel}>Due Date *</Typography>
                  <DatePicker
                    value={campaignDueDate}
                    onChange={(newValue) => setCampaignDueDate(newValue)}
                    disablePast
                    minDate={dayjs().startOf('day')}
                    slotProps={{ textField: { size: 'small', fullWidth: true } }}
                  />
                </Box>
                {/* 🔔 Reminder Frequency */}
                <Box sx={{ mt: 5 }}>
                  <FormControl size="small" fullWidth sx={{ maxWidth: 360 }}>
                    <InputLabel id="campaign-reminder-label">
                      Reminder Setting
                    </InputLabel>

                    <Select
                      labelId="campaign-reminder-label"
                      label="Reminder Setting"
                      value={reminderFrequency}
                      onChange={(e) => setReminderFrequency(e.target.value)}
                    >
                      <MenuItem value="GLOBAL">
                        Global Reminder Setting
                      </MenuItem>

                      <MenuItem value="WEEKLY">
                        Weekly Reminder
                      </MenuItem>

                      <MenuItem value="MONTHLY">
                        Monthly Reminder
                      </MenuItem>

                      <MenuItem value="TWO_DAYS_BEFORE_END">
                        2 Days Before Campaign End
                      </MenuItem>
                    </Select>
                  </FormControl>

                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 1, display: "block" }}
                  >
                    If “Global Reminder Setting” is selected, the cadence from Global rule set
                    → Certification email reminders is applied to this campaign.
                  </Typography>
                </Box>

              </Box>

              {/* ── PROFILE + IDENTITY: Reviewer Routing (moved from Step 3) ── */}
              {isProfileIdentityCampaign && (
                <Box sx={{ mt: 2, ...sectionBox }}>
                  <Typography sx={sectionTitle}>Reviewer Routing</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    How should review items be assigned to reviewers?
                  </Typography>

                  <FormControl component="fieldset" sx={{ mb: 2 }}>
                    <RadioGroup
                      value={reviewerMode}
                      onChange={(e) => setReviewerMode(e.target.value)}
                    >
                      <FormControlLabel
                        value="DEFAULT"
                        control={<Radio />}
                        label={
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>Manager — auto-route to each identity's direct manager</Typography>
                            <Typography variant="caption" color="text.secondary">
                              Requires a backup reviewer for identities with no manager in the directory.
                            </Typography>
                          </Box>
                        }
                      />
                      <FormControlLabel
                        value="INTERNAL"
                        control={<Radio />}
                        label={
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>Internal — one platform user reviews all identities</Typography>
                            <Typography variant="caption" color="text.secondary">
                              Select an internal user (e.g. IGA Admin, Security Team member).
                            </Typography>
                          </Box>
                        }
                      />
                      <FormControlLabel
                        value="EXTERNAL"
                        control={<Radio />}
                        label={
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>External — manual name + email, JWT portal access</Typography>
                            <Typography variant="caption" color="text.secondary">
                              Auditor or external reviewer — no platform account needed.
                            </Typography>
                          </Box>
                        }
                      />
                    </RadioGroup>
                  </FormControl>

                  {/* DEFAULT: Backup Reviewer */}
                  {reviewerMode === 'DEFAULT' && (
                    <Box sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 2, bgcolor: '#fafbfc' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                        <Typography sx={{ ...fieldLabel, mb: 0 }}>
                          Backup Reviewer (optional)
                        </Typography>
                        <Box sx={{ display: 'flex', bgcolor: '#fff', borderRadius: 1.5, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                          {[{ value: 'INTERNAL', label: 'Internal' }, { value: 'EXTERNAL', label: 'External' }].map((opt, i) => (
                            <Box
                              key={opt.value}
                              onClick={() => {
                                setBackupReviewerMode(opt.value);
                                setBackupManagerId(null);
                                setBackupManagerReviewerEmail('');
                                setBackupManagerReviewerName('');
                              }}
                              sx={{
                                px: 1.5, py: 0.5, cursor: 'pointer', userSelect: 'none',
                                fontSize: '0.78rem', whiteSpace: 'nowrap',
                                fontWeight: backupReviewerMode === opt.value ? 600 : 400,
                                color: backupReviewerMode === opt.value ? '#1d4ed8' : '#64748b',
                                bgcolor: backupReviewerMode === opt.value ? '#eff6ff' : 'transparent',
                                borderRight: i === 0 ? '1px solid #e2e8f0' : 'none',
                              }}
                            >
                              {opt.label}
                            </Box>
                          ))}
                        </Box>
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                        Fallback when an identity has no manager in the directory.
                      </Typography>
                      {backupReviewerMode === 'INTERNAL' ? (
                        <FormControl fullWidth size="small">
                          <InputLabel>Select internal backup reviewer</InputLabel>
                          <Select
                            label="Select internal backup reviewer"
                            value={backupManagerId || ''}
                            onChange={(e) => setBackupManagerId(e.target.value || null)}
                          >
                            {availableManagers.map((m) => (
                              <MenuItem key={m.id} value={m.id}>
                                {m.name}{m.emails?.[0] ? ` — ${m.emails[0]}` : ''}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      ) : (
                        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                          <TextField
                            label="Backup reviewer email (optional)"
                            size="small"
                            value={backupManagerReviewerEmail}
                            onChange={(e) => setBackupManagerReviewerEmail(e.target.value)}
                            error={!!backupManagerReviewerEmail && !isValidEmail(backupManagerReviewerEmail)}
                            helperText={!!backupManagerReviewerEmail && !isValidEmail(backupManagerReviewerEmail) ? 'Invalid email' : ''}
                            sx={{ flex: '1 1 260px' }}
                          />
                          <TextField
                            label="Backup reviewer name (optional)"
                            size="small"
                            value={backupManagerReviewerName}
                            onChange={(e) => setBackupManagerReviewerName(e.target.value)}
                            sx={{ flex: '1 1 200px' }}
                          />
                        </Box>
                      )}
                    </Box>
                  )}

                  {/* INTERNAL: user picker */}
                  {reviewerMode === 'INTERNAL' && (
                    <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                      <InputLabel>Select internal reviewer</InputLabel>
                      <Select
                        label="Select internal reviewer"
                        value={selectedManagerId || ''}
                        onChange={(e) => setSelectedManagerId(e.target.value || null)}
                      >
                        {availableManagers.map((m) => (
                          <MenuItem key={m.id} value={m.id}>
                            {m.name}{m.emails?.[0] ? ` — ${m.emails[0]}` : ''}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}

                  {/* EXTERNAL: email/name inputs + reviewer chips */}
                  {reviewerMode === 'EXTERNAL' && (
                    <Box sx={{ mt: 1 }}>
                      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
                        <TextField
                          label="Reviewer email *"
                          size="small"
                          value={externalReviewerEmail}
                          onChange={(e) => setExternalReviewerEmail(e.target.value)}
                          sx={{ flex: '1 1 220px' }}
                        />
                        <TextField
                          label="Reviewer name (optional)"
                          size="small"
                          value={externalReviewerName}
                          onChange={(e) => setExternalReviewerName(e.target.value)}
                          sx={{ flex: '1 1 180px' }}
                        />
                        <Button variant="outlined" size="small" onClick={addExternalReviewer} startIcon={<Add />}>
                          Add
                        </Button>
                      </Box>
                      {reviewers.filter(r => r.reviewerType === 'EXTERNAL').map((r, i) => (
                        <Chip
                          key={i}
                          label={r.name ? `${r.name} (${r.email})` : r.email}
                          onDelete={() => removeReviewerAt(reviewers.indexOf(r))}
                          size="small"
                          sx={{ mr: 0.5, mb: 0.5 }}
                        />
                      ))}
                    </Box>
                  )}
                </Box>
              )}

              {/* Reviewer assignment: Identity & Access Items */}
              {needsReviewerAssignment && (
                <Box sx={{ mt: 2, ...sectionBox }}>
                  <Typography sx={sectionTitle}>Reviewers</Typography>
                  <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
                    {category === 'IDENTITY' &&
                      'Who certifies these identities? Default: each user’s manager. Internal: one internal reviewer for all. External: auditor email.'}
                    {category === 'UNCORRELATED_ACCOUNTS' &&
                      'Who should certify these uncorrelated accounts? Prefer Source Owner for the selected source; default may use manager from identity data until source owners are configured.'}
                    {(category === 'ACCESS_ITEMS' || category === 'ROLE_COMPOSITION') &&
                      (category === 'ROLE_COMPOSITION'
                        ? 'Who should certify role membership? Default routes to Role Owner when available; otherwise uses the manager field on each identity.'
                        : 'Who certifies access for the users who hold the selected items? Default: each user’s manager. Internal: one reviewer for all rows. External: auditor email.')}
                  </Typography>

                  <FormControl component="fieldset" sx={{ mb: 2 }}>
                    <RadioGroup
                      row
                      value={reviewerMode}
                      onChange={(e) => setReviewerMode(e.target.value)}
                    >
                      <FormControlLabel value="DEFAULT" control={<Radio />} label="Default (By User Manager)" />
                      <FormControlLabel value="INTERNAL" control={<Radio />} label="Internal Reviewer" />
                      <FormControlLabel value="EXTERNAL" control={<Radio />} label="External Reviewer" />
                    </RadioGroup>
                  </FormControl>

                  {/* Backup reviewer — shown for any DEFAULT routing; always optional */}
                  {reviewerMode === 'DEFAULT' && (
                    <Box sx={{ mb: 2, p: 2, border: '1px solid #e2e8f0', borderRadius: 2, bgcolor: '#fafbfc' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                        <Typography sx={{ ...fieldLabel, mb: 0 }}>
                          Backup Reviewer (optional)
                        </Typography>
                        {/* Internal / External toggle */}
                        <Box sx={{ display: 'flex', bgcolor: '#fff', borderRadius: 1.5, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                          {[
                            { value: 'INTERNAL', label: 'Internal' },
                            { value: 'EXTERNAL', label: 'External' },
                          ].map((opt, i) => (
                            <Box
                              key={opt.value}
                              onClick={() => {
                                setBackupReviewerMode(opt.value);
                                setBackupManagerId(null);
                                setBackupManagerReviewerEmail('');
                                setBackupManagerReviewerName('');
                              }}
                              sx={{
                                px: 1.5, py: 0.5, cursor: 'pointer', userSelect: 'none',
                                fontSize: '0.78rem', whiteSpace: 'nowrap',
                                fontWeight: backupReviewerMode === opt.value ? 600 : 400,
                                color: backupReviewerMode === opt.value ? '#1d4ed8' : '#64748b',
                                bgcolor: backupReviewerMode === opt.value ? '#eff6ff' : 'transparent',
                                borderRight: i === 0 ? '1px solid #e2e8f0' : 'none',
                                transition: 'background 0.12s, color 0.12s',
                                '&:hover': { bgcolor: backupReviewerMode === opt.value ? '#eff6ff' : '#f1f5f9' },
                              }}
                            >
                              {opt.label}
                            </Box>
                          ))}
                        </Box>
                      </Box>

                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                        Fallback when a user has no manager in the directory.
                        {backupReviewerMode === 'INTERNAL' ? ' Select from managers extracted from this application.' : ' Enter the reviewer\'s email address.'}
                      </Typography>

                      {backupReviewerMode === 'INTERNAL' ? (
                        <FormControl fullWidth size="small">
                          <InputLabel id="backup-manager-select-label">Select internal reviewer</InputLabel>
                          <Select
                            labelId="backup-manager-select-label"
                            label="Select internal reviewer"
                            value={backupManagerId || ''}
                            onChange={(e) => setBackupManagerId(e.target.value)}
                            displayEmpty
                          >
                            {(() => {
                              const managersWithEmail = availableManagers.filter(m => m.emails?.length > 0);
                              if (availableManagers.length === 0) {
                                return (
                                  <MenuItem disabled value="">
                                    <em>No managers found — select an application first</em>
                                  </MenuItem>
                                );
                              }
                              if (managersWithEmail.length === 0) {
                                return (
                                  <MenuItem disabled value="">
                                    <em>No managers with known email — use External mode instead</em>
                                  </MenuItem>
                                );
                              }
                              return managersWithEmail.map((m) => (
                                <MenuItem key={m.id} value={m.id}>
                                  {m.name} — {m.emails[0]}
                                </MenuItem>
                              ));
                            })()}
                          </Select>
                        </FormControl>
                      ) : (
                        <>
                          <TextField
                            fullWidth
                            size="small"
                            placeholder="backup.reviewer@company.com"
                            value={backupManagerReviewerEmail}
                            onChange={(e) => setBackupManagerReviewerEmail(e.target.value)}
                            error={!!backupManagerReviewerEmail && !isValidEmail(backupManagerReviewerEmail)}
                            helperText={!!backupManagerReviewerEmail && !isValidEmail(backupManagerReviewerEmail) ? 'Enter a valid email address' : ''}
                            sx={{ mb: 1 }}
                          />
                          <TextField
                            fullWidth
                            size="small"
                            placeholder="Backup Reviewer Name (optional)"
                            value={backupManagerReviewerName}
                            onChange={(e) => setBackupManagerReviewerName(e.target.value)}
                          />
                        </>
                      )}
                    </Box>
                  )}

                  {/* Internal: select from extracted managers */}
                  {reviewerMode === 'INTERNAL' && (
                    <Box sx={{ mb: 2 }}>
                      <Typography sx={fieldLabel}>Choose manager</Typography>
                      <FormControl fullWidth size="small">
                        <InputLabel id="manager-select-label">Manager</InputLabel>
                        <Select
                          labelId="manager-select-label"
                          label="Manager"
                          value={selectedManagerId || ''}
                          onChange={(e) => setSelectedManagerId(e.target.value)}
                        >
                          {availableManagers.map(m => (
                            <MenuItem key={m.id} value={m.id}>
                              {m.name} — {m.emails && m.emails[0] ? m.emails[0] : '—'}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                        Selected manager will be assigned as reviewer for all items in this campaign.
                      </Typography>
                    </Box>
                  )}

                  {/* External: add email(s) */}
                  {reviewerMode === 'EXTERNAL' && (
                    <Box sx={{ mb: 2 }}>
                      <Typography sx={fieldLabel}>Add External Reviewer</Typography>
                      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                        <TextField
                          size="small"
                          placeholder="Reviewer name (optional)"
                          value={externalReviewerName}
                          onChange={(e) => setExternalReviewerName(e.target.value)}
                          sx={{ flex: 2 }}
                        />
                        <TextField
                          size="small"
                          placeholder="Reviewer email"
                          value={externalReviewerEmail}
                          onChange={(e) => setExternalReviewerEmail(e.target.value)}
                          sx={{ flex: 3 }}
                        />
                        <Button variant="outlined" onClick={addExternalReviewer} startIcon={<Add />}>
                          Add
                        </Button>
                      </Box>

                      {reviewers.length > 0 ? (
                        <List dense>
                          {reviewers.map((r, idx) => (
                            <ListItem
                              key={idx}
                              secondaryAction={
                                <IconButton edge="end" onClick={() => removeReviewerAt(idx)} size="small">
                                  <Delete fontSize="small" />
                                </IconButton>
                              }
                            >
                              <ListItemText primary={r.name} secondary={r.email} />
                            </ListItem>
                          ))}
                        </List>
                      ) : (
                        <Typography variant="caption" color="text.secondary">No external reviewers added yet.</Typography>
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          )}

          {/* STEP 5 */}
          {step === 5 && (
            <Box sx={{ pt: 1 }}>
              <Box sx={sectionBox}>
                <Typography sx={sectionTitle}>Campaign Summary</Typography>

                {/* Scope + Application + Category */}
                <Typography sx={summaryLabel}>Certification Scope:</Typography>
                <Typography sx={summaryValue}>
                  {certificationLevel === 'PROFILE' ? 'Identity Profile Level' : 'Application Level'}
                </Typography>
                {certificationLevel !== 'PROFILE' && (
                  <>
                    <Typography sx={summaryLabel}>Target Application:</Typography>
                    <Typography sx={summaryValue}>
                      {selectedApplicationName || '—'}
                    </Typography>
                  </>
                )}
                <Typography sx={summaryLabel}>Category:</Typography>
                <Typography sx={summaryValue}>
                  {getCategoryLabel(category, accessFilter)}
                </Typography>

                {certificationLevel === 'PROFILE' && (
                  <>
                    <Typography sx={summaryLabel}>Identity Profile:</Typography>
                    <Typography sx={summaryValue}>
                      {selectedIdentityProfile?.name || 'Not Selected'}
                    </Typography>
                  </>
                )}

                <Typography sx={summaryLabel}>Name:</Typography>
                <Typography sx={summaryValue}>{campaignName}</Typography>

                <Typography sx={summaryLabel}>Description:</Typography>
                <Typography sx={summaryValue}>{campaignDescription}</Typography>

                <Typography sx={summaryLabel}>Due Date:</Typography>
                <Typography sx={summaryValue}>
                  {campaignDueDate ? campaignDueDate.format('MM/DD/YYYY') : 'Not Set'}
                </Typography>
                <Typography sx={summaryLabel}>Reminder Setting:</Typography>
                <Typography sx={summaryValue}>
                  {reminderFrequency === "GLOBAL"
                    ? "Use Global Reminder Setting"
                    : reminderFrequency === "WEEKLY"
                      ? "Weekly"
                      : reminderFrequency === "MONTHLY"
                        ? "Monthly"
                        : "2 Days Before Campaign End"}
                </Typography>

                {/* APPLICATION scope reviewer summary */}
                {needsReviewerAssignment && (
                  <>
                    <Typography sx={summaryLabel}>Reviewer Mode:</Typography>
                    <Typography sx={summaryValue}>
                      {reviewerMode === 'DEFAULT'
                        ? 'Default (By User Manager)'
                        : reviewerMode === 'INTERNAL'
                          ? 'Internal Reviewer'
                          : 'External Reviewer'}
                    </Typography>

                    {reviewerMode === 'INTERNAL' && selectedManagerId && (
                      <Typography sx={summaryValue}>
                        {availableManagers.find(m => m.id === selectedManagerId)?.name || selectedManagerId}
                      </Typography>
                    )}

                    {reviewerMode === 'EXTERNAL' && reviewers.length > 0 && (
                      <Box>
                        {reviewers.map((r, i) => (
                          <Typography key={i} sx={summaryValue}>
                            {r.name} — {r.email}
                          </Typography>
                        ))}
                      </Box>
                    )}
                  </>
                )}

                {/* PROFILE + IDENTITY reviewer summary */}
                {isProfileIdentityCampaign && (
                  <>
                    <Typography sx={summaryLabel}>Reviewer Routing:</Typography>
                    <Typography sx={summaryValue}>
                      {reviewerMode === 'DEFAULT'
                        ? 'Manager — auto-routed to each identity\'s direct manager'
                        : reviewerMode === 'INTERNAL'
                          ? 'Internal Reviewer'
                          : 'External Reviewer'}
                    </Typography>
                    {reviewerMode === 'DEFAULT' && backupManagerReviewerEmail && (
                      <>
                        <Typography sx={summaryLabel}>Backup Reviewer:</Typography>
                        <Typography sx={summaryValue}>{backupManagerReviewerEmail}</Typography>
                      </>
                    )}
                  </>
                )}

                {/* PROFILE + MANAGER: selected managers summary */}
                {isProfileManagerCampaign && selectedManagerObjects.length > 0 && (
                  <>
                    <Typography sx={summaryLabel}>Selected Managers ({selectedManagerObjects.length}):</Typography>
                    <Box sx={{ mt: 0.5 }}>
                      {selectedManagerObjects.slice(0, REVIEW_SCOPE_PREVIEW_LIMIT).map((m) => (
                        <Box key={m.managerId} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography sx={summaryValue} component="span">
                            {m.managerName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {m.department ? `· ${m.department}` : ''} · {m.directReportsCount} direct reports
                          </Typography>
                        </Box>
                      ))}
                      {selectedManagerObjects.length > REVIEW_SCOPE_PREVIEW_LIMIT && (
                        <Typography variant="caption" color="text.secondary">
                          +{selectedManagerObjects.length - REVIEW_SCOPE_PREVIEW_LIMIT} more
                        </Typography>
                      )}
                    </Box>
                  </>
                )}
              </Box>

              <Box sx={sectionBox}>
                <Typography sx={sectionTitle}>Scope</Typography>
                <Typography sx={summaryLabel}>
                  {isProfileManagerCampaign ? 'Scope:' : `Selected ${getScopeSelectionEntityLabel(category, accessFilter)}:`}
                </Typography>
                <Typography sx={summaryValue}>
                  {isProfileIdentityCampaign
                    ? (identityMode === 'SPECIFIC'
                        ? `${selectedIds.length} selected identit${selectedIds.length !== 1 ? 'ies' : 'y'}`
                        : (profileIdentityTotal ? `All ${profileIdentityTotal.toLocaleString()} identities in profile` : 'All identities in profile'))
                    : isProfileManagerCampaign
                    ? `Direct reports of ${selectedManagerObjects.length} manager${selectedManagerObjects.length !== 1 ? 's' : ''}`
                    : selectedIds.length}
                </Typography>

                {(category === 'ACCESS_ITEMS' || category === 'ROLE_COMPOSITION') &&
                  orderedAccessReviewRows.length > 0 && (
                    <Box sx={{ mt: 1.5, maxWidth: 720 }}>
                      <List dense disablePadding>
                        {orderedAccessReviewRows.slice(0, REVIEW_SCOPE_PREVIEW_LIMIT).map((row) => (
                          <ListItem key={row.id} disableGutters sx={{ py: 0.25 }}>
                            <ListItemText
                              primary={row.name || String(row.id)}
                              secondary={[row.type, row.source].filter(Boolean).join(' · ') || undefined}
                              primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                              secondaryTypographyProps={{ variant: 'caption' }}
                            />
                          </ListItem>
                        ))}
                      </List>
                      {orderedAccessReviewRows.length > REVIEW_SCOPE_PREVIEW_LIMIT && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          +{orderedAccessReviewRows.length - REVIEW_SCOPE_PREVIEW_LIMIT} more
                        </Typography>
                      )}
                    </Box>
                  )}

                {(category === 'IDENTITY' || category === 'UNCORRELATED_ACCOUNTS') &&
                  orderedIdentityReviewRows.length > 0 && (
                    <Box sx={{ mt: 1.5, maxWidth: 720 }}>
                      <List dense disablePadding>
                        {orderedIdentityReviewRows.slice(0, REVIEW_SCOPE_PREVIEW_LIMIT).map((row) => (
                          <ListItem key={row.id} disableGutters sx={{ py: 0.25 }}>
                            <ListItemText
                              primary={row.name || String(row.id)}
                              secondary={[row.email, row.title].filter(Boolean).join(' · ') || undefined}
                              primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                              secondaryTypographyProps={{ variant: 'caption' }}
                            />
                          </ListItem>
                        ))}
                      </List>
                      {orderedIdentityReviewRows.length > REVIEW_SCOPE_PREVIEW_LIMIT && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          +{orderedIdentityReviewRows.length - REVIEW_SCOPE_PREVIEW_LIMIT} more
                        </Typography>
                      )}
                    </Box>
                  )}
              </Box>

              {loading && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
                  <CircularProgress size={20} />
                  <Typography>Creating campaign...</Typography>
                </Box>
              )}

              {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {error}
                </Alert>
              )}
            </Box>
          )}
          </Box>
          </Fade>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
          <Box>
            {step > 1 && !loading && <Button onClick={handleBack}>Back</Button>}
          </Box>
          <Box>
            <Button variant="contained" disabled={!canContinue || loading} onClick={handleNext}>
              {loading ? <CircularProgress size={24} color="inherit" /> :
                step === 4 ? 'Review campaign' :
                  step === 5 ? 'Start campaign' : 'Continue'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      {/* ── Pre-activation readiness modal for PROFILE campaigns ─────────────── */}
      <CampaignReadinessModal
        open={readinessModalOpen}
        onClose={() => {
          // Closing without activating — campaign was created in Staged state, user can activate later
          setReadinessModalOpen(false);
          resetAndClose();
        }}
        onActivate={async () => {
          if (!pendingCampaignId) return;
          setActivatingCampaign(true);
          try {
            await accessCertificationService.controller.activateCampaign(pendingCampaignId);
          } catch (err) {
            console.error('❌ Campaign activation failed:', err);
          } finally {
            setActivatingCampaign(false);
            setReadinessModalOpen(false);
            resetAndClose();
          }
        }}
        activating={activatingCampaign}
        readiness={readinessData}
        readinessLoading={readinessLoading}
        showManagerCoverage={isProfileIdentityCampaign && reviewerMode === 'DEFAULT'}
      />
    </LocalizationProvider>
  );
};

export default AccessCertificationWizard;

