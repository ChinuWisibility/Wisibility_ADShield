import { useMemo } from "react";
import {
  Box,
  Checkbox,
  Chip,
  MenuItem,
  Stack,
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

function labelizeStatus(status) {
  return String(status || "PENDING")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function statusColor(status) {
  const s = String(status || "").toUpperCase();
  if (s === "APPROVED" || s === "EXECUTED") return "success";
  if (s === "DENIED") return "error";
  if (s === "TICKET_CREATED" || s === "IN_PROGRESS") return "info";
  return "default";
}

export default function RevokedUsersGrid({
  rows = [],
  loading = false,
  selectedKeys = new Set(),
  onToggle,
  onToggleAll,
  page = 0,
  rowsPerPage = 25,
  total = 0,
  onPageChange,
  onRowsPerPageChange,
  search = "",
  onSearchChange,
  filters = {},
  onFilterChange,
  sortBy = "itemName",
  sortDir = "asc",
  onSortChange,
  filterOptions = { applications: [], campaigns: [], entitlements: [] },
}) {
  const pendingKeys = useMemo(
    () => rows.filter((r) => !r.ticketItemStatus || r.status === "PENDING").map((r) => r.itemKey),
    [rows],
  );

  const allSelected =
    pendingKeys.length > 0 && pendingKeys.every((k) => selectedKeys.has(k));

  return (
    <Box>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Search"
          value={search}
          onChange={(e) => onSearchChange?.(e.target.value)}
          sx={{ minWidth: 200, flex: 1 }}
        />
        <TextField
          select
          size="small"
          label="Application"
          value={filters.applicationName || ""}
          onChange={(e) => onFilterChange?.({ ...filters, applicationName: e.target.value })}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          {filterOptions.applications.map((a) => (
            <MenuItem key={a} value={a}>
              {a}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Campaign"
          value={filters.campaignName || ""}
          onChange={(e) => onFilterChange?.({ ...filters, campaignName: e.target.value })}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          {filterOptions.campaigns.map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Entitlement"
          value={filters.entitlementName || ""}
          onChange={(e) => onFilterChange?.({ ...filters, entitlementName: e.target.value })}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          {filterOptions.entitlements.map((e) => (
            <MenuItem key={e} value={e}>
              {e}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={allSelected}
                  indeterminate={
                    selectedKeys.size > 0 && !allSelected && pendingKeys.some((k) => selectedKeys.has(k))
                  }
                  onChange={() => onToggleAll?.(pendingKeys)}
                  disabled={!pendingKeys.length}
                />
              </TableCell>
              {[
                ["itemName", "User Name"],
                ["itemEmail", "Email"],
                ["applicationName", "Application"],
                ["entitlementName", "Entitlement"],
                ["campaignName", "Campaign"],
                ["reviewerName", "Reviewer"],
                ["reviewedAt", "Reviewed Date"],
                ["status", "Status"],
              ].map(([field, label]) => (
                <TableCell key={field}>
                  {onSortChange ? (
                    <TableSortLabel
                      active={sortBy === field}
                      direction={sortBy === field ? sortDir : "asc"}
                      onClick={() =>
                        onSortChange(
                          field,
                          sortBy === field && sortDir === "asc" ? "desc" : "asc",
                        )
                      }
                    >
                      {label}
                    </TableSortLabel>
                  ) : (
                    label
                  )}
                </TableCell>
              ))}
              <TableCell>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={10} align="center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} align="center">
                  No revoked users found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const displayStatus = row.ticketItemStatus || row.status || "PENDING";
                const selectable = displayStatus === "PENDING";
                return (
                  <TableRow key={row.itemKey} hover selected={selectedKeys.has(row.itemKey)}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selectedKeys.has(row.itemKey)}
                        disabled={!selectable}
                        onChange={() => onToggle?.(row.itemKey)}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {row.itemName}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.itemEmail || "—"}</TableCell>
                    <TableCell>{row.applicationName || "—"}</TableCell>
                    <TableCell>{row.entitlementName || "—"}</TableCell>
                    <TableCell>{row.campaignName || "—"}</TableCell>
                    <TableCell>{row.reviewerName || row.reviewerEmail || "—"}</TableCell>
                    <TableCell>
                      {row.reviewedAt
                        ? new Date(row.reviewedAt).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={labelizeStatus(displayStatus)}
                        color={statusColor(displayStatus)}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      {row.decision ? labelizeStatus(row.decision) : "—"}
                    </TableCell>
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
