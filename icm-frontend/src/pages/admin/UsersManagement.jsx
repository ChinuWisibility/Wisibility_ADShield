import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Box, Typography, Button, IconButton, Chip, Tooltip, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Select, MenuItem, FormControl,
  InputLabel, Alert, CircularProgress, Paper, Stack, Menu, ListItemIcon,
  ListItemText, Divider, InputAdornment,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  PersonAdd, Upload, LockReset, Block, CheckCircle,
  AdminPanelSettings, HistoryToggleOff, Visibility, VisibilityOff, Edit,
  Search, MoreVert,
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import DataTable from '../../components/DataTable';
import StatusChip from '../../components/StatusChip';
import { authAPI, tenantAPI } from '../../services/api';
import { palette } from '../../theme/palette';
import { BRANDING } from '../../constants/branding';
import { useAuth } from '../../contexts/AuthContext';

const ALL_ROLES = [
  { value: 'superAdmin', label: 'System Admin' },
  { value: 'admin', label: 'Org Admin' },
  { value: 'certAdmin', label: 'Cert Admin' },
  { value: 'sodAdmin', label: 'SoD Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'auditAnalytics', label: 'Audit Analytics' },
];

const roleColors = {
  superAdmin: 'error',
  admin: 'error',
  certAdmin: 'warning', sodAdmin: 'info',
  manager: 'primary', viewer: 'default', auditAnalytics: 'secondary',
};

const roleLabels = {
  superAdmin: 'System Admin',
  admin: 'Org Admin',
  certAdmin: 'Cert Admin',
  sodAdmin: 'SoD Admin',
  manager: 'Manager',
  viewer: 'Viewer',
  auditAnalytics: 'Audit Analytics',
};

function getLastLoginMeta(lastLogin) {
  if (!lastLogin) {
    return {
      label: 'Never',
      color: 'default',
      tooltip: 'No successful login recorded yet',
    };
  }

  const date = new Date(lastLogin);
  if (Number.isNaN(date.getTime())) {
    return {
      label: 'Unknown',
      color: 'default',
      tooltip: 'Invalid login timestamp',
    };
  }

  const diffMs = Date.now() - date.getTime();
  const hour = 1000 * 60 * 60;
  const day = hour * 24;
  const week = day * 7;
  const month = day * 30;

  let label = 'Recently';
  let color = 'success';
  if (diffMs >= month) {
    label = `${Math.max(1, Math.floor(diffMs / month))}mo ago`;
    color = 'default';
  } else if (diffMs >= week) {
    label = `${Math.max(1, Math.floor(diffMs / week))}w ago`;
    color = 'warning';
  } else if (diffMs >= day) {
    label = `${Math.max(1, Math.floor(diffMs / day))}d ago`;
    color = 'info';
  } else if (diffMs >= hour) {
    label = `${Math.max(1, Math.floor(diffMs / hour))}h ago`;
    color = 'success';
  }

  return {
    label,
    color,
    tooltip: date.toLocaleString(),
  };
}

// Returns a combined error string listing ALL failing rules at once, or '' if valid.
const validatePassword = (pwd) => {
  if (!pwd) return '';
  const missing = [];
  if (pwd.length < 8) missing.push('at least 8 characters');
  if (!/[A-Z]/.test(pwd)) missing.push('an uppercase letter (A–Z)');
  if (!/[a-z]/.test(pwd)) missing.push('a lowercase letter (a–z)');
  if (!/[0-9]/.test(pwd)) missing.push('a number (0–9)');
  if (missing.length === 0) return '';
  // Combine into a natural-language sentence that covers single + multi-rule failures
  if (missing.length === 1) return `Password must contain ${missing[0]}.`;
  const last = missing.pop();
  return `Password must contain ${missing.join(', ')} and ${last}.`;
};

function UsersManagement() {
  const { isOrgAdmin, user } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [tenants, setTenants] = useState([]);
  const [actionMenu, setActionMenu] = useState({ anchorEl: null, user: null });

  const [roleDialog, setRoleDialog] = useState({ open: false, user: null, role: '' });
  const [resetDialog, setResetDialog] = useState({ open: false, user: null, loading: false });
  const [bulkDialog, setBulkDialog] = useState({ open: false, file: null, result: null, loading: false });
  const [revokeDialog, setRevokeDialog] = useState({ open: false, user: null });
  const [editDialog, setEditDialog] = useState({ open: false, user: null, role: '', department: '', tenantId: '', loading: false });
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [createDialog, setCreateDialog] = useState({
    open: false,
    loading: false,
    error: '',
    form: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      department: '',
      role: 'viewer',
      tenantId: '',
    },
  });

  const ROLES = useMemo(
    () => (isOrgAdmin ? ALL_ROLES.filter((r) => r.value !== 'superAdmin') : ALL_ROLES),
    [isOrgAdmin],
  );

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page: page + 1,
        limit: rowsPerPage,
        search: search || undefined,
        role: roleFilter || undefined,
        status: statusFilter || undefined,
        tenantId: !isOrgAdmin && tenantFilter ? tenantFilter : undefined,
      };
      const res = await authAPI.listUsers(params);
      setUsers(res.data.data.users);
      setTotal(res.data.data.total);
    } catch {
      enqueueSnackbar('Failed to load users', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [enqueueSnackbar, isOrgAdmin, page, roleFilter, rowsPerPage, search, statusFilter, tenantFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => {
    if (isOrgAdmin) {
      setTenants([]);
      return;
    }
    tenantAPI.list().then(res => setTenants(res.data?.data || [])).catch(console.error);
  }, [isOrgAdmin]);

  const activeOnPage = useMemo(
    () => users.filter((u) => Boolean(u?.isActive)).length,
    [users],
  );

  const selectedTenantLabel = useMemo(() => {
    if (isOrgAdmin) {
      const orgTenant = user?.tenantId;
      if (typeof orgTenant === 'object' && orgTenant?.name) return orgTenant.name;
      if (users?.[0]?.tenantId?.name) return users[0].tenantId.name;
      return 'My Tenant';
    }
    if (!tenantFilter) return 'All tenants';
    if (tenantFilter === '__GLOBAL__') return 'Global';
    const tenant = tenants.find((t) => String(t._id) === String(tenantFilter));
    return tenant?.name || 'Filtered tenant';
  }, [isOrgAdmin, tenantFilter, tenants, user?.tenantId, users]);

  const headerTenantContext = useMemo(() => {
    if (isOrgAdmin) return `Tenant: ${selectedTenantLabel}`;
    if (!tenantFilter) return 'Tenant: All';
    return `Tenant: ${selectedTenantLabel}`;
  }, [isOrgAdmin, selectedTenantLabel, tenantFilter]);

  const resolveTenantDisplay = useCallback((row) => {
    const tenantRef = row?.tenantId;

    if (tenantRef && typeof tenantRef === 'object') {
      if (tenantRef.name && tenantRef.code) return `${tenantRef.name} (${tenantRef.code})`;
      if (tenantRef.name) return tenantRef.name;
      if (tenantRef.code) return tenantRef.code;
    }

    if (typeof tenantRef === 'string' && tenantRef.trim()) {
      const tenant = tenants.find((t) => String(t._id) === String(tenantRef));
      if (tenant) return `${tenant.name} (${tenant.code})`;
      return tenantRef;
    }

    if (row?.tenantName) return row.tenantName;

    if (row?.role === 'superAdmin' || row?.role === 'admin') {
      return 'Global';
    }

    if (isOrgAdmin) {
      return selectedTenantLabel;
    }

    return '—';
  }, [isOrgAdmin, selectedTenantLabel, tenants]);

  const openActionMenu = useCallback((event, row) => {
    setActionMenu({ anchorEl: event.currentTarget, user: row });
  }, []);

  const closeActionMenu = useCallback(() => {
    setActionMenu({ anchorEl: null, user: null });
  }, []);

  const handleToggleActive = useCallback(async (user) => {
    try {
      if (user.isActive) {
        await authAPI.deactivateUser(user._id);
        enqueueSnackbar(`${user.email} deactivated`, { variant: 'warning' });
      } else {
        await authAPI.activateUser(user._id);
        enqueueSnackbar(`${user.email} activated`, { variant: 'success' });
      }
      fetchUsers();
    } catch {
      enqueueSnackbar('Action failed', { variant: 'error' });
    }
  }, [enqueueSnackbar, fetchUsers]);

  const handleAssignRole = useCallback(async () => {
    try {
      await authAPI.assignRole(roleDialog.user._id, roleDialog.role);
      enqueueSnackbar(`Role updated to ${roleDialog.role}`, { variant: 'success' });
      setRoleDialog({ open: false, user: null, role: '' });
      fetchUsers();
    } catch {
      enqueueSnackbar('Failed to assign role', { variant: 'error' });
    }
  }, [enqueueSnackbar, fetchUsers, roleDialog.role, roleDialog.user?._id]);

  const handleResetPassword = useCallback(async () => {
    setResetDialog((prev) => ({ ...prev, loading: true }));
    try {
      const res = await authAPI.resetPassword(resetDialog.user._id);
      enqueueSnackbar(
        res.data?.data?.message ||
        'If this account is active, a password reset email has been sent to the user.',
        { variant: 'success' }
      );
      setResetDialog({ open: false, user: null, loading: false });
      fetchUsers();
    } catch (err) {
      enqueueSnackbar(
        err.response?.data?.error?.message || 'Failed to trigger password reset email',
        { variant: 'error' }
      );
      setResetDialog((prev) => ({ ...prev, loading: false }));
    }
  }, [enqueueSnackbar, fetchUsers, resetDialog.user?._id]);

  const handleBulkImport = useCallback(async () => {
    if (!bulkDialog.file) return;
    setBulkDialog((prev) => ({ ...prev, loading: true }));
    try {
      const defaultTenantId =
        !isOrgAdmin && tenantFilter && tenantFilter !== '__GLOBAL__'
          ? tenantFilter
          : undefined;
      const res = await authAPI.bulkImportUsers(bulkDialog.file, { defaultTenantId });
      const result = res.data?.data || { created: 0, failed: 0, errors: [] };
      setBulkDialog((prev) => ({ ...prev, result, loading: false }));
      if (result.created > 0) {
        enqueueSnackbar(`Import complete: ${result.created} created`, {
          variant: result.failed > 0 ? 'warning' : 'success',
        });
        fetchUsers();
      } else {
        enqueueSnackbar(
          result.failed > 0
            ? `Import failed: 0 created, ${result.failed} failed`
            : 'Import completed with 0 users created',
          { variant: 'warning' },
        );
      }
    } catch (err) {
      setBulkDialog((prev) => ({ ...prev, loading: false }));
      enqueueSnackbar(err.response?.data?.error?.message || 'Import failed', { variant: 'error' });
    }
  }, [bulkDialog.file, enqueueSnackbar, fetchUsers, isOrgAdmin, tenantFilter]);

  const handleRevokeSessions = useCallback(async () => {
    try {
      const res = await authAPI.revokeAllSessions(revokeDialog.user._id);
      const count = Number(res.data?.data?.revokedCount || 0);
      if (count <= 0) {
        enqueueSnackbar('No active sessions to revoke for this user.', { variant: 'warning' });
      } else {
        enqueueSnackbar(
          count === 1 ? '1 session revoked' : `${count} sessions revoked`,
          { variant: 'success' },
        );
      }
      setRevokeDialog({ open: false, user: null });
    } catch {
      enqueueSnackbar('Failed to revoke sessions', { variant: 'error' });
    }
  }, [enqueueSnackbar, revokeDialog.user?._id]);

  const handleEditUser = useCallback(async () => {
    setEditDialog(prev => ({ ...prev, loading: true }));
    try {
      const { user, role, department, tenantId } = editDialog;

      const payload = isOrgAdmin
        ? { department }
        : {
          role,
          department,
          tenantId: role === 'superAdmin' ? null : (tenantId || null),
        };

      await authAPI.updateUser(user._id, payload);

      enqueueSnackbar('User updated successfully', { variant: 'success' });
      setEditDialog({ open: false, user: null, role: '', department: '', tenantId: '', loading: false });
      fetchUsers();
    } catch (err) {
      enqueueSnackbar(err.response?.data?.error?.message || 'Failed to update user', { variant: 'error' });
      setEditDialog(prev => ({ ...prev, loading: false }));
    }
  }, [editDialog, enqueueSnackbar, fetchUsers, isOrgAdmin]);

  const handleCreateUserChange = useCallback((field, value) => {
    setCreateDialog((prev) => ({
      ...prev,
      form: { ...prev.form, [field]: value },
    }));
  }, []);

  const handleOpenCreateDialog = useCallback(() => {
    setCreateDialog({
      open: true,
      loading: false,
      error: '',
      form: {
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        department: '',
        role: 'viewer',
        tenantId: '',
      },
    });
  }, []);

  const handleCloseCreateDialog = useCallback(() => {
    setCreateDialog((prev) => ({ ...prev, open: false }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearch('');
    setRoleFilter('');
    setStatusFilter('');
    setTenantFilter('');
    setPage(0);
  }, []);

  const openEditDialogForRow = useCallback((row) => {
    setEditDialog({
      open: true,
      user: row,
      role: row.role,
      department: row.department || '',
      tenantId: row.tenantId?._id || '',
      loading: false,
    });
  }, []);

  const handleCreateUser = useCallback(async (e) => {
    e.preventDefault();
    if (createDialog.loading) return;
    setCreateDialog((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const { firstName, lastName, email, password, department, role, tenantId } = createDialog.form;
      const actorTenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;
      const payload = isOrgAdmin
        ? { firstName, lastName, email, password, department, role: 'viewer', tenantId: actorTenantId || undefined }
        : { firstName, lastName, email, password, department, role, tenantId };
      await authAPI.register(payload);
      enqueueSnackbar(`User ${email} created successfully`, { variant: 'success' });
      setCreateDialog((prev) => ({ ...prev, open: false, loading: false }));
      fetchUsers();
    } catch (err) {
      const validationMsg = Array.isArray(err.response?.data?.errors)
        ? err.response.data.errors.map((x) => x?.message).filter(Boolean).join(', ')
        : '';
      const apiMsg =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        validationMsg ||
        'Failed to create user';
      setCreateDialog((prev) => ({
        ...prev,
        loading: false,
        error: apiMsg,
      }));
    }
  }, [createDialog.form, enqueueSnackbar, fetchUsers, isOrgAdmin, user?.tenantId]);

  const columns = useMemo(() => [
    {
      field: 'name', headerName: 'Name', minWidth: 220,
      renderCell: (row) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={700} noWrap>
            {row.firstName} {row.lastName}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {row.email}
          </Typography>
        </Box>
      ),
    },
    {
      field: 'role', headerName: 'Role', minWidth: 130,
      renderCell: (row) => (
        <Chip
          label={roleLabels[row.role] || row.role}
          size="small"
          color={roleColors[row.role] || 'default'}
          sx={{ fontWeight: 700, fontSize: '0.69rem', borderRadius: 1.2 }}
        />
      ),
    },
    {
      field: 'department',
      headerName: 'Department',
      minWidth: 130,
      renderCell: (row) => row.department || '—',
    },
    {
      field: 'tenant', headerName: 'Tenant', minWidth: 150,
      renderCell: (row) => resolveTenantDisplay(row),
    },
    {
      field: 'isActive', headerName: 'Status', minWidth: 110,
      renderCell: (row) => <StatusChip status={row.isActive ? 'active' : 'disabled'} />,
    },
    {
      field: 'lastLogin',
      headerName: 'Last Login',
      minWidth: 130,
      renderCell: (row) => {
        const loginMeta = getLastLoginMeta(row.lastLogin);
        return (
          <Tooltip title={loginMeta.tooltip}>
            <Chip
              label={loginMeta.label}
              color={loginMeta.color}
              size="small"
              variant={loginMeta.color === 'default' ? 'outlined' : 'filled'}
              sx={{ fontWeight: 600 }}
            />
          </Tooltip>
        );
      },
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 86,
      sortable: false,
      renderCell: (row) => (
        <IconButton
          size="small"
          aria-label={`Open actions for ${row.email}`}
          onClick={(event) => openActionMenu(event, row)}
        >
          <MoreVert fontSize="small" />
        </IconButton>
      ),
    },
  ], [openActionMenu, resolveTenantDisplay]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, md: 2.4 },
          borderRadius: 2.5,
          borderColor: alpha(palette.brand.primary, 0.18),
          background: `linear-gradient(135deg, ${alpha(palette.brand.primary, 0.12)} 0%, ${alpha(palette.brand.primary, 0.05)} 35%, ${palette.bg.secondary} 100%)`,
          boxShadow: `0 10px 24px ${alpha(palette.brand.primary, 0.08)}`,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="overline" sx={{ color: 'primary.main', letterSpacing: '0.08em', fontWeight: 800 }}>
              Admin Console
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
              Users & Roles
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>
              {BRANDING.name} {BRANDING.product} &mdash; Manage platform users, assign roles, and control access ({headerTenantContext})
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button
              variant="outlined"
              startIcon={<Upload />}
              onClick={() => setBulkDialog({ open: true, file: null, result: null, loading: false })}
            >
              Bulk Import
            </Button>
            <Button variant="contained" startIcon={<PersonAdd />} onClick={handleOpenCreateDialog}>
              Add User
            </Button>
          </Stack>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
          <Chip label={`Results: ${total}`} color="primary" sx={{ fontWeight: 700 }} />
          <Chip label={`Active on page: ${activeOnPage}`} color="success" variant="outlined" sx={{ fontWeight: 700 }} />
          <Chip label={`Tenant: ${selectedTenantLabel}`} variant="outlined" sx={{ fontWeight: 700 }} />
        </Stack>
      </Paper>

      <Paper
        variant="outlined"
        sx={{
          p: 1.8,
          borderRadius: 2,
          borderColor: alpha(palette.brand.primary, 0.16),
          background: `linear-gradient(180deg, ${alpha(palette.brand.primary, 0.035)} 0%, ${palette.bg.secondary} 55%)`,
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} useFlexGap flexWrap="wrap" alignItems="stretch">
          <TextField
            size="small"
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            sx={{ minWidth: { xs: '100%', md: 280 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search sx={{ fontSize: 18, color: 'text.secondary' }} />
                </InputAdornment>
              ),
            }}
          />

          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 180 } }}>
            <InputLabel>Role</InputLabel>
            <Select
              label="Role"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(0);
              }}
            >
              <MenuItem value="">All roles</MenuItem>
              {ROLES.map((roleOption) => (
                <MenuItem key={roleOption.value} value={roleOption.value}>
                  {roleOption.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 160 } }}>
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(0);
              }}
            >
              <MenuItem value="">All statuses</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="disabled">Disabled</MenuItem>
            </Select>
          </FormControl>

          {!isOrgAdmin && (
            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 220 } }}>
              <InputLabel>Tenant</InputLabel>
              <Select
                label="Tenant"
                value={tenantFilter}
                onChange={(e) => {
                  setTenantFilter(e.target.value);
                  setPage(0);
                }}
              >
                <MenuItem value="">All tenants</MenuItem>
                <MenuItem value="__GLOBAL__">Global (No Tenant)</MenuItem>
                {tenants.map((tenant) => (
                  <MenuItem key={tenant._id} value={tenant._id}>
                    {tenant.name} ({tenant.code})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <Button
            variant="text"
            onClick={handleClearFilters}
            sx={{ alignSelf: { xs: 'stretch', md: 'center' }, textTransform: 'none', fontWeight: 700 }}
          >
            Clear filters
          </Button>
        </Stack>
      </Paper>

      <DataTable
        title="User Directory"
        columns={columns}
        rows={users}
        loading={loading}
        onRefresh={fetchUsers}
        searchable={false}
        serverPagination
        totalCount={total}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={setPage}
        onRowsPerPageChange={(nextRowsPerPage) => {
          setRowsPerPage(nextRowsPerPage);
          setPage(0);
        }}
        emptyMessage="No users found"
      />

      <Menu
        anchorEl={actionMenu.anchorEl}
        open={Boolean(actionMenu.anchorEl)}
        onClose={closeActionMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            if (!actionMenu.user) return;
            openEditDialogForRow(actionMenu.user);
            closeActionMenu();
          }}
        >
          <ListItemIcon><Edit fontSize="small" /></ListItemIcon>
          <ListItemText>Edit User</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!actionMenu.user) return;
            setRoleDialog({ open: true, user: actionMenu.user, role: actionMenu.user.role });
            closeActionMenu();
          }}
        >
          <ListItemIcon><AdminPanelSettings fontSize="small" /></ListItemIcon>
          <ListItemText>Change Role</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!actionMenu.user) return;
            setResetDialog({ open: true, user: actionMenu.user, loading: false });
            closeActionMenu();
          }}
        >
          <ListItemIcon><LockReset fontSize="small" /></ListItemIcon>
          <ListItemText>Reset Password</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            if (!actionMenu.user) return;
            const confirmationText = actionMenu.user.isActive
              ? `Deactivate ${actionMenu.user.email}? They will not be able to log in until reactivated.`
              : `Activate ${actionMenu.user.email}?`;
            if (!window.confirm(confirmationText)) return;
            handleToggleActive(actionMenu.user);
            closeActionMenu();
          }}
        >
          <ListItemIcon>
            {actionMenu.user?.isActive ? (
              <Block fontSize="small" sx={{ color: 'error.main' }} />
            ) : (
              <CheckCircle fontSize="small" sx={{ color: 'success.main' }} />
            )}
          </ListItemIcon>
          <ListItemText>{actionMenu.user?.isActive ? 'Deactivate User' : 'Activate User'}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!actionMenu.user) return;
            setRevokeDialog({ open: true, user: actionMenu.user });
            closeActionMenu();
          }}
        >
          <ListItemIcon><HistoryToggleOff fontSize="small" /></ListItemIcon>
          <ListItemText>Revoke Sessions</ListItemText>
        </MenuItem>
      </Menu>

      <Dialog open={roleDialog.open} onClose={() => setRoleDialog({ open: false, user: null, role: '' })} maxWidth="xs" fullWidth>
        <DialogTitle>Assign Role</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Change role for <strong>{roleDialog.user?.email}</strong>
          </Typography>
          <FormControl fullWidth size="small">
            <InputLabel>Role</InputLabel>
            <Select value={roleDialog.role} label="Role"
              onChange={(e) => setRoleDialog((prev) => ({ ...prev, role: e.target.value }))}>
              {ROLES.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRoleDialog({ open: false, user: null, role: '' })}>Cancel</Button>
          <Button variant="contained" onClick={handleAssignRole}>Assign</Button>
        </DialogActions>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog
        open={editDialog.open}
        onClose={editDialog.loading ? undefined : () => setEditDialog(prev => ({ ...prev, open: false }))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Edit User Profile</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Editing <strong>{editDialog.user?.email}</strong>
            </Typography>

            {!isOrgAdmin && (
              <FormControl fullWidth size="small">
                <InputLabel>Role</InputLabel>
                <Select
                  label="Role"
                  value={editDialog.role || ''}
                  onChange={(e) => setEditDialog(prev => ({ ...prev, role: e.target.value }))}
                >
                  {ROLES.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
                </Select>
              </FormControl>
            )}

            <TextField
              label="Department"
              fullWidth
              size="small"
              value={editDialog.department || ''}
              onChange={(e) => setEditDialog(prev => ({ ...prev, department: e.target.value }))}
            />

            {!isOrgAdmin && editDialog.role !== 'superAdmin' && (
              <FormControl fullWidth size="small" required>
                <InputLabel>Tenant</InputLabel>
                <Select
                  label="Tenant"
                  value={editDialog.tenantId || ''}
                  onChange={(e) => setEditDialog(prev => ({ ...prev, tenantId: e.target.value }))}
                >
                  <MenuItem value=""><em>Select Tenant...</em></MenuItem>
                  {tenants.map((t) => (
                    <MenuItem key={t._id} value={t._id}>
                      {t.name} ({t.code})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {isOrgAdmin && (
              <Alert severity="info">
                Org Admin is tenant-scoped. Role and tenant assignment are managed by System Admin.
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setEditDialog(prev => ({ ...prev, open: false }))}
            disabled={editDialog.loading}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleEditUser}
            disabled={editDialog.loading || (!isOrgAdmin && editDialog.role !== 'superAdmin' && !editDialog.tenantId)}
          >
            {editDialog.loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetDialog.open} onClose={resetDialog.loading ? undefined : () => setResetDialog({ open: false, user: null, loading: false })} maxWidth="xs" fullWidth>
        <DialogTitle>Reset Password</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Reset password for <strong>{resetDialog.user?.email}</strong>? They will receive a
            secure email with a link to choose a new password. No temporary password will be shown
            here.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setResetDialog({ open: false, user: null, loading: false })}
            disabled={resetDialog.loading}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleResetPassword}
            disabled={resetDialog.loading}
            startIcon={resetDialog.loading ? <CircularProgress size={16} /> : <LockReset />}
          >
            {resetDialog.loading ? 'Sending...' : 'Send reset email'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={bulkDialog.open} onClose={() => setBulkDialog({ open: false, file: null, result: null, loading: false })} maxWidth="sm" fullWidth>
        <DialogTitle>Bulk Import Users</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Upload a CSV with columns:{' '}
            <code>firstName,lastName,email,role,department,phoneNumber</code>
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
            Required: firstName, lastName, email. Optional: role, department, phoneNumber.
            {!isOrgAdmin && (
              <>
                {' '}For tenant roles, add optional <code>tenantId</code> / <code>tenantCode</code>,
                or select a Tenant filter before importing
                {tenantFilter && tenantFilter !== '__GLOBAL__' ? ' (current filter will be applied).' : '.'}
              </>
            )}
          </Typography>
          <Button variant="outlined" component="label" fullWidth sx={{ mb: 2 }}>
            {bulkDialog.file ? bulkDialog.file.name : 'Choose CSV File'}
            <input type="file" hidden accept=".csv"
              onChange={(e) => setBulkDialog((prev) => ({ ...prev, file: e.target.files[0] }))} />
          </Button>
          {bulkDialog.result && (
            <Alert severity={bulkDialog.result.failed > 0 ? 'warning' : 'success'}>
              Created: {bulkDialog.result.created} | Failed: {bulkDialog.result.failed}
              {bulkDialog.result.errors?.length > 0 && (
                <Box sx={{ mt: 1, maxHeight: 120, overflow: 'auto' }}>
                  {bulkDialog.result.errors.map((e, i) => (
                    <Typography key={i} variant="caption" display="block">{e.email}: {e.reason}</Typography>
                  ))}
                </Box>
              )}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkDialog({ open: false, file: null, result: null, loading: false })}>Close</Button>
          {!bulkDialog.result && (
            <Button variant="contained" onClick={handleBulkImport}
              disabled={!bulkDialog.file || bulkDialog.loading}
              startIcon={bulkDialog.loading ? <CircularProgress size={16} /> : <Upload />}>
              Import
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Revoke Sessions Dialog */}
      <Dialog open={revokeDialog.open} onClose={() => setRevokeDialog({ open: false, user: null })} maxWidth="xs" fullWidth>
        <DialogTitle>Revoke All Sessions</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.25 }}>
            Force logout <strong>{revokeDialog.user?.email}</strong> from all active sessions on every device.
          </Typography>
          <Alert severity="warning" variant="outlined">
            The user can sign in again immediately using valid credentials.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeDialog({ open: false, user: null })}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleRevokeSessions}>Revoke Sessions</Button>
        </DialogActions>
      </Dialog>

      {/* Create User Dialog */}
      <Dialog
        open={createDialog.open}
        onClose={createDialog.loading ? undefined : handleCloseCreateDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create User</DialogTitle>
        <DialogContent>
          {createDialog.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {createDialog.error}
            </Alert>
          )}
          <Box id="create-user-form" component="form" onSubmit={handleCreateUser} sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="First Name"
                fullWidth
                size="small"
                required
                value={createDialog.form.firstName}
                onChange={(e) => handleCreateUserChange('firstName', e.target.value)}
              />
              <TextField
                label="Last Name"
                fullWidth
                size="small"
                required
                value={createDialog.form.lastName}
                onChange={(e) => handleCreateUserChange('lastName', e.target.value)}
              />
            </Box>
            <TextField
              label="Email"
              type="email"
              fullWidth
              size="small"
              required
              value={createDialog.form.email}
              onChange={(e) => handleCreateUserChange('email', e.target.value)}
            />
            <TextField
              label="Temporary Password"
              type={showCreatePassword ? 'text' : 'password'}
              fullWidth
              size="small"
              required
              value={createDialog.form.password}
              onChange={(e) => handleCreateUserChange('password', e.target.value)}
              error={createDialog.form.password.length > 0 && !!validatePassword(createDialog.form.password)}
              helperText={
                createDialog.form.password.length > 0 && validatePassword(createDialog.form.password)
                  ? validatePassword(createDialog.form.password)
                  : createDialog.form.password.length >= 8
                    ? '✓ Password meets all requirements.'
                    : 'Min 8 chars - At least 1 uppercase, 1 lowercase & 1 number required'
              }
              FormHelperTextProps={{
                sx: {
                  color: createDialog.form.password.length > 0 && !validatePassword(createDialog.form.password)
                    ? 'success.main'
                    : undefined,
                },
              }}
              InputProps={{
                endAdornment: (
                  <IconButton
                    size="small"
                    onClick={() => setShowCreatePassword((prev) => !prev)}
                    edge="end"
                  >
                    {showCreatePassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                ),
              }}
            />
            <TextField
              label="Department"
              fullWidth
              size="small"
              value={createDialog.form.department}
              onChange={(e) => handleCreateUserChange('department', e.target.value)}
            />
            {!isOrgAdmin && (
              <FormControl fullWidth size="small">
                <InputLabel>Role</InputLabel>
                <Select
                  label="Role"
                  value={createDialog.form.role}
                  onChange={(e) => handleCreateUserChange('role', e.target.value)}
                >
                  {ROLES.map((r) => (
                    <MenuItem key={r.value} value={r.value}>
                      {r.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {!isOrgAdmin && createDialog.form.role !== 'superAdmin' && (
              <FormControl fullWidth size="small" required>
                <InputLabel>Tenant</InputLabel>
                <Select
                  label="Tenant"
                  value={createDialog.form.tenantId}
                  onChange={(e) => handleCreateUserChange('tenantId', e.target.value)}
                >
                  <MenuItem value=""><em>Select Tenant...</em></MenuItem>
                  {tenants.map((t) => (
                    <MenuItem key={t._id} value={t._id}>
                      {t.name} ({t.code})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {isOrgAdmin && (
              <Alert severity="info">
                New users are created within your tenant. Role and tenant assignment are controlled by System Admin.
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCloseCreateDialog} disabled={createDialog.loading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            form="create-user-form"
            type="submit"
            disabled={
              createDialog.loading
              || !createDialog.form.password
              || !!validatePassword(createDialog.form.password)
              || (!isOrgAdmin && createDialog.form.role !== 'superAdmin' && !createDialog.form.tenantId)
            }
            startIcon={createDialog.loading ? <CircularProgress size={16} /> : <PersonAdd />}
          >
            {createDialog.loading ? 'Creating...' : 'Create User'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default memo(UsersManagement);
