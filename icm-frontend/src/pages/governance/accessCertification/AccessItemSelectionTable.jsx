import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Checkbox, Typography, Button, Divider, Box, useTheme, CircularProgress,
    Tabs, Tab,
} from '@mui/material';
import SearchableTableLayout from './SearchableTableLayout';
import accessCertificationService, {
    collectPrivilegeMatchMemberTokens,
    countUsersMatchingEntitlementTokenLists,
} from '../../../services/accessCertificationService';

/* ============================================================
   Helpers & Styles
   ============================================================ */
const itemFilterFn = (row, query) => {
    if (!query) return true;
    const q = query.toLowerCase();
    const hay = `${row.name} ${row.type} ${row.source}`.toLowerCase();
    return hay.includes(q);
};

const emojiMap = {
    user: "👤",
    role: "🔐",
    app: "📦",
    group: "👥"
};

const getTypeStyle = (theme, type) => {
    const t = (type || "").toLowerCase();
    const colorMap = {
        user: { bg: theme.palette.info.light, text: theme.palette.info.dark },
        role: { bg: theme.palette.secondary.light, text: theme.palette.secondary.dark },
        app: { bg: theme.palette.success.light, text: theme.palette.success.dark },
        group: { bg: theme.palette.warning.light, text: theme.palette.warning.dark }
    };
    return colorMap[t] ?? {
        bg: theme.palette.grey[200],
        text: theme.palette.grey[800]
    };
};

function resolveRowUserCount(row, userTokenLists) {
    const clientCount =
        !Array.isArray(userTokenLists) || userTokenLists.length === 0
            ? 0
            : countUsersMatchingEntitlementTokenLists(userTokenLists, row);

    const hasServerCount =
        row?.userCount !== undefined &&
        row?.userCount !== null &&
        Number.isFinite(Number(row.userCount));

    if (!hasServerCount) return clientCount;

    // Prefer the higher signal so correlation/server counts and client token
    // matching (GitHub structured arrays, etc.) both contribute.
    return Math.max(Number(row.userCount) || 0, clientCount);
}

/* ============================================================
   Main Component
   ============================================================ */
