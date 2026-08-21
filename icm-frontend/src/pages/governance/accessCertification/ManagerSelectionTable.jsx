import React, { useCallback, useEffect, useState } from 'react';
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Checkbox, Typography, Button, Divider, Chip, CircularProgress // <--- Added this
} from '@mui/material';
import SearchableTableLayout from './SearchableTableLayout';
import accessCertificationService from '../../../services/accessCertificationService';

/* =========================================================
   🔍 Search Filter
========================================================= */
const managerFilterFn = (row, query) => {
    if (!query || !query.trim()) return true;
    const q = query.toLowerCase();

    // specific helper to safely join arrays or strings
    const getVal = (val) => (Array.isArray(val) ? val.join(" ") : String(val || ""));

    return [
        row.name,
        getVal(row.titles),
        getVal(row.departments),
        getVal(row.companies),
        getVal(row.emails),
    ].join(" ").toLowerCase().includes(q);
};

/* =========================================================
   🧩 Component
========================================================= */
export default function ManagerSelectionTable({
    selectedIds,
    onChangeSelectedIds,
    pageSize = 10,
    maxBodyHeight = 380,
    applicationId = ""
}) {
    const [data, setData] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    /* ==========================================
       🔥 Fetch Managers
    ========================================== */
    useEffect(() => {
        const fetchManagers = async () => {
            setLoading(true);
            try {
                await accessCertificationService.controller.initializeCertification(
                    (res) => {
                        const managers = res?.managers || [];
                        setData(managers);
                    },
                    setError,
                    applicationId || undefined
                );
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchManagers();
    }, [applicationId]);

    /* ==========================================
       🧩 Selection Logic
    ========================================== */
    const toggleRow = useCallback(
        (name) => {
            if (selectedIds.includes(name)) {
                onChangeSelectedIds(selectedIds.filter((x) => x !== name));
            } else {
                onChangeSelectedIds([...selectedIds, name]);
            }
        },
        [selectedIds, onChangeSelectedIds]
    );

    const clearSelection = () => onChangeSelectedIds([]);

    const renderToolbarActions = (filteredData) => {
        const numSelected = selectedIds.length;

        const selectAllFiltered = () => {
            const names = filteredData.map((r) => r.name);
            onChangeSelectedIds(Array.from(new Set([...selectedIds, ...names])));
        };

        return (
            <>
                {numSelected > 0 && (
                    <>
                        <Typography variant="subtitle2" color="primary.main" sx={{ fontWeight: 600 }}>
                            {numSelected} Selected
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
       🪟 Render Table
    ========================================== */
    return (
        <SearchableTableLayout
            data={data}
            filterFn={managerFilterFn}
            searchPlaceholder="Search managers by name, title, or department…"
            renderToolbarActions={renderToolbarActions}
            pageSize={pageSize}
        >
            {(pagedData) => {
                const allVisibleSelected =
                    pagedData.length > 0 &&
                    pagedData.every((r) => selectedIds.includes(r.name));

                const someVisibleSelected =
                    pagedData.some((r) => selectedIds.includes(r.name));

                const toggleSelectAllVisible = () => {
                    const visibleNames = new Set(pagedData.map((r) => r.name));

                    if (allVisibleSelected) {
                        onChangeSelectedIds(
                            selectedIds.filter((n) => !visibleNames.has(n))
                        );
                    } else {
                        const add = pagedData
                            .map((r) => r.name)
                            .filter((n) => !selectedIds.includes(n));
                        onChangeSelectedIds([...selectedIds, ...add]);
                    }
                };

                return (
                    <TableContainer
                        sx={{
                            maxHeight: maxBodyHeight,
                            overflowY: "auto",
                        }}
                    >
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
                                    <TableCell>Manager Name</TableCell>
                                    <TableCell>Report Count</TableCell>
                                    <TableCell>Department</TableCell>
                                    <TableCell>Title</TableCell>
                                </TableRow>
                            </TableHead>

                            <TableBody>
                                {loading && (
                                    <TableRow>
                                        <TableCell colSpan={5} align="center">
                                            <CircularProgress size={20} sx={{ mr: 1, verticalAlign: 'middle' }} />
                                            Loading managers...
                                        </TableCell>
                                    </TableRow>
                                )}

                                {!loading &&
                                    pagedData.map((row) => {
                                        const checked = selectedIds.includes(row.name);
                                        // Backend returns arrays for aggregated fields
                                        const departments = row.departments?.join(", ") || "—";
                                        const titles = row.titles?.join(", ") || "—";

                                        return (
                                            <TableRow
                                                key={row.id}
                                                hover
                                                onClick={() => toggleRow(row.name)}
                                                sx={{
                                                    cursor: 'pointer',
                                                    backgroundColor: checked ? 'action.selected' : undefined,
                                                }}
                                            >
                                                <TableCell padding="checkbox">
                                                    <Checkbox
                                                        checked={checked}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={() => toggleRow(row.name)}
                                                    />
                                                </TableCell>

                                                <TableCell>
                                                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                        {row.name}
                                                    </Typography>
                                                    {row.emails?.[0] && (
                                                        <Typography variant="caption" color="text.secondary" display="block">
                                                            {row.emails[0]}
                                                        </Typography>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={row.directReportsCount}
                                                        size="small"
                                                        color={row.directReportsCount > 0 ? "default" : "warning"}
                                                        variant="outlined"
                                                    />
                                                </TableCell>
                                                <TableCell sx={{ maxWidth: 200 }} noWrap title={departments}>
                                                    {departments}
                                                </TableCell>
                                                <TableCell sx={{ maxWidth: 200 }} noWrap title={titles}>
                                                    {titles}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}

                                {!loading && pagedData.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} align="center">
                                            {error || "No managers match your search."}
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