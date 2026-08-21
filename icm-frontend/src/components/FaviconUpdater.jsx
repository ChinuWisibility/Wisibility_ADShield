import { useEffect } from 'react';
import { useBranding } from '../contexts/BrandingContext';
import { updateFavicon, updateThemeColor } from '../utils/faviconUtils';

/**
 * FaviconUpdater Component
 * Automatically updates the browser favicon and theme color when branding changes
 * This component doesn't render anything - it just watches the branding context
 */
export default function FaviconUpdater() {
  const { branding, loaded } = useBranding();

  useEffect(() => {
    if (!loaded) return;

    // Update favicon if a custom favicon URL is set
    if (branding.faviconUrl) {
      updateFavicon(branding.faviconUrl);
    } else if (branding.logoUrl) {
      // Fallback to logo if no dedicated favicon is set
      updateFavicon(branding.logoUrl);
    } else {
      // Fallback to default SVG favicon with brand colors
      updateFavicon({
        primaryColor: branding.primaryColor || '#3B82F6',
        secondaryColor: branding.secondaryColor || '#1E40AF',
        iconType: 'shield',
      });
    }

    // Update theme color based on branding
    const themeColor = branding.layoutColors?.authPanelBg || '#0A1628';
    updateThemeColor(themeColor);
  }, [branding, loaded]);

  // This component doesn't render anything
  return null;
}
