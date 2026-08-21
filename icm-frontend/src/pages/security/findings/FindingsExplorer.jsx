import { useCallback, useEffect, useMemo, useState } from "react";
import { Typography, Box, Paper, Alert } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import SecurityApplicationBar from "../SecurityApplicationBar";
import { useSecurityWorkspace } from "../SecurityWorkspaceContext";
import FindingsFilters from "../../../components/security/FindingsFilters";
import FindingsTable from "../../../components/security/FindingsTable";
import RiskDrilldownDrawer from "../../../components/security/RiskDrilldownDrawer";
import EmptyStateSecurity from "../../../components/security/EmptyStateSecurity";
import AssessmentContextBar from "../../../components/security/AssessmentContextBar";
import SecurityExportMenu from "../../../components/security/SecurityExportMenu";
import { securityPageHeaderSx } from "../securityTheme";
import { securityAPI } from "../../../services/securityApi";
import { findingFingerprint } from "../../../utils/securityNavigation";
import {
  categoryIdForFeatureKey,
  featureKeysForCategories,
} from "../../../utils/scanCenterCategories";

const DEFAULT_FILTERS = {
  search: "",
  categories: [],
  features: [],
  objectType: "",
};

function featureQueryParam(features) {
  if (!Array.isArray(features) || !features.length) return undefined;
  return features.join(",");
}

export default function FindingsExplorer() {
  const { applicationId, scanId } = useSecurityWorkspace();
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const debouncedSearch = useDebouncedValue(filters.search, 400);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [selected, setSelected] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const feature = searchParams.get("feature");
    if (!feature) return;
    setFilters((prev) => {
      if (prev.features?.includes(feature)) return prev;
      const catId = categoryIdForFeatureKey(feature);
      const categories =
        catId && !prev.categories.includes(catId)
          ? [...prev.categories, catId]
          : prev.categories;
      return {
        ...prev,
        categories,
        features: [...(prev.features || []), feature],
      };
    });
  }, [searchParams]);

  const featureParam = featureQueryParam(filters.features);

  const queryKey = useMemo(
    () => [
      "security",
      "findings",
      applicationId,
      scanId,
      paginationModel.page,
      paginationModel.pageSize,
      featureParam || "",
      filters.objectType,
      debouncedSearch,
      ...(filters.categories || []),
    ],
    [
      applicationId,
      scanId,
      paginationModel,
      featureParam,
      filters.objectType,
      filters.categories,
      debouncedSearch,
    ],
  );

  const findingsQuery = useQuery({
    queryKey,
    queryFn: async () => {
      // When categories are selected but no explicit features, filter by all
      // features in those categories (uniform with Scan Center category scope).
      let feature = featureParam;
      if (!feature && filters.categories?.length) {
        feature = featureKeysForCategories(filters.categories).join(",") || undefined;
      }
      const res = await securityAPI.getFindings(applicationId, {
        page: paginationModel.page + 1,
        limit: paginationModel.pageSize,
        scanId: scanId || undefined,
        feature,
        objectType: filters.objectType || undefined,
        search: debouncedSearch || undefined,
      });
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId),
    placeholderData: (prev) => prev,
  });

  // Related findings sample for investigation (same DN or feature)
  const relatedQuery = useQuery({
    queryKey: ["security", "related", applicationId, scanId, selected?.id],
    queryFn: async () => {
      if (!selected) return [];
      const res = await securityAPI.getFindings(applicationId, {
        page: 1,
        limit: 50,
        scanId: scanId || undefined,
        search: selected.objectName || undefined,
      });
      const items = res.data?.data?.items || res.data?.items || [];
      const fp = findingFingerprint(selected);
      return items.filter(
        (f) =>
          String(f.id) !== String(selected.id) &&
          (f.dn === selected.dn ||
            f.feature === selected.feature ||
            findingFingerprint(f) !== fp),
      );
    },
    enabled: Boolean(applicationId && selected && drawerOpen),
  });

  useEffect(() => {
    const highlight = searchParams.get("highlight");
    if (!highlight || !findingsQuery.data?.items?.length) return;
    const match = findingsQuery.data.items.find(
      (row) => String(row.id) === String(highlight),
    );
    if (match) {
      setSelected(match);
      setDrawerOpen(true);
    }
  }, [searchParams, findingsQuery.data?.items]);

  const handleRowClick = useCallback((row) => {
    setSelected(row);
    setDrawerOpen(true);
  }, []);

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setPaginationModel((p) => ({ ...p, page: 0 }));
  };

  return (
    <Box>
      <Box sx={securityPageHeaderSx}>
        <Box>
          <Typography variant="h5" fontWeight={800}>
            Findings Explorer
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Investigate findings with evidence, recommendations, and next steps
          </Typography>
        </Box>
        <SecurityExportMenu
          applicationId={applicationId}
          scanId={scanId}
          filters={{
            ...filters,
            search: debouncedSearch,
            feature: featureQueryParam(filters.features) ||
              (filters.categories?.length
                ? featureKeysForCategories(filters.categories).join(",")
                : undefined),
          }}
        />
      </Box>

      <SecurityApplicationBar />
      {applicationId && <AssessmentContextBar />}

      {!applicationId && (
        <EmptyStateSecurity
          title="Select an application"
          description="Findings are loaded per application from the latest security scan."
        />
      )}

      {applicationId && (
        <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
          <FindingsFilters
            filters={filters}
            onChange={(f) => {
              setFilters(f);
              setPaginationModel((p) => ({ ...p, page: 0 }));
            }}
            onReset={resetFilters}
          />

          {findingsQuery.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {findingsQuery.error?.response?.data?.message || findingsQuery.error.message}
            </Alert>
          )}

          <FindingsTable
            rows={findingsQuery.data?.items || []}
            rowCount={findingsQuery.data?.total ?? 0}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            loading={findingsQuery.isLoading}
            onRowClick={handleRowClick}
          />
        </Paper>
      )}

      <RiskDrilldownDrawer
        open={drawerOpen}
        finding={selected}
        onClose={() => setDrawerOpen(false)}
        relatedFindings={relatedQuery.data || []}
        onSelectRelated={(f) => {
          setSelected(f);
          setDrawerOpen(true);
        }}
      />
    </Box>
  );
}
