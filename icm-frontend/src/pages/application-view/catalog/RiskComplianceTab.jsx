import React, { useState } from 'react';
import {
  Box, Grid, Typography, Chip, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, FormGroup, FormControlLabel, Checkbox, Snackbar, Alert,
} from '@mui/material';
import {
  SecurityOutlined, GppGoodOutlined, EditOutlined, VerifiedUserOutlined, ShieldOutlined,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import CatalogSection from '../../identities/catalog/CatalogSection';
import {
  InsightLoading, InsightError, InsightPanel, InsightEmpty, formatDate,
} from '../../identities/catalog/CatalogInsightPrimitives';
import { CATALOG, riskTone } from '../../identities/catalog/catalogTheme';
import { applicationAPI } from '../../../services/api';
import { Card, HealthGauge } from './ApplicationViewPrimitives';
import {
  fetchApplicationViewRiskProfile,
  applicationViewRiskProfileQueryKey,
  applicationViewDetailQueryKey,
  applicationViewSummaryQueryKey,
  APP_VIEW_INSIGHT_STALE_MS,
} from './applicationViewQueries';

const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const COMPLIANCE_FRAMEWORKS = ['SOX', 'GDPR', 'HIPAA', 'PCI-DSS', 'ISO27001', 'NIST'];
const DATA_CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];

function clampScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function RiskLevelChip({ level }) {
  const tone = riskTone(level);
  return (
    <Chip
      size="small"
      label={level || 'MEDIUM'}
      sx={{ height: 24, fontWeight: 700, bgcolor: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }}
    />
  );
}

