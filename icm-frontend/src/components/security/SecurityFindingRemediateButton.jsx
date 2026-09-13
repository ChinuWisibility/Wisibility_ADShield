import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tooltip,
  Typography,
  Alert,
  Stack,
  CircularProgress,
} from "@mui/material";
import QueueFirstRemediationRowAction from "../remediation/QueueFirstRemediationRowAction";
import { IAM_ORPHAN_QUEUE_MODAL_PIPELINE } from "../../features/remediation-events/utils/iamOrphanReviewPipeline";
import { securityAPI } from "../../services/securityApi";
import { useSecurityWorkspace } from "../../pages/security/SecurityWorkspaceContext";
import {
  ADSHIELD_REMEDIABLE_FEATURES,
  ACTION_LABELS,
} from "../../pages/security/remediation/adShieldRemediationMeta";

/**
 * Remediate AD Security findings via ADShield, or IAM orphan queue when accountId present.
 */
export default function SecurityFindingRemediateButton({
  finding,
  queuedInfo = null,
  onQueuedRefresh = null,
  onRemediated = null,
}) {
  const { applicationId } = useSecurityWorkspace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  if (!finding) return null;

  const targetId =
    finding.attributes?.orphanId ||
    finding.attributes?.accountId ||
    finding.metadata?.orphanId ||
    finding.metadata?.accountId ||
    finding.evidence?.orphanId ||
    finding.evidence?.accountId ||
    null;

  if (targetId) {
    return (
      <QueueFirstRemediationRowAction
        targetId={String(targetId)}
        recordLabel={finding.objectName || String(targetId)}
        eventTypeLabel="IAM Orphan Review"
        queueAction="IAM_ORPHAN_REVIEW"
        pipelineSteps={IAM_ORPHAN_QUEUE_MODAL_PIPELINE}
        queuedInfo={queuedInfo}
        onQueuedRefresh={onQueuedRefresh}
        size="small"
        variant="outlined"
      />
    );
  }

  const feature = String(finding.feature || "").trim();
  const dn = String(finding.dn || "").trim();
  const canAdShield =
    Boolean(applicationId) &&
    Boolean(dn) &&
    ADSHIELD_REMEDIABLE_FEATURES.has(feature);

  if (!canAdShield) {
    return (
      <Tooltip title="Remediate is available when ADShield supports this finding and the object DN is known.">
        <span>
          <Button size="small" variant="outlined" disabled sx={{ textTransform: "none" }}>
            Remediate
          </Button>
        </span>
      </Tooltip>
    );
  }

  const runPreview = async () => {
    setError("");
    setDone(null);
    setBusy(true);
    setOpen(true);
    try {
      const res = await securityAPI.remediateFinding(applicationId, {
        finding,
        dryRun: true,
      });
      setPreview(res.data?.data || res.data);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Preview failed");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const runApply = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await securityAPI.remediateFinding(applicationId, {
        finding,
        dryRun: false,
      });
      const data = res.data?.data || res.data;
      if (!data?.success) {
        setError(
          (data?.errors && data.errors[0]) ||
            res.data?.message ||
            "Remediation failed",
        );
        setPreview(data);
        return;
      }
      setDone(data);
      setPreview(data);
      onRemediated?.(data);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Remediation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        sx={{ textTransform: "none" }}
        onClick={runPreview}
      >
        Remediate
      </Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Remediate — {finding.objectName || feature}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Target: {dn}
            </Typography>
            {preview?.actionType && (
              <Typography variant="body2">
                Change: {ACTION_LABELS[preview.actionType] || preview.actionType}
              </Typography>
            )}
            {Array.isArray(preview?.changes) && preview.changes.length > 0 && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                {preview.changes.map((c) => (
                  <Typography key={c} variant="caption" display="block">
                    {c}
                  </Typography>
                ))}
              </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}
            {done?.success && (
              <Alert severity="success">
                Applied and verified. Re-run the Security Posture scan to refresh findings.
              </Alert>
            )}
            {busy && (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="caption">Talking to ADShield…</Typography>
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy} sx={{ textTransform: "none" }}>
            Close
          </Button>
          {!done?.success && (
            <Button
              variant="contained"
              onClick={runApply}
              disabled={busy || !preview?.success}
              sx={{ textTransform: "none" }}
            >
              Confirm & apply
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
