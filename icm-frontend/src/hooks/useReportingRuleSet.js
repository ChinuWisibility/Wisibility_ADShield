import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orgAdminAPI, reportAPI } from '../services/api';
import { mergeReportingRuleSetConfig } from '../constants/reportingRuleSetDefaults';

const TENANT_QUERY_KEY = ['reportingRuleSet', 'tenant'];
const effectiveKey = (tenantId, applicationId) => ['reportingRuleSet', 'effective', tenantId, applicationId];

export function useTenantReportingRuleSet() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: TENANT_QUERY_KEY,
    queryFn: async () => {
      const res = await orgAdminAPI.getReportingRuleSet();
      const d = res.data?.data;
      return mergeReportingRuleSetConfig(d?.config || d?.rules || d);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (config) => {
      const res = await orgAdminAPI.saveReportingRuleSet(config);
      return mergeReportingRuleSetConfig(res.data?.data?.config);
    },
    onSuccess: (config) => {
      queryClient.setQueryData(TENANT_QUERY_KEY, config);
      queryClient.invalidateQueries({ queryKey: ['reportingRuleSet'] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await orgAdminAPI.resetReportingRuleSet();
      return mergeReportingRuleSetConfig(res.data?.data?.config);
    },
    onSuccess: async (config) => {
      queryClient.setQueryData(TENANT_QUERY_KEY, config);
      await queryClient.invalidateQueries({ queryKey: ['reportingRuleSet'] });
      await queryClient.invalidateQueries({ queryKey: ['tenantRiskBand'] });
      await queryClient.invalidateQueries({ queryKey: ['governanceRiskBandSetting'] });
    },
  });

  return { query, saveMutation, resetMutation };
}

export function useEffectiveReportingRuleSet(tenantId, applicationId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: effectiveKey(tenantId, applicationId),
    queryFn: async () => {
      const res = await reportAPI.getEffectiveReportingRuleSet(applicationId, { tenantId });
      const d = res.data?.data;
      return {
        ...d,
        config: mergeReportingRuleSetConfig({
          alertThresholds: d?.alertThresholds,
          notifications: d?.notifications,
          riskBands: d?.riskBands,
        }),
      };
    },
    enabled: Boolean(tenantId && applicationId),
  });

  const saveMutation = useMutation({
    mutationFn: async (body) => {
      const res = await reportAPI.putApplicationReportingRuleSet(applicationId, body, { tenantId });
      const d = res.data?.data;
      return {
        ...d,
        config: mergeReportingRuleSetConfig({
          alertThresholds: d?.alertThresholds,
          notifications: d?.notifications,
          riskBands: d?.riskBands,
        }),
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: effectiveKey(tenantId, applicationId) });
      queryClient.invalidateQueries({ queryKey: ['governanceRiskBandSetting', tenantId, applicationId] });
    },
  });

  const toggleCustom = useCallback(
    async (useCustomRuleSet) => {
      const current = query.data?.config;
      await saveMutation.mutateAsync({
        useCustomRuleSet,
        ...(useCustomRuleSet && current
          ? {
              alertThresholds: current.alertThresholds,
              notifications: current.notifications,
            }
          : {}),
      });
    },
    [query.data?.config, saveMutation],
  );

  return { query, saveMutation, toggleCustom };
}
