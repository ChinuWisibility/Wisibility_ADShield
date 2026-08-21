import React, { useEffect, useState, useMemo } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Avatar,
  LinearProgress,
  Divider,
  Tooltip,
  Grid,
  CircularProgress,
  Alert,
  Button,
  Snackbar,
} from "@mui/material";
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  HourglassEmpty as PendingIcon,
  Group as GroupIcon,
  CalendarToday as CalendarIcon,
  Person as PersonIcon,
  Shield as ShieldIcon,
  Assignment as AssignmentIcon,
  Info as InfoIcon,
  NotificationsActive as ReminderIcon,
  WarningAmber as WarningIcon,
  BuildOutlined as RepairIcon,
} from "@mui/icons-material";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";
import accessCertificationService from "../../../services/accessCertificationService";
import { AC_PALETTE, DECISION_COLORS, STATUS_BADGE_COLORS } from "./AcessStyles";

// ── Minimalist palette ───────────────────────────────────────────────────────
const C = {
  approved: DECISION_COLORS.Approved.text,
  approvedBg: DECISION_COLORS.Approved.bg,
  approvedBorder: DECISION_COLORS.Approved.border,
  revoked: DECISION_COLORS.Revoked.text,
  revokedBg: DECISION_COLORS.Revoked.bg,
  revokedBorder: DECISION_COLORS.Revoked.border,
  pending: DECISION_COLORS.Pending.text,
  pendingBg: DECISION_COLORS.Pending.bg,
  pendingBorder: DECISION_COLORS.Pending.border,
  total: AC_PALETTE.accent,
  totalBg: AC_PALETTE.accentSoft,
  totalBorder: AC_PALETTE.border,
  info: AC_PALETTE.textMuted,
  infoBg: AC_PALETTE.surface,
  infoBorder: AC_PALETTE.border,
  surface: AC_PALETTE.surface,
  surfaceMuted: AC_PALETTE.surfaceMuted,
  border: AC_PALETTE.border,
  text: AC_PALETTE.text,
  textMuted: AC_PALETTE.textMuted,
  textLight: AC_PALETTE.textLight,
  cardBg: AC_PALETTE.cardBg,
};

