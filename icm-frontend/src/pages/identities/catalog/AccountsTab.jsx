import React, { useState } from 'react';
import {
  Box, Typography, Button, Card, CardContent, Grid, Chip, Paper, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, Select, MenuItem,
  FormControl, InputLabel, TextField, Tooltip, FormControlLabel, Switch,
  Alert, Divider,
} from '@mui/material';
import {
  BusinessCenter, Link as LinkIcon, LinkOff, AccountTree, Close,
} from '@mui/icons-material';
import { identityAPI, applicationAPI } from '../../../services/api';
import { palette } from '../../../theme/palette';
import { resolveApplicationIconSrc } from '../../../components/applications/ApplicationIconPicker';
import { alpha } from '@mui/material/styles';
import {
  accountToPriorityKeyValues,
  getAccountDisplayEntitlements,
  humanizeFieldKey,
  shouldRenderAsTokenList,
} from './identityDetailHelpers';
import CatalogSection from './CatalogSection';
import { CATALOG } from './catalogTheme';

function AccountAppIcon({ name, icon, color, size = 36 }) {
  const src = resolveApplicationIconSrc(icon);
  const initial = String(name || '?').charAt(0).toUpperCase();
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: 1.25,
        border: `1px solid ${palette.border?.default || CATALOG.border}`,
        bgcolor: src ? '#fff' : (color || alpha(CATALOG.accent || palette.brand.primary, 0.12)),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        fontSize: size * 0.36,
        fontWeight: 800,
        p: src ? 0.35 : 0,
      }}
    >
      {src ? (
        <Box
          component="img"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <Box sx={{ color: color || CATALOG.accentDeep || palette.brand.primary }}>{initial}</Box>
      )}
    </Box>
  );
}

function AccountSourceValueCell({ fieldKey, value }) {
  if (value === '' || value == null) {
    return (
      <Typography variant="body2" color="text.disabled">
        —
      </Typography>
    );
  }
  const str = String(value);
  if (shouldRenderAsTokenList(fieldKey, str)) {
    const parts = str.split(/[|;]/).map((s) => s.trim()).filter(Boolean);
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, py: 0.25 }}>
        {parts.map((p) => (
          <Chip key={p} label={p} size="small" variant="outlined" sx={{ fontWeight: 600, borderColor: palette.border?.default || 'divider' }} />
        ))}
      </Box>
    );
  }
  return (
    <Typography variant="body2" component="div" sx={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13 }}>
      {str}
    </Typography>
  );
}

