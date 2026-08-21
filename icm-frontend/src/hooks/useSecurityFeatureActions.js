import { useCallback } from "react";
import { securityAPI } from "../services/securityApi";
import { applicationAPI } from "../services/api";
import {
  buildInactiveUsersFeatureSettings,
  clampInactiveUsersDaysInput,
  readInactiveUsersDays,
} from "../utils/securityScanSettings";

function isLdapFeature(feature) {
  const mode = String(feature?.executionMode || "").toUpperCase();
  return mode === "LDAP" || mode === "HYBRID" || feature?.supportsSearchBase === true;
}

/**
 * Shared save / test / run actions for Scan Center feature configuration.
 * When assessmentId is set, edits go to Assessment Working Configuration.
 */
export function useSecurityFeatureActions({
  applicationId,
  assessmentId,
  application,
  onSaved,
  runScan,
}) {
  const saveFeatureConfig = useCallback(
    async (feature, { ldapFilter, searchBase, searchScope, enabled, inactiveUsersDays }) => {
      const hasLdap = isLdapFeature(feature);
      const payload = {
        ldapFilter: hasLdap ? ldapFilter : undefined,
        ...(hasLdap && searchBase !== undefined ? { searchBase } : {}),
        ...(hasLdap && searchScope !== undefined ? { searchScope } : {}),
        enabled,
      };

      if (assessmentId) {
        if (feature.featureKey === "inactive_users") {
          const clamped =
            clampInactiveUsersDaysInput(inactiveUsersDays) ??
            readInactiveUsersDays(application);
          if (clamped != null) {
            payload.featureSettings = { inactiveUsersDays: clamped };
          }
        }
        await securityAPI.upsertWorkingFeature(
          applicationId,
          assessmentId,
          feature.featureKey,
          payload,
        );
      } else {
        await securityAPI.upsertFeatureConfig(applicationId, feature.featureKey, payload);
        if (feature.featureKey === "inactive_users") {
          const clamped =
            clampInactiveUsersDaysInput(inactiveUsersDays) ??
            readInactiveUsersDays(application);
          if (clamped != null) {
            await applicationAPI.patchSecurityScanSettings(applicationId, {
              inactiveUsersDays: clamped,
            });
          }
        }
      }

      onSaved?.();
    },
    [applicationId, assessmentId, application, onSaved],
  );

  const validateLdapFilter = useCallback(async (ldapFilter, searchBase, searchScope) => {
    const res = await securityAPI.validateLdapQuery({
      ldapFilter,
      searchBase,
      searchScope,
    });
    return res.data?.data ?? res.data;
  }, []);

  const testLdapQuery = useCallback(
    async (ldapFilter, searchBase, searchScope) => {
      const res = await securityAPI.testLdapQuery(applicationId, {
        ldapFilter,
        searchBase,
        searchScope,
      });
      return res.data?.data ?? res.data;
    },
    [applicationId],
  );

  const buildFeatureScanBody = useCallback((feature, inactiveUsersDays) => {
    const body = {
      features: [feature.featureKey],
      scanSource: "security_center",
    };
    if (feature.featureKey === "inactive_users") {
      body.featureSettings = buildInactiveUsersFeatureSettings(inactiveUsersDays);
    }
    return body;
  }, []);

  const runFeatureScan = useCallback(
    async (feature, { ldapFilter, searchBase, searchScope, enabled, inactiveUsersDays }) => {
      await saveFeatureConfig(feature, {
        ldapFilter,
        searchBase,
        searchScope,
        enabled,
        inactiveUsersDays,
      });
      const body = buildFeatureScanBody(feature, inactiveUsersDays);
      return runScan({ body });
    },
    [saveFeatureConfig, buildFeatureScanBody, runScan],
  );

  const runFullScan = useCallback(
    async (features, app) => {
      const enabled = (features || []).filter((f) => f.enabled && f.implemented !== false);
      if (!enabled.length) {
        throw new Error("Enable at least one implemented feature before executing.");
      }
      const body = {
        features: enabled.map((f) => f.featureKey),
        scanSource: "security_center",
      };
      const inactive = features.find((f) => f.featureKey === "inactive_users" && f.enabled);
      if (inactive) {
        body.featureSettings = buildInactiveUsersFeatureSettings(
          readInactiveUsersDays(app),
        );
      }
      return runScan({ body });
    },
    [runScan],
  );

  const toggleFeatureEnabled = useCallback(
    async (feature, enabled) => {
      await saveFeatureConfig(feature, {
        ldapFilter: feature.ldapFilter,
        searchBase: feature.searchBase,
        searchScope: feature.searchScope,
        enabled,
        inactiveUsersDays: readInactiveUsersDays(application),
      });
    },
    [saveFeatureConfig, application],
  );

  return {
    saveFeatureConfig,
    validateLdapFilter,
    testLdapQuery,
    runFeatureScan,
    runFullScan,
    toggleFeatureEnabled,
    getPendingFeatureConfig: () => null,
  };
}
