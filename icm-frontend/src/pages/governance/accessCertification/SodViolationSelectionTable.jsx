import { useEffect, useMemo, useState } from "react";
import { Box, Chip, Typography } from "@mui/material";
import DataTable from "../../../components/DataTable";
import { sodAPI } from "../../../services/sodService";

export default function SodViolationSelectionTable({
  selectedIds,
  onChangeSelectedIds,
  onChangeSelectedObjects,
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, pages: 1 });

  const load = async (page0 = 0, limit0 = pagination.limit) => {
    setLoading(true);
    try {
      const res = await sodAPI.listViolations({ page: page0 + 1, limit: limit0 });
      setRows(res.data?.data || []);
      setPagination(res.data?.pagination || { page: page0 + 1, limit: limit0, total: 0, pages: 1 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = useMemo(
    () => [
      {
        field: "identityName",
        headerName: "Identity",
        minWidth: 240,
        renderCell: (row) => (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
              {row.identityName || row.identityEmail || "—"}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {row.department || row.identityEmail || "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "policyName",
        headerName: "Policy",
        minWidth: 220,
        renderCell: (row) => (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
              {row.policyName || "—"}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {row.ruleName || "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "conflict",
        headerName: "Conflict",
        minWidth: 260,
        sortable: false,
        renderCell: (row) => {
          const l = row.leftEntitlements?.[0]?.name || "—";
          const r = row.rightEntitlements?.[0]?.name || "—";
          return (
            <Typography variant="body2" color="text.secondary" noWrap>
              {l} ⟂ {r}
            </Typography>
          );
        },
      },
      {
        field: "severity",
        headerName: "Severity",
        width: 120,
        renderCell: (row) => (
          <Chip size="small" label={row.severity || "—"} sx={{ fontWeight: 800 }} />
        ),
      },
      {
        field: "status",
        headerName: "Status",
        width: 120,
        renderCell: (row) => (
          <Chip size="small" label={row.status || "—"} sx={{ fontWeight: 800 }} />
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      title="Select SoD violations"
      columns={columns}
      rows={rows}
      loading={loading}
      selectable
      searchable={false}
      onSelectionChange={(ids) => {
        onChangeSelectedIds?.(ids);
        const set = new Set(ids.map(String));
        onChangeSelectedObjects?.(rows.filter((r) => set.has(String(r._id))));
      }}
      serverPagination
      totalCount={pagination.total || 0}
      page={(pagination.page || 1) - 1}
      rowsPerPage={pagination.limit || 25}
      onPageChange={(p) => load(p, pagination.limit)}
      onRowsPerPageChange={(n) => load(0, n)}
      emptyMessage="No SoD violations are available yet. Run SoD evaluation to generate findings."
      toolbarLeft={
        selectedIds?.length ? (
          <Chip size="small" color="primary" label={`${selectedIds.length} selected`} />
        ) : null
      }
    />
  );
}

