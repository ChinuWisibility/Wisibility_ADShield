import { Card, CardContent, Box, Typography, alpha, Skeleton } from '@mui/material';
import { TrendingUp, TrendingDown } from '@mui/icons-material';
import { palette } from '../theme/palette';

export default function StatCard({
  title,
  value,
  /** When true, replaces the main value with a skeleton (initial data fetch). */
  loading = false,
  subtitle,
  icon,
  color = palette.brand.primary,
  trend,
  trendValue,
  /** When true, reserves a fixed subtitle row so cards in a row match height (e.g. PDF export). */
  reserveSubtitleSpace = false,
  sx,
}) {
  const isUp = trend === 'up';
  const trendColor = isUp ? palette.status.success : palette.status.error;

  return (
    <Card sx={{
      position: 'relative', overflow: 'hidden',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      '&::before': {
        content: '""', position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${color}, ${alpha(color, 0.4)})`,
      },
      ...sx,
    }}>
      <CardContent sx={{ p: 2.5, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.25,
            flex: 1,
            minHeight: 0,
          }}
        >
          <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
            <Typography
              variant="subtitle2"
              sx={{
                color: palette.text.secondary,
                mb: 1,
                pr: 0.5,
                lineHeight: 1.25,
                wordBreak: 'break-word',
              }}
            >
              {title}
            </Typography>
            {loading ? (
              <Skeleton variant="rounded" width={140} height={44} sx={{ borderRadius: 1 }} />
            ) : (
              <Typography variant="h3" sx={{ fontWeight: 800, lineHeight: 1 }}>
                {value}
              </Typography>
            )}
            {reserveSubtitleSpace ? (
              <Box sx={{ minHeight: 40, mt: 0.5 }}>
                {subtitle ? (
                  <Typography variant="caption" sx={{ color: palette.text.secondary, display: 'block', lineHeight: 1.35 }}>
                    {subtitle}
                  </Typography>
                ) : null}
              </Box>
            ) : (
              subtitle && (
                <Typography variant="caption" sx={{ color: palette.text.secondary, mt: 0.5, display: 'block', lineHeight: 1.35 }}>
                  {subtitle}
                </Typography>
              )
            )}
            {trendValue && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                {isUp ? <TrendingUp sx={{ fontSize: 16, color: trendColor }} /> : <TrendingDown sx={{ fontSize: 16, color: trendColor }} />}
                <Typography variant="caption" sx={{ color: trendColor, fontWeight: 600 }}>
                  {trendValue}
                </Typography>
              </Box>
            )}
          </Box>
          {icon && (
            <Box
              sx={{
                p: 1,
                borderRadius: 2,
                backgroundColor: alpha(color, 0.1),
                color: color,
                display: 'flex',
                flexShrink: 0,
                alignSelf: 'flex-start',
                ml: 'auto',
              }}
            >
              {icon}
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
