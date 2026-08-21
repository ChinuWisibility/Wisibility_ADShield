import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
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
import { ExpandMore, PlayArrow, Visibility } from "@mui/icons-material";
import { remediationAPI } from "../../services/remediationService";
import StatusChip from "../../components/StatusChip";

function labelize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function RemediationTicketsPanel({ refreshKey = 0 }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await remediationAPI.listTickets({ limit: 50 });
      setTickets(res.data?.data || []);
    } catch (e) {
      setError(e.response?.data?.error?.message || "Failed to load tickets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets, refreshKey]);

  const loadDetail = async (ticketId) => {
    if (expandedId === ticketId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(ticketId);
    setDetailLoading(true);
    try {
      const res = await remediationAPI.getTicket(ticketId);
      setDetail(res.data?.data || null);
    } catch (e) {
      setError(e.response?.data?.error?.message || "Failed to load ticket detail.");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRun = async (ticketId) => {
    setRunLoading(ticketId);
    setError("");
    try {
      await remediationAPI.runTicket(ticketId);
      await loadTickets();
      if (expandedId === ticketId) await loadDetail(ticketId);
    } catch (e) {
      setError(e.response?.data?.error?.message || "Failed to run remediation.");
    } finally {
      setRunLoading(null);
    }
  };

  return (
    <Paper sx={{ p: 2, borderRadius: 2, mt: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Review Responses
          </Typography>
          <Typography variant="body2" color="text.secondary">
            ITSM ticket history, decisions, and execution status.
          </Typography>
        </Box>
        <Button size="small" onClick={loadTickets} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size={28} />
        </Box>
      ) : tickets.length === 0 ? (
        <Alert severity="info">No remediation tickets yet.</Alert>
      ) : (
        <Stack spacing={1.5}>
          {tickets.map((t) => (
            <Paper key={t._id} variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
              <Box
                sx={{
                  p: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  flexWrap: "wrap",
                  cursor: "pointer",
                }}
                onClick={() => loadDetail(t._id)}
              >
                <ExpandMore
                  sx={{
                    transform: expandedId === t._id ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "0.2s",
                  }}
                />
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {t.title || t.ticketNumber}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t.ticketNumber} · {t.itsmEmail}
                  </Typography>
                </Box>
                <StatusChip status={t.status} label={labelize(t.status)} />
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${t.itemCounts?.approved || 0} approved / ${t.itemCounts?.denied || 0} denied`}
                />
                <Button
                  size="small"
                  variant="contained"
                  startIcon={
                    runLoading === t._id ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <PlayArrow fontSize="small" />
                    )
                  }
                  disabled={t.status !== "CLOSED" || runLoading === t._id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRun(t._id);
                  }}
                  sx={{ textTransform: "none" }}
                >
                  Run
                </Button>
              </Box>

              <Collapse in={expandedId === t._id}>
                <Box sx={{ px: 2, pb: 2, borderTop: "1px solid", borderColor: "divider" }}>
                  {detailLoading ? (
                    <Box sx={{ py: 2, display: "flex", justifyContent: "center" }}>
                      <CircularProgress size={24} />
                    </Box>
                  ) : detail ? (
                    <Stack spacing={2} sx={{ pt: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        Campaigns: {(detail.ticket?.campaignNames || []).join(", ") || "—"}
                      </Typography>

                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        ITSM Decisions
                      </Typography>
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>User</TableCell>
                              <TableCell>Entitlement</TableCell>
                              <TableCell>Decision</TableCell>
                              <TableCell>Comment</TableCell>
                              <TableCell>Responded</TableCell>
                              <TableCell>Execution</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(detail.items || []).map((item) => (
                              <TableRow key={item._id}>
                                <TableCell>{item.itemName}</TableCell>
                                <TableCell>{item.entitlementName}</TableCell>
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
                                    label={labelize(item.status)}
                                    color={item.status === "EXECUTED" ? "success" : "default"}
                                    variant="outlined"
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>

                      {(detail.responses || []).length > 0 && (
                        <>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            Response History
                          </Typography>
                          {(detail.responses || []).map((r) => (
                            <Paper key={r._id} variant="outlined" sx={{ p: 1.5 }}>
                              <Typography variant="body2">
                                {labelize(r.decision)} · {r.respondedByEmail} ·{" "}
                                {new Date(r.respondedAt).toLocaleString()}
                              </Typography>
                              {r.comment && (
                                <Typography variant="caption" color="text.secondary">
                                  {r.comment}
                                </Typography>
                              )}
                            </Paper>
                          ))}
                        </>
                      )}

                      {(detail.executionLogs || []).length > 0 && (
                        <>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            Execution Logs
                          </Typography>
                          {(detail.executionLogs || []).map((log) => (
                            <Paper key={log._id} variant="outlined" sx={{ p: 1.5 }}>
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Visibility fontSize="small" color="action" />
                                <Typography variant="body2">
                                  {log.itemEmail || log.userId} · {labelize(log.decision)} ·{" "}
                                  {labelize(log.status)}
                                </Typography>
                              </Stack>
                            </Paper>
                          ))}
                        </>
                      )}
                    </Stack>
                  ) : null}
                </Box>
              </Collapse>
            </Paper>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
