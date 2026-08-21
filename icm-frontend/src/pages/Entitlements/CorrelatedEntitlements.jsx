import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Chip,
  Avatar,
  Divider,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  DialogActions,
  Tooltip,
  TablePagination,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Refresh,
  Search,
  Person,
  VpnKey,
  Close,
  ArrowForward,
} from '@mui/icons-material';
import { applicationAPI, identityProfileAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

/** Normalize populated or raw ObjectId fields from API responses (same as App Registry). */
function idStr(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v._id != null) return String(v._id);
  return String(v);
}

/**
 * True when an identity profile maps this application as HR/authoritative source
 * (matches App Registry “Authoritative source” chip — exclude from correlated entitlements picker).
 */
function hasIdentityProfileAuthoritativeMapping(app, profiles) {
  if (!profiles?.length || !app?._id) return false;
  const appId = idStr(app._id);
  const migratedLegacyId = app.hrms?.migratedFromHrmsId ? idStr(app.hrms.migratedFromHrmsId) : '';
  return profiles.some((p) => {
    const mappings = p.attributeMappings || [];
    if (!mappings.length) return false;
    const isSource =
      idStr(p.sourceApplicationId) === appId ||
      (migratedLegacyId && idStr(p.hrmsSourceId) === migratedLegacyId);
    const mappingRefsApp = mappings.some(
      (m) =>
        idStr(m.applicationId) === appId ||
        (migratedLegacyId && idStr(m.hrmsSourceId) === migratedLegacyId),
    );
    return isSource || mappingRefsApp;
  });
}

function nonempty(v) {
  return v != null && String(v).trim() !== '';
}

/** Same resolution as AppCorrelationConfig / backend correlation. */
function fieldValueFromMappedUser(user, standardField, extraKeys = []) {
  if (!user || !standardField) return undefined;
  const k0 = String(standardField).trim();
  if (!k0) return undefined;
  const extras = (Array.isArray(extraKeys) ? extraKeys : [extraKeys])
    .map((k) => String(k || '').trim())
    .filter((k) => k && k !== k0);
  const order = [k0, ...extras];
  const rd = user.rawData && typeof user.rawData === 'object' ? user.rawData : null;
  for (const key of order) {
    if (nonempty(user[key])) return user[key];
  }
  for (const key of order) {
    if (rd && nonempty(rd[key])) return rd[key];
  }
  return undefined;
}

/**
 * Card title next to the avatar: prefer schema PK, then human-friendly fields.
 * PK alone often renders "—" when the marked primary key does not match stored keys on hydrated users.
 */
function assignedUserCardHeaderLine(user, pkField, pkAlternateCsvKeys, schemaFields, getCsvAltsForField) {
  const pick = (sf, fixedExtras) => {
    if (!sf) return '';
    const extras = fixedExtras !== undefined ? fixedExtras : getCsvAltsForField(sf);
    const v = fieldValueFromMappedUser(user, sf, extras);
    return nonempty(v) ? String(v).trim() : '';
  };
  let s = pick(pkField, pkAlternateCsvKeys);
  if (s) return s;
  const preferred = [
    'display_name',
    'displayName',
    'name',
    'full_name',
    'fullName',
    'username',
    'user_name',
    'email',
    'user_id',
    'userId',
    'employeeId',
    'employee_id',
  ];
  for (const k of preferred) {
    s = pick(k, undefined);
    if (s) return s;
  }
  for (const sf of schemaFields || []) {
    const lower = String(sf).toLowerCase();
    if (/name|display|login|mail|account|user|employee|title/.test(lower)) {
      s = pick(sf, undefined);
      if (s) return s;
    }
  }
  for (const sf of schemaFields || []) {
    s = pick(sf, undefined);
    if (s) return s;
  }
  return '';
}

const ASSIGNED_USERS_PAGE_SIZE = 10;
const ASSIGNED_USERS_SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_MATRIX_PAGE_SIZE = 24;

