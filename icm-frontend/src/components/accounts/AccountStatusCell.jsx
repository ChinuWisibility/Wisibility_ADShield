import { Chip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { formatAccountStatusDisplay } from '../../utils/accountTableColumns';

const TONE_STYLES = {
  success: {
    bgcolor: alpha('#16a34a', 0.12),
    color: '#166534',
    border: `1px solid ${alpha('#16a34a', 0.25)}`,
  },
  warning: {
    bgcolor: alpha('#d97706', 0.12),
    color: '#92400e',
    border: `1px solid ${alpha('#d97706', 0.25)}`,
  },
  default: {
    bgcolor: alpha('#64748b', 0.1),
    color: '#475569',
    border: `1px solid ${alpha('#64748b', 0.2)}`,
  },
};

export default function AccountStatusCell({ value, enableReportFeatures = false }) {
  const { label, tone } = formatAccountStatusDisplay(value);

  if (label === '—') {
    return (
      <Typography variant="body2" component="span" sx={{ color: '#cbd5e1' }}>
        —
      </Typography>
    );
  }

  const toneStyle = TONE_STYLES[tone] || TONE_STYLES.default;

  return (
    <Chip
      label={label}
      size="small"
      sx={
        enableReportFeatures
          ? {
              fontWeight: 600,
              height: 22,
              fontSize: '0.68rem',
              borderRadius: '6px',
              ...toneStyle,
            }
          : {
              fontWeight: 500,
              height: 20,
              fontSize: '0.7rem',
              ...toneStyle,
            }
      }
    />
  );
}
