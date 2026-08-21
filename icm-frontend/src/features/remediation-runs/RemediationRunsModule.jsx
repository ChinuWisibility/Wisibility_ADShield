import { Routes, Route, Navigate } from "react-router-dom";
import RemediationRunsDashboard from "./pages/RemediationRunsDashboard";
import RemediationEventTypePage from "./pages/RemediationEventTypePage";
import { REMEDIATION_RUNS_BASE } from "./paths";
import "../workflows/styles/isc-theme.css";
import "../workflows/styles/embed.css";
import "./styles/remediation-runs.css";

export default function RemediationRunsModule() {
  return (
    <div className="isc-remediation-runs-feature">
      <Routes>
        <Route index element={<RemediationRunsDashboard />} />
        <Route path=":eventType" element={<RemediationEventTypePage />} />
        <Route path="*" element={<Navigate to={REMEDIATION_RUNS_BASE} replace />} />
      </Routes>
    </div>
  );
}
