import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
  alpha,
} from "@mui/material";
import {
  ArrowBack,
  Add,
  LinkOff,
  PersonOff,
  PersonOutline,
  Refresh,
  SupervisorAccount,
  ConfirmationNumber,
} from "@mui/icons-material";
import { remediationAPI } from "../../services/remediationService";
import QueueItemsGrid from "../../components/remediation/QueueItemsGrid";
import CreateTicketModal from "../../components/remediation/CreateTicketModal";

const EVENT_TILES = [
  {
    id: "REVOKE_ACCESS",
    title: "Revoke Access",
    description: "Select queued revoke-access events from completed certifications and create ITSM tickets.",
    icon: PersonOff,
    accent: { main: "#dc2626", soft: "#fef2f2", border: "#fecaca" },
    flow: "queue",
  },
  {
    id: "MISSING_MANAGER",
    title: "Missing Manager",
    description: "Select queued identities without an assigned manager and create an ITSM ticket.",
    icon: SupervisorAccount,
    accent: { main: "#d97706", soft: "#fffbeb", border: "#fde68a" },
    flow: "queue",
  },
  {
    id: "ORPHAN_ACCOUNT",
    title: "Orphan Account",
    description: "Select queued uncorrelated accounts and create remediation tickets.",
    icon: LinkOff,
    accent: { main: "#7c3aed", soft: "#f5f3ff", border: "#ddd6fe" },
    flow: "queue",
  },
  {
    id: "INACTIVE_USER_ACCESS",
    title: "Inactive User Having Access",
    description: "Select queued inactive users with access and create remediation tickets.",
    icon: PersonOutline,
    accent: { main: "#0891b2", soft: "#ecfeff", border: "#a5f3fc" },
    flow: "queue",
  },
  {
    id: "CUSTOM",
    title: "New Event",
    description: "Create a custom remediation event with full details.",
    icon: Add,
    accent: { main: "#2563eb", soft: "#eff6ff", border: "#bfdbfe" },
    flow: "manual",
  },
];

const MANUAL_EVENT_TYPES = [
  "REVOKE_ACCESS",
  "MISSING_MANAGER",
  "DUPLICATE_ACCOUNT",
  "ORPHAN_ACCOUNT",
  "REVOKE_PRIVILEGED_ACCESS",
  "INACTIVE_USER_ACCESS",
];

