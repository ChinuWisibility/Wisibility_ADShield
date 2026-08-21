import { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Chip,
  Stack,
  Divider,
  Button,
  CircularProgress,
  Alert,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import InactiveUsersThresholdField from "./InactiveUsersThresholdField";
import FeatureQueryConfigurationPanel from "./FeatureQueryConfigurationPanel";
import { readInactiveUsersDays, clampInactiveUsersDaysInput } from "../../utils/securityScanSettings";

export default function SecurityFeatureDetailPanel({
  feature,
  applicationId,
  application,
  enabled,
  onSaved,
  runScan,
  scanRunning,
  isRunningThis,
  featureActionsRef,
  readOnly = false,
}) {
  const [ldapFilter, setLdapFilter] = useState(feature.ldapFilter || "");
  const [searchBase, setSearchBase] = useState(feature.searchBase || "");
  const [searchScope, setSearchScope] = useState(feature.searchScope || "Subtree");
  const [validationErrors, setValidationErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState("");
  const [inactiveUsersDays, setInactiveUsersDays] = useState(90);
  const [actionError, setActionError] = useState("");
  const [saveOk, setSaveOk] = useState("");

  const executionMode = String(feature.executionMode || "").toUpperCase();
  const isLdap =
    executionMode === "LDAP" ||
    executionMode === "HYBRID" ||
    feature.supportsSearchBase === true;
  const isInactiveUsers = feature.featureKey === "inactive_users";
  const busy = saving || testing || isRunningThis;

  useEffect(() => {
    setLdapFilter(feature.ldapFilter || "");
    setSearchBase(feature.searchBase || "");
    setSearchScope(feature.searchScope || feature.defaultSearchScope || "Subtree");
    setValidationErrors([]);
    setTestResult(null);
    setTestError("");
    setActionError("");
    setSaveOk("");
    if (isInactiveUsers && application) {
      setInactiveUsersDays(readInactiveUsersDays(application));
    }
  }, [
    feature.featureKey,
    feature.ldapFilter,
    feature.searchBase,
    feature.searchScope,
    feature.defaultSearchScope,
    application,
    isInactiveUsers,
  ]);

  useEffect(() => {
    if (!featureActionsRef?.current) return;
    featureActionsRef.current.getPendingFeatureConfig = () => ({
      ldapFilter,
      searchBase,
      searchScope,
    });
  }, [featureActionsRef, ldapFilter, searchBase, searchScope]);

  if (!feature.implemented) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          {feature.name}
        </Typography>
        <Chip label="Coming soon" size="small" sx={{ mt: 1, mb: 1 }} />
        <Typography variant="body2" color="text.secondary">
          {feature.description}
        </Typography>
      </Box>
    );
  }

  const actions = featureActionsRef?.current;

  const handleSave = async () => {
    setActionError("");
    setSaveOk("");
    setSaving(true);
    try {
      if (isLdap && actions?.validateLdapFilter) {
        const validation = await actions.validateLdapFilter(ldapFilter, searchBase, searchScope);
        setValidationErrors(validation.errors || []);
        if (!validation.valid) return;
      }
      if (isInactiveUsers && clampInactiveUsersDaysInput(inactiveUsersDays) == null) {
        setActionError("Enter a valid inactive users threshold (days).");
        return;
      }
      await actions?.saveFeatureConfig(feature, {
        ldapFilter,
        searchBase,
        searchScope,
        enabled,
        inactiveUsersDays,
      });
      setSaveOk("Query saved.");
      onSaved?.();
    } catch (err) {
      const apiErrors = err.response?.data?.data?.errors;
      if (Array.isArray(apiErrors) && apiErrors.length) setValidationErrors(apiErrors);
      setActionError(err.response?.data?.message || err.message || "Failed to save query.");
    } finally {
      setSaving(false);
    }
  };

  const handleTestQuery = async () => {
    setTestError("");
    setTestResult(null);
    setTesting(true);
    try {
      if (actions?.validateLdapFilter) {
        const validation = await actions.validateLdapFilter(ldapFilter, searchBase, searchScope);
        setValidationErrors(validation.errors || []);
        if (!validation.valid) return;
      }
      const result = await actions?.testLdapQuery(ldapFilter, searchBase, searchScope);
      setTestResult(result);
    } catch (err) {
      const apiErrors = err.response?.data?.data?.errors;
      if (Array.isArray(apiErrors) && apiErrors.length) setValidationErrors(apiErrors);
      setTestError(err.response?.data?.message || err.message || "Test query failed.");
    } finally {
      setTesting(false);
    }
  };

  const handleRunScan = async () => {
    setActionError("");
    setSaving(true);
    try {
      if (isLdap && actions?.validateLdapFilter) {
        const validation = await actions.validateLdapFilter(ldapFilter, searchBase, searchScope);
        setValidationErrors(validation.errors || []);
        if (!validation.valid) return;
      }
      if (isInactiveUsers && clampInactiveUsersDaysInput(inactiveUsersDays) == null) {
        setActionError("Enter a valid inactive users threshold (days).");
        return;
      }
      if (!enabled) {
        setActionError("Enable this feature before running a scan.");
        return;
      }
      await actions?.runFeatureScan(feature, {
        ldapFilter,
        searchBase,
        searchScope,
        enabled,
        inactiveUsersDays,
      });
      onSaved?.();
    } catch (err) {
      const apiErrors = err.response?.data?.data?.errors;
      if (Array.isArray(apiErrors) && apiErrors.length) setValidationErrors(apiErrors);
      setActionError(err.response?.data?.message || err.message || "Failed to run scan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={800} gutterBottom>
        {feature.name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {feature.description}
      </Typography>

      <Divider sx={{ mb: 2 }} />

      <FeatureQueryConfigurationPanel
        feature={feature}
        application={application}
        ldapFilter={ldapFilter}
        searchBase={searchBase}
        searchScope={searchScope}
        onLdapFilterChange={(v) => {
          setLdapFilter(v);
          setValidationErrors([]);
          setTestResult(null);
          setSaveOk("");
        }}
        onSearchBaseChange={(v) => {
          setSearchBase(v);
          setTestResult(null);
          setSaveOk("");
        }}
        onSearchScopeChange={(v) => {
          setSearchScope(v);
          setTestResult(null);
          setSaveOk("");
        }}
        validationErrors={validationErrors}
        busy={busy}
        testing={testing}
        saving={saving}
        isRunningThis={isRunningThis}
        scanRunning={scanRunning}
        enabled={enabled}
        readOnly={readOnly}
        onTestQuery={handleTestQuery}
        onSave={handleSave}
        onRunScan={handleRunScan}
        testResult={isLdap ? testResult : null}
        testError={isLdap ? testError : ""}
        actionError={isLdap ? actionError : ""}
        saveOk={isLdap ? saveOk : ""}
        onClearTestError={() => setTestError("")}
        onClearActionError={() => setActionError("")}
        onClearSaveOk={() => setSaveOk("")}
      />

      {isInactiveUsers && (
        <Box sx={{ mb: 2, mt: isLdap ? 0 : 1 }}>
          <InactiveUsersThresholdField
            value={inactiveUsersDays}
            onChange={setInactiveUsersDays}
            disabled={busy || readOnly}
          />
        </Box>
      )}

      {!isLdap && (
        <>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            {!readOnly && (
              <Button
                size="small"
                variant="outlined"
                startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />}
                onClick={handleSave}
                disabled={busy}
              >
                Save
              </Button>
            )}
            <Button
              size="small"
              variant="contained"
              startIcon={
                isRunningThis ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />
              }
              onClick={handleRunScan}
              disabled={!enabled || scanRunning || readOnly}
            >
              {isRunningThis ? "Running…" : "Run feature scan"}
            </Button>
          </Stack>
          {saveOk && (
            <Alert severity="success" sx={{ mb: 1 }} onClose={() => setSaveOk("")}>
              {saveOk}
            </Alert>
          )}
          {actionError && (
            <Alert severity="error" sx={{ mb: 1 }} onClose={() => setActionError("")}>
              {actionError}
            </Alert>
          )}
        </>
      )}
    </Box>
  );
}