export default function AccessItemSelectionTable({
    selectedIds,
    selectedObjects = [],
    onChangeSelectedIds,
    onChangeSelectedObjects,
    pageSize = 10,
    maxBodyHeight = 380,
    applicationId,
    filterPrivilegedOnly = false,
    filterRolesOnly = false,
}) {
    const theme = useTheme();
    const [realData, setRealData] = useState([]);
    const [userPool, setUserPool] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [scopeTab, setScopeTab] = useState('assigned'); // assigned | unassigned

    useEffect(() => {
        const loadAccessItems = async () => {
            if (!applicationId) return;

            setLoading(true);
            try {
                await accessCertificationService.controller.initializeCertification(
                    (data) => {
                        setRealData(data.accessItems || []);
                        setUserPool(Array.isArray(data.identities) ? data.identities : []);
                    },
                    setError,
                    applicationId,
                    true, // force refresh so server userCount is not stale from cache
                );
            } catch (err) {
                console.error('Failed to load access items:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        loadAccessItems();
    }, [applicationId]);

    useEffect(() => {
        setScopeTab('assigned');
    }, [applicationId, filterPrivilegedOnly, filterRolesOnly]);

    const baseRows = useMemo(() => {
        if (filterPrivilegedOnly) {
            return realData.filter((r) => r.privileged);
        }
        if (filterRolesOnly) {
            return realData.filter((r) => String(r.type || "").toLowerCase() === "role");
        }
        return realData;
    }, [realData, filterPrivilegedOnly, filterRolesOnly]);

    const userTokenLists = useMemo(
        () => (Array.isArray(userPool) ? userPool.map(collectPrivilegeMatchMemberTokens) : []),
        [userPool]
    );

    const rowsWithUserCounts = useMemo(() => {
        if (!Array.isArray(baseRows) || baseRows.length === 0) return [];
        return baseRows.map((row) => ({
            ...row,
            userCount: resolveRowUserCount(row, userTokenLists),
        }));
    }, [baseRows, userTokenLists]);

    const assignedRows = useMemo(
        () => rowsWithUserCounts.filter((row) => row.userCount > 0),
        [rowsWithUserCounts]
    );

    const unassignedRows = useMemo(
        () => rowsWithUserCounts.filter((row) => row.userCount === 0),
        [rowsWithUserCounts]
    );

    const isAssignedTab = scopeTab === 'assigned';
    const displayRows = isAssignedTab ? assignedRows : unassignedRows;
    const totalCount = rowsWithUserCounts.length;
    const assignedCount = assignedRows.length;
    const unassignedCount = unassignedRows.length;
    const colSpan = isAssignedTab ? 5 : 4;

    const toggleRow = useCallback((row) => {
        if (!isAssignedTab || (row.userCount || 0) <= 0) return;
        const id = row.id;
        const found = rowsWithUserCounts.find((r) => r.id === id) || realData.find((r) => r.id === id);

        if (selectedIds.includes(id)) {
            onChangeSelectedIds(selectedIds.filter((x) => x !== id));
            if (onChangeSelectedObjects) {
                onChangeSelectedObjects(selectedObjects.filter((o) => o.id !== id));
            }
        } else {
            onChangeSelectedIds([...selectedIds, id]);
            if (found && onChangeSelectedObjects) {
                onChangeSelectedObjects([...selectedObjects, found]);
            }
        }
    }, [
        isAssignedTab,
        selectedIds,
        selectedObjects,
        onChangeSelectedIds,
        onChangeSelectedObjects,
        realData,
        rowsWithUserCounts,
    ]);

    const renderToolbarActions = (filtered) => {
        if (!isAssignedTab) return null;

        const numSelected = selectedIds.length;

        const clearSelection = () => {
            onChangeSelectedIds([]);
            if (onChangeSelectedObjects) onChangeSelectedObjects([]);
        };

        const selectAllFiltered = () => {
            const ids = filtered.map((r) => r.id);
            const newIds = Array.from(new Set([...selectedIds, ...ids]));
            onChangeSelectedIds(newIds);

            if (onChangeSelectedObjects) {
                const newObjs = [
                    ...selectedObjects,
                    ...filtered.filter((r) => !selectedObjects.some((o) => o.id === r.id)),
                ];
                onChangeSelectedObjects(newObjs);
            }
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
                        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                    </>
                )}
                <Button size="small" onClick={selectAllFiltered} disabled={filtered.length === 0}>
                    Select All ({filtered.length})
                </Button>
            </>
        );
    };

    const emptyState = (() => {
        if (error) {
            return { title: "Couldn't load access items", detail: error };
        }
        if (totalCount === 0) {
            if (filterPrivilegedOnly) {
                return {
                    title: "No privileged entitlements yet",
                    detail: "Discover and mark privileged entitlements for this application in Discovery, then return here to select them for certification.",
                };
            }
            return {
                title: "No access items found",
                detail: "This application has no access items available to select for certification.",
            };
        }
        if (isAssignedTab) {
            return {
                title: "No assigned access items",
                detail: filterPrivilegedOnly
                    ? "None of the marked privileged entitlements currently have assigned users. Check the Unassigned tab to review them."
                    : "None of these access items currently have assigned users. Check the Unassigned tab to review them.",
            };
        }
        return {
            title: "No unassigned access items",
            detail: "Every access item for this application currently has at least one assigned user.",
        };
    })();

    return (
        <Box>
            <Tabs
                value={scopeTab}
                onChange={(_e, next) => setScopeTab(next)}
                sx={{
                    mb: 1.5,
                    minHeight: 36,
                    '& .MuiTab-root': { minHeight: 36, textTransform: 'none', fontWeight: 600 },
                }}
            >
                <Tab value="assigned" label={`Assigned (${assignedCount})`} disableRipple />
                <Tab value="unassigned" label={`Unassigned (${unassignedCount})`} disableRipple />
            </Tabs>

            {!loading && totalCount > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {isAssignedTab
                        ? 'Select items with assigned users to include in this campaign.'
                        : 'These items have no assigned users and cannot be included in this campaign.'}
                </Typography>
            )}

            <SearchableTableLayout
                key={scopeTab}
                data={displayRows || []}
                filterFn={itemFilterFn}
                searchPlaceholder="Search access items (name, type, source)..."
                renderToolbarActions={renderToolbarActions}
                pageSize={pageSize}
            >
                {(pagedData) => {
                    const allVisibleSelected =
                        isAssignedTab &&
                        pagedData.length > 0 &&
                        pagedData.every((r) => selectedIds.includes(r.id));
                    const someVisibleSelected =
                        isAssignedTab && pagedData.some((r) => selectedIds.includes(r.id));

                    const toggleSelectAllVisible = () => {
                        if (!isAssignedTab) return;
                        const visibleIds = new Set(pagedData.map((r) => r.id));

                        if (allVisibleSelected) {
                            onChangeSelectedIds(selectedIds.filter((id) => !visibleIds.has(id)));
                            if (onChangeSelectedObjects) {
                                onChangeSelectedObjects(
                                    selectedObjects.filter((o) => !visibleIds.has(o.id))
                                );
                            }
                        } else {
                            const newIds = [...selectedIds];
                            const newObjs = [...selectedObjects];

                            pagedData.forEach((row) => {
                                if (!selectedIds.includes(row.id)) {
                                    newIds.push(row.id);
                                    newObjs.push(row);
                                }
                            });

                            onChangeSelectedIds(newIds);
                            if (onChangeSelectedObjects) onChangeSelectedObjects(newObjs);
                        }
                    };

                    return (
                        <TableContainer sx={{ maxHeight: maxBodyHeight, overflowY: "auto" }}>
                            <Table stickyHeader size="small">
                                <TableHead>
                                    <TableRow>
                                        {isAssignedTab && (
                                            <TableCell padding="checkbox">
                                                <Checkbox
                                                    indeterminate={someVisibleSelected && !allVisibleSelected}
                                                    checked={allVisibleSelected}
                                                    disabled={pagedData.length === 0}
                                                    onChange={toggleSelectAllVisible}
                                                />
                                            </TableCell>
                                        )}
                                        <TableCell sx={{ fontWeight: 700 }}>Access Item</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Source</TableCell>
                                        {isAssignedTab && (
                                            <TableCell sx={{ fontWeight: 700 }} align="right">
                                                Users
                                            </TableCell>
                                        )}
                                    </TableRow>
                                </TableHead>

                                <TableBody>
                                    {loading && (
                                        <TableRow>
                                            <TableCell colSpan={colSpan} align="center" sx={{ py: 3 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                                    <CircularProgress size={18} />
                                                    <Typography variant="body2" color="text.secondary">Loading access items...</Typography>
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                    )}

                                    {!loading && pagedData.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={colSpan} align="center">
                                                <Box sx={{ py: 4, px: 3, maxWidth: 440, mx: 'auto' }}>
                                                    <Typography variant="subtitle2" color="text.primary" sx={{ fontWeight: 600, mb: 0.5 }}>
                                                        {emptyState.title}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {emptyState.detail}
                                                    </Typography>
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                    )}

                                    {!loading && pagedData.map((row) => {
                                        const checked = selectedIds.includes(row.id);
                                        const typeStr = String(row.type ?? "");
                                        const sourceStr = String(row.source ?? "");
                                        const nameStr = String(row.name ?? "");
                                        const emoji = emojiMap[typeStr.toLowerCase()] ?? "🔖";
                                        const { bg, text } = getTypeStyle(theme, typeStr);

                                        return (
                                            <TableRow
                                                key={row.id}
                                                hover={isAssignedTab}
                                                onClick={() => isAssignedTab && toggleRow(row)}
                                                sx={{
                                                    cursor: isAssignedTab ? 'pointer' : 'default',
                                                    backgroundColor: checked ? 'action.selected' : undefined,
                                                }}
                                            >
                                                {isAssignedTab && (
                                                    <TableCell padding="checkbox">
                                                        <Checkbox
                                                            checked={checked}
                                                            onChange={() => toggleRow(row)}
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                    </TableCell>
                                                )}
                                                <TableCell>
                                                    <Typography variant="body2" fontWeight={500}>{nameStr}</Typography>
                                                </TableCell>
                                                <TableCell>
                                                    <Box
                                                        sx={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 0.5,
                                                            backgroundColor: bg,
                                                            color: text,
                                                            px: 1,
                                                            py: 0.2,
                                                            borderRadius: "6px",
                                                            textTransform: "capitalize",
                                                            fontSize: "0.75rem",
                                                            fontWeight: 600
                                                        }}
                                                    >
                                                        {emoji} {typeStr}
                                                    </Box>
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2" color="text.secondary">{sourceStr}</Typography>
                                                </TableCell>
                                                {isAssignedTab && (
                                                    <TableCell align="right">
                                                        <Typography variant="body2" color="text.secondary">
                                                            {row.userCount ?? 0}
                                                        </Typography>
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    );
                }}
            </SearchableTableLayout>
        </Box>
    );
}