function labelize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function EventTile({ tile, onClick }) {
  const Icon = tile.icon;
  const accent = tile.accent;
  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 2,
        border: "1px solid",
        borderColor: accent.border,
        bgcolor: accent.soft,
        transition: "all .2s ease",
        "&:hover": { boxShadow: `0 4px 20px ${alpha(accent.main, 0.15)}` },
      }}
    >
      <CardActionArea onClick={onClick} sx={{ height: "100%" }}>
        <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1, minHeight: 160 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: alpha(accent.main, 0.12),
              color: accent.main,
            }}
          >
            <Icon />
          </Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {tile.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {tile.description}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default function RemediationNewEventDialog({ open, onClose, onCreated }) {
  const [view, setView] = useState("tiles");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const [selectedEventType, setSelectedEventType] = useState("");
  const [queueRecords, setQueueRecords] = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [selectedQueue, setSelectedQueue] = useState(null);
  const [queueItems, setQueueItems] = useState([]);
  const [queueItemsLoading, setQueueItemsLoading] = useState(false);
  const [selectedQueueItemIds, setSelectedQueueItemIds] = useState(new Set());
  const [selectedQueueItemMap, setSelectedQueueItemMap] = useState(new Map());
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [ticketSubmitting, setTicketSubmitting] = useState(false);

  const [manualForm, setManualForm] = useState({
    eventType: "MISSING_MANAGER",
    itsmEmail: "",
    title: "",
    description: "",
    identityName: "",
    identityEmail: "",
    accountId: "",
    applicationName: "",
  });

  const resetState = useCallback(() => {
    setView("tiles");
    setError("");
    setSuccess("");
    setLoading(false);
    setSelectedEventType("");
    setQueueRecords([]);
    setSelectedQueue(null);
    setQueueItems([]);
    setSelectedQueueItemIds(new Set());
    setSelectedQueueItemMap(new Map());
    setCreateTicketOpen(false);
    setManualForm({
      eventType: "MISSING_MANAGER",
      itsmEmail: "",
      title: "",
      description: "",
      identityName: "",
      identityEmail: "",
      accountId: "",
      applicationName: "",
    });
  }, []);

  const handleClose = () => {
    resetState();
    onClose();
  };

  const loadQueueRecords = useCallback(async () => {
    if (!selectedEventType) return;
    setQueueLoading(true);
    setError("");
    try {
      const res = await remediationAPI.listQueue({
        eventType: selectedEventType,
        status: "PENDING",
        limit: 50,
      });
      setQueueRecords(res.data?.data || []);
    } catch (e) {
      setError(e.response?.data?.error?.message || "Failed to load queue records.");
    } finally {
      setQueueLoading(false);
    }
  }, [selectedEventType]);

  useEffect(() => {
    if (open && view === "queue-list") loadQueueRecords();
  }, [open, view, loadQueueRecords]);

  const loadQueueItems = useCallback(async () => {
    if (!selectedQueue?._id) return;
    setQueueItemsLoading(true);
    setError("");
    try {
      const res = await remediationAPI.getQueueItems(selectedQueue._id, { limit: 200 });
      setQueueItems(res.data?.data || []);
    } catch (e) {
      setError(e.response?.data?.error?.message || "Failed to load queue items.");
    } finally {
      setQueueItemsLoading(false);
    }
  }, [selectedQueue]);

  useEffect(() => {
    if (open && view === "queue-items") loadQueueItems();
  }, [open, view, loadQueueItems]);

  const handleTileClick = (tile) => {
    setError("");
    setSuccess("");
    if (tile.flow === "queue") {
      setSelectedEventType(tile.id);
      setView("queue-list");
      return;
    }
    const eventType = tile.id === "CUSTOM" ? "REVOKE_ACCESS" : tile.id;
    setManualForm((f) => ({ ...f, eventType }));
    setView("manual");
  };

  const handleCreateTicketFromQueue = async (form) => {
    if (!selectedQueue?._id) return;
    setTicketSubmitting(true);
    setError("");
    try {
      await remediationAPI.createTicketFromQueue(selectedQueue._id, {
        ...form,
        dueDate: form.dueDate || undefined,
        selectedQueueItemIds: Array.from(selectedQueueItemIds),
      });
      setCreateTicketOpen(false);
      onCreated?.();
      handleClose();
    } catch (e) {
      throw e;
    } finally {
      setTicketSubmitting(false);
    }
  };

  const tileTitle = EVENT_TILES.find((t) => t.id === selectedEventType)?.title || "Event";

  const dialogTitle = useMemo(() => {
    if (view === "tiles") return "New Remediation Event";
    if (view === "queue-list") return `${tileTitle} — Select Queue Record`;
    if (view === "queue-items") return `${tileTitle} — Select Items`;
    return "Create Remediation Event";
  }, [view, tileTitle]);

  const handleManualCreate = async () => {
    setLoading(true);
    setError("");
    try {
      await remediationAPI.createEvent({
        eventType: manualForm.eventType,
        itsmEmail: manualForm.itsmEmail,
        title: manualForm.title || undefined,
        description: manualForm.description || undefined,
        subject: {
          identityName: manualForm.identityName || undefined,
          identityEmail: manualForm.identityEmail || undefined,
          accountId: manualForm.accountId || undefined,
          applicationName: manualForm.applicationName || undefined,
        },
      });
      onCreated?.();
      handleClose();
    } catch (e) {
      setError(e.response?.data?.error?.message || "Failed to create remediation event.");
    } finally {
      setLoading(false);
    }
  };

  const showBack = view !== "tiles";

  return (
    <>
      <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 1 }}>
          {showBack && (
            <IconButton
              size="small"
              onClick={() => {
                setError("");
                if (view === "queue-items") setView("queue-list");
                else setView("tiles");
              }}
            >
              <ArrowBack fontSize="small" />
            </IconButton>
          )}
          {dialogTitle}
        </DialogTitle>

        <DialogContent dividers>
          {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
          {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

          {view === "tiles" && (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" },
                gap: 2,
                py: 1,
              }}
            >
              {EVENT_TILES.map((tile) => (
                <EventTile key={tile.id} tile={tile} onClick={() => handleTileClick(tile)} />
              ))}
            </Box>
          )}

          {view === "queue-list" && (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Button
                  variant="outlined"
                  startIcon={queueLoading ? <CircularProgress size={14} /> : <Refresh fontSize="small" />}
                  onClick={loadQueueRecords}
                  disabled={queueLoading}
                  sx={{ textTransform: "none" }}
                >
                  Refresh
                </Button>
                <Chip label={`${queueRecords.length} pending queue record(s)`} size="small" variant="outlined" />
              </Stack>

              {queueLoading && !queueRecords.length ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                  <CircularProgress size={32} />
                </Box>
              ) : queueRecords.length === 0 ? (
                <Alert severity="info">
                  No pending queue records for this event type. Completed certifications and detection scans populate the queue automatically.
                </Alert>
              ) : (
                <Stack spacing={1}>
                  {queueRecords.map((q) => (
                    <Card key={q._id} variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardActionArea
                        onClick={() => {
                          setSelectedQueue(q);
                          setSelectedQueueItemIds(new Set());
                          setSelectedQueueItemMap(new Map());
                          setView("queue-items");
                        }}
                      >
                        <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, py: "12px !important" }}>
                          <ConfirmationNumber color="primary" />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
                              {q.eventId}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {q.certificationName || q.applicationName || "—"} · {labelize(q.status)}
                            </Typography>
                          </Box>
                          <Chip
                            size="small"
                            label={`${q.revokedUsersCount ?? q.subjectCount ?? 0} subjects`}
                            color="primary"
                            variant="outlined"
                          />
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  ))}
                </Stack>
              )}
            </Stack>
          )}

          {view === "queue-items" && selectedQueue && (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip label={selectedQueue.eventId} size="small" />
                <Chip
                  label={`${selectedQueue.revokedUsersCount ?? selectedQueue.subjectCount ?? 0} subjects`}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
                <Box sx={{ flex: 1 }} />
                <Button
                  variant="contained"
                  startIcon={<ConfirmationNumber fontSize="small" />}
                  disabled={selectedQueueItemIds.size === 0}
                  onClick={() => setCreateTicketOpen(true)}
                  sx={{ textTransform: "none" }}
                >
                  Create Ticket
                </Button>
              </Stack>

              <QueueItemsGrid
                rows={queueItems}
                loading={queueItemsLoading}
                selectedIds={selectedQueueItemIds}
                onToggle={(id, row) => {
                  setSelectedQueueItemIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                  setSelectedQueueItemMap((prev) => {
                    const next = new Map(prev);
                    if (next.has(id)) next.delete(id);
                    else next.set(id, row);
                    return next;
                  });
                }}
                onToggleAll={(ids) => {
                  const allOn = ids.every((id) => selectedQueueItemIds.has(id));
                  setSelectedQueueItemIds((prev) => {
                    const next = new Set(prev);
                    if (allOn) ids.forEach((id) => next.delete(id));
                    else ids.forEach((id) => next.add(id));
                    return next;
                  });
                }}
                total={queueItems.length}
                page={0}
                rowsPerPage={queueItems.length || 25}
              />
            </Stack>
          )}

          {view === "manual" && (
            <Stack spacing={2}>
              <TextField select label="Event Type" value={manualForm.eventType} onChange={(e) => setManualForm((f) => ({ ...f, eventType: e.target.value }))} size="small" fullWidth>
                {MANUAL_EVENT_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>{labelize(t)}</MenuItem>
                ))}
              </TextField>
              <TextField label="ITSM Email" required value={manualForm.itsmEmail} onChange={(e) => setManualForm((f) => ({ ...f, itsmEmail: e.target.value }))} size="small" fullWidth />
              <TextField label="Title" value={manualForm.title} onChange={(e) => setManualForm((f) => ({ ...f, title: e.target.value }))} size="small" fullWidth />
              <TextField label="Description" value={manualForm.description} onChange={(e) => setManualForm((f) => ({ ...f, description: e.target.value }))} size="small" fullWidth multiline minRows={2} />
              <TextField label="Identity Name" value={manualForm.identityName} onChange={(e) => setManualForm((f) => ({ ...f, identityName: e.target.value }))} size="small" fullWidth />
              <TextField label="Identity Email" value={manualForm.identityEmail} onChange={(e) => setManualForm((f) => ({ ...f, identityEmail: e.target.value }))} size="small" fullWidth />
              <TextField label="Account Id" value={manualForm.accountId} onChange={(e) => setManualForm((f) => ({ ...f, accountId: e.target.value }))} size="small" fullWidth />
              <TextField label="Application Name" value={manualForm.applicationName} onChange={(e) => setManualForm((f) => ({ ...f, applicationName: e.target.value }))} size="small" fullWidth />
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          {view === "manual" ? (
            <>
              <Button onClick={handleClose} color="inherit">Cancel</Button>
              <Button onClick={handleManualCreate} variant="contained" disabled={!manualForm.eventType || !manualForm.itsmEmail || loading}>
                Create
              </Button>
            </>
          ) : view === "queue-items" ? (
            <Button onClick={handleClose} color="inherit">Close</Button>
          ) : (
            <Button onClick={handleClose} color="inherit">Cancel</Button>
          )}
        </DialogActions>
      </Dialog>

      <CreateTicketModal
        open={createTicketOpen}
        onClose={() => setCreateTicketOpen(false)}
        onSubmit={handleCreateTicketFromQueue}
        selectedCount={selectedQueueItemIds.size}
        loading={ticketSubmitting}
        titleDefault={`${tileTitle} Remediation Ticket`}
        selectedLabel="subject(s)"
      />
    </>
  );
}