function EditRiskDialog({ open, onClose, application, onSaved }) {
  const [riskLevel, setRiskLevel] = useState(application?.riskLevel || 'MEDIUM');
  const [riskJustification, setRiskJustification] = useState(application?.riskJustification || '');

  const mutation = useMutation({
    mutationFn: () => applicationAPI.updateRisk(application._id, { riskLevel, riskJustification }),
    onSuccess: (res) => {
      onSaved(res?.data?.data);
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit risk level</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: 1.5 }}>
        <TextField select label="Risk level" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}>
          {RISK_LEVELS.map((l) => <MenuItem key={l} value={l}>{l}</MenuItem>)}
        </TextField>
        <TextField
          label="Justification"
          multiline
          minRows={3}
          value={riskJustification}
          onChange={(e) => setRiskJustification(e.target.value)}
          placeholder="Why is this application rated at this risk level?"
        />
        {mutation.isError ? (
          <Alert severity="error">{mutation.error?.response?.data?.message || mutation.error?.message || 'Failed to save.'}</Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function EditComplianceDialog({ open, onClose, application, onSaved }) {
  const [selected, setSelected] = useState(new Set(application?.complianceFrameworks || []));

  const mutation = useMutation({
    mutationFn: () => applicationAPI.updateCompliance(application._id, { complianceFrameworks: Array.from(selected) }),
    onSuccess: (res) => {
      onSaved(res?.data?.data);
      onClose();
    },
  });

  const toggle = (fw) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fw)) next.delete(fw); else next.add(fw);
      return next;
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit compliance frameworks</DialogTitle>
      <DialogContent sx={{ pt: 1.5 }}>
        <FormGroup>
          {COMPLIANCE_FRAMEWORKS.map((fw) => (
            <FormControlLabel
              key={fw}
              control={<Checkbox checked={selected.has(fw)} onChange={() => toggle(fw)} />}
              label={fw}
            />
          ))}
        </FormGroup>
        {mutation.isError ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {mutation.error?.response?.data?.message || mutation.error?.message || 'Failed to save.'}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function EditRiskProfileDialog({
  open, onClose, applicationId, profile, onSaved,
}) {
  const [dataClassification, setDataClassification] = useState(profile?.dataClassification || 'INTERNAL');
  const [dataTypes, setDataTypes] = useState((profile?.dataTypes || []).join(', '));
  const [regulatoryFrameworks, setRegulatoryFrameworks] = useState((profile?.regulatoryFrameworks || []).join(', '));
  const [inherentRisk, setInherentRisk] = useState(profile?.inherentRisk ?? '');
  const [controlEffectiveness, setControlEffectiveness] = useState(profile?.controlEffectiveness ?? '');
  const [residualRisk, setResidualRisk] = useState(profile?.residualRisk ?? '');

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        applicationId,
        dataClassification,
        dataTypes: dataTypes.split(',').map((s) => s.trim()).filter(Boolean),
        regulatoryFrameworks: regulatoryFrameworks.split(',').map((s) => s.trim()).filter(Boolean),
        inherentRisk: clampScore(inherentRisk),
        controlEffectiveness: clampScore(controlEffectiveness),
        residualRisk: clampScore(residualRisk),
        lastRiskAssessmentAt: new Date().toISOString(),
      };
      return profile?._id
        ? applicationAPI.updateRiskProfile(profile._id, body)
        : applicationAPI.createRiskProfile(body);
    },
    onSuccess: (res) => {
      onSaved(res?.data?.data);
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{profile?._id ? 'Edit risk profile' : 'Create risk profile'}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: 1.5 }}>
        <TextField select label="Data classification" value={dataClassification} onChange={(e) => setDataClassification(e.target.value)}>
          {DATA_CLASSIFICATIONS.map((l) => <MenuItem key={l} value={l}>{l}</MenuItem>)}
        </TextField>
        <TextField
          label="Data types (comma-separated)"
          value={dataTypes}
          onChange={(e) => setDataTypes(e.target.value)}
          placeholder="PII, Financial, Health"
        />
        <TextField
          label="Regulatory frameworks (comma-separated)"
          value={regulatoryFrameworks}
          onChange={(e) => setRegulatoryFrameworks(e.target.value)}
          placeholder="SOX, GDPR"
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5 }}>
          <TextField
            label="Inherent risk (0-100)"
            type="number"
            value={inherentRisk}
            onChange={(e) => setInherentRisk(e.target.value)}
            inputProps={{ min: 0, max: 100 }}
          />
          <TextField
            label="Control effectiveness (0-100)"
            type="number"
            value={controlEffectiveness}
            onChange={(e) => setControlEffectiveness(e.target.value)}
            inputProps={{ min: 0, max: 100 }}
          />
          <TextField
            label="Residual risk (0-100)"
            type="number"
            value={residualRisk}
            onChange={(e) => setResidualRisk(e.target.value)}
            inputProps={{ min: 0, max: 100 }}
          />
        </Box>
        {mutation.isError ? (
          <Alert severity="error">{mutation.error?.response?.data?.message || mutation.error?.message || 'Failed to save.'}</Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function RiskComplianceTab({ applicationId, application }) {
  const queryClient = useQueryClient();
  const [appOverride, setAppOverride] = useState(null);
  const [riskDialogOpen, setRiskDialogOpen] = useState(false);
  const [complianceDialogOpen, setComplianceDialogOpen] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const effectiveApp = appOverride || application;

  const query = useQuery({
    queryKey: applicationViewRiskProfileQueryKey(applicationId),
    queryFn: () => fetchApplicationViewRiskProfile(applicationId),
    enabled: Boolean(applicationId),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });

  const handleAppSaved = (updated) => {
    if (updated) setAppOverride(updated);
    setToast({ ok: true, text: 'Saved.' });
    queryClient.invalidateQueries({ queryKey: applicationViewDetailQueryKey(applicationId) });
    queryClient.invalidateQueries({ queryKey: applicationViewSummaryQueryKey(applicationId) });
  };

  const handleProfileSaved = () => {
    setToast({ ok: true, text: 'Risk profile saved.' });
    query.refetch();
  };

  if (!effectiveApp) return <InsightLoading />;

  const profile = query.data;
  const frameworks = effectiveApp.complianceFrameworks || [];

  return (
    <CatalogSection
      eyebrow="Governance"
      title="Risk & Compliance"
      subtitle="Risk rating, compliance frameworks, and the detailed risk assessment for this application."
      dense
    >
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Grid container spacing={1.75}>
          <Grid item xs={12} md={6}>
            <Card
              title="Risk Rating"
              icon={<SecurityOutlined sx={{ fontSize: 16 }} />}
              iconColor={riskTone(effectiveApp.riskLevel).color}
              action={(
                <Button size="small" startIcon={<EditOutlined sx={{ fontSize: 15 }} />} onClick={() => setRiskDialogOpen(true)} sx={{ textTransform: 'none', fontWeight: 650 }}>
                  Edit
                </Button>
              )}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <RiskLevelChip level={effectiveApp.riskLevel} />
                <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkFaint }}>Application risk level</Typography>
              </Box>
              <Typography sx={{ fontSize: '0.82rem', color: effectiveApp.riskJustification ? CATALOG.ink : CATALOG.inkFaint, lineHeight: 1.5 }}>
                {effectiveApp.riskJustification || 'No justification recorded yet.'}
              </Typography>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card
              title="Compliance Frameworks"
              icon={<GppGoodOutlined sx={{ fontSize: 16 }} />}
              iconColor="#7C3AED"
              action={(
                <Button size="small" startIcon={<EditOutlined sx={{ fontSize: 15 }} />} onClick={() => setComplianceDialogOpen(true)} sx={{ textTransform: 'none', fontWeight: 650 }}>
                  Edit
                </Button>
              )}
            >
              {frameworks.length === 0 ? (
                <Typography sx={{ fontSize: '0.82rem', color: CATALOG.inkFaint }}>No compliance frameworks assigned.</Typography>
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {frameworks.map((fw) => (
                    <Chip key={fw} size="small" label={fw} sx={{ fontWeight: 650, bgcolor: 'rgba(124,58,237,0.1)', color: '#7C3AED' }} />
                  ))}
                </Box>
              )}
              <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <ShieldOutlined sx={{ fontSize: 15, color: CATALOG.inkFaint }} />
                <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkMuted }}>
                  Data classification: <Box component="span" sx={{ fontWeight: 700, color: CATALOG.ink, textTransform: 'capitalize' }}>{effectiveApp.dataClassification || 'internal'}</Box>
                </Typography>
              </Box>
            </Card>
          </Grid>
        </Grid>

        {query.isPending ? <InsightLoading /> : null}
        {query.isError ? (
          <InsightError message={query.error?.message || 'Failed to load risk profile.'} onRetry={() => query.refetch()} />
        ) : null}

        {!query.isPending && !query.isError ? (
          <InsightPanel
            title="Risk Profile"
            action={(
              <Button size="small" startIcon={<EditOutlined sx={{ fontSize: 15 }} />} onClick={() => setProfileDialogOpen(true)} sx={{ textTransform: 'none', fontWeight: 650 }}>
                {profile ? 'Edit' : 'Create'}
              </Button>
            )}
          >
            {!profile ? (
              <Box sx={{ p: 2.25 }}>
                <InsightEmpty
                  title="No risk profile yet"
                  body="Create a detailed risk profile to track data classification, regulatory scope, and inherent/residual risk scoring for this application."
                />
              </Box>
            ) : (
              <Box sx={{ p: 2.25, display: 'grid', gap: 2 }}>
                <Grid container spacing={2}>
                  <Grid item xs={4}>
                    <Box sx={{ textAlign: 'center' }}>
                      {profile.inherentRisk != null ? (
                        <HealthGauge score={clampScore(profile.inherentRisk)} label="Inherent Risk" color="#DC2626" />
                      ) : (
                        <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkFaint, py: 4 }}>Not scored</Typography>
                      )}
                    </Box>
                  </Grid>
                  <Grid item xs={4}>
                    <Box sx={{ textAlign: 'center' }}>
                      {profile.controlEffectiveness != null ? (
                        <HealthGauge score={clampScore(profile.controlEffectiveness)} label="Control Effectiveness" color="#2563EB" />
                      ) : (
                        <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkFaint, py: 4 }}>Not scored</Typography>
                      )}
                    </Box>
                  </Grid>
                  <Grid item xs={4}>
                    <Box sx={{ textAlign: 'center' }}>
                      {profile.residualRisk != null ? (
                        <HealthGauge score={clampScore(profile.residualRisk)} label="Residual Risk" color="#D97706" />
                      ) : (
                        <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkFaint, py: 4 }}>Not scored</Typography>
                      )}
                    </Box>
                  </Grid>
                </Grid>

                <Box sx={{ display: 'grid', gap: 1, borderTop: `1px solid ${CATALOG.border}`, pt: 1.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkMuted }}>Data classification</Typography>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: CATALOG.ink }}>{profile.dataClassification || '—'}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkMuted }}>Data types</Typography>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: CATALOG.ink, textAlign: 'right' }}>
                      {(profile.dataTypes || []).join(', ') || '—'}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkMuted }}>Regulatory frameworks</Typography>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: CATALOG.ink, textAlign: 'right' }}>
                      {(profile.regulatoryFrameworks || []).join(', ') || '—'}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkMuted }}>Last assessed</Typography>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: CATALOG.ink }}>{formatDate(profile.lastRiskAssessmentAt)}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkMuted }}>Next review</Typography>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: CATALOG.ink }}>{formatDate(profile.nextReviewDate)}</Typography>
                  </Box>
                </Box>
              </Box>
            )}
          </InsightPanel>
        ) : null}
      </Box>

      {riskDialogOpen ? (
        <EditRiskDialog
          open={riskDialogOpen}
          onClose={() => setRiskDialogOpen(false)}
          application={effectiveApp}
          onSaved={handleAppSaved}
        />
      ) : null}
      {complianceDialogOpen ? (
        <EditComplianceDialog
          open={complianceDialogOpen}
          onClose={() => setComplianceDialogOpen(false)}
          application={effectiveApp}
          onSaved={handleAppSaved}
        />
      ) : null}
      {profileDialogOpen ? (
        <EditRiskProfileDialog
          open={profileDialogOpen}
          onClose={() => setProfileDialogOpen(false)}
          applicationId={applicationId}
          profile={profile}
          onSaved={handleProfileSaved}
        />
      ) : null}

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)}>
        {toast ? (
          <Alert severity={toast.ok ? 'success' : 'error'} onClose={() => setToast(null)} variant="filled">
            {toast.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </CatalogSection>
  );
}
