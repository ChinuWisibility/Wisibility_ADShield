import { useMemo, useState, useEffect } from "react";
import { useParams, useSearchParams, Link as RouterLink } from "react-router-dom";
import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  Alert,
  Chip,
  Grid,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useQuery } from "@tanstack/react-query";
import { DataGrid } from "@mui/x-data-grid";
import AssessmentContextBar from "../../../components/security/AssessmentContextBar";
import FindingsTable from "../../../components/security/FindingsTable";
import RiskDrilldownDrawer from "../../../components/security/RiskDrilldownDrawer";
import SecurityExportMenu from "../../../components/security/SecurityExportMenu";
import SecurityRemediationStatusChip from "./components/SecurityRemediationStatusChip";
import EmptyStateSecurity from "../../../components/security/EmptyStateSecurity";
import SecurityFindingRemediateButton from "../../../components/security/SecurityFindingRemediateButton";
import { useSecurityWorkspace } from "../SecurityWorkspaceContext";
import { securityAPI } from "../../../services/securityApi";
import { featureLabel } from "../securityFeatureMeta";
import { securityPageHeaderSx } from "../securityTheme";
import useQueueTaskPageStatus from "../../../hooks/useQueueTaskPageStatus";

function findingTargetId(finding) {
  return (
    finding?.attributes?.orphanId ||
    finding?.attributes?.accountId ||
    finding?.metadata?.orphanId ||
    finding?.metadata?.accountId ||
    finding?.evidence?.orphanId ||
    finding?.evidence?.accountId ||
    null
  );
}

/**
 * Feature-level remediation drill-down — reuses FindingsTable + Compare buckets.
 */
