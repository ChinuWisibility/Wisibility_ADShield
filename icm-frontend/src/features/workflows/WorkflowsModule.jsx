import { Routes, Route, Navigate } from "react-router-dom";
import { CatalogProvider } from "./context/CatalogContext";
import WorkflowList from "./pages/WorkflowList";
import WorkflowCreate from "./pages/WorkflowCreate";
import WorkflowBuilder from "./pages/WorkflowBuilder";
import WorkflowTest from "./pages/WorkflowTest";
import "reactflow/dist/style.css";
import "./styles/workflow.css";
import "./styles/isc-theme.css";
import "./styles/embed.css";
import "../remediation-events/styles/remediation-events.css";

/**
 * Workflow builder only — remediation queue and runs live under /governance/remediation-events.
 */
export default function WorkflowsModule() {
  return (
    <CatalogProvider>
      <div className="isc-workflows-feature">
        <Routes>
          <Route index element={<WorkflowList />} />
          <Route path="create" element={<WorkflowCreate />} />
          <Route path="executions" element={<Navigate to="/governance/remediation-events" replace />} />
          <Route path="remediation-queue/*" element={<Navigate to="/governance/remediation-events" replace />} />
          <Route path="runs/*" element={<Navigate to="/governance/remediation-events" replace />} />
          <Route path=":id/edit" element={<WorkflowBuilder />} />
          <Route path=":id/test" element={<WorkflowTest />} />
          <Route path="*" element={<Navigate to="/governance/workflows" replace />} />
        </Routes>
      </div>
    </CatalogProvider>
  );
}
