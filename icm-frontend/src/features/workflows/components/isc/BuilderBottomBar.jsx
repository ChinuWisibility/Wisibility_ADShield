function IconFullscreen() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden>
      <path
        d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function BuilderBottomBar({
  errors = [],
  isEmptyCanvas = false,
  hasFixedTrigger = false,
  unsupportedTrigger = false,
  zoomPercent = 100,
  onZoomIn,
  onZoomOut,
  onFitView,
  onLayout,
  onFullscreen,
  onValidate,
  validating = false,
}) {
  const hasErrors = errors.length > 0;

  return (
    <footer className="isc-bottombar">
      <div className="isc-bottombar-left">
        {unsupportedTrigger ? (
          <div className="isc-val-warn">
            Visual editor does not support this trigger type yet — import or edit JSON for other
            triggers.
          </div>
        ) : isEmptyCanvas ? (
          <div className="isc-val-idle">
            {hasFixedTrigger ? (
              <>
                Drag a step, click <strong>+</strong> on canvas, or use{" "}
                <strong>Build entire recommended flow</strong>.
              </>
            ) : (
              <>
                Drag a <strong>trigger</strong> from the step library to begin, then add actions and
                operators.
              </>
            )}
          </div>
        ) : hasErrors ? (
          <div className="isc-val-err" title={errors.join(" · ")}>
            <span className="edot">{errors.length}</span>
            <span className="isc-val-err-msg">
              {errors.length} issue{errors.length > 1 ? "s" : ""} — {errors[0]}
            </span>
          </div>
        ) : (
          <div className="isc-val-ok">
            <span className="dot" aria-hidden>
              <svg viewBox="0 0 10 10" fill="none" width="10" height="10">
                <path
                  d="M2 5l2.5 2.5L8 3"
                  stroke="#fff"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            Validation passed
          </div>
        )}
        {onValidate && (
          <button
            type="button"
            className="isc-btn isc-btn-outline isc-btn-sm"
            onClick={onValidate}
            disabled={validating}
          >
            {validating ? "Validating…" : "Validate"}
          </button>
        )}
      </div>

      <div className="isc-bottombar-right">
        {onLayout && (
          <button type="button" className="isc-bb-btn" title="Auto-arrange steps" onClick={onLayout}>
            Auto layout
          </button>
        )}
        {onFitView && (
          <button type="button" className="isc-bb-btn" title="Fit to view" onClick={onFitView}>
            Fit
          </button>
        )}
        <div className="isc-zoom-group" role="group" aria-label="Zoom">
          <button type="button" className="isc-zoom-group__btn" title="Zoom out" onClick={onZoomOut}>
            −
          </button>
          <span className="isc-zoom-group__pct">{zoomPercent}%</span>
          <button type="button" className="isc-zoom-group__btn" title="Zoom in" onClick={onZoomIn}>
            +
          </button>
        </div>
        {onFullscreen && (
          <button
            type="button"
            className="isc-bb-btn isc-bb-btn--icon"
            title="Toggle fullscreen"
            onClick={onFullscreen}
          >
            <IconFullscreen />
          </button>
        )}
      </div>
    </footer>
  );
}
