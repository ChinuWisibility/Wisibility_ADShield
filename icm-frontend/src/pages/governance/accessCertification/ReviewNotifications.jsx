import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
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
  Tooltip,
  Snackbar,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Pagination,
  FormControl,
  Select,
  MenuItem,
  Stack,
  Paper,
} from "@mui/material";
import {
  CheckCircle as CheckIcon,
  Cancel as FailIcon,
  HourglassEmpty as PendingIcon,
  Replay as RetryIcon,
  Email as EmailIcon,
  Timeline as TimelineIcon,
  Refresh as RefreshIcon,
  Close as CloseIcon,
  Article as LogIcon,
  Download as DownloadIcon,
  ExpandMore as ExpandMoreIcon,
  Storage as QueueIcon,
  History as HistoryIcon,
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

function fmtDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function fmtShortDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function StatusChip({ status }) {
  const s = String(status || "").toUpperCase();
  const map = {
    SENT: { label: "Sent", color: C.approved, bg: C.approvedBg },
    FAILED: { label: "Failed", color: C.revoked, bg: C.revokedBg },
    PENDING: { label: "Pending", color: C.pending, bg: C.pendingBg },
    RETRYING: { label: "Retrying", color: C.pending, bg: C.pendingBg },
    PROCESSING: { label: "Processing", color: C.info, bg: C.infoBg },
    NONE: { label: "—", color: C.textMuted, bg: "#F1F5F9" },
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

function TypeIcon({ sent, status, source }) {
  const icon = (() => {
    if (sent || status === "SENT") {
      return <CheckIcon sx={{ fontSize: 18, color: C.approved }} />;
    }
    if (status === "FAILED") {
      return <FailIcon sx={{ fontSize: 18, color: C.revoked }} />;
    }
    if (status === "NONE") {
      return <Typography sx={{ color: C.textMuted, fontSize: "0.85rem" }}>—</Typography>;
    }
    return <PendingIcon sx={{ fontSize: 18, color: C.pending }} />;
  })();

  if (!source || status === "NONE") return icon;

  const sourceLabel =
    source === "email_job"
      ? "Queue job"
      : source === "campaign_reminder_log"
        ? "Legacy reminder log"
        : source === "email_delivery_log"
          ? "Delivery log"
          : source === "campaign_history"
            ? "Campaign history"
            : source;

  return (
    <Tooltip title={sourceLabel}>
      <Box sx={{ display: "inline-flex" }}>{icon}</Box>
    </Tooltip>
  );
}

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
        <Typography sx={{ fontSize: "0.65rem", fontWeight: 700, color: style.title, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: "1.35rem", fontWeight: 800, color: style.value, mt: 0.25, lineHeight: 1.2 }}>
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

function SourceChip({ legacy, isBackup }) {
  return (
    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", alignItems: "center" }}>
      <Chip
        label={legacy ? "Legacy" : "Queue"}
        size="small"
        sx={{
          fontSize: "0.62rem",
          fontWeight: 700,
          height: 20,
          bgcolor: legacy ? "#FEF3C7" : "#E0F2FE",
          color: legacy ? "#92400E" : "#0369A1",
        }}
      />
      {isBackup && (
        <Chip
          label="Backup"
          size="small"
          sx={{
            fontSize: "0.62rem",
            fontWeight: 700,
            height: 20,
            bgcolor: "#EDE9FE",
            color: "#6D28D9",
          }}
        />
      )}
    </Box>
  );
}

function ReviewerCell({ name, email, isBackup }) {
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: "0.78rem", fontWeight: 700 }}>{name}</Typography>
        {isBackup && (
          <Chip
            label="Backup"
            size="small"
            sx={{
              fontSize: "0.58rem",
              fontWeight: 700,
              height: 18,
              bgcolor: "#EDE9FE",
              color: "#6D28D9",
            }}
          />
        )}
      </Box>
      <Typography sx={{ fontSize: "0.68rem", color: C.textMuted }}>{email}</Typography>
    </Box>
  );
}

function BoardPaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}) {
  const pageCount = Math.max(1, Math.ceil((Number(total) || 0) / pageSize));
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
            {pageSizeOptions.map((n) => (
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

function normalizeFilterEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** Match reviewer board rows to type/status filter chips. */
function reviewerMatchesFilters(row, typeFilter, statusFilter, retryingEmails = null) {
  const type = String(typeFilter || "ALL").toUpperCase();
  const status = String(statusFilter || "ALL").toUpperCase();

  const typeKey =
    type === "LAUNCH"
      ? "launch"
      : type === "REMINDER"
        ? "reminder"
        : type === "ESCALATION"
          ? "escalation"
          : null;

  const cellForType = typeKey
    ? String(row?.[typeKey]?.status || "NONE").toUpperCase()
    : null;

  if (status === "RETRYING") {
    const email = normalizeFilterEmail(row?.recipientEmail);
    if (!retryingEmails || !retryingEmails.has(email)) return false;
    if (typeKey) return cellForType !== "NONE";
    return true;
  }

  if (typeKey) {
    if (status !== "ALL") return cellForType === status;
    return cellForType !== "NONE";
  }

  if (status === "ALL") return true;

  const overall = String(row?.overallStatus || "NONE").toUpperCase();
  if (overall === status) return true;
  return ["launch", "reminder", "escalation"].some(
    (k) => String(row?.[k]?.status || "").toUpperCase() === status,
  );
}

function jobMatchesFilters(job, typeFilter, statusFilter) {
  const type = String(typeFilter || "ALL").toUpperCase();
  const status = String(statusFilter || "ALL").toUpperCase();
  const jobType = String(job?.type || "").toUpperCase();
  const jobStatus = String(job?.status || job?.rawStatus || "").toUpperCase();
  const displayStatus =
    jobStatus === "PENDING" && Number(job?.attempts) > 0 ? "RETRYING" : jobStatus;

  if (type !== "ALL" && jobType !== type) return false;

  if (status === "ALL") return true;
  if (status === "RETRYING") return displayStatus === "RETRYING";
  if (status === "PENDING") return jobStatus === "PENDING" && Number(job?.attempts || 0) === 0;
  return displayStatus === status || jobStatus === status;
}

function timelineMatchesFilters(ev, typeFilter, statusFilter) {
  const type = String(typeFilter || "ALL").toUpperCase();
  const status = String(statusFilter || "ALL").toUpperCase();
  const emailType = String(ev?.emailType || "").toUpperCase();
  const eventType = String(ev?.eventType || "").toUpperCase();

  if (type !== "ALL") {
    if (emailType) {
      if (emailType !== type) return false;
    } else if (!String(ev?.label || "").toUpperCase().includes(type)) {
      return false;
    }
  }

  if (status === "ALL") return true;
  if (status === "FAILED") {
    return eventType.includes("FAIL") || eventType.includes("BOUNCE");
  }
  if (status === "SENT") {
    return eventType.includes("SENT") || eventType.includes("DELIVER");
  }
  if (status === "PENDING" || status === "RETRYING") {
    return eventType.includes("PENDING") || eventType.includes("RETRY");
  }
  return true;
}

/** Currently scheduled retries only (PENDING + attempts > 0 / status RETRYING). */
function buildScheduledRetryRows(jobs, apiRetries) {
  const byId = new Map();

  for (const row of apiRetries || []) {
    const id = row?.id != null ? String(row.id) : null;
    if (!id) continue;
    byId.set(id, {
      id,
      recipientEmail: row.recipientEmail,
      recipientName: row.recipientName,
      type: row.type,
      attempts: row.attempts || 0,
      maxAttempts: row.maxAttempts || 4,
      nextRunAt: row.nextRunAt,
      lastError: row.lastError,
      status: "RETRYING",
    });
  }

  for (const job of jobs || []) {
    if (job?.legacy) continue;
    const raw = String(job.rawStatus || job.status || "").toUpperCase();
    const display = String(job.status || "").toUpperCase();
    const isScheduled =
      display === "RETRYING" ||
      (raw === "PENDING" && Number(job.attempts) > 0);
    if (!isScheduled) continue;

    const id = job.id != null ? String(job.id) : `job-${job.recipientEmail}-${job.type}`;
    byId.set(id, {
      id,
      recipientEmail: job.recipientEmail,
      recipientName: job.recipientName,
      type: job.type,
      attempts: job.attempts || 0,
      maxAttempts: job.maxAttempts || 4,
      nextRunAt: job.nextRunAt || null,
      lastError: job.lastError || null,
      status: "RETRYING",
    });
  }

  return Array.from(byId.values()).sort((a, b) =>
    String(a.recipientName || "").localeCompare(String(b.recipientName || "")),
  );
}

function RetryHelpPanel({ meta }) {
  const policy = meta?.retryPolicy;
  if (!policy) return null;

  return (
    <Accordion
      elevation={0}
      disableGutters
      sx={{
        ...boardCardSx,
        mb: 2,
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 44, px: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <InfoIcon sx={{ fontSize: 18, color: C.info }} />
          <Typography sx={{ fontSize: "0.78rem", fontWeight: 700, color: C.text }}>
            How retries work
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 2, pt: 0, pb: 2 }}>
        <Typography component="div" sx={{ fontSize: "0.74rem", color: C.textMuted }}>
          <strong>Automatic:</strong> Queue jobs retry up to {policy.maxAttempts} times
          ({policy.backoffMinutes?.join(" min, ")} min delays). After that they appear as{" "}
          <strong>Failed</strong>.
        </Typography>
        <Typography component="div" sx={{ fontSize: "0.74rem", color: C.textMuted, mt: 0.75 }}>
          <strong>Manual retry:</strong> On a <strong>Queue</strong> job with status Failed,
          click <strong>Retry</strong> to re-queue it immediately (worker picks it up within ~30s).
        </Typography>
        <Typography component="div" sx={{ fontSize: "0.74rem", color: C.textMuted, mt: 0.75 }}>
          <strong>Legacy sends</strong> cannot be retried from this tab — use the campaign{" "}
          <strong>Reminder</strong> button to send again via the queue.
        </Typography>
      </AccordionDetails>
    </Accordion>
  );
}

function jobRowKey(job, index) {
  if (job.id) return String(job.id);
  return `legacy-${job.recipientEmail}-${job.type}-${job.sentAt || index}`;
}

function canRetryJob(job) {
  if (job?.canRetry === false) return false;
  return Boolean(job?.id) && !job?.legacy;
}

function showRetryButton(job) {
  if (!canRetryJob(job)) return false;
  const status = String(job.status || job.rawStatus || "").toUpperCase();
  return status === "FAILED" || status === "RETRYING" || status === "PENDING";
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
        bgcolor: "#fff",
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

function JobQueueTable({
  jobs,
  emptyMessage,
  showJobId = false,
  retryingId,
  onRetry,
  onViewLog,
}) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            {showJobId && <TableCell sx={tableHeadCellSx}>Job ID</TableCell>}
            <TableCell sx={tableHeadCellSx}>Type</TableCell>
            <TableCell sx={tableHeadCellSx}>Reviewer</TableCell>
            <TableCell sx={tableHeadCellSx}>Source</TableCell>
            <TableCell sx={tableHeadCellSx}>Status</TableCell>
            <TableCell sx={tableHeadCellSx}>Attempts</TableCell>
            <TableCell sx={tableHeadCellSx}>Next Retry</TableCell>
            <TableCell sx={tableHeadCellSx}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {jobs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showJobId ? 8 : 7} align="center" sx={{ py: 4, color: C.textMuted }}>
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            jobs.map((job, idx) => (
              <TableRow key={jobRowKey(job, idx)} hover>
                {showJobId && (
                  <TableCell sx={{ fontSize: "0.68rem", fontFamily: "monospace", color: C.textMuted }}>
                    {job.id ? String(job.id).slice(-8) : "—"}
                  </TableCell>
                )}
                <TableCell sx={{ fontSize: "0.75rem", fontWeight: 600 }}>{job.type}</TableCell>
                <TableCell>
                  <ReviewerCell
                    name={job.recipientName}
                    email={job.recipientEmail}
                    isBackup={job.isBackupReviewer}
                  />
                </TableCell>
                <TableCell><SourceChip legacy={job.legacy} isBackup={job.isBackupReviewer} /></TableCell>
                <TableCell><StatusChip status={job.status} /></TableCell>
                <TableCell sx={{ fontSize: "0.75rem" }}>
                  {job.legacy ? (
                    <Tooltip title="Legacy send — not tracked in queue attempts">
                      <span>—</span>
                    </Tooltip>
                  ) : (
                    `${job.attempts}/${job.maxAttempts}`
                  )}
                </TableCell>
                <TableCell sx={{ fontSize: "0.75rem" }}>
                  {!job.legacy &&
                  (job.status === "RETRYING" || (job.rawStatus === "PENDING" && job.attempts > 0))
                    ? fmtDate(job.nextRunAt)
                    : "—"}
                </TableCell>
                <TableCell>
                  <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                    {showRetryButton(job) && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="warning"
                        startIcon={retryingId === job.id ? <CircularProgress size={12} /> : <RetryIcon />}
                        onClick={() => onRetry(job.id)}
                        disabled={retryingId === job.id}
                        sx={{ textTransform: "none", fontSize: "0.68rem" }}
                      >
                        Retry
                      </Button>
                    )}
                    {canRetryJob(job) && (
                      <Button
                        size="small"
                        startIcon={<LogIcon sx={{ fontSize: 14 }} />}
                        onClick={() => onViewLog(job.id)}
                        sx={{ textTransform: "none", fontSize: "0.68rem" }}
                      >
                        View Log
                      </Button>
                    )}
                    {job.legacy && (
                      <Typography sx={{ fontSize: "0.62rem", color: C.textMuted, alignSelf: "center" }}>
                        Read-only
                      </Typography>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function FailedTable({ rows, emptyMessage, retryingId, onRetry }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={tableHeadCellSx}>Reviewer</TableCell>
            <TableCell sx={tableHeadCellSx}>Error</TableCell>
            <TableCell sx={tableHeadCellSx} />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} align="center" sx={{ py: 3, color: C.textMuted }}>
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((job, idx) => (
              <TableRow key={jobRowKey(job, idx)} hover>
                <TableCell sx={{ fontSize: "0.75rem" }}>
                  <ReviewerCell
                    name={job.recipientName}
                    email={job.recipientEmail}
                    isBackup={job.isBackupReviewer}
                  />
                  <SourceChip legacy={job.legacy} isBackup={job.isBackupReviewer} />
                </TableCell>
                <TableCell sx={{ fontSize: "0.72rem", color: C.revoked, maxWidth: 220 }}>
                  <Tooltip title={job.lastError || "Unknown error"}>
                    <span>{(job.lastError || "Unknown error").slice(0, 60)}</span>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  {showRetryButton(job) ? (
                    <Button
                      size="small"
                      variant="outlined"
                      color="warning"
                      startIcon={retryingId === job.id ? <CircularProgress size={12} /> : <RetryIcon />}
                      onClick={() => onRetry(job.id)}
                      disabled={retryingId === job.id}
                      sx={{ textTransform: "none", fontSize: "0.68rem" }}
                    >
                      Retry now
                    </Button>
                  ) : (
                    <Tooltip title="Legacy failed sends must be re-sent using the campaign Reminder button">
                      <Typography sx={{ fontSize: "0.65rem", color: C.textMuted }}>
                        Use Reminder button
                      </Typography>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default function ReviewNotifications({ campaign, onRefresh, active = true }) {
  const campaignId = campaign?._id || campaign?.id;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [retryingId, setRetryingId] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: "" });
  const [logOpen, setLogOpen] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [logData, setLogData] = useState(null);
  const [logError, setLogError] = useState(null);

  const [reviewerPage, setReviewerPage] = useState(1);
  const [reviewerPageSize, setReviewerPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [queuePage, setQueuePage] = useState(1);
  const [queuePageSize, setQueuePageSize] = useState(DEFAULT_PAGE_SIZE);
  const [failedPage, setFailedPage] = useState(1);
  const [failedPageSize, setFailedPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [retryPage, setRetryPage] = useState(1);
  const [retryPageSize, setRetryPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelinePageSize, setTimelinePageSize] = useState(DEFAULT_PAGE_SIZE);

  // Load full campaign notification payload (no type/status query).
  // Filters are applied client-side so KPI cards stay campaign-true and boards stay in sync.
  const load = useCallback(async (silent = false) => {
    if (!campaignId) return;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await accessCertificationService.getCampaignNotifications(campaignId, {
        limit: 500,
      });
      if (res.success) {
        setData(res.data);
      } else {
        setError(res.error || "Failed to load notifications");
      }
    } catch (e) {
      setError(e.message || "Failed to load notifications");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [campaignId]);

  useEffect(() => {
    if (!active || !campaignId) return;
    setTypeFilter("ALL");
    setStatusFilter("ALL");
    load(false);
  }, [load, active, campaignId]);

  useEffect(() => {
    setReviewerPage(1);
    setQueuePage(1);
    setFailedPage(1);
    setRetryPage(1);
    setTimelinePage(1);
  }, [typeFilter, statusFilter, campaignId]);

  const clearFilters = () => {
    setTypeFilter("ALL");
    setStatusFilter("ALL");
  };

  const filtersActive = typeFilter !== "ALL" || statusFilter !== "ALL";

  const handleRetry = async (jobId) => {
    if (!jobId) return;
    setRetryingId(jobId);
    const res = await accessCertificationService.retryNotificationJob(jobId, campaignId);
    setRetryingId(null);
    if (res.success) {
      setSnackbar({ open: true, message: "Retry scheduled" });
      load(true);
      if (onRefresh) onRefresh();
    } else {
      setSnackbar({ open: true, message: res.error || "Retry failed" });
    }
  };

  const handleViewLog = async (jobId) => {
    if (!jobId) return;
    setLogOpen(true);
    setLogLoading(true);
    setLogData(null);
    setLogError(null);
    const res = await accessCertificationService.getNotificationJobLog(campaignId, jobId);
    setLogLoading(false);
    if (res.success) {
      setLogData(res.data);
    } else {
      setLogError(res.error || "Failed to load job log");
    }
  };

  const closeLogModal = () => {
    setLogOpen(false);
    setLogData(null);
    setLogError(null);
  };

  const summary = data?.summary || {};
  const byReviewer = data?.byReviewer || [];
  const jobs = data?.jobs || [];
  const failed = data?.failed || [];
  const retries = data?.retries || [];
  const timeline = data?.timeline || [];
  const meta = data?.meta || null;

  const scheduledRetries = useMemo(
    () => buildScheduledRetryRows(jobs, retries),
    [jobs, retries],
  );

  const retryingEmails = useMemo(() => {
    const set = new Set();
    for (const row of scheduledRetries) {
      const email = normalizeFilterEmail(row.recipientEmail);
      if (email) set.add(email);
    }
    return set;
  }, [scheduledRetries]);

  const filteredByReviewer = useMemo(
    () =>
      byReviewer.filter((row) =>
        reviewerMatchesFilters(row, typeFilter, statusFilter, retryingEmails),
      ),
    [byReviewer, typeFilter, statusFilter, retryingEmails],
  );

  const filteredJobs = useMemo(
    () => jobs.filter((job) => jobMatchesFilters(job, typeFilter, statusFilter)),
    [jobs, typeFilter, statusFilter],
  );

  const queueJobs = useMemo(
    () => filteredJobs.filter((j) => !j.legacy),
    [filteredJobs],
  );
  const legacyJobs = useMemo(
    () => filteredJobs.filter((j) => j.legacy),
    [filteredJobs],
  );

  const filteredFailed = useMemo(() => {
    if (statusFilter !== "ALL" && statusFilter !== "FAILED") return [];
    return failed.filter((job) => jobMatchesFilters(job, typeFilter, "FAILED"));
  }, [failed, typeFilter, statusFilter]);

  const queueFailed = useMemo(
    () => filteredFailed.filter((j) => !j.legacy),
    [filteredFailed],
  );
  const legacyFailed = useMemo(
    () => failed.filter((j) => j.legacy),
    [failed],
  );

  const filteredRetries = useMemo(() => {
    const type = String(typeFilter || "ALL").toUpperCase();
    const status = String(statusFilter || "ALL").toUpperCase();
    return scheduledRetries.filter((row) => {
      if (type !== "ALL" && String(row.type || "").toUpperCase() !== type) return false;
      // Retry board only has currently scheduled rows; hide when filtering to Sent/Failed
      if (status === "SENT" || status === "FAILED") return false;
      return true;
    });
  }, [scheduledRetries, typeFilter, statusFilter]);

  const filteredTimeline = useMemo(
    () => timeline.filter((ev) => timelineMatchesFilters(ev, typeFilter, statusFilter)),
    [timeline, typeFilter, statusFilter],
  );

  // Campaign-scoped health — same meaning as KPI "Retrying"
  const campaignPending =
    (Number(summary.pending) || 0) + (Number(summary.processing) || 0);
  const campaignFailed = Number(summary.failed) || 0;
  const campaignRetrying = Math.max(
    Number(summary.retrying) || 0,
    scheduledRetries.length,
  );

  const reviewerPaging = useClientPaging(filteredByReviewer, reviewerPage, reviewerPageSize);
  const queuePaging = useClientPaging(queueJobs, queuePage, queuePageSize);
  const failedPaging = useClientPaging(queueFailed, failedPage, failedPageSize);
  const retryPaging = useClientPaging(filteredRetries, retryPage, retryPageSize);
  const timelinePaging = useClientPaging(filteredTimeline, timelinePage, timelinePageSize);

  const legacyOnly =
    Number(summary.totalJobs) === 0 && Number(summary.legacySent) > 0;
  const eventsSubtitle =
    legacyOnly && summary.totalEvents
      ? `${summary.totalEvents} total events (${summary.legacySent} legacy)`
      : null;

  const handleExportCsv = () => {
    const campaignSlug = String(campaign?.name || campaignId || "campaign")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 40);
    const reviewerHeaders = [
      "Reviewer",
      "Email",
      "Launch",
      "Reminder",
      "Escalation",
      "Reminder Count",
      "Last Reminder",
      "Last Sent",
      "Overall Status",
    ];
    const reviewerRows = byReviewer.map((row) => [
      row.recipientName,
      row.recipientEmail,
      row.launch?.status || "NONE",
      row.reminder?.status || "NONE",
      row.escalation?.status || "NONE",
      row.reminderCount ?? 0,
      row.lastReminderAt ? new Date(row.lastReminderAt).toISOString() : "",
      row.lastSentAt ? new Date(row.lastSentAt).toISOString() : "",
      row.overallStatus || "NONE",
    ]);
    const jobHeaders = [
      "Type",
      "Reviewer",
      "Email",
      "Source",
      "Status",
      "Attempts",
      "Max Attempts",
      "Sent At",
      "Error",
    ];
    const jobRows = jobs.map((job) => [
      job.type,
      job.recipientName,
      job.recipientEmail,
      job.legacy ? "Legacy" : "Queue",
      job.status,
      job.attempts,
      job.maxAttempts,
      job.sentAt ? new Date(job.sentAt).toISOString() : "",
      job.lastError || "",
    ]);
    downloadCsv(`${campaignSlug}_notification_reviewers.csv`, [
      reviewerHeaders,
      ...reviewerRows,
    ]);
    if (jobRows.length > 0) {
      downloadCsv(`${campaignSlug}_notification_jobs.csv`, [
        jobHeaders,
        ...jobRows,
      ]);
    }
  };

  if (loading && !data) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, overflowY: "auto", px: { xs: 0.5, md: 1 }, pb: 3 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

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
          <Typography sx={{ fontSize: "0.95rem", fontWeight: 800, color: C.text }}>
            Notification board
          </Typography>
          <Typography sx={{ fontSize: "0.7rem", color: C.textMuted, mt: 0.25 }}>
            Delivery status by reviewer, queue jobs, and retry activity for this campaign.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label={`${campaignPending} pending/processing`}
              sx={{ height: 22, fontSize: "0.65rem", fontWeight: 700, bgcolor: "#F1F5F9" }}
            />
            <Chip
              size="small"
              label={`${campaignFailed} failed`}
              sx={{
                height: 22,
                fontSize: "0.65rem",
                fontWeight: 700,
                bgcolor: campaignFailed > 0 ? C.revokedBg : "#F1F5F9",
                color: campaignFailed > 0 ? C.revoked : C.textMuted,
              }}
            />
            <Chip
              size="small"
              label={`${campaignRetrying} retrying`}
              sx={{ height: 22, fontSize: "0.65rem", fontWeight: 700, bgcolor: C.pendingBg, color: C.pending }}
            />
          </Stack>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleExportCsv}
            disabled={!data}
            sx={{ textTransform: "none", fontWeight: 700 }}
          >
            Export CSV
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={refreshing ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon />}
            onClick={() => load(true)}
            disabled={refreshing}
            sx={{ textTransform: "none", fontWeight: 700, bgcolor: AC_PALETTE.accent, "&:hover": { bgcolor: AC_PALETTE.accentHover } }}
          >
            Refresh
          </Button>
        </Stack>
      </Paper>

      {legacyOnly && (
        <Alert severity="info" sx={{ mb: 2, fontSize: "0.78rem" }}>
          This campaign has reminder activity recorded before the email queue was enabled.
          <strong> Legacy</strong> rows reflect those sends; new reminders will appear as{" "}
          <strong>Queue</strong> jobs and support automatic/manual retry.
        </Alert>
      )}

      <RetryHelpPanel meta={meta} />

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={6} sm={4} md={2.4}>
          <MetricCard label="Total Jobs" value={summary.totalJobs} tone="primary" subtitle={eventsSubtitle} />
        </Grid>
        <Grid item xs={6} sm={4} md={2.4}>
          <MetricCard
            label="Sent"
            value={summary.sent}
            tone="success"
            subtitle={legacyOnly ? `${summary.legacySent || 0} from legacy` : undefined}
          />
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
            value={campaignRetrying}
            tone="warning"
            subtitle="currently waiting to retry"
          />
        </Grid>
      </Grid>

      <Paper elevation={0} sx={{ ...boardCardSx, mb: 2, px: 2, py: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1, flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: "0.68rem", fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Filters
          </Typography>
          {filtersActive && (
            <Button size="small" onClick={clearFilters} sx={{ textTransform: "none", fontWeight: 700, fontSize: "0.72rem" }}>
              Clear filters
            </Button>
          )}
        </Box>
        {filtersActive && (
          <Typography sx={{ fontSize: "0.7rem", color: C.textMuted, mb: 1 }}>
            Active filter
            {typeFilter !== "ALL" ? ` · ${typeFilter.charAt(0)}${typeFilter.slice(1).toLowerCase()}` : ""}
            {statusFilter !== "ALL" ? ` · ${statusFilter.charAt(0)}${statusFilter.slice(1).toLowerCase()}` : ""}
            {" "}applied to reviewer status, queue, failed, retries, and timeline.
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
              <ToggleButton key={f} value={f} sx={{ textTransform: "none", fontWeight: 700, fontSize: "0.72rem", px: 1.25 }}>
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
              <ToggleButton key={f} value={f} sx={{ textTransform: "none", fontWeight: 700, fontSize: "0.72rem", px: 1.25 }}>
                {f === "ALL" ? "All status" : f.charAt(0) + f.slice(1).toLowerCase()}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Paper>

      <Card elevation={0} sx={{ ...boardCardSx, mb: 2 }}>
        <BoardSectionHeader
          icon={<EmailIcon sx={{ fontSize: 18, color: C.info }} />}
          title="Reviewer notification status"
          count={filteredByReviewer.length}
          subtitle="Launch, reminder, and escalation delivery per reviewer"
        />
        <TableContainer sx={{ maxHeight: 440 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={tableHeadCellSx}>Reviewer</TableCell>
                <TableCell align="center" sx={tableHeadCellSx}>Launch</TableCell>
                <TableCell align="center" sx={tableHeadCellSx}>Reminder</TableCell>
                <TableCell align="center" sx={tableHeadCellSx}>Escalation</TableCell>
                <TableCell align="center" sx={tableHeadCellSx}>Reminders</TableCell>
                <TableCell sx={tableHeadCellSx}>Last Sent</TableCell>
                <TableCell sx={tableHeadCellSx}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reviewerPaging.paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: C.textMuted }}>
                    {filtersActive
                      ? "No reviewers match the selected filters."
                      : "No notification records for reviewers yet."}
                  </TableCell>
                </TableRow>
              ) : (
                reviewerPaging.paged.map((row) => (
                  <TableRow key={row.recipientEmail} hover>
                    <TableCell>
                      <ReviewerCell
                        name={row.recipientName}
                        email={row.recipientEmail}
                        isBackup={row.isBackupReviewer}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <TypeIcon sent={row.launch?.sent} status={row.launch?.status} source={row.launch?.source} />
                    </TableCell>
                    <TableCell align="center">
                      <TypeIcon sent={row.reminder?.sent} status={row.reminder?.status} source={row.reminder?.source} />
                    </TableCell>
                    <TableCell align="center">
                      <TypeIcon sent={row.escalation?.sent} status={row.escalation?.status} source={row.escalation?.source} />
                    </TableCell>
                    <TableCell align="center" sx={{ fontSize: "0.75rem" }}>{row.reminderCount ?? 0}</TableCell>
                    <TableCell sx={{ fontSize: "0.75rem" }}>{fmtShortDate(row.lastSentAt)}</TableCell>
                    <TableCell><StatusChip status={row.overallStatus} /></TableCell>
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

      <Card elevation={0} sx={{ ...boardCardSx, mb: 2 }}>
        <BoardSectionHeader
          icon={<QueueIcon sx={{ fontSize: 18, color: C.info }} />}
          title="Queue notifications"
          count={queueJobs.length}
          subtitle="Active email jobs — automatic retry and manual Retry supported"
        />
        <JobQueueTable
          jobs={queuePaging.paged}
          showJobId
          emptyMessage={
            legacyJobs.length > 0
              ? "No queue jobs match filters. Expand Legacy Notifications below for pre-queue sends."
              : filtersActive
                ? "No queue jobs match the selected filters."
                : "No queue jobs yet. Use Reminder on the campaign to enqueue a new send."
          }
          retryingId={retryingId}
          onRetry={handleRetry}
          onViewLog={handleViewLog}
        />
        <BoardPaginationBar
          page={queuePaging.safePage}
          pageSize={queuePageSize}
          total={queuePaging.total}
          onPageChange={setQueuePage}
          onPageSizeChange={(n) => {
            setQueuePageSize(n);
            setQueuePage(1);
          }}
        />
      </Card>

      {(legacyJobs.length > 0 || legacyFailed.length > 0) && (
        <Accordion
          defaultExpanded={false}
          elevation={0}
          sx={{
            ...boardCardSx,
            mb: 2,
            "&:before": { display: "none" },
            bgcolor: "#FFFBEB",
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <HistoryIcon sx={{ fontSize: 18, color: "#92400E" }} />
              <Typography sx={{ fontSize: "0.85rem", fontWeight: 800, color: "#92400E" }}>
                Legacy notifications
              </Typography>
              <Chip
                label={`${legacyJobs.length + legacyFailed.length} historical`}
                size="small"
                sx={{ height: 20, fontSize: "0.62rem", fontWeight: 700, bgcolor: "#FEF3C7", color: "#92400E" }}
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Typography sx={{ fontSize: "0.72rem", color: C.textMuted, mb: 1.5 }}>
              Sent before the email queue existed. Read-only — use the campaign Reminder button to create new Queue jobs.
            </Typography>
            {legacyJobs.length > 0 && (
              <Card elevation={0} sx={{ border: `1px solid #FDE68A`, borderRadius: 2, mb: legacyFailed.length ? 2 : 0 }}>
                <JobQueueTable
                  jobs={legacyJobs}
                  emptyMessage="No legacy jobs match filters."
                  retryingId={retryingId}
                  onRetry={handleRetry}
                  onViewLog={handleViewLog}
                />
              </Card>
            )}
            {legacyFailed.length > 0 && (
              <>
                <Typography sx={{ fontSize: "0.78rem", fontWeight: 700, color: C.revoked, mb: 1 }}>
                  Legacy failures
                </Typography>
                <Card elevation={0} sx={{ border: `1px solid #FECACA`, borderRadius: 2 }}>
                  <FailedTable
                    rows={legacyFailed}
                    emptyMessage="No legacy failures."
                    retryingId={retryingId}
                    onRetry={handleRetry}
                  />
                </Card>
              </>
            )}
          </AccordionDetails>
        </Accordion>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={6}>
          <Card elevation={0} sx={{ ...boardCardSx, height: "100%" }}>
            <BoardSectionHeader
              icon={<FailIcon sx={{ fontSize: 18, color: C.revoked }} />}
              title="Failed notifications"
              count={queueFailed.length}
              subtitle="Queue failures — use Retry now"
            />
            <FailedTable
              rows={failedPaging.paged}
              emptyMessage={
                filtersActive
                  ? "No failed jobs match the selected filters."
                  : "No failed queue notifications"
              }
              retryingId={retryingId}
              onRetry={handleRetry}
            />
            <BoardPaginationBar
              page={failedPaging.safePage}
              pageSize={failedPageSize}
              total={failedPaging.total}
              onPageChange={setFailedPage}
              onPageSizeChange={(n) => {
                setFailedPageSize(n);
                setFailedPage(1);
              }}
            />
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card elevation={0} sx={{ ...boardCardSx, height: "100%" }}>
            <BoardSectionHeader
              icon={<RetryIcon sx={{ fontSize: 18, color: C.pending }} />}
              title="Retrying now"
              count={filteredRetries.length}
              subtitle="Jobs currently waiting for the next automatic retry"
            />
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={tableHeadCellSx}>Reviewer</TableCell>
                    <TableCell sx={tableHeadCellSx}>Type</TableCell>
                    <TableCell sx={tableHeadCellSx}>Attempt</TableCell>
                    <TableCell sx={tableHeadCellSx}>Status</TableCell>
                    <TableCell sx={tableHeadCellSx}>Next Retry</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {retryPaging.paged.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ py: 3, color: C.textMuted }}>
                        {filtersActive
                          ? "No retrying jobs match the selected filters."
                          : "No jobs are currently retrying"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    retryPaging.paged.map((row) => (
                      <TableRow key={row.id} hover>
                        <TableCell sx={{ fontSize: "0.75rem" }}>
                          <ReviewerCell name={row.recipientName} email={row.recipientEmail} />
                        </TableCell>
                        <TableCell sx={{ fontSize: "0.75rem", fontWeight: 600 }}>{row.type}</TableCell>
                        <TableCell sx={{ fontSize: "0.75rem" }}>{row.attempts}/{row.maxAttempts}</TableCell>
                        <TableCell><StatusChip status="RETRYING" /></TableCell>
                        <TableCell sx={{ fontSize: "0.75rem" }}>{fmtDate(row.nextRunAt)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <BoardPaginationBar
              page={retryPaging.safePage}
              pageSize={retryPageSize}
              total={retryPaging.total}
              onPageChange={setRetryPage}
              onPageSizeChange={(n) => {
                setRetryPageSize(n);
                setRetryPage(1);
              }}
            />
          </Card>
        </Grid>
      </Grid>

      <Card elevation={0} sx={boardCardSx}>
        <BoardSectionHeader
          icon={<TimelineIcon sx={{ fontSize: 18, color: C.info }} />}
          title="Delivery timeline"
          count={filteredTimeline.length}
          subtitle="Audit trail of notification events"
        />
        <Box sx={{ px: 2, py: 1 }}>
          {timelinePaging.paged.length === 0 ? (
            <Typography sx={{ fontSize: "0.78rem", color: C.textMuted, textAlign: "center", py: 3 }}>
              {filtersActive
                ? "No timeline events match the selected filters."
                : "No delivery events recorded yet."}
            </Typography>
          ) : (
            timelinePaging.paged.map((ev, idx) => (
              <Box key={`${ev.at}-${idx}`}>
                <Box sx={{ display: "flex", gap: 2, py: 1.1 }}>
                  <Typography sx={{ fontSize: "0.72rem", color: C.textMuted, minWidth: 140, flexShrink: 0 }}>
                    {fmtDate(ev.at)}
                  </Typography>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: "0.78rem", fontWeight: 700, color: C.text }}>
                      {ev.label}
                      {ev.emailType ? ` · ${ev.emailType}` : ""}
                    </Typography>
                    {ev.recipientEmail && (
                      <Typography sx={{ fontSize: "0.68rem", color: C.textMuted }}>
                        {ev.recipientEmail}
                      </Typography>
                    )}
                  </Box>
                </Box>
                {idx < timelinePaging.paged.length - 1 && <Divider />}
              </Box>
            ))
          )}
        </Box>
        <BoardPaginationBar
          page={timelinePaging.safePage}
          pageSize={timelinePageSize}
          total={timelinePaging.total}
          onPageChange={setTimelinePage}
          onPageSizeChange={(n) => {
            setTimelinePageSize(n);
            setTimelinePage(1);
          }}
        />
      </Card>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={2500}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />

      <Dialog open={logOpen} onClose={closeLogModal} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1 }}>
          Email Job Log
          <IconButton size="small" onClick={closeLogModal} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {logLoading && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          )}
          {!logLoading && logError && (
            <Alert severity="error">{logError}</Alert>
          )}
          {!logLoading && logData && (
            <Box>
              <Typography sx={{ fontSize: "0.78rem", fontWeight: 700, mb: 1 }}>Job</Typography>
              <Box sx={{ mb: 2, p: 1.5, bgcolor: "#F8FAFC", borderRadius: 1 }}>
                <Typography sx={{ fontSize: "0.75rem" }}>
                  <strong>Type:</strong> {logData.job?.type} · <strong>Status:</strong> {logData.job?.status}
                </Typography>
                <Typography sx={{ fontSize: "0.75rem" }}>
                  <strong>Reviewer:</strong> {logData.job?.recipientEmail}
                </Typography>
                <Typography sx={{ fontSize: "0.75rem" }}>
                  <strong>Attempts:</strong> {logData.job?.attempts}/{logData.job?.maxAttempts}
                </Typography>
                {logData.job?.lastError && (
                  <Typography sx={{ fontSize: "0.75rem", color: C.revoked, mt: 0.5 }}>
                    <strong>Error:</strong> {logData.job.lastError}
                  </Typography>
                )}
              </Box>

              <Typography sx={{ fontSize: "0.78rem", fontWeight: 700, mb: 1 }}>
                Delivery logs ({logData.deliveryLogs?.length || 0})
              </Typography>
              {(logData.deliveryLogs || []).length === 0 ? (
                <Typography sx={{ fontSize: "0.72rem", color: C.textMuted, mb: 2 }}>None recorded</Typography>
              ) : (
                (logData.deliveryLogs || []).map((dl, i) => (
                  <Box key={dl._id || i} sx={{ mb: 1, fontSize: "0.72rem" }}>
                    {fmtDate(dl.deliveredAt)} — {dl.deliveryStatus}
                    {dl.errorMessage ? ` · ${dl.errorMessage}` : ""}
                  </Box>
                ))
              )}

              <Typography sx={{ fontSize: "0.78rem", fontWeight: 700, mb: 1, mt: 2 }}>
                Audit events ({logData.auditEvents?.length || 0})
              </Typography>
              {(logData.auditEvents || []).length === 0 ? (
                <Typography sx={{ fontSize: "0.72rem", color: C.textMuted, mb: 2 }}>None recorded</Typography>
              ) : (
                (logData.auditEvents || []).map((ev, i) => (
                  <Box key={ev._id || i} sx={{ mb: 1, fontSize: "0.72rem" }}>
                    {fmtDate(ev.createdAt)} — {ev.eventType}
                    {ev.recipientEmail ? ` · ${ev.recipientEmail}` : ""}
                  </Box>
                ))
              )}

              {(logData.timeline || []).length > 0 && (
                <>
                  <Typography sx={{ fontSize: "0.78rem", fontWeight: 700, mb: 1, mt: 2 }}>
                    Timeline
                  </Typography>
                  {(logData.timeline || []).map((ev, idx) => (
                    <Box key={`${ev.at}-${idx}`} sx={{ fontSize: "0.72rem", mb: 0.5 }}>
                      {fmtDate(ev.at)} — {ev.label}
                    </Box>
                  ))}
                </>
              )}
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
