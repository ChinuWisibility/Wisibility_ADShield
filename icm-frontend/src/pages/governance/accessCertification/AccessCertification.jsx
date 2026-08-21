import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box, Typography, Button, Card, CardContent, TextField, InputAdornment, Pagination, CircularProgress, Alert, Snackbar, IconButton, Menu, MenuItem, Avatar, Chip, Fade, Divider, Stack, Dialog, DialogTitle, DialogContent, DialogActions, useTheme, alpha, Skeleton, CardHeader, CardActions, Tooltip, Container, Paper,
} from "@mui/material";

import {
  Add, Search, Refresh, Edit as EditIcon, FileCopy as DuplicateIcon, Delete as DeleteIcon, CheckCircle as CheckIcon, Warning as WarningIcon, TrendingUp, BarChart as ChartIcon, HourglassEmpty as PendingIcon, Info as InfoIcon, MoreVert as MoreVertIcon, AccessTime, ReportProblem, Inbox as InboxIcon, ArrowBack, Email as EmailIcon
} from "@mui/icons-material";

const AccessCertificationWizard = lazy(() => import("./AccessCertificationWizard"));
import AccessCertificationReview from "./AccessCertificationReview";
const AnalyticsDashboard = lazy(() => import("./AccessCertificationDashboard"));
const AccessCertificationCampaignTable = lazy(() => import("./AccessCertificationCampaignTable"));
import accessCertificationService from "../../../services/accessCertificationService";
const NotificationDashboard = lazy(() => import("./NotificationDashboard"));
import CampaignReminderButton from './CampaignReminderButton';
import { AC_PALETTE, STATUS_BADGE_COLORS } from "./AcessStyles";
import CatalogCurvedTabs from "../../identities/catalog/CatalogCurvedTabs";
import { CATALOG } from "../../identities/catalog/catalogTheme";

const CERTIFICATION_TABS = [
  { id: "all", label: "All Campaigns", icon: <InboxIcon fontSize="small" /> },
  { id: "staged", label: "Staged", icon: <PendingIcon fontSize="small" /> },
  { id: "active", label: "Active", icon: <TrendingUp fontSize="small" /> },
  { id: "completed", label: "Completed", icon: <CheckIcon fontSize="small" /> },
  { id: "expired", label: "Expired", icon: <AccessTime fontSize="small" /> },
  { id: "owner-actions", label: "Owner Actions", icon: <ReportProblem fontSize="small" /> },
  { id: "analytics", label: "Analytics", icon: <ChartIcon fontSize="small" /> },
  { id: "notifications", label: "Notifications", icon: <EmailIcon fontSize="small" /> },
];

const LazySectionFallback = () => (
  <Box sx={{ p: 2 }}>
    <Skeleton variant="rounded" height={120} />
  </Box>
);

// --- UTILS ---
const formatDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const checkIsExpired = (dueDate, status) => {
  if (!dueDate) return false;
  const s = (status || "").toLowerCase();
  if (s.includes("completed") || s.includes("closed") || s === "endphase") return false;
  return new Date(dueDate) < new Date();
};

/** Expired or EndPhase — owner can Renew / Close (not already closed). */
const canOwnerRenewOrClose = (row) => {
  const s = (row?.statusLabel || row?.status || "").toLowerCase();
  if (s.includes("closed") || s.includes("completed")) return false;
  if ((row?.ownerAction || "").toUpperCase() === "CLOSE") return false;
  if (s === "endphase" || s.includes("end phase")) return true;
  return Boolean(row?.dueDate && new Date(row.dueDate) < new Date());
};

const RENEW_DATE_PRESET_DAYS = [7, 14, 30];