const PIE_COLOR_MAP = {
  Approved: DECISION_COLORS.Approved.text,
  Revoked: DECISION_COLORS.Revoked.text,
  Pending: DECISION_COLORS.Pending.text,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(d) {
  if (!d) return "N/A";
  return new Date(d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function pct(num, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((num / total) * 100));
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function getCategoryScopeLabel(category) {
  const value = String(category || "").toUpperCase();
  if (value === "IDENTITY") return "Identities in Scope";
  if (value === "MANAGER") return "Direct Reports in Scope";
  if (value === "ROLE_COMPOSITION") return "Roles in Scope";
  return "Selected Access Items";
}

function statusBadge(campaign) {
  const s = String(campaign?.status || "Unknown").replace(/\s+/g, "");
  const map = {
    Active: { label: "Active", bg: STATUS_BADGE_COLORS.Active.bg, color: STATUS_BADGE_COLORS.Active.text, border: STATUS_BADGE_COLORS.Active.border },
    DecisionPending: { label: "Decision Pending", bg: STATUS_BADGE_COLORS.Pending.bg, color: STATUS_BADGE_COLORS.Pending.text, border: STATUS_BADGE_COLORS.Pending.border },
    EndPhase: { label: "End Phase", bg: STATUS_BADGE_COLORS.EndPhase.bg, color: STATUS_BADGE_COLORS.EndPhase.text, border: STATUS_BADGE_COLORS.EndPhase.border },
    Completed: { label: "Completed", bg: STATUS_BADGE_COLORS.Completed.bg, color: STATUS_BADGE_COLORS.Completed.text, border: STATUS_BADGE_COLORS.Completed.border },
    Closed: { label: "Closed", bg: STATUS_BADGE_COLORS.Closed.bg, color: STATUS_BADGE_COLORS.Closed.text, border: STATUS_BADGE_COLORS.Closed.border },
    Staged: { label: "Staged", bg: STATUS_BADGE_COLORS.Staged.bg, color: STATUS_BADGE_COLORS.Staged.text, border: STATUS_BADGE_COLORS.Staged.border },
    Draft: { label: "Draft", bg: STATUS_BADGE_COLORS.Draft.bg, color: STATUS_BADGE_COLORS.Draft.text, border: STATUS_BADGE_COLORS.Draft.border },
  };
  const m = map[s] || { label: s, bg: STATUS_BADGE_COLORS.Draft.bg, color: STATUS_BADGE_COLORS.Draft.text, border: STATUS_BADGE_COLORS.Draft.border };
  return (
    <Chip
      label={m.label}
      size="small"
      sx={{
        fontWeight: 700,
        fontSize: "0.72rem",
        letterSpacing: 0.4,
        bgcolor: m.bg,
        color: m.color,
        border: `1.5px solid ${m.border}`,
        height: 24,
      }}
    />
  );
}

function reviewerStatusBadge(progress) {
  if (!progress || progress.total === 0)
    return <Chip label="Not Started" size="small" sx={{ fontSize: "0.68rem", fontWeight: 600, bgcolor: C.surface, color: C.textMuted, height: 20 }} />;
  if (progress.pending === 0)
    return <Chip label="Completed" size="small" sx={{ fontSize: "0.68rem", fontWeight: 600, bgcolor: C.approvedBg, color: C.approved, height: 20 }} />;
  return <Chip label="In Progress" size="small" sx={{ fontSize: "0.68rem", fontWeight: 600, bgcolor: C.pendingBg, color: C.pending, height: 20 }} />;
}

function initials(name) {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function reminderLabel(freq) {
  const m = {
    GLOBAL: "Global Setting",
    WEEKLY: "Weekly",
    MONTHLY: "Monthly",
    TWO_DAYS_BEFORE_END: "2 Days Before Due",
    DISABLED: "Disabled",
  };
  return m[freq] || freq || "Global Setting";
}

function computeNextReminderDue(lastSentAt, frequency, dueDate) {
  if (!lastSentAt) return null;
  const last = new Date(lastSentAt);
  const freq = String(frequency || "WEEKLY").toUpperCase();
  if (freq === "TWO_DAYS_BEFORE_END" && dueDate) {
    return new Date(new Date(dueDate).getTime() - 2 * 24 * 60 * 60 * 1000);
  }
  const addDays = freq === "MONTHLY" ? 30 : 7;
  return new Date(last.getTime() + addDays * 24 * 60 * 60 * 1000);
}

function reminderStatusLabel(entry) {
  if (!entry) return "No reminders sent";
  const status = entry.deliveryStatus || "UNKNOWN";
  const sent = entry.sentAt ? fmt(entry.sentAt) : "—";
  return `${sent} · ${status}`;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function resolveStandardReminder(reminderRow, campaignSummary, reviewerEmailKey) {
  if (reminderRow?.standard) return reminderRow.standard;
  if (!campaignSummary?.lastReminderAt) return null;
  const summaryEmail = normalizeEmail(campaignSummary.recipientEmail);
  if (summaryEmail && summaryEmail !== reviewerEmailKey) return null;
  return {
    sentAt: campaignSummary.lastReminderAt,
    deliveryStatus: campaignSummary.lastReminderStatus,
    reminderType: campaignSummary.reminderType,
    source: campaignSummary.source,
  };
}

// ── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({ icon, label, value, sub, color, bg, border }) {
  return (
    <Box
      sx={{
        position: 'relative',
        borderRadius: 2,
        bgcolor: bg || '#fff',
        border: `1.5px solid ${border || C.border}`,
        overflow: 'hidden',
        p: 2,
        height: '100%',
        minHeight: 88,
      }}
    >
      {/* Left accent bar */}
      <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, bgcolor: color }} />
      {/* Watermark icon */}
      <Box sx={{ position: 'absolute', right: 10, bottom: 6, opacity: 0.06, pointerEvents: 'none' }}>
        {React.cloneElement(icon, { sx: { fontSize: 50 } })}
      </Box>
      <Box sx={{ pl: 1.5 }}>
        <Typography sx={{ fontSize: '0.63rem', fontWeight: 700, color: C.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', mb: 0.75 }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: '1.65rem', fontWeight: 900, color: C.text, lineHeight: 1, mb: 0.4 }}>
          {value ?? 0}
        </Typography>
        {sub !== undefined && (
          <Typography sx={{ fontSize: '0.69rem', fontWeight: 600, color }}>
            {sub}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function SectionLabel({ children }) {
  return (
    <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: C.textMuted, letterSpacing: 0.8, textTransform: "uppercase", mb: 1.5 }}>
      {children}
    </Typography>
  );
}

function InfoRow({ label, value }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", py: 0.75 }}>
      <Typography sx={{ fontSize: "0.8rem", color: C.textMuted, fontWeight: 500 }}>{label}</Typography>
      <Typography sx={{ fontSize: "0.8rem", color: C.text, fontWeight: 600, textAlign: "right", maxWidth: "60%" }}>{value || "—"}</Typography>
    </Box>
  );
}

const CustomPieTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <Box sx={{ bgcolor: AC_PALETTE.tooltipBg, color: AC_PALETTE.onAccent, px: 1.5, py: 1, borderRadius: 1.5, fontSize: "0.78rem", fontWeight: 600 }}>
      {name}: {value}
    </Box>
  );
};

// ── Main component ───────────────────────────────────────────────────────────
export default function ReviewDashboard({ campaign, onRefresh }) {
  const [reviewerData, setReviewerData] = useState({ reviewers: [], missingReviewerCount: 0 });
  const [loadingReviewers, setLoadingReviewers] = useState(false);
  const [reminderStatusMap, setReminderStatusMap] = useState({});
  const [campaignReminderSummary, setCampaignReminderSummary] = useState(null);
  const [repairing, setRepairing] = useState(false);
  const [repairSnackbar, setRepairSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const handleRepairReviewers = async () => {
    setRepairing(true);
    const res = await accessCertificationService.repairReviewers(campaign._id);
    setRepairing(false);
    if (res.success) {
      const { updated = 0 } = res.data;
      setRepairSnackbar({ open: true, message: updated > 0 ? `${updated} item(s) successfully assigned to backup reviewer.` : 'No items needed re-assignment.', severity: updated > 0 ? 'success' : 'info' });
      if (updated > 0 && onRefresh) onRefresh();
    } else {
      setRepairSnackbar({ open: true, message: res.error || 'Repair failed. Please try again.', severity: 'error' });
    }
  };

  useEffect(() => {
    if (!campaign?._id) return;
    setLoadingReviewers(true);
    Promise.all([
      accessCertificationService.getReviewerProgress(campaign._id),
      accessCertificationService.getCampaignReminderStatus(campaign._id),
    ])
      .then(([reviewerRes, reminderRes]) => {
        if (reviewerRes.success) setReviewerData(reviewerRes.data);
        if (reminderRes.success) {
          const byReviewer = reminderRes.data?.byReviewer || [];
          const map = {};
          for (const row of byReviewer) {
            const key = normalizeEmail(row.recipientEmail);
            if (key) map[key] = row;
          }
          setReminderStatusMap(map);
          setCampaignReminderSummary(reminderRes.data?.campaignSummary || null);
        }
      })
      .finally(() => setLoadingReviewers(false));
  }, [campaign?._id, campaign?.completionPercentage]);

  const total = campaign?.totalItems ?? campaign?.totalScope ?? 0;
  const assignedReviewers = Array.isArray(campaign?.reviewersAssigned) ? campaign.reviewersAssigned : [];
  const reviewerSummary = useMemo(() => {
    return (Array.isArray(reviewerData.reviewers) ? reviewerData.reviewers : []).reduce(
      (acc, reviewer) => {
        const progress = reviewer?.progress || {};
        const reviewerTotal = toNumber(progress.total);
        const reviewerApproved = toNumber(progress.approved);
        const reviewerRevoked = toNumber(progress.revoked);
        const reviewerReviewed = reviewerApproved + reviewerRevoked;
        const reviewerPending = Math.max(reviewerTotal - reviewerReviewed, 0);

        acc.total += reviewerTotal;
        acc.approved += reviewerApproved;
        acc.revoked += reviewerRevoked;
        acc.pending += reviewerPending;
        acc.reviewed += reviewerReviewed;
        return acc;
      },
      { total: 0, approved: 0, revoked: 0, pending: 0, reviewed: 0 },
    );
  }, [reviewerData.reviewers]);

  // reviewerSummary.total (items with reviewer) + missingReviewerCount (items with null email) = all ReviewItem docs
  // Math.max catches stale campaign.totalItems that may be larger than what the reviewer API sees
  const apiDerivedTotal = reviewerSummary.total + toNumber(reviewerData.missingReviewerCount);
  const reviewTotal = Math.max(apiDerivedTotal, toNumber(campaign?.totalItems), toNumber(campaign?.totalScope)) || 0;
  const reviewApproved = toNumber(campaign?.approvedItems) || reviewerSummary.approved;
  const reviewRevoked = toNumber(campaign?.revokedItems) || reviewerSummary.revoked;
  const reviewReviewed = reviewApproved + reviewRevoked;
  const reviewPending = Math.max(reviewTotal - reviewReviewed, 0);
  const assignedReviewerCount = reviewerData.reviewers.length || assignedReviewers.length;
  const completionPct = pct(reviewReviewed, reviewTotal);
  const daysRemaining = campaign?.dueDate
    ? Math.max(0, Math.ceil((new Date(campaign.dueDate) - Date.now()) / 86400000))
    : null;

  const pieData = [
    { name: "Approved", value: reviewApproved },
    { name: "Revoked", value: reviewRevoked },
    { name: "Pending", value: reviewPending },
  ].filter((d) => d.value > 0);

  const overallPct = completionPct;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: C.surface, minHeight: "100%" }}>
      {/* ── Header ── */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", mb: 0.5 }}>
            <Typography sx={{ fontSize: "1.15rem", fontWeight: 800, color: C.text }}>
              {campaign?.name || "Campaign Dashboard"}
            </Typography>
            {statusBadge(campaign)}
          </Box>
          <Typography sx={{ fontSize: "0.8rem", color: C.textMuted }}>
            {campaign?.applicationName && `${campaign.applicationName} · `}
            Due: {fmt(campaign?.dueDate)}
          </Typography>
        </Box>

        {/* Overall progress pill */}
        <Box sx={{ textAlign: "right" }}>
          <Typography sx={{ fontSize: "0.72rem", color: C.textMuted, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}>
            Overall Progress
          </Typography>
          <Typography sx={{ fontSize: "1.8rem", fontWeight: 900, color: C.total, lineHeight: 1.1 }}>
            {overallPct}%
          </Typography>
          <Typography sx={{ fontSize: "0.72rem", color: C.textMuted }}>
            {reviewReviewed} / {reviewTotal} items reviewed
          </Typography>
        </Box>
      </Box>

      {/* ── Progress bar ── */}
      <Box sx={{ mb: 3 }}>
        <LinearProgress
          variant="determinate"
          value={overallPct}
          sx={{
            height: 8,
            borderRadius: 4,
            bgcolor: "#E2E8F0",
            "& .MuiLinearProgress-bar": { bgcolor: C.total, borderRadius: 4 },
          }}
        />
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.75 }}>
          <Typography sx={{ fontSize: "0.7rem", color: C.approved, fontWeight: 600 }}>
            Approved {pct(reviewApproved, reviewTotal)}%
          </Typography>
          <Typography sx={{ fontSize: "0.7rem", color: C.revoked, fontWeight: 600 }}>
            Revoked {pct(reviewRevoked, reviewTotal)}%
          </Typography>
          <Typography sx={{ fontSize: "0.7rem", color: C.pending, fontWeight: 600 }}>
            Pending {pct(reviewPending, reviewTotal)}%
          </Typography>
        </Box>
      </Box>

      {/* ── Reviewer gap alert ── */}
      {reviewTotal > 0 && reviewerData.missingReviewerCount > 0 && (
        <Box sx={{
          mb: 2, px: 2, py: 1.25, borderRadius: 2,
          bgcolor: reviewerData.missingReviewerCount >= reviewTotal ? C.pendingBg : C.infoBg,
          border: `1px solid ${reviewerData.missingReviewerCount >= reviewTotal ? C.pendingBorder : C.infoBorder}`,
          display: 'flex', alignItems: 'center', gap: 1.25,
        }}>
          <WarningIcon sx={{ fontSize: 16, color: reviewerData.missingReviewerCount >= reviewTotal ? C.pending : C.total, flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.78rem', color: reviewerData.missingReviewerCount >= reviewTotal ? C.pending : C.total, fontWeight: 600 }}>
            {reviewerData.missingReviewerCount >= reviewTotal
              ? `All ${reviewTotal} items are missing reviewer assignments — no decisions can be made until reviewers are assigned.`
              : `${reviewerData.missingReviewerCount} of ${reviewTotal} items have no reviewer assigned yet.`}
          </Typography>
        </Box>
      )}

      {/* ── Row 1: Decision outcomes ── */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4}>
          <MetricCard
            icon={<CheckCircleIcon />}
            label="Access Kept"
            value={reviewApproved}
            sub={`${pct(reviewApproved, reviewTotal)}% approved`}
            color={C.approved}
            bg={C.approvedBg}
            border={C.approvedBorder}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <MetricCard
            icon={<CancelIcon />}
            label="Access Removed"
            value={reviewRevoked}
            sub={`${pct(reviewRevoked, reviewTotal)}% revoked`}
            color={C.revoked}
            bg={C.revokedBg}
            border={C.revokedBorder}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <MetricCard
            icon={<PendingIcon />}
            label="Awaiting Decision"
            value={reviewPending}
            sub={
              reviewerData.missingReviewerCount >= reviewTotal && reviewTotal > 0
                ? "Reviewer assignment required"
                : `${pct(reviewPending, reviewTotal)}% still pending`
            }
            color={
              reviewerData.missingReviewerCount >= reviewTotal && reviewTotal > 0
                ? C.textMuted
                : C.pending
            }
            bg={
              reviewerData.missingReviewerCount >= reviewTotal && reviewTotal > 0
                ? C.infoBg
                : C.pendingBg
            }
            border={
              reviewerData.missingReviewerCount >= reviewTotal && reviewTotal > 0
                ? C.infoBorder
                : C.pendingBorder
            }
          />
        </Grid>
      </Grid>

      {/* ── Row 2: Scope & health ── */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={4}>
          <MetricCard
            icon={<AssignmentIcon />}
            label="Total in Scope"
            value={reviewTotal}
            sub="Certification items"
            color={C.total}
            bg={C.totalBg}
            border={C.totalBorder}
          />
        </Grid>
        <Grid item xs={6} sm={4}>
          <MetricCard
            icon={<WarningIcon />}
            label="Reviewer Gaps"
            value={reviewerData.missingReviewerCount}
            sub={reviewerData.missingReviewerCount > 0 ? "Items need assignment" : "All items covered"}
            color={reviewerData.missingReviewerCount > 0 ? C.revoked : C.approved}
            bg={reviewerData.missingReviewerCount > 0 ? C.revokedBg : C.approvedBg}
            border={reviewerData.missingReviewerCount > 0 ? C.revokedBorder : C.approvedBorder}
          />
        </Grid>
        <Grid item xs={6} sm={4}>
          <MetricCard
            icon={<CalendarIcon />}
            label="Days Remaining"
            value={daysRemaining ?? "—"}
            sub={daysRemaining === 0 ? "Due today" : daysRemaining === null ? "No due date" : `until ${fmt(campaign?.dueDate)}`}
            color={daysRemaining !== null && daysRemaining <= 3 ? C.revoked : daysRemaining !== null && daysRemaining <= 7 ? C.pending : C.info}
            bg={daysRemaining !== null && daysRemaining <= 3 ? C.revokedBg : daysRemaining !== null && daysRemaining <= 7 ? C.pendingBg : C.infoBg}
            border={daysRemaining !== null && daysRemaining <= 3 ? C.revokedBorder : daysRemaining !== null && daysRemaining <= 7 ? C.pendingBorder : C.infoBorder}
          />
        </Grid>
      </Grid>

      {/* ── Row 3: Chart + Review Progress ── */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {/* Donut chart */}
        <Grid item xs={12} md={6}>
          <Card elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2.5, height: "100%" }}>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
                <SectionLabel>Decision Breakdown</SectionLabel>
                <Box sx={{ textAlign: "right" }}>
                  <Typography sx={{ fontSize: "1.25rem", fontWeight: 900, color: C.text, lineHeight: 1 }}>{reviewTotal}</Typography>
                  <Typography sx={{ fontSize: "0.65rem", color: C.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Total Items</Typography>
                </Box>
              </Box>
              {pieData.length > 0 ? (
                <Box sx={{ position: "relative" }}>
                  <ResponsiveContainer width="100%" height={210}>
                    <PieChart>
                      <defs>
                        <filter id="pieShadow" x="-20%" y="-20%" width="140%" height="140%">
                          <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.08" />
                        </filter>
                      </defs>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={66}
                        outerRadius={90}
                        paddingAngle={4}
                        dataKey="value"
                        stroke={C.surface}
                        strokeWidth={3}
                        cornerRadius={6}
                        filter="url(#pieShadow)"
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={PIE_COLOR_MAP[entry.name] || C.total} />
                        ))}
                      </Pie>
                      <RechartsTooltip content={<CustomPieTooltip />} />
                      <Legend
                        iconType="circle"
                        iconSize={7}
                        wrapperStyle={{ paddingTop: 8 }}
                        formatter={(value, entry) => (
                          <span style={{ fontSize: "0.73rem", color: C.text, fontWeight: 600 }}>
                            {value} <span style={{ color: C.textMuted, fontWeight: 400 }}>({entry.payload.value})</span>
                          </span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center overlay */}
                  <Box sx={{ position: "absolute", top: "42%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none" }}>
                    <Typography sx={{ fontSize: "1.5rem", fontWeight: 900, color: C.text, lineHeight: 1 }}>
                      {overallPct}%
                    </Typography>
                    <Typography sx={{ fontSize: "0.58rem", fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>
                      Complete
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <Box sx={{ height: 210, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}>
                  <Box sx={{ width: 80, height: 80, borderRadius: "50%", border: `8px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Typography sx={{ fontSize: "1.1rem", fontWeight: 900, color: C.textMuted }}>0%</Typography>
                  </Box>
                  <Typography sx={{ fontSize: "0.78rem", color: C.textMuted }}>No decisions yet</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Review Progress */}
        <Grid item xs={12} md={6}>
          <Card elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2.5, height: "100%" }}>
            <CardContent sx={{ p: 2.5 }}>
              <SectionLabel>Review Progress</SectionLabel>

              <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 2.5 }}>
                <Typography sx={{ fontSize: "2rem", fontWeight: 900, color: C.total }}>{reviewReviewed}</Typography>
                <Typography sx={{ fontSize: "1rem", color: C.textMuted, fontWeight: 600 }}>/ {reviewTotal}</Typography>
                <Typography sx={{ fontSize: "0.78rem", color: C.textMuted, ml: 0.5 }}>items reviewed</Typography>
              </Box>

              {/* Per-decision progress bars */}
              {[
                { label: "Approved Items", count: reviewApproved, total: reviewTotal, color: C.approved },
                { label: "Revoked Items", count: reviewRevoked, total: reviewTotal, color: C.revoked },
                { label: "Pending Actions", count: reviewPending, total: reviewTotal, color: C.pending },
              ].map(({ label, count, color }) => (
                <Box key={label} sx={{ mb: 1.75 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                    <Typography sx={{ fontSize: "0.78rem", color: C.textMuted, fontWeight: 500 }}>{label}</Typography>
                    <Typography sx={{ fontSize: "0.78rem", color: C.text, fontWeight: 700 }}>
                      {count} <span style={{ color: C.textLight, fontWeight: 400 }}>({pct(count, reviewTotal)}%)</span>
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={pct(count, reviewTotal)}
                    sx={{
                      height: 6,
                      borderRadius: 3,
                      bgcolor: C.surfaceMuted,
                      "& .MuiLinearProgress-bar": { bgcolor: color, borderRadius: 3 },
                    }}
                  />
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* ── Row 4: Campaign Details + Reviewers ── */}
      <Grid container spacing={2.5}>
        {/* Campaign details */}
        <Grid item xs={12} md={5}>
          <Card elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2.5, height: "100%" }}>
            <CardContent sx={{ p: 2.5 }}>
              <SectionLabel>Campaign Details</SectionLabel>

              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                <InfoIcon sx={{ fontSize: 16, color: C.info }} />
                <Typography sx={{ fontSize: "0.82rem", fontWeight: 700, color: C.text }}>Information</Typography>
              </Box>

              <Divider sx={{ mb: 1.5, borderColor: C.border }} />

              <InfoRow
                label="Duration"
                value={
                  campaign?.startDate && campaign?.dueDate
                    ? `${fmt(campaign.startDate)} — ${fmt(campaign.dueDate)}`
                    : fmt(campaign?.dueDate)
                }
              />
              <Divider sx={{ borderColor: C.border }} />
              <InfoRow label="Campaign Owner" value={campaign?.createdByName || campaign?.ownerName || "—"} />
              <Divider sx={{ borderColor: C.border }} />
              <InfoRow label="Description" value={campaign?.description || "—"} />
              <Divider sx={{ borderColor: C.border }} />
              <InfoRow label="Category" value={campaign?.category?.replace(/_/g, " ") || "—"} />
              {campaign?.reviewerRoutingMode && (
                <>
                  <Divider sx={{ borderColor: C.border }} />
                  <InfoRow
                    label="Reviewer Routing"
                    value={
                      campaign.reviewerRoutingMode === "DEFAULT" ? "Manager (Default)" :
                        campaign.reviewerRoutingMode === "INTERNAL" ? "Internal" :
                          campaign.reviewerRoutingMode === "EXTERNAL" ? "External" :
                            campaign.reviewerRoutingMode
                    }
                  />
                </>
              )}
              {campaign?.backupManagerReviewerEmail && (
                <>
                  <Divider sx={{ borderColor: C.border }} />
                  <InfoRow
                    label="Backup Reviewer"
                    value={[
                      campaign.backupManagerReviewerName || '',
                      campaign.backupManagerReviewerName
                        ? `(${campaign.backupManagerReviewerEmail})`
                        : campaign.backupManagerReviewerEmail,
                      campaign.backupReviewerSource
                        ? `· ${campaign.backupReviewerSource === 'INTERNAL' ? 'Internal' : 'External'}`
                        : '',
                    ].filter(Boolean).join(' ')}
                  />
                </>
              )}
              <Divider sx={{ borderColor: C.border }} />
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", py: 0.75 }}>
                <Typography sx={{ fontSize: "0.8rem", color: C.textMuted, fontWeight: 500 }}>Reminder Frequency</Typography>
                <Chip
                  icon={<ReminderIcon sx={{ fontSize: "14px !important" }} />}
                  label={reminderLabel(campaign?.reminderFrequency)}
                  size="small"
                  sx={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    bgcolor: C.infoBg,
                    color: C.info,
                    border: `1px solid ${C.infoBorder}`,
                    height: 22,
                  }}
                />
              </Box>

              {/* Entitlement scope summary */}
              <Divider sx={{ my: 1.5, borderColor: C.border }} />
              <Box sx={{ display: "flex", gap: 3 }}>
                {[
                  { label: "Total Items", value: reviewTotal },
                  { label: "Reviewed", value: reviewReviewed },
                  { label: "Pending", value: reviewPending },
                ].map(({ label, value: v }) => (
                  <Box key={label} sx={{ textAlign: "center", flex: 1 }}>
                    <Typography sx={{ fontSize: "1.1rem", fontWeight: 800, color: C.text }}>{v}</Typography>
                    <Typography sx={{ fontSize: "0.68rem", color: C.textMuted, fontWeight: 600 }}>{label}</Typography>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Assigned Reviewers */}
        <Grid item xs={12} md={7}>
          <Card elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2.5, height: "100%" }}>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
                <SectionLabel>
                  Assigned Reviewers ({reviewerData.reviewers.length || campaign?.reviewersAssigned?.length || 0})
                </SectionLabel>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {reviewerData.missingReviewerCount > 0 && (
                    <Chip
                      icon={<WarningIcon sx={{ fontSize: "13px !important" }} />}
                      label={`${reviewerData.missingReviewerCount} unassigned`}
                      size="small"
                      sx={{ fontSize: "0.68rem", fontWeight: 700, bgcolor: C.revokedBg, color: C.revoked, border: `1px solid ${C.revokedBorder}`, height: 20 }}
                    />
                  )}
                  {reviewerData.missingReviewerCount > 0 && campaign?.backupManagerReviewerEmail && (
                    <Tooltip title={`Re-route ${reviewerData.missingReviewerCount} unassigned item(s) to backup reviewer`}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={repairing ? <CircularProgress size={10} /> : <RepairIcon sx={{ fontSize: '13px !important' }} />}
                        onClick={handleRepairReviewers}
                        disabled={repairing}
                        sx={{ fontSize: '0.68rem', fontWeight: 700, height: 24, px: 1, py: 0, textTransform: 'none', borderColor: '#e2e8f0', color: '#475569', '&:hover': { bgcolor: '#f8fafc', borderColor: '#cbd5e1' } }}
                      >
                        {repairing ? 'Fixing…' : 'Assign to backup'}
                      </Button>
                    </Tooltip>
                  )}
                </Box>
              </Box>

              {campaignReminderSummary?.lastReminderAt && (
                <Alert severity="info" sx={{ mb: 1.5, py: 0.25, fontSize: "0.75rem" }}>
                  Campaign last reminder:{" "}
                  <strong>{reminderStatusLabel({
                    sentAt: campaignReminderSummary.lastReminderAt,
                    deliveryStatus: campaignReminderSummary.lastReminderStatus,
                  })}</strong>
                  {campaignReminderSummary.recipientEmail
                    ? ` · ${campaignReminderSummary.recipientEmail}`
                    : ""}
                </Alert>
              )}

              <Box sx={{ maxHeight: 440, overflowY: 'auto', pr: 0.5 }}>
                {loadingReviewers ? (
                  <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                    <CircularProgress size={24} sx={{ color: C.info }} />
                  </Box>
                ) : (reviewerData.reviewers.length > 0
                  ? reviewerData.reviewers
                  : (campaign?.reviewersAssigned || []).map((r) => ({
                    ...r,
                    progress: r.progress || { total: 0, approved: 0, revoked: 0, pending: 0, completion: 0 },
                  }))
                ).map((reviewer, idx, arr) => {
                  const prog = reviewer.progress || {};
                  const totalCount = Number(prog.total) || 0;
                  const approvedCount = Number(prog.approved) || 0;
                  const revokedCount = Number(prog.revoked) || 0;
                  const reviewedCount = approvedCount + revokedCount;
                  const derivedPending = Math.max(totalCount - reviewedCount, 0);
                  const pendingCount =
                    prog.pending === undefined || prog.pending === null
                      ? derivedPending
                      : Number(prog.pending) || 0;
                  const normalizedProgress = {
                    ...prog,
                    total: totalCount,
                    approved: approvedCount,
                    revoked: revokedCount,
                    pending: pendingCount,
                  };
                  const compPct =
                    prog.completion === undefined || prog.completion === null
                      ? pct(reviewedCount, totalCount)
                      : Number(prog.completion) || 0;
                  const reviewerEmailKey = normalizeEmail(
                    reviewer.email || reviewer.reviewerEmail,
                  );
                  const reminderRow = reminderStatusMap[reviewerEmailKey];
                  const standardReminder = resolveStandardReminder(
                    reminderRow,
                    campaignReminderSummary,
                    reviewerEmailKey,
                  );
                  const escalationReminder = reminderRow?.escalation;
                  const nextDue = computeNextReminderDue(
                    standardReminder?.sentAt,
                    campaign?.reminderFrequency,
                    campaign?.dueDate,
                  );
                  return (
                    <Box key={reviewer.email || idx}>
                      <Box sx={{ py: 1.75 }}>
                        {/* Reviewer header row */}
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
                          <Avatar
                            sx={{
                              width: 38,
                              height: 38,
                              fontSize: "0.78rem",
                              fontWeight: 700,
                              bgcolor: ["#374151", "#4B5563", "#6B7280", "#9CA3AF"][idx % 4],
                              flexShrink: 0,
                            }}
                          >
                            {initials(reviewer.name)}
                          </Avatar>

                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 0.5 }}>
                              <Typography sx={{ fontSize: "0.85rem", fontWeight: 700, color: C.text }}>
                                {reviewer.name || reviewer.email}
                              </Typography>
                              {reviewerStatusBadge(normalizedProgress)}
                            </Box>
                            <Typography sx={{ fontSize: "0.72rem", color: C.textMuted, mt: 0.15 }}>
                              {reviewer.email}
                              {reviewer.reviewerType && (
                                <span style={{ marginLeft: 6, fontWeight: 600, color: C.info }}>
                                  · {reviewer.reviewerType.charAt(0) + reviewer.reviewerType.slice(1).toLowerCase()}
                                </span>
                              )}
                              {reviewer.reviewerSource && reviewer.reviewerSource !== "MANAGER" && (
                                <span
                                  style={{
                                    marginLeft: 6,
                                    fontWeight: 700,
                                    fontSize: "0.65rem",
                                    color:
                                      reviewer.reviewerSource === "BACKUP_MANAGER_INTERNAL" || reviewer.reviewerSource === "BACKUP_MANAGER_EXTERNAL" || reviewer.reviewerSource === "BACKUP_MANAGER"
                                        ? "#B45309"
                                        : reviewer.reviewerSource === "EXTERNAL"
                                          ? "#6D28D9"
                                          : reviewer.reviewerSource === "INTERNAL"
                                            ? "#065F46"
                                            : C.textMuted,
                                    textTransform: "uppercase",
                                    letterSpacing: 0.3,
                                  }}
                                >
                                  {reviewer.reviewerSource === "BACKUP_MANAGER_INTERNAL"
                                    ? "· Backup (Internal)"
                                    : reviewer.reviewerSource === "BACKUP_MANAGER_EXTERNAL"
                                      ? "· Backup (External)"
                                      : reviewer.reviewerSource === "BACKUP_MANAGER"
                                        ? "· Backup"
                                        : reviewer.reviewerSource === "EXTERNAL"
                                          ? "· External"
                                          : reviewer.reviewerSource === "INTERNAL"
                                            ? "· Internal"
                                            : null}
                                </span>
                              )}
                            </Typography>
                          </Box>
                        </Box>

                        {/* Assigned-by row */}
                        {reviewer.assignedBy?.name && (
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1, ml: "54px" }}>
                            <ShieldIcon sx={{ fontSize: 12, color: C.textLight }} />
                            <Typography sx={{ fontSize: "0.7rem", color: C.textMuted }}>
                              Assigned by{" "}
                              <strong style={{ color: C.text }}>{reviewer.assignedBy.name}</strong>
                              {reviewer.assignedAt && (
                                <> on {fmt(reviewer.assignedAt)}</>
                              )}
                            </Typography>
                          </Box>
                        )}

                        {/* Progress bar + counts */}
                        <Box sx={{ ml: "54px" }}>
                          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
                            <Typography sx={{ fontSize: "0.7rem", color: C.textMuted }}>
                              <strong style={{ color: C.text }}>{reviewedCount}</strong> / {totalCount} reviewed
                            </Typography>
                            <Box sx={{ display: "flex", gap: 1.5 }}>
                              <Typography sx={{ fontSize: "0.7rem", color: C.approved, fontWeight: 700 }}>
                                ✓ {approvedCount}
                              </Typography>
                              <Typography sx={{ fontSize: "0.7rem", color: C.revoked, fontWeight: 700 }}>
                                ✗ {revokedCount}
                              </Typography>
                              <Typography sx={{ fontSize: "0.7rem", color: C.pending, fontWeight: 700 }}>
                                ⧖ {pendingCount}
                              </Typography>
                            </Box>
                          </Box>
                          <Box sx={{ position: "relative" }}>
                            <LinearProgress
                              variant="determinate"
                              value={compPct}
                              sx={{
                                height: 5,
                                borderRadius: 3,
                                bgcolor: C.surfaceMuted,
                                "& .MuiLinearProgress-bar": {
                                  bgcolor: compPct === 100 ? C.approved : C.info,
                                  borderRadius: 3,
                                },
                              }}
                            />
                          </Box>
                          <Typography sx={{ fontSize: "0.68rem", color: C.textMuted, mt: 0.4, textAlign: "right" }}>
                            {compPct}% complete
                          </Typography>
                          <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center" }}>
                            <ReminderIcon sx={{ fontSize: 13, color: C.textMuted }} />
                            <Typography sx={{ fontSize: "0.68rem", color: C.textMuted }}>
                              Last reminder:{" "}
                              <strong style={{ color: C.text }}>
                                {reminderStatusLabel(standardReminder)}
                              </strong>
                            </Typography>
                            {escalationReminder && (
                              <Chip
                                label={`Escalated · ${reminderStatusLabel(escalationReminder)}`}
                                size="small"
                                sx={{
                                  fontSize: "0.62rem",
                                  fontWeight: 600,
                                  height: 18,
                                  bgcolor: C.pendingBg,
                                  color: C.pending,
                                }}
                              />
                            )}
                            {nextDue && pendingCount > 0 && (
                              <Typography sx={{ fontSize: "0.65rem", color: C.textLight }}>
                                Next due ~ {fmt(nextDue)}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </Box>
                      {idx < arr.length - 1 && <Divider sx={{ borderColor: C.border }} />}
                    </Box>
                  );
                })}

                {!loadingReviewers &&
                  reviewerData.reviewers.length === 0 &&
                  (campaign?.reviewersAssigned || []).length === 0 && (
                    <Alert severity="info" sx={{ mt: 1, fontSize: "0.78rem" }}>
                      No reviewers assigned to this campaign yet.
                    </Alert>
                  )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Snackbar
        open={repairSnackbar.open}
        autoHideDuration={4000}
        onClose={() => setRepairSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setRepairSnackbar((s) => ({ ...s, open: false }))}
          severity={repairSnackbar.severity}
          sx={{ fontSize: '0.8rem' }}
        >
          {repairSnackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
