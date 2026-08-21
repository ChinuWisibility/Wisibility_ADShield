import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, CircularProgress, Box, Typography, Chip, Button,
  Toolbar,
  TableSortLabel, TablePagination, TextField, InputAdornment,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider, Grid, IconButton,
  Stack,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Search, Close, Clear } from '@mui/icons-material';
import { applicationAPI } from '../../services/api';
import AccountStatusCell from '../../components/accounts/AccountStatusCell';
import MemberOfEntitlementsCell from '../../components/accounts/MemberOfEntitlementsCell';
import AccountTableColumnPicker from '../../components/accounts/AccountTableColumnPicker';
import { getStickyTableContainerSx } from '../../components/DataTable';
import { palette } from '../../theme/palette';
import {
  applyColumnOrder,
  buildAccountTableColumnDefs,
  CANONICAL_IGA_ACCOUNT_FIELDS,
  formatAccountCellValue,
  formatAccountStatusDisplay,
  formatHeaderName,
  getValueFromUserRow,
  mergeColumnOrderKeys,
  mergeVisibleColumnKeys,
  isAccountStatusColumnKey,
  isMemberOfEntitlementsColumnKey,
  parseMemberOfEntitlements,
} from '../../utils/accountTableColumns';

/** ISO 2007 appendix: sortable / filterable columns (subset of user row fields). */
/** Keys that support server-side sort/filter in report mode. Derived dynamically from schema when available. */
const STATIC_SORT_FILTER_KEYS = ['user_id', 'employee_id', 'username', 'status', 'department'];

/** Max users loaded when report mode needs client-side filter/sort (ISO appendix). */
const REPORT_FETCH_LIMIT = 10000;

/** Stable title for account detail dialog (best-effort from common field names). */
function accountDialogTitle(row) {
  if (!row || typeof row !== 'object') return 'Account details';
  const dn = row.display_name ?? row.displayName;
  if (dn != null && String(dn).trim()) return String(dn).trim();
  const fn = row.first_name ?? row.firstName;
  const ln = row.last_name ?? row.lastName;
  const parts = [fn, ln].filter((x) => x != null && String(x).trim()).map((x) => String(x).trim());
  if (parts.length) return parts.join(' ');
  const uid = row.user_id ?? row.userid ?? row.username ?? row.employee_id ?? row.employeeId;
  if (uid != null && String(uid).trim()) return String(uid).trim();
  return 'Account details';
}

function isPlainDetailKey(key) {
  if (!key || key === '__v') return false;
  if (key.startsWith('$')) return false;
  return true;
}

/** Internal Mongo / FK fields — not useful in the account detail dialog for business users. */
const ACCOUNT_DETAIL_HIDDEN_KEYS = new Set(['_id', 'applicationId', 'application_id']);

function showFieldInAccountDetail(key) {
  return key && !ACCOUNT_DETAIL_HIDDEN_KEYS.has(key);
}

function memberOfDetailLines(value) {
  const parsed = parseMemberOfEntitlements(value);
  if (!parsed.displayItems.length) return null;
  return parsed.displayItems.map((name) => `${name};`);
}

