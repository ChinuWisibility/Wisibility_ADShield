import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Add, Close, Refresh, Visibility } from "@mui/icons-material";
import DataTable from "../../components/DataTable";
import StatusChip from "../../components/StatusChip";
import RemediationTrackingTimeline from "../../components/remediation/RemediationTrackingTimeline";
import QueueItemsGrid from "../../components/remediation/QueueItemsGrid";
import CreateTicketModal from "../../components/remediation/CreateTicketModal";
import RemediationNewEventDialog from "./RemediationNewEventDialog";
import { remediationAPI } from "../../services/remediationService";
import { palette } from "../../theme/palette";

const EVENT_TYPES = [
  "REVOKE_ACCESS",
  "MISSING_MANAGER",
  "ORPHAN_ACCOUNT",
  "INACTIVE_USER_ACCESS",
];

const QUEUE_STATUSES = [
  "PENDING",
  "TICKET_CREATED",
  "VALIDATION_PENDING",
  "VALIDATED",
  "FAILED",
  "EXPIRED",
  "CLOSED",
];

const EVENT_ACCENT = {
  REVOKE_ACCESS: "#dc2626",
  MISSING_MANAGER: "#d97706",
  ORPHAN_ACCOUNT: "#7c3aed",
  INACTIVE_USER_ACCESS: "#0891b2",
};

