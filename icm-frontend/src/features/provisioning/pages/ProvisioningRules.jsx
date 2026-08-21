import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import RuleFolderOutlinedIcon from "@mui/icons-material/RuleFolderOutlined";
import { useSnackbar } from "notistack";
import { applicationAPI, identityProfileAPI } from "../../../services/api";
import { apiErrorMessage, provisioningApi } from "../services/api";
import { useProvisioningTenant } from "../hooks/useProvisioningTenant";
import TenantPickerBar from "../components/TenantPickerBar";
import ConditionValueField from "../components/ConditionValueField";

const CONDITION_OPERATORS = [
  { value: "equals", label: "equals" },
  { value: "notEquals", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "notContains", label: "does not contain" },
  { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" },
  { value: "regex", label: "matches regex" },
];

const EMPTY_RULE = {
  name: "",
  description: "",
  enabled: true,
  priority: 100,
  identityProfileId: "",
  conditionLogic: "AND",
  conditions: [{ field: "", operator: "equals", value: "", caseSensitive: false }],
  actions: [{ type: "ENSURE_ACCOUNT", applicationId: "" }],
};

export default function ProvisioningRules() {
  const { enqueueSnackbar } = useSnackbar();
  const { effectiveTenantId, tenantParams, tenants, needsTenantPicker, selectTenant } =
    useProvisioningTenant();

  const [rules, setRules] = useState([]);
  const [applications, setApplications] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [profileFields, setProfileFields] = useState([]);
  const [profileFieldsLoading, setProfileFieldsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const applicationsById = useMemo(
    () => new Map(applications.map((app) => [String(app._id), app])),
    [applications],
  );
  const profilesById = useMemo(
    () => new Map(profiles.map((profile) => [String(profile._id), profile])),
    [profiles],
  );
  const selectedProfileId = editor?.draft.identityProfileId || "";

  const loadRules = useCallback(() => {
    if (!effectiveTenantId) {
      setRules([]);
      return;
    }
    setLoading(true);
    setLoadError("");
    provisioningApi
      .listRules(tenantParams)
      .then((res) => setRules(res.data?.data || []))
      .catch((error) => {
        setRules([]);
        setLoadError(apiErrorMessage(error, "Could not load provisioning rules."));
      })
      .finally(() => setLoading(false));
  }, [effectiveTenantId, tenantParams]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  useEffect(() => {
    if (!effectiveTenantId) {
      setApplications([]);
      return;
    }
    let cancelled = false;
    applicationAPI
      .list({ tenantId: effectiveTenantId, limit: 500, page: 1 })
      .then((res) => {
        if (cancelled) return;
        const raw = res.data?.data ?? res.data?.applications ?? res.data;
        const list = Array.isArray(raw) ? raw : raw?.items || [];
        setApplications(list);
      })
      .catch(() => {
        if (!cancelled) setApplications([]);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveTenantId]);

  useEffect(() => {
    if (!effectiveTenantId) {
      setProfiles([]);
      return;
    }
    let cancelled = false;
    identityProfileAPI
      .list({ tenantId: effectiveTenantId })
      .then((res) => {
        if (cancelled) return;
        setProfiles((res.data?.data || []).filter((profile) => profile.attributeMappings?.length));
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveTenantId]);

  useEffect(() => {
    if (!selectedProfileId || !effectiveTenantId) {
      setProfileFields([]);
      return;
    }
    let cancelled = false;
    setProfileFieldsLoading(true);
    identityProfileAPI
      .getCreateSchema(selectedProfileId, { tenantId: effectiveTenantId })
      .then((res) => {
        if (cancelled) return;
        setProfileFields(res.data?.data?.fields || []);
      })
      .catch(() => {
        if (!cancelled) setProfileFields([]);
      })
      .finally(() => {
        if (!cancelled) setProfileFieldsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveTenantId, selectedProfileId]);

  const openCreate = () => setEditor({ mode: "create", draft: structuredClone(EMPTY_RULE) });

  const openEdit = (rule) =>
    setEditor({
      mode: "edit",
      id: rule._id,
      draft: {
        name: rule.name || "",
        description: rule.description || "",
        enabled: rule.enabled !== false,
        priority: rule.priority ?? 100,
        identityProfileId: rule.identityProfileId ? String(rule.identityProfileId) : "",
        conditionLogic: rule.conditionLogic || "AND",
        conditions: (rule.conditions?.length ? rule.conditions : EMPTY_RULE.conditions).map((c) => ({
          field: c.field || "",
          operator: c.operator || "equals",
          value: c.value || "",
          caseSensitive: Boolean(c.caseSensitive),
        })),
        actions: (rule.actions?.length ? rule.actions : EMPTY_RULE.actions).map((a) => ({
          type: a.type || "ENSURE_ACCOUNT",
          applicationId: a.applicationId ? String(a.applicationId) : "",
        })),
      },
    });

  const patchDraft = (patch) =>
    setEditor((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev));

  const patchCondition = (index, patch) =>
    setEditor((prev) => {
      if (!prev) return prev;
      const conditions = prev.draft.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c));
      return { ...prev, draft: { ...prev.draft, conditions } };
    });

  const patchAction = (index, patch) =>
    setEditor((prev) => {
      if (!prev) return prev;
      const actions = prev.draft.actions.map((a, i) => (i === index ? { ...a, ...patch } : a));
      return { ...prev, draft: { ...prev.draft, actions } };
    });

  const validationError = useMemo(() => {
    if (!editor) return "";
    const { draft } = editor;
    if (!draft.name.trim()) return "Give the rule a name.";
    if (!draft.identityProfileId) return "Select the identity profile this rule applies to.";
    if (!draft.conditions.length) return "Add at least one condition.";
    if (draft.conditions.some((c) => !c.field.trim() || !String(c.value).trim())) {
      return "Every condition needs a field and a value.";
    }
    if (!draft.actions.length) return "Add at least one action.";
    if (draft.actions.some((a) => !a.applicationId)) {
      return "Every action needs a target application.";
    }
    return "";
  }, [editor]);

  const saveRule = async () => {
    if (!editor || validationError) return;
    setSaving(true);
    const body = {
      ...editor.draft,
      priority: Number(editor.draft.priority) || 100,
    };
    try {
      if (editor.mode === "create") {
        await provisioningApi.createRule(body, tenantParams);
        enqueueSnackbar("Provisioning rule created", { variant: "success" });
      } else {
        await provisioningApi.updateRule(editor.id, body, tenantParams);
        enqueueSnackbar("Provisioning rule updated", { variant: "success" });
      }
      setEditor(null);
      loadRules();
    } catch (error) {
      enqueueSnackbar(apiErrorMessage(error, "Could not save the rule."), { variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (rule) => {
    setDeletingId(rule._id);
    try {
      await provisioningApi.removeRule(rule._id, tenantParams);
      enqueueSnackbar(`Deleted "${rule.name}"`, { variant: "success" });
      loadRules();
    } catch (error) {
      enqueueSnackbar(apiErrorMessage(error, "Could not delete the rule."), { variant: "error" });
    } finally {
      setDeletingId(null);
    }
  };

  const applicationName = (id) => {
    const app = applicationsById.get(String(id));
    return app?.name || app?.applicationName || String(id || "");
  };

  return (
    <Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h6" fontWeight={700}>
            Provisioning rules
          </Typography>
          <Typography variant="body2" color="text.secondary">
            When a Joiner is detected, matching rules decide which applications the identity
            should have an account in.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<RefreshIcon />} onClick={loadRules} disabled={!effectiveTenantId}>
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={openCreate}
            disabled={!effectiveTenantId}
          >
            New rule
          </Button>
        </Stack>
      </Stack>

      <TenantPickerBar
        needsTenantPicker={needsTenantPicker}
        tenants={tenants}
        effectiveTenantId={effectiveTenantId}
        onSelectTenant={selectTenant}
      />

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError}
        </Alert>
      )}

      <Paper variant="outlined">
        {loading ? (
          <Box sx={{ p: 6, display: "flex", justifyContent: "center" }}>
            <CircularProgress size={28} />
          </Box>
        ) : !rules.length ? (
          <Box sx={{ p: 6, textAlign: "center" }}>
            <RuleFolderOutlinedIcon sx={{ fontSize: 44, color: "text.disabled", mb: 1 }} />
            <Typography variant="subtitle1" fontWeight={600}>
              No provisioning rules yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {effectiveTenantId
                ? "Without a rule, a Joiner is detected but no account is ever requested."
                : "Select a tenant to see its rules."}
            </Typography>
            {effectiveTenantId && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
                Create the first rule
              </Button>
            )}
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Rule</TableCell>
                <TableCell>Conditions</TableCell>
                <TableCell>Provisions into</TableCell>
                <TableCell align="center">Priority</TableCell>
                <TableCell align="center">Enabled</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule._id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {rule.name}
                    </Typography>
                    {rule.identityProfileId && (
                      <Typography variant="caption" color="primary.main" display="block">
                        {profilesById.get(String(rule.identityProfileId))?.name
                          || "Identity profile"}
                      </Typography>
                    )}
                    {rule.description && (
                      <Typography variant="caption" color="text.secondary">
                        {rule.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.5}>
                      {(rule.conditions || []).map((condition, index) => (
                        <Typography key={index} variant="caption" color="text.secondary">
                          {index > 0 && <strong>{rule.conditionLogic || "AND"} </strong>}
                          {condition.field} {condition.operator} &ldquo;{condition.value}&rdquo;
                        </Typography>
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {(rule.actions || []).map((action, index) => (
                        <Chip
                          key={index}
                          size="small"
                          variant="outlined"
                          label={applicationName(action.applicationId)}
                        />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell align="center">{rule.priority ?? 100}</TableCell>
                  <TableCell align="center">
                    <Chip
                      size="small"
                      label={rule.enabled === false ? "Disabled" : "Enabled"}
                      color={rule.enabled === false ? "default" : "success"}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit rule">
                      <IconButton size="small" onClick={() => openEdit(rule)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete rule">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => removeRule(rule)}
                          disabled={deletingId === rule._id}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Dialog open={Boolean(editor)} onClose={() => setEditor(null)} maxWidth="md" fullWidth>
        <DialogTitle>{editor?.mode === "create" ? "New provisioning rule" : "Edit rule"}</DialogTitle>
        <DialogContent dividers>
          {editor && (
            <Stack spacing={2.5} sx={{ pt: 1 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="Rule name"
                  value={editor.draft.name}
                  onChange={(event) => patchDraft({ name: event.target.value })}
                  fullWidth
                  size="small"
                  required
                />
                <TextField
                  label="Priority"
                  type="number"
                  value={editor.draft.priority}
                  onChange={(event) => patchDraft({ priority: event.target.value })}
                  size="small"
                  sx={{ width: { xs: "100%", sm: 140 } }}
                  helperText="Lower runs first"
                />
              </Stack>

              <TextField
                label="Description"
                value={editor.draft.description}
                onChange={(event) => patchDraft({ description: event.target.value })}
                fullWidth
                size="small"
                multiline
                minRows={2}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={editor.draft.enabled}
                    onChange={(event) => patchDraft({ enabled: event.target.checked })}
                  />
                }
                label="Rule is enabled"
              />

              <Divider textAlign="left">
                <Typography variant="overline" color="text.secondary">
                  Who it applies to
                </Typography>
              </Divider>

              <TextField
                select
                fullWidth
                size="small"
                required
                label="Identity profile"
                value={editor.draft.identityProfileId}
                onChange={(event) =>
                  patchDraft({
                    identityProfileId: event.target.value,
                    conditions: editor.draft.conditions.map((condition) => ({
                      ...condition,
                      field: "",
                      value: "",
                    })),
                  })
                }
                helperText="Condition fields come from this profile's published attribute mappings."
              >
                {profiles.map((profile) => (
                  <MenuItem key={profile._id} value={String(profile._id)}>
                    {profile.name}
                    {profile.sourceApplicationId?.name
                      ? ` — ${profile.sourceApplicationId.name}`
                      : ""}
                  </MenuItem>
                ))}
              </TextField>

              <FormControl size="small" sx={{ maxWidth: 240 }}>
                <InputLabel id="condition-logic-label">Match</InputLabel>
                <Select
                  labelId="condition-logic-label"
                  label="Match"
                  value={editor.draft.conditionLogic}
                  onChange={(event) => patchDraft({ conditionLogic: event.target.value })}
                >
                  <MenuItem value="AND">All conditions (AND)</MenuItem>
                  <MenuItem value="OR">Any condition (OR)</MenuItem>
                </Select>
              </FormControl>

              {editor.draft.conditions.map((condition, index) => (
                <Stack key={index} direction={{ xs: "column", md: "row" }} spacing={1.5}>
                  <TextField
                    label="Identity field"
                    value={condition.field}
                    onChange={(event) =>
                      // The value picker is scoped to the field, so a stale value can't carry over.
                      patchCondition(index, { field: event.target.value, value: "" })
                    }
                    size="small"
                    select
                    sx={{ minWidth: 200 }}
                    disabled={!selectedProfileId || profileFieldsLoading}
                    helperText={
                      profileFieldsLoading
                        ? "Loading profile fields…"
                        : !selectedProfileId
                          ? "Select an identity profile first"
                          : ""
                    }
                  >
                    {profileFields.map((field) => (
                      <MenuItem key={field.key} value={field.key}>
                        {field.label}
                        {field.isCustom ? ` (${field.key})` : ""}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Operator"
                    value={condition.operator}
                    onChange={(event) => patchCondition(index, { operator: event.target.value })}
                    size="small"
                    select
                    sx={{ minWidth: 180 }}
                  >
                    {CONDITION_OPERATORS.map((operator) => (
                      <MenuItem key={operator.value} value={operator.value}>
                        {operator.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <ConditionValueField
                    profileId={selectedProfileId}
                    tenantId={effectiveTenantId}
                    field={condition.field}
                    operator={condition.operator}
                    value={condition.value}
                    onChange={(next) => patchCondition(index, { value: next })}
                    disabled={!selectedProfileId || profileFieldsLoading}
                  />
                  <IconButton
                    onClick={() =>
                      patchDraft({
                        conditions: editor.draft.conditions.filter((_, i) => i !== index),
                      })
                    }
                    disabled={editor.draft.conditions.length === 1}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() =>
                  patchDraft({
                    conditions: [
                      ...editor.draft.conditions,
                      { field: "", operator: "equals", value: "", caseSensitive: false },
                    ],
                  })
                }
                disabled={!selectedProfileId}
                sx={{ alignSelf: "flex-start" }}
              >
                Add condition
              </Button>

              <Divider textAlign="left">
                <Typography variant="overline" color="text.secondary">
                  What they get
                </Typography>
              </Divider>

              {editor.draft.actions.map((action, index) => (
                <Stack key={index} direction={{ xs: "column", md: "row" }} spacing={1.5}>
                  <TextField
                    label="Action"
                    value={action.type}
                    onChange={(event) => patchAction(index, { type: event.target.value })}
                    size="small"
                    select
                    sx={{ minWidth: 220 }}
                  >
                    <MenuItem value="ENSURE_ACCOUNT">Ensure account exists</MenuItem>
                    <MenuItem value="DISABLE_ACCOUNT">Disable account</MenuItem>
                    <MenuItem value="ENABLE_ACCOUNT">Enable account</MenuItem>
                  </TextField>
                  <TextField
                    label="Application"
                    value={action.applicationId}
                    onChange={(event) => patchAction(index, { applicationId: event.target.value })}
                    size="small"
                    select
                    fullWidth
                    required
                  >
                    {applications.map((app) => (
                      <MenuItem key={app._id} value={String(app._id)}>
                        {app.name || app.applicationName}
                      </MenuItem>
                    ))}
                  </TextField>
                  <IconButton
                    onClick={() =>
                      patchDraft({ actions: editor.draft.actions.filter((_, i) => i !== index) })
                    }
                    disabled={editor.draft.actions.length === 1}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() =>
                  patchDraft({
                    actions: [...editor.draft.actions, { type: "ENSURE_ACCOUNT", applicationId: "" }],
                  })
                }
                sx={{ alignSelf: "flex-start" }}
              >
                Add application
              </Button>

              {validationError && <Alert severity="warning">{validationError}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={saveRule}
            disabled={saving || Boolean(validationError)}
          >
            {saving ? "Saving…" : "Save rule"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
