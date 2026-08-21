import { useState } from "react";
import { Typography, Box, Paper, Tabs, Tab } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import SecurityApplicationBar from "../SecurityApplicationBar";
import { useSecurityWorkspace } from "../SecurityWorkspaceContext";
import FindingsTable from "../../../components/security/FindingsTable";
import RiskDrilldownDrawer from "../../../components/security/RiskDrilldownDrawer";
import EmptyStateSecurity from "../../../components/security/EmptyStateSecurity";
import { securityPageHeaderSx } from "../securityTheme";
import { securityAPI } from "../../../services/securityApi";
import { ACL_FEATURES, featureLabel } from "../securityFeatureMeta";

const TABS = ACL_FEATURES.map((key) => ({
  key,
  label: featureLabel(key),
}));

export default function AclIntelligenceView() {
  const { applicationId, scanId } = useSecurityWorkspace();
  const [tab, setTab] = useState(0);
  const feature = TABS[tab]?.key;
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [selected, setSelected] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const query = useQuery({
    queryKey: ["security", "acl", applicationId, scanId, feature, paginationModel],
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
          SID &amp; ACL Intelligence
        </Typography>
        <Typography variant="body2" color="text.secondary">
          SID history, foreign principals, ACL parsing, unknown bindings, and shadow admin paths
        </Typography>
      </Box>

      <SecurityApplicationBar />

      {!applicationId && (
        <EmptyStateSecurity
          title="Select an application"
          description="ACL intelligence requires a completed graph security scan with synced LDAP security descriptors."
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
            {TABS.map((t) => (
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
