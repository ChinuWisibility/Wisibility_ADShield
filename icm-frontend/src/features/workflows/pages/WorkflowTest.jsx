import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import TestWorkflowPanel from "../components/isc/TestWorkflowPanel";
import RunHistoryPanel from "../components/isc/RunHistoryPanel";
import { workflowApi } from "../services/api";

export default function WorkflowTest() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState(null);

  useEffect(() => {
    workflowApi.get(id).then((r) => setWorkflow(r.data.data));
  }, [id]);

  if (!workflow) {
    return (
      <div className="isc-page">
        <div className="isc-page-inner">
          <p className="isc-loading">Loading workflow…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="isc-page">
      <div className="isc-page-inner isc-page-inner-wide">
        <button
          type="button"
          className="isc-back-btn"
          onClick={() => navigate(`/governance/workflows/${id}/edit`)}
        >
          ← Back to builder
        </button>
        <h1 className="isc-page-title">Test: {workflow.name}</h1>
        {workflow.description && <p className="isc-page-sub">{workflow.description}</p>}

        <div className="isc-test-page-card">
          <TestWorkflowPanel
            workflowId={id}
            workflowName={workflow.name}
            onClose={() => navigate(`/governance/workflows/${id}/edit`)}
          />
        </div>

        <RunHistoryPanel workflowId={id} />
      </div>
    </div>
  );
}
