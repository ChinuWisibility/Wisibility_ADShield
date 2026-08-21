import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Divider,
  List,
  ListItem,
  ListItemText,
  Chip,
  Stack,
  Button,
  Collapse,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import RiskSeverityChip from "./RiskSeverityChip";
import { featureLabel } from "../../pages/security/securityFeatureMeta";
import { findingTypeLabel } from "../../pages/security/findingTypeMeta";
import PrivilegePathViewer from "./PrivilegePathViewer";
import SecurityFindingRemediateButton from "./SecurityFindingRemediateButton";
import { useSecurityWorkspace } from "../../pages/security/SecurityWorkspaceContext";
import SecurityRemediationStatusChip from "../../pages/security/remediation/components/SecurityRemediationStatusChip";

export default function RiskDrilldownDrawer({
  open,
  finding,
  onClose,
  relatedFindings = [],
  onSelectRelated,
  remediationContext = null,
}) {
  const navigate = useNavigate();
  const { buildPath } = useSecurityWorkspace();
  const [showRaw, setShowRaw] = useState(false);

  const relationships = finding?.relationships || [];
  const attributes = finding?.attributes || {};
  const metadata = finding?.metadata || finding?.evidence || {};
  const signals = finding?.findingSignals || [];

  const evidenceEntries = useMemo(() => {
    const merged = { ...metadata, ...attributes };
    return Object.entries(merged).filter(([k]) => k !== "relationships");
  }, [metadata, attributes]);

  if (!finding) {
    return (
      <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: "100%", sm: 440 } } }}>
        <Box sx={{ p: 2 }} />
      </Drawer>
    );
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 520 } } }}
    >
      <Box sx={{ p: 2.5, height: "100%", overflow: "auto" }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <Box>
            <RiskSeverityChip severity={finding.severity} />
            <Typography variant="h6" fontWeight={800} sx={{ mt: 1 }}>
              {finding.objectName}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {findingTypeLabel(finding.findingType)} · {featureLabel(finding.feature)}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              Why it matters: {finding.recommendation || "Review evidence and matched policy."}
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </Box>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          {signals.map((s) => (
            <Chip key={s} size="small" label={s} variant="outlined" />
          ))}
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Stack spacing={1.5}>
          <Row label="Finding type" value={findingTypeLabel(finding.findingType)} />
          <Row
            label="Matched policy"
            value={finding.matchedPolicyName || (finding.severity === "not defined" ? "Not defined" : "—")}
          />
          <Row label="Risk level" value={finding.severity || finding.riskLevel} />
          <Row label="Object type" value={finding.objectType} />
          <Row label="Detector status" value={finding.status} />
          {finding.dn && <Row label="DN" value={finding.dn} mono />}
          {finding.scannedAt && (
            <Row label="Scan time" value={new Date(finding.scannedAt).toLocaleString()} />
          )}
        </Stack>

        {remediationContext && (
          <Box sx={{ mt: 2, p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Remediation status
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              {remediationContext.compareClass && (
                <SecurityRemediationStatusChip status={remediationContext.compareClass} />
              )}
              {remediationContext.queuedInfo?.taskId && (
                <SecurityRemediationStatusChip status="queued" label="Queue task" />
              )}
            </Stack>
            {remediationContext.baselineScanId && (
              <Row
                label="Baseline execution"
                value={`${String(remediationContext.baselineScanId).slice(0, 12)}…`}
                mono
              />
            )}
            {remediationContext.currentScanId && (
              <Row
                label="Current execution"
                value={`${String(remediationContext.currentScanId).slice(0, 12)}…`}
                mono
              />
            )}
            {remediationContext.queuedInfo?.taskId && (
              <Row label="Queue task" value={remediationContext.queuedInfo.taskId} mono />
            )}
            {remediationContext.resolutionNotes && (
              <Row label="Resolution notes" value={remediationContext.resolutionNotes} />
            )}
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Progress is measured by reassessment (Compare API). Launch a workflow to execute
              remediation, then re-run the assessment to verify.
            </Typography>
          </Box>
        )}

        {finding.recommendation && (
          <Box sx={{ mt: 2, p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}>
            <Typography variant="subtitle2" fontWeight={700}>
              Recommendation
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {finding.recommendation}
            </Typography>
            <Box sx={{ mt: 1.5 }}>
              <SecurityFindingRemediateButton
                finding={finding}
                queuedInfo={remediationContext?.queuedInfo}
              />
            </Box>
          </Box>
        )}

        {!finding.recommendation && (
          <Box sx={{ mt: 2 }}>
            <SecurityFindingRemediateButton
              finding={finding}
              queuedInfo={remediationContext?.queuedInfo}
            />
          </Box>
        )}

        {evidenceEntries.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Evidence
            </Typography>
            <List dense disablePadding>
              {evidenceEntries.slice(0, 12).map(([k, v]) => (
                <ListItem key={k} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText
                    primary={k}
                    secondary={typeof v === "object" ? JSON.stringify(v) : String(v)}
                    primaryTypographyProps={{ variant: "caption", fontWeight: 600 }}
                    secondaryTypographyProps={{ variant: "body2", sx: { wordBreak: "break-all" } }}
                  />
                </ListItem>
              ))}
            </List>
            {evidenceEntries.length > 12 && (
              <>
                <Button size="small" onClick={() => setShowRaw((v) => !v)} sx={{ textTransform: "none" }}>
                  {showRaw ? "Hide raw JSON" : "Show raw JSON"}
                </Button>
                <Collapse in={showRaw}>
                  <Box
                    component="pre"
                    sx={{
                      mt: 1,
                      p: 1,
                      bgcolor: "action.hover",
                      borderRadius: 1,
                      fontSize: 11,
                      overflow: "auto",
                    }}
                  >
                    {JSON.stringify(Object.fromEntries(evidenceEntries), null, 2)}
                  </Box>
                </Collapse>
              </>
            )}
          </Box>
        )}

        {relationships.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Related objects / path
            </Typography>
            <PrivilegePathViewer relationships={relationships} />
          </Box>
        )}

        {relatedFindings.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Related findings
            </Typography>
            <Stack spacing={0.5}>
              {relatedFindings.slice(0, 8).map((f) => (
                <Button
                  key={f.id}
                  size="small"
                  variant="text"
                  sx={{ justifyContent: "flex-start", textTransform: "none" }}
                  onClick={() => onSelectRelated?.(f)}
                >
                  {f.objectName} · {featureLabel(f.feature)} · {f.severity}
                </Button>
              ))}
            </Stack>
          </Box>
        )}

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 3 }}>
          <Button
            size="small"
            variant="outlined"
            sx={{ textTransform: "none" }}
            onClick={() =>
              navigate(buildPath("/security/findings", { feature: finding.feature }))
            }
          >
            All for detector
          </Button>
          {finding.dn && (
            <Button
              size="small"
              variant="outlined"
              sx={{ textTransform: "none" }}
              onClick={() =>
                navigate(buildPath("/security/findings", { search: finding.objectName }))
              }
            >
              Same object
            </Button>
          )}
          {finding.matchedPolicyId && (
            <Button
              size="small"
              variant="outlined"
              sx={{ textTransform: "none" }}
              onClick={() =>
                navigate(buildPath("/security/policies"))
              }
            >
              Open policies
            </Button>
          )}
          <Button
            size="small"
            variant="contained"
            sx={{ textTransform: "none" }}
            onClick={() => navigate(buildPath("/security/dashboard"))}
          >
            Back to assessment
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}

function Row({ label, value, mono }) {
  if (value == null || value === "") return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" fontWeight={600}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontFamily: mono ? "monospace" : undefined, wordBreak: "break-all" }}
      >
        {value}
      </Typography>
    </Box>
  );
}
