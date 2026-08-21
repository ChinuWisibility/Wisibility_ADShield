import { Box, Chip, Tooltip, Typography } from '@mui/material';
import {
  formatMemberOfSummary,
  parseMemberOfEntitlements,
} from '../../utils/accountTableColumns';

export default function MemberOfEntitlementsCell({ value, compact = false }) {
  const parsed = parseMemberOfEntitlements(value);
  const summary = formatMemberOfSummary(parsed, compact ? 2 : 3);

  if (!summary.count) {
    return (
      <Typography variant="body2" component="span" sx={{ color: '#cbd5e1' }}>
        —
      </Typography>
    );
  }

  const tooltipContent = (
    <Box sx={{ maxWidth: 420, maxHeight: 280, overflow: 'auto', p: 0.5 }}>
      {parsed.displayItems.map((name, index) => (
        <Typography key={`${name}-${index}`} variant="caption" display="block" sx={{ py: 0.25 }}>
          {name}
        </Typography>
      ))}
      {parsed.isDnList && parsed.fullText ? (
        <Typography
          variant="caption"
          display="block"
          sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.2)', opacity: 0.85 }}
        >
          Raw: {parsed.fullText}
        </Typography>
      ) : null}
    </Box>
  );

  return (
    <Tooltip title={tooltipContent} arrow placement="top-start">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <Typography
          variant="body2"
          noWrap
          sx={{
            maxWidth: compact ? 200 : 320,
            fontSize: '0.8125rem',
            color: '#1e293b',
          }}
        >
          {summary.short}
        </Typography>
        {summary.count > 1 ? (
          <Chip
            label={summary.count}
            size="small"
            sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700 }}
          />
        ) : null}
      </Box>
    </Tooltip>
  );
}
