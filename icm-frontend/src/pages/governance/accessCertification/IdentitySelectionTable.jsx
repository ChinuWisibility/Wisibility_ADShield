import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Checkbox, Typography, Button, Divider, Box, CircularProgress, TextField, InputAdornment, Pagination,
    Menu, MenuItem, FormControlLabel
} from '@mui/material';
import { Search as SearchIcon, ViewColumn as ViewColumnIcon } from '@mui/icons-material';
import SearchableTableLayout from './SearchableTableLayout';
import accessCertificationService from '../../../services/accessCertificationService';

/* ============================================================
   🎨 Helpers & Status Component
   ============================================================ */
const INACTIVE_TERMS = [
    "inactive",
    "disabled",
    "suspended",
    "terminated",
    "lock",
    "leaver",
    "offboard",
    "unlicensed",
    "false",
    "no",
    "0",
];
const ACTIVE_TERMS = [
    "active",
    "enabled",
    "enable",
    "true",
    "ok",
    "valid",
    "live",
    "yes",
    "1",
    "current",
];

/* Simple neumorphic-like status switch used in the table */
const NeumorphicStatusSwitchInside = ({ active }) => (
    <Box
        sx={{
            width: 92,
            height: 30,
            borderRadius: "50px",
            display: "flex",
            alignItems: "center",
            px: "6px",
            background: active
                ? "linear-gradient(145deg, #b9f3c7, #8dde9e)"
                : "linear-gradient(145deg, #f5f7fa, #dfe3e8)",
            justifyContent: active ? "space-between" : "flex-start",
            fontSize: "11px",
            fontWeight: 600,
        }}
    >
        {active && <span style={{ color: "#fff", paddingLeft: 4 }}>ACTIVE</span>}
        <Box
            sx={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: active ? "#35c45b" : "#c9cdd3",
            }}
        />
        {!active && <span style={{ color: "#666", paddingRight: 2 }}>INACTIVE</span>}
    </Box>
);

/* ============================================================
   🧠 AST Logic & Filter Function (Moved outside component)
   - This version includes STATUS_SYNONYMS so status:active
     will match many backend variants like 'enabled', 'true', etc.
   ============================================================ */

/**
 * Map of canonical query token -> array of equivalent backend values
 * Extend this map when you find more variants from backend responses.
 */
const STATUS_SYNONYMS = {
    // positive / active equivalents
    active: ["active", "enabled", "true", "ok", "valid", "live", "on", "1", "yes", "account_enabled", "is_active", "user_active"],
    enabled: ["active", "enabled", "true", "ok", "valid", "live", "on", "1", "yes", "account_enabled", "is_active", "user_active"],
    on: ["active", "enabled", "true", "ok", "valid", "live", "on", "1", "yes", "account_enabled", "is_active", "user_active"],

    // negative / inactive equivalents
    inactive: ["inactive", "disabled", "false", "off", "0", "no", "suspended", "locked", "terminated", "leaver", "unlicensed"],
    disabled: ["inactive", "disabled", "false", "off", "0", "no", "suspended", "locked", "terminated", "leaver", "unlicensed"],
    off: ["inactive", "disabled", "false", "off", "0", "no", "suspended", "locked", "terminated", "leaver", "unlicensed"],

    // other potential semantic groups (extend as needed)
    pending: ["pending", "in-progress", "in_progress", "queued"],
    completed: ["completed", "done", "closed", "finished"],
};

/* Normalize a key used in clause (aliases) */
const canonicalKey = (k) => {
    const key = String(k || '').toLowerCase();
    if (['name', 'n'].includes(key)) return 'name';
    if (['title', 'role'].includes(key)) return 'title';
    if (['manager', 'mgr'].includes(key)) return 'manager';
    if (['department', 'dept'].includes(key)) return 'department';
    if (['status', 'stat', 's'].includes(key)) return 'status';
    if (['id'].includes(key)) return 'id';
    return key;
};

