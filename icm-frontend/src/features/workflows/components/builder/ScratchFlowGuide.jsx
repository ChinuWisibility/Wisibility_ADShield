import { useState } from "react";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import ChecklistRoundedIcon from "@mui/icons-material/ChecklistRounded";
import {
  getScratchRecipesForAction,
  getScratchGettingStarted,
  getScratchActionsForAction,
  getScratchOperatorsForAction,
} from "../../utils/workflowScratchGuide";

export default function ScratchFlowGuide({ remediationEvent }) {
  const remediationAction = remediationEvent?.action;
  const gettingStarted = getScratchGettingStarted(remediationAction);
  const recipes = getScratchRecipesForAction(remediationAction);
  const actions = getScratchActionsForAction(remediationAction);
  const operators = getScratchOperatorsForAction(remediationAction);

  const [openId, setOpenId] = useState(gettingStarted ? "getting-started" : null);
  const [showLibrary, setShowLibrary] = useState(false);

  if (!remediationAction) return null;

  return (
    <div className="isc-quickstart">
      <div className="isc-quickstart__head">
        <LightbulbOutlinedIcon sx={{ fontSize: 16 }} aria-hidden />
        <span>{remediationEvent.title} guide</span>
        <span className="isc-quickstart__note">Trigger: {remediationEvent.triggerLabel}</span>
      </div>

      {gettingStarted && (
        <div className="isc-quickstart__recipes">
          <div
            className={`isc-quickstart__recipe is-recommended ${openId === "getting-started" ? "is-open" : ""}`}
          >
            <button
              type="button"
              className="isc-quickstart__recipe-toggle"
              aria-expanded={openId === "getting-started"}
              onClick={() =>
                setOpenId(openId === "getting-started" ? null : "getting-started")
              }
            >
              <span className="isc-quickstart__recipe-meta">
                <span className="isc-quickstart__recipe-title">
                  <ChecklistRoundedIcon sx={{ fontSize: 15, mr: 0.5, verticalAlign: "text-bottom" }} />
                  {gettingStarted.title}
                  <span className="isc-quickstart__pill">Start here</span>
                </span>
                <span className="isc-quickstart__recipe-sub">
                  What to do after the empty canvas opens
                </span>
              </span>
              <ExpandMoreRoundedIcon className="isc-quickstart__chevron" sx={{ fontSize: 20 }} />
            </button>

            {openId === "getting-started" && (
              <div className="isc-quickstart__body">
                <ol className="isc-quickstart__checklist">
                  {gettingStarted.steps.map((step, index) => (
                    <li key={step.label}>
                      <span className="isc-quickstart__check-num">{index + 1}</span>
                      <div>
                        <strong>{step.label}</strong>
                        <p>{step.hint}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                {gettingStarted.afterSave && (
                  <p className="isc-quickstart__after-save">{gettingStarted.afterSave}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {recipes.length > 0 && (
        <div className="isc-quickstart__recipes">
          {recipes.map((recipe) => {
            const isOpen = openId === recipe.id;
            return (
              <div
                key={recipe.id}
                className={`isc-quickstart__recipe ${recipe.recommended ? "is-recommended" : ""} ${isOpen ? "is-open" : ""}`}
              >
                <button
                  type="button"
                  className="isc-quickstart__recipe-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setOpenId(isOpen ? null : recipe.id)}
                >
                  <span className="isc-quickstart__recipe-meta">
                    <span className="isc-quickstart__recipe-title">
                      {recipe.title}
                      {recipe.recommended && (
                        <span className="isc-quickstart__pill">Recommended</span>
                      )}
                    </span>
                    {recipe.subtitle && (
                      <span className="isc-quickstart__recipe-sub">{recipe.subtitle}</span>
                    )}
                  </span>
                  <ExpandMoreRoundedIcon className="isc-quickstart__chevron" sx={{ fontSize: 20 }} />
                </button>

                {isOpen && (
                  <div className="isc-quickstart__body">
                    <p className="isc-quickstart__trigger-line">
                      Trigger: <strong>{recipe.trigger}</strong>
                    </p>
                    <div className="isc-quickstart__pipeline">
                      {recipe.steps.map((step, index) => (
                        <div key={step.label} className="isc-quickstart__step-wrap">
                          {index > 0 && <span className="isc-quickstart__arrow" aria-hidden />}
                          <div className="isc-quickstart__step" title={step.hint}>
                            <span className="isc-quickstart__step-num">{index + 1}</span>
                            <span className="isc-quickstart__step-label">{step.label}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {recipe.steps.some((s) => s.hint) && (
                      <ul className="isc-quickstart__hints">
                        {recipe.steps.map((step) => (
                          <li key={step.label}>
                            <strong>{step.label}</strong> — {step.hint}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className="isc-quickstart__library-toggle"
        aria-expanded={showLibrary}
        onClick={() => setShowLibrary(!showLibrary)}
      >
        Steps for this trigger only
        <ExpandMoreRoundedIcon
          className={showLibrary ? "is-open" : ""}
          sx={{ fontSize: 18 }}
        />
      </button>

      {showLibrary && (
        <div className="isc-quickstart__library">
          <div>
            <span className="isc-quickstart__library-label">Actions</span>
            <ul>
              {actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
          <div>
            <span className="isc-quickstart__library-label">Operators</span>
            <ul>
              {operators.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
