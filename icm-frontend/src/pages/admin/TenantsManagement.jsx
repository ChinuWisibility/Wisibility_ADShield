import React, { useState, useEffect } from 'react';
import { 
  Box, Typography, Button, Paper, Table, TableBody, TableCell, TableContainer, 
  TableHead, TableRow, CircularProgress, Dialog, DialogTitle, DialogContent, 
  DialogActions, TextField, MenuItem, Chip
} from '@mui/material';
import { Add } from '@mui/icons-material';
import { tenantAPI } from '../../services/api';

const SUBSCRIPTION_TIERS = ['core', 'premium', 'enterprise'];

export default function TenantsManagement() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [openModal, setOpenModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  const initialFormState = { name: '', code: '', subscriptionTier: 'core' };
  const [formData, setFormData] = useState(initialFormState);

  const fetchTenants = async () => {
    try {
      setLoading(true);
      const response = await tenantAPI.list();
      if (response.data?.success) setTenants(response.data.data);
    } catch (error) {
      console.error("Failed to fetch tenants:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTenants(); }, []);

  const handleOpen = () => setOpenModal(true);
  const handleClose = () => {
    setOpenModal(false);
    setFormData(initialFormState);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.code) return alert("Name and Code are required!");

    try {
      setSubmitting(true);
      await tenantAPI.create(formData);
      handleClose();
      fetchTenants();
    } catch (error) {
      console.error("Failed to create tenant:", error);
      alert("Error creating tenant. Check console.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Tenants Management</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={handleOpen}>Add Tenant</Button>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e0e0e0' }}>
          <Table>
            <TableHead sx={{ backgroundColor: '#f5f5f5' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Code</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Tier</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tenants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>No tenants found. Click "Add Tenant" to create one.</TableCell>
                </TableRow>
              ) : (
                tenants.map((t) => (
                  <TableRow key={t._id} hover>
                    <TableCell sx={{ fontWeight: 500 }}>{t.name}</TableCell>
                    <TableCell>{t.code}</TableCell>
                    <TableCell sx={{ textTransform: 'capitalize' }}>
                      <Chip label={t.subscriptionTier} size="small" color={t.subscriptionTier === 'enterprise' ? 'primary' : 'default'} />
                    </TableCell>
                    <TableCell>
                      <Chip label={t.isActive ? 'Active' : 'Inactive'} size="small" color={t.isActive ? 'success' : 'error'} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={openModal} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Register New Tenant</DialogTitle>
        <DialogContent dividers sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField 
            name="name" label="Tenant Name" value={formData.name} onChange={handleChange} 
            fullWidth required size="small" 
          />
          <TextField 
            name="code" label="Tenant Code (Unique)" value={formData.code} onChange={handleChange} 
            fullWidth required size="small" 
          />
          <TextField 
            select name="subscriptionTier" label="Subscription Tier" value={formData.subscriptionTier} 
            onChange={handleChange} fullWidth size="small"
          >
            {SUBSCRIPTION_TIERS.map(tier => <MenuItem key={tier} value={tier}>{tier.toUpperCase()}</MenuItem>)}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleClose} sx={{ color: 'text.secondary', fontWeight: 600 }}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={submitting} sx={{ fontWeight: 600 }}>
            {submitting ? 'Creating...' : 'Create Tenant'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
