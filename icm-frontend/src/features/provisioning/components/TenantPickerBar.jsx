import { Alert, FormControl, InputLabel, MenuItem, Select, Stack } from "@mui/material";
import { tenantLabel } from "../hooks/useProvisioningTenant";

/**
 * Platform admins have no tenant in their JWT, so every provisioning call would
 * 400 without an explicit choice. Tenant-bound users never see this.
 */
export default function TenantPickerBar({
  needsTenantPicker,
  tenants,
  effectiveTenantId,
  onSelectTenant,
}) {
  if (!needsTenantPicker) return null;

  return (
    <Stack spacing={1.5} sx={{ mb: 2.5 }}>
      <FormControl size="small" sx={{ maxWidth: 360 }}>
        <InputLabel id="provisioning-tenant-label">Tenant</InputLabel>
        <Select
          labelId="provisioning-tenant-label"
          label="Tenant"
          value={effectiveTenantId || ""}
          onChange={(event) => onSelectTenant(event.target.value)}
        >
          <MenuItem value="">
            <em>Select a tenant…</em>
          </MenuItem>
          {tenants.map((tenant) => (
            <MenuItem key={tenant._id} value={String(tenant._id)}>
              {tenantLabel(tenant)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {!effectiveTenantId && (
        <Alert severity="info" sx={{ maxWidth: 720 }}>
          Choose a tenant to view its provisioning rules and lifecycle requests.
        </Alert>
      )}
    </Stack>
  );
}
