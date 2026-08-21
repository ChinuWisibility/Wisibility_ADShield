import React, { lazy, Suspense, useCallback, useEffect, useState, useMemo, useRef } from "react";
import accessCertificationService from "../../../services/accessCertificationService";
import {
    isRemediationInFlight,
    hasRevokedWorkflowActivity,
    entitlementStatusToDecision,
    reviewItemStatusToDecision,
} from "../../../utils/remediationWorkflowStatus";
import { workflowTaskQueueApi } from "../../../features/remediation-events/services/api";
import { ACCESS_REVOKE_QUEUE_MODAL_PIPELINE } from "../../../features/remediation-events/utils/accessRevokePipeline";
import { useAuth } from "../../../contexts/AuthContext";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    Typography,
    Box,
    CircularProgress,
    Paper,
    LinearProgress,
    Snackbar,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Button,
    Chip,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Pagination,
    Tabs,
    Tab,
    TextField,
    InputAdornment,
    MenuItem,
    Checkbox,
    IconButton,
    Collapse,
    Divider,
    Avatar,
    Alert,
    Skeleton,
} from "@mui/material";
import {
    CommentOutlined,
    Download as DownloadIcon,
    Dashboard as DashboardIcon,
    ListAlt as ListIcon,
    Check as CheckIcon,
    Block as BlockIcon,
    ArrowBack,
    Search as SearchIcon,
    Close as CloseIcon,
    Refresh as RefreshIcon,
    KeyboardArrowDown as ArrowDownIcon,
    KeyboardArrowRight as ArrowRightIcon,
    PersonOutline as PersonOutlineIcon,
    NotificationsActive as NotificationsIcon,
} from "@mui/icons-material";
import { DECISION_COLORS } from "./AcessStyles";
import { resolveDisplayName, resolveEmail, resolveManager, resolveManagerEmail, coerceReadableText } from "../../../utils/resolveIdentityFields";
import IdentityCard from "./IdentityCard";
const AccessCertificationDashboard = lazy(() => import("./ReviewDashboard"));
const ReviewNotifications = lazy(() => import("./ReviewNotifications"));
const ReviewDecisionModal = lazy(() => import("./ReviewDecisionModal"));
const QueueFirstRemediationModal = lazy(() => import("../../../components/remediation/QueueFirstRemediationModal"));

/* ============================================================
   1. Helpers
   ============================================================ */
const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
};

const formatReminderSummary = (summary) => {
    if (!summary?.lastReminderAt) return null;
    const sent = new Date(summary.lastReminderAt).toLocaleString();
    return `${sent} · ${summary.lastReminderStatus || "SENT"}`;
};

/** Backend caps scope fetch at 500 items per request. */
const REVIEW_BOARD_MAX_PAGE_SIZE = 500;
const DEFAULT_REVIEW_PAGE_SIZE = 25;
const REVIEW_PAGE_SIZE_OPTIONS = [25, 50, 100, REVIEW_BOARD_MAX_PAGE_SIZE];

function clampReviewPageSize(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_REVIEW_PAGE_SIZE;
    return Math.min(REVIEW_BOARD_MAX_PAGE_SIZE, Math.max(1, Math.round(n)));
}

function ReviewBoardPaginationBar({ page, pageCount, serverTotal, rowsPerPage, onPageChange, sx }) {
    const total = Number(serverTotal) || 0;
    const size = clampReviewPageSize(rowsPerPage);
    const rangeStart = total === 0 ? 0 : (page - 1) * size + 1;
    const rangeEnd = total === 0 ? 0 : Math.min(page * size, total);

    return (
        <Box
            sx={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1.5,
                py: 0.75,
                px: 0.5,
                ...sx,
            }}
        >
            <Typography sx={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 600 }}>
                {total === 0
                    ? "No items"
                    : pageCount > 1
                        ? `${rangeStart}–${rangeEnd} of ${total} items · page ${page} of ${pageCount}`
                        : `Showing all ${total} item${total !== 1 ? "s" : ""}`}
            </Typography>
            {pageCount > 1 && (
                <Pagination
                    count={pageCount}
                    page={page}
                    onChange={onPageChange}
                    color="primary"
                    size="small"
                    showFirstButton
                    showLastButton
                    siblingCount={1}
                    boundaryCount={1}
                />
            )}
        </Box>
    );
}

function ReviewItemSkeletonList({ count = 3 }) {
    const rows = Math.max(1, Math.min(Number(count) || 3, 8));
    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {Array.from({ length: rows }).map((_, index) => (
                <Paper
                    key={index}
                    elevation={0}
                    sx={{
                        border: "1px solid #E2E8F0",
                        borderRadius: 2.5,
                        p: 2,
                        bgcolor: "#FFFFFF",
                    }}
                >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                        <Skeleton variant="circular" width={36} height={36} />
                        <Box sx={{ flex: 1 }}>
                            <Skeleton width={index % 2 === 0 ? "42%" : "55%"} height={22} />
                            <Skeleton width="68%" height={16} sx={{ mt: 0.75 }} />
                        </Box>
                        <Skeleton variant="rounded" width={88} height={28} />
                    </Box>
                </Paper>
            ))}
        </Box>
    );
}

const getDecisionChip = (decision) => {
    const decisionKey = coerceReadableText(decision) || "Pending";
    const S = {
        Approved: { label: "Approved", icon: <CheckIcon fontSize="small" />, ...DECISION_COLORS.Approved },
        Revoked: { label: "Revoked", icon: <BlockIcon fontSize="small" />, ...DECISION_COLORS.Revoked },
        Pending: { label: "Pending", icon: null, ...DECISION_COLORS.Pending },
        Delegate: { label: "Delegate", icon: null, ...DECISION_COLORS.Delegate },
        Exception: { label: "Exception", icon: null, ...DECISION_COLORS.Exception },
    };
    const style = S[decisionKey] || S.Pending;
    return (
        <Chip
            label={style.label}
            icon={style.icon || undefined}
            size="small"
            sx={{
                fontSize: "0.72rem",
                height: 22,
                fontWeight: 600,
                bgcolor: style.bg,
                color: style.text,
                border: `1px solid ${style.border}`,
                '& .MuiChip-icon': { color: 'inherit', fontSize: '14px' },
            }}
        />
    );
};

const getItemKey = (item) =>
    coerceReadableText(item?.id) ||
    coerceReadableText(item?.itemId) ||
    coerceReadableText(item?._id) ||
    "";

function expandAliasTokensLocal(s) {
    const t = coerceReadableText(s).trim();
    if (!t) return new Set();
    const set = new Set([t, t.toLowerCase()]);
    const dn = t.match(/^CN=([^,]+)/i);
    if (dn) {
        const cn = dn[1].trim();
        set.add(cn);
        set.add(cn.toLowerCase());
    }
    if (/^[a-f\d]{24}$/i.test(t)) {
        set.add(t.toLowerCase());
    }
    if (t.includes("@")) {
        const local = t.split("@")[0];
        const domain = t.split("@").slice(1).join("@");
        set.add(`${local.toLowerCase()}@${domain.toLowerCase()}`);
    }
    return set;
}

function itemIdsMatchLoose(a, b) {
    const A = expandAliasTokensLocal(a);
    const B = expandAliasTokensLocal(b);
    for (const x of A) { if (B.has(x)) return true; }
    const lowerB = new Set([...B].map((x) => coerceReadableText(x).toLowerCase()));
    for (const x of A) { if (lowerB.has(coerceReadableText(x).toLowerCase())) return true; }
    return false;
}

function findEntryInReviewMap(reviewMap, candidates) {
    const list = (candidates || []).filter(Boolean);
    for (const cid of list) {
        const key = coerceReadableText(cid);
        if (reviewMap.has(key)) return reviewMap.get(key);
    }
    const keys = [...reviewMap.keys()];
    for (const cid of list) {
        for (const k of keys) {
            if (itemIdsMatchLoose(k, cid)) return reviewMap.get(k);
        }
    }
    return null;
}

function getReviewEntryForItem(reviewState, item) {
    const primary = item?.id != null ? coerceReadableText(item.id) : "";
    if (primary && reviewState.has(primary)) return reviewState.get(primary);
    const candidates = [
        item?.id, item?.userId, item?.mongoId, item?.email, item?.itemId,
        ...(Array.isArray(item?.targetIds) ? item.targetIds : []),
    ].filter(Boolean);
    return findEntryInReviewMap(reviewState, candidates) || {};
}

function buildReviewMapFromScopeAndCampaign(apiCampaign, normalizedScope) {
    const crSource = apiCampaign?.currentReview || {};
    const reviewMap = new Map();
    Object.entries(crSource).forEach(([k, v]) => reviewMap.set(k, { ...v, itemId: k }));

    const out = new Map();
    normalizedScope.forEach((item) => {
        if (item.reviewItemId) {
            const st = item.reviewItemStatus;
            const decision = reviewItemStatusToDecision(
                st,
                item.aggregatedDecision || item.currentReview?.decision || "Pending",
            );
            out.set(item.id, { ...(item.currentReview || {}), decision, itemId: item.id, reviewItemId: item.reviewItemId });
            return;
        }
        const candidates = [item.id, item.userId, item.mongoId, item.email, item.itemId,
        ...(Array.isArray(item.targetIds) ? item.targetIds : [])].filter(Boolean);
        const found = findEntryInReviewMap(reviewMap, candidates);

        if (item.currentReview?.decision) {
            out.set(item.id, { ...item.currentReview, itemId: item.id });
        } else if (item.aggregatedDecision) {
            out.set(item.id, { decision: item.aggregatedDecision, itemId: item.id });
        } else if (found) {
            out.set(item.id, { ...found, itemId: item.id });
        } else {
            out.set(item.id, { decision: "Pending", itemId: item.id });
        }
    });
    return out;
}

