import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { PlayArrow, Refresh } from "@mui/icons-material";
import { remediationAPI } from "../../services/remediationService";
import RemediationTrackingTimeline from "./RemediationTrackingTimeline";

function labelize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function statusChipColor(status) {
  switch (String(status || "").toUpperCase()) {
    case "EXECUTED":
    case "APPROVED":
      return "success";
    case "DENIED":
      return "warning";
    case "FAILED":
      return "error";
    default:
      return "default";
  }
}

export default function RemediationEventReviewDialog({
  open,
  ticketId,
  title,
  onClose,
  onTicketUpdated,
}) {
  const [detail, setDetail] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [error, setError] = useState("");

  const loadDetail = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError("");
    try {
      const res = await remediationAPI.getTicket(ticketId);
      const data = res.data?.data || null;
      setDetail(data);
      if (data?.ticket?.eventId) {
        try {
          const tr = await remediationAPI.getTracking(data.ticket.eventId);
          setTracking(tr.data?.data || null);
        } catch {
          setTracking(null);
        }
      } else {
        setTracking(null);
      }
    } catch (e) {
      setError(e.response?.data?.error?.message || "Failed to load ticket review.");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    if (!open) {
      setDetail(null);
      setTracking(null);
      setError("");
      setLoading(false);
      setRunLoading(false);
      return;
    }
    loadDetail();
  }, [open, loadDetail]);

  const handleRun = async () => {
    if (!ticketId) return;
    setRunLoading(true);
    setError("");
    try {
      await remediationAPI.runTicket(ticketId);
      await loadDetail();
      onTicketUpdated?.();
    } catch (e) {
      setError(e.response?.data?.error?.message || "Failed to run remediation.");
    } finally {
      setRunLoading(false);
    }
  };

  const ticket = detail?.ticket;
  const items = detail?.items || [];
  const responses = detail?.responses || [];
  const executionLogs = detail?.executionLogs || [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        {title || ticket?.title || "Review Responses"}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {loading ? (
          <Box sx={{ py: 8, display: "flex", justifyContent: "center" }}>
            <CircularProgress size={30} />
          </Box>
        ) : (
          <Stack spacing={0}>
            <Box sx={{ px: 3, py: 2.5 }}>
              {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

              {ticket && (
                <Stack spacing={2}>
                  <Stack
                    direction={{ xs: "column", md: "row" }}
                    spacing={1.5}
                    justifyContent="space-between"
                    alignItems={{ md: "center" }}
                  >
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        {ticket.title || "Remediation Ticket"}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {ticket.ticketNumber} · {ticket.itsmEmail || "No ITSM email"}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`Priority: ${ticket.priority || "MEDIUM"}`}
                      />
                      <Chip size="small" label={labelize(ticket.status)} color="primary" />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${ticket.itemCounts?.approved || 0} approved / ${ticket.itemCounts?.denied || 0} denied / ${ticket.itemCounts?.executed || 0} executed`}
                      />
                    </Stack>
                  </Stack>

                  {tracking && (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                        Remediation Timeline
                      </Typography>
                      <RemediationTrackingTimeline tracking={tracking} compact />
                    </Box>
                  )}

                  <Stack
                    direction={{ xs: "column", md: "row" }}
                    spacing={3}
                    color="text.secondary"
                  >
                    <Typography variant="body2">
                      Campaigns: {(ticket.campaignNames || []).join(", ") || "—"}
                    </Typography>
                    <Typography variant="body2">
                      Created: {ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : "—"}
                    </Typography>
                    <Typography variant="body2">
                      Due: {ticket.dueDate ? new Date(ticket.dueDate).toLocaleDateString() : "—"}
                    </Typography>
                  </Stack>
                </Stack>
              )}
            </Box>

            <Box sx={{ px: 3, pb: 3 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
                ITSM Decisions
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 420 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>User</TableCell>
                      <TableCell>Application</TableCell>
                      <TableCell>Entitlement</TableCell>
                      <TableCell>Decision</TableCell>
                      <TableCell>Comment</TableCell>
                      <TableCell>Responded</TableCell>
                      <TableCell>Execution</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} sx={{ py: 4, textAlign: "center" }}>
                          No ticket items found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      items.map((item) => (
                        <TableRow key={item._id}>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {item.itemName || "—"}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {item.itemEmail || "—"}
                            </Typography>
                          </TableCell>
                          <TableCell>{item.applicationName || "—"}</TableCell>
                          <TableCell>{item.entitlementName || "—"}</TableCell>
                          <TableCell>{item.decision ? labelize(item.decision) : "—"}</TableCell>
                          <TableCell>{item.comment || "—"}</TableCell>
                          <TableCell>
                            {item.respondedAt
                              ? new Date(item.respondedAt).toLocaleString()
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              variant="outlined"
                              color={statusChipColor(item.status)}
                              label={labelize(item.status)}
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>

            {(responses.length > 0 || executionLogs.length > 0) && (
              <Box
                sx={{
                  px: 3,
                  pb: 3,
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
                  gap: 2,
                }}
              >
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                    Response History
                  </Typography>
                  {responses.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No responses yet.
                    </Typography>
                  ) : (
                    <Stack spacing={1.25}>
                      {responses.map((response) => (
                        <Box key={response._id}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {labelize(response.decision)} · {response.respondedByEmail}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {response.respondedAt
                              ? new Date(response.respondedAt).toLocaleString()
                              : "—"}
                          </Typography>
                          {response.comment ? (
                            <Typography variant="body2" sx={{ mt: 0.5 }}>
                              {response.comment}
                            </Typography>
                          ) : null}
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                    Execution Logs
                  </Typography>
                  {executionLogs.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No execution logs yet.
                    </Typography>
                  ) : (
                    <Stack spacing={1.25}>
                      {executionLogs.map((log) => (
                        <Box key={log._id}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {log.itemEmail || log.userId || "—"} · {labelize(log.status)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {labelize(log.decision)} ·{" "}
                            {log.executedAt
                              ? new Date(log.executedAt).toLocaleString()
                              : "—"}
                          </Typography>
                          {log.error ? (
                            <Typography variant="body2" color="error.main" sx={{ mt: 0.5 }}>
                              {log.error}
                            </Typography>
                          ) : null}
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Paper>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          onClick={loadDetail}
          startIcon={<Refresh fontSize="small" />}
          disabled={loading || runLoading || !ticketId}
        >
          Refresh
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          onClick={handleRun}
          startIcon={
            runLoading ? <CircularProgress size={14} color="inherit" /> : <PlayArrow fontSize="small" />
          }
          disabled={!ticketId || runLoading || ticket?.status !== "CLOSED"}
          sx={{ textTransform: "none" }}
        >
          Run
        </Button>
        <Button onClick={onClose} color="inherit">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