const statusCandidates = (row) => {
    const raw = row?.rawData || row?._originalData || {};
    return [
        ["status", row?.status ?? raw.status ?? raw.Status ?? raw.STATUS],
        ["account_status", row?.accountStatus ?? row?.account_status ?? raw.accountStatus ?? raw.account_status],
        ["user_status", row?.user_status ?? raw.user_status ?? raw.userStatus],
        ["employment_status", row?.employment_status ?? raw.employment_status],
        ["user_active", row?.user_active ?? raw.user_active],
        ["active", row?.active ?? raw.active],
        ["is_active", row?.is_active ?? raw.is_active],
        ["account_enabled", row?.account_enabled ?? raw.account_enabled],
        ["enabled", row?.enabled ?? raw.enabled],
        ["accountDisabled", row?.accountDisabled ?? raw.accountDisabled],
        ["locked", row?.locked ?? raw.locked],
        ["suspended", row?.suspended ?? raw.suspended],
        ["userAccountControl", row?.userAccountControl ?? row?.useraccountcontrol ?? row?.user_account_control ?? raw.userAccountControl ?? raw.useraccountcontrol ?? raw.user_account_control],
        ["site_role", row?.site_role ?? raw.site_role],
        ["profile_status", row?.profile_status ?? raw.profile_status],
    ];
};

const normalizeIdentityStatus = (row) => {
    const candidates = statusCandidates(row);
    for (const [key, value] of candidates) {
        if (value == null || String(value).trim() === "") continue;

        if (key === "userAccountControl") {
            const num = Number(String(value).trim());
            if (!Number.isNaN(num)) {
                return (num & 2) === 2 ? "inactive" : "active";
            }
        }

        if (typeof value === "boolean") {
            const negKey = ["suspended", "accountdisabled", "disabled", "locked", "lockout", "terminated", "isinactive"]
                .includes(String(key).toLowerCase().replace(/[^a-z0-9]/g, ""));
            if (negKey) return value ? "inactive" : "active";
            const posKey = ["active", "is_active", "user_active", "account_enabled", "enabled"]
                .includes(String(key).toLowerCase());
            if (posKey) return value ? "active" : "inactive";
            return value ? "active" : "inactive";
        }

        const s = String(value).trim().toLowerCase();
        if (key === "site_role") {
            if (/unlicensed|suspend|disabled|inactive|deactiv/.test(s)) return "inactive";
            return "active";
        }
        if (INACTIVE_TERMS.some((t) => s.includes(t))) return "inactive";
        if (ACTIVE_TERMS.some((t) => s.includes(t))) return "active";
    }
    return "unknown";
};

const identityStatusSearchText = (row) => {
    const parts = [];
    for (const [, value] of statusCandidates(row)) {
        if (value == null) continue;
        const s = String(value).trim();
        if (s) parts.push(s);
    }
    parts.push(normalizeIdentityStatus(row));
    return parts.join(" ").toLowerCase();
};

/**
 * Evaluate an AST (or clause nodes) against a single row.
 * - For status clauses (status:...), performs semantic matching using STATUS_SYNONYMS.
 * - For other keys, uses substring matching on normalized fields.
 */
const evaluateASTAgainstRow = (node, row) => {
    if (!node) return true;

    const norm = {
        name: String(row.name || '').toLowerCase(),
        title: String(row.title || '').toLowerCase(),
        manager: String(row.manager || '').toLowerCase(),
        department: String(row.department || '').toLowerCase(),
        status: normalizeIdentityStatus(row),
        id: String(row.id || '').toLowerCase()
    };

    // Helper: matches a clause node { key, value, negate? }
    const matchClause = (c) => {
        const key = canonicalKey(c.key);
        const rawVal = String(c.value || '').toLowerCase().trim();
        if (!rawVal) return false;

        // Special handling for status: use semantic synonyms if possible
        if (key === 'status') {
            const rowVal = String(norm.status || '').toLowerCase().trim();

            // Support comma-separated tokens in the clause e.g. status:active,enabled
            const tokens = rawVal.split(',').map(t => t.trim()).filter(Boolean);

            // If any token maps to synonyms, check membership
            const tokenMatches = tokens.some(tok => {
                if (STATUS_SYNONYMS[tok]) {
                    return STATUS_SYNONYMS[tok].includes(rowVal);
                }
                // If token isn't in synonyms, fallback to substring match against rowVal
                return rowVal.includes(tok);
            });

            return tokenMatches;
        }

        // Default: if key present in normalized fields, do substring match
        if (key in norm) return norm[key].includes(rawVal);

        // If key isn't recognized, search across all fields
        return Object.values(norm).some(v => v.includes(rawVal));
    };

    // Evaluate AST nodes recursively
    const evalNode = (n) => {
        if (!n) return true;
        switch (n.type) {
            case 'EMPTY': return true;
            case 'CLAUSE': {
                const matched = matchClause(n);
                return n.negate ? !matched : matched;
            }
            case 'TERM': {
                const t = String(n.value || '').toLowerCase();
                if (!t) return true;
                return Object.values(norm).some(v => v.includes(t));
            }
            case 'NOT': return !evalNode(n.expr);
            case 'AND': return evalNode(n.left) && evalNode(n.right);
            case 'OR': return evalNode(n.left) || evalNode(n.right);
            default: return true;
        }
    };

    try {
        return !!evalNode(node);
    } catch (e) {
        // In case of unexpected AST shapes, fall back to permissive behavior
        return true;
    }
};

