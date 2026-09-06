/** Built-in brand SVG pack seeded into each tenant's ApplicationIcon library. */

/** Bump when builtin artwork changes so clients refresh cached images. */
export const BUILTIN_ICON_PACK_VERSION = 8;

function svgBuffer(markup) {
  return Buffer.from(String(markup).trim(), "utf8");
}

export const BUILTIN_APPLICATION_ICONS = [
  {
    key: "ad",
    name: "Active Directory",
    color: "#005A9E",
    mimeType: "image/svg+xml",
    data: svgBuffer(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#005A9E"/><rect x="9" y="10" width="10" height="8" rx="1.5" fill="#fff"/><rect x="29" y="10" width="10" height="8" rx="1.5" fill="#fff"/><rect x="19" y="22" width="10" height="8" rx="1.5" fill="#7EB8DA"/><path fill="none" stroke="#fff" stroke-width="2" d="M14 18v5h20v-5M24 22v8"/><circle cx="24" cy="36" r="4" fill="#fff"/></svg>`),
  },
  {
    key: "aad",
    name: "Azure AD",
    color: "#0078D4",
    mimeType: "image/svg+xml",
    data: svgBuffer(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#0078D4"/><circle cx="24" cy="16" r="5.5" fill="#fff"/><path fill="#fff" d="M12 36c0-6.6 5.4-10 12-10s12 3.4 12 10v2H12z"/><path fill="#50E6FF" d="M33 14h8v3h-8zm2 5h6v3h-6zm2 5h4v3h-4z"/></svg>`),
  },
];
