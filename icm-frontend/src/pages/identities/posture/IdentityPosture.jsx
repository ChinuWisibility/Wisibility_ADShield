/**
 * Identity Posture — standalone page.
 * Pick a user, then view posture on this same page (does not redirect to the catalog).
 * Deep-link: /identities/posture?identityId=<id>
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Autocomplete,
  Box,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { FingerprintOutlined } from '@mui/icons-material';
import SearchIcon from '@mui/icons-material/Search';
import { useQueryClient } from '@tanstack/react-query';
import { identityAPI } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { refineIdentityPickerResults } from '../../../utils/identityPickerSearch';
import { POSTURE_COLORS } from './components/identityPostureTheme';
import {
  IDENTITY_POSTURE_PAGE_EYEBROW,
  IDENTITY_POSTURE_PAGE_SUBTITLE,
  IDENTITY_POSTURE_PAGE_TITLE,
  POSTURE_CAPABILITY_CHIPS,
} from './identityPostureLabels';
import IdentityPostureDashboard from '../catalog/IdentityPostureDashboard';
import { prefetchIdentityPosture } from '../catalog/identityCatalogQueries';

const IDENTITY_BROWSE_LIMIT = 150;

function resolveTenantId(user) {
  const t = user?.tenantId;
  if (!t) return null;
  if (typeof t === 'object') return t._id || t.id || null;
  return t;
}

export default function IdentityPosture() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = resolveTenantId(user);
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedIdentity, setSelectedIdentity] = useState(null);
  const [identityOptions, setIdentityOptions] = useState([]);
  const [identitySearch, setIdentitySearch] = useState('');
  const [identityLoading, setIdentityLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deepLinkError, setDeepLinkError] = useState('');

  const searchDebounceRef = useRef(null);
  const searchSeqRef = useRef(0);
  const searchAbortRef = useRef(null);
  const deepLinkHandled = useRef(false);

  const fetchIdentityOptions = useCallback(async (query, seq) => {
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setIdentityLoading(true);
    try {
      const q = String(query || '').trim();
      const params = {
        page: 0,
        limit: IDENTITY_BROWSE_LIMIT,
        sortBy: 'displayName',
        sortDir: 'asc',
      };
      if (tenantId) params.tenantId = tenantId;
      if (q) params.search = q;
      const res = await identityAPI.list(params, { signal: controller.signal });
      if (seq !== searchSeqRef.current) return;
      setIdentityOptions(refineIdentityPickerResults(res.data?.data || [], q));
    } catch (err) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
      if (seq !== searchSeqRef.current) return;
      setIdentityOptions([]);
    } finally {
      if (seq === searchSeqRef.current) setIdentityLoading(false);
    }
  }, [tenantId]);

  const queueIdentityOptionsFetch = useCallback((query) => {
    clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();
    const seq = ++searchSeqRef.current;
    const q = String(query || '').trim();
    const delay = q ? 300 : 0;
    searchDebounceRef.current = setTimeout(() => {
      fetchIdentityOptions(q, seq);
    }, delay);
  }, [fetchIdentityOptions]);

  const handlePickerOpen = useCallback(() => {
    setPickerOpen(true);
    queueIdentityOptionsFetch(identitySearch);
  }, [identitySearch, queueIdentityOptionsFetch]);

  const handleBrowseClick = useCallback(() => {
    setPickerOpen(true);
    queueIdentityOptionsFetch(identitySearch);
  }, [identitySearch, queueIdentityOptionsFetch]);

  const handleIdentityInputChange = useCallback((_, value, reason) => {
    if (reason === 'reset') return;
    setIdentitySearch(value);
    queueIdentityOptionsFetch(value);
  }, [queueIdentityOptionsFetch]);

  const handleIdentitySelect = useCallback((identity) => {
    setSelectedIdentity(identity);
    setPickerOpen(false);
    setDeepLinkError('');
    const id = identity?._id || identity?.id;
    if (id) {
      prefetchIdentityPosture(queryClient, id);
      setSearchParams({ identityId: String(id) }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [queryClient, setSearchParams]);

  const handleBackToSearch = useCallback(() => {
    searchAbortRef.current?.abort();
    clearTimeout(searchDebounceRef.current);
    setSelectedIdentity(null);
    setIdentitySearch('');
    setIdentityOptions([]);
    setPickerOpen(false);
    setDeepLinkError('');
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // Deep-link: /identities/posture?identityId=… → load on this page
  useEffect(() => {
    const paramId = searchParams.get('identityId');
    if (!paramId || deepLinkHandled.current) return;
    deepLinkHandled.current = true;

    (async () => {
      try {
        const res = await identityAPI.getById(paramId);
        const identity = res.data?.data || res.data;
        if (identity) {
          setSelectedIdentity(identity);
          prefetchIdentityPosture(queryClient, paramId);
        } else {
          setDeepLinkError('Could not load identity from link.');
        }
      } catch {
        setDeepLinkError('Could not load identity from link.');
      }
    })();
  }, [searchParams, queryClient]);

  const selectedDisplayName =
    selectedIdentity?.displayName ||
    [selectedIdentity?.firstName, selectedIdentity?.lastName].filter(Boolean).join(' ') ||
    selectedIdentity?.email ||
    '';

  const selectedId = selectedIdentity?._id || selectedIdentity?.id || null;
  const showSearchView = !selectedIdentity;

  return (
    <Box sx={{ width: '100%', minHeight: '100%', bgcolor: POSTURE_COLORS.pageBg, mx: -3, mt: -2, px: 3, py: 2 }}>
      {showSearchView ? (
        <>
          <Box
            sx={{
              mb: 2.5,
              pb: 2,
              borderBottom: '1px solid #e2e8f0',
              bgcolor: '#fff',
              mx: -3,
              px: 3,
              pt: 0.5,
              mt: -0.5,
            }}
          >
            <Typography
              sx={{
                fontSize: '0.68rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: POSTURE_COLORS.blue,
                mb: 0.5,
              }}
            >
              {IDENTITY_POSTURE_PAGE_EYEBROW}
            </Typography>
            <Typography
              variant="h5"
              sx={{ fontWeight: 700, letterSpacing: '-0.02em', color: POSTURE_COLORS.blueDark, fontSize: '1.35rem' }}
            >
              {IDENTITY_POSTURE_PAGE_TITLE}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 560, lineHeight: 1.45 }}>
              {IDENTITY_POSTURE_PAGE_SUBTITLE}
            </Typography>
          </Box>

          <Paper
            elevation={0}
            sx={{
              p: 2.25,
              mb: 2,
              border: '1px solid #e2e8f0',
              borderRadius: 2,
              bgcolor: '#fff',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
            }}
          >
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Box sx={{ flex: 1, minWidth: 280 }}>
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'text.secondary',
                    display: 'block',
                    mb: 0.75,
                    fontSize: '0.68rem',
                  }}
                >
                  Find identity
                </Typography>
                <Autocomplete
                  id="identity-posture-user-select"
                  open={pickerOpen}
                  onOpen={handlePickerOpen}
                  onClose={() => setPickerOpen(false)}
                  options={identityOptions}
                  loading={identityLoading}
                  value={null}
                  onChange={(_, v) => handleIdentitySelect(v)}
                  onInputChange={handleIdentityInputChange}
                  inputValue={identitySearch}
                  filterOptions={(opts) => opts}
                  size="small"
                  ListboxProps={{ style: { maxHeight: 280 } }}
                  getOptionLabel={(o) => {
                    if (!o) return '';
                    const name = o.displayName || [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || '';
                    const email = o.email ? ` — ${o.email}` : '';
                    const emp = o.employeeId ? ` (${o.employeeId})` : '';
                    return `${name}${email}${emp}`;
                  }}
                  isOptionEqualToValue={(a, b) => (a?._id || a?.id) === (b?._id || b?.id)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder="Search by name, email, or employee ID…"
                      onClick={() => {
                        if (!pickerOpen) handlePickerOpen();
                      }}
                      InputProps={{
                        ...params.InputProps,
                        startAdornment: (
                          <InputAdornment position="start">
                            <IconButton
                              size="small"
                              edge="start"
                              tabIndex={-1}
                              aria-label="Browse identities"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={handleBrowseClick}
                            >
                              <SearchIcon fontSize="small" color="action" />
                            </IconButton>
                          </InputAdornment>
                        ),
                        endAdornment: (
                          <>
                            {identityLoading ? <CircularProgress size={16} /> : null}
                            {params.InputProps.endAdornment}
                          </>
                        ),
                      }}
                    />
                  )}
                  renderOption={(props, o) => (
                    <Box
                      component="li"
                      {...props}
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start !important',
                        py: '8px !important',
                      }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {o.displayName || o.email || 'Unknown'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {[o.email, o.employeeId].filter(Boolean).join(' • ')}
                      </Typography>
                    </Box>
                  )}
                  noOptionsText={identityLoading ? 'Loading users…' : 'No users found'}
                />
              </Box>
            </Box>
          </Paper>

          {deepLinkError && (
            <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid #fecaca', bgcolor: '#fef2f2', borderRadius: 2 }}>
              <Typography variant="body2" color="error">{deepLinkError}</Typography>
            </Paper>
          )}

          <Paper
            elevation={0}
            sx={{
              p: { xs: 2.5, md: 3 },
              border: '1px solid #e2e8f0',
              borderRadius: 2,
              bgcolor: '#fff',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
            }}
          >
            <Box sx={{ textAlign: 'center', mb: 2.5 }}>
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  mx: 'auto',
                  mb: 1.5,
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: POSTURE_COLORS.blueBg,
                  color: POSTURE_COLORS.blue,
                  border: '1px solid #bfdbfe',
                }}
              >
                <FingerprintOutlined sx={{ fontSize: 24 }} />
              </Box>
              <Typography
                sx={{ fontWeight: 700, color: POSTURE_COLORS.blueDark, fontSize: '1.05rem', letterSpacing: '-0.01em' }}
              >
                Choose an identity to open the overview
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, maxWidth: 440, mx: 'auto', lineHeight: 1.5 }}>
                You’ll see profile health, overall posture score, risk KPIs, access details, and peer comparison.
              </Typography>
            </Box>

            {/* Soft preview of the overview layout */}
            <Box sx={{ opacity: 0.72, pointerEvents: 'none', userSelect: 'none' }} aria-hidden>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: '5fr 7fr' },
                  gap: 1.5,
                  mb: 1.5,
                }}
              >
                <Box sx={{ p: 2, borderRadius: 2, border: '1px dashed #e2e8f0', bgcolor: '#f8fafc', minHeight: 110 }}>
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                    <Box sx={{ width: 44, height: 44, borderRadius: '50%', bgcolor: '#e2e8f0' }} />
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ height: 10, width: '55%', bgcolor: '#e2e8f0', borderRadius: 1, mb: 0.75 }} />
                      <Box sx={{ height: 8, width: '40%', bgcolor: '#edf2f7', borderRadius: 1 }} />
                    </Box>
                    <Box sx={{ height: 22, width: 72, bgcolor: '#dcfce7', borderRadius: 999 }} />
                  </Box>
                </Box>
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    border: '1px dashed #e2e8f0',
                    bgcolor: '#f8fafc',
                    minHeight: 110,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                  }}
                >
                  <Box
                    sx={{
                      width: 88,
                      height: 44,
                      borderRadius: '88px 88px 0 0',
                      border: '8px solid #bbf7d0',
                      borderBottom: 0,
                    }}
                  />
                  <Box>
                    <Box sx={{ height: 14, width: 48, bgcolor: '#bbf7d0', borderRadius: 1, mb: 0.75 }} />
                    <Box sx={{ height: 8, width: 72, bgcolor: '#edf2f7', borderRadius: 1 }} />
                  </Box>
                </Box>
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
                  gap: 1.25,
                  mb: 1.5,
                }}
              >
                {POSTURE_CAPABILITY_CHIPS.map((chip) => (
                  <Box
                    key={chip.label}
                    sx={{
                      p: 1.25,
                      borderRadius: 1.5,
                      border: '1px solid #eef2f6',
                      bgcolor: '#fff',
                    }}
                  >
                    <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                      {chip.label}
                    </Typography>
                    <Box sx={{ height: 16, width: 40, bgcolor: '#e2e8f0', borderRadius: 1, mb: 0.5 }} />
                    <Box sx={{ height: 6, width: '70%', bgcolor: '#edf2f7', borderRadius: 1 }} />
                  </Box>
                ))}
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: '8fr 4fr' },
                  gap: 1.25,
                }}
              >
                <Box sx={{ p: 1.5, borderRadius: 2, border: '1px dashed #e2e8f0', bgcolor: '#f8fafc', minHeight: 72 }}>
                  <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'text.secondary', mb: 1 }}>
                    ACCESS DETAILS
                  </Typography>
                  <Box sx={{ height: 8, width: '100%', bgcolor: '#e2e8f0', borderRadius: 1, mb: 0.75 }} />
                  <Box sx={{ height: 8, width: '92%', bgcolor: '#edf2f7', borderRadius: 1 }} />
                </Box>
                <Box sx={{ p: 1.5, borderRadius: 2, border: '1px dashed #e2e8f0', bgcolor: '#f8fafc', minHeight: 72 }}>
                  <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'text.secondary', mb: 1 }}>
                    PEER COMPARISON
                  </Typography>
                  <Box sx={{ height: 8, width: '80%', bgcolor: '#bfdbfe', borderRadius: 1, mb: 0.75 }} />
                  <Box sx={{ height: 8, width: '92%', bgcolor: '#e2e8f0', borderRadius: 1 }} />
                </Box>
              </Box>
            </Box>
          </Paper>
        </>
      ) : (
        <IdentityPostureDashboard
          identityId={selectedId}
          identityName={selectedDisplayName}
          showRefresh
          showPageHeader
          fillPageBg={false}
          onChangeIdentity={handleBackToSearch}
        />
      )}
    </Box>
  );
}
