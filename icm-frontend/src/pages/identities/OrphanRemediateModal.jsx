import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  CircularProgress,
  Alert,
} from '@mui/material';
import { Queue } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { workflowAPI } from '../../services/api';

export default function OrphanRemediateModal({ open, onClose, orphanId, accountName, appName, onSuccess }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleEnqueue = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await workflowAPI.triggerIAMOrphanWorkflow(orphanId, {});
      const eventId = res?.data?.data?.eventId;
      onSuccess?.();
      onClose?.();
      if (eventId) {
        navigate(`/governance/workflows/remediation-queue/uncorrelated-account?eventId=${encodeURIComponent(eventId)}`);
      } else {
        navigate('/governance/workflows/remediation-queue/uncorrelated-account');
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to add to workflow remediation queue.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => { if (!submitting) onClose?.(); }}
      fullWidth
      maxWidth="sm"
      keepMounted
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Queue color="primary" />
          <Typography variant="h6" fontWeight={700}>Add to Workflow Remediation Queue</Typography>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Account</Typography>
          <Typography variant="body1" fontWeight={600}>{accountName || orphanId}</Typography>
          {appName && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{appName}</Typography>
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This creates a workflow remediation queue event. An administrator can review the event,
          create an ITSM ticket if needed, and trigger the IAM orphan workflow from the queue.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleEnqueue}
          disabled={submitting}
          startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <Queue />}
        >
          {submitting ? 'Adding…' : 'Add to Queue'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
