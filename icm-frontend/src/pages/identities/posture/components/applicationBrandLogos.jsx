/**
 * Local brand marks for Access Details (no external CDN).
 * Keys are normalized compact names (spaces removed).
 */

function SvgShell({ children, viewBox = '0 0 24 24' }) {
  return (
    <svg viewBox={viewBox} width="100%" height="100%" aria-hidden focusable="false">
      {children}
    </svg>
  );
}

export const LOCAL_BRAND_LOGOS = {
  github: (
    <SvgShell>
      <circle cx="12" cy="12" r="12" fill="#181717" />
      <path
        fill="#fff"
        d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 4.42 2.87 8.17 6.84 9.49.5.09.68-.22.68-.48 0-.24-.01-.87-.01-1.71-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0 1 12 6.8c.85 0 1.71.11 2.51.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85 0 1.34-.01 2.42-.01 2.75 0 .27.18.58.69.48A10.04 10.04 0 0 0 22 12.06c0-5.53-4.5-10.02-10-10.02z"
      />
    </SvgShell>
  ),
  salesforce: (
    <SvgShell viewBox="0 0 48 48">
      <path
        fill="#00A1E0"
        d="M18.2 14.4c1.4-2.4 4-4 6.9-4 1.9 0 3.6.7 5 1.8 1.4-1.4 3.3-2.2 5.4-2.2 3.9 0 7.1 2.9 7.5 6.6 1.9.5 3.3 2.2 3.3 4.3 0 2.4-1.9 4.4-4.3 4.4-.4 0-.8 0-1.1-.1-.5 3.1-3.2 5.5-6.5 5.5-1.3 0-2.5-.4-3.5-1-1.1 2.3-3.5 3.9-6.2 3.9-1.8 0-3.4-.7-4.6-1.8-1 .5-2.1.8-3.3.8-3.5 0-6.3-2.7-6.3-6.1 0-1.8.8-3.4 2-4.5C11.2 19.2 10 16.8 10 14c0-3.6 2.9-6.5 6.5-6.5 1.1 0 2.1.3 3 .8.2.7.5 1.3.7 2.1z"
      />
      <text x="24" y="28" textAnchor="middle" fill="#fff" fontSize="7.5" fontFamily="Arial,sans-serif" fontWeight="700">
        SF
      </text>
    </SvgShell>
  ),
  servicenow: (
    <SvgShell viewBox="0 0 48 48">
      <rect width="48" height="48" rx="10" fill="#032D42" />
      <circle cx="24" cy="24" r="11" fill="none" stroke="#62D84E" strokeWidth="3.5" />
      <path
        fill="#62D84E"
        d="M24 16.5c-4.1 0-7.5 3.4-7.5 7.5S19.9 31.5 24 31.5c1.7 0 3.3-.6 4.5-1.6l-2.1-2.1a4.5 4.5 0 1 1 0-4.6l2.1-2.1A7.45 7.45 0 0 0 24 16.5z"
      />
    </SvgShell>
  ),
  tableau: (
    <SvgShell viewBox="0 0 48 48">
      <g fill="#E97627">
        <rect x="21" y="4" width="6" height="14" rx="1" />
        <rect x="21" y="30" width="6" height="14" rx="1" />
        <rect x="4" y="21" width="14" height="6" rx="1" />
        <rect x="30" y="21" width="14" height="6" rx="1" />
      </g>
      <g fill="#1F77B4">
        <rect x="21" y="20" width="6" height="8" rx="1" />
        <rect x="14" y="14" width="5" height="5" rx="1" />
        <rect x="29" y="14" width="5" height="5" rx="1" />
        <rect x="14" y="29" width="5" height="5" rx="1" />
        <rect x="29" y="29" width="5" height="5" rx="1" />
      </g>
      <circle cx="11" cy="11" r="2.2" fill="#F28E2B" />
      <circle cx="37" cy="11" r="2.2" fill="#59A14F" />
      <circle cx="11" cy="37" r="2.2" fill="#E15759" />
      <circle cx="37" cy="37" r="2.2" fill="#4E79A7" />
    </SvgShell>
  ),
  workday: (
    <SvgShell viewBox="0 0 48 48">
      <text
        x="24"
        y="32"
        textAnchor="middle"
        fill="#0875E1"
        fontSize="28"
        fontFamily="Arial Black, Arial, sans-serif"
        fontWeight="900"
      >
        W
      </text>
      <path
        d="M11 40 Q24 46 37 40"
        fill="none"
        stroke="#F38025"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </SvgShell>
  ),
  sap: (
    <SvgShell viewBox="0 0 48 48">
      <rect width="48" height="48" rx="8" fill="#008FD3" />
      <text
        x="24"
        y="30"
        textAnchor="middle"
        fill="#fff"
        fontSize="13"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="700"
      >
        SAP
      </text>
    </SvgShell>
  ),
  oracle: (
    <SvgShell viewBox="0 0 48 48">
      <rect width="48" height="48" rx="8" fill="#F80000" />
      <text
        x="24"
        y="29"
        textAnchor="middle"
        fill="#fff"
        fontSize="9"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="700"
      >
        ORACLE
      </text>
    </SvgShell>
  ),
  aad: (
    <SvgShell viewBox="0 0 48 48">
      <rect width="48" height="48" rx="8" fill="#0078D4" />
      <circle cx="24" cy="16" r="5.5" fill="#fff" />
      <path fill="#fff" d="M12 36c0-6.6 5.4-10 12-10s12 3.4 12 10v2H12z" />
      <path fill="#50E6FF" d="M33 14h8v3h-8zm2 5h6v3h-6zm2 5h4v3h-4z" />
    </SvgShell>
  ),
  authoritative: (
    <SvgShell viewBox="0 0 48 48">
      <rect width="48" height="48" rx="8" fill="#059669" />
      <path
        fill="#fff"
        d="M24 8l12 5v9c0 8.2-5.4 15.4-12 18-6.6-2.6-12-9.8-12-18v-9l12-5zm0 5.2L16 16.4v5.7c0 5.9 3.7 11.2 8 13.5 4.3-2.3 8-7.6 8-13.5v-5.7L24 13.2z"
      />
      <path fill="#A7F3D0" d="M22 28.5l-4-4 1.8-1.8 2.2 2.2 5.4-5.4L29.2 21z" />
    </SvgShell>
  ),
  okta: (
    <SvgShell>
      <circle cx="12" cy="12" r="10" fill="#007DC1" />
      <circle cx="12" cy="12" r="4.2" fill="#fff" />
    </SvgShell>
  ),
  slack: (
    <SvgShell>
      <path fill="#E01E5A" d="M8.2 13.6a2 2 0 1 1-2-2h2v2zm1 0a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0v-5z" />
      <path fill="#36C5F0" d="M10.4 8.2a2 2 0 1 1 2-2v2h-2zm0 1a2 2 0 1 1 0 4h-5a2 2 0 1 1 0-4h5z" />
      <path fill="#2EB67D" d="M15.8 10.4a2 2 0 1 1 2 2h-2v-2zm-1 0a2 2 0 1 1-4 0V5.4a2 2 0 1 1 4 0v5z" />
      <path fill="#ECB22E" d="M13.6 15.8a2 2 0 1 1-2 2v-2h2zm0-1a2 2 0 1 1 0-4h5a2 2 0 1 1 0 4h-5z" />
    </SvgShell>
  ),
  microsoft: (
    <SvgShell viewBox="0 0 24 24">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
      <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
    </SvgShell>
  ),
  azure: (
    <SvgShell viewBox="0 0 48 48">
      <path fill="#0078D4" d="M22.2 6.5 6 41.5h9.2L28 14.8z" />
      <path fill="#50E6FF" d="M25.5 14.8 32.8 41.5H42L29.8 6.5z" />
      <path fill="#0078D4" d="M18.2 29.5h15.2l-3.4 8.2H14.8z" />
    </SvgShell>
  ),
  aws: (
    <SvgShell viewBox="0 0 48 48">
      <rect width="48" height="48" rx="8" fill="#232F3E" />
      <text
        x="24"
        y="23"
        textAnchor="middle"
        fill="#fff"
        fontSize="12"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="700"
      >
        aws
      </text>
      <path
        d="M12 30 C18 38 30 38 36 30"
        fill="none"
        stroke="#FF9900"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M33.2 27.8 L36.2 30.2 L33 32.2"
        fill="none"
        stroke="#FF9900"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SvgShell>
  ),
  jira: (
    <SvgShell>
      <path fill="#2684FF" d="M12.2 2 5.4 8.8c-.7.7-.7 1.9 0 2.6l4 4 1.6-1.6-4.8-4.8L12.2 2z" />
      <path fill="#2684FF" d="m12.2 2 6.8 6.8c.7.7.7 1.9 0 2.6l-4 4-1.6-1.6 4.8-4.8L12.2 2z" opacity=".7" />
      <path fill="#2684FF" d="M12.2 13.2 8.4 17c-.7.7-.7 1.9 0 2.6l3.8 3.8 3.8-3.8c.7-.7.7-1.9 0-2.6l-3.8-3.8z" opacity=".45" />
    </SvgShell>
  ),
  google: (
    <SvgShell>
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4c-.2 1.2-1 2.3-2.1 3v2.5h3.4c2-1.8 3-4.5 3-7.3z" />
      <path fill="#34A853" d="M12 22c2.9 0 5.3-.9 7.1-2.5l-3.4-2.5c-1 .7-2.2 1.1-3.7 1.1-2.8 0-5.2-1.9-6.1-4.4H2.4v2.6C4.2 19.8 7.8 22 12 22z" />
      <path fill="#FBBC05" d="M5.9 13.7c-.2-.7-.4-1.4-.4-2.1s.1-1.4.4-2.1V6.9H2.4C1.6 8.4 1.2 10.1 1.2 12s.4 3.6 1.2 5.1l3.5-2.7z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3 .5 4.1 1.6l3.1-3.1C17.3 2.1 14.9 1 12 1 7.8 1 4.2 3.2 2.4 6.9l3.5 2.7C6.8 7.2 9.2 5.4 12 5.4z" />
    </SvgShell>
  ),
};

export function resolveLocalBrandKey(name) {
  const spaced = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const compact = spaced.replace(/\s+/g, '');
  if (!compact) return null;

  const ALIASES = {
    azuread: 'aad',
    azureactivedirectory: 'aad',
    activedirectory: 'aad',
    entra: 'aad',
    entraid: 'aad',
    microsoftentraid: 'aad',
    oraclehcm: 'oracle',
    oracleerp: 'oracle',
  };
  if (ALIASES[compact]) return ALIASES[compact];
  if (LOCAL_BRAND_LOGOS[compact]) return compact;
  if (LOCAL_BRAND_LOGOS[spaced]) return spaced;
  const hit = Object.keys(LOCAL_BRAND_LOGOS).find((k) => compact.includes(k.replace(/\s+/g, '')));
  return hit || null;
}
