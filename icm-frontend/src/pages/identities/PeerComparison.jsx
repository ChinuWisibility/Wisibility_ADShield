/**
 * Peer Access Comparison — standalone page.
 * Select a user, then run comparison on this same page (does not redirect to the catalog).
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  Box, Typography, Paper, Autocomplete, TextField, CircularProgress, Button,
} from '@mui/material';
import { ArrowBack, CompareArrows } from '@mui/icons-material';
import { identityAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  IDENTITY_PICKER_MIN_SEARCH_LEN,
  refineIdentityPickerResults,
} from '../../utils/identityPickerSearch';
import PeerComparisonPanel from './catalog/PeerComparisonPanel';

export default function PeerComparison() {
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [identitySearch, setIdentitySearch] = useState('');
  const [identityOptions, setIdentityOptions] = useState([]);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [selectedIdentity, setSelectedIdentity] = useState(null);

  const searchDebounceRef = useRef(null);
  const searchSeqRef = useRef(0);
  const searchAbortRef = useRef(null);

  const handleIdentityInputChange = useCallback((_, value, reason) => {
    if (reason === 'reset') return;

    setIdentitySearch(value);
    clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();

    const q = String(value || '').trim();
    if (!q || q.length < IDENTITY_PICKER_MIN_SEARCH_LEN) {
      setIdentityOptions([]);
      setIdentityLoading(false);
      return;
    }

    setIdentityOptions([]);
    const seq = ++searchSeqRef.current;

    searchDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      setIdentityLoading(true);
      try {
        const params = { search: q, page: 0, limit: 50 };
        if (tenantId) params.tenantId = tenantId;
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
    }, 300);
  }, [tenantId]);

  const handleIdentitySelect = useCallback((_, identity) => {
    setSelectedIdentity(identity || null);
  }, []);

  const handleBackToSearch = useCallback(() => {
    searchAbortRef.current?.abort();
    clearTimeout(searchDebounceRef.current);
    setSelectedIdentity(null);
    setIdentitySearch('');
    setIdentityOptions([]);
  }, []);

  const selectedDisplayName =
    selectedIdentity?.displayName ||
    [selectedIdentity?.firstName, selectedIdentity?.lastName].filter(Boolean).join(' ') ||
    selectedIdentity?.email ||
    '';

  if (selectedIdentity) {
    return (
      <Box sx={{ width: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          <Button
            startIcon={<ArrowBack />}
            onClick={handleBackToSearch}
            sx={{ textTransform: 'none', color: 'text.secondary' }}
          >
            Back
          </Button>
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
              Peer Access Comparison
            </Typography>
            {selectedDisplayName && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {selectedDisplayName}
              </Typography>
            )}
          </Box>
        </Box>

        <PeerComparisonPanel identity={selectedIdentity} />
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
          Peer Access Comparison
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Peer-based access intelligence — see what access is normal for similar users, then how this person aligns.
        </Typography>
      </Box>

      <Paper elevation={0} sx={{ p: 3, mb: 3, border: '1.5px solid #e2e8f0', borderRadius: 2 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'text.secondary', display: 'block', mb: 0.5 }}>
          Target Identity
        </Typography>
        <Autocomplete
          id="peer-comparison-identity-search"
          options={identityOptions}
          loading={identityLoading}
          value={null}
          onChange={handleIdentitySelect}
          onInputChange={handleIdentityInputChange}
          inputValue={identitySearch}
          filterOptions={(opts) => opts}
          getOptionLabel={(o) => o.displayName || o.email || ''}
          isOptionEqualToValue={(a, b) => (a?._id || a?.id) === (b?._id || b?.id)}
          renderOption={(props, o) => (
            <Box component="li" {...props} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start !important', py: '8px !important' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {o.displayName || o.email}
              </Typography>
              {(o.department || o.title) && (
                <Typography variant="caption" color="text.secondary">
                  {[o.title, o.department].filter(Boolean).join(' · ')}
                </Typography>
              )}
            </Box>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Search by name, email, or employee ID…"
              size="small"
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {identityLoading ? <CircularProgress size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />
      </Paper>

      <Paper elevation={0} sx={{ p: 6, textAlign: 'center', border: '1.5px dashed #e2e8f0', borderRadius: 2 }}>
        <CompareArrows sx={{ fontSize: 56, color: '#cbd5e1', mb: 2 }} />
        <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 600 }}>
          Select an identity and run a comparison
        </Typography>
        <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
          We compare this person to peers with the same department and role to show expected access, unusual access, and common access they may be missing.
        </Typography>
      </Paper>
    </Box>
  );
}
