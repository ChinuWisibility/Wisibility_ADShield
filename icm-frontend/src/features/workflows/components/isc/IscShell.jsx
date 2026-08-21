/** Builder shell. Embedded inside the IGA layout content area. */
export default function IscShell({ children }) {
  return <div className="isc-app isc-app-embedded">{children}</div>;
}
