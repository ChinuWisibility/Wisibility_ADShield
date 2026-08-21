/**
 * Dynamic Favicon Utility
 * Allows updating the favicon and theme color dynamically based on branding
 */

/**
 * Update the favicon with an image URL or custom color scheme
 * @param {string|Object} options - Either a URL string or customization options
 * @param {string} options.url - Direct image URL for favicon
 * @param {string} options.primaryColor - Primary color (hex)
 * @param {string} options.secondaryColor - Secondary color (hex)
 * @param {string} options.iconType - Icon type ('shield', 'circle', 'square')
 */
export function updateFavicon(options) {
  const favicon = document.getElementById("favicon");
  if (!favicon) return;

  // If options is a string, treat it as a direct URL
  if (typeof options === "string") {
    applyRoundedImageFavicon(favicon, options);
    return;
  }

  // If URL is provided in options, use it directly
  if (options?.url) {
    applyRoundedImageFavicon(favicon, options.url);
    return;
  }

  // Otherwise, generate SVG with custom colors
  const {
    primaryColor = "#3B82F6",
    secondaryColor = "#1E40AF",
    iconType = "shield",
  } = options || {};
  const svg = generateFaviconSVG({ primaryColor, secondaryColor, iconType });

  // Convert SVG to data URL
  const svgBlob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svgBlob);
  setFaviconHref(url, "image/svg+xml");
}

function setFaviconHref(href, mimeType) {
  const links = document.querySelectorAll(
    'link[rel~="icon"], link[rel="apple-touch-icon"]',
  );
  links.forEach((link) => {
    link.href = href;
    if (mimeType && link.rel !== "apple-touch-icon") {
      link.type = mimeType;
    }
  });

  const primary = document.getElementById("favicon");
  if (primary) {
    primary.href = href;
    if (mimeType) primary.type = mimeType;
  }
}

function applyRoundedImageFavicon(faviconEl, sourceUrl) {
  const img = new Image();
  img.crossOrigin = "anonymous";

  img.onload = () => {
    // Draw a circular favicon so uploaded icons look clean in browser tabs.
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      faviconEl.href = sourceUrl;
      return;
    }

    try {
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 0, 0, size, size);

      const roundedDataUrl = canvas.toDataURL("image/png");
      setFaviconHref(roundedDataUrl, "image/png");
    } catch {
      // Fallback when browser blocks canvas export for cross-origin images.
      setFaviconHref(sourceUrl);
    }
  };

  img.onerror = () => {
    setFaviconHref(sourceUrl);
  };

  img.src = sourceUrl;
}

/**
 * Update the theme color in the meta tag
 * @param {string} color - Theme color (hex)
 */
export function updateThemeColor(color) {
  const themeColorMeta = document.getElementById("theme-color");
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", color);
  }
}

/**
 * Generate favicon SVG with custom colors
 * @param {Object} options - SVG generation options
 * @returns {string} SVG markup
 */
function generateFaviconSVG({ primaryColor, secondaryColor, iconType }) {
  const iconPath = getIconPath(iconType);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <defs>
        <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${primaryColor};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${secondaryColor};stop-opacity:1" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#grad1)"/>
      ${iconPath}
    </svg>
  `;
}

/**
 * Get icon path based on type
 * @param {string} type - Icon type
 * @returns {string} SVG path
 */
function getIconPath(type) {
  const icons = {
    shield: `
      <path d="M16 4 L10 7 L10 14 C10 18.5 12.5 22.5 16 24 C19.5 22.5 22 18.5 22 14 L22 7 Z"
            fill="white" opacity="0.9"/>
      <path d="M14 16 L13 15 L11.5 16.5 L14 19 L20.5 12.5 L19 11 L14 16 Z"
            fill="${"currentColor"}" stroke="#1E40AF" stroke-width="0.5"/>
    `,
    circle: `
      <circle cx="16" cy="16" r="8" fill="white" opacity="0.9"/>
      <path d="M14 16 L13 15 L12 16 L14 18 L20 12 L19 11 L14 16 Z"
            fill="${"currentColor"}" stroke="#1E40AF" stroke-width="0.5"/>
    `,
    square: `
      <rect x="9" y="9" width="14" height="14" rx="2" fill="white" opacity="0.9"/>
      <path d="M14 16 L13 15 L12 16 L14 18 L20 12 L19 11 L14 16 Z"
            fill="${"currentColor"}" stroke="#1E40AF" stroke-width="0.5"/>
    `,
  };

  return icons[type] || icons.shield;
}

/**
 * Initialize favicon from branding settings
 * @param {Object} branding - Branding configuration
 */
export function initializeFaviconFromBranding(branding) {
  if (!branding) return;

  const primaryColor = branding.primaryColor || "#3B82F6";
  const secondaryColor = branding.colors?.secondary || "#1E40AF";
  const iconType = branding.faviconStyle || "shield";

  updateFavicon({ primaryColor, secondaryColor, iconType });
  updateThemeColor(branding.colors?.background || "#0A1628");
}

export default {
  updateFavicon,
  updateThemeColor,
  initializeFaviconFromBranding,
};
