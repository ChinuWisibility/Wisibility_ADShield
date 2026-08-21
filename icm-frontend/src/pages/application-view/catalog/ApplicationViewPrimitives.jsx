import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography, Chip, Button } from '@mui/material';
import { TrendingUp, TrendingDown } from '@mui/icons-material';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { CATALOG } from '../../identities/catalog/catalogTheme';
import { DASH } from './applicationHealthUtils';

/**
 * Shared visual language for Application View tabs (Overview and beyond) —
 * card shell, section headers, stat columns, gauges, and trend charts, all
 * built on the CATALOG/DASH design tokens. Keep these tab-agnostic: no
 * fetching, no tab-specific data shaping.
 */

export function SectionHeading({ eyebrow, title, action }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 1, mb: 1.1, px: 0.25 }}>
      <Box>
        {eyebrow ? (
          <Typography sx={{ ...DASH.label, color: CATALOG.accent, mb: 0.3 }}>{eyebrow}</Typography>
        ) : null}
        <Typography sx={{ fontWeight: 800, fontSize: '1.02rem', color: CATALOG.ink, letterSpacing: '-0.01em' }}>
          {title}
        </Typography>
      </Box>
      {action || null}
    </Box>
  );
}

export function Card({
  title, icon, iconColor, children, action, sx, accent,
}) {
  return (
    <Box
      sx={{
        ...DASH.card,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        transition: 'box-shadow 0.18s ease, border-color 0.18s ease',
        '&:hover': { boxShadow: '0 4px 16px rgba(15,23,42,0.07)', borderColor: CATALOG.borderStrong },
        ...sx,
      }}
    >
      {accent ? <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, bgcolor: accent }} /> : null}
      {(title || action) ? (
        <Box
          sx={{
            px: 2,
            py: 1.4,
            mt: accent ? '3px' : 0,
            borderBottom: `1px solid ${CATALOG.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            {icon ? (
              <Box
                sx={{
                  width: 26,
                  height: 26,
                  borderRadius: 1.25,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: `${iconColor || CATALOG.accent}14`,
                  color: iconColor || CATALOG.accent,
                  flexShrink: 0,
                }}
              >
                {icon}
              </Box>
            ) : null}
            <Typography sx={{ fontWeight: 750, fontSize: '0.9rem', color: CATALOG.ink }} noWrap>{title}</Typography>
          </Box>
          {action || null}
        </Box>
      ) : null}
      <Box sx={{ p: 2.25, flex: 1 }}>{children}</Box>
    </Box>
  );
}

/** Icon-badged card with a vertical list of label/value stat rows (optional trend chip per row). */
export function StatColumn({
  title, icon, accent, rows,
}) {
  return (
    <Card accent={accent}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.85 }}>
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: `${accent}14`,
            color: accent,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Typography sx={{ ...DASH.label, color: CATALOG.ink, fontSize: '0.72rem' }}>{title}</Typography>
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        {rows.map((r) => (
          <Box key={r.label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkMuted, fontWeight: 500 }}>{r.label}</Typography>
              <Typography sx={{ fontWeight: 800, fontSize: '1.2rem', color: r.tone || CATALOG.ink, lineHeight: 1.2 }}>
                {typeof r.value === 'number' ? r.value.toLocaleString() : r.value}
              </Typography>
            </Box>
            {r.trend != null ? (
              <Chip
                size="small"
                icon={r.trend >= 0
                  ? <TrendingUp sx={{ fontSize: '14px !important' }} />
                  : <TrendingDown sx={{ fontSize: '14px !important' }} />}
                label={`${r.trend >= 0 ? '+' : ''}${r.trend}%`}
                sx={{
                  height: 22,
                  fontWeight: 700,
                  fontSize: '0.65rem',
                  bgcolor: r.trendGood === false ? 'rgba(220,38,38,0.08)' : 'rgba(5,150,105,0.08)',
                  color: r.trendGood === false ? '#DC2626' : '#059669',
                  '& .MuiChip-icon': { color: 'inherit' },
                }}
              />
            ) : null}
          </Box>
        ))}
      </Box>
    </Card>
  );
}

export function ActionCard({
  to, icon, title, body, cta, color,
}) {
  return (
    <Box
      sx={{
        ...DASH.card,
        p: 1.85,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        height: '100%',
        transition: 'box-shadow 0.18s ease, transform 0.18s ease, border-color 0.18s ease',
        '&:hover': {
          boxShadow: '0 6px 18px rgba(15,23,42,0.08)',
          borderColor: `${color}55`,
          transform: 'translateY(-1px)',
        },
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1.5,
          display: 'grid',
          placeItems: 'center',
          bgcolor: `${color}14`,
          color,
        }}
      >
        {icon}
      </Box>
      <Typography sx={{ fontWeight: 750, fontSize: '0.88rem', color: CATALOG.ink }}>{title}</Typography>
      <Typography sx={{ fontSize: '0.75rem', color: CATALOG.inkFaint, lineHeight: 1.4, flex: 1 }}>
        {body}
      </Typography>
      <Button
        component={RouterLink}
        to={to}
        size="small"
        variant="outlined"
        sx={{
          textTransform: 'none',
          fontWeight: 700,
          borderRadius: 1.5,
          alignSelf: 'flex-start',
          borderColor: color,
          color,
          mt: 0.5,
        }}
      >
        {cta}
      </Button>
    </Box>
  );
}

export function HealthGauge({ score, label, color }) {
  const data = [
    { name: 'score', value: score },
    { name: 'rest', value: Math.max(0, 100 - score) },
  ];
  return (
    <Box sx={{ position: 'relative', width: 140, height: 140, mx: 'auto' }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius={48}
            outerRadius={64}
            startAngle={90}
            endAngle={-270}
            stroke="none"
          >
            <Cell fill={color} />
            <Cell fill="#E2E8F0" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography sx={{ fontWeight: 800, fontSize: '1.65rem', color: CATALOG.ink, lineHeight: 1 }}>
          {score}%
        </Typography>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color, mt: 0.25 }}>{label}</Typography>
      </Box>
    </Box>
  );
}

export function TrendAreaChart({
  data,
  color,
  yDomain,
  yTickFormatter,
  tooltipFormatter,
}) {
  const gradId = `trendFill-${color.replace('#', '')}`;
  const tickIndexes = new Set();
  if (data.length) {
    const steps = Math.min(5, data.length);
    for (let i = 0; i < steps; i += 1) {
      tickIndexes.add(Math.round((i * (data.length - 1)) / Math.max(1, steps - 1)));
    }
  }
  const xTicks = data.filter((_, i) => tickIndexes.has(i)).map((d) => d.label);

  return (
    <Box sx={{ height: 220, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.32} />
              <stop offset="95%" stopColor={color} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#E8EDF3" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 500 }}
            tickLine={{ stroke: '#CBD5E1' }}
            axisLine={{ stroke: '#E2E8F0' }}
            interval={0}
            ticks={xTicks}
          />
          <YAxis
            domain={yDomain}
            tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 500 }}
            tickLine={false}
            axisLine={false}
            width={42}
            tickFormatter={yTickFormatter}
          />
          <Tooltip
            formatter={tooltipFormatter}
            labelFormatter={(label) => label}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid #E2E8F0',
              boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.5}
            fill={`url(#${gradId})`}
            dot={(props) => {
              const { cx, cy, index } = props;
              if (!tickIndexes.has(index) || cx == null || cy == null) return null;
              return (
                <circle
                  key={`dot-${index}`}
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill={color}
                  stroke="#fff"
                  strokeWidth={2}
                />
              );
            }}
            activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