export default function SecurityRemediationFeatureDetail() {
  const { featureId } = useParams();
  const [searchParams] = useSearchParams();
  const { applicationId: workspaceAppId, buildPath, setApplicationId } = useSecurityWorkspace();

  const applicationId = searchParams.get("applicationId") || workspaceAppId || "";
  const baselineScanId = searchParams.get("baselineScanId") || "";
  const currentScanId = searchParams.get("scanId") || "";

  const [selected, setSelected] = useState(null);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [bucket, setBucket] = useState("remaining");

  useEffect(() => {
    if (applicationId && applicationId !== workspaceAppId) {
      setApplicationId(applicationId);
    }
  }, [applicationId, workspaceAppId, setApplicationId]);

  const compareQuery = useQuery({
    queryKey: [
      "security",
      "remediation-feature-compare",
      applicationId,
      baselineScanId,
      currentScanId,
      featureId,
    ],
    queryFn: async () => {
      const res = await securityAPI.compareScans(applicationId, {
        left: baselineScanId || undefined,
        right: currentScanId || undefined,
      });
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId),
  });

  const featureStats = compareQuery.data?.byFeature?.[featureId] || null;

  const bucketRows = useMemo(() => {
    const data = compareQuery.data || {};
    const pick = (list) =>
      (list || []).filter((f) => String(f.feature) === String(featureId));
    if (bucket === "resolved") return pick(data.resolvedItems);
    if (bucket === "new") return pick(data.newItems);
    if (bucket === "reopened") return [];
    return pick(data.remainingItems || data.unchangedItems);
  }, [bucket, compareQuery.data, featureId]);

  const targetIds = useMemo(
    () =>
      bucketRows
        .map(findingTargetId)
        .filter(Boolean)
        .map(String),
    [bucketRows],
  );

  const queueStatus = useQueueTaskPageStatus({
    action: "IAM_ORPHAN_REVIEW",
    targetIds,
    enabled: targetIds.length > 0,
  });

  const findingsQuery = useQuery({
    queryKey: [
      "security",
      "remediation-feature-findings",
      applicationId,
      currentScanId,
      featureId,
      paginationModel.page,
      paginationModel.pageSize,
    ],
    queryFn: async () => {
      const res = await securityAPI.getFindings(applicationId, {
        scanId: currentScanId || undefined,
        feature: featureId,
        page: paginationModel.page + 1,
        limit: paginationModel.pageSize,
      });
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId) && bucket === "current",
  });

  const remediationColumns = useMemo(
    () => [
      {
        field: "compareClass",
        headerName: "Remediation",
        width: 120,
        renderCell: (params) => (
          <SecurityRemediationStatusChip status={params.value || bucket} />
        ),
      },
      {
        field: "objectName",
        headerName: "Object",
        flex: 1.2,
        minWidth: 140,
      },
      {
        field: "findingType",
        headerName: "Type",
        flex: 1,
        minWidth: 130,
      },
      {
        field: "recommendation",
        headerName: "Recommendation",
        flex: 1.5,
        minWidth: 160,
      },
      {
        field: "queueStatus",
        headerName: "Queue",
        width: 120,
        renderCell: (params) => {
          const tid = findingTargetId(params.row);
          const info = tid ? queueStatus.getQueuedInfo?.(String(tid)) : null;
          if (!info?.taskId && !info?.eventId) {
            return <Typography variant="caption">—</Typography>;
          }
          return <SecurityRemediationStatusChip status="queued" />;
        },
      },
      {
        field: "action",
        headerName: "Action",
        width: 140,
        sortable: false,
        renderCell: (params) => (
          <SecurityFindingRemediateButton
            finding={params.row}
            queuedInfo={
              findingTargetId(params.row)
                ? queueStatus.getQueuedInfo?.(String(findingTargetId(params.row)))
                : null
            }
            onQueuedRefresh={queueStatus.refresh}
          />
        ),
      },
    ],
    [bucket, queueStatus],
  );

  const gridRows = useMemo(
    () =>
      bucketRows.map((r, idx) => ({
        ...r,
        id: r.id || `${r.dn || r.objectName}-${idx}`,
        compareClass: r.compareClass || bucket,
      })),
    [bucket, bucketRows],
  );

  const backTo = buildPath("/security/remediation", {
    baselineScanId: baselineScanId || undefined,
  });

  return (
    <Box sx={{ p: 3, maxWidth: 1920, mx: "auto" }}>
      <Button
        component={RouterLink}
        to={backTo}
        startIcon={<ArrowBackIcon />}
        size="small"
        sx={{ textTransform: "none", mb: 1.5 }}
      >
        Back to Remediation
      </Button>

      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h5" sx={securityPageHeaderSx}>
            {featureLabel(featureId)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Feature remediation detail — baseline vs current assessment
          </Typography>
        </Box>
        {applicationId && (
          <SecurityExportMenu applicationId={applicationId} scanId={currentScanId} />
        )}
      </Stack>

      {!applicationId ? (
        <EmptyStateSecurity
          title="Select an application"
          description="Open Remediation Center and choose an application first."
        />
      ) : (
        <>
          <AssessmentContextBar />

          {compareQuery.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {compareQuery.error?.message || "Failed to load comparison"}
            </Alert>
          )}

          <Grid container spacing={1.5} sx={{ mb: 2 }}>
            {[
              { key: "baseline", label: "Baseline", value: featureStats?.baseline ?? "—" },
              { key: "current", label: "Current", value: featureStats?.current ?? "—" },
              { key: "resolved", label: "Resolved", value: featureStats?.resolved ?? 0 },
              { key: "remaining", label: "Remaining", value: featureStats?.remaining ?? 0 },
              { key: "new", label: "New", value: featureStats?.new ?? 0 },
              { key: "reopened", label: "Reopened", value: featureStats?.reopened ?? 0 },
            ].map((item) => (
              <Grid item xs={6} sm={4} md={2} key={item.key}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.25,
                    cursor: ["resolved", "remaining", "new", "current"].includes(item.key)
                      ? "pointer"
                      : "default",
                    borderColor:
                      bucket === item.key || (bucket === "remaining" && item.key === "remaining")
                        ? "primary.main"
                        : "divider",
                  }}
                  onClick={() => {
                    if (["resolved", "remaining", "new", "current"].includes(item.key)) {
                      setBucket(item.key);
                      setPaginationModel((m) => ({ ...m, page: 0 }));
                    }
                  }}
                >
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>
                    {item.label}
                  </Typography>
                  <Typography variant="h6" fontWeight={800}>
                    {item.value}
                  </Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>

          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
            {["remaining", "resolved", "new", "current"].map((key) => (
              <Chip
                key={key}
                size="small"
                label={key === "current" ? "Current findings" : key}
                color={bucket === key ? "primary" : "default"}
                variant={bucket === key ? "filled" : "outlined"}
                onClick={() => setBucket(key)}
                sx={{ textTransform: "capitalize" }}
              />
            ))}
          </Stack>

          <Paper sx={{ p: 1, border: 1, borderColor: "divider" }}>
            {bucket === "current" ? (
              <FindingsTable
                rows={findingsQuery.data?.items || findingsQuery.data?.findings || []}
                rowCount={findingsQuery.data?.total ?? 0}
                paginationModel={paginationModel}
                onPaginationModelChange={setPaginationModel}
                loading={findingsQuery.isLoading}
                onRowClick={setSelected}
              />
            ) : (
              <Box sx={{ width: "100%", minHeight: 420 }}>
                <DataGrid
                  rows={gridRows}
                  columns={remediationColumns}
                  loading={compareQuery.isLoading}
                  pageSizeOptions={[25, 50]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                  disableRowSelectionOnClick
                  onRowClick={(params) => setSelected(params.row)}
                  disableColumnMenu
                  density="compact"
                  sx={{
                    border: "none",
                    "& .MuiDataGrid-row": { cursor: "pointer" },
                  }}
                />
              </Box>
            )}
          </Paper>
        </>
      )}

      <RiskDrilldownDrawer
        open={Boolean(selected)}
        finding={selected}
        onClose={() => setSelected(null)}
        remediationContext={{
          compareClass: selected?.compareClass || bucket,
          baselineScanId,
          currentScanId,
          queuedInfo: findingTargetId(selected)
            ? queueStatus.getQueuedInfo?.(String(findingTargetId(selected)))
            : null,
        }}
      />
    </Box>
  );
}
