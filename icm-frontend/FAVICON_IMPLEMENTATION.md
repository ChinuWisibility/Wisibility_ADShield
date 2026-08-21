# Dynamic Favicon Implementation

## Overview

The favicon now automatically updates when you upload and set a logo as the favicon in the Branding & UI settings.

## How It Works

### 1. **Branding Context** (`BrandingContext.jsx`)

- Stores `faviconUrl` and `logoUrl` from the backend
- Automatically resolves image URLs
- Provides `refreshBranding()` to update context when logos change

### 2. **Favicon Utilities** (`utils/faviconUtils.js`)

- `updateFavicon()` - Updated to accept:
  - Direct URL string: `updateFavicon('https://example.com/logo.png')`
  - URL in options: `updateFavicon({ url: '/uploads/logo.png' })`
  - Custom colors: `updateFavicon({ primaryColor: '#3B82F6', secondaryColor: '#1E40AF' })`
- `updateThemeColor()` - Updates the browser theme color meta tag

### 3. **FaviconUpdater Component** (`components/FaviconUpdater.jsx`)

- Invisible component that watches the branding context
- Automatically updates browser favicon when branding changes
- Priority order:
  1. Custom favicon (if set)
  2. Platform logo (if no favicon)
  3. Generated SVG with brand colors (fallback)

### 4. **App Integration** (`App.jsx`)

- `<FaviconUpdater />` added inside `<BrandingProvider>`
- Runs on app initialization and whenever branding updates

## Usage Flow

### For End Users:

1. Go to **Settings → Branding & UI → Logos tab**
2. Upload an image (drag & drop or click to upload)
3. Click the star icon (StarBorder) next to any logo to set it as favicon
4. **Browser favicon updates instantly**

### For Developers:

```javascript
import { updateFavicon, updateThemeColor } from "./utils/faviconUtils";

// Update with image URL
updateFavicon("https://example.com/favicon.png");

// Update with custom colors
updateFavicon({
  primaryColor: "#3B82F6",
  secondaryColor: "#1E40AF",
  iconType: "shield", // or 'circle', 'square'
});

// Update theme color
updateThemeColor("#0A1628");
```

## Files Modified/Created

### Created:

- `src/components/FaviconUpdater.jsx` - Watches branding and updates favicon
- `src/utils/faviconUtils.js` - Favicon manipulation utilities
- `public/icm-favicon.svg` - Default SVG favicon with shield icon

### Modified:

- `src/App.jsx` - Added FaviconUpdater component
- `index.html` - Added `id="favicon"` and `id="theme-color"` for dynamic updates

## Technical Details

- **Automatic Updates**: FaviconUpdater uses React's `useEffect` to watch branding changes
- **Image Support**: Supports PNG, JPG, SVG, and other image formats
- **Fallback Chain**: favicon → logo → generated SVG
- **Theme Color**: Automatically syncs with `layoutColors.authPanelBg`
- **No Page Reload**: Updates happen instantly without refreshing the page

## Testing

1. Upload a logo in Branding Settings
2. Click the favicon star icon to set it as favicon
3. Check the browser tab - favicon should update immediately
4. Try uploading different images and switching between them
5. Remove favicon assignment - should fall back to logo or default SVG

## Notes

- Favicon changes persist across sessions (stored in backend)
- Works with all modern browsers
- Supports high-DPI displays
- Favicon is cached by the branding context for performance
