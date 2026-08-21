import { useEffect, useState } from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { ResponsiveContainer, RadialBarChart, RadialBar } from 'recharts';
import { postureScoreColor, postureMetricChipStyle, POSTURE_COLORS } from './identityPostureTheme';

/** Full-circle radial metric (KPI cards) */
export default function IdentityPostureRadialMetric({
  label,
  value = 0,
  statusLabel,
  size = 72,
  compact = false,
  animate = true,
}) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const color = postureScoreColor(pct);
  const chipStyle = postureMetricChipStyle(statusLabel);
  const data = [{ name: label, value: pct, fill: color }];

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: compact ? 'row' : 'column',
        alignItems: 'center',
        gap: compact ? 1.5 : 0.75,
        minWidth: compact ? '100%' : 90,
      }}
    >
      <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="72%"
            outerRadius="100%"
            barSize={8}
            data={data}
            startAngle={90}
            endAngle={-270}
          >
            <RadialBar
              background={{ fill: '#f1f5f9' }}
              dataKey="value"
              cornerRadius={4}
              isAnimationActive={animate}
              animationDuration={900}
              animationBegin={200}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <Typography
            variant="caption"
            sx={{ fontWeight: 800, fontSize: compact ? '0.7rem' : '0.75rem', color: 'text.primary' }}
          >
            {pct}%
          </Typography>
        </Box>
      </Box>
      <Box sx={{ textAlign: compact ? 'left' : 'center', flex: compact ? 1 : undefined }}>
        {label ? (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              fontWeight: 600,
              color: 'text.secondary',
              fontSize: '0.68rem',
              lineHeight: 1.2,
              mb: 0.5,
            }}
          >
            {label}
          </Typography>
        ) : null}
        {statusLabel && (
          <Chip
            label={statusLabel}
            size="small"
            sx={{
              height: 18,
              fontSize: '0.58rem',
              fontWeight: 700,
              bgcolor: chipStyle.bg,
              color: chipStyle.color,
            }}
          />
        )}
      </Box>
    </Box>
  );
}

/** Semi-circular gauge for the overall posture score hero card */
export function PostureSemiGauge({
  value = 0,
  statusLabel,
  size = 200,
  strokeWidth = 14,
  color,
  animate = true,
}) {
  const [displayPct, setDisplayPct] = useState(animate ? 0 : value);
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const fillColor = color || postureScoreColor(pct);
  const chipStyle = postureMetricChipStyle(statusLabel);

  useEffect(() => {
    if (!animate) {
      setDisplayPct(pct);
      return undefined;
    }
    const t = setTimeout(() => setDisplayPct(pct), 120);
    return () => clearTimeout(t);
  }, [pct, animate]);

  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2 + 8;
  const circumference = Math.PI * radius;
  const offset = circumference - (displayPct / 100) * circumference;

  return (
    <Box sx={{ position: 'relative', width: size, height: size * 0.62, mx: 'auto' }}>
      <svg width={size} height={size * 0.62} viewBox={`0 0 ${size} ${size * 0.62}`}>
        <path
          d={`M ${strokeWidth / 2} ${cy} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${cy}`}
          fill="none"
          stroke="#e8ecf1"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        <path
          d={`M ${strokeWidth / 2} ${cy} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${cy}`}
          fill="none"
          stroke={fillColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 4,
          textAlign: 'center',
        }}
      >
        <Typography variant="h3" sx={{ fontWeight: 800, color: POSTURE_COLORS.blueDark, lineHeight: 1 }}>
          {Math.round(displayPct)}%
        </Typography>
        {statusLabel && (
          <Chip
            label={statusLabel}
            size="small"
            sx={{
              mt: 0.5,
              height: 22,
              fontWeight: 700,
              fontSize: '0.65rem',
              bgcolor: chipStyle.bg,
              color: chipStyle.color,
            }}
          />
        )}
      </Box>
    </Box>
  );
}

/** Small circular peer-average gauge */
export function PosturePeerMiniGauge({ value = 0, label = 'Peer Average', size = 72 }) {
  const [displayPct, setDisplayPct] = useState(0);
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const data = [{ name: label, value: displayPct, fill: '#94a3b8' }];

  useEffect(() => {
    const t = setTimeout(() => setDisplayPct(pct), 400);
    return () => clearTimeout(t);
  }, [pct]);

  return (
    <Box sx={{ textAlign: 'center' }}>
      <Box sx={{ position: 'relative', width: size, height: size, mx: 'auto' }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="68%"
            outerRadius="100%"
            barSize={6}
            data={data}
            startAngle={90}
            endAngle={-270}
          >
            <RadialBar
              background={{ fill: '#f1f5f9' }}
              dataKey="value"
              cornerRadius={4}
              isAnimationActive
              animationDuration={800}
              animationBegin={300}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <Typography variant="caption" sx={{ fontWeight: 800, fontSize: '0.72rem' }}>
            {Math.round(displayPct)}%
          </Typography>
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.65rem' }}>
        {label}
      </Typography>
    </Box>
  );
}
