import {
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  Stack,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  CircularProgress,
  MenuItem,
} from "@mui/material";
import ScienceIcon from "@mui/icons-material/Science";
import SaveIcon from "@mui/icons-material/Save";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

const SEARCH_SCOPE_OPTIONS = [
  { value: "Subtree", label: "Subtree" },
  { value: "OneLevel", label: "OneLevel" },
  { value: "Base", label: "Base" },
];

/**
 * Reusable LDAP / GRAPH / POWERSHELL / HYBRID query configuration panel.
 */
export default function FeatureQueryConfigurationPanel({
  feature,
  application,
  ldapFilter,
  searchBase,
  searchScope,
  onLdapFilterChange,
  onSearchBaseChange,
  onSearchScopeChange,
  validationErrors = [],
  busy = false,
  testing = false,
  saving = false,
  isRunningThis = false,
  scanRunning = false,
  enabled = true,
  readOnly = false,
  onTestQuery,
  onSave,
  onRunScan,
  testResult = null,
  testError = "",
  actionError = "",
  saveOk = "",
  onClearTestError,
  onClearActionError,
  onClearSaveOk,
}) {
  const executionMode = String(feature?.executionMode || "").toUpperCase();
  const isLdap = executionMode === "LDAP";
  const isHybrid = executionMode === "HYBRID";
  const isPowershell = executionMode === "POWERSHELL";
  const supportsSearchBase =
    feature?.supportsSearchBase === true || isLdap || isHybrid;
  const showLdapEditor = isLdap || isHybrid || supportsSearchBase;

  const searchBasePlaceholder =
    feature?.defaultSearchBaseDn ||
    application?.connectionConfig?.ad?.baseDn ||
    "Leave empty to use application Base DN";

  if (!showLdapEditor) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        {isPowershell
          ? "Evaluated using connector PowerShell collection."
          : "Evaluated from Identity Graph after synchronization."}
      </Alert>
    );
  }

  return (
    <>
      {isHybrid && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Identity Graph analysis with optional Search Base scoping (same LDAP Query
          Framework as other posture modules). Leave Search Base empty to use the
          application Base DN.
        </Alert>
      )}

      <Typography variant="caption" fontWeight={700} color="text.secondary">
        SEARCH BASE
      </Typography>
      <TextField
        fullWidth
        multiline
        minRows={2}
        maxRows={6}
        size="small"
        placeholder={searchBasePlaceholder}
        value={searchBase}
        onChange={(e) => onSearchBaseChange?.(e.target.value)}
        disabled={busy || readOnly}
        sx={{
          mt: 0.75,
          mb: 1.5,
          "& textarea": { fontFamily: "monospace", fontSize: "0.8rem", lineHeight: 1.45 },
        }}
      />

      <Typography variant="caption" fontWeight={700} color="text.secondary">
        SEARCH SCOPE
      </Typography>
      <TextField
        select
        fullWidth
        size="small"
        value={searchScope || "Subtree"}
        onChange={(e) => onSearchScopeChange?.(e.target.value)}
        disabled={busy || readOnly}
        sx={{ mt: 0.75, mb: 1.5 }}
      >
        {SEARCH_SCOPE_OPTIONS.map((opt) => (
          <MenuItem key={opt.value} value={opt.value}>
            {opt.label}
          </MenuItem>
        ))}
      </TextField>

      <Typography variant="caption" fontWeight={700} color="text.secondary">
        LDAP QUERY
      </Typography>
      <TextField
        fullWidth
        multiline
        minRows={5}
        maxRows={12}
        size="small"
        placeholder={feature?.defaultLdapFilter || feature?.defaultFilter || ""}
        value={ldapFilter}
        onChange={(e) => onLdapFilterChange?.(e.target.value)}
        disabled={busy || readOnly}
        sx={{
          mt: 0.75,
          mb: 1,
          "& textarea": { fontFamily: "monospace", fontSize: "0.8rem", lineHeight: 1.45 },
        }}
      />

      {validationErrors.map((msg) => (
        <Alert key={msg} severity="error" sx={{ mb: 1 }}>
          {msg}
        </Alert>
      ))}

      {readOnly && (
        <Alert severity="info" sx={{ mb: 1, mt: 1 }}>
          This Assessment Version is read-only. Configuration is frozen. Execute to create a new
          execution against this snapshot.
        </Alert>
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1, mt: 1 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={testing ? <CircularProgress size={14} /> : <ScienceIcon />}
          onClick={onTestQuery}
          disabled={busy || readOnly || !String(ldapFilter || "").trim()}
        >
          Test query
        </Button>
        {!readOnly && (
          <Button
            size="small"
            variant="outlined"
            startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />}
            onClick={onSave}
            disabled={busy}
          >
            Save query
          </Button>
        )}
        <Button
          size="small"
          variant="contained"
          startIcon={
            isRunningThis ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />
          }
          onClick={onRunScan}
          disabled={!enabled || scanRunning || readOnly}
        >
          {isRunningThis ? "Running…" : "Run feature scan"}
        </Button>
      </Stack>

      {saveOk && (
        <Alert severity="success" sx={{ mb: 1 }} onClose={onClearSaveOk}>
          {saveOk}
        </Alert>
      )}
      {testError && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={onClearTestError}>
          {testError}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={onClearActionError}>
          {actionError}
        </Alert>
      )}

      {testResult && (
        <Box sx={{ mt: 1 }}>
          <Alert severity="success" sx={{ mb: 1 }}>
            Query matched {testResult.objectCount?.toLocaleString?.() ?? testResult.objectCount}{" "}
            object{testResult.objectCount === 1 ? "" : "s"}.
            {testResult.truncated ? " (count capped at search limit)" : ""}
          </Alert>
          {testResult.sample?.length > 0 && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Account</TableCell>
                  <TableCell>Display name</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {testResult.sample.map((row, idx) => (
                  <TableRow key={row.samAccountName || row.dn || idx}>
                    <TableCell sx={{ fontSize: "0.75rem" }}>
                      {row.samAccountName || "—"}
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.75rem" }}>{row.name || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Box>
      )}
    </>
  );
}
