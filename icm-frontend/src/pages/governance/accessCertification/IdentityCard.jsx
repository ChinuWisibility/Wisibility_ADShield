/**
 * IdentityCard
 *
 * One card per identity on the Access Certification Review board.
 * Displays a sc-2-style header (reviewer name + Approve All / Revoke All on the right)
 * and a flat entitlement table with columns:
 *   APPLICATION | ENTITLEMENT | DECISION | REMEDIATION | ACTION
 *
 * Supports both:
 *   - PROFILE cert items  (each scopeData row = 1 entitlement, no entitlementDecisions array)
 *   - APPLICATION cert items (entitlementDecisions[] array per row)
 */

import React from "react";
import {
    Box,
    Paper,
    Avatar,
    Typography,
    Chip,
    Button,
    Divider,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
} from "@mui/material";
import {
    KeyboardArrowDown as ArrowDownIcon,
    KeyboardArrowRight as ArrowRightIcon,
    PersonOutline as PersonOutlineIcon,
    Check as CheckIcon,
    Block as BlockIcon,
    HourglassEmpty as HourglassEmptyIcon,
    CommentOutlined,
} from "@mui/icons-material";
import { DECISION_COLORS } from "./AcessStyles";
import { coerceReadableText } from "../../../utils/resolveIdentityFields";
import {
    resolveRemediationStatusUi,
    entitlementStatusToDecision,
    entitlementStatusToDisplayDecision,
    isEntitlementStatusPending,
} from "../../../utils/remediationWorkflowStatus";
import WorkflowStatusCell from "./WorkflowStatusCell";

/* ── Helpers ──────────────────────────────────────────────────── */
const getDecisionChip = (decision) => {
    const key = coerceReadableText(decision) || "Pending";
    const S = {
        Approved: { label: "Approved", icon: <CheckIcon sx={{ fontSize: 13 }} />, ...DECISION_COLORS.Approved },
        Revoked:  { label: "Revoked",  icon: <BlockIcon  sx={{ fontSize: 13 }} />, ...DECISION_COLORS.Revoked  },
        Revoking: {
            label: "Revoke in progress",
            icon: <HourglassEmptyIcon sx={{ fontSize: 13 }} />,
            ...DECISION_COLORS.Revoking,
        },
        Pending:  { label: "Pending",  icon: null,                                  ...DECISION_COLORS.Pending  },
        Delegate: { label: "Delegate", icon: null,                                  ...DECISION_COLORS.Delegate },
        Exception:{ label: "Exception",icon: null,                                  ...DECISION_COLORS.Exception},
    };
    const style = S[key] || S.Pending;
    return (
        <Chip
            label={style.label}
            icon={style.icon || undefined}
            size="small"
            sx={{
                fontSize: "0.72rem", height: 22, fontWeight: 600,
                bgcolor: style.bg, color: style.text,
                border: `1px solid ${style.border}`,
                "& .MuiChip-icon": { color: "inherit", fontSize: "13px" },
            }}
        />
    );
};

const AVATAR_COLORS = ["#334155", "#475569", "#0F766E", "#6D28D9"];

/* ── IdentityCard ─────────────────────────────────────────────── */
/**
 * @param {{
 *   uid: string,
 *   group: { identity: object, reviewerLabel: object, allItems: object[] },
 *   groupIndex: number,
 *   isExpanded: boolean,
 *   onToggle: () => void,
 *   reviewState: Map,
 *   entitlementReviewState: Map,
 *   getReviewEntryForItem: (reviewState: Map, item: object) => object,
 *   onApproveItem: (item: object, decision: string, comment: string) => void,
 *   onRevokeItem:  (item: object) => void,
 *   onExceptionItem: (item: object) => void,
 *   onApproveEntitlement: (item: object, entName: string, decision: string, comment: string) => void,
 *   onRevokeEntitlement:  (item: object, entName: string) => void,
 *   onBulkDecision: (items: object[], decision: string) => void,
 *   campaign: object,
 *   formatDate: (d: string) => string,
 *   getExecutionForRow?: (args: { executionId?: string, reviewItemId?: string, entitlementName?: string }) => object | null,
 * }} props
 */
