import { Chip } from '@mui/material';
import { palette } from '../theme/palette';

const riskConfig = {
  critical: { label: 'Critical', color: palette.risk.critical, bg: `${palette.risk.critical}1A` },
  high: { label: 'High', color: palette.risk.high, bg: `${palette.risk.high}1A` },
  medium: { label: 'Medium', color: palette.risk.medium, bg: `${palette.risk.medium}1A` },
  low: { label: 'Low', color: palette.risk.low, bg: `${palette.risk.low}1A` },
};

export default function RiskBadge({ level, size = 'small' }) {
  const config = riskConfig[level?.toLowerCase()] || riskConfig.low;

  return (
    <Chip
      label={config.label}
      size={size}
      sx={{
        backgroundColor: config.bg,
        color: config.color,
        fontWeight: 700,
        fontSize: '0.7rem',
        height: size === 'small' ? 22 : 28,
        borderRadius: 1,
      }}
    />
  );
}