const DN_INTERIOR_RE = /[,;]\s*(?:CN|OU|DC|O|L|ST|C)=/i;

const parseGroupsFromMemberOf = (memberOfRaw) => {
    if (!memberOfRaw) return [];
    const segments = [];
    if (Array.isArray(memberOfRaw)) {
        segments.push(...memberOfRaw.map((i) => String(i || "").trim()).filter(Boolean));
    } else {
        segments.push(String(memberOfRaw));
    }
    const tokens = [];
    for (const seg of segments) {
        if (!seg) continue;
        for (const pipePart of seg.split("|").map((p) => p.trim()).filter(Boolean)) {
            for (const semiPart of pipePart.split(";").map((s) => s.trim()).filter(Boolean)) {
                if (/^CN=/i.test(semiPart) || DN_INTERIOR_RE.test(semiPart)) {
                    tokens.push(semiPart);
                } else {
                    tokens.push(...semiPart.split(",").map((c) => c.trim()).filter(Boolean));
                }
            }
        }
    }
    const seen = new Map();
    for (const g of tokens) {
        if (/^OU=/i.test(g) || /^DC=/i.test(g) || /^O=/i.test(g)) continue;
        const m = g.match(/^CN=([^,;]+)/i);
        const label = (m ? m[1] : g).trim();
        if (!label) continue;
        const key = label.toLowerCase();
        if (!seen.has(key)) seen.set(key, label);
    }
    return Array.from(seen.values());
};

function isLikelyEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

