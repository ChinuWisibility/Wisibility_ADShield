import { Box, Tab, Tabs, Typography } from "@mui/material";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import ProvisioningRequests from "./pages/ProvisioningRequests";
import ProvisioningRules from "./pages/ProvisioningRules";

const TABS = [
  { value: "requests", label: "Requests" },
  { value: "rules", label: "Rules" },
];

function ProvisioningShell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const active = location.pathname.endsWith("/rules") ? "rules" : "requests";

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>
        Provisioning
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Joiner, Mover and Leaver account provisioning for this tenant.
      </Typography>
      <Tabs
        value={active}
        onChange={(event, value) =>
          navigate(
            `/governance/provisioning/${value === "requests" ? "" : value}${location.search}`,
          )
        }
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2.5 }}
      >
        {TABS.map((tab) => (
          <Tab key={tab.value} value={tab.value} label={tab.label} />
        ))}
      </Tabs>
      {children}
    </Box>
  );
}

export default function ProvisioningModule() {
  return (
    <Routes>
      <Route
        index
        element={
          <ProvisioningShell>
            <ProvisioningRequests />
          </ProvisioningShell>
        }
      />
      <Route
        path="rules"
        element={
          <ProvisioningShell>
            <ProvisioningRules />
          </ProvisioningShell>
        }
      />
      <Route path="*" element={<Navigate to="/governance/provisioning" replace />} />
    </Routes>
  );
}