/**
 * Filter function used by SearchableTableLayout.
 * Supports both simple string queries and AST-based parsed queries.
 */
const identityFilterFn = (row, parsed) => {
    // Legacy string support (simple substring search across fields)
    if (typeof parsed === 'string') {
        const raw = parsed.trim().toLowerCase();
        if (!raw) return true;
        const statusText = identityStatusSearchText(row);
        return [row.name, row.title, row.manager, row.department, statusText]
            .join(" ").toLowerCase().includes(raw);
    }

    // AST support
    if (!parsed || !parsed.raw) return true;
    try {
        return evaluateASTAgainstRow(parsed.ast, row);
    } catch (e) {
        // if evaluation fails for any reason, don't filter out the row
        return true;
    }
};

/* ============================================================
   📋 Dynamic Column Engine — reads raw application fields
   Columns come from _originalData (the unmodified backend payload).
   No hardcoded field names, labels, or renderers. Whatever the
   application connector returns is what appears in the Columns picker.
   ============================================================ */

/** Convert camelCase / snake_case / "Spaced Title" key to a readable label */
function autoLabel(key) {
    return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Build columns from the raw application data (_originalData on each row).
 *
 * - Application-scope rows (normalizeUser) always have _originalData.
 * - Profile-scope rows (getProfileIdentities) are flat — fall back to scanning
 *   the row itself, skipping internal system fields.
 *
 * Only columns that have at least one non-empty value across the dataset are included.
 */
const INTERNAL_KEYS = new Set([
    'id', '_id', '_originalData', 'rawData',
    'isNHI', 'isContractor', 'managerRaw', 'managerEmail', 'memberOf',
]);

function buildColumnsFromRaw(rows) {
    if (!rows || rows.length === 0) return [];

    // Prefer _originalData (real app schema); fall back to the normalized row
    const hasRaw = rows.some(r => r._originalData && Object.keys(r._originalData).length > 0);

    // Collect all field keys across every row
    const keySet = new Set();
    rows.forEach(row => {
        const src = hasRaw ? (row._originalData || {}) : row;
        Object.keys(src)
            .filter(k => !INTERNAL_KEYS.has(k))
            .forEach(k => keySet.add(k));
    });

    // Only keep fields that have at least one real value somewhere in the dataset
    const populated = [...keySet].filter(key =>
        rows.some(row => {
            const src = hasRaw ? (row._originalData || {}) : row;
            const v = src[key];
            return v != null && String(v).trim() !== '' && String(v).trim() !== '—';
        })
    );

    // Display-name fields always come first, then everything else alphabetically
    const isIdentityNameField = (key) => {
        const lk = key.toLowerCase().replace(/[\s_-]/g, '');
        return lk.startsWith('display') || lk === 'name' || lk === 'fullname';
    };
    populated.sort((a, b) => {
        const an = isIdentityNameField(a);
        const bn = isIdentityNameField(b);
        if (an && !bn) return -1;
        if (!an && bn) return 1;
        return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });

    return populated.map(key => ({
        key,
        label: autoLabel(key),
        render: (row) => {
            const src = hasRaw ? (row._originalData || {}) : row;
            const v = src[key];
            if (v == null || String(v).trim() === '') {
                return <span style={{ color: '#cbd5e1' }}>—</span>;
            }
            return String(v);
        },
    }));
}

/* ============================================================
   🧩 Main Component
   ============================================================ */
export default function IdentitySelectionTable({
    selectedIds,
    onChangeSelectedIds,
    selectedObjects = [],
    onChangeSelectedObjects,
    applicationId,
    identityProfileId,
    identityFilter = 'ALL',
    pageSize = 10,
    maxBodyHeight = 380
}) {
    const [realData, setRealData] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [serverTotal, setServerTotal] = useState(0);
    const [serverPage, setServerPage] = useState(1);
    const [serverQuery, setServerQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const debounceRef = useRef(null);

    // Apply identity-type filter locally so the table only shows matching rows
    const identityFilteredData = useMemo(() => {
        if (identityFilter === 'NHI') return realData.filter(r => r.isNHI === true);
        if (identityFilter === 'CONTRACTOR') return realData.filter(r => r.isContractor === true);
        return realData;
    }, [realData, identityFilter]);

    // Columns are derived from _originalData of the full dataset so they reflect
    // whatever fields the application connector actually returns — no hardcoding.
    const columns = useMemo(() => buildColumnsFromRaw(realData), [realData]);

    // Column visibility — all columns shown by default; resets when application data changes
    const [visibleColumnKeys, setVisibleColumnKeys] = useState([]);
    const [columnPickerAnchor, setColumnPickerAnchor] = useState(null);

    useEffect(() => {
        if (columns.length > 0) {
            setVisibleColumnKeys(columns.map(c => c.key));
        }
    }, [columns]);

    const visibleColumns = useMemo(
        () => columns.filter(c => visibleColumnKeys.includes(c.key)),
        [columns, visibleColumnKeys]
    );

    const toggleColumn = (key) => {
        setVisibleColumnKeys(prev =>
            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
        );
    };

    // Server-mode debounce for profile identity search
    useEffect(() => {
        if (!identityProfileId) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setDebouncedQuery(serverQuery);
            setServerPage(1);
        }, 300);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [serverQuery, identityProfileId]);

    /* -----------------------------
       Fetch backend identities
     ------------------------------ */
    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            // PROFILE scope: load identities from identity-profile population
            if (identityProfileId) {
                setLoading(true);
                try {
                    const res = await accessCertificationService.api.getProfileIdentities(
                        identityProfileId,
                        {
                            page: serverPage,
                            limit: Math.min(100, Math.max(10, Number(pageSize) || 10)),
                            q: debouncedQuery || undefined,
                            identityFilter,
                        },
                    );
                    if (cancelled) return;
                    if (!res.success) throw new Error(res.error || 'Failed to load identities');

                    setRealData(Array.isArray(res.data) ? res.data : []);
                    setServerTotal(Number(res?.meta?.total || 0));
                    setError(null);
                } catch (e) {
                    if (cancelled) return;
                    setError(e?.message || String(e));
                    setRealData([]);
                    setServerTotal(0);
                } finally {
                    if (!cancelled) setLoading(false);
                }
                return;
            }

            // APPLICATION scope: load identities from application certification data
            if (!applicationId) return;
            setLoading(true);
            accessCertificationService.controller.initializeCertification(
                (data) => {
                    if (cancelled) return;
                    setRealData(data.identities || []);
                    setError(null);
                    setLoading(false);
                },
                (err) => {
                    if (cancelled) return;
                    setError(err);
                    setLoading(false);
                },
                applicationId
            );
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [applicationId, identityProfileId, serverPage, debouncedQuery, identityFilter, pageSize]);

    /* -----------------------------
       Select / Unselect
     ------------------------------ */
    const toggleRow = useCallback((id) => {
        const found = identityFilteredData.find((r) => r.id === id);
        if (selectedIds.includes(id)) {
            onChangeSelectedIds(selectedIds.filter(x => x !== id));
            if (onChangeSelectedObjects) {
                onChangeSelectedObjects(selectedObjects.filter((o) => o.id !== id));
            }
        } else {
            onChangeSelectedIds([...selectedIds, id]);
            if (onChangeSelectedObjects && found) {
                onChangeSelectedObjects([...selectedObjects, found]);
            }
        }
    }, [selectedIds, selectedObjects, onChangeSelectedIds, onChangeSelectedObjects, identityFilteredData]);

    /* -----------------------------
       Column Picker  (matches UsersTable pattern)
     ------------------------------ */
    const columnPickerMenu = (
        <>
            <Button
                variant="outlined"
                startIcon={<ViewColumnIcon sx={{ fontSize: 18 }} />}
                onClick={(e) => setColumnPickerAnchor(e.currentTarget)}
                size="small"
                sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    borderRadius: '10px',
                    borderColor: 'rgba(15,23,42,0.12)',
                    color: '#334155',
                    px: 1.5,
                    '&:hover': { borderColor: 'rgba(37,99,235,0.45)', bgcolor: 'rgba(37,99,235,0.04)' },
                }}
            >
                Columns
            </Button>
            <Menu
                anchorEl={columnPickerAnchor}
                open={Boolean(columnPickerAnchor)}
                onClose={() => setColumnPickerAnchor(null)}
                PaperProps={{ style: { maxHeight: 400, width: 240 } }}
            >
                <Box sx={{ px: 2, py: 1, borderBottom: '1px solid #e2e8f0' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, letterSpacing: '0.05em', fontSize: '0.72rem', textTransform: 'uppercase', color: '#64748b' }}>
                        Show / Hide Columns
                    </Typography>
                </Box>
                {columns.map(col => (
                    <MenuItem key={col.key} onClick={() => toggleColumn(col.key)} sx={{ py: 0 }}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={visibleColumnKeys.includes(col.key)}
                                    size="small"
                                />
                            }
                            label={<Typography variant="body2">{col.label}</Typography>}
                            sx={{ width: '100%', m: 0 }}
                        />
                    </MenuItem>
                ))}
            </Menu>
        </>
    );

    /* -----------------------------
       Table Toolbar
     ------------------------------ */
    const renderToolbarActions = (filteredData) => {
        const numSelected = selectedIds.length;

        const selectAllFiltered = () => {
            const ids = filteredData.map(r => r.id);
            const newUnique = Array.from(new Set([...selectedIds, ...ids]));
            onChangeSelectedIds(newUnique);
            if (onChangeSelectedObjects) {
                const newObjs = [
                    ...selectedObjects,
                    ...filteredData.filter((r) => !selectedObjects.some((o) => o.id === r.id)),
                ];
                onChangeSelectedObjects(newObjs);
            }
        };

        const clearSelection = () => {
            onChangeSelectedIds([]);
            if (onChangeSelectedObjects) {
                onChangeSelectedObjects([]);
            }
        };

        return (
            <>
                {numSelected > 0 && (
                    <>
                        <Typography variant="subtitle2" color="primary.main" sx={{ fontWeight: 600 }}>
                            {numSelected} Selected
                        </Typography>
                        <Button size="small" onClick={clearSelection} sx={{ color: "text.secondary" }}>
                            Clear
                        </Button>
                        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                    </>
                )}
                <Button size="small" onClick={selectAllFiltered}>
                    Select Page ({filteredData.length})
                </Button>
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                {columnPickerMenu}
            </>
        );
    };

    /* -----------------------------
       RENDER
     ------------------------------ */
    // Profile scope: server-side paging/search (industry-grade)
    if (identityProfileId) {
        const totalPages = Math.max(
            1,
            Math.ceil((Number(serverTotal) || 0) / Math.min(100, Math.max(10, Number(pageSize) || 10))),
        );
        const pagedData = identityFilteredData;

        return (
            <Box>
                <Box sx={{ mb: 1, display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <TextField
                        placeholder="Search: name, email, employeeId, title, dept"
                        size="small"
                        value={serverQuery}
                        onChange={(e) => setServerQuery(e.target.value)}
                        sx={{ width: 360, minWidth: 160 }}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon fontSize="small" />
                                </InputAdornment>
                            )
                        }}
                    />
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                        {renderToolbarActions(pagedData)}
                    </Box>
                </Box>

                <TableContainer sx={{ maxHeight: maxBodyHeight, overflowY: "auto" }}>
                    <Table stickyHeader size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell padding="checkbox">
                                    <Checkbox
                                        checked={pagedData.length > 0 && pagedData.every(r => selectedIds.includes(r.id))}
                                        indeterminate={pagedData.some(r => selectedIds.includes(r.id)) && !(pagedData.length > 0 && pagedData.every(r => selectedIds.includes(r.id)))}
                                        onChange={() => {
                                            const visibleIds = new Set(pagedData.map((r) => r.id));
                                            const allVisibleSelected = pagedData.length > 0 && pagedData.every(r => selectedIds.includes(r.id));
                                            if (allVisibleSelected) {
                                                onChangeSelectedIds(selectedIds.filter((id) => !visibleIds.has(id)));
                                                if (onChangeSelectedObjects) {
                                                    onChangeSelectedObjects(selectedObjects.filter((o) => !visibleIds.has(o.id)));
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
                                                if (onChangeSelectedObjects) {
                                                    onChangeSelectedObjects(newObjs);
                                                }
                                            }
                                        }}
                                    />
                                </TableCell>
                                {visibleColumns.map(col => (
                                    <TableCell key={col.key}>{col.label}</TableCell>
                                ))}
                            </TableRow>
                        </TableHead>

                        <TableBody>
                            {loading && (
                                <TableRow>
                                    <TableCell colSpan={visibleColumns.length + 1} align="center" sx={{ py: 3 }}>
                                        <CircularProgress size={20} sx={{ mr: 1, verticalAlign: 'middle' }} />
                                        Loading identities...
                                    </TableCell>
                                </TableRow>
                            )}

                            {!loading && pagedData.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={visibleColumns.length + 1} align="center">
                                        <Typography color="text.secondary" sx={{ py: 3 }}>
                                            {error || "No identities match your search."}
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}

                            {!loading && pagedData.map((row) => {
                                const checked = selectedIds.includes(row.id);
                                return (
                                    <TableRow
                                        key={row.id}
                                        hover
                                        onClick={() => toggleRow(row.id)}
                                        sx={{ cursor: "pointer", backgroundColor: checked ? "action.selected" : undefined }}
                                    >
                                        <TableCell padding="checkbox">
                                            <Checkbox
                                                checked={checked}
                                                onClick={e => e.stopPropagation()}
                                                onChange={() => toggleRow(row.id)}
                                            />
                                        </TableCell>
                                        {visibleColumns.map(col => (
                                            <TableCell key={col.key}>{col.render(row)}</TableCell>
                                        ))}
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, borderTop: (theme) => `1px solid ${theme.palette.divider}` }}>
                    <Typography variant="caption">{serverTotal} total results</Typography>
                    <Pagination
                        size="small"
                        count={totalPages}
                        page={serverPage}
                        onChange={(_, p) => setServerPage(p)}
                        color="primary"
                    />
                </Box>
            </Box>
        );
    }

    // Application scope: keep client-side advanced search + paging
    return (
        <SearchableTableLayout
            data={identityFilteredData}
            filterFn={identityFilterFn}
            searchPlaceholder="Search: status:active dept:hr title:engineer"
            pageSize={pageSize}
            debounceMs={300}
            renderToolbarActions={renderToolbarActions}
        >
            {(pagedData) => {
                const allVisibleSelected =
                    pagedData.length > 0 &&
                    pagedData.every(r => selectedIds.includes(r.id));

                const someVisibleSelected =
                    pagedData.some(r => selectedIds.includes(r.id));

                const toggleSelectAllVisible = () => {
                    const visibleIds = new Set(pagedData.map((r) => r.id));
                    if (allVisibleSelected) {
                        onChangeSelectedIds(selectedIds.filter((id) => !visibleIds.has(id)));
                        if (onChangeSelectedObjects) {
                            onChangeSelectedObjects(selectedObjects.filter((o) => !visibleIds.has(o.id)));
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
                        if (onChangeSelectedObjects) {
                            onChangeSelectedObjects(newObjs);
                        }
                    }
                };

                return (
                    <TableContainer sx={{ maxHeight: maxBodyHeight, overflowY: "auto" }}>
                        <Table stickyHeader size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell padding="checkbox">
                                        <Checkbox
                                            checked={allVisibleSelected}
                                            indeterminate={someVisibleSelected && !allVisibleSelected}
                                            onChange={toggleSelectAllVisible}
                                        />
                                    </TableCell>
                                    {visibleColumns.map(col => (
                                        <TableCell key={col.key}>{col.label}</TableCell>
                                    ))}
                                </TableRow>
                            </TableHead>

                            <TableBody>
                                {loading && (
                                    <TableRow>
                                        <TableCell colSpan={visibleColumns.length + 1} align="center" sx={{ py: 3 }}>
                                            <CircularProgress size={20} sx={{ mr: 1, verticalAlign: 'middle' }} />
                                            Loading identities...
                                        </TableCell>
                                    </TableRow>
                                )}

                                {!loading && pagedData.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={visibleColumns.length + 1} align="center">
                                            <Typography color="text.secondary" sx={{ py: 3 }}>
                                                {error || "No identities match your search."}
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                )}

                                {!loading && pagedData.map((row) => {
                                    const checked = selectedIds.includes(row.id);
                                    return (
                                        <TableRow
                                            key={row.id}
                                            hover
                                            onClick={() => toggleRow(row.id)}
                                            sx={{ cursor: "pointer", backgroundColor: checked ? "action.selected" : undefined }}
                                        >
                                            <TableCell padding="checkbox">
                                                <Checkbox
                                                    checked={checked}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={() => toggleRow(row.id)}
                                                />
                                            </TableCell>
                                            {visibleColumns.map(col => (
                                                <TableCell key={col.key}>{col.render(row)}</TableCell>
                                            ))}
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                );
            }}
        </SearchableTableLayout>
    );
}
