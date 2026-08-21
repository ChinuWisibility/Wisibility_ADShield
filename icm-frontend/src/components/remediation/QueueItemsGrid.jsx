import {
  Box,
  Checkbox,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from "@mui/material";

export default function QueueItemsGrid({
  rows = [],
  eventType = "",
  loading = false,
  selectedIds = new Set(),
  onToggle,
  onToggleAll,
  page = 0,
  rowsPerPage = 25,
  total = 0,
  onPageChange,
  onRowsPerPageChange,
  search = "",
  onSearchChange,
}) {
  const pageIds = rows.map((r) => String(r._id));
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const showApplication = eventType !== "REVOKE_ACCESS" || rows.some((r) => r.applicationName);
  const showEntitlement = [
    "REVOKE_ACCESS",
    "MISSING_MANAGER",
    "INACTIVE_USER_ACCESS",
    "ORPHAN_ACCOUNT",
  ].includes(eventType);

  return (
    <Box>
      <TextField
        size="small"
        label="Search items"
        value={search}
        onChange={(e) => onSearchChange?.(e.target.value)}
        sx={{ mb: 2, minWidth: 280 }}
      />

      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "#2563EB", "& th": { color: "#fff", fontWeight: 700 } }}>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={allSelected}
                  indeterminate={selectedIds.size > 0 && !allSelected}
                  onChange={() => onToggleAll?.(pageIds)}
                  sx={{ color: "#fff", "&.Mui-checked": { color: "#fff" } }}
                />
              </TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              {showApplication && <TableCell>Application</TableCell>}
              {showEntitlement && <TableCell>Entitlement / Account</TableCell>}
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && !rows.length ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No queue items found.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, idx) => {
                const id = String(row._id);
                return (
                  <TableRow
                    key={id}
                    hover
                    sx={{ bgcolor: idx % 2 === 0 ? "#f8fafc" : "#fff" }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selectedIds.has(id)}
                        onChange={() => onToggle?.(id, row)}
                      />
                    </TableCell>
                    <TableCell>{row.identityName || "—"}</TableCell>
                    <TableCell>{row.identityEmail || row.metadata?.email || "—"}</TableCell>
                    {showApplication && (
                      <TableCell>{row.applicationName || row.metadata?.applicationLabel || "—"}</TableCell>
                    )}
                    {showEntitlement && (
                      <TableCell>{row.entitlementName || row.accountId || "—"}</TableCell>
                    )}
                    <TableCell>{row.currentStatus || "PENDING"}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={total}
        page={page}
        onPageChange={(_, p) => onPageChange?.(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => onRowsPerPageChange?.(parseInt(e.target.value, 10))}
        rowsPerPageOptions={[10, 25, 50, 100]}
      />
    </Box>
  );
}