export default function IdentityCard({
    uid,
    group,
    groupIndex,
    isExpanded,
    onToggle,
    reviewState,
    entitlementReviewState,
    getReviewEntryForItem,
    onApproveItem,
    onRevokeItem,
    onExceptionItem,
    onApproveEntitlement,
    onRevokeEntitlement,
    onBulkDecision,
    campaign,
    formatDate,
    getExecutionForRow,
    disableNoAccessActions = false,
}) {
    const { identity, reviewerLabel, allItems } = group;

    /* ── Progress stats ────────────────────────────────────────── */
    let approved = 0, revoked = 0, pending = 0;
    allItems.forEach(item => {
        const eds = Array.isArray(item.entitlementDecisions) ? item.entitlementDecisions : [];
        if (eds.length > 0) {
            const rid = String(item.reviewItemId || item._id || item.id || "");
            eds.forEach(ed => {
                const ov = entitlementReviewState.get(`${rid}::${ed.entitlementName}`);
                const st = ov?.status || ed.status || "PENDING";
                if (st === "APPROVED") approved++;
                else if (st === "REVOKED" || st === "REVOKE_IN_PROGRESS") revoked++;
                else pending++;
            });
        } else {
            const d = getReviewEntryForItem(reviewState, item)?.decision;
            if (d === "Approved") approved++;
            else if (d === "Revoked") revoked++;
            else pending++;
        }
    });
    const total = approved + revoked + pending;
    const done  = approved + revoked;

    /* ── Pending items for Approve All / Revoke All ────────────── */
    const pendingItems = allItems.filter(item => {
        if (Array.isArray(item.entitlementDecisions) && item.entitlementDecisions.length > 0) return false;
        const d = getReviewEntryForItem(reviewState, item)?.decision;
        return !d || d === "Pending";
    });

    /* ── Identity details ──────────────────────────────────────── */
    // Backend may use itemName/itemEmail/itemDepartment/itemTitle (IDENTITY scope)
    // or name/email/department/title (PROFILE scope) — cover both.
    const name  = identity.itemName  || identity.name  || "—";
    const email = identity.itemEmail || identity.email || "";
    const dept  = identity.itemDepartment || identity.department || "";
    const title = identity.itemTitle      || identity.title      || "";
    const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    const avatarBg = AVATAR_COLORS[groupIndex % AVATAR_COLORS.length];

    const dueDate = campaign?.dueDate ? formatDate(campaign.dueDate) : null;

    const statusChip = done === total && total > 0
        ? { label: "Completed", color: "#166534", bg: "#F0FDF4", border: "#BBF7D0" }
        : done === 0
            ? { label: "Not Started", color: "#6B7280", bg: "#F9FAFB", border: "#E5E7EB" }
            : { label: "In Progress", color: "#78350F", bg: "#FFFBEB", border: "#FDE68A" };

    /* ── Helpers ──────────────────────────────────────────────── */
    /**
     * Strip leading "ApplicationName:" prefix from an entitlement name.
     * e.g. "GIT HUB:member" with app "GIT HUB" → "member"
     * Comparison is case-insensitive and trims surrounding whitespace.
     */
    const stripAppPrefix = (entName, appName) => {
        if (!entName) return "—";
        if (!appName) return entName;
        const prefix = appName.trim().toLowerCase() + ":";
        const raw    = entName.trim();
        if (raw.toLowerCase().startsWith(prefix)) {
            return raw.slice(prefix.length).trim() || raw;
        }
        return raw;
    };

    /* ── Flat entitlement rows ─────────────────────────────────── */
    const flatRows = allItems.flatMap(item => {
        const eds = Array.isArray(item.entitlementDecisions) ? item.entitlementDecisions : [];

        // APPLICATION cert — entitlementDecisions array
        if (eds.length > 0) {
            const rid = String(item.reviewItemId || item._id || item.id || "");
            return eds.map((ed) => {
                const compositeKey = `${rid}::${ed.entitlementName}`;
                const ov  = entitlementReviewState.get(compositeKey);
                const st  = ov?.status || ed.status || "PENDING";
                const isPending = isEntitlementStatusPending(st);
                const remStatus = ov?.remediationStatus ?? ed.remediationStatus ?? null;
                const provStatus = ov?.provisioningStatus ?? ed.provisioningStatus ?? null;
                const displayDecision = entitlementStatusToDisplayDecision(st, remStatus, provStatus);
                const remediationDecision = entitlementStatusToDecision(st);
                const appName   = ed.applicationName || item.applicationName || item.itemApplicationName || "—";
                const execId = ed.remediationExecutionId || null;
                const reviewItemId = String(item.reviewItemId || item._id || "");
                const execution = getExecutionForRow?.({
                    executionId: execId,
                    reviewItemId,
                    entitlementName: ed.entitlementName,
                }) || null;
                const remediationUi = resolveRemediationStatusUi({
                    decision: remediationDecision,
                    remediationStatus: remStatus,
                    provisioningStatus: provStatus,
                    entitlementStatus: st,
                    execution,
                });
                return {
                    key:         compositeKey,
                    appName,
                    entName:     stripAppPrefix(ed.entitlementName, appName),
                    displayDecision,
                    decision:    remediationDecision,
                    isPending,
                    comment:     ov?.comment || ed.comment || "",
                    remediationStatus: remStatus,
                    provisioningStatus: provStatus,
                    entitlementStatus: st,
                    remediationExecutionId: execId,
                    execution,
                    remediationUi,
                    onApprove:   () => onApproveEntitlement(item, ed.entitlementName, "Approved", ""),
                    onRevoke:    () => onRevokeEntitlement(item, ed.entitlementName),
                };
            });
        }

        // PROFILE cert — item IS the entitlement row
        const st        = getReviewEntryForItem(reviewState, item);
        const isPending = !st?.decision || st.decision === "Pending";
        const appName   = item.applicationName || item.itemApplicationName || item.entitlementSnapshot?.applicationName || "—";
        const isNoAccess =
            String(item.reviewItemType || "").toUpperCase() === "NO_ACCESS" ||
            (!item.entitlementSnapshot?.entitlementName &&
                (!Array.isArray(item.itemAccessDetails) || item.itemAccessDetails.length === 0) &&
                (!Array.isArray(item.displayGroupsLabel) || item.displayGroupsLabel.length === 0));

        const rawEntName = isNoAccess
            ? "No access"
            : item.entitlementSnapshot?.entitlementName
            || (Array.isArray(item.itemAccessDetails) && item.itemAccessDetails[0])
            || (Array.isArray(item.displayGroupsLabel) && item.displayGroupsLabel[0])
            || "—";
        const profileDecision = st?.decision || "Pending";
        const profileRem = item.remediationStatus ?? null;
        const profileProv = item.provisioningStatus ?? null;
        const profileEntStatus = item.reviewItemStatus || profileDecision;
        const displayDecision = entitlementStatusToDisplayDecision(profileEntStatus, profileRem, profileProv);
        const remediationDecision = entitlementStatusToDecision(profileEntStatus);
        const profileExecution = getExecutionForRow?.({
            executionId: item.remediationExecutionId || null,
            reviewItemId: String(item.reviewItemId || item._id || ""),
            entitlementName: rawEntName,
        }) || null;
        const remediationUi = resolveRemediationStatusUi({
            decision: remediationDecision,
            remediationStatus: profileRem,
            provisioningStatus: profileProv,
            entitlementStatus: profileEntStatus,
            execution: profileExecution,
        });
        return [{
            key:       item.reviewItemId || item.id,
            appName: isNoAccess ? "—" : appName,
            entName:   stripAppPrefix(rawEntName, appName),
            displayDecision,
            decision:  remediationDecision,
            isPending,
            comment:   st?.comment || "",
            remediationStatus: item.remediationStatus ?? null,
            provisioningStatus: item.provisioningStatus ?? null,
            entitlementStatus: item.reviewItemStatus || profileDecision,
            remediationExecutionId: item.remediationExecutionId || null,
            execution: profileExecution,
            remediationUi,
            onApprove: (isNoAccess && disableNoAccessActions) ? null : (() => onApproveItem(item, "Approved", "")),
            onRevoke:  (isNoAccess || (isNoAccess && disableNoAccessActions)) ? null : (() => onRevokeItem(item)),
            onException: (isNoAccess && disableNoAccessActions) ? null : (isNoAccess ? (() => onExceptionItem(item)) : null),
            isNoAccess,
        }];
    });

    /* ── Render ────────────────────────────────────────────────── */
    return (
        <Paper
            elevation={0}
            sx={{
                border: isExpanded ? "1px solid #94A3B8" : "1px solid #DCE4EF",
                borderRadius: 2.5,
                overflow: "visible",
                bgcolor: "#FFFFFF",
                boxShadow: isExpanded
                    ? "0 12px 30px rgba(15, 23, 42, 0.08)"
                    : "0 3px 10px rgba(15, 23, 42, 0.04)",
                transition: "all 160ms ease",
            }}
        >
            {/* ── Card Header ──────────────────────────────────────── */}
            <Box
                onClick={onToggle}
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    px: 1.75,
                    py: 1.25,
                    cursor: "pointer",
                    bgcolor: isExpanded ? "#F8FAFC" : "#FFFFFF",
                    borderRadius: isExpanded ? "10px 10px 0 0" : "10px",
                    transition: "border-radius 0ms",
                    "&:hover": { bgcolor: isExpanded ? "#F1F5F9" : "#FAFAFA" },
                }}
            >
                {/* Collapse chevron */}
                {isExpanded
                    ? <ArrowDownIcon  sx={{ fontSize: 20, color: "#64748B", flexShrink: 0 }} />
                    : <ArrowRightIcon sx={{ fontSize: 20, color: "#94A3B8", flexShrink: 0 }} />}

                {/* Avatar */}
                <Avatar sx={{ width: 38, height: 38, fontSize: "0.76rem", fontWeight: 800, bgcolor: avatarBg, flexShrink: 0 }}>
                    {initials}
                </Avatar>

                {/* Identity info — name, email, chips */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: "0.9rem", fontWeight: 700, color: "#0F172A", lineHeight: 1.25 }}>
                        {name}
                    </Typography>
                    <Typography sx={{ fontSize: "0.72rem", color: "#64748B", mt: 0.1 }}>
                        {email}
                    </Typography>
                    {(dept || title) && (
                        <Box sx={{ display: "flex", gap: 0.5, mt: 0.35, flexWrap: "wrap" }}>
                            {dept  && <Chip label={dept}  size="small" variant="outlined" sx={{ height: 18, fontSize: "0.6rem", fontWeight: 600, borderColor: "#CBD5E1", color: "#475569", "& .MuiChip-label": { px: 0.6 } }} />}
                            {title && <Chip label={title} size="small" variant="outlined" sx={{ height: 18, fontSize: "0.6rem", fontWeight: 600, borderColor: "#C4B5FD", color: "#7C3AED", "& .MuiChip-label": { px: 0.6 } }} />}
                        </Box>
                    )}
                </Box>

                {/* Right: reviewer · divider · Approve All · Revoke All · stats */}
                <Box
                    sx={{ display: "flex", alignItems: "center", gap: 1.25, flexShrink: 0 }}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Reviewer name */}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mr: 0.5 }}>
                        <PersonOutlineIcon sx={{ fontSize: 14, color: reviewerLabel.color || "#64748B" }} />
                        <Typography sx={{ fontSize: "0.78rem", fontWeight: 600, color: reviewerLabel.color || "#374151", whiteSpace: "nowrap" }}>
                            {reviewerLabel.name}
                        </Typography>
                        {reviewerLabel.typeLabel !== "Manager" && (
                            <Typography sx={{ fontSize: "0.66rem", color: reviewerLabel.color || "#94A3B8", fontStyle: "italic", whiteSpace: "nowrap" }}>
                                [{reviewerLabel.typeLabel}]
                            </Typography>
                        )}
                    </Box>

                    <Divider orientation="vertical" flexItem sx={{ height: 28, alignSelf: "center" }} />

                    {/* Approve All */}
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<CheckIcon sx={{ fontSize: "0.85rem !important" }} />}
                        disabled={pendingItems.length === 0}
                        onClick={() => onBulkDecision(pendingItems, "Approved")}
                        sx={{
                            fontSize: "0.72rem", py: 0.4, px: 1.1, textTransform: "none", fontWeight: 600,
                            borderColor: pendingItems.length > 0 ? "#D1FAE5" : "#E5E7EB",
                            color:       pendingItems.length > 0 ? "#166534"  : "#9CA3AF",
                            "&:hover":   { bgcolor: "#F0FDF4", borderColor: "#166534" },
                            minWidth: 0,
                        }}
                    >
                        Approve All ({pendingItems.length})
                    </Button>

                    {/* Revoke All */}
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<BlockIcon sx={{ fontSize: "0.85rem !important" }} />}
                        disabled={pendingItems.length === 0}
                        onClick={() => onBulkDecision(pendingItems, "Revoked")}
                        sx={{
                            fontSize: "0.72rem", py: 0.4, px: 1.1, textTransform: "none", fontWeight: 600,
                            borderColor: pendingItems.length > 0 ? "#FECACA" : "#E5E7EB",
                            color:       pendingItems.length > 0 ? "#991B1B" : "#9CA3AF",
                            "&:hover":   { bgcolor: "#FEF2F2", borderColor: "#991B1B" },
                            minWidth: 0,
                        }}
                    >
                        Revoke All ({pendingItems.length})
                    </Button>

                    <Divider orientation="vertical" flexItem sx={{ height: 28, alignSelf: "center" }} />

                    {/* Progress chips */}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
                        <Chip size="small" label={`✓ ${approved}`} sx={{ height: 18, fontSize: "0.62rem", fontWeight: 700, bgcolor: "#ECFDF3", color: "#047857", border: "1px solid #A7F3D0", "& .MuiChip-label": { px: 0.7 } }} />
                        <Chip size="small" label={`✗ ${revoked}`}  sx={{ height: 18, fontSize: "0.62rem", fontWeight: 700, bgcolor: "#FEF2F2", color: "#B91C1C", border: "1px solid #FCA5A5", "& .MuiChip-label": { px: 0.7 } }} />
                        <Chip size="small" label={`⧖ ${pending}`}  sx={{ height: 18, fontSize: "0.62rem", fontWeight: 700, bgcolor: "#FFFBEB", color: "#A16207", border: "1px solid #FCD34D", "& .MuiChip-label": { px: 0.7 } }} />
                        <Typography sx={{ fontSize: "0.74rem", color: "#0F172A", fontWeight: 800, pl: 0.2 }}>
                            {done}/{total}
                        </Typography>
                    </Box>

                    {/* Status chip */}
                    <Chip
                        label={statusChip.label}
                        size="small"
                        sx={{ height: 20, fontSize: "0.64rem", fontWeight: 700, bgcolor: statusChip.bg, color: statusChip.color, border: `1px solid ${statusChip.border}`, "& .MuiChip-label": { px: 0.7 } }}
                    />
                </Box>
            </Box>

            {/* ── Expanded body: flat entitlement table ────────────── */}
            {isExpanded && (
                <Box sx={{ borderTop: "1px solid #E2E8F0" }}>
                    <TableContainer sx={{ bgcolor: "#FFFFFF", overflowX: "auto" }}>
                        <Table size="small" sx={{ tableLayout: "fixed", width: "100%", minWidth: 640 }}>
                            <TableHead>
                                <TableRow sx={{ bgcolor: "#F8FAFC" }}>
                                    {[
                                        { label: "Application", w: "16%" },
                                        { label: "Entitlement", w: "24%" },
                                        { label: "Decision",    w: "14%" },
                                        { label: "Remediation", w: "24%" },
                                        { label: "Action",      w: "28%", align: "right" },
                                    ].map(col => (
                                        <TableCell key={col.label} align={col.align} sx={{
                                            width: col.w, py: 0.85,
                                            fontWeight: 700, fontSize: "0.64rem",
                                            letterSpacing: "0.05em", textTransform: "uppercase",
                                            color: "#64748B", borderBottom: "1px solid #E2E8F0",
                                        }}>
                                            {col.label}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {flatRows.length > 0 ? flatRows.map(row => (
                                    <TableRow key={row.key} hover sx={{ "& td": { borderBottom: "1px solid #F8FAFC", py: 0.8 }, "&:hover td": { bgcolor: "#FAFBFF" } }}>
                                        {/* Application */}
                                        <TableCell>
                                            <Typography sx={{ fontSize: "0.76rem", color: "#475569", fontWeight: 500 }}>
                                                {row.appName}
                                            </Typography>
                                        </TableCell>

                                        {/* Entitlement */}
                                        <TableCell>
                                            <Typography sx={{ fontSize: "0.78rem", fontWeight: 600, color: "#111827" }}>
                                                {row.entName}
                                            </Typography>
                                        </TableCell>

                                        {/* Decision */}
                                        <TableCell>{getDecisionChip(row.displayDecision)}</TableCell>

                                        {/* Remediation status */}
                                        <TableCell>
                                            <WorkflowStatusCell
                                                remediationUi={row.remediationUi}
                                                execution={row.execution}
                                                remediationStatus={row.remediationStatus}
                                                provisioningStatus={row.provisioningStatus}
                                                entitlementStatus={row.entitlementStatus}
                                            />
                                        </TableCell>

                                        {/* Action */}
                                        <TableCell align="right" sx={{ pr: 2 }}>
                                            {row.isPending ? (
                                                <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.75 }}>
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        onClick={row.onApprove}
                                                        sx={{
                                                            fontSize: "0.72rem", py: 0.25, px: 1.1, textTransform: "none", fontWeight: 600,
                                                            borderColor: "#D1FAE5", color: "#166534",
                                                            "&:hover": { bgcolor: "#F0FDF4", borderColor: "#166534" },
                                                        }}
                                                    >
                                                        {row.isNoAccess ? "Certify" : "Approve"}
                                                    </Button>
                                                    {row.onException && (
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            onClick={row.onException}
                                                            sx={{
                                                                fontSize: "0.72rem", py: 0.25, px: 1.1, textTransform: "none", fontWeight: 600,
                                                                borderColor: "#FED7AA", color: "#9A3412",
                                                                "&:hover": { bgcolor: "#FFF7ED", borderColor: "#9A3412" },
                                                            }}
                                                        >
                                                            Exception
                                                        </Button>
                                                    )}
                                                    {row.onRevoke && (
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            onClick={row.onRevoke}
                                                            sx={{
                                                                fontSize: "0.72rem", py: 0.25, px: 1.1, textTransform: "none", fontWeight: 600,
                                                                borderColor: "#FECACA", color: "#991B1B",
                                                                "&:hover": { bgcolor: "#FEF2F2", borderColor: "#991B1B" },
                                                            }}
                                                        >
                                                            Revoke
                                                        </Button>
                                                    )}
                                                </Box>
                                            ) : (
                                                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0.75, pr: 0.5 }}>
                                                    <Typography sx={{ fontSize: "0.66rem", fontStyle: "italic", color: "#9CA3AF" }}>
                                                        Decided
                                                    </Typography>
                                                    {row.comment && (
                                                        <Tooltip title={row.comment}>
                                                            <CommentOutlined sx={{ fontSize: 13, color: "#D1D5DB" }} />
                                                        </Tooltip>
                                                    )}
                                                </Box>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow>
                                        <TableCell colSpan={5} sx={{ py: 2.5, textAlign: "center" }}>
                                            <Typography sx={{ fontSize: "0.78rem", color: "#94A3B8" }}>
                                                No entitlements to review.
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>

                    {/* ── Audit footer ─────────────────────────────────── */}
                    <Box sx={{ px: 2, py: 0.75, display: "flex", alignItems: "center", gap: 1, bgcolor: "#F8FAFC", borderTop: "1px solid #F1F5F9" }}>
                        <PersonOutlineIcon sx={{ fontSize: 13, color: "#CBD5E1" }} />
                        <Typography sx={{ fontSize: "0.66rem", color: "#94A3B8" }}>
                            Reviewer:{" "}
                            <span style={{ fontWeight: 600, color: "#64748B" }}>
                                {reviewerLabel.name}
                            </span>
                            {dueDate && ` · Due: ${dueDate}`}
                        </Typography>
                    </Box>
                </Box>
            )}
        </Paper>
    );
}