export default function AccountsTab({
  identityId,
  accounts,
  tenantId,
  onRefresh,
  showToast,
}) {
  const [applications, setApplications] = useState([]);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkForm, setLinkForm] = useState({ applicationId: '', accountId: '', accountName: '' });
  const [accountSourceModal, setAccountSourceModal] = useState({
    open: false,
    title: '',
    entries: [],
  });
  const [linkActiveSaving, setLinkActiveSaving] = useState(null);

  const handleOpenLinkModal = async () => {
    try {
      if (applications.length === 0) {
        const appRes = await applicationAPI.list({ tenantId });
        setApplications(appRes.data?.data || []);
      }
      setLinkForm({ applicationId: '', accountId: '', accountName: '' });
      setLinkModalOpen(true);
    } catch {
      showToast('Failed to load applications', 'error');
    }
  };

  const handleLinkAccount = async () => {
    if (!linkForm.applicationId || !linkForm.accountId) {
      return showToast('Application and Account ID are required', 'warning');
    }
    try {
      await identityAPI.linkAccount(identityId, linkForm);
      showToast('Account successfully linked to user!', 'success');
      setLinkModalOpen(false);
      onRefresh();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to link account', 'error');
    }
  };

  const handleUnlinkAccount = async (linkId, appName) => {
    if (!window.confirm(`Are you sure you want to unlink the ${appName} account? This will turn it into an Orphan Account.`)) return;
    try {
      await identityAPI.unlinkAccount(linkId);
      showToast('Account unlinked successfully.', 'success');
      onRefresh();
    } catch {
      showToast('Failed to unlink account', 'error');
    }
  };

  const handleOpenAccountSourceCsv = (acc) => {
    const entries = accountToPriorityKeyValues(acc.accountData);
    setAccountSourceModal({
      open: true,
      title: acc.applicationName || 'Application',
      entries,
    });
  };

  const handleToggleAccountLink = async (acc, nextActive) => {
    setLinkActiveSaving(acc.linkId);
    try {
      await identityAPI.setAccountLinkActive(acc.linkId, {
        isActive: nextActive,
        consolidatedLinkIds: acc.consolidatedLinkIds?.length ? acc.consolidatedLinkIds : [acc.linkId],
      });
      showToast(nextActive ? 'Account link enabled.' : 'Account link disabled.', 'success');
      await onRefresh();
    } catch (err) {
      showToast(err.response?.data?.message || err.message || 'Could not update link', 'error');
    } finally {
      setLinkActiveSaving(null);
    }
  };

  return (
    <CatalogSection
      eyebrow="Application access"
      title="Connected accounts"
      subtitle="Correlated application accounts, link status, and detected entitlements."
      dense
      actions={
        <Button
          variant="contained"
          size="small"
          startIcon={<LinkIcon />}
          onClick={handleOpenLinkModal}
          sx={{ textTransform: 'none', fontWeight: 500, borderRadius: 1.5 }}
        >
          Link account
        </Button>
      }
    >
      {accounts.length === 0 ? (
        <Paper sx={{ p: 5, textAlign: 'center', backgroundColor: CATALOG.surfaceAlt, border: `1px dashed ${CATALOG.border}` }} elevation={0}>
          <BusinessCenter sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">No accounts found</Typography>
          <Typography variant="body2" color="text.secondary">This user does not currently have any accounts linked.</Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {accounts.map((acc, idx) => {
            const accountEntitlements = getAccountDisplayEntitlements(acc);
            const statusLabel = acc.accountData?.status || 'Active';
            const statusStr = String(statusLabel).toLowerCase();
            const statusColor =
              statusStr.includes('inactive') || statusStr.includes('term') || statusStr.includes('disable')
                ? 'default'
                : 'success';

            return (
              <Grid item xs={12} md={6} key={acc.linkId || idx}>
                <Card
                  elevation={0}
                  onClick={() => handleOpenAccountSourceCsv(acc)}
                  sx={{
                    border: `1px solid ${CATALOG.border}`,
                    borderRadius: 2,
                    height: '100%',
                    cursor: 'pointer',
                    opacity: acc.isActive === false ? 0.82 : 1,
                    bgcolor: CATALOG.surface,
                    transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
                    '&:hover': {
                      boxShadow: '0 4px 14px rgba(15,23,42,0.08)',
                      borderColor: CATALOG.accent,
                    },
                  }}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, gap: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, minWidth: 0, flex: 1 }}>
                        <AccountAppIcon
                          name={acc.applicationName}
                          icon={acc.applicationIcon || acc.icon}
                          color={acc.applicationColor || acc.color}
                        />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 500, color: CATALOG.accentDeep, lineHeight: 1.25 }}>
                            {acc.applicationName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                            Mapped via:{' '}
                            <Chip label={`${acc.correlationMethod} (${acc.correlationScore}%)`} size="small" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 400 }} />
                          </Typography>
                          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.75 }}>
                            Click card to view full source row as CSV
                          </Typography>
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 0.25 }} onClick={(e) => e.stopPropagation()}>
                        <FormControlLabel
                          control={
                            <Switch
                              size="small"
                              checked={acc.isActive !== false}
                              disabled={linkActiveSaving === acc.linkId}
                              onChange={(e) => {
                                e.stopPropagation();
                                void handleToggleAccountLink(acc, e.target.checked);
                              }}
                            />
                          }
                          label="On"
                          labelPlacement="start"
                          sx={{
                            m: 0,
                            mr: 0,
                            '& .MuiFormControlLabel-label': { fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', pr: 0.5 },
                          }}
                        />
                        <Tooltip title="Unlink account">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleUnlinkAccount(acc.linkId, acc.applicationName);
                            }}
                          >
                            <LinkOff fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>

                    <Divider sx={{ mb: 2 }} />

                    <Grid container spacing={2}>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">
                          {acc.correlationAccountAttribute
                            ? `Matched on (${acc.correlationAccountAttribute})`
                            : 'Matched value (target app)'}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 400, wordBreak: 'break-all' }}>
                          {acc.correlationDisplayValue ||
                            acc.accountData?.samAccountName ||
                            acc.accountData?.userPrincipalName ||
                            acc.accountData?.username ||
                            acc.accountData?.user_id ||
                            acc.accountData?.email ||
                            '—'}
                        </Typography>
                        {acc.correlationIdentityAttribute && (
                          <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>
                            Identity attribute: {acc.correlationIdentityAttribute}
                          </Typography>
                        )}
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">Status</Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.75, mt: 0.25 }}>
                          <Chip label={statusLabel} size="small" color={statusColor} variant="outlined" sx={{ height: 22 }} />
                          {acc.isActive === false && (
                            <Chip label="Link disabled" size="small" color="warning" variant="filled" sx={{ height: 20, fontSize: '0.65rem' }} />
                          )}
                        </Box>
                      </Grid>
                    </Grid>

                    <Box sx={{ mt: 3, p: 2, bgcolor: CATALOG.surfaceAlt, borderRadius: 2, border: `1px dashed ${CATALOG.borderStrong}` }}>
                      <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <AccountTree fontSize="small" /> Detected entitlements ({accountEntitlements.length})
                      </Typography>

                      {accountEntitlements.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                          No groups, roles, or profiles found on this account.
                        </Typography>
                      ) : (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {accountEntitlements.map((ent, i) => (
                            <Tooltip
                              key={i}
                              title={ent.type === 'correlation' ? 'From Account/Entitlement correlation' : `Source Field: ${ent.type}`}
                              arrow
                              placement="top"
                            >
                              <Chip
                                label={`${ent.value}`}
                                size="small"
                                variant="outlined"
                                sx={{ bgcolor: 'white', fontWeight: 400, borderColor: '#cbd5e1' }}
                              />
                            </Tooltip>
                          ))}
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog
        open={accountSourceModal.open}
        onClose={() => setAccountSourceModal((s) => ({ ...s, open: false }))}
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
            Account data
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, color: palette.text.primary, lineHeight: 1.3 }}>
            {accountSourceModal.title}
          </Typography>
          <IconButton
            aria-label="Close"
            onClick={() => setAccountSourceModal((s) => ({ ...s, open: false }))}
            size="small"
            sx={{ position: 'absolute', right: 12, top: 12, color: palette.text.secondary }}
          >
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ px: 2.5, py: 2, bgcolor: palette.bg.secondary }}>
          <Typography variant="body2" sx={{ color: palette.text.secondary, mb: 2 }}>
            Key account details for this identity.
          </Typography>
          {!accountSourceModal.entries?.length ? (
            <Alert severity="info">
              No account document was loaded for this link. Run <strong>Sync</strong> on the application and refresh this identity.
            </Alert>
          ) : (
            <Grid container spacing={0}>
              {accountSourceModal.entries.map(([key, val], idx) => (
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
                      {humanizeFieldKey(key)}
                    </Typography>
                    <Typography variant="caption" sx={{ color: palette.text.disabled, fontFamily: 'ui-monospace, monospace', fontSize: '0.65rem', wordBreak: 'break-all' }}>
                      {key}
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1, py: { xs: 1, sm: 1.25 }, px: 1.5, minWidth: 0 }}>
                    <AccountSourceValueCell fieldKey={key} value={val} />
                  </Box>
                </Grid>
              ))}
            </Grid>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 2.5, py: 1.5, bgcolor: palette.bg.elevated, borderTop: `1px solid ${palette.border.default}` }}>
          <Button
            onClick={() => setAccountSourceModal((s) => ({ ...s, open: false }))}
            variant="outlined"
            sx={{ textTransform: 'none', fontWeight: 600, borderColor: palette.border.default, color: palette.text.secondary }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={linkModalOpen} onClose={() => setLinkModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
          <LinkIcon color="primary" /> Manually Link Account
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Select an application and provide the Account ID from that system to manually force a link to this user.
          </Typography>

          <FormControl fullWidth sx={{ mb: 3 }}>
            <InputLabel>Application</InputLabel>
            <Select
              value={linkForm.applicationId}
              label="Application"
              onChange={(e) => setLinkForm({ ...linkForm, applicationId: e.target.value })}
            >
              {applications.map((app) => (
                <MenuItem key={app._id} value={app._id}>{app.name} ({app.type})</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            fullWidth required label="Target Account ID (e.g., john.doe@salesforce.com)"
            value={linkForm.accountId} onChange={(e) => setLinkForm({ ...linkForm, accountId: e.target.value })}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth label="Account Alias / Display Name (Optional)"
            value={linkForm.accountName} onChange={(e) => setLinkForm({ ...linkForm, accountName: e.target.value })}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setLinkModalOpen(false)} color="inherit">Cancel</Button>
          <Button onClick={handleLinkAccount} variant="contained" disabled={!linkForm.applicationId || !linkForm.accountId}>
            Link Account
          </Button>
        </DialogActions>
      </Dialog>
    </CatalogSection>
  );
}
