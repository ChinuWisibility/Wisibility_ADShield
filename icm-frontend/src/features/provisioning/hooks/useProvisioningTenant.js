import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { tenantAPI } from "../../../services/api";

/**
 * Shared with the Workflows feature on purpose: switching between Workflows and
 * Provisioning should not silently change which tenant you are looking at.
 */
export const TENANT_STORAGE_KEY = "iga_workflows_tenant_id";

function resolveUserTenantId(user) {
  if (!user?.tenantId) return null;
  return typeof user.tenantId === "object"
    ? String(user.tenantId._id || user.tenantId.id || "")
    : String(user.tenantId);
}

export function tenantLabel(tenant) {
  if (!tenant) return "";
  const name = tenant.name || tenant.code || "Tenant";
  return tenant.code && tenant.name ? `${tenant.name} (${tenant.code})` : name;
}

/**
 * Resolves the tenant every provisioning call must be scoped to. A tenant-bound
 * user is pinned to their JWT tenant; a platform admin picks one and the choice
 * is mirrored into the URL so the page is shareable and survives reload.
 */
export function useProvisioningTenant() {
  const { user, isPlatformAdmin } = useAuth();
  const userTenantId = resolveUserTenantId(user);
  const [searchParams, setSearchParams] = useSearchParams();
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState(() => {
    if (userTenantId) return userTenantId;
    return searchParams.get("tenantId") || sessionStorage.getItem(TENANT_STORAGE_KEY) || "";
  });

  const effectiveTenantId = userTenantId || selectedTenantId || "";
  const needsTenantPicker = isPlatformAdmin && !userTenantId;

  useEffect(() => {
    if (!needsTenantPicker) return;
    let cancelled = false;
    tenantAPI
      .list()
      .then((res) => {
        if (cancelled) return;
        const rows = res.data?.data?.items || res.data?.data || res.data?.items || [];
        setTenants(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setTenants([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsTenantPicker]);

  useEffect(() => {
    if (!effectiveTenantId) return;
    sessionStorage.setItem(TENANT_STORAGE_KEY, effectiveTenantId);
    if (searchParams.get("tenantId") === effectiveTenantId) return;
    const next = new URLSearchParams(searchParams);
    next.set("tenantId", effectiveTenantId);
    setSearchParams(next, { replace: true });
  }, [effectiveTenantId, searchParams, setSearchParams]);

  const tenantParams = useMemo(
    () => (effectiveTenantId ? { tenantId: effectiveTenantId } : {}),
    [effectiveTenantId],
  );

  const selectTenant = useCallback((tenantId) => {
    setSelectedTenantId(tenantId || "");
  }, []);

  return {
    effectiveTenantId,
    tenantParams,
    tenants,
    needsTenantPicker,
    selectTenant,
    userTenantId,
  };
}
