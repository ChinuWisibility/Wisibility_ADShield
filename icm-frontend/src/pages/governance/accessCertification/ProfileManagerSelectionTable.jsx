/**
 * ProfileManagerSelectionTable
 *
 * Displays managers who have direct reports inside the selected identity profile.
 * Used exclusively in the PROFILE + MANAGER certification wizard step.
 *
 * Key differences from ManagerSelectionTable:
 *  - Receives pre-fetched `managers` data as a prop (parent fetches via useEffect)
 *  - Selection key is `managerId` (ObjectId string) — stable, not manager name
 *  - Columns: Manager Name, Department, Direct Reports Count, Risk Count
 *  - Risk Count chip turns amber when > 0 to signal attention
 */

import React, { useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  Typography,
  Button,
  Divider,
  Chip,
  CircularProgress,
  Box,
  Skeleton,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SearchableTableLayout from './SearchableTableLayout';

/* =========================================================
   🔍 Search Filter
========================================================= */
const filterFn = (row, query) => {
  if (!query || !query.trim()) return true;
  const q = query.toLowerCase();
  return [
    row.managerName,
    row.managerEmail,
    row.department,
  ].join(' ').toLowerCase().includes(q);
};

/* =========================================================
   🧩 Component
========================================================= */
/**
 * @param {{
 *   managers: Array<{managerId: string, managerName: string, managerEmail: string, department: string, directReportsCount: number, riskCount: number}>,
 *   loading: boolean,
 *   selectedIds: string[],
 *   onChangeSelectedIds: (ids: string[]) => void,
 *   selectedObjects: object[],
 *   onChangeSelectedObjects: (objs: object[]) => void,
 *   pageSize?: number,
 *   maxBodyHeight?: number,
 * }} props
 */
export default function ProfileManagerSelectionTable({
  managers = [],
  loading = false,
  selectedIds,
  onChangeSelectedIds,
  selectedObjects,
  onChangeSelectedObjects,
  pageSize = 10,
  maxBodyHeight = 380,
}) {
  /* ==========================================
     🧩 Selection Logic
  ========================================== */
  const toggleRow = useCallback(
    (managerId, managerRow) => {
      if (selectedIds.includes(managerId)) {
        onChangeSelectedIds(selectedIds.filter((id) => id !== managerId));
        onChangeSelectedObjects(selectedObjects.filter((o) => o.managerId !== managerId));
      } else {
        onChangeSelectedIds([...selectedIds, managerId]);
        onChangeSelectedObjects([...selectedObjects, managerRow]);
      }
    },
    [selectedIds, onChangeSelectedIds, selectedObjects, onChangeSelectedObjects],
  );

  const clearSelection = () => {
    onChangeSelectedIds([]);
    onChangeSelectedObjects([]);
  };

  const renderToolbarActions = (filteredData) => {
    const numSelected = selectedIds.length;

    const selectAllFiltered = () => {
      const newIds = filteredData.map((r) => r.managerId);
      const allIds = Array.from(new Set([...selectedIds, ...newIds]));
      const allObjs = [
        ...selectedObjects.filter((o) => !newIds.includes(o.managerId)),
        ...filteredData.filter((r) => !selectedIds.includes(r.managerId)),
      ];
      onChangeSelectedIds(allIds);
      onChangeSelectedObjects(allObjs);
    };

    return (
      <>
        {numSelected > 0 && (
          <>
            <Typography variant="subtitle2" color="primary.main" sx={{ fontWeight: 600 }}>
              {numSelected} selected
            </Typography>
            <Button size="small" onClick={clearSelection} sx={{ color: 'text.secondary' }}>
              Clear
            </Button>
            <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
          </>
        )}
        <Button size="small" onClick={selectAllFiltered}>
          Select All ({filteredData.length})
        </Button>
      </>
    );
  };

  /* ==========================================
     🪟 Loading skeleton
  ========================================== */
  if (loading) {
    return (
      <Box sx={{ mt: 1 }}>
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} variant="rectangular" height={40} sx={{ mb: 0.5, borderRadius: 1 }} />
        ))}
      </Box>
    );
  }

  /* ==========================================
     🪟 Render Table
  ========================================== */
  return (
    <SearchableTableLayout
      data={managers}
      filterFn={filterFn}
      searchPlaceholder="Search managers by name, email, or department…"
      renderToolbarActions={renderToolbarActions}
      pageSize={pageSize}
    >
      {(pagedData) => {
        const allVisibleSelected =
          pagedData.length > 0 &&
          pagedData.every((r) => selectedIds.includes(r.managerId));

        const someVisibleSelected =
          pagedData.some((r) => selectedIds.includes(r.managerId));

        const toggleSelectAllVisible = () => {
          if (allVisibleSelected) {
            const visibleIds = new Set(pagedData.map((r) => r.managerId));
            onChangeSelectedIds(selectedIds.filter((id) => !visibleIds.has(id)));
            onChangeSelectedObjects(selectedObjects.filter((o) => !visibleIds.has(o.managerId)));
          } else {
            const add = pagedData.filter((r) => !selectedIds.includes(r.managerId));
            onChangeSelectedIds([...selectedIds, ...add.map((r) => r.managerId)]);
            onChangeSelectedObjects([...selectedObjects, ...add]);
          }
        };

        return (
          <TableContainer sx={{ maxHeight: maxBodyHeight, overflowY: 'auto' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      indeterminate={someVisibleSelected && !allVisibleSelected}
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                    />
                  </TableCell>
                  <TableCell>Manager</TableCell>
                  <TableCell>Department</TableCell>
                  <TableCell align="center">Direct Reports</TableCell>
                  <TableCell align="center">Risk Count</TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {pagedData.map((row) => {
                  const checked = selectedIds.includes(row.managerId);
                  return (
                    <TableRow
                      key={row.managerId}
                      hover
                      onClick={() => toggleRow(row.managerId, row)}
                      sx={{
                        cursor: 'pointer',
                        backgroundColor: checked ? 'action.selected' : undefined,
                      }}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={checked}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleRow(row.managerId, row)}
                        />
                      </TableCell>

                      {/* Manager Name + Email */}
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {row.managerName || '—'}
                        </Typography>
                        {row.managerEmail && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {row.managerEmail}
                          </Typography>
                        )}
                      </TableCell>

                      {/* Department */}
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {row.department || '—'}
                        </Typography>
                      </TableCell>

                      {/* Direct Reports Count */}
                      <TableCell align="center">
                        <Chip
                          label={row.directReportsCount ?? 0}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                      </TableCell>

                      {/* Risk Count — amber when > 0 */}
                      <TableCell align="center">
                        {row.riskCount > 0 ? (
                          <Chip
                            icon={<WarningAmberIcon fontSize="small" />}
                            label={row.riskCount}
                            size="small"
                            color="warning"
                            variant="outlined"
                          />
                        ) : (
                          <Chip
                            label="0"
                            size="small"
                            color="default"
                            variant="outlined"
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}

                {pagedData.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 3 }}>
                      <Typography variant="body2" color="text.secondary">
                        No managers found for this identity profile.
                        Ensure identities have been imported and correlated with a manager.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        );
      }}
    </SearchableTableLayout>
  );
}
