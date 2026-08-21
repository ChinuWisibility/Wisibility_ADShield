import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Container,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { CheckCircle, Schedule } from "@mui/icons-material";
import { remediationAPI } from "../../services/remediationService";

function labelize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function RemediationTicketReviewPage() {
  const { ticketId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [ticket, setTicket] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [decision, setDecision] = useState("GRANT_ACCESS");
  const [tentativeDate, setTentativeDate] = useState("");

  const load = useCallback(async () => {
    if (!token) {
      setError("Missing review token.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await remediationAPI.getTicketReview(ticketId, token);
      const rawItems = res.data?.data?.items || [];
      setTicket(res.data?.data?.ticket || null);
      setItems(
        rawItems.map((item) => ({
          ...item,
          _id: String(item._id || item.id || "").trim(),
        })).filter((item) => item._id),
      );
    } catch (e) {
      setError(
        e.response?.data?.error?.message ||
          e.response?.data?.message ||
          (e.request && !e.response
            ? "Cannot reach the server at localhost:8081. Start the backend (icm-backend) and try again."
            : null) ||
          e.message ||
          "Failed to load ticket review.",
      );
    } finally {
      setLoading(false);
    }
  }, [ticketId, token]);

  useEffect(() => {
    load();
  }, [load]);

  const [comment, setComment] = useState("");

  const pendingItems = useMemo(
    () => items.filter((i) => !["APPROVED", "EXECUTED", "PENDING_DECISION"].includes(i.status)),
    [items],
  );

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const ids = pendingItems.map((i) => String(i._id));
    if (ids.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ids));
    }
  };

  const handleSubmit = async (overrideDecision) => {
    const finalDecision =
      typeof overrideDecision === "string" ? overrideDecision : decision;
    if (!selectedIds.size) {
      setError("Select at least one user.");
      return;
    }
    if (finalDecision === "PENDING" && !tentativeDate) {
      setError("Tentative date is required for Pending decisions.");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await remediationAPI.submitTicketReview(ticketId, {
        token,
        itemIds: Array.from(selectedIds).map((id) => String(id).trim()),
        decision: finalDecision,
        comment,
        tentativeDate: finalDecision === "PENDING" ? tentativeDate : undefined,
      });
      setSuccess("Responses saved successfully.");
      setSelectedIds(new Set());
      setComment("");
      setTentativeDate("");
      await load();
    } catch (e) {
      const apiMsg = e.response?.data?.error?.message;
      const apiDetails = e.response?.data?.error?.details;
      setError(
        apiMsg ||
          apiDetails ||
          e.response?.data?.message ||
          (e.request && !e.response
            ? "Network error — could not reach the server. Check that the backend is running."
            : null) ||
          e.message ||
          "Failed to submit responses.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Typography>Loading ticket review...</Typography>
      </Container>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f1f5f9", py: 4 }}>
      <Container maxWidth="lg">
        <Paper sx={{ p: 3, borderRadius: 2, mb: 3 }}>
          <Typography variant="overline" color="primary" sx={{ fontWeight: 700 }}>
            ITSM Remediation Review
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5 }}>
            {ticket?.title || "Remediation Ticket"}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap" }}>
            <Chip label={ticket?.ticketNumber} variant="outlined" />
            <Chip label={labelize(ticket?.status)} color="primary" size="small" />
            <Chip label={`Priority: ${ticket?.priority || "MEDIUM"}`} size="small" variant="outlined" />
          </Stack>
          <Stack spacing={0.5} sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Requested by: {ticket?.requesterName || ticket?.requesterEmail || "—"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Created: {ticket?.createdAt ? new Date(ticket.createdAt).toLocaleString() : "—"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Campaigns: {(ticket?.campaignNames || []).join(", ") || "—"}
            </Typography>
          </Stack>
        </Paper>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

        <Paper sx={{ p: 3, borderRadius: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
            Revoked Users
          </Typography>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ mb: 2 }}>
            <TextField
              select
              size="small"
              label="Decision"
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="GRANT_ACCESS">Grant Access</MenuItem>
              <MenuItem value="PENDING">Pending</MenuItem>
            </TextField>
            {decision === "PENDING" && (
              <TextField
                size="small"
                label="Tentative Date"
                type="date"
                value={tentativeDate}
                onChange={(e) => setTentativeDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 180 }}
              />
            )}
            <TextField
              size="small"
              label="Comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              variant="contained"
              color="success"
              startIcon={<CheckCircle />}
              disabled={!selectedIds.size || submitting}
              onClick={() => handleSubmit()}
              sx={{ textTransform: "none" }}
            >
              Submit Selected
            </Button>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<Schedule />}
              disabled={!selectedIds.size || submitting}
              onClick={() => handleSubmit("PENDING")}
              sx={{ textTransform: "none" }}
            >
              Mark Pending
            </Button>
          </Stack>

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={
                        pendingItems.length > 0 &&
                        pendingItems.every((i) => selectedIds.has(String(i._id)))
                      }
                      indeterminate={
                        selectedIds.size > 0 &&
                        !pendingItems.every((i) => selectedIds.has(String(i._id)))
                      }
                      onChange={toggleAll}
                      disabled={!pendingItems.length}
                    />
                  </TableCell>
                  <TableCell>User</TableCell>
                  <TableCell>Application</TableCell>
                  <TableCell>Entitlement</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Decision</TableCell>
                  <TableCell>Comment</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => {
                  const isPending = !["APPROVED", "EXECUTED", "PENDING_DECISION"].includes(item.status);
                  return (
                    <TableRow key={item._id}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={selectedIds.has(String(item._id))}
                          disabled={!isPending}
                          onChange={() => toggleSelect(String(item._id))}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {item.itemName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {item.itemEmail}
                        </Typography>
                      </TableCell>
                      <TableCell>{item.applicationName}</TableCell>
                      <TableCell>{item.entitlementName}</TableCell>
                      <TableCell>
                        <Chip size="small" label={labelize(item.status)} variant="outlined" />
                      </TableCell>
                      <TableCell>{item.decision ? labelize(item.decision) : "—"}</TableCell>
                      <TableCell>{item.tentativeDate ? new Date(item.tentativeDate).toLocaleDateString() : item.comment || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Container>
    </Box>
  );
}
