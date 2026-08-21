import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  Stack,
} from '@mui/material';
import { ShieldOutlined, GroupsOutlined, GppGoodOutlined } from '@mui/icons-material';

const tiles = [
  {
    title: 'Access Certification',
    description: 'Launch manager, identity, and access item campaigns powered by /api/access-certification.',
    cta: 'Open Access Certification',
    icon: <GppGoodOutlined />,
    path: '/governance/certifications/access',
    status: { label: 'Available', color: 'success' },
    disabled: false,
  },
  {
    title: 'SoD Certification',
    description: 'Coming soon: certify SoD violations directly from policies and violation queues.',
    cta: 'Coming Soon',
    icon: <ShieldOutlined />,
    path: '/governance/certifications/sod',
    status: { label: 'Planned', color: 'default' },
    disabled: true,
  },
  {
    title: 'Executive Sign-off',
    description: 'Future enhancement for schedule-driven sign-off and audit-grade evidence.',
    cta: 'Planned',
    icon: <GroupsOutlined />,
    path: '/governance/certifications/signoff',
    status: { label: 'Planned', color: 'default' },
    disabled: true,
  },
];

export default function CertificationsHub() {
  const navigate = useNavigate();

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Certifications</Typography>
          <Typography variant="body2" color="text.secondary">
            Choose a certification track to continue.
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => navigate('/governance/certifications/access')}>
          Access Certification
        </Button>
      </Stack>

      <Grid container spacing={2.5}>
        {tiles.map((tile) => (
          <Grid item xs={12} sm={6} md={4} key={tile.title}>
            <Card
              variant="outlined"
              sx={{
                height: '100%',
                borderRadius: 2,
                borderColor: 'divider',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box
                    sx={{
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'linear-gradient(135deg,#2563eb22,#2563eb11)',
                      color: '#1e3a8a',
                    }}
                  >
                    {tile.icon}
                  </Box>
                  <Typography variant="subtitle1" fontWeight={700}>{tile.title}</Typography>
                  <Chip size="small" label={tile.status.label} color={tile.status.color} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {tile.description}
                </Typography>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2, pt: 0 }}>
                <Button
                  fullWidth
                  variant={tile.disabled ? 'outlined' : 'contained'}
                  disabled={tile.disabled}
                  onClick={() => !tile.disabled && navigate(tile.path)}
                >
                  {tile.cta}
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
