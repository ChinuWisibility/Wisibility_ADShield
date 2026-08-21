import { useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { securityAPI } from "../../services/securityApi";
import { useSecurityWorkspace } from "../../pages/security/SecurityWorkspaceContext";
import { SCAN_CENTER_INK } from "../../pages/security/securityTheme";

/**
 * Version history with nested executions for Assessment Workspace.
 */
export default function AssessmentVersionHistoryPanel() {
  const queryClient = useQueryClient();
  const {
    applicationId,
    assessmentId,
    viewVersionId,
    setViewVersionId,
    setScanId,
    scanId,
    refreshWorkspace,
  } = useSecurityWorkspace();
  const [cloningId, setCloningId] = useState(null);
  const [error, setError] = useState("");

  const versionsQuery = useQuery({
    queryKey: ["security", "assessment-versions", applicationId, assessmentId],
    queryFn: async () => {
      const res = await securityAPI.listAssessmentVersions(applicationId, assessmentId, {
        limit: 100,
        page: 1,
        includeExecutions: true,
      });
      const payload = res.data ?? {};
      return {
        items: Array.isArray(payload.data) ? payload.data : [],
        total: Number(payload.total) || 0,
      };
    },
    enabled: Boolean(applicationId) && Boolean(assessmentId),
  });

  const items = useMemo(() => versionsQuery.data?.items || [], [versionsQuery.data]);

  const handleClone = async (version) => {
    setCloningId(version.assessmentVersionId);
    setError("");
    try {
      await securityAPI.cloneVersionToWorking(
        applicationId,
        assessmentId,
        version.assessmentVersionId,
      );
      setViewVersionId("");
      refreshWorkspace();
      await queryClient.invalidateQueries({
        queryKey: ["security", "working-config", applicationId, assessmentId],
      });
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Clone failed");
    } finally {
      setCloningId(null);
    }
  };

  if (!applicationId || !assessmentId) return null;

  return (
    <Paper sx={{ border: 1, borderColor: "divider", overflow: "hidden", mb: 2 }}>
      <Box sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          Version history
        </Typography>
        <Typography variant="caption" sx={{ color: SCAN_CENTER_INK.muted }}>
          Immutable snapshots created automatically on Execute. Working Configuration is edited
          above.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mx: 1.5, mb: 1 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {versionsQuery.isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {!versionsQuery.isLoading && items.length === 0 && (
        <Typography variant="body2" sx={{ px: 1.5, pb: 2, color: SCAN_CENTER_INK.muted }}>
          No Versions yet. Execute Assessment to freeze Working Configuration into Version 1.
        </Typography>
      )}

      {items.map((v) => {
        const expanded = String(v.assessmentVersionId) === String(viewVersionId);
        const executions = Array.isArray(v.executions) ? v.executions : [];
        return (
          <Accordion
            key={v.assessmentVersionId}
            disableGutters
            elevation={0}
            expanded={expanded || undefined}
            onChange={(_, isExpanded) => {
              if (isExpanded) setViewVersionId(v.assessmentVersionId);
            }}
            sx={{ borderTop: 1, borderColor: "divider", "&:before": { display: "none" } }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{ width: "100%", pr: 1 }}
                flexWrap="wrap"
                useFlexGap
              >
                <Typography variant="body2" fontWeight={700}>
                  {v.label || `Version ${v.versionNumber}`}
                </Typography>
                <Typography variant="caption" sx={{ color: SCAN_CENTER_INK.soft }}>
                  {v.createdAt ? new Date(v.createdAt).toLocaleString() : "—"}
                </Typography>
                <Typography variant="caption" sx={{ color: SCAN_CENTER_INK.muted }}>
                  {v.executionCount || executions.length || 0} execution
                  {(v.executionCount || executions.length || 0) === 1 ? "" : "s"}
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
                <Button
                  size="small"
                  variant={
                    String(viewVersionId) === String(v.assessmentVersionId)
                      ? "contained"
                      : "outlined"
                  }
                  onClick={() => setViewVersionId(v.assessmentVersionId)}
                  sx={{ textTransform: "none" }}
                >
                  View configuration
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={cloningId === v.assessmentVersionId}
                  onClick={() => handleClone(v)}
                  sx={{ textTransform: "none" }}
                >
                  {cloningId === v.assessmentVersionId
                    ? "Cloning…"
                    : "Clone to Working Configuration"}
                </Button>
                <Button
                  size="small"
                  variant="text"
                  onClick={() => setViewVersionId("")}
                  sx={{ textTransform: "none" }}
                >
                  Back to Working Configuration
                </Button>
              </Stack>

              <Typography variant="caption" fontWeight={700} sx={{ color: SCAN_CENTER_INK.soft }}>
                EXECUTIONS
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Started</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Findings</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {executions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Typography variant="body2" sx={{ color: SCAN_CENTER_INK.muted }}>
                          No executions under this Version.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {executions.map((ex) => {
                    const active = ex.scanId === scanId;
                    return (
                      <TableRow key={ex.scanId} selected={active} hover>
                        <TableCell>
                          {ex.startedAt || ex.completedAt
                            ? new Date(ex.startedAt || ex.completedAt).toLocaleString()
                            : "—"}
                        </TableCell>
                        <TableCell>{ex.status || "completed"}</TableCell>
                        <TableCell align="right">{ex.totalFindings ?? 0}</TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            disabled={active}
                            onClick={() => setScanId(ex.scanId)}
                            sx={{ textTransform: "none" }}
                          >
                            {active ? "In use" : "Use execution"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Paper>
  );
}
