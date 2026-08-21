import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBack from "@mui/icons-material/ArrowBack";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import RuleOutlinedIcon from "@mui/icons-material/RuleOutlined";
import { useSnackbar } from "notistack";
import api from "../../../services/api";
import { remediationWorkflowRulesApi } from "../../../features/remediation-events/services/api";
import {
  REMEDIATION_WORKFLOW_ACTIONS,
  emptyWorkflowMappings,
} from "../../../features/remediation-events/constants";
import RemediationWorkflowRuleCard from "./components/RemediationWorkflowRuleCard";

const ORG_ADMIN_BASE = "/org-admin";

function buildMappingRows(workflows, mappingIds) {
  return REMEDIATION_WORKFLOW_ACTIONS.map((action) => {
    const workflowId = mappingIds[action.value];
    if (!workflowId) return null;
    const wf = workflows.find((w) => w.id === workflowId);
    return {
      action: action.value,
      workflowId,
      workflowName: wf?.name || "",
      enabled: true,
    };
  }).filter(Boolean);
}

export default function RemediationWorkflowRules() {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [workflows, setWorkflows] = useState([]);
  const [savedMappings, setSavedMappings] = useState(emptyWorkflowMappings);
  const [savedNames, setSavedNames] = useState(emptyWorkflowMappings);
  const [draftMappings, setDraftMappings] = useState(emptyWorkflowMappings);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savingAction, setSavingAction] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [wfRes, rulesRes] = await Promise.all([
        api.get("/remediation-workflows/workflows/enabled"),
        remediationWorkflowRulesApi.get(),
      ]);
      const wfList = wfRes.data?.data || [];
      setWorkflows(wfList);
      const actionMappings = rulesRes.data?.data?.actionMappings || [];
      const ids = emptyWorkflowMappings();
      const names = emptyWorkflowMappings();
      for (const row of actionMappings) {
        if (row.action && row.workflowId) {
          ids[row.action] = row.workflowId;
          names[row.action] = row.workflowName || "";
        }
      }
      setSavedMappings(ids);
      setSavedNames(names);
      setDraftMappings(ids);
    } catch (e) {
      setLoadError(e.response?.data?.message || "Failed to load remediation workflow rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirtyActions = useMemo(
    () =>
      REMEDIATION_WORKFLOW_ACTIONS.filter(
        (action) => draftMappings[action.value] !== savedMappings[action.value],
      ).map((a) => a.value),
    [draftMappings, savedMappings],
  );

  const configuredCount = useMemo(
    () => REMEDIATION_WORKFLOW_ACTIONS.filter((a) => savedMappings[a.value]).length,
    [savedMappings],
  );

  function handleDraftChange(actionValue, workflowId) {
    setDraftMappings((prev) => ({ ...prev, [actionValue]: workflowId }));
  }

  function handleReset(actionValue) {
    setDraftMappings((prev) => ({ ...prev, [actionValue]: savedMappings[actionValue] || "" }));
  }

  async function handleSave(actionValue) {
    setSavingAction(actionValue);
    try {
      const mergedIds = { ...savedMappings, [actionValue]: draftMappings[actionValue] || "" };
      const actionMappings = buildMappingRows(workflows, mergedIds);
      await remediationWorkflowRulesApi.put(actionMappings);

      const wf = workflows.find((w) => w.id === draftMappings[actionValue]);
      setSavedMappings((prev) => ({ ...prev, [actionValue]: draftMappings[actionValue] || "" }));
      setSavedNames((prev) => ({
        ...prev,
        [actionValue]: wf?.name || (draftMappings[actionValue] ? prev[actionValue] : ""),
      }));

      const label = REMEDIATION_WORKFLOW_ACTIONS.find((a) => a.value === actionValue)?.label;
      enqueueSnackbar(
        draftMappings[actionValue]
          ? `${label} workflow mapping saved.`
          : `${label} mapping cleared.`,
        { variant: "success" },
      );
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || "Failed to save mapping", { variant: "error" });
    } finally {
      setSavingAction(null);
    }
  }

  return (
    <Box sx={{ minHeight: "100%", bgcolor: "#f8fafc" }}>
      <Box sx={{ px: { xs: 2, sm: 3 }, py: 2.5, maxWidth: 1280, mx: "auto" }}>
        <Button
          startIcon={<ArrowBack fontSize="small" />}
          onClick={() => navigate(`${ORG_ADMIN_BASE}/global-rule-set`)}
          size="small"
          sx={{ mb: 2, color: "text.secondary", textTransform: "none" }}
        >
          Global rule set
        </Button>

        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", md: "flex-end" }}
          sx={{ mb: 3 }}
        >
          <Box>
            <Typography variant="h5" fontWeight={700} letterSpacing="-0.02em">
              Remediation workflow rules
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
              Assign a default enabled workflow per remediation event. Operators never choose workflows
              at runtime — the queue resolves routing from these rules automatically.
            </Typography>
          </Box>

          {!loading && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                icon={<RuleOutlinedIcon />}
                label={`${REMEDIATION_WORKFLOW_ACTIONS.length} event types`}
                size="small"
                variant="outlined"
                sx={{ fontWeight: 600 }}
              />
              <Chip
                icon={<AccountTreeOutlinedIcon />}
                label={`${configuredCount} configured`}
                size="small"
                color={configuredCount === REMEDIATION_WORKFLOW_ACTIONS.length ? "success" : "default"}
                variant="outlined"
                sx={{ fontWeight: 600 }}
              />
              {dirtyActions.length > 0 && (
                <Chip
                  label={`${dirtyActions.length} unsaved`}
                  size="small"
                  color="warning"
                  variant="filled"
                  sx={{ fontWeight: 600 }}
                />
              )}
            </Stack>
          )}
        </Stack>

        {loadError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {loadError}
          </Alert>
        )}

        {workflows.length === 0 && !loading && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            No enabled workflows found. Create and enable workflows under Governance → Workflows before
            assigning mappings.
          </Alert>
        )}

        {loading ? (
          <Box sx={{ py: 10, display: "flex", justifyContent: "center" }}>
            <CircularProgress />
          </Box>
        ) : (
          <Grid container spacing={2.5}>
            {REMEDIATION_WORKFLOW_ACTIONS.map((action) => (
              <Grid item xs={12} lg={6} key={action.value}>
                <RemediationWorkflowRuleCard
                  action={action}
                  workflows={workflows}
                  draftWorkflowId={draftMappings[action.value] || ""}
                  savedWorkflowId={savedMappings[action.value] || ""}
                  savedWorkflowName={savedNames[action.value] || ""}
                  isDirty={dirtyActions.includes(action.value)}
                  isSaving={savingAction === action.value}
                  onDraftChange={handleDraftChange}
                  onSave={handleSave}
                  onReset={handleReset}
                />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    </Box>
  );
}
