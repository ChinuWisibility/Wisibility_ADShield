import { Box, Button, Grid, Paper, Stack, Typography, Skeleton } from "@mui/material";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import { useNavigate } from "react-router-dom";
import SecurityMetricCard from "./SecurityMetricCard";
import { useSecurityWorkspace } from "../../pages/security/SecurityWorkspaceContext";
import { isSecurityTileVisible } from "../../utils/securityDashboardTiles";

const PRIVILEGE_TILES = [
  {
    id: "priv_escalation_paths",
    title: "Escalation paths",
    getValue: (p) => p.priv.escalationPaths,
    path: "/security/privileged",
    feature: "privilege_escalation_paths",
  },
  {
    id: "priv_dormant_privileged",
    title: "Dormant privileged",
    getValue: (p) => p.priv.dormantPrivileged,
    path: "/security/privileged",
    feature: "dormant_privileged_users",
  },
  {
    id: "priv_excessive_privileges",
    title: "Excessive privileges",
    getValue: (p) => p.priv.excessivePrivileges,
    path: "/security/privileged",
    feature: "excessive_privileges",
  },
  {
    id: "priv_nested_privileged",
    title: "Nested privileged",
    getValue: (p) => p.priv.nestedPrivileged,
    path: "/security/privileged",
    feature: "nested_privileged_access",
  },
  {
    id: "priv_toxic_combinations",
    title: "Toxic combinations",
    getValue: (p) => p.priv.toxicCombinations,
    path: "/security/groups",
    feature: "toxic_privilege_combinations",
  },
  {
    id: "priv_shadow_admins",
    title: "Shadow admins",
    getValue: (p) => p.acl.shadowAdmins,
    path: "/security/acl",
    feature: "shadow_admins",
  },
  {
    id: "priv_kerberoastable",
    title: "Kerberoastable",
    getValue: (p) => p.kerberos.kerberoastableAccounts,
    path: "/security/kerberos",
    feature: "kerberoastable_accounts",
  },
  {
    id: "priv_unconstrained_delegation",
    title: "Unconstrained del.",
    getValue: (p) => p.delegation.unconstrainedDelegation,
    path: "/security/delegation",
    feature: "unconstrained_delegation",
  },
  {
    id: "priv_rbcd",
    title: "RBCD",
    getValue: (p) => p.delegation.rbcd,
    path: "/security/delegation",
    feature: "rbcd",
  },
];

/**
 * Hero privilege-exposure zone — strongest AD Security Posture differentiator.
 */
export default function PrivilegeExposurePanel({ loading = false, tilePrefs = null }) {
  const navigate = useNavigate();
  const { overview, buildPath } = useSecurityWorkspace();
  const ctx = {
    priv: overview?.privilegedSummary || {},
    acl: overview?.aclSummary || {},
    kerberos: overview?.kerberosSummary || {},
    delegation: overview?.delegationSummary || {},
  };

  const visible = PRIVILEGE_TILES.filter((t) =>
    isSecurityTileVisible(tilePrefs, t.id, t.getValue(ctx) ?? 0),
  );

  if (!isSecurityTileVisible(tilePrefs, "privilege_exposure", 1)) {
    return null;
  }

  if (!loading && visible.length === 0) {
    return null;
  }

  const go = (path, feature) => navigate(buildPath(path, feature ? { feature } : {}));

  return (
    <Paper
      sx={{
        p: 2.5,
        mb: 2,
        border: 1,
        borderColor: "error.light",
        bgcolor: "rgba(183, 28, 28, 0.04)",
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <AdminPanelSettingsIcon color="error" />
            <Typography variant="h6" fontWeight={800}>
              Privilege exposure
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Escalation paths, nested privilege, shadow admins, and attack-surface exposures from this assessment
          </Typography>
        </Box>
        <Button
          variant="contained"
          color="error"
          size="small"
          sx={{ textTransform: "none" }}
          onClick={() => go("/security/privileged")}
        >
          Investigate privileged access
        </Button>
      </Stack>

      {loading ? (
        <Skeleton height={120} />
      ) : (
        <Grid container spacing={1.5}>
          {visible.map((tile) => (
            <Grid item xs={6} sm={4} md={2} key={tile.id}>
              <SecurityMetricCard
                title={tile.title}
                value={tile.getValue(ctx)}
                onClick={() => go(tile.path, tile.feature)}
              />
            </Grid>
          ))}
        </Grid>
      )}
    </Paper>
  );
}