function formatDetailFieldValue(key, value) {
  if (isAccountStatusColumnKey(key)) {
    return formatAccountStatusDisplay(value).label;
  }
  if (isMemberOfEntitlementsColumnKey(key)) {
    const lines = memberOfDetailLines(value);
    if (!lines) return '\u2014';
    return lines.join('\n');
  }
  if (value == null || value === '') return '\u2014';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export default function UsersTable({
  applicationId,
  /** Saved Application user schema — drives column list, order, and header labels when present. */
  userMappings = null,
  /** Map AD / csv import mappings (used when userMappings empty or for source column labels). */
  csvImportMapping = null,
  /** When set, show “Application Accounts” banner with actions on the right (same row as Sync). */
  showAccountsBanner = false,
  accountsBannerSubtitle = '',
  syncAction = null,
  /** Rendered after the banner (e.g. sync result Alert). */
  bannerFooter = null,
  /** Pagination, sort (5 columns), and text filter — e.g. ISO 2007 report appendix. */
  enableReportFeatures = false,
  /** Active Directory: table columns = LDAP attribute names from sync, not Wisibility standard fields. */
  isAdConnector = false,
  /** Persisted column order / visibility from Application.accountsTablePreferences */
  accountsTablePreferences = null,
  /** When set (derived AD app), layout saves on the source AD application id */
  preferencesApplicationId = null,
  /** 'active' | 'inactive' — server-side filter from stat cards */
  accountStatusFilter = null,
  onClearAccountStatusFilter,
  /** Increment to refetch users after connector sync without remounting the table. */
  refreshKey = 0,
}) {
  const [users, setUsers] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [page, setPage] = useState(0);
  const [columnDefs, setColumnDefs] = useState([]);
  const [columnOrderKeys, setColumnOrderKeys] = useState([]);
  const [visibleColumns, setVisibleColumns] = useState([]);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const accountsPrefsRef = useRef(accountsTablePreferences);
  const layoutHydratedRef = useRef('');
  const visibleColumnsTouchedRef = useRef(false);
  const columnOrderKeysRef = useRef([]);
  const visibleColumnsRef = useRef([]);

  const [reportFilter, setReportFilter] = useState('');
  const [orderBy, setOrderBy] = useState('user_id');
  const [order, setOrder] = useState('asc');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [printing, setPrinting] = useState(false);

  const [userDetailOpen, setUserDetailOpen] = useState(false);
  const [userDetailRow, setUserDetailRow] = useState(null);

  /** Server-side list search (Application detail Users tab — not ISO report mode). */
  const [listSearchInput, setListSearchInput] = useState('');
  const [listSearchDebounced, setListSearchDebounced] = useState('');

  useEffect(() => {
    if (!enableReportFeatures) return undefined;
    const sync = () => setPrinting(document.body.classList.contains('iso2007-print-mode'));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, [enableReportFeatures]);

  useEffect(() => {
    if (enableReportFeatures) setPage(0);
  }, [enableReportFeatures, reportFilter, orderBy, order]);

  useEffect(() => {
    setListSearchInput('');
    setListSearchDebounced('');
    setPage(0);
  }, [applicationId]);

  useEffect(() => {
    setPage(0);
  }, [accountStatusFilter]);

  useEffect(() => {
    if (enableReportFeatures) return undefined;
    const t = setTimeout(() => {
      setListSearchDebounced(listSearchInput.trim());
    }, 400);
    return () => clearTimeout(t);
  }, [listSearchInput, enableReportFeatures]);

  useEffect(() => {
    if (enableReportFeatures) return;
    setPage(0);
  }, [listSearchDebounced, enableReportFeatures]);

  useEffect(() => {
    accountsPrefsRef.current = accountsTablePreferences;
  }, [applicationId, accountsTablePreferences]);

  const defKeysSignature = useMemo(
    () => columnDefs.map((d) => d.key).join('\u0001'),
    [columnDefs],
  );

  useEffect(() => {
    setPage(0);
  }, [refreshKey]);

  useEffect(() => {
    if (!applicationId) return;
    let cancelled = false;
    setSchemaLoading(true);
    try {
      const defs = buildAccountTableColumnDefs({
        userMappings,
        csvImportMappings: csvImportMapping,
        users,
        isAdConnector,
      });
      if (cancelled) return;
      setColumnDefs(defs);
    } catch (error) {
      console.error('Failed to load user schema columns', error);
    } finally {
      if (!cancelled) setSchemaLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [applicationId, userMappings, csvImportMapping, users, isAdConnector]);

  useEffect(() => {
    if (!applicationId || !columnDefs.length) return;
    const sig = `${applicationId}|${defKeysSignature}`;
    const prefs = accountsPrefsRef.current;
    const defKeys = columnDefs.map((d) => d.key);

    if (layoutHydratedRef.current === sig) {
      setColumnOrderKeys((prev) => mergeColumnOrderKeys(prev, defKeys));
      return;
    }

    const isNewLayout = layoutHydratedRef.current !== sig;
    layoutHydratedRef.current = sig;
    setColumnOrderKeys(mergeColumnOrderKeys(prefs?.columnOrder, defKeys));

    if (!isNewLayout) return;

    setVisibleColumns((prev) => {
      if (visibleColumnsTouchedRef.current && prev.length) {
        const newKeys = defKeys.filter((k) => !prev.includes(k));
        return newKeys.length ? [...prev, ...newKeys] : prev;
      }
      return mergeVisibleColumnKeys(prefs?.visibleColumns, columnDefs, {
        showAll: isAdConnector,
        defaultCount: 6,
      });
    });
  }, [applicationId, defKeysSignature, columnDefs, isAdConnector]);

  useEffect(() => {
    layoutHydratedRef.current = '';
    visibleColumnsTouchedRef.current = false;
  }, [applicationId]);

  useEffect(() => {
    columnOrderKeysRef.current = columnOrderKeys;
  }, [columnOrderKeys]);

  useEffect(() => {
    visibleColumnsRef.current = visibleColumns;
  }, [visibleColumns]);

  const layoutPrefsAppId = preferencesApplicationId || applicationId;

  const persistAccountsTableLayout = useCallback(
    async ({ columnOrder, visibleColumns: visible } = {}) => {
      if (!layoutPrefsAppId) return;
      const order = columnOrder ?? columnOrderKeysRef.current;
      const visibleList = visible ?? visibleColumnsRef.current;
      if (!order.length) return;
      try {
        const res = await applicationAPI.patchAccountsTablePreferences(layoutPrefsAppId, {
          columnOrder: order,
          visibleColumns: visibleList,
        });
        const saved = res.data?.data?.accountsTablePreferences;
        if (saved) {
          accountsPrefsRef.current = saved;
        }
      } catch (err) {
        console.error('Failed to save accounts table layout preferences', err);
      }
    },
    [layoutPrefsAppId],
  );

  const handleVisibleColumnsChange = useCallback((updater) => {
    visibleColumnsTouchedRef.current = true;
    setVisibleColumns(updater);
  }, []);

  useEffect(() => {
    if (!visibleColumnsTouchedRef.current || !layoutPrefsAppId) return undefined;
    const t = setTimeout(() => {
      persistAccountsTableLayout();
    }, 450);
    return () => clearTimeout(t);
  }, [visibleColumns, layoutPrefsAppId, persistAccountsTableLayout]);

  const persistColumnOrder = useCallback(
    (orderKeys) => {
      columnOrderKeysRef.current = orderKeys;
      persistAccountsTableLayout({ columnOrder: orderKeys });
    },
    [persistAccountsTableLayout],
  );

  const orderedColumnDefs = useMemo(
    () => applyColumnOrder(columnDefs, columnOrderKeys),
    [columnDefs, columnOrderKeys],
  );

  const displayColumnDefs = useMemo(
    () => orderedColumnDefs.filter((d) => visibleColumns.includes(d.key)),
    [orderedColumnDefs, visibleColumns],
  );

  // Server-side pagination (Application detail → Users tab)
  useEffect(() => {
    if (!applicationId || enableReportFeatures) return;
    let cancelled = false;
    setUsersLoading(true);
    (async () => {
      try {
        const params = { page, limit: rowsPerPage };
        if (listSearchDebounced) params.search = listSearchDebounced;
        if (accountStatusFilter) params.accountStatus = accountStatusFilter;
        const usersRes = await applicationAPI.getUsers(applicationId, params);
        if (cancelled) return;
        setUsers(usersRes.data?.data || []);
        setTotalUsers(Number(usersRes.data?.total ?? 0));
      } catch (error) {
        console.error('Failed to fetch application users', error);
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId, page, rowsPerPage, enableReportFeatures, listSearchDebounced, accountStatusFilter, refreshKey]);

  // Report / ISO mode: load a large page once per app for client filter & sort
  useEffect(() => {
    if (!applicationId || !enableReportFeatures) return;
    let cancelled = false;
    setUsersLoading(true);
    (async () => {
      try {
        const usersRes = await applicationAPI.getUsers(applicationId, {
          page: 0,
          limit: REPORT_FETCH_LIMIT,
        });
        if (cancelled) return;
        setUsers(usersRes.data?.data || []);
        setTotalUsers(Number(usersRes.data?.total ?? 0));
      } catch (error) {
        console.error('Failed to fetch application users', error);
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId, enableReportFeatures]);

  const handleRequestSort = (property) => {
    if (orderBy === property) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(property);
      setOrder('asc');
    }
  };

  // Keys that support sort/filter: prefer schema-defined keys, fall back to static list
  const reportSortFilterKeys = useMemo(() => {
    if (displayColumnDefs.length > 0) return displayColumnDefs.map((d) => d.key);
    return STATIC_SORT_FILTER_KEYS;
  }, [displayColumnDefs]);

  const filteredSortedUsers = useMemo(() => {
    if (!enableReportFeatures) return users;
    let rows = [...users];
    const q = reportFilter.trim().toLowerCase();
    if (q) {
      rows = rows.filter((u) =>
        reportSortFilterKeys.some((k) => {
          const v = getValueFromUserRow(u, k);
          return v != null && String(v).toLowerCase().includes(q);
        }),
      );
    }
    if (orderBy && reportSortFilterKeys.includes(orderBy)) {
      rows.sort((a, b) => {
        const va = getValueFromUserRow(a, orderBy);
        const vb = getValueFromUserRow(b, orderBy);
        const sa = va != null && va !== '' ? String(va) : '';
        const sb = vb != null && vb !== '' ? String(vb) : '';
        const cmp = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
        return order === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [users, enableReportFeatures, reportFilter, orderBy, order, reportSortFilterKeys]);

  const displayRows = useMemo(() => {
    if (!enableReportFeatures) return users;
    if (printing) return filteredSortedUsers;
    return filteredSortedUsers.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  }, [users, enableReportFeatures, filteredSortedUsers, printing, page, rowsPerPage]);

  const openUserDetail = (row) => {
    setUserDetailRow(row);
    setUserDetailOpen(true);
  };

  const closeUserDetail = () => {
    setUserDetailOpen(false);
    setUserDetailRow(null);
  };

  const detailFieldRows = useMemo(() => {
    if (!userDetailRow) return [];
    const seen = new Set();
    const rowsOut = [];
    for (const def of orderedColumnDefs) {
      if (!def.key || seen.has(def.key) || !showFieldInAccountDetail(def.key)) continue;
      seen.add(def.key);
      rowsOut.push({
        key: def.key,
        label: def.label,
        value: getValueFromUserRow(userDetailRow, def.key),
      });
    }
    const extras = Object.keys(userDetailRow)
      .filter((k) => {
        if (!isPlainDetailKey(k) || seen.has(k) || !showFieldInAccountDetail(k)) return false;
        if (isAdConnector && CANONICAL_IGA_ACCOUNT_FIELDS.has(k)) return false;
        return true;
      })
      .sort();
    for (const key of extras) {
      rowsOut.push({ key, label: formatHeaderName(key), value: userDetailRow[key] });
    }
    return rowsOut;
  }, [userDetailRow, orderedColumnDefs, isAdConnector]);

  const columnsButton = (
    <AccountTableColumnPicker
      columnDefs={columnDefs}
      columnOrderKeys={columnOrderKeys}
      visibleColumns={visibleColumns}
      onColumnOrderChange={setColumnOrderKeys}
      onVisibleColumnsChange={handleVisibleColumnsChange}
      onColumnReorder={persistColumnOrder}
      disabled={schemaLoading}
    />
  );

  const accountsBanner = showAccountsBanner && (
    <Paper
      elevation={0}
      sx={{
        mb: 2,
        borderRadius: 2,
        border: `1px solid ${palette.border.default}`,
        bgcolor: palette.bg.secondary,
        overflow: 'hidden',
      }}
    >
      <Stack spacing={2} sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <Box sx={{ minWidth: 0, flex: '1 1 200px' }}>
            <Typography
              variant="overline"
              sx={{
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: palette.text.secondary,
                display: 'block',
                lineHeight: 1.4,
              }}
            >
              Application accounts
            </Typography>
            <Typography variant="body2" sx={{ color: palette.text.secondary, mt: 0.25, maxWidth: 720 }}>
              {accountsBannerSubtitle ||
                'Columns reflect saved mappings and fields that contain data from your connector sync — empty template columns are hidden.'}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ flexShrink: 0 }}>
            {syncAction}
            {columnDefs.length > 0 ? columnsButton : null}
          </Stack>
        </Box>

        {!enableReportFeatures && accountStatusFilter ? (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color={accountStatusFilter === 'active' ? 'success' : 'warning'}
              label={
                accountStatusFilter === 'active'
                  ? 'Showing active accounts only'
                  : 'Showing inactive accounts only'
              }
              onDelete={
                typeof onClearAccountStatusFilter === 'function'
                  ? onClearAccountStatusFilter
                  : undefined
              }
              sx={{ fontWeight: 600 }}
            />
          </Stack>
        ) : null}

        {!enableReportFeatures && (
          <TextField
            size="small"
            fullWidth
            placeholder={
              isAdConnector
                ? 'Search LDAP values (sAMAccountName, mail, displayName, department, …)'
                : 'Search by name, email, login, department, or any mapped account field…'
            }
            value={listSearchInput}
            onChange={(e) => setListSearchInput(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search sx={{ color: palette.text.secondary, fontSize: 22 }} />
                </InputAdornment>
              ),
              endAdornment: listSearchInput ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    aria-label="Clear search"
                    onClick={() => {
                      setListSearchInput('');
                      setListSearchDebounced('');
                    }}
                    edge="end"
                  >
                    <Clear fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 1.5,
                bgcolor: palette.bg.input,
                transition: 'background-color 0.15s, box-shadow 0.15s',
                '&:hover': { bgcolor: palette.bg.elevated },
                '&.Mui-focused': {
                  bgcolor: palette.bg.secondary,
                  boxShadow: `0 0 0 2px ${alpha(palette.brand.primary, 0.2)}`,
                },
              },
            }}
          />
        )}
        {!enableReportFeatures && !usersLoading && totalUsers > 0 && (listSearchDebounced || accountStatusFilter) && (
          <Typography variant="caption" sx={{ color: palette.text.secondary, display: 'block', mt: -0.5 }}>
            {totalUsers.toLocaleString()} account{totalUsers === 1 ? '' : 's'} match
            {accountStatusFilter ? ` (${accountStatusFilter})` : ''}
            {listSearchDebounced ? ' this search' : ''} (paged below).
          </Typography>
        )}
      </Stack>
    </Paper>
  );

  if ((schemaLoading || (isAdConnector && columnDefs.length === 0)) && columnDefs.length === 0) {
    return (
      <Box>
        {accountsBanner}
        {bannerFooter}
        <Box sx={{ p: 5, textAlign: 'center' }}>
          <CircularProgress />
          <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>Loading dynamic table...</Typography>
        </Box>
      </Box>
    );
  }

  // No schema defined yet — guide user to the schema tab (AD apps use LDAP columns, not schema)
  if (!schemaLoading && columnDefs.length === 0 && !isAdConnector) {
    return (
      <Box>
        {accountsBanner}
        {bannerFooter}
        <Box sx={{ p: 5, textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: 2 }}>
          <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>No schema defined</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Go to the <strong>Application schema</strong> tab, define attributes (or import from a CSV), select a primary key, and save the schema. The Users table will then display columns based on your saved technical names.
          </Typography>
        </Box>
      </Box>
    );
  }

  if (!usersLoading && totalUsers === 0 && !listSearchDebounced) {
    const filterLabel =
      accountStatusFilter === 'active'
        ? 'active'
        : accountStatusFilter === 'inactive'
          ? 'inactive'
          : null;
    return (
      <Box>
        {accountsBanner}
        {bannerFooter}
        <Box sx={{ p: 5, textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: 2 }}>
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            {filterLabel
              ? `No ${filterLabel} accounts match this filter.`
              : (
                <>
                  No users found. Import CSV from the <strong>Application schema</strong> tab, or run a connector sync.
                </>
              )}
          </Typography>
        </Box>
      </Box>
    );
  }

  const noFilterMatches =
    enableReportFeatures && users.length > 0 && filteredSortedUsers.length === 0;

  const noListSearchMatches =
    !enableReportFeatures &&
    !usersLoading &&
    (listSearchDebounced || accountStatusFilter) &&
    users.length === 0 &&
    totalUsers === 0;

  return (
    <Box className={enableReportFeatures ? 'users-table-report' : undefined}>
      {accountsBanner}
      {bannerFooter}
      {enableReportFeatures && (
        <Paper
          elevation={0}
          sx={{
            mb: 2,
            borderRadius: '12px',
            border: `1px solid ${alpha('#0f172a', 0.08)}`,
            bgcolor: alpha('#fff', 0.85),
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
            overflow: 'hidden',
            '@media print': { display: 'none' },
          }}
        >
          <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Search accounts — user id, employee id, username, status, department…"
              value={reportFilter}
              onChange={(e) => setReportFilter(e.target.value)}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '10px',
                  bgcolor: '#f8fafc',
                  fontSize: '0.875rem',
                  transition: 'background-color 0.15s, box-shadow 0.15s',
                  '&:hover': { bgcolor: '#f1f5f9' },
                  '&.Mui-focused': {
                    bgcolor: '#fff',
                    boxShadow: `0 0 0 3px ${alpha('#2563eb', 0.15)}`,
                  },
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search sx={{ color: '#64748b', fontSize: 22 }} />
                  </InputAdornment>
                ),
              }}
            />
            {!printing && filteredSortedUsers.length > 0 && (
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1.25,
                  mt: 1.5,
                  pt: 1.5,
                  borderTop: `1px solid ${alpha('#0f172a', 0.06)}`,
                }}
              >
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                  <Chip
                    size="small"
                    label={
                      reportFilter.trim()
                        ? `${filteredSortedUsers.length.toLocaleString()} match${filteredSortedUsers.length !== 1 ? 'es' : ''}`
                        : `${filteredSortedUsers.length.toLocaleString()} in view`
                    }
                    sx={{
                      fontWeight: 700,
                      fontSize: '0.72rem',
                      height: 28,
                      bgcolor: alpha('#2563eb', 0.1),
                      color: '#1e40af',
                      border: `1px solid ${alpha('#2563eb', 0.2)}`,
                    }}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${users.length.toLocaleString()} loaded`}
                    sx={{ fontSize: '0.7rem', height: 28, borderColor: alpha('#0f172a', 0.1), color: '#64748b' }}
                  />
                  {!reportFilter.trim() && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`Page ${page + 1} / ${Math.max(1, Math.ceil(filteredSortedUsers.length / rowsPerPage))}`}
                      sx={{ fontSize: '0.7rem', height: 28, borderColor: alpha('#0f172a', 0.1), color: '#64748b', fontFamily: 'ui-monospace, monospace' }}
                    />
                  )}
                  <Typography component="span" sx={{ fontSize: '0.7rem', color: '#94a3b8', display: { xs: 'none', sm: 'inline' } }}>
                    {rowsPerPage} per page
                  </Typography>
                </Box>
                {totalUsers > 0 ? columnsButton : null}
              </Box>
            )}
            {!printing && filteredSortedUsers.length === 0 && users.length > 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5, pt: 1.5, borderTop: `1px solid ${alpha('#0f172a', 0.06)}` }}>
                {columnsButton}
              </Box>
            )}
          </Box>
        </Paper>
      )}
      {!showAccountsBanner && !enableReportFeatures && (
        <Toolbar
          sx={{
            px: '0 !important',
            mb: 1,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 1,
          }}
        >
          {columnsButton}
        </Toolbar>
      )}

      {noFilterMatches ? (
        <Box sx={{ py: 4, textAlign: 'center', border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
          <Typography variant="body2" color="text.secondary">
            No rows match the current filter. Clear the search or try different text.
          </Typography>
        </Box>
      ) : noListSearchMatches ? (
        <Box
          sx={{
            py: 4,
            px: 2,
            textAlign: 'center',
            border: `1px solid ${palette.border.default}`,
            borderRadius: 2,
            bgcolor: palette.bg.elevated,
          }}
        >
          <Typography variant="body2" sx={{ color: palette.text.secondary, mb: 0.5 }}>
            No accounts match <strong>&quot;{listSearchDebounced}&quot;</strong>.
          </Typography>
          <Typography variant="caption" sx={{ color: palette.text.disabled }}>
            Try different keywords or clear the search box.
          </Typography>
        </Box>
      ) : (
        <>
          <Box
            sx={{
              borderRadius: '12px',
              border: `1px solid ${alpha('#0f172a', 0.08)}`,
              overflow: 'hidden',
              boxShadow: enableReportFeatures ? '0 1px 4px rgba(15, 23, 42, 0.06)' : 'none',
            }}
          >
            <TableContainer
              component={Paper}
              elevation={0}
              sx={
                printing
                  ? { border: 'none', borderRadius: 0 }
                  : getStickyTableContainerSx({
                      headerBackground: enableReportFeatures
                        ? 'linear-gradient(180deg, #eef2ff 0%, #e8edf5 100%)'
                        : palette.bg.primary,
                      sx: { border: 'none', borderRadius: 0 },
                    })
              }
            >
              <Table size="small" stickyHeader={!printing}>
                <TableHead
                  sx={{
                    background: enableReportFeatures
                      ? 'linear-gradient(180deg, #eef2ff 0%, #e8edf5 100%)'
                      : '#f8fafc',
                  }}
                >
                  <TableRow>
                    <TableCell
                      sx={{
                        fontWeight: 700,
                        width: 64,
                        fontSize: enableReportFeatures ? '0.68rem' : undefined,
                        textTransform: enableReportFeatures ? 'uppercase' : undefined,
                        letterSpacing: enableReportFeatures ? '0.06em' : undefined,
                        color: enableReportFeatures ? '#475569' : undefined,
                        borderBottom: enableReportFeatures ? `1px solid ${alpha('#0f172a', 0.08)}` : undefined,
                      }}
                    >
                      {enableReportFeatures ? '#' : 'Sl. No.'}
                    </TableCell>

                    {displayColumnDefs.map(({ key, label }) => {
                        const sortable = enableReportFeatures && reportSortFilterKeys.includes(key);
                        const headSx = enableReportFeatures
                          ? {
                              fontWeight: 700,
                              fontSize: '0.68rem',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                              color: '#475569',
                              borderBottom: `1px solid ${alpha('#0f172a', 0.08)}`,
                              whiteSpace: 'nowrap',
                            }
                          : { fontWeight: 600 };
                        if (!sortable) {
                          return (
                            <TableCell key={key} sx={headSx}>
                              {label}
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell key={key} sx={headSx}>
                            <TableSortLabel
                              active={orderBy === key}
                              direction={orderBy === key ? order : 'asc'}
                              onClick={() => handleRequestSort(key)}
                              sx={{
                                '& .MuiTableSortLabel-icon': { fontSize: '1rem' },
                              }}
                            >
                              {label}
                            </TableSortLabel>
                          </TableCell>
                        );
                      })}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {displayRows.map((user, index) => {
                    const serial =
                      enableReportFeatures && printing
                        ? index + 1
                        : page * rowsPerPage + index + 1;
                    return (
                      <TableRow
                        key={user._id}
                        hover
                        onClick={() => openUserDetail(user)}
                        sx={{
                          cursor: 'pointer',
                          ...(enableReportFeatures
                            ? {
                                '&:nth-of-type(even)': { bgcolor: alpha('#f8fafc', 0.65) },
                                '&:hover': { bgcolor: alpha('#2563eb', 0.06) },
                                '&:last-child td': { borderBottom: 0 },
                              }
                            : {
                                '&:hover': { bgcolor: alpha(palette.brand.primary, 0.04) },
                              }),
                        }}
                      >
                        <TableCell
                          sx={{
                            ...(enableReportFeatures
                              ? {
                                  color: '#64748b',
                                  fontSize: '0.8125rem',
                                  fontWeight: 600,
                                  fontVariantNumeric: 'tabular-nums',
                                  borderBottom: `1px solid ${alpha('#0f172a', 0.06)}`,
                                }
                              : { color: 'text.secondary' }),
                          }}
                        >
                          {serial}
                        </TableCell>

                        {displayColumnDefs.map(({ key }) => (
                            <TableCell
                              key={key}
                              sx={
                                enableReportFeatures
                                  ? {
                                      borderBottom: `1px solid ${alpha('#0f172a', 0.06)}`,
                                      fontSize: '0.8125rem',
                                    }
                                  : {}
                              }
                            >
                              {isAccountStatusColumnKey(key) ? (
                                <AccountStatusCell
                                  value={getValueFromUserRow(user, key)}
                                  enableReportFeatures={enableReportFeatures}
                                />
                              ) : isMemberOfEntitlementsColumnKey(key) ? (
                                <MemberOfEntitlementsCell
                                  value={getValueFromUserRow(user, key)}
                                  compact={enableReportFeatures}
                                />
                              ) : (
                                <Typography
                                  variant="body2"
                                  sx={
                                    enableReportFeatures
                                      ? { fontSize: '0.8125rem', color: '#1e293b', lineHeight: 1.45 }
                                      : {}
                                  }
                                >
                                  {(() => {
                                    const text = formatAccountCellValue(getValueFromUserRow(user, key));
                                    return text != null ? text : <span style={{ color: '#cbd5e1' }}>—</span>;
                                  })()}
                                </Typography>
                              )}
                            </TableCell>
                          ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>

            {!enableReportFeatures && (
              <TablePagination
                component="div"
                count={totalUsers}
                page={page}
                onPageChange={(_, p) => setPage(p)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => {
                  setRowsPerPage(parseInt(e.target.value, 10));
                  setPage(0);
                }}
                rowsPerPageOptions={[10, 25, 50, 100]}
                sx={{
                  borderTop: `1px solid ${alpha('#0f172a', 0.08)}`,
                  bgcolor: alpha('#f8fafc', 0.5),
                  '& .MuiTablePagination-toolbar': { minHeight: 52 },
                }}
              />
            )}

            {enableReportFeatures && !printing && (
              <TablePagination
                component="div"
                count={filteredSortedUsers.length}
                page={page}
                onPageChange={(_, p) => setPage(p)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => {
                  setRowsPerPage(parseInt(e.target.value, 10));
                  setPage(0);
                }}
                rowsPerPageOptions={[10, 25, 50, 100]}
                sx={{
                  borderTop: `1px solid ${alpha('#0f172a', 0.08)}`,
                  bgcolor: alpha('#f8fafc', 0.6),
                  '& .MuiTablePagination-toolbar': { minHeight: 52, px: 1 },
                  '@media print': { display: 'none' },
                }}
              />
            )}
          </Box>

          <Dialog
            open={userDetailOpen}
            onClose={closeUserDetail}
            maxWidth="md"
            fullWidth
            scroll="paper"
            PaperProps={{
              elevation: 0,
              sx: {
                borderRadius: 2,
                border: `1px solid ${palette.border.default}`,
                maxHeight: 'min(90vh, 720px)',
              },
            }}
          >
            <DialogTitle
              sx={{
                position: 'relative',
                py: 2,
                px: 2.5,
                pr: 5,
                borderBottom: `1px solid ${palette.border.default}`,
                bgcolor: palette.bg.elevated,
              }}
            >
              <Typography variant="subtitle2" sx={{ color: palette.text.secondary, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', mb: 0.5 }}>
                Application account
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, color: palette.text.primary, lineHeight: 1.3 }}>
                {accountDialogTitle(userDetailRow)}
              </Typography>
              <IconButton
                aria-label="Close"
                onClick={closeUserDetail}
                size="small"
                sx={{ position: 'absolute', right: 12, top: 12, color: palette.text.secondary }}
              >
                <Close />
              </IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{ px: 2.5, py: 2, bgcolor: palette.bg.secondary }}>
              <Typography variant="body2" sx={{ color: palette.text.secondary, mb: 2 }}>
                Business attributes for this account (from your application schema and connector payload). Internal record and application identifiers are omitted.
              </Typography>
              <Grid container spacing={0}>
                {detailFieldRows.map(({ key, label, value }, idx) => {
                  const isObject = value != null && typeof value === 'object' && !Array.isArray(value);
                  const isMemberOfField = isMemberOfEntitlementsColumnKey(key);
                  const memberOfLines = isMemberOfField ? memberOfDetailLines(value) : null;
                  const strVal = formatDetailFieldValue(key, value);
                  return (
                    <Grid
                      item
                      xs={12}
                      key={key}
                      sx={{
                        display: 'flex',
                        flexDirection: { xs: 'column', sm: 'row' },
                        borderTop: idx === 0 ? 'none' : `1px solid ${palette.border.default}`,
                      }}
                    >
                      <Box
                        sx={{
                          width: { xs: '100%', sm: '34%' },
                          minWidth: { sm: 160 },
                          flexShrink: 0,
                          py: 1.25,
                          pr: { sm: 2 },
                          pb: { xs: 0.5, sm: 1.25 },
                          bgcolor: { sm: alpha(palette.text.primary, 0.02) },
                          borderRight: { sm: `1px solid ${palette.border.default}` },
                          borderBottom: { xs: `1px solid ${palette.border.default}`, sm: 'none' },
                          px: 1.5,
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, color: palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
                          {label}
                        </Typography>
                        <Typography variant="caption" sx={{ color: palette.text.disabled, fontFamily: 'ui-monospace, monospace', fontSize: '0.65rem', wordBreak: 'break-all' }}>
                          {key}
                        </Typography>
                      </Box>
                      <Box sx={{ flex: 1, py: { xs: 1, sm: 1.25 }, px: 1.5, minWidth: 0 }}>
                        {isAccountStatusColumnKey(key) && value != null && value !== '' && !isObject ? (
                          <AccountStatusCell value={value} />
                        ) : memberOfLines ? (
                          <Box
                            sx={{
                              p: 1.25,
                              borderRadius: 1,
                              bgcolor: palette.bg.input,
                              border: `1px solid ${palette.border.default}`,
                              maxHeight: 280,
                              overflow: 'auto',
                            }}
                          >
                            {memberOfLines.map((line, lineIdx) => (
                              <Typography
                                key={`${lineIdx}-${line}`}
                                variant="body2"
                                component="div"
                                sx={{
                                  color: palette.text.primary,
                                  fontWeight: 500,
                                  lineHeight: 1.55,
                                  fontFamily: 'ui-monospace, monospace',
                                  fontSize: '0.8125rem',
                                }}
                              >
                                {line}
                              </Typography>
                            ))}
                          </Box>
                        ) : isObject ? (
                          <Box
                            component="pre"
                            sx={{
                              m: 0,
                              p: 1,
                              borderRadius: 1,
                              bgcolor: palette.bg.input,
                              border: `1px solid ${palette.border.default}`,
                              fontSize: '0.75rem',
                              overflow: 'auto',
                              maxHeight: 200,
                              fontFamily: 'ui-monospace, monospace',
                              color: palette.text.primary,
                            }}
                          >
                            {strVal}
                          </Box>
                        ) : (
                          <Typography variant="body2" sx={{ color: palette.text.primary, fontWeight: 500, wordBreak: 'break-word' }}>
                            {strVal}
                          </Typography>
                        )}
                      </Box>
                    </Grid>
                  );
                })}
              </Grid>
            </DialogContent>
            <DialogActions sx={{ px: 2.5, py: 1.5, bgcolor: palette.bg.elevated, borderTop: `1px solid ${palette.border.default}` }}>
              <Button onClick={closeUserDetail} variant="outlined" sx={{ textTransform: 'none', fontWeight: 600, borderColor: palette.border.default, color: palette.text.secondary }}>
                Close
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
}
