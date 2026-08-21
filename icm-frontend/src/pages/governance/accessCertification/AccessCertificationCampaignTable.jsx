import React from "react";
import {
    Box,
    Card,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
    Avatar,
    Chip,
    Stack,
    Tooltip,
    IconButton,
    Pagination,
    Button,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
    MoreVert as MoreVertIcon,
    Inbox as InboxIcon,
    Apps as AppsIcon,
    Person as PersonIcon,
    ManageAccounts as ManagerIcon,
    BalanceOutlined as SodIcon,
    LinkOff as UnlinkedIcon,
    AccountTreeOutlined as RoleIcon,
    AdminPanelSettingsOutlined as GovernanceIcon,
    FiberManualRecord as DotIcon,
} from "@mui/icons-material";
import { AC_PALETTE, STATUS_BADGE_COLORS } from "./AcessStyles";

/* ── Category metadata ──────────────────────────────────────────────── */
/* ── Scope theme ─────────────────────────────────────────────────────── */
const SCOPE_THEME = {
    APPLICATION: { label: "Application Level", color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe", dot: "#3b82f6", icon: AppsIcon },
    PROFILE: { label: "Identity Profile Level", color: "#6d28d9", bg: "#f5f3ff", border: "#ddd6fe", dot: "#8b5cf6", icon: PersonIcon },
    GOVERNANCE: { label: "Governance Level", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe", dot: "#8b5cf6", icon: GovernanceIcon },
};

/* ── Category definitions ────────────────────────────────────────────── */
const CATEGORY_DEF = {
    // APPLICATION scope
    IDENTITY: { label: "Identity", icon: PersonIcon, scope: "APPLICATION" },
    ACCOUNTS: { label: "Accounts", icon: AppsIcon, scope: "APPLICATION" },
    ACCESS_ITEMS: { label: "Access Items", icon: AppsIcon, scope: "APPLICATION" },
    UNCORRELATED_ACCOUNTS: { label: "Uncorrelated Accounts", icon: UnlinkedIcon, scope: "APPLICATION" },
    // PROFILE scope
    MANAGER: { label: "Manager Review", icon: ManagerIcon, scope: "PROFILE" },
    LIFECYCLE_STATUS: { label: "Lifecycle Status", icon: PersonIcon, scope: "PROFILE" },
    // GOVERNANCE scope
    ROLE_COMPOSITION: { label: "Role Composition", icon: RoleIcon, scope: "GOVERNANCE" },
    ROLE_MEMBERSHIP: { label: "Role Membership", icon: RoleIcon, scope: "GOVERNANCE" },
    SOD: { label: "SoD Violations", icon: SodIcon, scope: "GOVERNANCE" },
    POLICIES: { label: "Policies", icon: GovernanceIcon, scope: "GOVERNANCE" },
    APPROVAL_OWNERSHIP: { label: "Approval Ownership", icon: ManagerIcon, scope: "GOVERNANCE" },
};

function getCategoryMeta(category, certificationScope, applicationId) {
    const catKey = String(category || "").toUpperCase();
    const def = CATEGORY_DEF[catKey];

    // Determine scope: prefer explicit certificationScope, else derive
    let scopeKey = certificationScope
        ? String(certificationScope).toUpperCase()
        : def?.scope || (applicationId ? "APPLICATION" : "PROFILE");
    if (!SCOPE_THEME[scopeKey]) scopeKey = "APPLICATION";

    const scope = SCOPE_THEME[scopeKey];
    const CatIcon = def?.icon || AppsIcon;
    return {
        scopeKey,
        scopeLabel: scope.label,
        categoryLabel: def?.label || (category || "General"),
        color: scope.color,
        bg: scope.bg,
        border: scope.border,
        dot: scope.dot,
        ScopeIcon: scope.icon,
        CategoryIcon: CatIcon,
    };
}

/* ── Category badge cell ────────────────────────────────────────────── */
function CategoryBadge({ category, certificationScope, applicationName, accessFilter }) {
    const m = getCategoryMeta(category, certificationScope, applicationName);
    const { ScopeIcon, CategoryIcon } = m;
    const isPrivileged = accessFilter === 'PRIVILEGED';

    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, minWidth: 180 }}>
            {/* Scope pill — top label */}
            <Box
                sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.6,
                    px: 1,
                    py: 0.3,
                    borderRadius: "4px",
                    bgcolor: m.bg,
                    border: `1px solid ${m.border}`,
                    width: "fit-content",
                }}
            >
                <ScopeIcon sx={{ fontSize: 10, color: m.color }} />
                <Typography sx={{ fontSize: "0.65rem", fontWeight: 700, color: m.color, whiteSpace: "nowrap", letterSpacing: "0.04em" }}>
                    {m.scopeLabel}
                </Typography>
            </Box>

            {/* Category — with icon + label */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, pl: 0.25 }}>
                <CategoryIcon sx={{ fontSize: 12, color: "#64748b", flexShrink: 0 }} />
                <Box>
                    <Typography sx={{ fontSize: "0.75rem", color: "#1e293b", fontWeight: 600, lineHeight: 1.3 }}>
                        {m.categoryLabel}{isPrivileged ? " · Privileged" : ""}
                    </Typography>
                    {applicationName && applicationName !== "-" && (
                        <Typography sx={{ fontSize: "0.65rem", color: "#94a3b8", lineHeight: 1.4 }}>
                            {applicationName}
                        </Typography>
                    )}
                </Box>
            </Box>
        </Box>
    );
}

