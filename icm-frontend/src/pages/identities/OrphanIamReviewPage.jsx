import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import {
  CheckCircle,
  ShieldOutlined,
  BusinessOutlined,
  EmailOutlined,
  PersonOutline,
  BadgeOutlined,
} from '@mui/icons-material';
import { useBranding } from '../../contexts/BrandingContext';

const API = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' });

const COLORS = {
  pageBg: '#f0f4f8',
  header: 'linear-gradient(135deg, #0c1929 0%, #1a365d 50%, #0f2744 100%)',
  accent: '#2563eb',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
};

const DECISIONS = [
  { id: 'ASSIGN', label: 'Assign', description: 'Link this account to an existing identity' },
  { id: 'DELETE', label: 'Delete', description: 'Remove the account from the target system' },
  { id: 'DISABLE', label: 'Disable', description: 'Disable the account' },
  { id: 'IGNORE', label: 'Ignore', description: 'Mark as false positive / accept risk' },
];

function DetailRow({ icon, label, value }) {
  if (!value) return null;
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Box sx={{ color: COLORS.muted, mt: 0.25 }}>{icon}</Box>
      <Box>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: '0.9rem', color: COLORS.text, fontWeight: 500 }}>{value}</Typography>
      </Box>
    </Stack>
  );
}

