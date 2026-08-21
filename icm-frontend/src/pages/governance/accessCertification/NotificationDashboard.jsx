import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  CircularProgress,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
  Chip,
  Pagination,
  FormControl,
  Select,
  MenuItem,
  Stack,
  Paper,
} from "@mui/material";
import {
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Email as EmailIcon,
  Group as GroupIcon,
  WorkOutline as JobsIcon,
  InfoOutlined as InfoIcon,
} from "@mui/icons-material";
import accessCertificationService from "../../../services/accessCertificationService";
import { AC_PALETTE, KPI_CARD_STYLES, DASHBOARD_PAGE } from "./AcessStyles";
import { downloadCsv } from "./notificationCsvUtils";

const C = {
  border: AC_PALETTE.border,
  text: AC_PALETTE.text,
  textMuted: AC_PALETTE.textMuted,
  approved: KPI_CARD_STYLES.success.iconColor,
  approvedBg: KPI_CARD_STYLES.success.iconBg,
  revoked: KPI_CARD_STYLES.error.iconColor,
  revokedBg: KPI_CARD_STYLES.error.iconBg,
  pending: KPI_CARD_STYLES.warning.iconColor,
  pendingBg: KPI_CARD_STYLES.warning.iconBg,
  info: KPI_CARD_STYLES.primary.iconColor,
  infoBg: KPI_CARD_STYLES.primary.iconBg,
};

const TYPE_FILTERS = ["ALL", "LAUNCH", "REMINDER", "ESCALATION"];
const STATUS_FILTERS = ["ALL", "SENT", "FAILED", "PENDING", "RETRYING"];
const PAGE_SIZE_OPTIONS = [10, 25, 50];
const DEFAULT_PAGE_SIZE = 10;

const boardCardSx = {
  border: `1px solid ${C.border}`,
  borderRadius: 2,
  boxShadow: DASHBOARD_PAGE.cardShadowSubtle,
  bgcolor: "#fff",
  overflow: "hidden",
};

const tableHeadCellSx = {
  fontWeight: 700,
  fontSize: "0.7rem",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: C.textMuted,
  bgcolor: "#F8FAFC",
  borderBottom: `1px solid ${C.border}`,
  py: 1.25,
  whiteSpace: "nowrap",
};