const isoDateDaysFromToday = (days) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const getStatusConfig = (status, isExpired) => {
  if (isExpired) return { color: STATUS_BADGE_COLORS.Expired.text, bg: STATUS_BADGE_COLORS.Expired.bg, label: "Expired", icon: <WarningIcon fontSize="inherit" /> };
  const s = (status || "").toLowerCase();
  if (s === "staged") return { color: STATUS_BADGE_COLORS.Staged.text, bg: STATUS_BADGE_COLORS.Staged.bg, label: "Staged", icon: <PendingIcon fontSize="inherit" /> };
  if (s === "endphase") return { color: STATUS_BADGE_COLORS.EndPhase.text, bg: STATUS_BADGE_COLORS.EndPhase.bg, label: "End Phase", icon: <WarningIcon fontSize="inherit" /> };
  if (s.includes("active")) return { color: STATUS_BADGE_COLORS.Active.text, bg: STATUS_BADGE_COLORS.Active.bg, label: "Active", icon: <TrendingUp fontSize="inherit" /> };
  if (s.includes("completed")) return { color: STATUS_BADGE_COLORS.Completed.text, bg: STATUS_BADGE_COLORS.Completed.bg, label: "Completed", icon: <CheckIcon fontSize="inherit" /> };
  if (s.includes("decision") || s.includes("pending")) return { color: STATUS_BADGE_COLORS.Pending.text, bg: STATUS_BADGE_COLORS.Pending.bg, label: "Pending", icon: <PendingIcon fontSize="inherit" /> };
  if (s.includes("closed")) return { color: STATUS_BADGE_COLORS.Closed.text, bg: STATUS_BADGE_COLORS.Closed.bg, label: "Closed", icon: <InfoIcon fontSize="inherit" /> };
  return { color: STATUS_BADGE_COLORS.Draft.text, bg: STATUS_BADGE_COLORS.Draft.bg, label: status || "Draft", icon: <InfoIcon fontSize="inherit" /> };
};

const statusMeta = (status, isExpired) => {
  const config = getStatusConfig(status, isExpired);
  const s = (status || "").toLowerCase();
  let color = "default";
  if (isExpired) color = "error";
  else if (s === "staged") color = "secondary";
  else if (s === "endphase") color = "warning";
  else if (config.label === "Active") color = "primary";
  else if (config.label === "Completed") color = "success";
  return { label: config.label, color, icon: config.icon };
};

// --- HELPER: Logic for Owner/Admin Action Status ---
const getOwnerActionStatus = (row) => {
  const ownerAct = (row.ownerAction || "NONE").toUpperCase();
  const adminAct = (row.adminAction || "NONE").toUpperCase();
  const hasAdmin = adminAct !== "NONE";

  let label = "";
  let color = "default";

  if (hasAdmin) {
    if (adminAct === "APPROVE_ALL") { label = "Admin Approved"; color = "success"; }
    else if (adminAct === "REVOKE_ALL") { label = "Admin Revoked"; color = "error"; }
    else if (adminAct === "EXTEND") { label = "Extended by Admin"; color = "info"; }
    else { label = "Closed by Admin"; color = "default"; }
  } else {
    if (ownerAct === "EXTEND") { label = "Owner requested renewal"; color = "success"; }
    else if (ownerAct === "CLOSE") { label = "Owner requested closure"; color = "error"; }
    else { label = "Pending owner decision"; color = "warning"; }
  }
  return { label, color, hasAdmin, ownerAct };
};

