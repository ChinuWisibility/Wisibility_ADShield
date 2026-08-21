import React from 'react';
import IdentityPostureDashboard from './IdentityPostureDashboard';
import CatalogSection from './CatalogSection';

export default function PostureTab({ identityId }) {
  return (
    <CatalogSection
      eyebrow="Risk intelligence"
      title="Identity posture"
      subtitle="Hygiene, access complexity, SoD risk, and peer benchmarks for this user."
      dense
      bodySx={{ bgcolor: '#f4f6f9', p: { xs: 1.5, sm: 2 } }}
    >
      <IdentityPostureDashboard identityId={identityId} showRefresh fillPageBg={false} />
    </CatalogSection>
  );
}
