import { useEffect, useState } from "react";
import { Typography, Box, Paper, Tabs, Tab } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import SecurityApplicationBar from "../../pages/security/SecurityApplicationBar";
import { useSecurityWorkspace } from "../../pages/security/SecurityWorkspaceContext";
import FindingsTable from "./FindingsTable";
import RiskDrilldownDrawer from "./RiskDrilldownDrawer";
import EmptyStateSecurity from "./EmptyStateSecurity";
import { securityPageHeaderSx } from "../../pages/security/securityTheme";
import { securityAPI } from "../../services/securityApi";
import { featureLabel } from "../../pages/security/securityFeatureMeta";

export default function PostureFeatureTabsView({
  title,
  description,
  emptyDescription,
  features = [],
  queryKeyPrefix,
}) {
  const { applicationId, scanId } = useSecurityWorkspace();
  const [searchParams] = useSearchParams();
  const tabs = features.map((key) => ({ key, label: featureLabel(key) }));
  const [tab, setTab] = useState(0);
  const feature = tabs[tab]?.key;

  useEffect(() => {
    const key = searchParams.get("feature");
    if (!key) return;
    const idx = features.indexOf(key);
    if (idx >= 0) setTab(idx);
  }, [searchParams, features]);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [selected, setSelected] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const query = useQuery({
    queryKey: ["security", queryKeyPrefix, applicationId, scanId, feature, paginationModel],
    queryFn: async () => {
      const res = await securityAPI.getFindings(applicationId, {
        page: paginationModel.page + 1,
        limit: paginationModel.pageSize,
        scanId: scanId || undefined,
        feature,
      });
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId) && Boolean(feature),
  });

  const items = query.data?.items || [];

  return (
    <Box>
      <Box sx={securityPageHeaderSx}>
        <Typography variant="h5" fontWeight={800}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      </Box>

      <SecurityApplicationBar />

      {!applicationId && (
        <EmptyStateSecurity
          title="Select an application"
          description={emptyDescription}
        />
      )}

      {applicationId && (
        <>
          <Tabs
            value={tab}
            onChange={(_, v) => {
              setTab(v);
              setPaginationModel({ page: 0, pageSize: 25 });
            }}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
          >
            {tabs.map((t) => (
              <Tab key={t.key} label={t.label} />
            ))}
          </Tabs>

          <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
            <FindingsTable
              rows={items}
              rowCount={query.data?.total ?? 0}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              loading={query.isLoading}
              onRowClick={(row) => {
                setSelected(row);
                setDrawerOpen(true);
              }}
            />
          </Paper>

          <RiskDrilldownDrawer
            open={drawerOpen}
            finding={selected}
            onClose={() => setDrawerOpen(false)}
          />
        </>
      )}
    </Box>
  );
}
