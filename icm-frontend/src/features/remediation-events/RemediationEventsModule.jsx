import { Routes, Route, Navigate } from "react-router-dom";
import RemediationEventsCatalog from "./pages/RemediationEventsCatalog";
import AccessRevokeTasksPage from "./pages/AccessRevokeTasksPage";
import AccessRevokeTaskDetailPage from "./pages/AccessRevokeTaskDetailPage";
import IamOrphanReviewPage from "./pages/IamOrphanReviewPage";
import IamOrphanReviewTaskDetailPage from "./pages/IamOrphanReviewTaskDetailPage";
import { REMEDIATION_EVENTS_BASE } from "./paths";
import "../workflows/styles/isc-theme.css";
import "../workflows/styles/embed.css";
import "../remediation-runs/styles/remediation-runs.css";
import "./styles/remediation-events.css";

export default function RemediationEventsModule() {
  return (
    <div className="isc-remediation-events-feature">
      <Routes>
        <Route index element={<RemediationEventsCatalog />} />
        <Route path="access-revoke" element={<AccessRevokeTasksPage />} />
        <Route path="access-revoke/:taskId" element={<AccessRevokeTaskDetailPage />} />
        <Route path="iam-orphan-review" element={<IamOrphanReviewPage />} />
        <Route path="iam-orphan-review/:taskId" element={<IamOrphanReviewTaskDetailPage />} />
        <Route path="*" element={<Navigate to={REMEDIATION_EVENTS_BASE} replace />} />
      </Routes>
    </div>
  );
}
