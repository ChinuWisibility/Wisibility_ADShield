import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add,
  DeleteOutline,
  EditOutlined,
  FileCopyOutlined,
  MoreVert,
  Refresh,
} from "@mui/icons-material";
import DataTable from "../../components/DataTable";
import StatusChip from "../../components/StatusChip";
import { remediationAPI } from "../../services/remediationService";
import RemediationNewEventDialog from "./RemediationNewEventDialog";
import RemediationEventReviewDialog from "../../components/remediation/RemediationEventReviewDialog";

const EVENT_TYPES = [
  "REVOKE_ACCESS",
  "MISSING_MANAGER",
  "DUPLICATE_ACCOUNT",
  "ORPHAN_ACCOUNT",
  "REVOKE_PRIVILEGED_ACCESS",
  "INACTIVE_USER_ACCESS",
];

const STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELED"];
const TICKET_STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "CLOSED", "EXECUTED"];

function labelize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function RemediationEvents() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pagination, setPagination] = useState({ page: 0, limit: 20, total: 0 });
  const [filters, setFilters] = useState({ status: "", eventType: "", ticketStatus: "" });

  const [newEventDlg, setNewEventDlg] = useState(false);
  const [reviewDialog, setReviewDialog] = useState({ open: false, ticketId: "", title: "" });
  const [actionMenu, setActionMenu] = useState({ anchorEl: null, row: null });
  const [editDlg, setEditDlg] = useState({ open: false, row: null });
  const [editForm, setEditForm] = useState({ title: "", description: "", itsmEmail: "" });
  const [deleteDlg, setDeleteDlg] = useState({ open: false, row: null });
  const [actionLoading, setActionLoading] = useState("");

  const load = useCallback(
    async (page = pagination.page, limit = pagination.limit) => {
      setLoading(true);
      setError("");
      try {
        const res = await remediationAPI.listEvents({
          page: page + 1,
          limit,
          status: filters.status || undefined,
          eventType: filters.eventType || undefined,
          ticketStatus: filters.ticketStatus || undefined,
        });
        const data = res.data.data || [];
        const pg = res.data.pagination || {};
        setRows(data);
        setPagination({
          page,
          limit,
          total: pg.total || data.length,
        });
      } catch (e) {
        setError(e.response?.data?.error?.message || "Failed to load remediation events.");
      } finally {
        setLoading(false);
      }
    },
    [filters, pagination.page, pagination.limit],
  );

  useEffect(() => {
    load(0, pagination.limit);
  }, [filters, load, pagination.limit]);

  const closeActionMenu = () => setActionMenu({ anchorEl: null, row: null });

  const openEditDialog = (row) => {
    setEditDlg({ open: true, row });
    setEditForm({
      title: row.title || "",
      description: row.description || "",
      itsmEmail: row.itsmEmail || "",
    });
  };

  const columns = useMemo(
    () => [
      {
        field: "eventType",
        headerName: "Event Type",
        width: 180,
        renderCell: (row) => (
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {labelize(row.eventType)}
          </Typography>
        ),
      },
      {
        field: "title",
        headerName: "Title / Source",
        width: 240,
        renderCell: (row) => (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {row.title || labelize(row.eventType)}
            </Typography>
            {row.source?.sourceRef && (
              <Typography variant="caption" color="text.secondary" noWrap>
                Campaign: {row.source.sourceRef}
              </Typography>
            )}
          </Box>
        ),
      },
      {
        field: "status",
        headerName: "Status",
        width: 130,
        renderCell: (row) => <StatusChip status={row.status} label={labelize(row.status)} />,
      },
      {
        field: "ticketStatus",
        headerName: "Ticket",
        width: 130,
        renderCell: (row) => (
          <StatusChip status={row.ticket?.ticketStatus} label={labelize(row.ticket?.ticketStatus)} />
        ),
      },
      {
        field: "progress",
        headerName: "Progress",
        width: 120,
        renderCell: (row) => {
          const users = row.metadata?.revokedUsers;
          const ticketCounts = row.metadata?.itemCounts || row.ticket?.itemCounts;
          if ((!Array.isArray(users) || !users.length) && !ticketCounts?.total) return "—";
          const done = Array.isArray(users) && users.length
            ? users.filter((u) => u.remediationAction && u.remediationAction !== "PENDING").length
            : (ticketCounts.approved || 0) + (ticketCounts.denied || 0) + (ticketCounts.executed || 0);
          const total = Array.isArray(users) && users.length ? users.length : ticketCounts.total || 0;
          return (
            <Typography variant="body2" color="text.secondary">
              {done}/{total}
            </Typography>
          );
        },
      },
      {
        field: "itsmEmail",
        headerName: "ITSM Email",
        width: 200,
        renderCell: (row) => (
          <Typography variant="body2" color="text.secondary">
            {row.itsmEmail || "—"}
          </Typography>
        ),
      },
      {
        field: "createdAt",
        headerName: "Created",
        width: 120,
        renderCell: (row) => (
          <Typography variant="body2" color="text.secondary">
            {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "—"}
          </Typography>
        ),
      },
      {
        field: "_actions",
        headerName: "",
        width: 140,
        sortable: false,
        renderCell: (row) => (
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              size="small"
              variant="outlined"
              disabled={!row.ticket?.ticketRecordId}
              onClick={() =>
                setReviewDialog({
                  open: true,
                  ticketId: row.ticket?.ticketRecordId || "",
                  title: row.title || labelize(row.eventType),
                })
              }
              sx={{ textTransform: "none" }}
            >
              Review
            </Button>
            <Tooltip title="Actions">
              <IconButton
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  setActionMenu({ anchorEl: event.currentTarget, row });
                }}
              >
                <MoreVert fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
    ],
    [],
  );

  const handleEditSave = async () => {
    if (!editDlg.row?._id) return;
    setActionLoading("edit");
    setError("");
    setSuccess("");
    try {
      await remediationAPI.updateEvent(editDlg.row._id, {
        title: editForm.title || undefined,
        description: editForm.description || undefined,
        itsmEmail: editForm.itsmEmail || undefined,
      });
      setEditDlg({ open: false, row: null });
      setSuccess("Remediation event updated.");
      await load(pagination.page, pagination.limit);
    } catch (e) {
      setError(e.response?.data?.error?.message || "Failed to edit remediation event.");
    } finally {
      setActionLoading("");
    }
  };

  const handleDuplicate = async () => {
    if (!actionMenu.row?._id) return;
    setActionLoading(`duplicate:${actionMenu.row._id}`);
    setError("");
    setSuccess("");
    try {
      await remediationAPI.duplicateEvent(actionMenu.row._id);
      closeActionMenu();
      setSuccess("Remediation event duplicated.");
      await load(0, pagination.limit);
    } catch (e) {
      setError(e.response?.data?.error?.message || "Failed to duplicate remediation event.");
    } finally {
      setActionLoading("");
    }
  };

  const handleDelete = async () => {
    if (!deleteDlg.row?._id) return;
    setActionLoading(`delete:${deleteDlg.row._id}`);
    setError("");
    setSuccess("");
    try {
      await remediationAPI.deleteEvent(deleteDlg.row._id);
      if (reviewDialog.ticketId === deleteDlg.row?.ticket?.ticketRecordId) {
        setReviewDialog({ open: false, ticketId: "", title: "" });
      }
      setDeleteDlg({ open: false, row: null });
      setSuccess("Remediation event deleted.");
      await load(pagination.page, pagination.limit);
    } catch (e) {
      setError(e.response?.data?.error?.message || "Failed to delete remediation event.");
    } finally {
      setActionLoading("");
    }
  };

  const toolbarLeft = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
      <TextField
        select
        size="small"
        label="Event"
        value={filters.eventType}
        onChange={(e) => setFilters((f) => ({ ...f, eventType: e.target.value }))}
        sx={{ minWidth: 180 }}
      >
        <MenuItem value="">All</MenuItem>
        {EVENT_TYPES.map((t) => (
          <MenuItem key={t} value={t}>
            {labelize(t)}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label="Status"
        value={filters.status}
        onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        sx={{ minWidth: 140 }}
      >
        <MenuItem value="">All</MenuItem>
        {STATUS_OPTIONS.map((t) => (
          <MenuItem key={t} value={t}>
            {labelize(t)}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label="Ticket"
        value={filters.ticketStatus}
        onChange={(e) => setFilters((f) => ({ ...f, ticketStatus: e.target.value }))}
        sx={{ minWidth: 140 }}
      >
        <MenuItem value="">All</MenuItem>
        {TICKET_STATUS_OPTIONS.map((t) => (
          <MenuItem key={t} value={t}>
            {labelize(t)}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2, flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Remediation Events
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Track remediation events, campaign revoke actions, and ticket outcomes.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <Button
            variant="outlined"
            startIcon={<Refresh fontSize="small" />}
            onClick={() => load(pagination.page, pagination.limit)}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<Add fontSize="small" />}
            onClick={() => setNewEventDlg(true)}
          >
            New Event
          </Button>
        </Stack>
      </Box>

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      <DataTable
        title="Remediation Queue"
        columns={columns}
        rows={rows}
        loading={loading}
        onRefresh={() => load(pagination.page, pagination.limit)}
        searchable
        serverPagination
        totalCount={pagination.total}
        page={pagination.page}
        rowsPerPage={pagination.limit}
        onPageChange={(nextPage) => load(nextPage, pagination.limit)}
        onRowsPerPageChange={(e) => load(0, parseInt(e.target.value, 10))}
        toolbarLeft={toolbarLeft}
      />

      <RemediationNewEventDialog
        open={newEventDlg}
        onClose={() => setNewEventDlg(false)}
        onCreated={() => {
          load(0, pagination.limit);
        }}
      />

      <RemediationEventReviewDialog
        open={reviewDialog.open}
        ticketId={reviewDialog.ticketId}
        title={reviewDialog.title}
        onClose={() => {
          setReviewDialog({ open: false, ticketId: "", title: "" });
          load(pagination.page, pagination.limit);
        }}
        onTicketUpdated={() => load(pagination.page, pagination.limit)}
      />

      <Menu
        anchorEl={actionMenu.anchorEl}
        open={Boolean(actionMenu.anchorEl)}
        onClose={closeActionMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => {
            const row = actionMenu.row;
            closeActionMenu();
            if (row) openEditDialog(row);
          }}
        >
          <ListItemIcon>
            <EditOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleDuplicate} disabled={actionLoading.startsWith("duplicate:")}>
          <ListItemIcon>
            <FileCopyOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText>Duplicate</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDeleteDlg({ open: true, row: actionMenu.row });
            closeActionMenu();
          }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon sx={{ color: "error.main" }}>
            <DeleteOutline fontSize="small" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      <Dialog open={editDlg.open} onClose={() => setEditDlg({ open: false, row: null })} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Edit remediation event</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField
              label="Title"
              value={editForm.title}
              onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
              size="small"
              fullWidth
            />
            <TextField
              label="ITSM Email"
              type="email"
              value={editForm.itsmEmail}
              onChange={(e) => setEditForm((f) => ({ ...f, itsmEmail: e.target.value }))}
              size="small"
              fullWidth
            />
            <TextField
              label="Description"
              value={editForm.description}
              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              size="small"
              fullWidth
              multiline
              minRows={3}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setEditDlg({ open: false, row: null })} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleEditSave} variant="contained" disabled={actionLoading === "edit"}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDlg.open} onClose={() => setDeleteDlg({ open: false, row: null })} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Delete remediation event</DialogTitle>
        <DialogContent dividers>
          <DialogContentText>
            Delete {deleteDlg.row?.title || labelize(deleteDlg.row?.eventType)}?
            {deleteDlg.row?.ticket?.ticketRecordId
              ? " This will also remove the linked remediation ticket, responses, and execution logs."
              : ""}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDeleteDlg({ open: false, row: null })} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            color="error"
            variant="contained"
            disabled={actionLoading.startsWith("delete:")}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
