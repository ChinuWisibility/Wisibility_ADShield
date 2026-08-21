/**
 * Application brand mark for graph nodes.
 * Priority: tenant icon library -> Simple Icons CDN -> initial badge.
 */

import { useState } from 'react';
import { Box } from '@mui/material';
import { resolveApplicationIconSrc } from '../../../components/applications/ApplicationIconPicker';
import { GRAPH_COLORS, GRAPH_FONT } from './accessGraphTheme';

/** Application name (normalized) -> Simple Icons slug. */
const SIMPLE_ICON_SLUGS = {
  github: 'github',
  gitlab: 'gitlab',
  bitbucket: 'bitbucket',
  salesforce: 'salesforce',
  servicenow: 'servicenow',
  workday: 'workday',
  sap: 'sap',
  oracle: 'oracle',
  okta: 'okta',
  slack: 'slack',
  jira: 'jira',
  confluence: 'confluence',
  tableau: 'tableau',
  google: 'google',
  googleworkspace: 'google',
  gsuite: 'google',
  microsoft: 'microsoft',
  microsoft365: 'microsoft',
  office365: 'microsoft',
  azure: 'microsoftazure',
  azuread: 'microsoftazure',
  aws: 'amazonwebservices',
  amazonwebservices: 'amazonwebservices',
  zoom: 'zoom',
  dropbox: 'dropbox',
  box: 'box',
  snowflake: 'snowflake',
  databricks: 'databricks',
  notion: 'notion',
  figma: 'figma',
  atlassian: 'atlassian',
  docusign: 'docusign',
  zendesk: 'zendesk',
  hubspot: 'hubspot',
  workato: 'workato',
  sailpoint: 'sailpoint',
};

function normalize(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function simpleIconUrl(applicationName) {
  const compact = normalize(applicationName);
  if (!compact) return null;
  let slug = SIMPLE_ICON_SLUGS[compact];
  if (!slug) {
    const hit = Object.keys(SIMPLE_ICON_SLUGS).find(
      (key) => key.length >= 3 && compact.includes(key),
    );
    slug = hit ? SIMPLE_ICON_SLUGS[hit] : null;
  }
  return slug ? `https://cdn.simpleicons.org/${slug}` : null;
}

export default function ApplicationLogo({ name, icon, color, size = 44 }) {
  const [stage, setStage] = useState(0);

  const sources = [resolveApplicationIconSrc(icon), simpleIconUrl(name)].filter(Boolean);
  const src = sources[stage] || null;
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';

  if (!src) {
    return (
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          bgcolor: color || GRAPH_COLORS.applicationSoft,
          color: color ? '#fff' : GRAPH_COLORS.application,
          border: `1px solid ${GRAPH_COLORS.border}`,
          fontFamily: GRAPH_FONT,
          fontWeight: 800,
          fontSize: size * 0.4,
        }}
      >
        {initial}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        bgcolor: '#fff',
        border: `1px solid ${GRAPH_COLORS.border}`,
        boxShadow: '0 1px 4px rgba(15,23,42,0.08)',
        overflow: 'hidden',
        p: size * 0.16 + 'px',
        boxSizing: 'border-box',
      }}
    >
      <Box
        component="img"
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setStage((s) => s + 1)}
        sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </Box>
  );
}