/* ── helpers ─────────────────────────────────────────────────────────── */
const formatDate = (d) => {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
};

const checkIsExpired = (dueDate, status) => {
    if (!dueDate) return false;
    const s = (status || "").toLowerCase();
    if (s.includes("completed") || s.includes("closed") || s === "endphase") return false;
    return new Date(dueDate) < new Date();
};

const getStatusConfig = (status, isExpired) => {
    if (isExpired) return { label: "Expired", tone: STATUS_BADGE_COLORS.Expired, accent: STATUS_BADGE_COLORS.Expired.text };
    const s = (status || "").toLowerCase();
    if (s === "staged") return { label: "Staged", tone: STATUS_BADGE_COLORS.Staged, accent: STATUS_BADGE_COLORS.Staged.text };
    if (s === "endphase") return { label: "End Phase", tone: STATUS_BADGE_COLORS.EndPhase, accent: STATUS_BADGE_COLORS.EndPhase.text };
    if (s.includes("active")) return { label: "Active", tone: STATUS_BADGE_COLORS.Active, accent: STATUS_BADGE_COLORS.Active.text };
    if (s.includes("completed")) return { label: "Completed", tone: STATUS_BADGE_COLORS.Completed, accent: STATUS_BADGE_COLORS.Completed.text };
    if (s.includes("closed")) return { label: "Closed", tone: STATUS_BADGE_COLORS.Closed, accent: STATUS_BADGE_COLORS.Closed.text };
    if (s.includes("decision") || s.includes("pending")) return { label: "Pending", tone: STATUS_BADGE_COLORS.Pending, accent: STATUS_BADGE_COLORS.Pending.text };
    return { label: status || "Draft", tone: STATUS_BADGE_COLORS.Draft, accent: STATUS_BADGE_COLORS.Draft.text };
};