/** Align API / legacy values with campaign enum names used for reviewer bucketing. */
function normalizeCertificationCategoryUpper(raw) {
    const s = String(raw || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (!s) return "";
    const aliases = {
        ACCESSITEMS: "ACCESS_ITEMS",
        ACCESS_ITEM: "ACCESS_ITEMS",
        ROLECOMPOSITION: "ROLE_COMPOSITION",
        UNCORRELATEDACCOUNTS: "UNCORRELATED_ACCOUNTS",
    };
    return aliases[s] || s;
}

/** When campaign.currentReview has no reviewerEmail, group like Identity: bucket by manager email, then manager login/name. */
function getReviewerGroupKeyForItem(item, entry, categoryUpper) {
    const rev = coerceReadableText(
        entry?.reviewerEmail || item?.currentReview?.reviewerEmail,
    )
        .trim()
        .toLowerCase();
    if (rev) return rev;

    const cat = normalizeCertificationCategoryUpper(categoryUpper);
    const mgrEm = coerceReadableText(item.managerEmail).trim().toLowerCase();
    const mgrName = coerceReadableText(item.manager).trim().toLowerCase();
    const hasManagerBucket = Boolean(mgrEm || mgrName);

    const mgrRoutedExplicit = [
        "ACCESS_ITEMS",
        "ROLE_COMPOSITION",
        "IDENTITY",
        "UNCORRELATED_ACCOUNTS",
        "MANAGER",
    ].includes(cat);
    // If category is missing on the payload but rows carry manager fields, still bucket (fixes strict enum mismatch / partial campaign objects).
    const mgrRouted = mgrRoutedExplicit || (!cat && hasManagerBucket);
    if (!mgrRouted) return "__unassigned__";

    if (mgrEm && isLikelyEmail(mgrEm)) return mgrEm;

    if (mgrName) return `__mgr__:${mgrName}`;

    return "__unassigned__";
}

const getCategoryLabel = (category, accessFilter = "ALL") => {
    const value = String(category || "").toUpperCase();
    const af = String(accessFilter || "ALL").toUpperCase();
    if (value === "ACCESS_ITEMS" && af === "PRIVILEGED") return "Privileged Access Certification";
    if (value === "ACCESS_ITEMS") return "Access Items Certification";
    if (value === "IDENTITY") return "Identity Certification";
    if (value === "UNCORRELATED_ACCOUNTS") return "Uncorrelated Accounts Review";
    if (value === "ROLE_COMPOSITION") return "Role Composition Certification";
    if (value === "MANAGER") return "Manager Certification";
    if (value === "SOD") return "Separation of Duties";
    return (category || "General") + " Certification";
};

/* ============================================================
   2. Main Component
   ============================================================ */
export default function AccessCertificationReview({ open, onClose, campaign }) {
    const campaignId = campaign?._id || campaign?.id;
    const { user: authUser } = useAuth();
    const currentReviewerName = authUser?.name || authUser?.displayName || authUser?.email || "Reviewer";

    const [scopeData, setScopeData] = useState([]);
    const [reviewState, setReviewState] = useState(new Map());
    const [fullCampaign, setFullCampaign] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const hasScopeDataRef = useRef(false);
    const hasInitializedExpansionRef = useRef(false);
    const hasInitializedIdentityRef = useRef(false);
    const reviewScrollRef = useRef(null);

    const [activeTab, setActiveTab] = useState(0);
    const [modalOpen, setModalOpen] = useState(false);
    const [currentItem, setCurrentItem] = useState(null);
    const [currentDecision, setCurrentDecision] = useState(null);
    const [revokeWorkflowOpen, setRevokeWorkflowOpen] = useState(false);
    const [pendingRevoke, setPendingRevoke] = useState(null);
    const [revokeWorkflowSubmitting, setRevokeWorkflowSubmitting] = useState(false);
    const [revokeWorkflowError, setRevokeWorkflowError] = useState("");
    const [snackbar, setSnackbar] = useState({ open: false, message: "" });

    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_REVIEW_PAGE_SIZE);
    const [serverTotal, setServerTotal] = useState(0);
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("All");
    const [showWithoutAccess, setShowWithoutAccess] = useState(true);
    const [accessViewMode, setAccessViewMode] = useState("ALL"); // ALL | WITH_ACCESS | WITHOUT_ACCESS

    const [selectedIds, setSelectedIds] = useState(new Set());
    // Optimistic overrides for per-entitlement decisions, keyed by "reviewItemId::entitlementName"
    const [entitlementReviewState, setEntitlementReviewState] = useState(new Map());

    const [reviewerPages, setReviewerPages] = useState({});
    const [expandedReviewerKey, setExpandedReviewerKey] = useState(null);
    const ROWS_PER_REVIEWER = 15;

    // Identity-grouped board state
    const [expandedIdentityKey, setExpandedIdentityKey] = useState(null);
    const [campaignReminderSummary, setCampaignReminderSummary] = useState(null);
    const [remediationExecutions, setRemediationExecutions] = useState([]);

    const fetchRemediationExecutions = useCallback(async () => {
        if (!campaignId) return;
        try {
            const res = await workflowTaskQueueApi.listTasks({ campaignId, limit: 200 });
            const tasks = res.data?.data || [];
            setRemediationExecutions(
                tasks.map((t) => ({
                    executionId: t.executionId || t.taskId,
                    reviewItemId: t.reviewEventId,
                    entitlementName: t.entitlementName,
                    status: t.status,
                    workflowName: t.workflowName,
                    taskId: t.taskId,
                })),
            );
        } catch {
            /* best-effort */
        }
    }, [campaignId]);

    const executionById = useMemo(() => {
        const map = new Map();
        for (const ex of remediationExecutions) {
            if (ex?.executionId) map.set(ex.executionId, ex);
        }
        return map;
    }, [remediationExecutions]);

    const executionByEntitlementKey = useMemo(() => {
        const map = new Map();
        for (const ex of remediationExecutions) {
            if (!ex?.reviewItemId) continue;
            const key = `${ex.reviewItemId}::${String(ex.entitlementName || "").trim().toLowerCase()}`;
            map.set(key, ex);
        }
        return map;
    }, [remediationExecutions]);

    const getExecutionForRow = useCallback(({ executionId, reviewItemId, entitlementName }) => {
        if (executionId && executionById.has(executionId)) {
            return executionById.get(executionId);
        }
        const key = `${reviewItemId}::${String(entitlementName || "").trim().toLowerCase()}`;
        return executionByEntitlementKey.get(key) || null;
    }, [executionById, executionByEntitlementKey]);

    const handleChangePage = (_, value) => {
        setPage(value);
        setSelectedIds(new Set());
        setExpandedIdentityKey(null);
        hasInitializedIdentityRef.current = false;
        if (reviewScrollRef.current) {
            reviewScrollRef.current.scrollTop = 0;
        }
    };

    /* ============================================================
       3. Fetch & Normalize
       ============================================================ */
    const fetchCampaignData = useCallback(async (silent = false, showRefreshBar = true) => {
        if (!campaignId) { setLoading(false); return; }
        if (silent && hasScopeDataRef.current) {
            if (showRefreshBar) setRefreshing(true);
        } else {
            setLoading(true);
        }
        setError(null);
        try {
            const scopeStatus =
                statusFilter === "Pending" ? "PENDING"
                    : statusFilter === "Reviewed" ? "REVIEWED"
                        : "";
            const res = await accessCertificationService.api.getCampaignById(campaignId, {
                scopePage: page,
                scopeLimit: rowsPerPage,
                scopeLight: 1,
                scopeQ: debouncedSearch || undefined,
                ...(activeTab === 1 ? { includeDashboardMeta: 1 } : {}),
                ...(scopeStatus ? { scopeStatus } : {}),
            });
            const apiData = res?.data || res;
            const meta = apiData?.meta || {};
            const apiCampaign = apiData?.campaign || res?.campaign || apiData;

            const fallbackAnalytics = {
                managersToEmail: Array.isArray(apiCampaign?.reviewersAssigned)
                    ? apiCampaign.reviewersAssigned.filter((r) => r?.reviewerEmail || r?.email).length : 0,
                usersInScope: Array.isArray(apiData?.scopeData) ? apiData.scopeData.length : 0,
                usersMissingReviewer: 0,
                totalEntitlements: meta?.entitlementsInApplication || 0,
                entitlementsInScope: 0,
                entitlementsNotReviewed: meta?.entitlementsInApplication || 0,
            };

            setFullCampaign({
                ...apiCampaign, meta,
                analytics: apiCampaign?.analytics || meta?.analytics || fallbackAnalytics,
            });

            const rawScope = apiData?.scopeData || apiData?.scope || [];
            const safeScope = Array.isArray(rawScope) ? rawScope : [];
            setServerTotal(Number(meta?.scopedItemsTotal || meta?.scopedItems || safeScope.length || 0));

            const getAppValue = (obj) => {
                if (!obj) return null;
                if (typeof obj === "string") return obj;
                return obj.applicationName || obj.name || obj.appName;
            };
            const campaignAppName = getAppValue(apiCampaign) || "";

            const normalizedScope = safeScope.map((it, idx) => {
                const stableId =
                    coerceReadableText(it.userId) ||
                    coerceReadableText(it.id) ||
                    coerceReadableText(it.itemId) ||
                    coerceReadableText(it._id) ||
                    getItemKey(it) ||
                    `temp_${idx}`;
                const groups = parseGroupsFromMemberOf(it.memberOf || "");

                const entitlementLabels = Array.isArray(it.displayGroupsLabel)
                    ? it.displayGroupsLabel.map((x) => coerceReadableText(x)).filter(Boolean)
                    : Array.isArray(it.entitlements)
                        ? it.entitlements.map((e) => coerceReadableText(e?.name ?? e)).filter(Boolean)
                        : [];

                let displayGroups = entitlementLabels.length > 0 ? entitlementLabels : groups;
                const scopeCategory = String(apiCampaign?.category || campaign?.category || "").toUpperCase();
                const scopeSelectedIds = Array.isArray(apiCampaign?.selectedIds)
                    ? apiCampaign.selectedIds
                    : Array.isArray(campaign?.selectedIds)
                        ? campaign.selectedIds
                        : [];
                if (
                    (scopeCategory === "ACCESS_ITEMS" || scopeCategory === "ROLE_COMPOSITION") &&
                    scopeSelectedIds.length > 0
                ) {
                    const selectedSet = new Set(scopeSelectedIds.map((s) => {
                        const token = coerceReadableText(s);
                        const m = token.match(/^CN=([^,]+)/i);
                        return (m ? m[1] : token).trim().toLowerCase();
                    }));
                    displayGroups = displayGroups.filter((g) => selectedSet.has(coerceReadableText(g).toLowerCase()));
                }

                const rawDisplayList =
                    it.displayAccess && Array.isArray(it.displayAccess) && it.displayAccess.length > 0
                        ? it.displayAccess
                        : displayGroups.length > 0
                            ? displayGroups
                            : it.reviewContext
                                ? [it.reviewContext]
                                : [];
                const displayGroupsLabel = rawDisplayList.map((x) => coerceReadableText(x)).filter(Boolean);

                return {
                    ...it,
                    reviewItemId: it.reviewItemId,
                    reviewItemStatus: it.reviewItemStatus,
                    reviewItemKey: it.reviewItemKey,
                    id: stableId,
                    name: resolveDisplayName(it),
                    email: coerceReadableText(resolveEmail(it) || it.email || ""),
                    targetIds: Array.isArray(it.targetIds) && it.targetIds.length ? it.targetIds : (it.itemId ? [it.itemId] : []),
                    aggregatedDecision: it.aggregatedDecision || it.currentReview?.decision,
                    displayGroupsLabel,
                    applicationName: coerceReadableText(it.applicationName || it.appName || campaignAppName),
                    manager: resolveManager(it) || it.manager || it.managerName || "",
                    managerEmail: resolveManagerEmail(it) || it.managerEmail || "",
                };
            });

            setScopeData(normalizedScope);
            hasScopeDataRef.current = true;
            setReviewState(buildReviewMapFromScopeAndCampaign(apiCampaign, normalizedScope));
        } catch (err) {
            console.error(err);
            if (!hasScopeDataRef.current) setError("Failed to load campaign data.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [campaignId, campaign, page, rowsPerPage, statusFilter, debouncedSearch, activeTab]);

    useEffect(() => {
        if (!open) {
            setDebouncedSearch("");
            return;
        }
        const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 350);
        return () => clearTimeout(timer);
    }, [open, searchTerm]);

    // Seed header stats from the list row while the first fetch runs.
    useEffect(() => {
        if (!open || !campaign) return;
        setFullCampaign((prev) => prev || campaign);
        setServerTotal((prev) => prev || Number(campaign.totalItems) || 0);
    }, [open, campaign]);

    // Reset filters when the dialog opens.
    useEffect(() => {
        if (!open) {
            hasScopeDataRef.current = false;
            return;
        }
        hasScopeDataRef.current = false;
        hasInitializedExpansionRef.current = false;
        hasInitializedIdentityRef.current = false;
        setExpandedReviewerKey(null);
        setExpandedIdentityKey(null);
        setScopeData([]);
        setActiveTab(0);
        setSearchTerm("");
        setDebouncedSearch("");
        setStatusFilter("All");
        setAccessViewMode("ALL");
        setShowWithoutAccess(true);
        setSelectedIds(new Set());
        setEntitlementReviewState(new Map());
        setPage(1);
        setRowsPerPage(DEFAULT_REVIEW_PAGE_SIZE);
        setError(null);
    }, [open, campaignId]);

    // Return to page 1 when filters change (not on dialog open).
    useEffect(() => {
        if (!open) return;
        setPage(1);
        setSelectedIds(new Set());
    }, [searchTerm, statusFilter, rowsPerPage]);

    useEffect(() => {
        if (!open || !campaignId) return;
        const silent = hasScopeDataRef.current;
        fetchCampaignData(silent, silent);
    }, [open, campaignId, page, rowsPerPage, statusFilter, debouncedSearch, activeTab, fetchCampaignData]);

    useEffect(() => {
        if (!open || serverTotal <= 0) return;
        const maxPage = Math.max(1, Math.ceil(serverTotal / clampReviewPageSize(rowsPerPage)));
        if (page > maxPage) setPage(maxPage);
    }, [open, serverTotal, rowsPerPage, page]);

    useEffect(() => {
        if (!open || !campaignId) {
            setCampaignReminderSummary(null);
            return;
        }
        const timer = setTimeout(() => {
            accessCertificationService.getCampaignReminderStatus(campaignId).then((res) => {
                if (res.success) {
                    setCampaignReminderSummary(res.data?.campaignSummary || null);
                }
            });
        }, 400);
        return () => clearTimeout(timer);
    }, [open, campaignId]);

    const hasInFlightRemediation = useMemo(() => {
        if (!scopeData.length) return false;
        for (const item of scopeData) {
            const eds = Array.isArray(item.entitlementDecisions) ? item.entitlementDecisions : [];
            if (eds.length) {
                for (const ed of eds) {
                    const st = String(ed.status || "PENDING").toUpperCase();
                    const decision = entitlementStatusToDecision(st);
                    if (isRemediationInFlight(decision, ed.remediationStatus, ed.provisioningStatus, null, st)) {
                        return true;
                    }
                }
            } else if (
                String(item.reviewItemStatus || item.aggregatedDecision || "").toUpperCase() === "REVOKED"
                && isRemediationInFlight("Revoked", item.remediationStatus, item.provisioningStatus)
            ) {
                return true;
            }
        }
        return false;
    }, [scopeData]);

    useEffect(() => {
        if (!open || !campaignId) {
            setRemediationExecutions([]);
            return;
        }
        fetchRemediationExecutions();
    }, [open, campaignId, fetchRemediationExecutions]);

    const hasRevokedWithWorkflow = useMemo(
        () => hasRevokedWorkflowActivity(scopeData),
        [scopeData],
    );

    useEffect(() => {
        if (!open || !campaignId || !hasRevokedWithWorkflow) return;
        const ms = hasInFlightRemediation ? 8000 : 30000;
        const id = setInterval(fetchRemediationExecutions, ms);
        return () => clearInterval(id);
    }, [open, campaignId, hasRevokedWithWorkflow, hasInFlightRemediation, fetchRemediationExecutions]);

    useEffect(() => {
        if (!open) return;
        const ms = hasInFlightRemediation ? 8000 : 60000;
        const id = setInterval(() => fetchCampaignData(true, false), ms);
        return () => clearInterval(id);
    }, [open, fetchCampaignData, hasInFlightRemediation]);

    useEffect(() => {
        if (!open) return;
        const onVis = () => { if (document.visibilityState === "visible") fetchCampaignData(true, false); };
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
    }, [open, fetchCampaignData]);

    /* ============================================================
       4. Live Stats
       ============================================================ */
    const dashboardStats = useMemo(() => {
        const campaignObj = fullCampaign || campaign;
        const campaignTotal =
            Number(campaignObj?.totalItems) ||
            Number(campaign?.totalItems) ||
            0;

        if (campaignObj && campaignTotal > 0) {
            const total = campaignTotal;
            const approved = Number(campaignObj.approvedItems) || 0;
            const revoked = Number(campaignObj.revokedItems) || 0;
            const pending =
                Number(campaignObj.pendingItems) ||
                Math.max(total - approved - revoked, 0);
            const completed = approved + revoked;
            return {
                total,
                approved,
                revoked,
                pending,
                completed,
                progress: total > 0 ? (completed / total) * 100 : 0,
            };
        }

        const s = { total: 0, approved: 0, revoked: 0, pending: 0, completed: 0, progress: 0 };
        scopeData.forEach(item => {
            const eds = Array.isArray(item.entitlementDecisions) ? item.entitlementDecisions : [];
            if (eds.length > 0) {
                const reviewItemId = String(item.reviewItemId || item._id || item.id || "");
                eds.forEach(ed => {
                    const compositeKey = `${reviewItemId}::${ed.entitlementName}`;
                    const override = entitlementReviewState.get(compositeKey);
                    const status = override?.status || ed.status || "PENDING";
                    s.total++;
                    if (status === "APPROVED") s.approved++;
                    else if (status === "REVOKED" || status === "REVOKE_IN_PROGRESS") s.revoked++;
                    else s.pending++;
                });
            } else {
                const st = getReviewEntryForItem(reviewState, item);
                const decision = st?.decision || "Pending";
                s.total++;
                if (decision === "Approved") s.approved++;
                else if (decision === "Revoked") s.revoked++;
                else s.pending++;
            }
        });
        s.completed = s.approved + s.revoked;
        s.progress = s.total > 0 ? (s.completed / s.total) * 100 : 0;
        return s;
    }, [scopeData, reviewState, entitlementReviewState, fullCampaign, campaign]);

    /* ============================================================
       5. Filter & Pagination
       ============================================================ */
    // Server already filtered by search/status. Keep as a stable alias.
    const filteredData = useMemo(() => scopeData, [scopeData]);

    const pagedData = filteredData;
    const pageCount = Math.max(1, Math.ceil((serverTotal || 0) / rowsPerPage));

    const reviewerGroups = useMemo(() => {
        const groups = new Map();
        const categoryUpper = normalizeCertificationCategoryUpper(
            (fullCampaign || campaign)?.category,
        );
        filteredData.forEach((item) => {
            const entry = getReviewEntryForItem(reviewState, item);
            const key = getReviewerGroupKeyForItem(item, entry, categoryUpper);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        });
        return groups;
    }, [filteredData, reviewState, fullCampaign, campaign]);

    const reviewerGroupEntries = useMemo(() => [...reviewerGroups.entries()], [reviewerGroups]);

    // ── Identity-grouped board ──────────────────────────────────────────────────
    const identityGroups = useMemo(() => {
        const map = new Map();
        const campaignObj = fullCampaign || campaign;
        const backupEmail = String(campaignObj?.backupManagerReviewerEmail || '').toLowerCase().trim();

        for (const item of filteredData) {
            const uid = item.userId || item.id;
            if (!map.has(uid)) {
                // Reviewer info may be at item root (PROFILE scope) OR nested in
                // reviewerSnapshot / entitlementDecisions[0] (IDENTITY scope).
                const snap    = item.reviewerSnapshot || item.entitlementDecisions?.[0] || {};
                const routingMode = String(campaignObj?.reviewerRoutingMode || 'DEFAULT').toUpperCase();
                const useManagerFallback = routingMode === 'DEFAULT';
                const rEmail  = item.reviewerEmail  || item.currentReview?.reviewerEmail || snap.email        || snap.reviewerEmail  || (useManagerFallback ? item.managerEmail : '') || '';
                const rName   = item.reviewerName   || item.currentReview?.reviewerName  || snap.name         || snap.reviewerName   || (useManagerFallback ? (item.manager || item.itemManager) : '') || '';
                const rId     = item.reviewerIdentityId || snap.reviewerId || snap.reviewerIdentityId || null;
                const rSource = item.reviewerType   || snap.source       || '';

                const reviewerEmail = String(rEmail).toLowerCase();
                const reviewerNameTrim = String(rName || '').trim();
                const reviewerEmailTrim = String(rEmail || '').trim();
                const reviewerDisplay =
                    reviewerNameTrim &&
                    reviewerEmailTrim &&
                    reviewerNameTrim.toLowerCase() !== reviewerEmailTrim.toLowerCase()
                        ? `${reviewerNameTrim} · ${reviewerEmailTrim}`
                        : (reviewerNameTrim || reviewerEmailTrim || '—');
                const isBackup =
                    !!backupEmail && reviewerEmail === backupEmail ||
                    rSource === 'BACKUP_MANAGER_EXTERNAL' ||
                    rSource === 'BACKUP_MANAGER_INTERNAL';
                const assignedExternalEmails = new Set(
                    (Array.isArray(campaignObj?.reviewersAssigned) ? campaignObj.reviewersAssigned : [])
                        .filter((r) => String(r?.reviewerType || '').toUpperCase() === 'EXTERNAL')
                        .map((r) => String(r?.email || r?.reviewerEmail || '').toLowerCase())
                        .filter(Boolean),
                );
                const isExternal =
                    rSource === 'EXTERNAL' ||
                    rSource === 'BACKUP_MANAGER_EXTERNAL' ||
                    (routingMode === 'EXTERNAL' && assignedExternalEmails.has(reviewerEmail));
                const isInternal = rSource === 'INTERNAL' || rSource === 'BACKUP_MANAGER_INTERNAL';

                map.set(uid, {
                    identity: item,
                    reviewerLabel: {
                        name:      reviewerDisplay,
                        email:     reviewerEmailTrim,
                        isBackup,
                        typeLabel: isBackup
                            ? (isExternal ? 'Backup (External)' : 'Backup (Internal)')
                            : (isExternal ? 'External' : isInternal ? 'Internal' : 'Manager'),
                        color: isBackup ? '#B45309' : isExternal ? '#6D28D9' : '#065F46',
                    },
                    byApp:    new Map(),
                    allItems: [],
                });
            }
            const group  = map.get(uid);
            group.allItems.push(item);
            const appKey = item.applicationName || item.itemApplicationName || item.entitlementSnapshot?.applicationName || 'Other';
            if (!group.byApp.has(appKey)) group.byApp.set(appKey, []);
            group.byApp.get(appKey).push(item);
        }
        return map;
    }, [filteredData, fullCampaign, campaign]);

    const identityGroupEntries = useMemo(() => [...identityGroups.entries()], [identityGroups]);

    const accessSplit = useMemo(() => {
        const withAccess = [];
        const withoutAccess = [];
        for (const [uid, group] of identityGroupEntries) {
            const items = Array.isArray(group?.allItems) ? group.allItems : [];
            const hasAccess = items.some((it) => {
                const t = String(it?.reviewItemType || "").toUpperCase();
                if (t === "NO_ACCESS") return false;
                const eds = Array.isArray(it?.entitlementDecisions) ? it.entitlementDecisions : [];
                const access = Array.isArray(it?.itemAccessDetails) ? it.itemAccessDetails : Array.isArray(it?.displayGroupsLabel) ? it.displayGroupsLabel : [];
                return eds.length > 0 || access.length > 0;
            });
            if (hasAccess) withAccess.push([uid, group]);
            else withoutAccess.push([uid, group]);
        }
        return { withAccess, withoutAccess };
    }, [identityGroupEntries]);

    useEffect(() => {
        if (identityGroupEntries.length === 0) {
            setExpandedIdentityKey(null);
            hasInitializedIdentityRef.current = false;
            return;
        }
        if (!hasInitializedIdentityRef.current && expandedIdentityKey === null) {
            setExpandedIdentityKey(identityGroupEntries[0][0]);
            hasInitializedIdentityRef.current = true;
        }
    }, [identityGroupEntries, expandedIdentityKey]);

    useEffect(() => {
        if (reviewerGroupEntries.length === 0) {
            setExpandedReviewerKey(null);
            hasInitializedExpansionRef.current = false;
            return;
        }
        const hasExpanded = reviewerGroupEntries.some(([email]) => email === expandedReviewerKey);
        if (!hasInitializedExpansionRef.current && expandedReviewerKey === null) {
            setExpandedReviewerKey(reviewerGroupEntries[0][0]);
            hasInitializedExpansionRef.current = true;
        } else if (expandedReviewerKey !== null && !hasExpanded) {
            setExpandedReviewerKey(reviewerGroupEntries[0][0]);
        }
        const validKeys = new Set(reviewerGroupEntries.map(([email]) => email));
        setReviewerPages((prev) => {
            const next = {};
            Object.entries(prev).forEach(([key, value]) => { if (validKeys.has(key)) next[key] = value; });
            if (Object.keys(next).length === Object.keys(prev).length) {
                let same = true;
                for (const k of Object.keys(prev)) { if (prev[k] !== next[k]) { same = false; break; } }
                if (same) return prev;
            }
            return next;
        });
    }, [reviewerGroupEntries, expandedReviewerKey]);

    /* ============================================================
       6. Action Handlers
       ============================================================ */
    const submitDecision = async (item, decision, comment, remediationWorkflowId = null) => {
        const itemId = item?.id || item;
        const targetIds = item?.reviewItemKey
            ? [item.reviewItemKey]
            : item?.targetIds?.length ? item.targetIds : [itemId];
        const ts = new Date().toISOString();

        setReviewState(prev => {
            const copy = new Map(prev);
            const existing = copy.get(itemId) || { itemId };
            copy.set(itemId, { ...existing, decision, comment, reviewedAt: ts, reviewerName: currentReviewerName });
            return copy;
        });

        try {
            const apiResult = await accessCertificationService.api.updateReviewDecision(campaignId, {
                itemIds: targetIds,
                decision,
                comment,
                reviewerName: currentReviewerName,
                ...(remediationWorkflowId ? { remediationWorkflowId } : {}),
            });
            const updatedCampaign = apiResult?.data?.data;
            if (updatedCampaign && scopeData.length) {
                setReviewState(buildReviewMapFromScopeAndCampaign(updatedCampaign, scopeData));
            }
            await fetchCampaignData(true, false);
            fetchRemediationExecutions();
        } catch (err) {
            console.error(err);
            fetchCampaignData();
            setSnackbar({ open: true, message: "Save failed. Reverting..." });
        }
    };

    const handleModalSubmit = (comment) => {
        setModalOpen(false);
        if (!currentItem || !currentDecision) {
            setCurrentItem(null);
            setCurrentDecision(null);
            return;
        }
        if (currentDecision === "Revoked") {
            setPendingRevoke({
                type: currentItem._entitlementName ? "entitlement" : "single",
                item: currentItem,
                entitlementName: currentItem._entitlementName || null,
                comment,
            });
            setRevokeWorkflowError("");
            setRevokeWorkflowOpen(true);
            setCurrentItem(null);
            setCurrentDecision(null);
            return;
        }
        if (currentItem._entitlementName) {
            submitEntitlementDecision(currentItem, currentItem._entitlementName, currentDecision, comment);
        } else {
            submitDecision(currentItem, currentDecision, comment);
        }
        setCurrentItem(null);
        setCurrentDecision(null);
    };

    const executePendingRevoke = async (workflowId) => {
        if (!pendingRevoke) return;
        setRevokeWorkflowSubmitting(true);
        setRevokeWorkflowError("");
        try {
            const { type, item, entitlementName, comment, bulkEntitlementKeys, bulkItemLevelIds, identityBulkItems } =
                pendingRevoke;

            if (type === "entitlement") {
                await submitEntitlementDecision(item, entitlementName, "Revoked", comment, workflowId);
            } else if (type === "single") {
                await submitDecision(item, "Revoked", comment, workflowId);
            } else if (type === "bulk") {
                if (bulkEntitlementKeys?.length) {
                    await Promise.all(
                        bulkEntitlementKeys.map((key) => {
                            const sepIdx = key.indexOf("::");
                            const reviewItemId = key.slice(0, sepIdx);
                            const entName = key.slice(sepIdx + 2);
                            return accessCertificationService.api.applyEntitlementDecision(
                                campaignId,
                                reviewItemId,
                                entName,
                                "Revoked",
                                "",
                                currentReviewerName,
                                workflowId,
                            );
                        }),
                    );
                }
                if (bulkItemLevelIds?.length) {
                    const targetIds = Array.from(
                        new Set(
                            bulkItemLevelIds.flatMap((id) => {
                                const row = scopeData.find((i) => i.id === id);
                                if (row?.reviewItemKey) return [row.reviewItemKey];
                                if (row?.targetIds?.length) return row.targetIds;
                                return [id];
                            }),
                        ),
                    );
                    await accessCertificationService.api.updateReviewDecision(campaignId, {
                        itemIds: targetIds,
                        decision: "Revoked",
                        reviewerName: currentReviewerName,
                        remediationWorkflowId: workflowId,
                    });
                }
                await fetchCampaignData(true, false);
                fetchRemediationExecutions();
                setSnackbar({
                    open: true,
                    message: `Bulk Revoked: ${(bulkEntitlementKeys?.length || 0) + (bulkItemLevelIds?.length || 0)} item(s) updated.`,
                });
            } else if (type === "identityBulk" && identityBulkItems?.length) {
                const targetIds = [
                    ...new Set(
                        identityBulkItems.flatMap((row) => {
                            if (row.reviewItemKey) return [row.reviewItemKey];
                            if (row.targetIds?.length) return row.targetIds;
                            return [row.id];
                        }),
                    ),
                ];
                await accessCertificationService.api.updateReviewDecision(campaignId, {
                    itemIds: targetIds,
                    decision: "Revoked",
                    reviewerName: currentReviewerName,
                    remediationWorkflowId: workflowId,
                });
                await fetchCampaignData(true, false);
                fetchRemediationExecutions();
                setSnackbar({
                    open: true,
                    message: `Revoked ${identityBulkItems.length} item${identityBulkItems.length !== 1 ? "s" : ""}.`,
                });
            }
            setRevokeWorkflowOpen(false);
            setPendingRevoke(null);
            await fetchCampaignData(true, false);
            fetchRemediationExecutions();
        } catch (err) {
            console.error(err);
            setRevokeWorkflowError(err?.response?.data?.message || err?.message || "Failed to queue revoke.");
            throw err;
        } finally {
            setRevokeWorkflowSubmitting(false);
        }
    };

    const revokeWorkflowRecordLabel = useMemo(() => {
        if (!pendingRevoke) return "—";
        const { type, item, entitlementName, bulkEntitlementKeys, bulkItemLevelIds, identityBulkItems } =
            pendingRevoke;
        if (type === "entitlement" && item) {
            return `${item?.name || item?.displayName || "User"} · ${entitlementName || "access"}`;
        }
        if (type === "single" && item) {
            return item?.name || item?.displayName || "Certification item";
        }
        if (type === "bulk") {
            const count = (bulkEntitlementKeys?.length || 0) + (bulkItemLevelIds?.length || 0);
            return `${count} selected entitlement${count === 1 ? "" : "s"}`;
        }
        if (type === "identityBulk") {
            const count = identityBulkItems?.length || 0;
            return `${count} pending item${count === 1 ? "" : "s"}`;
        }
        return "Certification revoke";
    }, [pendingRevoke]);

    const handleBulkSubmit = async (decision) => {
        if (selectedIds.size === 0) return;
        const ids = Array.from(selectedIds);
        const count = ids.length;

        if (decision === "Revoked") {
            const entitlementKeys = ids.filter((id) => id.includes("::"));
            const itemLevelIds = ids.filter((id) => !id.includes("::"));
            setPendingRevoke({
                type: "bulk",
                bulkEntitlementKeys: entitlementKeys,
                bulkItemLevelIds: itemLevelIds,
                comment: "",
            });
            setRevokeWorkflowError("");
            setRevokeWorkflowOpen(true);
            setSelectedIds(new Set());
            return;
        }

        const ts = new Date().toISOString();

        const entitlementKeys = ids.filter(id => id.includes("::"));
        const itemLevelIds = ids.filter(id => !id.includes("::"));

        // Optimistic update
        if (entitlementKeys.length > 0) {
            const entryStatus = decision === "Revoked" ? "REVOKED" : "APPROVED";
            setEntitlementReviewState(prev => {
                const copy = new Map(prev);
                entitlementKeys.forEach(k => copy.set(k, { status: entryStatus, decision, reviewedAt: ts }));
                return copy;
            });
        }
        if (itemLevelIds.length > 0) {
            setReviewState(prev => {
                const copy = new Map(prev);
                itemLevelIds.forEach(id => {
                    const existing = copy.get(id) || { itemId: id };
                    copy.set(id, { ...existing, decision, reviewedAt: ts, reviewerName: currentReviewerName });
                });
                return copy;
            });
        }

        setSelectedIds(new Set());

        try {
            if (entitlementKeys.length > 0) {
                await Promise.all(
                    entitlementKeys.map(key => {
                        const sepIdx = key.indexOf("::");
                        const reviewItemId = key.slice(0, sepIdx);
                        const entitlementName = key.slice(sepIdx + 2);
                        return accessCertificationService.api.applyEntitlementDecision(
                            campaignId, reviewItemId, entitlementName, decision, "", currentReviewerName,
                        );
                    }),
                );
            }
            if (itemLevelIds.length > 0) {
                const targetIds = Array.from(new Set(itemLevelIds.flatMap(id => {
                    const item = scopeData.find(i => i.id === id);
                    if (item?.reviewItemKey) return [item.reviewItemKey];
                    if (item?.targetIds?.length) return item.targetIds;
                    return [id];
                })));
                await accessCertificationService.api.updateReviewDecision(campaignId, {
                    itemIds: targetIds, decision, reviewerName: currentReviewerName,
                });
            }
            await fetchCampaignData(true, false);
            setSnackbar({ open: true, message: `Bulk ${decision}: ${count} item${count !== 1 ? 's' : ''} updated.` });
        } catch (err) {
            console.error(err);
            fetchCampaignData();
            setSnackbar({ open: true, message: "Bulk action failed." });
        }
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const newSet = new Set(selectedIds);
            pagedData.forEach(i => {
                const st = getReviewEntryForItem(reviewState, i);
                if (!st || st.decision === "Pending") newSet.add(i.id);
            });
            setSelectedIds(newSet);
        } else {
            const newSet = new Set(selectedIds);
            pagedData.forEach(i => newSet.delete(i.id));
            setSelectedIds(newSet);
        }
    };

    const handleSelectOne = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        setSelectedIds(newSet);
    };

    const submitEntitlementDecision = async (item, entitlementName, decision, comment, remediationWorkflowId = null) => {
        const reviewItemId = String(item.reviewItemId || item._id || item.id || "");
        const compositeKey = `${reviewItemId}::${entitlementName}`;
        const entryStatus = decision === "Revoked" ? "REVOKE_IN_PROGRESS" : "APPROVED";
        const ts = new Date().toISOString();

        setEntitlementReviewState(prev => {
            const copy = new Map(prev);
            copy.set(compositeKey, {
                status: entryStatus,
                decision,
                comment,
                reviewedAt: ts,
                remediationStatus: decision === "Revoked" ? "REVOKE_IN_PROGRESS" : null,
                provisioningStatus: decision === "Revoked" ? "PENDING" : "EXECUTED",
            });
            return copy;
        });

        try {
            await accessCertificationService.api.applyEntitlementDecision(
                campaignId, reviewItemId, entitlementName, decision, comment, currentReviewerName,
                remediationWorkflowId,
            );
            await fetchCampaignData(true, false);
            fetchRemediationExecutions();
        } catch (err) {
            console.error(err);
            setEntitlementReviewState(prev => {
                const copy = new Map(prev);
                copy.delete(compositeKey);
                return copy;
            });
            setSnackbar({ open: true, message: "Save failed. Reverting..." });
            fetchCampaignData();
        }
    };

    const handleIdentityBulkDecision = async (pendingItems, decision) => {
        if (!pendingItems.length) return;
        if (decision === "Revoked") {
            setPendingRevoke({
                type: "identityBulk",
                identityBulkItems: pendingItems,
                comment: "",
            });
            setRevokeWorkflowError("");
            setRevokeWorkflowOpen(true);
            return;
        }
        const ts = new Date().toISOString();
        setReviewState(prev => {
            const copy = new Map(prev);
            pendingItems.forEach(item => {
                const existing = copy.get(item.id) || { itemId: item.id };
                copy.set(item.id, { ...existing, decision, reviewedAt: ts, reviewerName: currentReviewerName });
            });
            return copy;
        });
        try {
            const targetIds = [...new Set(pendingItems.flatMap(item => {
                if (item.reviewItemKey) return [item.reviewItemKey];
                if (item.targetIds?.length) return item.targetIds;
                return [item.id];
            }))];
            await accessCertificationService.api.updateReviewDecision(campaignId, {
                itemIds: targetIds, decision, reviewerName: currentReviewerName,
            });
            await fetchCampaignData(true, false);
            setSnackbar({ open: true, message: `${decision} ${pendingItems.length} item${pendingItems.length !== 1 ? 's' : ''}.` });
        } catch (err) {
            console.error(err);
            fetchCampaignData();
            setSnackbar({ open: true, message: 'Bulk action failed.' });
        }
    };

    const handleExportCSV = () => {
        try {
            if (!scopeData.length) return;
            const headers = ["Name", "Email", "Application", "Access", "Status", "Reviewer", "Date", "Comment"];
            const esc = (t) => {
                const s = coerceReadableText(t);
                return `"${s.replace(/"/g, '""')}"`;
            };
            const rows = scopeData.flatMap(item => {
                const eds = Array.isArray(item.entitlementDecisions) ? item.entitlementDecisions : [];
                if (eds.length > 0) {
                    const reviewItemId = String(item.reviewItemId || item._id || item.id || "");
                    return eds.map(ed => {
                        const override = entitlementReviewState.get(`${reviewItemId}::${ed.entitlementName}`);
                        const status = override?.status || ed.status || "PENDING";
                        const decision = entitlementStatusToDecision(status);
                        return [
                            esc(resolveDisplayName(item)), esc(resolveEmail(item) || item.email),
                            esc(ed.applicationName || item.applicationName), esc(ed.entitlementName),
                            esc(decision), esc(item.reviewerEmail || ""),
                            esc(ed.reviewedAt ? new Date(ed.reviewedAt).toLocaleDateString() : ""),
                            esc(ed.comment || ""),
                        ].join(",");
                    });
                }
                const st = getReviewEntryForItem(reviewState, item);
                return [[
                    esc(resolveDisplayName(item)), esc(resolveEmail(item) || item.email), esc(item.applicationName),
                    esc(item.displayGroupsLabel ? item.displayGroupsLabel.join("; ") : ""),
                    esc(st.decision || "Pending"), esc(st.reviewerName || ""),
                    esc(st.reviewedAt ? new Date(st.reviewedAt).toLocaleDateString() : ""),
                    esc(st.comment || ""),
                ].join(",")];
            });
            const csv = [headers.join(","), ...rows].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `campaign_export_${campaignId}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (e) {
            console.error(e);
            setSnackbar({ open: true, message: "Export failed" });
        }
    };

    /* ============================================================
       7. Render
       ============================================================ */
    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth={false}
            PaperProps={{
                sx: {
                    position: { xs: "relative", md: "absolute" },
                    left: { xs: "auto", md: "260px" },
                    top: { xs: "auto", md: "74px" },
                    width: { xs: "calc(100% - 24px)", md: "calc(100% - 300px)" },
                    maxWidth: "none",
                    height: { xs: "92vh", md: "calc(100vh - 100px)" },
                    m: { xs: 1.5, md: 0 },
                    borderRadius: 3,
                    // FIX 1: overflow hidden on the Paper so flex children own their scroll
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                }
            }}
        >
            {/* --- HEADER --- */}
            <DialogTitle sx={{ bgcolor: "#fff", borderBottom: "1px solid #eee", px: 3, py: 2, flexShrink: 0 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Box>
                        <Button
                            variant="text"
                            startIcon={<ArrowBack fontSize="small" />}
                            onClick={onClose}
                            sx={{ px: 0, mb: 0.75, textTransform: 'none', fontWeight: 700 }}
                        >
                            Back to Campaigns
                        </Button>
                        <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                            Review Campaign: {campaign?.name}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
                            <Typography variant="caption" sx={{ fontWeight: 600, color: '#374151', fontSize: '0.72rem' }}>
                                {getCategoryLabel(
                                    (fullCampaign || campaign)?.category,
                                    (fullCampaign || campaign)?.accessFilter,
                                )}
                            </Typography>
                            <Typography variant="caption" color="text.disabled">·</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.72rem' }}>
                                Due: {formatDate(campaign?.dueDate)}
                            </Typography>
                        </Box>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <Box sx={{ textAlign: 'right', mr: 2, display: { xs: 'none', md: 'block' } }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, minWidth: 140 }}>
                                <Chip
                                    label={campaign?.status || "Draft"}
                                    size="small"
                                    sx={{
                                        height: 20, fontSize: '0.65rem', fontWeight: 700, borderRadius: '4px',
                                        bgcolor: campaign?.status === 'Active' ? '#F0FDF4' : campaign?.status === 'Completed' ? '#EFF6FF' : '#F9FAFB',
                                        color: campaign?.status === 'Active' ? '#166534' : campaign?.status === 'Completed' ? '#1E3A5F' : '#6B7280',
                                        border: `1px solid ${campaign?.status === 'Active' ? '#BBF7D0' : campaign?.status === 'Completed' ? '#BFDBFE' : '#E5E7EB'}`,
                                    }}
                                />
                                <Typography variant="caption" fontWeight="700" color="text.primary">
                                    {dashboardStats.completed} <span style={{ color: '#999', fontWeight: 400 }}>/ {dashboardStats.total}</span>
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <LinearProgress
                                    variant="determinate"
                                    value={dashboardStats.progress}
                                    sx={{
                                        width: 140, height: 6, borderRadius: 4, bgcolor: '#E5E7EB',
                                        '& .MuiLinearProgress-bar': {
                                            borderRadius: 4,
                                            backgroundColor: dashboardStats.progress === 100 ? '#166534' : '#374151'
                                        }
                                    }}
                                />
                                <Typography variant="caption" fontWeight="bold" color="text.primary" sx={{ minWidth: 35, textAlign: 'right' }}>
                                    {Math.round(dashboardStats.progress)}%
                                </Typography>
                            </Box>
                        </Box>

                        <Box sx={{ display: { xs: 'none', lg: 'flex' }, gap: 0.75, mr: 1 }}>
                            <Chip size="small" label={`Pending ${dashboardStats.pending}`}
                                sx={{ fontSize: '0.7rem', fontWeight: 600, height: 22, bgcolor: '#FFFBEB', color: '#78350F', border: '1px solid #FDE68A' }} />
                            <Chip size="small" label={`Approved ${dashboardStats.approved}`}
                                sx={{ fontSize: '0.7rem', fontWeight: 600, height: 22, bgcolor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }} />
                            <Chip size="small" label={`Revoked ${dashboardStats.revoked}`}
                                sx={{ fontSize: '0.7rem', fontWeight: 600, height: 22, bgcolor: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }} />
                        </Box>

                        <Divider orientation="vertical" flexItem sx={{ height: 32, alignSelf: 'center', mx: 1 }} />

                        <Tooltip title={refreshing ? "Refreshing…" : "Refresh decisions"}>
                            <Box component="span" sx={{ display: "inline-flex" }}>
                                <IconButton size="small" onClick={() => fetchCampaignData(true, true)} disabled={loading || refreshing}
                                    sx={{ color: refreshing ? '#374151' : '#9CA3AF' }}>
                                    <RefreshIcon fontSize="small" sx={{
                                        animation: refreshing ? 'spin 1s linear infinite' : 'none',
                                        '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } }
                                    }} />
                                </IconButton>
                            </Box>
                        </Tooltip>
                        <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={handleExportCSV} sx={{ textTransform: 'none' }}>
                            Export
                        </Button>
                        <Button variant="contained" size="small" onClick={onClose} color="inherit"
                            sx={{ bgcolor: '#f1f5f9', color: '#475569', textTransform: 'none', boxShadow: 'none', '&:hover': { bgcolor: '#e2e8f0' } }}>
                            Close
                        </Button>
                    </Box>
                </Box>
            </DialogTitle>

            {/* FIX 2: DialogContent must NOT have overflow:auto itself — let inner Box handle scroll */}
            <DialogContent
                sx={{
                    p: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    overflow: 'hidden',   // ← critical: contain the scroll inside children
                    bgcolor: "#F8FAFC",
                }}
            >
                {/* Inner padding wrapper */}
                <Box sx={{ px: 3, pt: 2.5, pb: 0, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', gap: 1.5 }}>

                    {/* --- TABS & FILTERS --- */}
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: 'wrap', gap: 1.5, flexShrink: 0 }}>
                        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ minHeight: 30 }}>
                            <Tab label="Review Items" icon={<ListIcon fontSize="small" />} iconPosition="start" />
                            <Tab label="Dashboard" icon={<DashboardIcon fontSize="small" />} iconPosition="start" />
                            <Tab label="Notifications" icon={<NotificationsIcon fontSize="small" />} iconPosition="start" />
                        </Tabs>

                        {activeTab === 1 && fullCampaign?.analytics?.noAccess && (
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                                <Chip size="small" variant="outlined" label={`Total identities: ${fullCampaign.analytics.noAccess.totalIdentities}`} sx={{ height: 34 }} />
                                <Chip size="small" variant="outlined" label={`With access: ${fullCampaign.analytics.noAccess.withAccess}`} sx={{ height: 34 }} />
                                <Chip size="small" variant="outlined" label={`Without access: ${fullCampaign.analytics.noAccess.withoutAccess}`} sx={{ height: 34 }} />
                                <Chip size="small" variant="outlined" label={`Pending review: ${fullCampaign.analytics.noAccess.pendingReview}`} sx={{ height: 34 }} />
                            </Box>
                        )}

                        {activeTab === 0 && (
                            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                                <Chip
                                    label={`${serverTotal || filteredData.length} in scope`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ height: 34 }}
                                />
                                <ToggleButtonGroup
                                    size="small"
                                    exclusive
                                    value={accessViewMode}
                                    onChange={(_, v) => { if (v) setAccessViewMode(v); }}
                                    sx={{ bgcolor: '#fff', height: 34 }}
                                >
                                    <ToggleButton value="ALL" sx={{ textTransform: 'none', fontWeight: 700 }}>
                                        All
                                    </ToggleButton>
                                    <ToggleButton value="WITH_ACCESS" sx={{ textTransform: 'none', fontWeight: 700 }}>
                                        With access
                                    </ToggleButton>
                                    <ToggleButton value="WITHOUT_ACCESS" sx={{ textTransform: 'none', fontWeight: 700 }}>
                                        Without access
                                    </ToggleButton>
                                </ToggleButtonGroup>
                                <TextField
                                    select
                                    label="Per page"
                                    size="small"
                                    value={rowsPerPage}
                                    onChange={(e) => {
                                        setRowsPerPage(Number(e.target.value));
                                        setPage(1);
                                    }}
                                    sx={{ width: 120, bgcolor: '#fff' }}
                                >
                                    {REVIEW_PAGE_SIZE_OPTIONS.map((n) => (
                                        <MenuItem key={n} value={n}>
                                            {n >= REVIEW_BOARD_MAX_PAGE_SIZE ? "All" : n}
                                        </MenuItem>
                                    ))}
                                </TextField>
                                <TextField
                                    select label="Filter Status" size="small"
                                    value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                                    sx={{ width: 150, bgcolor: '#fff' }}
                                >
                                    <MenuItem value="All">All Items</MenuItem>
                                    <MenuItem value="Pending">Pending</MenuItem>
                                    <MenuItem value="Reviewed">Reviewed</MenuItem>
                                </TextField>
                                <TextField
                                    placeholder="Search..." size="small"
                                    value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                                    sx={{ width: 220, bgcolor: '#fff' }}
                                    InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                                />
                                <Button size="small" variant="text"
                                    onClick={() => {
                                        setSearchTerm("");
                                        setStatusFilter("All");
                                        setAccessViewMode("ALL");
                                        setShowWithoutAccess(true);
                                        setPage(1);
                                        setRowsPerPage(DEFAULT_REVIEW_PAGE_SIZE);
                                    }}
                                    sx={{ textTransform: 'none' }}>
                                    Clear
                                </Button>
                            </Box>
                        )}
                    </Box>

                    {formatReminderSummary(campaignReminderSummary) && (
                        <Alert severity="info" sx={{ flexShrink: 0, py: 0.25, fontSize: "0.78rem" }}>
                            Last reminder sent: <strong>{formatReminderSummary(campaignReminderSummary)}</strong>
                            {campaignReminderSummary.recipientEmail
                                ? ` · ${campaignReminderSummary.recipientEmail}`
                                : ""}
                        </Alert>
                    )}

                    {/* --- TAB 0: REVIEWER-GROUPED REVIEW --- */}
                    {activeTab === 0 && (
                        // FIX 3: This wrapper must be flex column with overflow hidden so the scroll box works
                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', gap: 0 }}>

                            {refreshing && <LinearProgress sx={{ height: 2, borderRadius: 0, mb: 0.5, flexShrink: 0 }} />}

                            {loading && scopeData.length === 0 && (
                                <Box sx={{ flex: 1, overflowY: "auto", py: 0.5, pr: 0.25 }}>
                                    <ReviewItemSkeletonList
                                        count={Math.min(
                                            serverTotal || Number(campaign?.totalItems) || rowsPerPage,
                                            rowsPerPage,
                                        )}
                                    />
                                </Box>
                            )}

                            {(!loading || scopeData.length > 0) && (
                            <>

                            {/* BULK ACTIONS BAR */}
                            <Box sx={{ flexShrink: 0 }}>
                                <Collapse in={selectedIds.size > 0}>
                                    <Box
                                        sx={{
                                            bgcolor: '#FFFFFF',
                                            border: '1px solid #DDE6F2',
                                            borderRadius: 2,
                                            p: 1, px: 1.5,
                                            mb: 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            boxShadow: '0 6px 18px rgba(15, 23, 42, 0.05)',
                                        }}
                                    >
                                        <Typography variant="body2" sx={{ color: '#334155', fontWeight: 700 }}>
                                            {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected
                                        </Typography>
                                        <Box sx={{ display: 'flex', gap: 1 }}>
                                            <Button size="small" variant="outlined" onClick={() => handleBulkSubmit("Approved")}
                                                sx={{ textTransform: 'none', borderColor: '#166534', color: '#166534', '&:hover': { bgcolor: '#F0FDF4', borderColor: '#166534' } }}>
                                                Approve Selected
                                            </Button>
                                            <Button size="small" variant="outlined" onClick={() => handleBulkSubmit("Revoked")}
                                                sx={{ textTransform: 'none', borderColor: '#991B1B', color: '#991B1B', '&:hover': { bgcolor: '#FEF2F2', borderColor: '#991B1B' } }}>
                                                Revoke Selected
                                            </Button>
                                            <Button size="small" variant="text" startIcon={<CloseIcon />} onClick={() => setSelectedIds(new Set())}
                                                sx={{ textTransform: 'none', color: '#6B7280' }}>
                                                Cancel
                                            </Button>
                                        </Box>
                                    </Box>
                                </Collapse>
                            </Box>

                            {/* FIX 4: REVIEWER GROUPS SCROLL CONTAINER — flex:1 + overflowY:auto is the scroll root */}
                            <Box
                                ref={reviewScrollRef}
                                sx={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    overflowX: 'hidden',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 1,
                                    pb: 2,
                                    pr: 0.25,
                                    scrollbarWidth: 'thin',
                                    scrollbarColor: '#94A3B8 #E2E8F0',
                                    '&::-webkit-scrollbar': { width: 8 },
                                    '&::-webkit-scrollbar-track': { background: '#E2E8F0', borderRadius: 8 },
                                    '&::-webkit-scrollbar-thumb': { background: '#94A3B8', borderRadius: 8 },
                                }}
                            >
                                {filteredData.length === 0 ? (
                                    <Paper elevation={0} sx={{ border: '1px solid #E2E8F0', borderRadius: 2.5, p: 5, textAlign: 'center', bgcolor: '#FFFFFF' }}>
                                        <PersonOutlineIcon sx={{ fontSize: 40, color: '#94A3B8', mb: 1 }} />
                                        <Typography variant="body2" sx={{ color: '#334155', fontWeight: 600 }}>No review items match your current filters.</Typography>
                                        <Typography variant="caption" sx={{ color: '#64748B' }}>Try clearing filters or search.</Typography>
                                    </Paper>
                                ) : (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        {(accessViewMode === "ALL" || accessViewMode === "WITH_ACCESS") && (
                                            <>
                                                <Box sx={{ px: 0.5, pt: 0.5 }}>
                                                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: '#0F172A' }}>
                                                        Users with Access ({accessSplit.withAccess.length})
                                                    </Typography>
                                                </Box>
                                                {accessSplit.withAccess.map(([uid, group], groupIndex) => (
                                                    <IdentityCard
                                                        key={uid}
                                                        uid={uid}
                                                        group={group}
                                                        groupIndex={groupIndex}
                                                        isExpanded={expandedIdentityKey === uid}
                                                        onToggle={() => setExpandedIdentityKey(prev => prev === uid ? null : uid)}
                                                        reviewState={reviewState}
                                                        entitlementReviewState={entitlementReviewState}
                                                        getReviewEntryForItem={getReviewEntryForItem}
                                                        onApproveItem={(item, decision, comment) => submitDecision(item, decision, comment)}
                                                        onRevokeItem={(item) => { setCurrentItem(item); setCurrentDecision('Revoked'); setModalOpen(true); }}
                                                        onExceptionItem={(item) => { setCurrentItem(item); setCurrentDecision('Exception'); setModalOpen(true); }}
                                                        onApproveEntitlement={(item, entName, decision, comment) => submitEntitlementDecision(item, entName, decision, comment)}
                                                        onRevokeEntitlement={(item, entName) => { setCurrentItem({ ...item, _entitlementName: entName }); setCurrentDecision('Revoked'); setModalOpen(true); }}
                                                        onBulkDecision={handleIdentityBulkDecision}
                                                        campaign={fullCampaign || campaign}
                                                        formatDate={formatDate}
                                                        getExecutionForRow={getExecutionForRow}
                                                    />
                                                ))}
                                            </>
                                        )}

                                        {(accessViewMode === "ALL") && <Divider sx={{ my: 1 }} />}

                                        {(accessViewMode === "ALL" || accessViewMode === "WITHOUT_ACCESS") && (
                                            <>
                                                <Box sx={{ px: 0.5, pt: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                                                    <Box>
                                                        <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: '#0F172A' }}>
                                                            Users without Access ({accessSplit.withoutAccess.length})
                                                        </Typography>
                                                        <Typography variant="caption" sx={{ color: '#64748B' }}>
                                                            These identities have no access items. They are routed to the manager (or backup manager) for review.
                                                        </Typography>
                                                    </Box>
                                                    {accessViewMode === "ALL" && (
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            onClick={() => setShowWithoutAccess((v) => !v)}
                                                            sx={{ textTransform: 'none' }}
                                                        >
                                                            {showWithoutAccess ? 'Hide' : 'Show'}
                                                        </Button>
                                                    )}
                                                </Box>
                                                {(accessViewMode === "WITHOUT_ACCESS" || showWithoutAccess) && accessSplit.withoutAccess.map(([uid, group], idx) => (
                                                    <IdentityCard
                                                        key={uid}
                                                        uid={uid}
                                                        group={group}
                                                        groupIndex={accessSplit.withAccess.length + idx}
                                                        isExpanded={expandedIdentityKey === uid}
                                                        onToggle={() => setExpandedIdentityKey(prev => prev === uid ? null : uid)}
                                                        reviewState={reviewState}
                                                        entitlementReviewState={entitlementReviewState}
                                                        getReviewEntryForItem={getReviewEntryForItem}
                                                        onApproveItem={(item, decision, comment) => submitDecision(item, decision, comment)}
                                                        onRevokeItem={(item) => { setCurrentItem(item); setCurrentDecision('Revoked'); setModalOpen(true); }}
                                                        onExceptionItem={(item) => { setCurrentItem(item); setCurrentDecision('Exception'); setModalOpen(true); }}
                                                        onApproveEntitlement={(item, entName, decision, comment) => submitEntitlementDecision(item, entName, decision, comment)}
                                                        onRevokeEntitlement={(item, entName) => { setCurrentItem({ ...item, _entitlementName: entName }); setCurrentDecision('Revoked'); setModalOpen(true); }}
                                                        onBulkDecision={handleIdentityBulkDecision}
                                                        campaign={fullCampaign || campaign}
                                                        formatDate={formatDate}
                                                        getExecutionForRow={getExecutionForRow}
                                                        disableNoAccessActions={true}
                                                    />
                                                ))}
                                            </>
                                        )}
                                    </Box>
                                )}

                                {/* Pagination — single control at bottom of the list */}
                                {(serverTotal > 0 || scopeData.length > 0) && (
                                <ReviewBoardPaginationBar
                                    page={page}
                                    pageCount={pageCount}
                                    serverTotal={serverTotal}
                                    rowsPerPage={rowsPerPage}
                                    onPageChange={handleChangePage}
                                    sx={{
                                        borderTop: "1px solid #E2E8F0",
                                        flexShrink: 0,
                                        mt: 0.5,
                                        bgcolor: "#FFFFFF",
                                        borderRadius: 2,
                                        px: 1.5,
                                    }}
                                />
                                )}
                            </Box>
                            </>
                            )}
                        </Box>
                    )}

                    {/* --- TAB 1: DASHBOARD --- */}
                    {activeTab === 1 && (
                        <Box sx={{ flex: 1, overflowY: 'auto' }}>
                            {loading && !fullCampaign ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 6 }}>
                                    <CircularProgress size={28} />
                                </Box>
                            ) : (
                            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', mt: 5 }}><CircularProgress /></Box>}>
                                <AccessCertificationDashboard
                                    campaign={fullCampaign || campaign}
                                    onRefresh={() => setRefreshing(true)}
                                />
                            </Suspense>
                            )}
                        </Box>
                    )}

                    {/* --- TAB 2: NOTIFICATIONS --- */}
                    {activeTab === 2 && (
                        <Box sx={{ flex: 1, overflowY: 'auto', px: 0.5 }}>
                            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={28} /></Box>}>
                                <ReviewNotifications
                                    active={activeTab === 2}
                                    campaign={fullCampaign || campaign}
                                    onRefresh={() => fetchCampaignData(true, true)}
                                />
                            </Suspense>
                        </Box>
                    )}
                </Box>
            </DialogContent>

            <Suspense fallback={null}>
                <ReviewDecisionModal
                    open={modalOpen}
                    onClose={() => setModalOpen(false)}
                    onSubmit={handleModalSubmit}
                    item={currentItem}
                    decision={currentDecision}
                />
                <QueueFirstRemediationModal
                    open={revokeWorkflowOpen}
                    onClose={() => {
                        setRevokeWorkflowOpen(false);
                        setPendingRevoke(null);
                        setRevokeWorkflowError("");
                    }}
                    onConfirm={executePendingRevoke}
                    queueAction="ACCESS_REVOKE"
                    title="Queue access revoke"
                    eventTypeLabel="Access Revoke"
                    recordLabel={revokeWorkflowRecordLabel}
                    pipelineSteps={ACCESS_REVOKE_QUEUE_MODAL_PIPELINE}
                    loading={revokeWorkflowSubmitting}
                    error={revokeWorkflowError}
                />
            </Suspense>
            <Snackbar
                open={snackbar.open}
                autoHideDuration={2000}
                onClose={() => setSnackbar({ ...snackbar, open: false })}
                message={snackbar.message}
            />
        </Dialog>
    );
}