// ──────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ──────────────────────────────────────────────────────────────
const AccessCertificationEnhanced = () => {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  // State
  const [campaigns, setCampaigns] = useState([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [pendingAction, setPendingAction] = useState({
    open: false,
    type: null,
    campaign: null,
    date: null,
    extendPresetDays: null,
  });
  const [deepLinkParams, setDeepLinkParams] = useState(null);
  const [deepOwnerAction, setDeepOwnerAction] = useState(null);
  const [bulkAction, setBulkAction] = useState({ open: false, campaign: null, intent: null, token: null, loading: false });

  // Tabs: 0=All, 1=Staged, 2=Active, 3=Completed, 4=Expired, 5=Owner Actions, 6=Analytics, 7=Notifications
  const [tab, setTab] = useState(0);

  // Menu State
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

  const rowsPerPage = 10;

  // --- FETCH & ACTIONS ---
  const fetchCampaigns = async (showToast = false) => {
    try {
      setLoading(true);
      const res = await accessCertificationService.api.getCampaigns();
      if (res && (res.success === true || res.data)) {
        const data = Array.isArray(res.data) ? res.data : (res.data || res);
        setCampaigns(data || []);
        setError(null);
        if (showToast) setSnackbar({ open: true, message: "Refreshed successfully", severity: "success" });
      } else {
        throw new Error(res.error || "Failed to load campaigns");
      }
    } catch (err) {
      setError(err.message || "Unexpected error");
      setSnackbar({ open: true, message: err.message, severity: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCampaigns(); }, []);

  useEffect(() => {
    if (!reviewOpen && selectedCampaign) {
      fetchCampaigns();
      setSelectedCampaign(null);
    }
  }, [reviewOpen]);

  // Deep linking logic (simplified for brevity, kept intact)
  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    const token = params.get("token");
    const campaignId = params.get("campaignId");
    const campaign = params.get("campaign"); // For linking from SoD Violations
    const intentRaw = params.get("intent") || params.get("bulkIntent");
    const ownerIntent = params.get("ownerIntent");

    if (token && campaignId) {
      setTab(5);
      setDeepLinkParams({ token, campaignId, intent: intentRaw ? intentRaw.toUpperCase() : null });
    }
    if (ownerIntent && campaignId) {
      setTab(5);
      setDeepOwnerAction({ campaignId, action: ownerIntent.toUpperCase() });
    }
    // Handle direct campaign link from SoD Violations
    if (campaign) {
      const match = campaigns.find((c) => (c._id || c.id) === campaign);
      if (match) {
        setSelectedCampaign(match);
        setReviewOpen(true);
      }
    }
  }, [location.search, campaigns]);

  // Handle tab navigation from location state (e.g., from Policy Review)
  useEffect(() => {
    const state = location.state;
    if (state?.tab !== undefined) {
      let next = Number(state.tab);
      if (next === 8) next = 7; // legacy Notifications index
      else if (next === 7) next = 6; // Settings tab removed
      if (Number.isFinite(next)) setTab(Math.max(0, Math.min(next, 7)));
      // Clear state after applying
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Auto-apply deep links logic (kept intact)
  useEffect(() => {
    if (!deepLinkParams || campaigns.length === 0) return;
    const match = campaigns.find((c) => (c._id || c.id) === deepLinkParams.campaignId);
    if (!match) return;
    const intentToUse = deepLinkParams.intent || "APPROVE_ALL";
    setTab(4);
    if (deepLinkParams.intent) {
      handleBulkDecisionConfirm({ campaign: match, intent: intentToUse, token: deepLinkParams.token, skipState: true });
      setDeepLinkParams(null);
    } else {
      setBulkAction({ open: true, campaign: match, intent: intentToUse, token: deepLinkParams.token, loading: false });
    }
  }, [deepLinkParams, campaigns]);

  useEffect(() => {
    if (!deepOwnerAction || campaigns.length === 0) return;
    const match = campaigns.find((c) => (c._id || c.id) === deepOwnerAction.campaignId);
    if (!match) return;
    const action = deepOwnerAction.action;
    if (action === "EXTEND" || action === "CLOSE") {
      if (canOwnerRenewOrClose(match)) openOwnerAction(match, action);
    }
    setDeepOwnerAction(null);
  }, [deepOwnerAction, campaigns]);

  // Actions
  const handleDeleteCampaign = async (campaignId, campaignName) => {
    // Close menu before any loading UI — otherwise the MoreVert anchor unmounts
    // and MUI Menu jumps to the top-left (over the sidebar).
    setMenuAnchor(null);
    setMenuRow(null);
    if (!campaignId) return;
    try {
      setActionLoadingId(campaignId);
      const res = await accessCertificationService.controller.deleteCampaigns([
        campaignId,
      ]);
      if (res?.success === false) {
        throw new Error(res.error || "Delete failed");
      }
      setSnackbar({
        open: true,
        message: `Deleted "${campaignName}"`,
        severity: "success",
      });
      await fetchCampaigns();
    } catch (err) {
      setSnackbar({
        open: true,
        message: err?.message || "Delete failed",
        severity: "error",
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleActivateCampaign = async (campaignId, campaignName) => {
    setActionLoadingId(campaignId);
    try {
      await accessCertificationService.controller.activateCampaign(campaignId);
      setSnackbar({ open: true, message: `"${campaignName}" is now Active — assignment emails sent`, severity: "success" });
      await fetchCampaigns(true);
    } catch (err) {
      setSnackbar({ open: true, message: err.message || "Activation failed", severity: "error" });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleEdit = (row) => { setMenuAnchor(null); setWizardOpen(true); };
  const handleDuplicate = (row) => { setMenuAnchor(null); setSnackbar({ open: true, message: "Duplicate feature coming soon", severity: "info" }); };
  const handleReviewClick = (campaign) => { setSelectedCampaign(campaign); setReviewOpen(true); };

  const openOwnerAction = (row, action) => {
    if (!canOwnerRenewOrClose(row)) return;
    setPendingAction({
      open: true,
      type: action,
      campaign: row,
      date: isoDateDaysFromToday(7),
      extendPresetDays: action === "EXTEND" ? 7 : null,
    });
  };

  const handleOwnerActionConfirm = async () => {
    const { campaign, type, date } = pendingAction;
    if (!campaign || !type) return;
    const id = campaign._id || campaign.id;
    const payload = { action: type };
    if (type === "EXTEND") {
      const parsed = new Date(date || "");
      if (Number.isNaN(parsed.getTime())) {
        setSnackbar({ open: true, message: "Please choose a valid date", severity: "error" });
        return;
      }
      payload.newDueDate = parsed.toISOString();
    }
    setActionLoadingId(id);
    try {
      const result = await accessCertificationService.controller.applyOwnerAction(id, payload);
      const resolved = result?.pendingResolved ?? result?.data?.pendingResolved;
      setSnackbar({
        open: true,
        message:
          type === "EXTEND"
            ? "Campaign renewed"
            : resolved != null
              ? `Campaign closed — ${resolved} pending item(s) approved`
              : "Campaign closed — all remaining items approved",
        severity: "success",
      });
      setPendingAction({ open: false, type: null, campaign: null, date: null, extendPresetDays: null });
      await fetchCampaigns(true);
    } catch (err) {
      setSnackbar({ open: true, message: err.message || "Update failed", severity: "error" });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOwnerActionCancel = () =>
    setPendingAction({ open: false, type: null, campaign: null, date: null, extendPresetDays: null });

  const openBulkDecision = (row, intent, token = null) => {
    if (!row) return;
    setBulkAction({ open: true, campaign: row, intent: (intent || "APPROVE_ALL").toUpperCase(), token, loading: false });
  };

  const handleBulkDecisionCancel = () => setBulkAction({ open: false, campaign: null, intent: null, token: null, loading: false });

  const handleBulkDecisionConfirm = async (override = {}) => {
    const campaign = override.campaign || bulkAction.campaign;
    const intent = (override.intent || bulkAction.intent || "").toUpperCase();
    const token = override.token !== undefined ? override.token : bulkAction.token;
    const skipState = Boolean(override.skipState);

    if (!campaign || !intent) {
      setSnackbar({ open: true, message: "Select a bulk action first", severity: "warning" });
      return;
    }
    const id = campaign._id || campaign.id;
    if (!skipState) setBulkAction((p) => ({ ...p, loading: true }));
    try {
      const result = await accessCertificationService.controller.applyBulkOwnerDecision(id, { action: intent, token });
      const intentLabel = intent === "REVOKE_ALL" ? "revoked" : "approved";
      const resolved =
        result?.pendingResolved ?? result?.data?.pendingResolved;
      setSnackbar({
        open: true,
        message:
          resolved != null
            ? `${resolved} pending item(s) ${intentLabel}`
            : `Bulk ${intentLabel} for pending items`,
        severity: "success",
      });
      if (!skipState) setBulkAction({ open: false, campaign: null, intent: null, token: null, loading: false });
      setDeepLinkParams(null);
      await fetchCampaigns(true);
    } catch (err) {
      setSnackbar({ open: true, message: err.message || "Bulk action failed", severity: "error" });
      if (!skipState) setBulkAction((p) => ({ ...p, loading: false }));
    }
  };

  // --- FILTERING ---
  const filtered = useMemo(() => {
    const q = (query || "").toLowerCase();
    return campaigns.filter((c) => {
      const matchesQuery = (c.name || "").toLowerCase().includes(q) || (c.description || "").toLowerCase().includes(q) || (c.statusLabel || c.status || "").toLowerCase().includes(q) || (c.applicationName || "").toLowerCase().includes(q);
      if (!matchesQuery) return false;
      const isExpired = checkIsExpired(c.dueDate, c.statusLabel || c.status);
      const s = (c.statusLabel || c.status || "").toLowerCase();
      if (tab === 1) return s === "staged" || s === "draft";
      if (tab === 2) return !isExpired && (s.includes("active") || s.includes("decision") || s.includes("pending"));
      if (tab === 3) return s.includes("completed");
      if (tab === 4) return isExpired;
      return true;
    });
  }, [campaigns, query, tab]);

  const paged = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filtered.slice(start, start + rowsPerPage);
  }, [filtered, page]);

  const stats = useMemo(() => ({
    total: campaigns.length,
    active: campaigns.filter(c => !((c.status || "").toLowerCase().includes("completed"))).length,
    expired: campaigns.filter(c => checkIsExpired(c.dueDate, c.status)).length
  }), [campaigns]);

  const ownerActionItems = useMemo(() => campaigns.filter((c) => {
    const s = (c.status || "").toLowerCase();
    const isExpired = checkIsExpired(c.dueDate, c.statusLabel || c.status);
    const ownerAct = (c.ownerAction || "").toUpperCase();
    const closed = ownerAct === "CLOSE" || s.includes("closed");
    return (isExpired || s === "endphase" || ownerAct !== "NONE") && !closed;
  }), [campaigns]);

  // ──────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────
  return (
    <Box sx={{ p: { xs: 1.5, md: 2 }, bgcolor: AC_PALETTE.pageBg, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }}>

      {/* TOP NAV */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Button
          variant="text"
          startIcon={<ArrowBack />}
          onClick={() => navigate('/governance/certifications')}
          sx={{
            px: 1.5,
            py: 0.75,
            textTransform: 'none',
            fontWeight: 700,
            borderRadius: 2,
            color: AC_PALETTE.accent,
            border: `1px solid ${AC_PALETTE.border}`,
            bgcolor: AC_PALETTE.surface,
            '&:hover': {
              bgcolor: AC_PALETTE.surfaceMuted,
              borderColor: AC_PALETTE.border,
            }
          }}
        >
          Back to Certifications
        </Button>
      </Box>

      {/* 1. HEADER */}
      <Box display="flex" flexDirection={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: "center" }} mb={3} gap={2}>
        <Box>
          <Typography variant="h4" fontWeight={800} color={AC_PALETTE.text}>Access Certifications</Typography>
          <Typography variant="body1" color="text.secondary" mt={0.5}>Manage compliance cycles, reviews, and reminders.</Typography>
        </Box>
        <Box display="flex" gap={1.5}>
          <Button variant="outlined" startIcon={<Refresh />} onClick={() => fetchCampaigns(true)} disabled={loading} sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 600, bgcolor: AC_PALETTE.cardBg }}>Refresh</Button>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setWizardOpen(true)}
            sx={{
              borderRadius: 3,
              textTransform: 'none',
              fontWeight: 600,
              px: 3,
              bgcolor: AC_PALETTE.accent,
              boxShadow: 'none',
              transition: '0.3s',
              '&:hover': { bgcolor: alpha(AC_PALETTE.accent, 0.9), boxShadow: 'none' }
            }}
          >
            New Campaign
          </Button>
        </Box>
      </Box>

      {/* 2. TABS & FILTERS — Application View curved tabs */}
      <CatalogCurvedTabs
        value={tab}
        onChange={(_, v) => { setTab(v); setPage(1); }}
        tabs={CERTIFICATION_TABS}
      />

      <Box
        sx={{
          bgcolor: CATALOG.surface,
          border: `1px solid ${CATALOG.border}`,
          borderRadius: "0 0 12px 12px",
          mt: "-1px",
          position: "relative",
          zIndex: 1,
          px: { xs: 1.5, md: 2 },
          pt: 2,
          pb: 2,
          mb: 2.5,
          minHeight: 400,
        }}
      >
          {tab < 4 && (
            <Stack direction="row" spacing={1} sx={{ mb: 2, width: { xs: "100%", md: "auto" }, justifyContent: "flex-end" }}>
              <TextField placeholder="Search campaign, app, status..." size="small" value={query} onChange={(e) => setQuery(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><Search sx={{ color: AC_PALETTE.textLight }} /></InputAdornment>, sx: { borderRadius: 3, bgcolor: AC_PALETTE.surface, border: 'none', width: { xs: '100%', md: 280 }, '& fieldset': { border: 'none' } } }}
              />
            </Stack>
          )}

      {/* 3. CONTENT AREA */}
        {/* Loading Skeleton */}
        {loading && tab < 5 ? (
          <Box sx={{ p: 2 }}>
            <Card sx={{ borderRadius: 4, overflow: 'hidden' }}>
              <Box p={3}><Skeleton variant="text" width="30%" height={40} /></Box>
              <Stack spacing={2} p={3}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Box key={i} display="flex" gap={2}>
                    <Skeleton variant="circular" width={40} height={40} />
                    <Skeleton variant="rectangular" width="100%" height={40} sx={{ borderRadius: 1 }} />
                  </Box>
                ))}
              </Stack>
            </Card>
          </Box>
        ) : (
          <>
            {error && <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>{error}</Alert>}

            {/* VIEW: ANALYTICS */}
            {tab === 6 && (
              <Fade in>
                <Box>
                  <Suspense fallback={<LazySectionFallback />}>
                    <AnalyticsDashboard campaigns={campaigns} onReviewClick={handleReviewClick} />
                  </Suspense>
                </Box>
              </Fade>
            )}

            {/* VIEW: NOTIFICATIONS DASHBOARD */}
            {tab === 7 && (
              <Fade in>
                <Box>
                  <Suspense fallback={<LazySectionFallback />}>
                    <NotificationDashboard />
                  </Suspense>
                </Box>
              </Fade>
            )}

            {/* DIALOGS */}
            <Dialog open={pendingAction.open} onClose={handleOwnerActionCancel} fullWidth maxWidth="sm">
              <DialogTitle sx={{ fontWeight: 700 }}>{pendingAction.type === "EXTEND" ? "Renew campaign" : "Close campaign"}</DialogTitle>
              <DialogContent dividers>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>{pendingAction.campaign?.name || "Campaign"}</Typography>
                {pendingAction.type === "EXTEND" ? (
                  <Stack spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                      Choose how long to extend the campaign. Reviewers can continue after the new due date; reminders follow your tenant schedule.
                    </Typography>
                    <Box>
                      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: "block", mb: 1 }}>
                        Quick pick
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {RENEW_DATE_PRESET_DAYS.map((days) => {
                          const iso = isoDateDaysFromToday(days);
                          const selected = pendingAction.extendPresetDays === days;
                          return (
                            <Chip
                              key={days}
                              label={`+${days} days · ${formatDate(iso)}`}
                              clickable
                              onClick={() =>
                                setPendingAction((p) => ({
                                  ...p,
                                  date: iso,
                                  extendPresetDays: days,
                                }))
                              }
                              color={selected ? "primary" : "default"}
                              variant={selected ? "filled" : "outlined"}
                            />
                          );
                        })}
                      </Stack>
                    </Box>
                    <TextField
                      label="Or pick a custom date"
                      type="date"
                      value={pendingAction.date || ""}
                      onChange={(e) => {
                        const next = e.target.value;
                        const matchedPreset = RENEW_DATE_PRESET_DAYS.find(
                          (d) => isoDateDaysFromToday(d) === next,
                        );
                        setPendingAction((p) => ({
                          ...p,
                          date: next,
                          extendPresetDays: matchedPreset ?? null,
                        }));
                      }}
                      inputProps={{ min: isoDateDaysFromToday(1) }}
                      InputLabelProps={{ shrink: true }}
                      fullWidth
                      helperText={
                        pendingAction.date
                          ? `New due date: ${formatDate(pendingAction.date)}`
                          : "Select a date on or after tomorrow"
                      }
                    />
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Closing will approve all remaining pending access items, then mark the campaign as Closed and stop further reminders.
                  </Typography>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={handleOwnerActionCancel}>Cancel</Button>
                <Button variant="contained" color={pendingAction.type === "EXTEND" ? "primary" : "error"} onClick={handleOwnerActionConfirm} disabled={actionLoadingId !== null}>{pendingAction.type === "EXTEND" ? "Confirm Renewal" : "Close Campaign"}</Button>
              </DialogActions>
            </Dialog>

            <Dialog open={bulkAction.open} onClose={handleBulkDecisionCancel} fullWidth maxWidth="sm">
              <DialogTitle sx={{ fontWeight: 700 }}>Bulk decision</DialogTitle>
              <DialogContent dividers>
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="subtitle1" fontWeight={700} gutterBottom>{bulkAction.campaign?.name || "Campaign"}</Typography>
                    <Typography variant="body2" color="text.secondary">Apply a bulk decision to all pending items for this campaign. This will mark every pending review as {bulkAction.intent === "REVOKE_ALL" ? "Revoked" : "Approved"} in one step.</Typography>
                  </Box>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Button variant={bulkAction.intent === "APPROVE_ALL" ? "contained" : "outlined"} color="success" onClick={() => setBulkAction((p) => ({ ...p, intent: "APPROVE_ALL" }))}>Approve all pending</Button>
                    <Button variant={bulkAction.intent === "REVOKE_ALL" ? "contained" : "outlined"} color="warning" onClick={() => setBulkAction((p) => ({ ...p, intent: "REVOKE_ALL" }))}>Revoke all pending</Button>
                  </Stack>
                  {bulkAction.token && <Alert severity="info" icon={<InfoIcon fontSize="small" />}>Signed link detected from email. The token authorizes this bulk action without additional steps.</Alert>}
                </Stack>
              </DialogContent>
              <DialogActions>
                <Button onClick={handleBulkDecisionCancel}>Cancel</Button>
                <Button variant="contained" color={bulkAction.intent === "REVOKE_ALL" ? "warning" : "success"} onClick={handleBulkDecisionConfirm} disabled={bulkAction.loading}>{bulkAction.loading ? "Applying..." : "Apply to all"}</Button>
              </DialogActions>
            </Dialog>

            {/* VIEW: OWNER ACTIONS */}
            {tab === 5 && (
              <Fade in>
                <Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} px={1}>
                    <Box>
                      <Typography variant="h6" fontWeight={800}>Action Required</Typography>
                      <Typography variant="body2" color="text.secondary">Expired campaigns awaiting owner or admin decision</Typography>
                    </Box>
                    <Chip label={`${ownerActionItems.length} Items`} color={ownerActionItems.length ? "error" : "default"} size="small" />
                  </Box>

                  {ownerActionItems.length === 0 ? (
                    <Box display="flex" flexDirection="column" alignItems="center" py={8} bgcolor="background.paper" borderRadius={4} border="1px dashed #e0e0e0">
                      <InboxIcon sx={{ fontSize: 48, mb: 1, color: 'text.disabled' }} />
                      <Typography variant="h6" color="text.secondary">All caught up!</Typography>
                      <Typography variant="body2" color="text.secondary">No expired campaigns pending action.</Typography>
                    </Box>
                  ) : (
                    <Stack spacing={2}>
                      {ownerActionItems.map((row) => {
                        const id = row._id || row.id;
                        const { label, color, hasAdmin, ownerAct } = getOwnerActionStatus(row);
                        const expirySent = Boolean(row.ownerActionEmailSentAt);
                        const actionDisabled = hasAdmin || ownerAct === "CLOSE" || (row.status || "").toLowerCase().includes("closed");
                        const bulkBusy = bulkAction.loading && ((bulkAction.campaign?._id || bulkAction.campaign?.id) === id);

                        return (
                          <Card key={id} variant="outlined" sx={{ borderRadius: 3, borderColor: alpha(theme.palette.error.main, 0.3) }}>
                            <CardHeader
                              avatar={<Avatar variant="rounded" sx={{ bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.main }}>{row.applicationName?.[0]}</Avatar>}
                              title={<Typography variant="subtitle1" fontWeight={700}>{row.name}</Typography>}
                              subheader={`Application: ${row.applicationName || '—'} • Category: ${row.category || 'General'}`}
                              action={<Chip size="small" label="Expired" color="error" variant="filled" />}
                              sx={{ bgcolor: alpha(theme.palette.background.default, 0.4), borderBottom: `1px solid ${theme.palette.divider}`, py: 1.5 }}
                            />
                            <CardContent sx={{ pb: 1 }}>
                              <Stack direction="row" spacing={1} mb={2} flexWrap="wrap" gap={1}>
                                <Chip size="small" label={`Due: ${formatDate(row.dueDate)}`} variant="outlined" />
                                <Chip size="small" label={label} color={color} variant="outlined" />
                                {expirySent && <Chip size="small" label="Email Sent" color="success" variant="outlined" />}
                              </Stack>
                              <Typography variant="body2" color="text.secondary" sx={{ bgcolor: 'background.default', p: 1.5, borderRadius: 1 }}>
                                {hasAdmin ? "Admin has overridden the process." : "Owner decision pending. You can enforce a decision below."}
                              </Typography>
                            </CardContent>
                            <CardActions sx={{ justifyContent: 'flex-end', px: 2, pb: 2, gap: 1 }}>
                              <Button size="small" onClick={() => openBulkDecision(row, "APPROVE_ALL")} disabled={actionDisabled || bulkBusy} color="success">Approve All</Button>
                              <Button size="small" onClick={() => openBulkDecision(row, "REVOKE_ALL")} disabled={actionDisabled || bulkBusy} color="error">Revoke All</Button>
                              <Box sx={{ width: 1, height: 20, bgcolor: 'divider', mx: 1 }} />
                              <Button variant="contained" size="small" onClick={() => openOwnerAction(row, "EXTEND")} disabled={actionDisabled || bulkBusy}>{ownerAct === "EXTEND" ? "Confirm Renew" : "Renew"}</Button>
                              <Button variant="outlined" size="small" color="error" onClick={() => openOwnerAction(row, "CLOSE")} disabled={actionDisabled || bulkBusy}>{ownerAct === "CLOSE" ? "Confirm Close" : "Close"}</Button>
                            </CardActions>
                          </Card>
                        );
                      })}
                    </Stack>
                  )}
                </Box>
              </Fade>
            )}

            {/* VIEW: TABLE LIST */}
            {tab < 5 && (
              <Fade in>
                <Box>
                  <Suspense fallback={<LazySectionFallback />}>
                    <AccessCertificationCampaignTable
                      rows={paged}
                      filteredCount={filtered.length}
                      page={page}
                      rowsPerPage={rowsPerPage}
                      onPageChange={setPage}
                      onReview={handleReviewClick}
                      onActivate={(row) => handleActivateCampaign(row._id || row.id, row.name)}
                      activatingId={actionLoadingId}
                      onOpenActions={(anchor, row) => {
                        setMenuAnchor(anchor);
                        setMenuRow(row);
                      }}
                      onCreateCampaign={() => setWizardOpen(true)}
                      theme={theme}
                      CampaignReminderButton={CampaignReminderButton}
                    />
                  </Suspense>
                </Box>
              </Fade>
            )}
          </>
        )}
      </Box>

      {/* 4. FOOTER / MENUS */}
      <Suspense fallback={null}>
        <AccessCertificationWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCampaignCreated={() => { setWizardOpen(false); fetchCampaigns(true); }} />
      </Suspense>
      {selectedCampaign && (
          <AccessCertificationReview open={reviewOpen} campaign={selectedCampaign} onClose={() => setReviewOpen(false)} />
      )}

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => {
          setMenuAnchor(null);
          setMenuRow(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        disableScrollLock
        PaperProps={{
          elevation: 0,
          sx: {
            filter: "drop-shadow(0px 2px 8px rgba(0,0,0,0.15))",
            borderRadius: 3,
            mt: 1,
          },
        }}
      >
        <MenuItem
          onClick={() => {
            if (menuRow) handleEdit(menuRow);
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1.5 }} /> Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuRow) handleDuplicate(menuRow);
          }}
        >
          <DuplicateIcon fontSize="small" sx={{ mr: 1.5 }} /> Duplicate
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            if (menuRow) {
              handleDeleteCampaign(
                menuRow._id || menuRow.id,
                menuRow.name,
              );
            }
          }}
          sx={{ color: "error.main" }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1.5 }} /> Delete
        </MenuItem>
      </Menu>

      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar(p => ({ ...p, open: false }))} message={snackbar.message} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
};

export default AccessCertificationEnhanced;