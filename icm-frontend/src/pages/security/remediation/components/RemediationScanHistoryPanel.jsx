import { Box, Typography, Alert, Grid } from "@mui/material";
import DataHygieneWidgetCard from "../../../datahygine/components/DataHygieneWidgetCard";
import EmptyStateSecurity from "../../../../components/security/EmptyStateSecurity";
import AssessmentPairSelector from "./AssessmentPairSelector";
import SecurityRemediationProgressWidget from "./SecurityRemediationProgressWidget";

/**
 * Secondary scan comparison / history experience.
 * Preserves existing compare widgets without dominating the remediation tab.
 */
export default function RemediationScanHistoryPanel({
  baselineScanId,
  currentScanId,
  onBaselineChange,
  onCurrentChange,
  progress,
  pair,
  metricCards = [],
  themeRegistry,
  linkQueryParams,
  loading,
  error,
  message,
  onGoScanCenter,
}) {
  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 0.5 }}>
        Scan History
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Compare two security scans to see what was fixed, what remains, and what is new.
      </Typography>

      <AssessmentPairSelector
        baselineScanId={baselineScanId}
        currentScanId={currentScanId}
        onBaselineChange={onBaselineChange}
        onCurrentChange={onCurrentChange}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error?.response?.data?.message || error?.message || "Failed to load comparison"}
        </Alert>
      )}

      {message && !/at least two|need.*compare/i.test(String(message)) && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {message}
        </Alert>
      )}

      <SecurityRemediationProgressWidget progress={progress} pair={pair} />

      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1.5 }}>
        Progress by feature
      </Typography>

      {!loading && !metricCards.length && (
        <EmptyStateSecurity
          title="Nothing to compare yet"
          description="Run another security scan, then pick your earlier and later scans to see what improved."
          actionLabel="Go to Scan Center"
          onAction={onGoScanCenter}
        />
      )}

      <Grid container spacing={2}>
        {metricCards.map((widget) => (
          <Grid item xs={12} sm={6} lg={4} key={widget.id}>
            <DataHygieneWidgetCard
              widget={widget}
              loading={loading}
              dashboardView="metric"
              detailBasePath="/security/remediation"
              applicationAnalyticsBasePath="/security/remediation"
              themeRegistry={themeRegistry}
              linkQueryParams={linkQueryParams}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
