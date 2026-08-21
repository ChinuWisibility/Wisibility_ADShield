import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Alert,
  Stack,
  CircularProgress,
} from '@mui/material';
import { workflowAPI } from '../../services/api';

const DECISIONS = [
  { id: 'ASSIGN', label: 'Assign', description: 'Link account to an identity' },
  { id: 'DELETE', label: 'Delete', description: 'Remove the account' },
  { id: 'DISABLE', label: 'Disable', description: 'Disable the account' },
  { id: 'IGNORE', label: 'Ignore', description: 'Accept as false positive' },
];

export default function OrphanIamDecisionDialog({ open, orphanId, accountName, onClose, onSuccess }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (decision) => {
    if (!orphanId) return;
    setSubmitting(true);
    setError('');
    try {
      await workflowAPI.recordOrphanIamDecision(orphanId, { decision });
      onSuccess?.(decision);
      onClose?.();
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to record IAM decision');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !submitting && onClose?.()} maxWidth="xs" fullWidth>
      <DialogTitle>IAM decision</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Record a decision for <strong>{accountName || orphanId}</strong>. The workflow will resume and branch on this action.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={1}>
          {DECISIONS.map((d) => (
            <Button
              key={d.id}
              variant="outlined"
              disabled={submitting}
              onClick={() => submit(d.id)}
              sx={{ justifyContent: 'flex-start', textAlign: 'left', py: 1.25 }}
            >
              <span>
                <strong>{d.label}</strong>
                <Typography component="span" variant="caption" display="block" color="text.secondary">
                  {d.description}
                </Typography>
              </span>
            </Button>
          ))}
        </Stack>
        {submitting && (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2">Recording decision…</Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
