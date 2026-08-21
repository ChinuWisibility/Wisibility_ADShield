import AutoFixHighRoundedIcon from "@mui/icons-material/AutoFixHighRounded";
import AddCircleOutlineRoundedIcon from "@mui/icons-material/AddCircleOutlineRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import { resolveBuildCoachState } from "../../utils/workflowBuildCoach";
import { canBuildFullAutoFlow } from "../../utils/workflowAutoBuild";
import { getAutoFlowForTrigger } from "../../config/workflowTriggerRegistry";

export default function BuildCoachPanel({
  nodes,
  triggerType,
  remediationAction,
  selectedNodeId,
  compact = false,
  onBuildAll,
  onAddNext,
  building = false,
}) {
  const coach = resolveBuildCoachState({
    nodes,
    remediationAction,
    triggerType,
    selectedNodeId,
  });
  const autoFlow = getAutoFlowForTrigger(triggerType);
  const showBuildAll = autoFlow && canBuildFullAutoFlow(nodes, triggerType);

  if (!coach && !autoFlow) return null;

  const { path, nextPathStep, isComplete, progressLabel } = coach || {};

  return (
    <div className={`isc-build-coach ${compact ? "isc-build-coach--compact" : ""}`}>
      <div className="isc-build-coach__head">
        <AutoFixHighRoundedIcon sx={{ fontSize: 16 }} aria-hidden />
        <span>{autoFlow?.title || path?.label || "Build helper"}</span>
        {coach && <span className="isc-build-coach__progress">{progressLabel}</span>}
      </div>

      {isComplete ? (
        <>
          <p className="isc-build-coach__finish">
            {path?.finishHint || "Validate, Save, then map in Global Rule Set."}
          </p>
          <div className="isc-build-coach__done-badge">
            <CheckCircleRoundedIcon sx={{ fontSize: 18 }} />
            Ready to validate
          </div>
        </>
      ) : (
        <>
          <p className="isc-build-coach__hint">
            {autoFlow?.description ||
              "Starter flow — edit anything after building."}
          </p>

          {showBuildAll && onBuildAll && (
            <button
              type="button"
              className="isc-build-coach__btn isc-build-coach__btn--primary"
              onClick={onBuildAll}
              disabled={building}
            >
              <AutoFixHighRoundedIcon sx={{ fontSize: 18 }} />
              {building ? "Building…" : "Build entire recommended flow"}
            </button>
          )}

          {nextPathStep && onAddNext && (
            <button
              type="button"
              className="isc-build-coach__btn isc-build-coach__btn--secondary"
              onClick={onAddNext}
              disabled={building}
            >
              <AddCircleOutlineRoundedIcon sx={{ fontSize: 18 }} />
              {building ? "Adding…" : `Add next: ${nextPathStep.shortLabel}`}
            </button>
          )}

          {!showBuildAll && !nextPathStep && (
            <p className="isc-build-coach__hint isc-build-coach__hint--muted">
              Canvas already has steps. Edit on the canvas or use Validate to check connections.
            </p>
          )}
        </>
      )}
    </div>
  );
}
