import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  Alert,
  Skeleton,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { securityAPI } from "../../services/securityApi";
import { useSecurityWorkspace } from "../../pages/security/SecurityWorkspaceContext";
import { featureLabel } from "../../pages/security/securityFeatureMeta";

/**
 * Assessment Compare — Resolved / New / Unchanged between two scans.
 */
export default function AssessmentComparePanel({
  leftScanId: leftProp,
  rightScanId: rightProp,
  compact = false,
}) {
  const navigate = useNavigate();
  const { applicationId, assessmentId, scanId, overview, buildPath } = useSecurityWorkspace();
  const [leftScanId, setLeftScanId] = useState(leftProp || overview?.previousScanId || "");
  const [rightScanId, setRightScanId] = useState(rightProp || scanId || "");

  const scansQuery = useQuery({
    queryKey: ["security", "scans-compare-picker", applicationId, assessmentId],
    queryFn: async () => {
      const res = await securityAPI.listScans(applicationId, {
        limit: 20,
        page: 1,
        assessmentId: assessmentId || undefined,
      });
      return Array.isArray(res.data?.data) ? res.data.data : [];
    },
    enabled: Boolean(applicationId),
  });

  const compareQuery = useQuery({
    queryKey: ["security", "compare", applicationId, assessmentId, leftScanId, rightScanId],
    queryFn: async () => {
      const res = await securityAPI.compareScans(applicationId, {
        left: leftScanId || undefined,
        right: rightScanId || undefined,
        assessmentId: assessmentId || undefined,
      });
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId) && Boolean(leftScanId || rightScanId || overview?.previousScanId),
    retry: false,
  });

  const data = compareQuery.data;
  const scans = scansQuery.data || [];

  const scanLabel = useMemo(() => {
    const map = new Map(
      scans.map((s) => [
        s.scanId,
        s.completedAt || s.startedAt
          ? new Date(s.completedAt || s.startedAt).toLocaleString()
          : s.scanId?.slice(0, 8),
      ]),
    );
    return (id) => map.get(id) || (id ? `${String(id).slice(0, 8)}…` : "—");
  }, [scans]);

  if (!applicationId) return null;

  return (
    <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        spacing={1}
        sx={{ mb: 1.5 }}
      >
        <Box>
          <Typography variant="subtitle2" fontWeight={800}>
            Assessment Version comparison
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Resolved · New · Unchanged between executions of the same Assessment Version
          </Typography>
        </Box>
        {!compact && (
          <Stack direction="row" spacing={1}>
            <TextField
              select
              size="small"
              label="Older"
              value={leftScanId || data?.leftScanId || ""}
              onChange={(e) => setLeftScanId(e.target.value)}
              sx={{ minWidth: 180 }}
            >
              {scans.map((s) => (
                <MenuItem key={s.scanId} value={s.scanId}>
                  {scanLabel(s.scanId)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Newer"
              value={rightScanId || data?.rightScanId || ""}
              onChange={(e) => setRightScanId(e.target.value)}
              sx={{ minWidth: 180 }}
            >
              {scans.map((s) => (
                <MenuItem key={s.scanId} value={s.scanId}>
                  {scanLabel(s.scanId)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        )}
      </Stack>

      {compareQuery.isLoading && <Skeleton height={64} />}
      {compareQuery.error && (
        <Alert severity="error">
          {compareQuery.error?.response?.data?.message || compareQuery.error.message}
        </Alert>
      )}
      {data?.message && !data.leftScanId && (
        <Alert severity="info">{data.message}</Alert>
      )}

      {data && (data.leftScanId || data.rightScanId) && (
        <>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
            <Chip color="success" label={`Resolved ${data.resolved ?? 0}`} />
            <Chip color="error" label={`New ${data.new ?? 0}`} />
            <Chip variant="outlined" label={`Unchanged ${data.unchanged ?? 0}`} />
          </Stack>
          {!compact && (
            <Stack spacing={1}>
              <SampleList title="New (sample)" items={data.newItems} tone="error" />
              <SampleList title="Resolved (sample)" items={data.resolvedItems} tone="success" />
            </Stack>
          )}
          <Button
            size="small"
            sx={{ mt: 1, textTransform: "none" }}
            onClick={() =>
              navigate(
                buildPath("/security/findings", {
                  compareLeft: data.leftScanId,
                  compareRight: data.rightScanId,
                }),
              )
            }
          >
            Review in Findings
          </Button>
        </>
      )}
    </Paper>
  );
}

function SampleList({ title, items, tone }) {
  if (!items?.length) return null;
  return (
    <Box>
      <Typography variant="caption" fontWeight={700} color={tone === "error" ? "error.main" : "success.main"}>
        {title}
      </Typography>
      {items.slice(0, 5).map((f) => (
        <Typography key={f.id || `${f.feature}-${f.dn}`} variant="body2" sx={{ pl: 1 }}>
          {f.objectName || "—"} · {featureLabel(f.feature)}
        </Typography>
      ))}
    </Box>
  );
}
