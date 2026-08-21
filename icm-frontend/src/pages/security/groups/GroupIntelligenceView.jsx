import { useEffect, useMemo, useState } from "react";
import { Typography, Box, Paper, Tabs, Tab, Grid } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import SecurityApplicationBar from "../SecurityApplicationBar";
import { useSecurityWorkspace } from "../SecurityWorkspaceContext";
import NestedGroupTree from "../../../components/security/NestedGroupTree";
import FindingsTable from "../../../components/security/FindingsTable";
import RiskDrilldownDrawer from "../../../components/security/RiskDrilldownDrawer";
import EmptyStateSecurity from "../../../components/security/EmptyStateSecurity";
import { securityPageHeaderSx } from "../securityTheme";
import { securityAPI } from "../../../services/securityApi";
const TABS = [
  { key: "nested_groups", label: "Nested groups" },
  { key: "circular_memberships", label: "Circular membership" },
  { key: "empty_groups", label: "Empty groups" },
  { key: "orphan_groups", label: "Orphan groups" },
  { key: "duplicate_groups", label: "Duplicate groups" },
  { key: "toxic_privilege_combinations", label: "Toxic combinations" },
];

export default function GroupIntelligenceView() {
  const { applicationId, scanId } = useSecurityWorkspace();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(0);
  const feature = TABS[tab]?.key;

  useEffect(() => {
    const key = searchParams.get("feature");
    if (!key) return;
    const idx = TABS.findIndex((t) => t.key === key);
    if (idx >= 0) setTab(idx);
  }, [searchParams]);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [selected, setSelected] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const query = useQuery({
    queryKey: ["security", "groups", applicationId, scanId, feature, paginationModel],
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
  const nestedFindings = useMemo(
    () => items.filter((f) => f.feature === "nested_groups" || f.feature === "circular_memberships"),
    [items],
  );

  return (
    <Box>
      <Box sx={securityPageHeaderSx}>
        <Typography variant="h5" fontWeight={800}>
          Group Intelligence
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Nested structure, hygiene, and toxic group combinations
        </Typography>
      </Box>

      <SecurityApplicationBar />

      {!applicationId && (
        <EmptyStateSecurity title="Select an application" description="Group intelligence is derived from graph security scans." />
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

          <Grid container spacing={2}>
            {(feature === "nested_groups" || feature === "circular_memberships") && (
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, border: 1, borderColor: "divider", maxHeight: 480, overflow: "auto" }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    Hierarchy preview
                  </Typography>
                  <NestedGroupTree findings={nestedFindings.length ? nestedFindings : items} />
                </Paper>
              </Grid>
            )}
            <Grid item xs={12} md={feature === "nested_groups" || feature === "circular_memberships" ? 8 : 12}>
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
            </Grid>
          </Grid>
        </>
      )}

      <RiskDrilldownDrawer open={drawerOpen} finding={selected} onClose={() => setDrawerOpen(false)} />
    </Box>
  );
}
