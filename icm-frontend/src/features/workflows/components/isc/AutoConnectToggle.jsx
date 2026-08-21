const STORAGE_KEY = "wf-builder-auto-connect";

export function readAutoConnectPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeAutoConnectPreference(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    /* ignore */
  }
}

export default function AutoConnectToggle({ enabled, onChange }) {
  return (
    <div className="isc-auto-connect" title="Place and link new steps from the trigger or last open step">
      <span className="isc-auto-connect__label">Auto-connect</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Auto-connect new steps"
        className={`isc-auto-connect__switch ${enabled ? "is-on" : ""}`}
        onClick={() => onChange(!enabled)}
      >
        <span className="isc-auto-connect__thumb" />
      </button>
    </div>
  );
}
