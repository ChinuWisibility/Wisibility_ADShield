import { useEffect, useState } from "react";
import {
  Paper,
  Typography,
  Button,
  Alert,
  Box,
  CircularProgress,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { applicationAPI } from "../../services/api";
import InactiveUsersThresholdField from "./InactiveUsersThresholdField";
import {
  buildInactiveUsersFeatureSettings,
  clampInactiveUsersDaysInput,
  readInactiveUsersDays,
} from "../../utils/securityScanSettings";

/**
 * Persisted inactive-user threshold for Security Center scans (per application).
 */
export default function SecurityScanSettingsPanel({ applicationId }) {
  const queryClient = useQueryClient();
  const [inactiveUsersDays, setInactiveUsersDays] = useState(90);
  const [saveError, setSaveError] = useState("");
  const [saveOk, setSaveOk] = useState("");
  const [saving, setSaving] = useState(false);

  const appQuery = useQuery({
    queryKey: ["application", applicationId, "security-scan-settings"],
    queryFn: async () => {
      const res = await applicationAPI.getById(applicationId);
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!appQuery.data) return;
    setInactiveUsersDays(readInactiveUsersDays(appQuery.data));
  }, [appQuery.data]);

  const handleSave = async () => {
    if (!applicationId) return;
    const clamped = clampInactiveUsersDaysInput(inactiveUsersDays);
    if (clamped == null) {
      setSaveError("Enter a valid number of days.");
      setSaveOk("");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveOk("");
    try {
      await applicationAPI.patchSecurityScanSettings(applicationId, {
        inactiveUsersDays: clamped,
      });
      setInactiveUsersDays(clamped);
      setSaveOk("Scan settings saved for this application.");
      queryClient.invalidateQueries({ queryKey: ["application", applicationId] });
    } catch (err) {
      setSaveError(
        err?.response?.data?.message || err?.message || "Failed to save scan settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!applicationId) return null;

  return (
    <Paper sx={{ p: 2, mb: 2, border: 1, borderColor: "divider" }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        Scan settings
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Configure thresholds used by the Inactive Users security check when running scans
        from Security Center or after AD sync.
      </Typography>

      {appQuery.isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <>
          <InactiveUsersThresholdField
            value={inactiveUsersDays}
            onChange={setInactiveUsersDays}
            disabled={saving}
          />
          <Box sx={{ mt: 2, display: "flex", gap: 1, alignItems: "center" }}>
            <Button variant="contained" size="small" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </Box>
          {saveError && (
            <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setSaveError("")}>
              {saveError}
            </Alert>
          )}
          {saveOk && (
            <Alert severity="success" sx={{ mt: 1.5 }} onClose={() => setSaveOk("")}>
              {saveOk}
            </Alert>
          )}
        </>
      )}
    </Paper>
  );
}

export { buildInactiveUsersFeatureSettings, readInactiveUsersDays };
