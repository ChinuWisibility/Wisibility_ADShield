import { Chip } from '@mui/material';
import { palette } from '../theme/palette';

const statusConfig = {
  active: { color: 'success', label: 'Active' },
  inactive: { color: 'default', label: 'Inactive' },
  disabled: { color: 'error', label: 'Disabled' },
  pending: { color: 'warning', label: 'Pending' },
  in_progress: { color: 'warning', label: 'In Progress' },
  completed: { color: 'success', label: 'Completed' },
  executed: { color: 'success', label: 'Executed' },
  expired: { color: 'error', label: 'Expired' },
  open: { color: 'info', label: 'Open' },
  closed: { color: 'default', label: 'Closed' },
  approved: { color: 'success', label: 'Approved' },
  denied: { color: 'warning', label: 'Denied' },
  rejected: { color: 'error', label: 'Rejected' },
  failed: { color: 'error', label: 'Failed' },
  canceled: { color: 'default', label: 'Canceled' },
  revoked: { color: 'error', label: 'Revoked' },
};

export default function StatusChip({ status, label, size = 'small' }) {
  const config = statusConfig[status?.toLowerCase()] || { color: 'default', label: status };

  return (
    <Chip
      label={label || config.label}
      color={config.color}
      size={size}
      variant="filled"
      sx={{ fontWeight: 600, fontSize: '0.7rem', height: size === 'small' ? 22 : 28, borderRadius: 1 }}
    />
  );
}
