import { Alert, Box, Grid } from '@mui/material';
import DataHygieneWidgetCard from './components/DataHygieneWidgetCard';

/** Max width per application tile (3 per row on md+). */
const APPLICATION_TILE_MAX_WIDTH = 450;

export default function DataHygieneApplicationDashboard({
  applicationTiles = [],
  loading = false,
  tenantIdForLinks = null,
}) {
  return (
    <Grid container spacing={3}>
      {applicationTiles.map((tile, index) => (
        <Grid
          item
          xs={12}
          sm={12}
          md={4}
          lg={4}
          key={tile.id}
          sx={{ display: 'flex', justifyContent: { xs: 'center', md: 'flex-start' } }}
        >
          <Box sx={{ width: '100%', maxWidth: { xs: 480, md: APPLICATION_TILE_MAX_WIDTH } }}>
            <DataHygieneWidgetCard
              widget={tile}
              loading={loading}
              tenantIdForLinks={tenantIdForLinks}
              dashboardView="application"
              themeIndex={index}
            />
          </Box>
        </Grid>
      ))}
      {!loading && applicationTiles.length === 0 && (
        <Grid item xs={12}>
          <Alert severity="warning">No application tile data returned. Check tenant scope and API response.</Alert>
        </Grid>
      )}
    </Grid>
  );
}