export default function OrphanIamReviewPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const { branding } = useBranding();

  const [phase, setPhase] = useState('loading');
  const [orphan, setOrphan] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [canDecide, setCanDecide] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedDecision, setSubmittedDecision] = useState(null);
  const [reviewSource, setReviewSource] = useState(null);
  const [decisionSourceMeta, setDecisionSourceMeta] = useState(null);
  const [resumeSucceeded, setResumeSucceeded] = useState(true);

  const load = useCallback(async () => {
    if (!token) {
      setPhase('error');
      setError('No review token provided.');
      return;
    }
    setPhase('loading');
    setError('');
    try {
      const { data } = await API.get('/remediation-workflows/orphan-iam-portal', {
        params: { token },
      });
      const d = data.data || {};
      setOrphan(d.orphan || null);
      setExpiresAt(d.expiresAt || null);
      setCanDecide(Boolean(d.canDecide));
      setReviewSource(d.reviewSource || null);
      if (d.orphan?.iamDecisionMeta) setDecisionSourceMeta(d.orphan.iamDecisionMeta);
      if (d.resume) setResumeSucceeded(d.resume.resumed !== false);
      if (d.orphan?.iamDecision) {
        setSubmittedDecision(d.orphan.iamDecision);
        setPhase('done');
      } else {
        setPhase('portal');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'This link is invalid or has expired.');
      setPhase('error');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitDecision = async (decision) => {
    setSubmitting(true);
    setError('');
    try {
      const { data } = await API.post('/remediation-workflows/orphan-iam-portal/decision', { token, decision });
      setSubmittedDecision(decision);
      if (data?.data?.decisionSource) setDecisionSourceMeta(data.data.decisionSource);
      setResumeSucceeded(data?.data?.resumed !== false);
      setPhase('done');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record decision.');
    } finally {
      setSubmitting(false);
    }
  };

  const productName = branding?.productName || 'Wisibility IGA';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: COLORS.pageBg, py: { xs: 2, sm: 4 } }}>
      <Container maxWidth="sm">
        <Card sx={{ borderRadius: 3, overflow: 'hidden', boxShadow: '0 8px 32px rgba(15,23,42,0.12)' }}>
          <Box sx={{ background: COLORS.header, px: 3, py: 3, color: '#fff' }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
              <ShieldOutlined />
              <Typography sx={{ fontWeight: 800, fontSize: '1.1rem' }}>{productName}</Typography>
            </Stack>
            <Typography sx={{ fontWeight: 700, fontSize: '1.35rem', lineHeight: 1.3 }}>
              Uncorrelated Account Review
            </Typography>
            <Typography sx={{ fontSize: '0.85rem', opacity: 0.85, mt: 0.5 }}>
              Secured reviewer link · no login required
            </Typography>
          </Box>

          <Box sx={{ p: 3 }}>
            {phase === 'loading' && (
              <Stack alignItems="center" spacing={2} py={4}>
                <CircularProgress size={36} sx={{ color: COLORS.accent }} />
                <Typography color="text.secondary">Loading review…</Typography>
              </Stack>
            )}

            {phase === 'error' && (
              <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>
            )}

            {(phase === 'portal' || phase === 'done') && orphan && (
              <Stack spacing={2.5}>
                <Box>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', mb: 0.5 }}>
                    Account under review
                  </Typography>
                  <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: COLORS.text }}>
                    {orphan.accountName || orphan.accountId || '—'}
                  </Typography>
                  {orphan.riskLevel && (
                    <Chip
                      label={`Risk: ${orphan.riskLevel}`}
                      size="small"
                      sx={{ mt: 1, fontWeight: 700 }}
                      color={orphan.riskLevel === 'CRITICAL' || orphan.riskLevel === 'HIGH' ? 'error' : 'default'}
                    />
                  )}
                </Box>

                <Divider />

                <Stack spacing={2}>
                  <DetailRow icon={<BusinessOutlined fontSize="small" />} label="Application" value={orphan.applicationName} />
                  <DetailRow icon={<EmailOutlined fontSize="small" />} label="Email" value={orphan.userEmail} />
                  <DetailRow icon={<PersonOutline fontSize="small" />} label="Display name" value={orphan.userDisplayName} />
                  <DetailRow icon={<BadgeOutlined fontSize="small" />} label="Employee ID" value={orphan.userEmployeeId} />
                </Stack>

                {reviewSource && phase === 'portal' && canDecide && (
                  <Typography sx={{ fontSize: '0.78rem', color: COLORS.muted }}>
                    Opened from notification: <strong>{reviewSource}</strong>
                  </Typography>
                )}

                {error && <Alert severity="error">{error}</Alert>}

                {phase === 'done' && (
                  <Alert
                    severity={resumeSucceeded ? 'success' : 'warning'}
                    icon={resumeSucceeded ? <CheckCircle fontSize="inherit" /> : undefined}
                  >
                    Decision recorded: <strong>{submittedDecision || orphan.iamDecision}</strong>
                    {resumeSucceeded
                      ? '. Thank you — the workflow has been updated.'
                      : '. Decision was saved, but the workflow could not be resumed. Refresh this page or contact IAM.'}
                    {(decisionSourceMeta?.source || decisionSourceMeta?.stepLabel) && (
                      <Typography component="div" sx={{ fontSize: '0.82rem', mt: 1 }}>
                        Source: {decisionSourceMeta.source || decisionSourceMeta.stepLabel}
                        {decisionSourceMeta.emailJobId ? ` · email ${decisionSourceMeta.emailJobId}` : ''}
                      </Typography>
                    )}
                  </Alert>
                )}

                {phase === 'portal' && canDecide && (
                  <>
                    <Typography sx={{ fontSize: '0.9rem', color: COLORS.muted }}>
                      Choose how IAM should remediate this uncorrelated account:
                    </Typography>
                    <Stack spacing={1}>
                      {DECISIONS.map((d) => (
                        <Button
                          key={d.id}
                          variant="outlined"
                          disabled={submitting}
                          onClick={() => submitDecision(d.id)}
                          sx={{
                            justifyContent: 'flex-start',
                            textAlign: 'left',
                            py: 1.5,
                            borderColor: COLORS.border,
                            textTransform: 'none',
                          }}
                        >
                          <Box>
                            <Typography sx={{ fontWeight: 700, color: COLORS.text }}>{d.label}</Typography>
                            <Typography sx={{ fontSize: '0.8rem', color: COLORS.muted }}>{d.description}</Typography>
                          </Box>
                        </Button>
                      ))}
                    </Stack>
                    {submitting && (
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <CircularProgress size={18} />
                        <Typography variant="body2">Recording decision…</Typography>
                      </Stack>
                    )}
                  </>
                )}

                {phase === 'portal' && !canDecide && (
                  <Alert severity="info">
                    This account is not currently awaiting an IAM decision
                    {orphan.workflowStatus ? ` (status: ${orphan.workflowStatus})` : ''}.
                  </Alert>
                )}

                {expiresAt && (
                  <Typography sx={{ fontSize: '0.72rem', color: COLORS.muted, pt: 1 }}>
                    Link expires {new Date(expiresAt).toLocaleString()}
                  </Typography>
                )}
              </Stack>
            )}
          </Box>
        </Card>
      </Container>
    </Box>
  );
}
