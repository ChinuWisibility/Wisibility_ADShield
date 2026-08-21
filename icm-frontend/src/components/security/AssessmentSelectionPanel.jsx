import { useMemo, useState } from "react";
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
  FormControlLabel,
  Checkbox,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { securityAPI } from "../../services/securityApi";
import { useSecurityWorkspace } from "../../pages/security/SecurityWorkspaceContext";
import EmptyStateSecurity from "./EmptyStateSecurity";

/**
 * Assessment Selection gate for Scan Center.
 * Create or Open an Assessment before Feature Workspace is shown.
 */
export default function AssessmentSelectionPanel({ onOpened }) {
  const queryClient = useQueryClient();
  const {
    applicationId,
    assessmentId,
    setAssessmentId,
    applications,
  } = useSecurityWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [purpose, setPurpose] = useState("");
  const [attachOrphans, setAttachOrphans] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const appName =
    (applications || []).find((a) => String(a._id) === String(applicationId))?.name ||
    "Application";

  const listQuery = useQuery({
    queryKey: ["security", "assessments", applicationId],
    queryFn: async () => {
      const res = await securityAPI.listAssessments(applicationId, { limit: 100, page: 1 });
      const payload = res.data ?? {};
      return {
        items: Array.isArray(payload.data) ? payload.data : [],
        total: Number(payload.total) || 0,
      };
    },
    enabled: Boolean(applicationId),
  });

  const items = useMemo(() => listQuery.data?.items || [], [listQuery.data]);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Assessment name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await securityAPI.createAssessment(applicationId, {
        name: name.trim(),
        description: description.trim(),
        purpose: purpose.trim(),
        attachOrphanScans: attachOrphans,
      });
      const created = res.data?.data ?? res.data;
      await queryClient.invalidateQueries({
        queryKey: ["security", "assessments", applicationId],
      });
      setCreateOpen(false);
      setName("");
      setDescription("");
      setPurpose("");
      setAttachOrphans(false);
      if (created?.assessmentId) {
        setAssessmentId(created.assessmentId);
        onOpened?.(created);
      }
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to create assessment");
    } finally {
      setSaving(false);
    }
  };

  if (!applicationId) return null;

  return (
    <Paper sx={{ p: 2, mb: 2, border: 1, borderColor: "divider" }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        spacing={1.5}
        sx={{ mb: 1.5 }}
      >
        <Box>
          <Typography variant="subtitle1" fontWeight={800}>
            Assessment selection
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create or open an Assessment for {appName} before configuring features or executing.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          sx={{ textTransform: "none" }}
        >
          Create Assessment
        </Button>
      </Stack>

      {listQuery.isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {listQuery.isError && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {listQuery.error?.message || "Failed to load assessments"}
        </Alert>
      )}

      {!listQuery.isLoading && items.length === 0 && (
        <EmptyStateSecurity
          title="No assessments yet"
          description="Create an Assessment to configure posture checks and run executions."
          actionLabel="Create Assessment"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {items.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Purpose</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Executions</TableCell>
              <TableCell align="right">Updated</TableCell>
              <TableCell align="right">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((a) => {
              const active = String(a.assessmentId) === String(assessmentId);
              return (
                <TableRow key={a.assessmentId} selected={active} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>
                      {a.name}
                    </Typography>
                    {a.description ? (
                      <Typography variant="caption" color="text.secondary">
                        {a.description}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{a.purpose || "—"}</TableCell>
                  <TableCell>
                    <Chip size="small" label={a.status || "ready"} />
                  </TableCell>
                  <TableCell align="right">{a.executionCount ?? 0}</TableCell>
                  <TableCell align="right">
                    {a.updatedAt ? new Date(a.updatedAt).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant={active ? "contained" : "outlined"}
                      disabled={active}
                      onClick={() => {
                        setAssessmentId(a.assessmentId);
                        onOpened?.(a);
                      }}
                      sx={{ textTransform: "none" }}
                    >
                      {active ? "Open" : "Open Assessment"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Dialog open={createOpen} onClose={() => !saving && setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create Assessment</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              autoFocus
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
            <TextField
              label="Purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              fullWidth
              placeholder="e.g. Quarterly privileged access review"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={attachOrphans}
                  onChange={(e) => setAttachOrphans(e.target.checked)}
                />
              }
              label="Attach existing unlinked scan snapshots to this Assessment"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
