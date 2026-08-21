/**
 * Identity Graph Explorer - Search page.
 *
 * First step: search/select an identity.
 * Second step: standalone mindmap at /identities/mindmap/:identityId
 */

import React, { useState } from 'react';
import { Box, Typography, Autocomplete, TextField, CircularProgress } from '@mui/material';
import { AccountTree, Search as SearchIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { identityAPI } from '../../services/api';
import { palette } from '../../theme/palette';
import { useAuth } from '../../contexts/AuthContext';
import { prefetchIdentityGraph } from './catalog/identityCatalogQueries';

export default function IdentityMindmapSearch() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedIdentity, setSelectedIdentity] = useState(null);

  const handleSearchChange = async (event, newInputValue) => {
    const q = String(newInputValue || '').trim();
    if (q.length > 2) {
      setSearching(true);
      try {
        const params = { search: q, page: 0, limit: 50 };
        if (tenantId) params.tenantId = tenantId;
        const res = await identityAPI.list(params);
        const rows = res.data?.data || [];
        const byId = new Map();
        for (const row of rows) {
          if (row?._id != null) byId.set(String(row._id), row);
        }
        setOptions([...byId.values()]);
      } catch {
        setOptions([]);
      } finally {
        setSearching(false);
      }
    } else {
      setOptions([]);
    }
  };

  const handleIdentitySelect = (event, newValue) => {
    setSelectedIdentity(newValue);
    if (newValue && newValue._id) {
      prefetchIdentityGraph(queryClient, newValue._id);
      navigate(`/identities/mindmap/${newValue._id}`, {
        state: { identityLabel: newValue.displayName || 'Unknown' },
      });
    }
  };

  return (
    <Box
      sx={{
        height: 'calc(100vh - 64px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#f8fafc',
        px: 2,
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 680, textAlign: 'center' }}>
        <Box
          sx={{
            mx: 'auto',
            width: 52,
            height: 52,
            borderRadius: 2.5,
            bgcolor: 'rgba(37,99,235,0.10)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mb: 2,
          }}
        >
          <AccountTree sx={{ color: palette.brand?.primary || '#2563eb' }} />
        </Box>
        <Typography sx={{ fontSize: '2.25rem', fontWeight: 800, color: '#0f172a', letterSpacing: -0.2 }}>
          Identity Graph Explorer
        </Typography>
        <Typography sx={{ mt: 0.75, fontSize: '1.05rem', color: 'text.secondary' }}>
          Search for an identity by name, email, or username.
        </Typography>

        <Box sx={{ mt: 3.25, mx: 'auto', maxWidth: 560 }}>
          <Autocomplete
            value={selectedIdentity}
            options={options}
            getOptionLabel={(option) => `${option.displayName || 'Unknown'}`}
            isOptionEqualToValue={(a, b) => Boolean(a && b && String(a._id) === String(b._id))}
            filterOptions={(opts) => opts}
            onInputChange={handleSearchChange}
            onChange={handleIdentitySelect}
            loading={searching}
            fullWidth
            slotProps={{
              popper: {
                placement: 'bottom-start',
                modifiers: [{ name: 'flip', enabled: false }],
              },
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Search by name or email address…"
                variant="outlined"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <Box sx={{ display: 'flex', alignItems: 'center', pl: 0.75, pr: 0.5, color: 'text.disabled' }}>
                      <SearchIcon sx={{ fontSize: 20 }} />
                    </Box>
                  ),
                  sx: {
                    bgcolor: '#ffffff',
                    borderRadius: 2,
                    boxShadow: '0 6px 18px rgba(15, 23, 42, 0.06)',
                    '& .MuiInputBase-input': { py: 1.45, fontSize: '1.05rem' },
                  },
                  endAdornment: (
                    <React.Fragment>
                      {searching ? <CircularProgress color="inherit" size={22} /> : null}
                      {params.InputProps.endAdornment}
                    </React.Fragment>
                  ),
                }}
              />
            )}
          />
        </Box>
      </Box>
    </Box>
  );
}