function MetricCard({ label, value, tone = "primary", subtitle }) {
  const style = KPI_CARD_STYLES[tone] || KPI_CARD_STYLES.primary;
  return (
    <Card
      elevation={0}
      sx={{
        border: `1px solid ${style.border}`,
        borderRadius: 2,
        borderBottom: `3px solid ${style.bottomBar}`,
        height: "100%",
        boxShadow: DASHBOARD_PAGE.cardShadowSubtle,
      }}
    >
      <CardContent sx={{ py: 1.25, px: 1.75, "&:last-child": { pb: 1.25 } }}>
        <Typography
          sx={{
            fontSize: "0.65rem",
            fontWeight: 700,
            color: style.title,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            fontSize: "1.35rem",
            fontWeight: 800,
            color: style.value,
            mt: 0.25,
            lineHeight: 1.2,
          }}
        >
          {value ?? 0}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontSize: "0.62rem", color: C.textMuted, mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function StatusChip({ status }) {
  const s = String(status || "").toUpperCase();
  const map = {
    SENT: { label: "Sent", color: C.approved, bg: C.approvedBg },
    FAILED: { label: "Failed", color: C.revoked, bg: C.revokedBg },
    PENDING: { label: "Pending", color: C.pending, bg: C.pendingBg },
    RETRYING: { label: "Retrying", color: C.pending, bg: C.pendingBg },
    PROCESSING: { label: "Processing", color: C.info, bg: C.infoBg },
  };
  const style = map[s] || { label: s || "—", color: C.textMuted, bg: "#F1F5F9" };
  return (
    <Chip
      label={style.label}
      size="small"
      sx={{
        fontSize: "0.68rem",
        fontWeight: 700,
        height: 22,
        bgcolor: style.bg,
        color: style.color,
      }}
    />
  );
}

function BoardPaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}) {
  const pageCount = Math.max(1, Math.ceil((Number(total) || 0) / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), pageCount);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(safePage * pageSize, total);

  return (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1.5,
        px: 2,
        py: 1.25,
        borderTop: `1px solid ${C.border}`,
        bgcolor: "#FAFBFC",
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
        <Typography sx={{ fontSize: "0.72rem", color: C.textMuted, fontWeight: 600 }}>
          {total === 0
            ? "No items"
            : pageCount > 1
              ? `${rangeStart}–${rangeEnd} of ${total}`
              : `Showing all ${total}`}
        </Typography>
        <FormControl size="small" sx={{ minWidth: 88 }}>
          <Select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            sx={{
              fontSize: "0.72rem",
              fontWeight: 600,
              height: 30,
              bgcolor: "#fff",
              "& .MuiSelect-select": { py: 0.5 },
            }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <MenuItem key={n} value={n} sx={{ fontSize: "0.75rem" }}>
                {n} / page
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      {pageCount > 1 && (
        <Pagination
          count={pageCount}
          page={safePage}
          onChange={(_e, next) => onPageChange(next)}
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

function BoardSectionHeader({ icon, title, count, subtitle, actions }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 1.5,
        flexWrap: "wrap",
        px: 2,
        py: 1.5,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {icon}
          <Typography sx={{ fontSize: "0.88rem", fontWeight: 800, color: C.text }}>
            {title}
          </Typography>
          {typeof count === "number" && (
            <Chip
              label={count}
              size="small"
              sx={{
                height: 22,
                fontSize: "0.68rem",
                fontWeight: 700,
                bgcolor: AC_PALETTE.accentSoft,
                color: AC_PALETTE.accent,
              }}
            />
          )}
        </Box>
        {subtitle && (
          <Typography sx={{ fontSize: "0.7rem", color: C.textMuted, mt: 0.35 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions}
    </Box>
  );
}

function useClientPaging(rows, page, pageSize) {
  return useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    const total = list.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
    const safePage = Math.min(Math.max(1, page), pageCount);
    const start = (safePage - 1) * pageSize;
    return {
      total,
      pageCount,
      safePage,
      paged: list.slice(start, start + pageSize),
    };
  }, [rows, page, pageSize]);
}

function jobMatchesFilters(job, typeFilter, statusFilter) {
  const type = String(typeFilter || "ALL").toUpperCase();
  const status = String(statusFilter || "ALL").toUpperCase();
  const jobType = String(job?.type || "").toUpperCase();
  const jobStatus = String(job?.status || job?.rawStatus || "").toUpperCase();

  if (type !== "ALL" && jobType !== type) return false;
  if (status === "ALL") return true;
  return jobStatus === status;
}

function fmtDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function fmtAge(ms) {
  if (ms == null) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

/** Kept for ReminderSettings and other consumers. */
export function EmailQueueStatusCard({ stats, loading }) {
  if (loading && !stats) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        <CircularProgress size={22} />
      </Box>
    );
  }
  if (!stats) return null;

  return (
    <Alert
      severity={stats.workerRunning ? "info" : "warning"}
      icon={<EmailIcon fontSize="small" />}
      sx={{ mb: 2, fontSize: "0.78rem" }}
    >
      <strong>Email queue:</strong> {stats.queueSize ?? 0} in queue · {stats.failed ?? 0} failed ·{" "}
      {stats.retrying ?? 0} retrying
      {stats.workerRunning ? "" : " · worker not running"}
      {stats.oldestPending?.ageMs != null && (
        <> · oldest pending {fmtAge(stats.oldestPending.ageMs)}</>
      )}
      {stats.lastPollAt && <> · last poll {fmtDate(stats.lastPollAt)}</>}
    </Alert>
  );
}

export default function NotificationDashboard() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [queueStats, setQueueStats] = useState(null);
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [reviewerPage, setReviewerPage] = useState(1);
  const [reviewerPageSize, setReviewerPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsPageSize, setJobsPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Load unfiltered dashboard so KPI cards stay stable; filter tables client-side.
  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [dashRes, statsRes] = await Promise.all([
        accessCertificationService.getNotificationDashboard({
          limit: 500,
        }),
        accessCertificationService.getEmailQueueStats(),
      ]);
      if (dashRes.success) setData(dashRes.data);
      else setError(dashRes.error || "Failed to load dashboard");
      if (statsRes.success) setQueueStats(statsRes.data);
    } catch (e) {
      setError(e.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    setReviewerPage(1);
    setJobsPage(1);
  }, [typeFilter, statusFilter]);

  const clearFilters = () => {
    setTypeFilter("ALL");
    setStatusFilter("ALL");
  };

  const filtersActive = typeFilter !== "ALL" || statusFilter !== "ALL";

  const summary = data?.summary || {};
  const jobs = data?.jobs || [];
  const reviewers = data?.reviewers || [];

  const filteredJobs = useMemo(
    () => jobs.filter((job) => jobMatchesFilters(job, typeFilter, statusFilter)),
    [jobs, typeFilter, statusFilter],
  );

  // Reviewer reminder rows are SENT reminders; type/status filters mainly affect jobs.
  // When filtering to Failed/Pending/Retrying, hide reminder summary (all SENT).
  const filteredReviewers = useMemo(() => {
    const status = String(statusFilter || "ALL").toUpperCase();
    const type = String(typeFilter || "ALL").toUpperCase();
    if (status !== "ALL" && status !== "SENT") return [];
    if (type !== "ALL" && type !== "REMINDER" && type !== "ESCALATION") return [];
    return reviewers;
  }, [reviewers, typeFilter, statusFilter]);

  const reviewerPaging = useClientPaging(filteredReviewers, reviewerPage, reviewerPageSize);
  const jobsPaging = useClientPaging(filteredJobs, jobsPage, jobsPageSize);

  // Align header chips with certification dashboard summary (not a different global queue count)
  const boardFailed = Number(summary.failed) || 0;
  const boardRetrying = Number(summary.retrying) || 0;
  const boardPending =
    (Number(summary.pending) || 0) + (Number(summary.processing) || 0);

  const handleExportReviewers = () => {
    const headers = ["Reviewer", "Email", "Campaign", "Reminder Count", "Last Reminder", "Status"];
    const rows = filteredReviewers.map((r) => [
      r.recipientName,
      r.recipientEmail,
      r.campaignName,
      r.reminderCount,
      r.lastReminder ? new Date(r.lastReminder).toISOString() : "",
      r.status,
    ]);
    downloadCsv("certification_notification_reviewers.csv", [headers, ...rows]);
  };

  const handleExportJobs = () => {
    const headers = ["Campaign", "Type", "Reviewer", "Status", "Attempts", "Sent At", "Error"];
    const rows = filteredJobs.map((j) => [
      j.campaignName,
      j.type,
      j.recipientEmail,
      j.status,
      `${j.attempts}/${j.maxAttempts}`,
      j.sentAt ? new Date(j.sentAt).toISOString() : "",
      j.lastError || "",
    ]);
    downloadCsv("certification_notification_jobs.csv", [headers, ...rows]);
  };

  if (loading && !data) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1, md: 2 }, pb: 3 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Board header */}
      <Paper
        elevation={0}
        sx={{
          ...boardCardSx,
          mb: 2,
          px: 2,
          py: 1.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          flexWrap: "wrap",
        }}
      >
        <Box>
          <Typography sx={{ fontSize: "1rem", fontWeight: 800, color: C.text }}>
            Notification board
          </Typography>
          <Typography sx={{ fontSize: "0.72rem", color: C.textMuted, mt: 0.25 }}>
            Cross-campaign email delivery for access certification — reviewers, jobs, and queue health.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label={`${boardPending} pending/processing`}
              sx={{ height: 22, fontSize: "0.65rem", fontWeight: 700, bgcolor: "#F1F5F9" }}
            />
            <Chip
              size="small"
              label={`${boardFailed} failed`}
              sx={{
                height: 22,
                fontSize: "0.65rem",
                fontWeight: 700,
                bgcolor: boardFailed > 0 ? C.revokedBg : "#F1F5F9",
                color: boardFailed > 0 ? C.revoked : C.textMuted,
              }}
            />
            <Chip
              size="small"
              label={`${boardRetrying} retrying`}
              sx={{
                height: 22,
                fontSize: "0.65rem",
                fontWeight: 700,
                bgcolor: C.pendingBg,
                color: C.pending,
              }}
            />
            {queueStats && (
              <Chip
                size="small"
                icon={<InfoIcon sx={{ fontSize: "14px !important" }} />}
                label={
                  queueStats.workerRunning
                    ? `Worker OK${queueStats.lastPollAt ? ` · polled ${fmtDate(queueStats.lastPollAt)}` : ""}`
                    : "Worker not running"
                }
                sx={{
                  height: 22,
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  bgcolor: queueStats.workerRunning ? C.infoBg : C.revokedBg,
                  color: queueStats.workerRunning ? C.info : C.revoked,
                  "& .MuiChip-icon": {
                    color: queueStats.workerRunning ? C.info : C.revoked,
                  },
                }}
              />
            )}
          </Stack>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleExportReviewers}
            disabled={!filteredReviewers.length}
            sx={{ textTransform: "none", fontWeight: 700 }}
          >
            Export Reviewers
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleExportJobs}
            disabled={!filteredJobs.length}
            sx={{ textTransform: "none", fontWeight: 700 }}
          >
            Export Jobs
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={
              refreshing ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon />
            }
            onClick={() => load(true)}
            disabled={refreshing}
            sx={{
              textTransform: "none",
              fontWeight: 700,
              bgcolor: AC_PALETTE.accent,
              "&:hover": { bgcolor: AC_PALETTE.accentHover },
            }}
          >
            Refresh
          </Button>
        </Stack>
      </Paper>

      {/* KPI strip — campaign notification jobs only */}
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={6} sm={4} md={2.4}>
          <MetricCard label="Sent" value={summary.sent} tone="success" />
        </Grid>
        <Grid item xs={6} sm={4} md={2.4}>
          <MetricCard label="Failed" value={summary.failed} tone="error" />
        </Grid>
        <Grid item xs={6} sm={4} md={2.4}>
          <MetricCard label="Pending" value={summary.pending} tone="warning" />
        </Grid>
        <Grid item xs={6} sm={4} md={2.4}>
          <MetricCard
            label="Retrying"
            value={summary.retrying}
            tone="warning"
            subtitle="currently waiting"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={2.4}>
          <MetricCard label="Processing" value={summary.processing} tone="primary" />
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper elevation={0} sx={{ ...boardCardSx, mb: 2, px: 2, py: 1.5 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            mb: 1,
            flexWrap: "wrap",
          }}
        >
          <Typography
            sx={{
              fontSize: "0.68rem",
              fontWeight: 700,
              color: C.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Filters
          </Typography>
          {filtersActive && (
            <Button
              size="small"
              onClick={clearFilters}
              sx={{ textTransform: "none", fontWeight: 700, fontSize: "0.72rem" }}
            >
              Clear filters
            </Button>
          )}
        </Box>
        {filtersActive && (
          <Typography sx={{ fontSize: "0.7rem", color: C.textMuted, mb: 1 }}>
            Active filter
            {typeFilter !== "ALL"
              ? ` · ${typeFilter.charAt(0)}${typeFilter.slice(1).toLowerCase()}`
              : ""}
            {statusFilter !== "ALL"
              ? ` · ${statusFilter.charAt(0)}${statusFilter.slice(1).toLowerCase()}`
              : ""}
            {" "}applied to tables below. KPI cards stay as full totals.
          </Typography>
        )}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={typeFilter}
            onChange={(_, v) => v && setTypeFilter(v)}
            sx={{ bgcolor: "#fff" }}
          >
            {TYPE_FILTERS.map((f) => (
              <ToggleButton
                key={f}
                value={f}
                sx={{ textTransform: "none", fontWeight: 700, fontSize: "0.72rem", px: 1.25 }}
              >
                {f === "ALL" ? "All types" : f.charAt(0) + f.slice(1).toLowerCase()}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={statusFilter}
            onChange={(_, v) => v && setStatusFilter(v)}
            sx={{ bgcolor: "#fff" }}
          >
            {STATUS_FILTERS.map((f) => (
              <ToggleButton
                key={f}
                value={f}
                sx={{ textTransform: "none", fontWeight: 700, fontSize: "0.72rem", px: 1.25 }}
              >
                {f === "ALL" ? "All status" : f.charAt(0) + f.slice(1).toLowerCase()}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Paper>

      {/* Reviewer reminder board */}
      <Card elevation={0} sx={{ ...boardCardSx, mb: 2 }}>
        <BoardSectionHeader
          icon={<GroupIcon sx={{ fontSize: 18, color: C.info }} />}
          title="Reviewer reminder summary"
          count={filteredReviewers.length}
          subtitle="Reminder activity across campaigns"
        />
        <TableContainer sx={{ maxHeight: 420 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={tableHeadCellSx}>Reviewer</TableCell>
                <TableCell sx={tableHeadCellSx}>Campaign</TableCell>
                <TableCell sx={tableHeadCellSx} align="right">
                  Reminders
                </TableCell>
                <TableCell sx={tableHeadCellSx}>Last Reminder</TableCell>
                <TableCell sx={tableHeadCellSx}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reviewerPaging.paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4, color: C.textMuted }}>
                    {filtersActive
                      ? "No reminder records match the selected filters."
                      : "No reminder records yet."}
                  </TableCell>
                </TableRow>
              ) : (
                reviewerPaging.paged.map((row) => (
                  <TableRow key={`${row.campaignId}-${row.recipientEmail}`} hover>
                    <TableCell>
                      <Typography sx={{ fontSize: "0.78rem", fontWeight: 600 }}>
                        {row.recipientName || row.recipientEmail}
                      </Typography>
                      {row.recipientName && row.recipientName !== row.recipientEmail && (
                        <Typography sx={{ fontSize: "0.68rem", color: C.textMuted }}>
                          {row.recipientEmail}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.75rem" }}>{row.campaignName}</TableCell>
                    <TableCell align="right" sx={{ fontSize: "0.75rem", fontWeight: 600 }}>
                      {row.reminderCount}
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.75rem" }}>{fmtDate(row.lastReminder)}</TableCell>
                    <TableCell>
                      <StatusChip status={row.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <BoardPaginationBar
          page={reviewerPaging.safePage}
          pageSize={reviewerPageSize}
          total={reviewerPaging.total}
          onPageChange={setReviewerPage}
          onPageSizeChange={(n) => {
            setReviewerPageSize(n);
            setReviewerPage(1);
          }}
        />
      </Card>

      {/* Email jobs board */}
      <Card elevation={0} sx={boardCardSx}>
        <BoardSectionHeader
          icon={<JobsIcon sx={{ fontSize: 18, color: C.info }} />}
          title="Email jobs"
          count={filteredJobs.length}
          subtitle="All certification campaigns in this tenant"
        />
        <TableContainer sx={{ maxHeight: 480 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={tableHeadCellSx}>Campaign</TableCell>
                <TableCell sx={tableHeadCellSx}>Type</TableCell>
                <TableCell sx={tableHeadCellSx}>Reviewer</TableCell>
                <TableCell sx={tableHeadCellSx}>Status</TableCell>
                <TableCell sx={tableHeadCellSx}>Attempts</TableCell>
                <TableCell sx={tableHeadCellSx}>Sent At</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobsPaging.paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4, color: C.textMuted }}>
                    {filtersActive
                      ? "No jobs match the selected filters."
                      : "No email jobs yet."}
                  </TableCell>
                </TableRow>
              ) : (
                jobsPaging.paged.map((job) => (
                  <TableRow key={job.id} hover>
                    <TableCell sx={{ fontSize: "0.75rem", fontWeight: 600, maxWidth: 220 }}>
                      {job.campaignName}
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.75rem" }}>{job.type}</TableCell>
                    <TableCell sx={{ fontSize: "0.75rem" }}>{job.recipientEmail}</TableCell>
                    <TableCell>
                      <StatusChip status={job.status} />
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.75rem" }}>
                      {job.attempts}/{job.maxAttempts}
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.75rem" }}>{fmtDate(job.sentAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <BoardPaginationBar
          page={jobsPaging.safePage}
          pageSize={jobsPageSize}
          total={jobsPaging.total}
          onPageChange={setJobsPage}
          onPageSizeChange={(n) => {
            setJobsPageSize(n);
            setJobsPage(1);
          }}
        />
      </Card>
    </Box>
  );
}