function labelize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function RemediationQueue() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pagination, setPagination] = useState({ page: 0, limit: 25, total: 0 });
  const [filters, setFilters] = useState({
    eventType: "",
    status: "",
    search: "",
  });

  const [drawer, setDrawer] = useState({ open: false, queue: null, tracking: null, items: [] });
  const [itemsLoading, setItemsLoading] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState(new Set());
  const [selectedItemMap, setSelectedItemMap] = useState(new Map());
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [summary, setSummary] = useState({
    total: 0,
    byStatus: {},
    withTicket: 0,
  });

  const statCounts = useMemo(() => {
    const byStatus = summary.byStatus || {};
    return {
      PENDING: byStatus.PENDING || 0,
      TICKET_CREATED: byStatus.TICKET_CREATED || 0,
      VALIDATION_PENDING: byStatus.VALIDATION_PENDING || 0,
      VALIDATED: byStatus.VALIDATED || 0,
      withTicket: summary.withTicket || 0,
    };
  }, [summary]);

  const showCertificationColumn = useMemo(
    () => !filters.eventType || filters.eventType === "REVOKE_ACCESS" || rows.some((r) => r.eventType === "REVOKE_ACCESS"),
    [filters.eventType, rows],
  );

  const load = useCallback(
    async (page = pagination.page, limit = pagination.limit) => {
      setLoading(true);
      setError("");
      try {
        const res = await remediationAPI.listQueue({
          page: page + 1,
          limit,
          eventType: filters.eventType || undefined,
          status: filters.status || undefined,
          search: filters.search || undefined,
        });
        setRows(res.data?.data || []);
        setPagination({
          page,
          limit,
          total: res.data?.pagination?.total || 0,
        });
      } catch (e) {
        setError(e.response?.data?.error?.message || "Failed to load remediation queue.");
      } finally {
        setLoading(false);
      }
    },
    [filters, pagination.page, pagination.limit],
  );

  const loadSummary = useCallback(async () => {
    try {
      const res = await remediationAPI.getQueueSummary();
      setSummary(res.data?.data || { total: 0, byStatus: {}, withTicket: 0 });
    } catch {
      // non-blocking
    }
  }, []);

  useEffect(() => {
    load();
    loadSummary();
  }, [load, loadSummary]);

  const openDrawer = async (queue) => {
    setDrawer({ open: true, queue, tracking: null, items: [] });
    setSelectedItemIds(new Set());
    setSelectedItemMap(new Map());
    setItemsLoading(true);
    try {
      const [trackingRes, itemsRes] = await Promise.all([
        remediationAPI.getTracking(queue.eventId).catch(() => ({ data: {} })),
        remediationAPI.getQueueItems(queue._id, { limit: 100 }),
      ]);
      setDrawer((d) => ({
        ...d,
        tracking: trackingRes.data?.data || null,
        items: itemsRes.data?.data || [],
      }));
    } catch {
      // non-blocking
    } finally {
      setItemsLoading(false);
    }
  };

  const handleCreateTicket = async (form) => {
    if (!drawer.queue) return;
    setTicketSubmitting(true);
    try {
      await remediationAPI.createTicketFromQueue(drawer.queue._id, {
        ...form,
        selectedQueueItemIds: Array.from(selectedItemIds),
      });
      setCreateTicketOpen(false);
      setDrawer({ open: false, queue: null, tracking: null, items: [] });
      load();
      loadSummary();
    } catch (e) {
      throw e;
    } finally {
      setTicketSubmitting(false);
    }
  };

  const hasTicket = (row) =>
    Boolean(row.ticketCreated || row.ticketId || ["TICKET_CREATED", "VALIDATION_PENDING", "VALIDATED"].includes(row.status));

  const baseColumns = [
    {
      field: "eventId",
      headerName: "Event ID",
      width: 180,
      renderCell: (row) => (
        <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: "monospace" }}>
          {row.eventId}
        </Typography>
      ),
    },
    {
      field: "eventType",
      headerName: "Event Type",
      width: 160,
      renderCell: (row) => (
        <Chip
          label={labelize(row.eventType)}
          size="small"
          sx={{
            fontWeight: 600,
            bgcolor: `${EVENT_ACCENT[row.eventType] || "#64748b"}18`,
            color: EVENT_ACCENT[row.eventType] || "#64748b",
            border: `1px solid ${EVENT_ACCENT[row.eventType] || "#64748b"}40`,
          }}
        />
      ),
    },
    {
      field: "applicationName",
      headerName: "Application",
      width: 160,
      renderCell: (row) => row.applicationName || "—",
    },
    {
      field: "subjectCount",
      headerName: "Subjects",
      width: 90,
      renderCell: (row) => row.revokedUsersCount ?? row.subjectCount ?? 0,
    },
    {
      field: "status",
      headerName: "Queue Status",
      width: 150,
      renderCell: (row) => (
        <Stack spacing={0.25}>
          <StatusChip status={row.status} label={labelize(row.status)} size="small" />
          {hasTicket(row) && (
            <Typography variant="caption" color="primary.main" sx={{ fontWeight: 600 }}>
              Ticket linked
            </Typography>
          )}
        </Stack>
      ),
    },
    {
      field: "queuedAt",
      headerName: "Queue Date",
      width: 120,
      renderCell: (row) =>
        row.queuedAt ? new Date(row.queuedAt).toLocaleDateString() : "—",
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 200,
      renderCell: (row) => (
        <Stack direction="row" spacing={0.5}>
          <Button
            size="small"
            startIcon={<Visibility fontSize="small" />}
            onClick={(e) => {
              e.stopPropagation();
              openDrawer(row);
            }}
            sx={{ textTransform: "none" }}
          >
            View
          </Button>
          {!hasTicket(row) && row.status === "PENDING" && (
            <Button
              size="small"
              variant="contained"
              onClick={(e) => {
                e.stopPropagation();
                openDrawer(row);
              }}
              sx={{ textTransform: "none" }}
            >
              Ticket
            </Button>
          )}
        </Stack>
      ),
    },
  ];

  const certificationColumn = {
    field: "certificationName",
    headerName: "Certification Campaign",
    width: 220,
    renderCell: (row) => (
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {row.certificationName || "—"}
      </Typography>
    ),
  };

  const columns = showCertificationColumn
    ? [baseColumns[0], certificationColumn, ...baseColumns.slice(1)]
    : baseColumns;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" mb={2} spacing={2}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Remediation Queue
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Central intake for detection-driven remediation events before ticket creation.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button
            variant="outlined"
            disabled={syncLoading}
            onClick={async () => {
              setSyncLoading(true);
              setError("");
              setSuccess("");
              try {
                const res = await remediationAPI.syncAllQueues();
                const data = res.data?.data || {};
                const ra = data.revokeAccess || {};
                const mm = Array.isArray(data.missingManager) ? data.missingManager.length : 0;
                setSuccess(
                  `Sync complete — Revoke access: ${ra.ingested ?? 0} added (${ra.scanned ?? 0} completed application campaigns scanned). Missing manager: ${mm} application queue(s) refreshed. Active campaigns with pending reviews are not queued until completed.`,
                );
                load();
                loadSummary();
              } catch (e) {
                setError(e.response?.data?.error?.message || "Failed to sync remediation queue.");
              } finally {
                setSyncLoading(false);
              }
            }}
            sx={{ textTransform: "none" }}
          >
            {syncLoading ? "Syncing…" : "Sync Queue"}
          </Button>
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={() => {
              load();
              loadSummary();
            }}
            sx={{ textTransform: "none" }}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setNewEventOpen(true)}
            sx={{ textTransform: "none" }}
          >
            New Event
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
        <Chip label={`Pending: ${statCounts.PENDING}`} size="small" variant="outlined" />
        <Chip
          label={`With Ticket: ${statCounts.withTicket}`}
          size="small"
          color="primary"
          variant="outlined"
        />
        <Chip
          label={`Awaiting ITSM: ${statCounts.TICKET_CREATED}`}
          size="small"
          color="info"
          variant="outlined"
        />
        <Chip label={`Validation Pending: ${statCounts.VALIDATION_PENDING}`} size="small" color="warning" variant="outlined" />
        <Chip label={`Validated: ${statCounts.VALIDATED}`} size="small" color="success" variant="outlined" />
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label="Event Type"
          value={filters.eventType}
          onChange={(e) => setFilters((f) => ({ ...f, eventType: e.target.value }))}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All</MenuItem>
          {EVENT_TYPES.map((t) => (
            <MenuItem key={t} value={t}>{labelize(t)}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Status"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All</MenuItem>
          {QUEUE_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>{labelize(s)}</MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Search"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          sx={{ flex: 1 }}
        />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess("")}>{success}</Alert>}

      <DataTable
        title="Remediation Queue"
        columns={columns}
        rows={rows}
        loading={loading}
        onRefresh={() => {
          load();
          loadSummary();
        }}
        searchable={false}
        serverPagination
        totalCount={pagination.total}
        page={pagination.page}
        rowsPerPage={pagination.limit}
        onPageChange={(p) => load(p, pagination.limit)}
        onRowsPerPageChange={(limit) => load(0, limit)}
        emptyMessage="No queue records found."
        onRowClick={(row) => openDrawer(row)}
      />

      <Drawer
        anchor="right"
        open={drawer.open}
        onClose={() => setDrawer({ open: false, queue: null, tracking: null, items: [] })}
        PaperProps={{ sx: { width: { xs: "100%", sm: 560, md: 720 }, p: 0 } }}
      >
        {drawer.queue && (
          <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <Box
              sx={{
                p: 2.5,
                borderBottom: "1px solid",
                borderColor: "divider",
                bgcolor: palette.bg.primary,
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Box>
                  <Typography variant="overline" color="primary" sx={{ fontWeight: 700 }}>
                    Queue Detail
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    {drawer.queue.eventId}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
                    <StatusChip label={labelize(drawer.queue.eventType)} size="small" />
                    <StatusChip label={labelize(drawer.queue.status)} size="small" />
                    {drawer.queue.eventType === "REVOKE_ACCESS" && drawer.queue.certificationName && (
                      <Chip
                        label={drawer.queue.certificationName}
                        size="small"
                        variant="outlined"
                        sx={{ maxWidth: 280 }}
                      />
                    )}
                    {drawer.queue.applicationName && (
                      <Chip label={drawer.queue.applicationName} size="small" color="primary" variant="outlined" />
                    )}
                  </Stack>
                </Box>
                <IconButton onClick={() => setDrawer({ open: false, queue: null, tracking: null, items: [] })}>
                  <Close />
                </IconButton>
              </Stack>
            </Box>

            <Box sx={{ p: 2.5, flex: 1, overflow: "auto" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Progress Timeline
              </Typography>
              <RemediationTrackingTimeline tracking={drawer.tracking} compact />

              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 3, mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Queue Items
                </Typography>
                {!hasTicket(drawer.queue) && drawer.queue.status === "PENDING" ? (
                  <Button
                    variant="contained"
                    size="small"
                    disabled={!selectedItemIds.size}
                    onClick={() => setCreateTicketOpen(true)}
                    sx={{ textTransform: "none" }}
                  >
                    Create Ticket ({selectedItemIds.size})
                  </Button>
                ) : (
                  <Chip
                    label={hasTicket(drawer.queue) ? "Ticket created — awaiting validation" : "Ticket not required"}
                    size="small"
                    color={hasTicket(drawer.queue) ? "primary" : "default"}
                    variant="outlined"
                  />
                )}
              </Stack>

              <QueueItemsGrid
                rows={drawer.items}
                eventType={drawer.queue.eventType}
                loading={itemsLoading}
                selectedIds={selectedItemIds}
                onToggle={(id, row) => {
                  setSelectedItemIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                  setSelectedItemMap((prev) => {
                    const next = new Map(prev);
                    if (next.has(id)) next.delete(id);
                    else next.set(id, row);
                    return next;
                  });
                }}
                onToggleAll={(ids) => {
                  const allOn = ids.every((id) => selectedItemIds.has(id));
                  setSelectedItemIds((prev) => {
                    const next = new Set(prev);
                    if (allOn) ids.forEach((id) => next.delete(id));
                    else ids.forEach((id) => next.add(id));
                    return next;
                  });
                }}
                total={drawer.items.length}
                page={0}
                rowsPerPage={drawer.items.length || 25}
              />
            </Box>
          </Box>
        )}
      </Drawer>

      <CreateTicketModal
        open={createTicketOpen}
        onClose={() => setCreateTicketOpen(false)}
        onSubmit={handleCreateTicket}
        selectedCount={selectedItemIds.size}
        loading={ticketSubmitting}
        titleDefault={`${labelize(drawer.queue?.eventType)} Remediation Ticket`}
        selectedLabel="subject(s)"
      />

      <RemediationNewEventDialog
        open={newEventOpen}
        onClose={() => setNewEventOpen(false)}
        onCreated={() => {
          setNewEventOpen(false);
          load();
        }}
      />
    </Box>
  );
}
