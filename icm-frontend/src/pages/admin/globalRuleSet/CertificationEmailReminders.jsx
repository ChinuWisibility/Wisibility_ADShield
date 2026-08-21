import { useNavigate } from 'react-router-dom';
import { Box, Button } from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import ReminderSettings from '../../governance/accessCertification/ReminderSettings';

const ORG_ADMIN_BASE = '/org-admin';

/**
 * Tenant-wide certification reminder cadence.
 * Campaigns with reminderFrequency = GLOBAL inherit this schedule.
 */
export default function CertificationEmailReminders() {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        // Cancel MainLayout outlet padding so this page sits flush with the sidebar.
        m: -3,
        minHeight: 'calc(100vh - 64px)',
        bgcolor: 'background.paper',
        px: 2,
        pt: 1.5,
        pb: 3,
      }}
    >
      <Button
        startIcon={<ArrowBack fontSize="small" />}
        onClick={() => navigate(`${ORG_ADMIN_BASE}/global-rule-set`)}
        size="small"
        sx={{ mb: 1.5, color: 'text.secondary', textTransform: 'none' }}
      >
        Global rule set
      </Button>

      <ReminderSettings isAdmin scopeLabel="Global rule set" compact />
    </Box>
  );
}
