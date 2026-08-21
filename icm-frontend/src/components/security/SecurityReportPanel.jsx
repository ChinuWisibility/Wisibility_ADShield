import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Typography,
  Stack,
  Chip,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useSecurityWorkspace } from "../../pages/security/SecurityWorkspaceContext";
import { featureLabel } from "../../pages/security/securityFeatureMeta";

/**
 * Printable assessment report sections from existing overview/diagnostics data.
 * No compliance frameworks — Executive / Assessment / Risk / Technical / Compare.
 */
export default function SecurityReportPanel() {
  const { overview, applications, applicationId } = useSecurityWorkspace();
  const app = (applications || []).find((a) => String(a._id) === String(applicationId));
  const scan = overview?.scan;
  const totals = overview?.totals || {};
  const priv = overview?.privilegedSummary || {};
  const comparison = overview?.comparison;
  const byFeature = overview?.byFeature || {};
  const top = Object.entries(byFeature)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  if (!applicationId || !scan) return null;

  return (
    <Box sx={{ mt: 2 }} className="security-assessment-report">
      <Typography variant="subtitle2" fontWeight={800} gutterBottom>
        Assessment reports
      </Typography>
      <Accordion defaultExpanded={false}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={700}>Executive summary</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2">
            Application: <strong>{app?.name || applicationId}</strong>
          </Typography>
          <Typography variant="body2">
            Assessment:{" "}
            {scan.completedAt
              ? new Date(scan.completedAt).toLocaleString()
              : "—"}{" "}
            · Duration{" "}
            {scan.durationMs != null ? `${Math.round(scan.durationMs / 1000)}s` : "—"}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            <Chip size="small" label={`Findings ${totals.findings ?? 0}`} />
            <Chip size="small" color="error" label={`Critical ${totals.critical ?? 0}`} />
            <Chip size="small" color="warning" label={`High ${totals.high ?? 0}`} />
            <Chip size="small" label={`Medium ${totals.medium ?? 0}`} />
            <Chip size="small" label={`Low ${totals.low ?? 0}`} />
          </Stack>
          <Typography variant="body2" sx={{ mt: 1.5 }} fontWeight={700}>
            Privilege exposure
          </Typography>
          <Typography variant="body2">
            Escalation paths {priv.escalationPaths ?? 0} · Dormant privileged{" "}
            {priv.dormantPrivileged ?? 0} · Excessive {priv.excessivePrivileges ?? 0} ·
            Nested {priv.nestedPrivileged ?? 0} · Toxic {priv.toxicCombinations ?? 0}
          </Typography>
        </AccordionDetails>
      </Accordion>

      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={700}>Assessment summary</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2">
            Modules: {(scan.modules || []).join(", ") || "—"}
          </Typography>
          <Typography variant="body2">
            Policies evaluated: {scan.policySnapshot?.policyCount ?? "—"}
          </Typography>
          <Typography variant="body2">
            Features requested:{" "}
            {(scan.scanConfig?.requestedFeatures || []).length || "—"}
          </Typography>
        </AccordionDetails>
      </Accordion>

      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={700}>Risk summary</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {top.map(([feature, count]) => (
            <Typography key={feature} variant="body2">
              {featureLabel(feature)} — {count}
            </Typography>
          ))}
        </AccordionDetails>
      </Accordion>

      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={700}>Technical details</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {(scan.diagnostics || []).slice(0, 20).map((d) => (
            <Box key={d.featureKey} sx={{ mb: 1 }}>
              <Typography variant="caption" fontWeight={700}>
                {d.featureName || d.featureKey}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Mode {d.executionMode || "—"} · Base {d.searchBase || "default"} · LDAP{" "}
                {d.ldapObjectsReturned ?? 0} · Findings {d.findingsGenerated ?? 0} ·{" "}
                {d.elapsedMs != null ? `${d.elapsedMs}ms` : ""}
              </Typography>
            </Box>
          ))}
          {!scan.diagnostics?.length && (
            <Typography variant="body2" color="text.secondary">
              No diagnostics on this assessment.
            </Typography>
          )}
        </AccordionDetails>
      </Accordion>

      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={700}>Comparison appendix</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {comparison ? (
            <Stack direction="row" spacing={1}>
              <Chip color="success" label={`Resolved ${comparison.resolved}`} />
              <Chip color="error" label={`New ${comparison.new}`} />
              <Chip variant="outlined" label={`Unchanged ${comparison.unchanged}`} />
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Need a prior assessment to populate Resolved / New / Unchanged.
            </Typography>
          )}
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
