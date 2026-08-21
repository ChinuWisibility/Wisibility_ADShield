import { useEffect, useState } from "react";
import { Typography, Box, Paper, Tabs, Tab } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import SecurityApplicationBar from "../SecurityApplicationBar";
import { useSecurityWorkspace } from "../SecurityWorkspaceContext";
import FindingsTable from "../../../components/security/FindingsTable";
import RiskDrilldownDrawer from "../../../components/security/RiskDrilldownDrawer";
import PrivilegePathViewer from "../../../components/security/PrivilegePathViewer";
import EmptyStateSecurity from "../../../components/security/EmptyStateSecurity";
import { securityPageHeaderSx } from "../securityTheme";
import { securityAPI } from "../../../services/securityApi";
const TABS = [
  { key: "nested_privileged_access", label: "Inherited / nested" },
  { key: "dormant_privileged_users", label: "Dormant privileged" },
  { key: "excessive_privileges", label: "Excessive privilege" },
  { key: "privilege_escalation_paths", label: "Escalation paths" },
  { key: "shadow_admins", label: "Shadow admins (ACL + graph)" },
];

export default function PrivilegedAccessView() {
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
    queryKey: ["security", "privileged", applicationId, scanId, feature, paginationModel],
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
  const pathFindings = items.filter((f) => f.feature === "privilege_escalation_paths");

  return (
    <Box>
      <Box sx={securityPageHeaderSx}>
        <Typography variant="h5" fontWeight={800}>
          Privileged Access
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Direct and inherited privilege risks with escalation paths
        </Typography>
      </Box>

      <SecurityApplicationBar />

      {!applicationId && (
        <EmptyStateSecurity
          title="Select an application"
          description="Privileged access analysis requires a completed graph security scan."
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
            sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
          >
            {TABS.map((t) => (
              <Tab key={t.key} label={t.label} />
            ))}
          </Tabs>

          {feature === "privilege_escalation_paths" && pathFindings.length > 0 && (
            <Paper sx={{ p: 2, mb: 2, border: 1, borderColor: "divider" }}>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                Path preview (first finding)
              </Typography>
              <PrivilegePathViewer relationships={pathFindings[0]?.relationships} />
            </Paper>
          )}

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
        </>
      )}

      <RiskDrilldownDrawer open={drawerOpen} finding={selected} onClose={() => setDrawerOpen(false)} />
    </Box>
  );
}
