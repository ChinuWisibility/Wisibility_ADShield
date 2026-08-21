import React from 'react';
import IdentityMindmapPanel from './IdentityMindmapPanel';
import CatalogSection from './CatalogSection';

export default function MindmapTab({ identityId, identityLabel, hasUploadedPhoto = false }) {
  return (
    <CatalogSection
      eyebrow="Identity"
      title="Mind map"
      subtitle="Applications, accounts, and entitlements linked to this identity."
      dense
      bodySx={{ p: 0 }}
    >
      <IdentityMindmapPanel
        identityId={identityId}
        identityLabel={identityLabel}
        hasUploadedPhoto={hasUploadedPhoto}
        hideChrome
        height={720}
      />
    </CatalogSection>
  );
}
