import { Box, Typography, Tooltip, IconButton, Chip, alpha } from '@mui/material';
import { ContentCopy } from '@mui/icons-material';
import { palette } from '../../theme/palette';

export const ACCOUNT_TRUNC = 22;

export function TruncatedCell({ text, max = ACCOUNT_TRUNC, monospace, copyable, onCopied }) {
  const full = text == null || text === '' ? '—' : String(text);
  const truncated = full.length > max ? `${full.slice(0, max)}…` : full;
  const showTip = full.length > max;
  const inner = (
    <Typography
      variant="body2"
      component="span"
      sx={{
        fontFamily: monospace ? 'ui-monospace, monospace' : 'inherit',
        fontSize: monospace ? '0.8rem' : undefined,
        display: 'inline-block',
        maxWidth: 280,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
      }}
    >
      {truncated}
    </Typography>
  );
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, maxWidth: '100%' }}>
      {showTip ? (
        <Tooltip title={full} placement="top" enterDelay={400}>
          <span>{inner}</span>
        </Tooltip>
      ) : (
        inner
      )}
      {copyable && full !== '—' && (
        <Tooltip title="Copy">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              void navigator.clipboard.writeText(full).then(() => onCopied?.());
            }}
            sx={{ p: 0.25 }}
          >
            <ContentCopy sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

export function CorrelationTypeBadge({ type }) {
  const t = String(type || 'RULE_BASED').toUpperCase();
  const sx = { height: 22, fontWeight: 600, fontSize: '0.7rem' };
  if (t === 'AUTO') {
    return <Chip label="AUTO" size="small" variant="outlined" color="success" sx={sx} />;
  }
  if (t === 'MANUAL') {
    return <Chip label="MANUAL" size="small" variant="outlined" color="primary" sx={sx} />;
  }
  return (
    <Chip
      label="RULE_BASED"
      size="small"
      variant="outlined"
      sx={{ ...sx, color: palette.text.secondary, borderColor: alpha(palette.text.secondary, 0.35) }}
    />
  );
}

/** Uncorrelated queue — same visual language as correlation type chips. */
export function UncorrelatedTypeBadge() {
  return (
    <Chip
      label="UNCORRELATED"
      size="small"
      variant="outlined"
      color="warning"
      sx={{ height: 22, fontWeight: 600, fontSize: '0.7rem' }}
    />
  );
}

export function ConfidenceBadge({ level }) {
  const l = String(level || 'HIGH').toUpperCase();
  let chipColor = 'success';
  if (l === 'MEDIUM') chipColor = 'warning';
  if (l === 'LOW') chipColor = 'error';
  return (
    <Chip
      label={l}
      size="small"
      color={chipColor}
      variant="outlined"
      sx={{ height: 22, fontWeight: 600, fontSize: '0.7rem' }}
    />
  );
}

export function MatchRuleChips({ identityKey, accountKey, tooltip }) {
  const ik = identityKey || '—';
  const ak = accountKey || '—';
  return (
    <Tooltip title={tooltip || ''} placement="top">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.04 }}>
          Match rule
        </Typography>
        <Chip label={`Identity: ${ik}`} size="small" variant="outlined" sx={{ height: 24, fontSize: '0.7rem' }} />
        <Typography variant="body2" color="text.secondary">
          →
        </Typography>
        <Chip label={`Account: ${ak}`} size="small" variant="outlined" sx={{ height: 24, fontSize: '0.7rem' }} />
      </Box>
    </Tooltip>
  );
}

export function appBadgeColor(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i += 1) h = (h + s.charCodeAt(i) * 17) % 360;
  return `hsl(${h} 42% 92%)`;
}