/* ── Main component ──────────────────────────────────────────────────── */
export default function AccessCertificationCampaignTable({
    rows,
    filteredCount,
    page,
    rowsPerPage,
    onPageChange,
    onReview,
    onActivate,
    activatingId,
    onOpenActions,
    onCreateCampaign,
    theme,
    CampaignReminderButton,
}) {
    const headerCellSx = {
        fontWeight: 800,
        fontSize: 12,
        letterSpacing: 0.5,
        color: AC_PALETTE.textMuted,
        textTransform: "uppercase",
        py: 1.25,
        borderBottom: `1px solid ${AC_PALETTE.border}`,
    };

    return (
        <Card
            sx={{
                borderRadius: 4,
                border: `1px solid ${alpha(theme.palette.primary.main, 0.14)}`,
                boxShadow: "0 14px 34px -28px rgba(15, 23, 42, 0.55)",
                overflow: "hidden",
                bgcolor: AC_PALETTE.cardBg,
            }}
        >
            <Table sx={{ minWidth: 860 }}>
                <TableHead sx={{ bgcolor: AC_PALETTE.surface }}>
                    <TableRow>
                        <TableCell sx={headerCellSx}>Campaign</TableCell>
                        <TableCell sx={headerCellSx}>Certification Type</TableCell>
                        <TableCell sx={headerCellSx}>Due Date</TableCell>
                        <TableCell sx={headerCellSx}>Status</TableCell>
                        <TableCell align="right" sx={headerCellSx}>Actions</TableCell>
                    </TableRow>
                </TableHead>

                <TableBody>
                    {rows.length > 0 ? (
                        rows.map((row) => {
                            const id = row._id || row.id;
                            const isExpired = checkIsExpired(row.dueDate, row.statusLabel || row.status);
                            const meta = getStatusConfig(row.statusLabel || row.status, isExpired);
                            const isCompleted = (row.statusLabel || row.status || "").toLowerCase().includes("completed");
                            const isStaged = ["staged", "draft"].includes((row.status || "").toLowerCase());
                            const isActivating = activatingId === id;
                            const catMeta2 = getCategoryMeta(row.category, row.certificationScope, row.applicationName);

                            return (
                                <TableRow
                                    key={id}
                                    hover
                                    sx={{
                                        transition: "background 0.15s",
                                        '&:hover': { bgcolor: AC_PALETTE.surface },
                                        '& td': { py: 1.75, borderBottom: `1px solid ${AC_PALETTE.border}` },
                                        '&:last-child td': { borderBottom: 0 },
                                    }}
                                >
                                    {/* Campaign column — name + description */}
                                    <TableCell sx={{ maxWidth: 340 }}>
                                        <Box display="flex" alignItems="flex-start" gap={1.75}>
                                            <Avatar
                                                variant="rounded"
                                                sx={{
                                                    width: 38,
                                                    height: 38,
                                                    fontSize: 15,
                                                    fontWeight: 700,
                                                    bgcolor: catMeta2.bg,
                                                    border: `1px solid ${catMeta2.border}`,
                                                    color: catMeta2.color,
                                                    borderRadius: "8px",
                                                    mt: 0.25,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {row.name ? row.name.charAt(0) : "C"}
                                            </Avatar>
                                            <Box>
                                                <Typography
                                                    variant="subtitle2"
                                                    fontWeight={700}
                                                    color={isExpired ? "error.main" : AC_PALETTE.text}
                                                    sx={{ lineHeight: 1.35, mb: 0.3 }}
                                                >
                                                    {row.name}
                                                </Typography>
                                                {row.description && (
                                                    <Tooltip title={row.description}>
                                                        <Typography
                                                            variant="caption"
                                                            color="text.secondary"
                                                            noWrap
                                                            sx={{ display: "block", maxWidth: 240, lineHeight: 1.4 }}
                                                        >
                                                            {row.description}
                                                        </Typography>
                                                    </Tooltip>
                                                )}
                                                {/* {row.tenantId && (
                                                    <Typography
                                                        variant="caption"
                                                        sx={{ display: "block", color: "#94a3b8", fontSize: "0.65rem", mt: 0.25 }}
                                                    >
                                                        Tenant: {row.tenantName || String(row.tenantId)}
                                                    </Typography>
                                                )} */}
                                                {isExpired && (
                                                    <Typography variant="caption" color="error" fontWeight={700} sx={{ display: "block", mt: 0.25 }}>
                                                        EXPIRED
                                                    </Typography>
                                                )}
                                            </Box>
                                        </Box>
                                    </TableCell>

                                    {/* Certification Type — scope + category + app */}
                                    <TableCell>
                                        <CategoryBadge
                                            category={row.category}
                                            certificationScope={row.certificationScope}
                                            applicationName={row.applicationName}
                                            accessFilter={row.accessFilter}
                                        />
                                    </TableCell>

                                    {/* Due Date */}
                                    <TableCell>
                                        <Typography
                                            variant="body2"
                                            fontWeight={isExpired ? 700 : 400}
                                            color={isExpired ? "error" : "text.primary"}
                                            sx={{ fontSize: "0.82rem" }}
                                        >
                                            {formatDate(row.dueDate)}
                                        </Typography>
                                    </TableCell>

                                    {/* Status */}
                                    <TableCell>
                                        <Box
                                            sx={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                px: 1.25,
                                                py: 0.4,
                                                borderRadius: "5px",
                                                bgcolor: meta.tone.bg,
                                                border: `1px solid ${meta.tone.border}`,
                                            }}
                                        >
                                            <Typography
                                                sx={{
                                                    fontSize: "0.72rem",
                                                    fontWeight: 700,
                                                    color: meta.tone.text,
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                {meta.label}
                                            </Typography>
                                        </Box>
                                    </TableCell>

                                    {/* Actions */}
                                    <TableCell align="right">
                                        <Stack direction="row" justifyContent="flex-end" spacing={1} alignItems="center">
                                            {isStaged ? (
                                                <Button
                                                    variant="outlined"
                                                    size="small"
                                                    disabled={isActivating}
                                                    onClick={() => onActivate(row)}
                                                    sx={{
                                                        borderRadius: "6px",
                                                        textTransform: "none",
                                                        fontSize: "0.78rem",
                                                        fontWeight: 600,
                                                        borderColor: AC_PALETTE.border,
                                                        color: AC_PALETTE.accent,
                                                        '&:hover': { bgcolor: AC_PALETTE.accentSoft, borderColor: AC_PALETTE.accent },
                                                    }}
                                                >
                                                    {isActivating ? "Activating…" : "Activate"}
                                                </Button>
                                            ) : (
                                                <Button
                                                    variant="contained"
                                                    size="small"
                                                    onClick={() => onReview(row)}
                                                    disableElevation
                                                    sx={{
                                                        borderRadius: "6px",
                                                        textTransform: "none",
                                                        fontSize: "0.78rem",
                                                        fontWeight: 600,
                                                        bgcolor: AC_PALETTE.accent,
                                                        color: AC_PALETTE.onAccent,
                                                        '&:hover': { bgcolor: alpha(AC_PALETTE.accent, 0.88) },
                                                    }}
                                                >
                                                    Review Now
                                                </Button>
                                            )}
                                            <CampaignReminderButton
                                                campaignId={id}
                                                campaignName={row.name}
                                                isCompleted={isCompleted}
                                                isExpired={isExpired}
                                            />
                                            <Tooltip title="More actions">
                                                <IconButton
                                                    size="small"
                                                    onClick={(e) => onOpenActions(e.currentTarget, row)}
                                                    sx={{
                                                        border: `1px solid ${AC_PALETTE.border}`,
                                                        borderRadius: "6px",
                                                        width: 30,
                                                        height: 30,
                                                    }}
                                                >
                                                    <MoreVertIcon sx={{ fontSize: 16 }} />
                                                </IconButton>
                                            </Tooltip>
                                        </Stack>
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    ) : (
                        <TableRow>
                            <TableCell colSpan={5} align="center" sx={{ py: 8 }}>
                                <Box display="flex" flexDirection="column" alignItems="center" sx={{ opacity: 0.6 }}>
                                    <InboxIcon sx={{ fontSize: 48, mb: 1, color: "text.disabled" }} />
                                    <Typography variant="subtitle1" fontWeight={600}>
                                        No campaigns found
                                    </Typography>
                                    <Typography variant="body2">Try adjusting filters or create a new campaign</Typography>
                                    {typeof onCreateCampaign === "function" && (
                                        <Button sx={{ mt: 2 }} variant="outlined" size="small" onClick={onCreateCampaign}>
                                            Create Campaign
                                        </Button>
                                    )}
                                </Box>
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>

            <Box
                sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    px: 2.5,
                    py: 1.5,
                    borderTop: `1px solid ${AC_PALETTE.border}`,
                    bgcolor: AC_PALETTE.surface,
                }}
            >
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.78rem" }}>
                    Showing {rows.length} of {filteredCount} entries
                </Typography>
                <Pagination
                    count={Math.max(1, Math.ceil(filteredCount / rowsPerPage))}
                    page={page}
                    onChange={(_, nextPage) => onPageChange(nextPage)}
                    color="standard"
                    shape="rounded"
                    size="small"
                />
            </Box>
        </Card>
    );
}