export default function CorrelatedEntitlements() {
  const { embeddedInCorrelationSummary = false } = useOutletContext() || {};
  const { user } = useAuth();
  const tenantId = useMemo(() => {
    const raw = user?.tenantId;
    if (raw == null || raw === '') return '';
    return typeof raw === 'object' && raw._id != null ? String(raw._id) : String(raw);
  }, [user?.tenantId]);

  const [applications, setApplications] = useState([]);
  const [identityProfiles, setIdentityProfiles] = useState([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [selectedAppId, setSelectedAppId] = useState('');

  const applicationsForPicker = useMemo(
    () =>
      applications.filter((app) => !hasIdentityProfileAuthoritativeMapping(app, identityProfiles)),
    [applications, identityProfiles],
  );

  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixData, setMatrixData] = useState([]);
  const [matrixTotal, setMatrixTotal] = useState(0);
  const [matrixPage, setMatrixPage] = useState(0);
  const [matrixRowsPerPage, setMatrixRowsPerPage] = useState(DEFAULT_MATRIX_PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState('');

  const [applicationUserMappings, setApplicationUserMappings] = useState([]);
  const [applicationUserPkField, setApplicationUserPkField] = useState('');

  const [selectedCard, setSelectedCard] = useState(null);
  const [assignedUsersSearchInput, setAssignedUsersSearchInput] = useState('');
  const [debouncedAssignedUsersSearch, setDebouncedAssignedUsersSearch] = useState('');
  const prevDebouncedAssignedSearchRef = useRef(undefined);

  useEffect(() => {
    if (!tenantId) {
      setApplications([]);
      setAppsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setAppsLoading(true);
      try {
        const [resApps, resProfiles] = await Promise.all([
          applicationAPI.list({ tenantId, limit: 500 }),
          identityProfileAPI.list({ tenantId }),
        ]);
        const list = resApps.data?.success
          ? resApps.data.data || resApps.data.applications || []
          : resApps.data?.data || resApps.data?.applications || [];
        const profiles = resProfiles.data?.data || [];
        if (!cancelled) {
          setApplications(Array.isArray(list) ? list : []);
          setIdentityProfiles(Array.isArray(profiles) ? profiles : []);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setApplications([]);
          setIdentityProfiles([]);
        }
      } finally {
        if (!cancelled) setAppsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!selectedAppId) return;
    const stillEligible = applicationsForPicker.some((a) => String(a._id) === selectedAppId);
    if (!stillEligible) {
      setSelectedAppId('');
      setMatrixPage(0);
      setSearchQuery('');
      setMatrixData([]);
      setMatrixTotal(0);
    }
  }, [selectedAppId, applicationsForPicker]);

  const loadApplicationSchema = useCallback(async (appId) => {
    if (!appId) {
      setApplicationUserMappings([]);
      setApplicationUserPkField('');
      return;
    }
    try {
      const appRes = await applicationAPI.getById(appId);
      const appPayload = appRes.data?.data ?? appRes.data;
      const um = Array.isArray(appPayload?.userMappings) ? appPayload.userMappings : [];
      setApplicationUserMappings(um);
      const pkUser = um.find((m) => m.isPrimaryKey);
      setApplicationUserPkField(String(pkUser?.standardField || '').trim());
    } catch (e) {
      console.error(e);
      setApplicationUserMappings([]);
      setApplicationUserPkField('');
    }
  }, []);

  const fetchMatrixData = useCallback(async () => {
    if (!selectedAppId) {
      setMatrixData([]);
      setMatrixTotal(0);
      return;
    }
    setMatrixLoading(true);
    try {
      const res = await applicationAPI.getAppEntitlementCorrelations(selectedAppId, {
        page: matrixPage,
        limit: matrixRowsPerPage,
      });
      setMatrixData(res.data?.data || []);
      setMatrixTotal(Number(res.data?.total ?? 0));
    } catch (err) {
      console.error(err);
      setMatrixData([]);
      setMatrixTotal(0);
    } finally {
      setMatrixLoading(false);
    }
  }, [selectedAppId, matrixPage, matrixRowsPerPage]);

  useEffect(() => {
    if (!selectedAppId) return;
    loadApplicationSchema(selectedAppId);
  }, [selectedAppId, loadApplicationSchema]);

  useEffect(() => {
    fetchMatrixData();
  }, [fetchMatrixData]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedAssignedUsersSearch(assignedUsersSearchInput.trim());
    }, ASSIGNED_USERS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [assignedUsersSearchInput]);

  useEffect(() => {
    if (!selectedCard?.entitlementId) return;
    const prev = prevDebouncedAssignedSearchRef.current;
    if (prev === undefined) {
      prevDebouncedAssignedSearchRef.current = debouncedAssignedUsersSearch;
      return;
    }
    if (prev === debouncedAssignedUsersSearch) return;
    prevDebouncedAssignedSearchRef.current = debouncedAssignedUsersSearch;
    setSelectedCard((p) =>
      p?.entitlementId ? { ...p, usersPage: 0, users: [], loadingUsers: true } : p,
    );
  }, [debouncedAssignedUsersSearch, selectedCard?.entitlementId]);

  const closeUserListModal = useCallback(() => {
    setSelectedCard(null);
    setAssignedUsersSearchInput('');
    setDebouncedAssignedUsersSearch('');
    prevDebouncedAssignedSearchRef.current = undefined;
  }, []);

  useEffect(() => {
    if (!selectedAppId) return;
    const entId = selectedCard?.entitlementId;
    if (!entId) return;
    const page = Number.isFinite(selectedCard?.usersPage) ? selectedCard.usersPage : 0;
    let cancelled = false;
    (async () => {
      try {
        const res = await applicationAPI.getCorrelationEntitlementUsers(selectedAppId, {
          entitlementId: entId,
          page,
          limit: ASSIGNED_USERS_PAGE_SIZE,
          ...(debouncedAssignedUsersSearch ? { search: debouncedAssignedUsersSearch } : {}),
        });
        if (cancelled) return;
        const rows = res.data?.data || [];
        const users = rows.map((r) => r.userData).filter(Boolean);
        const total = Number(res.data?.total ?? 0);
        setSelectedCard((prev) => {
          if (!prev || String(prev.entitlementId) !== String(entId)) return prev;
          return { ...prev, users, usersTotal: total, loadingUsers: false };
        });
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setSelectedCard((prev) =>
            prev && String(prev.entitlementId) === String(entId)
              ? { ...prev, users: [], usersTotal: 0, loadingUsers: false }
              : prev,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAppId, selectedCard?.entitlementId, selectedCard?.usersPage, debouncedAssignedUsersSearch]);

  const pkCsvAlternateKeys = useMemo(
    () =>
      (applicationUserMappings || [])
        .filter((m) => String(m.standardField || '').trim() === applicationUserPkField)
        .map((m) => String(m.csvColumn || '').trim())
        .filter((c) => c && c !== applicationUserPkField),
    [applicationUserMappings, applicationUserPkField],
  );

  const csvAlternatesForStandardField = (standardField) => {
    const sf = String(standardField || '').trim();
    if (!sf) return [];
    return (applicationUserMappings || [])
      .filter((m) => String(m.standardField || '').trim() === sf)
      .map((m) => String(m.csvColumn || '').trim())
      .filter((c) => c && c !== sf);
  };

  const schemaUserStandardFields = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const m of applicationUserMappings || []) {
      const sf = String(m.standardField || '').trim();
      if (!sf || seen.has(sf)) continue;
      seen.add(sf);
      out.push(sf);
    }
    return out;
  }, [applicationUserMappings]);

  const entitlementCards = useMemo(() => {
    const rows = matrixData.map((row) => {
      const entName =
        row.entitlementData?.entitlement_name ||
        row.entitlementData?.entitlement_id ||
        'Unknown Entitlement';
      return {
        key: String(row.entitlementId ?? entName),
        entName,
        entitlementId: row.entitlementId,
        userCount: Number(row.userCount) || 0,
      };
    });
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase().trim();
    return rows.filter((r) => r.entName.toLowerCase().includes(q));
  }, [matrixData, searchQuery]);

  const matrixPageSummary = useMemo(() => {
    let linksOnPage = 0;
    for (const r of matrixData) {
      linksOnPage += Number(r.userCount) || 0;
    }
    return { entitlementsOnPage: matrixData.length, linksOnPage };
  }, [matrixData]);

  const handleAppChange = (e) => {
    const v = e.target.value;
    setSelectedAppId(v);
    setMatrixPage(0);
    setSearchQuery('');
    setMatrixData([]);
    setMatrixTotal(0);
  };

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">Select a tenant context to view correlated entitlements.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: embeddedInCorrelationSummary ? 0 : { xs: 2, md: 3 } }}>
      {!embeddedInCorrelationSummary ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
            Correlated entitlements
          </Typography>
          <FormControl size="small" sx={{ minWidth: 260 }}>
            <InputLabel id="corr-ent-app-label">Application</InputLabel>
            <Select
              labelId="corr-ent-app-label"
              label="Application"
              value={selectedAppId}
              onChange={handleAppChange}
              disabled={appsLoading}
            >
              <MenuItem value="">
                <em>Choose application…</em>
              </MenuItem>
              {applicationsForPicker.map((app) => (
                <MenuItem key={String(app._id)} value={String(app._id)}>
                  {app.name || 'Unnamed'}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      ) : null}

      {!selectedAppId ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
          {embeddedInCorrelationSummary ? (
            <FormControl size="small" sx={{ minWidth: 260, ml: 'auto' }}>
              <InputLabel id="corr-ent-app-label">Application</InputLabel>
              <Select
                labelId="corr-ent-app-label"
                label="Application"
                value={selectedAppId}
                onChange={handleAppChange}
                disabled={appsLoading}
              >
                <MenuItem value="">
                  <em>Choose application…</em>
                </MenuItem>
                {applicationsForPicker.map((app) => (
                  <MenuItem key={String(app._id)} value={String(app._id)}>
                    {app.name || 'Unnamed'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}
          <Alert severity="info" sx={{ flex: embeddedInCorrelationSummary ? '1 1 100%' : 1, mb: 0 }}>
            Choose an application to load correlation results. Run account/entitlement correlation from the application&apos;s
            correlation tab if this list is empty.
          </Alert>
        </Box>
      ) : null}

      {selectedAppId ? (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 2 }}>
            <Box sx={{ flex: 1, minWidth: 200 }}>
              <Typography variant="h6" sx={{ mb: 0.5 }}>
                Correlation results
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                {matrixTotal > 0
                  ? `Entitlements: ${matrixTotal.toLocaleString()} total · ${matrixPageSummary.entitlementsOnPage} on this page · ${matrixPageSummary.linksOnPage.toLocaleString()} link(s) on this page`
                  : matrixLoading
                    ? 'Loading…'
                    : 'No correlation data loaded yet.'}
              </Typography>
              <TextField
                fullWidth
                size="small"
                placeholder="Search entitlements…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search color="action" />
                    </InputAdornment>
                  ),
                }}
              />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0, pt: 0.5 }}>
              {embeddedInCorrelationSummary ? (
                <FormControl size="small" sx={{ minWidth: 220 }}>
                  <InputLabel id="corr-ent-app-label">Application</InputLabel>
                  <Select
                    labelId="corr-ent-app-label"
                    label="Application"
                    value={selectedAppId}
                    onChange={handleAppChange}
                    disabled={appsLoading}
                  >
                    <MenuItem value="">
                      <em>Choose application…</em>
                    </MenuItem>
                    {applicationsForPicker.map((app) => (
                      <MenuItem key={String(app._id)} value={String(app._id)}>
                        {app.name || 'Unnamed'}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : null}
              <Button
                size="small"
                startIcon={<Refresh />}
                onClick={() => {
                  setMatrixPage(0);
                  fetchMatrixData();
                }}
                disabled={matrixLoading}
                sx={{ textTransform: 'none', height: 40 }}
              >
                Refresh
              </Button>
            </Box>
          </Box>

          {matrixLoading && matrixData.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : entitlementCards.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: 2 }}>
              <Typography color="text.secondary">
                No correlation data on this page. Run the correlation engine on the application or adjust search.
              </Typography>
            </Box>
          ) : (
            <Grid container spacing={3}>
              {entitlementCards.map((data) => {
                const { entName, userCount, entitlementId } = data;
                return (
                  <Grid item xs={12} sm={6} lg={4} key={data.key}>
                    <Card
                      variant="outlined"
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
                        transition: 'transform 0.2s',
                        '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 6px 16px rgba(0,0,0,0.08)' },
                      }}
                    >
                      <CardContent sx={{ flexGrow: 1, p: 3 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                          <Avatar sx={{ bgcolor: 'primary.light', color: 'primary.dark', width: 48, height: 48 }}>
                            <VpnKey />
                          </Avatar>
                          <Chip
                            icon={<Person />}
                            label={`${userCount} Users`}
                            color={userCount > 0 ? 'success' : 'default'}
                            size="small"
                            sx={{
                              fontWeight: 600,
                              backgroundColor: userCount > 0 ? '#e6f4ea' : '#f1f5f9',
                              color: userCount > 0 ? '#1e4620' : 'text.secondary',
                            }}
                          />
                        </Box>
                        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, fontSize: '1.1rem', lineHeight: 1.2 }}>
                          {entName}
                        </Typography>
                      </CardContent>
                      <Divider />
                      <Box sx={{ p: 1.5, backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          endIcon={<ArrowForward />}
                          onClick={() => {
                            setAssignedUsersSearchInput('');
                            setDebouncedAssignedUsersSearch('');
                            prevDebouncedAssignedSearchRef.current = undefined;
                            setSelectedCard({
                              title: entName,
                              countLabel: 'Assigned Users',
                              entitlementId,
                              expectedCount: userCount,
                              users: [],
                              usersPage: 0,
                              usersTotal: null,
                              loadingUsers: true,
                            });
                          }}
                          disabled={userCount === 0 || !entitlementId}
                          sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                          View Assigned Users
                        </Button>
                      </Box>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}

          {matrixTotal > 0 && !searchQuery.trim() ? (
            <TablePagination
              component="div"
              count={matrixTotal}
              page={matrixPage}
              onPageChange={(_, p) => setMatrixPage(p)}
              rowsPerPage={matrixRowsPerPage}
              onRowsPerPageChange={(e) => {
                setMatrixRowsPerPage(parseInt(e.target.value, 10));
                setMatrixPage(0);
              }}
              rowsPerPageOptions={[12, 24, 48, 96]}
              sx={{ borderTop: '1px solid', borderColor: 'divider', mt: 2 }}
            />
          ) : null}
        </>
      ) : null}

      <Dialog open={!!selectedCard} onClose={closeUserListModal} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle sx={{ m: 0, p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, wordBreak: 'break-all' }}>
              {selectedCard?.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedCard?.countLabel} (
              {selectedCard?.usersTotal != null
                ? selectedCard.usersTotal
                : selectedCard?.loadingUsers
                  ? '…'
                  : selectedCard?.expectedCount ?? 0}
              )
            </Typography>
          </Box>
          <IconButton onClick={closeUserListModal} aria-label="Close">
            <Close />
          </IconButton>
        </DialogTitle>
        <Divider />
        {selectedCard?.entitlementId ? (
          <Box sx={{ px: 3, py: 2, backgroundColor: '#f1f5f9' }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search by account ID, name, email, department, or any application user field…"
              value={assignedUsersSearchInput}
              onChange={(e) => setAssignedUsersSearchInput(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search color="action" />
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        ) : null}
        {selectedCard?.entitlementId ? <Divider /> : null}

        <DialogContent sx={{ p: 3, backgroundColor: '#f1f5f9', maxHeight: 600 }}>
          {selectedCard?.loadingUsers &&
          (!selectedCard?.users || selectedCard.users.length === 0) &&
          selectedCard?.entitlementId ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : null}
          {!selectedCard?.loadingUsers || (selectedCard?.users && selectedCard.users.length > 0)
            ? selectedCard?.users?.map((u, idx) => {
                const headerLine = assignedUserCardHeaderLine(
                  u,
                  applicationUserPkField,
                  pkCsvAlternateKeys,
                  schemaUserStandardFields,
                  csvAlternatesForStandardField,
                );
                const titleLine = headerLine || '\u2014';
                const avatarLetter = (headerLine && headerLine.charAt(0).toUpperCase()) || 'U';
                return (
                  <Card
                    key={`${selectedCard?.usersPage ?? 0}-${u._id || idx}`}
                    variant="outlined"
                    sx={{ mb: 3, boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}
                  >
                    <Box sx={{ p: 2, backgroundColor: '#fff', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Avatar sx={{ width: 48, height: 48, bgcolor: 'primary.main', fontWeight: 700 }}>{avatarLetter}</Avatar>
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          {titleLine}
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ p: 2, backgroundColor: '#fdfdfd' }}>
                      <Grid container spacing={2}>
                        {schemaUserStandardFields.map((sf) => {
                          const alts = csvAlternatesForStandardField(sf);
                          const val = fieldValueFromMappedUser(u, sf, alts);
                          const display = val != null && String(val).trim() !== '' ? String(val) : '\u2014';
                          return (
                            <Grid item xs={6} sm={4} md={3} key={sf}>
                              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.65rem', fontWeight: 700 }}>
                                {sf.replace(/_/g, ' ')}
                              </Typography>
                              <Tooltip title={display} placement="top">
                                <Typography
                                  variant="body2"
                                  sx={{ fontWeight: 500, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                                >
                                  {display}
                                </Typography>
                              </Tooltip>
                            </Grid>
                          );
                        })}
                      </Grid>
                    </Box>
                  </Card>
                );
              })
            : null}
          {selectedCard?.entitlementId != null && (selectedCard.usersTotal ?? 0) > ASSIGNED_USERS_PAGE_SIZE ? (
            <TablePagination
              component="div"
              count={selectedCard.usersTotal ?? 0}
              page={selectedCard.usersPage ?? 0}
              onPageChange={(_, p) => {
                setSelectedCard((prev) =>
                  prev?.entitlementId ? { ...prev, usersPage: p, users: [], loadingUsers: true } : prev,
                );
              }}
              rowsPerPage={ASSIGNED_USERS_PAGE_SIZE}
              rowsPerPageOptions={[ASSIGNED_USERS_PAGE_SIZE]}
              onRowsPerPageChange={() => {}}
              sx={{
                borderTop: '1px solid',
                borderColor: 'divider',
                mt: 1,
                '& .MuiTablePagination-selectLabel': { display: 'none' },
                '& .MuiTablePagination-select': { display: 'none' },
                '& .MuiTablePagination-displayedRows': { marginLeft: 'auto' },
              }}
            />
          ) : null}
        </DialogContent>
        <Divider />
        <DialogActions sx={{ p: 2, backgroundColor: '#f8fafc' }}>
          <Button onClick={closeUserListModal} variant="outlined" size="small" sx={{ textTransform: 'none', fontWeight: 600 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
