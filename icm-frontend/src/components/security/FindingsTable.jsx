import { useMemo } from "react";
import { DataGrid } from "@mui/x-data-grid";
import { Box } from "@mui/material";
import { featureLabel } from "../../pages/security/securityFeatureMeta";
import { findingTypeLabel } from "../../pages/security/findingTypeMeta";

const columns = [
  {
    field: "findingType",
    headerName: "Finding type",
    flex: 1,
    minWidth: 150,
    valueFormatter: (value) => findingTypeLabel(value),
  },
  {
    field: "matchedPolicyName",
    headerName: "Matched policy",
    flex: 1,
    minWidth: 160,
    valueFormatter: (value, row) =>
      value || (row?.severity === "not defined" ? "Not defined" : "—"),
  },
  {
    field: "objectName",
    headerName: "Object",
    flex: 1.2,
    minWidth: 140,
  },
  {
    field: "objectType",
    headerName: "Type",
    width: 80,
  },
  {
    field: "feature",
    headerName: "Detector",
    flex: 1,
    minWidth: 130,
    valueFormatter: (value) => featureLabel(value),
  },
  {
    field: "recommendation",
    headerName: "Recommendation",
    flex: 1.5,
    minWidth: 180,
  },
  {
    field: "scannedAt",
    headerName: "Scan time",
    width: 150,
    valueFormatter: (value) => (value ? new Date(value).toLocaleString() : "—"),
  },
];

/**
 * Server-paginated findings grid (policy-evaluated risk).
 */
export default function FindingsTable({
  rows,
  rowCount,
  paginationModel,
  onPaginationModelChange,
  loading,
  onRowClick,
  sortModel,
  onSortModelChange,
}) {
  const gridRows = useMemo(
    () =>
      (rows || []).map((r) => ({
        ...r,
        id: r.id || `${r.scanId}-${r.feature}-${r.objectName}`,
      })),
    [rows],
  );

  return (
    <Box sx={{ width: "100%", minHeight: 420 }}>
      <DataGrid
        rows={gridRows}
        columns={columns}
        rowCount={rowCount ?? 0}
        loading={loading}
        paginationMode="server"
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        pageSizeOptions={[25, 50, 100]}
        disableRowSelectionOnClick
        onRowClick={(params) => onRowClick?.(params.row)}
        sortModel={sortModel}
        onSortModelChange={onSortModelChange}
        sortingMode="server"
        disableColumnMenu
        density="compact"
        sx={{
          border: "none",
          "& .MuiDataGrid-row": { cursor: onRowClick ? "pointer" : "default" },
          "& .MuiDataGrid-columnHeaders": {
            bgcolor: "action.hover",
            fontWeight: 700,
          },
        }}
      />
    </Box>
  );
}
