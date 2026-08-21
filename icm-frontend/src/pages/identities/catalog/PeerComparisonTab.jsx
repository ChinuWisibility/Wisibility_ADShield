import React from 'react';
import PeerComparisonPanel from './PeerComparisonPanel';
import CatalogSection from './CatalogSection';

export default function PeerComparisonTab({ identity }) {
  return (
    <CatalogSection
      eyebrow="Peer intelligence"
      title="Peer access comparison"
      subtitle="Unusual access for this identity versus peers with similar department and role — loaded automatically."
      dense
      bodySx={{ bgcolor: '#f8fafc' }}
    >
      <PeerComparisonPanel identity={identity} />
    </CatalogSection>
  );
}
