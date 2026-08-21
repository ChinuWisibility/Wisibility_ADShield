import { useMemo, useState } from 'react';
import {
  Box,
  Collapse,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CircleIcon from '@mui/icons-material/Circle';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import {
  postureCardAnimate,
  postureMetricChipStyle,
  postureScoreColor,
  POSTURE_COLORS,
} from './identityPostureTheme';
import {
  POSTURE_METRICS,
  POSTURE_METRIC_ROW_ORDER,
  SOD_VIOLATIONS_LABEL,
} from '../identityPostureLabels';

function MetricTrendIcon({ score, statusLabel }) {
  const l = String(statusLabel || '').toLowerCase();
  const isGood = score >= 80 || ['good', 'excellent', 'safe', 'optimal', 'low', 'low risk'].includes(l);
  if (isGood) {
    return <TrendingUpIcon sx={{ fontSize: 16, color: POSTURE_COLORS.green }} />;
  }
  return <CircleIcon sx={{ fontSize: 10, color: POSTURE_COLORS.orange }} />;
}

function MetricKpiShell({
  label,
  value,
  statusLabel,
  animateIndex = 0,
  action,
  footer,
}) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const chipStyle = postureMetricChipStyle(statusLabel);
  const scoreColor = postureScoreColor(pct);

  return (
    <Paper
      sx={{
        ...postureCardAnimate(animateIndex),
        p: 2.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 6px 16px rgba(15, 23, 42, 0.08)',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 0.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
          {label}
        </Typography>
        {action || null}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h4" sx={{ fontWeight: 800, color: scoreColor, lineHeight: 1 }}>
          {pct}%
        </Typography>
        <MetricTrendIcon score={pct} statusLabel={statusLabel} />
      </Box>

      {statusLabel ? (
        <Box
          sx={{
            display: 'inline-flex',
            alignSelf: 'flex-start',
            px: 1.25,
            py: 0.25,
            borderRadius: 1,
            bgcolor: chipStyle.bg,
            color: chipStyle.color,
            fontWeight: 700,
            fontSize: '0.68rem',
            letterSpacing: '0.02em',
          }}
        >
          {statusLabel}
        </Box>
      ) : null}

      {footer ? (
        <Box sx={{ mt: 'auto', pt: 1.5, borderTop: '1px solid #eef2f6' }}>
          {footer}
        </Box>
      ) : null}
    </Paper>
  );
}

function ViewToggleButton({ open, onToggle, openLabel, closedLabel }) {
  return (
    <Tooltip title={open ? openLabel : closedLabel}>
      <IconButton
        size="small"
        onClick={onToggle}
        aria-expanded={open}
        sx={{
          mt: -0.25,
          color: open ? 'primary.main' : 'text.secondary',
          bgcolor: open ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {open ? <VisibilityOffOutlinedIcon sx={{ fontSize: 18 }} /> : <VisibilityOutlinedIcon sx={{ fontSize: 18 }} />}
      </IconButton>
    </Tooltip>
  );
}

function AttributeCheck({ label, ok }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
      {ok ? (
        <CheckCircleIcon sx={{ fontSize: 18, color: '#22c55e' }} />
      ) : (
        <CancelIcon sx={{ fontSize: 18, color: '#ef4444' }} />
      )}
      <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.85rem' }}>
        {label}
      </Typography>
    </Box>
  );
}

function IdentityHygieneMetricCard({ label, value, statusLabel, attributeChecks, animateIndex }) {
  const [open, setOpen] = useState(false);
  const checks = useMemo(
    () => (Array.isArray(attributeChecks) ? attributeChecks.filter((c) => c.enabled !== false) : []),
    [attributeChecks],
  );
  const passCount = useMemo(() => checks.filter((c) => c.ok).length, [checks]);

  return (
    <MetricKpiShell
      label={label}
      value={value}
      statusLabel={statusLabel}
      animateIndex={animateIndex}
      action={checks.length > 0 ? (
        <ViewToggleButton
          open={open}
          onToggle={() => setOpen((v) => !v)}
          openLabel="Hide attributes"
          closedLabel="View attributes"
        />
      ) : null}
      footer={(
        <>
          {!open && checks.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {passCount} of {checks.length} present
            </Typography>
          )}
          <Collapse in={open}>
            {checks.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                No attributes configured.
              </Typography>
            ) : (
              <Box sx={{ pt: open ? 0.5 : 0 }}>
                {checks.map((item) => (
                  <AttributeCheck key={item.id} label={item.label} ok={item.ok} />
                ))}
              </Box>
            )}
          </Collapse>
        </>
      )}
    />
  );
}

function SodRiskMetricCard({ label, value, statusLabel, sodAnalysis, animateIndex }) {
  if (!sodAnalysis) {
    return <MetricKpiShell label={label} value={value} statusLabel={statusLabel} animateIndex={animateIndex} />;
  }

  const isSafe = sodAnalysis.status === 'SAFE';
  const count = sodAnalysis.violationCount ?? 0;
  const conflicts = sodAnalysis.conflicts || [];
  const countColor = isSafe ? POSTURE_COLORS.green : POSTURE_COLORS.orange;
  const violationLabel = count === 1 ? 'Violation' : SOD_VIOLATIONS_LABEL;

  return (
    <MetricKpiShell
      label={label}
      value={value}
      statusLabel={statusLabel}
      animateIndex={animateIndex}
      footer={(
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: conflicts.length > 0 ? 1 : 0 }}>
            {isSafe ? (
              <CheckCircleIcon sx={{ fontSize: 22, color: POSTURE_COLORS.green }} />
            ) : (
              <CancelIcon sx={{ fontSize: 22, color: POSTURE_COLORS.orange }} />
            )}
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: countColor }}>
              {count} {violationLabel}
            </Typography>
          </Box>
          {conflicts.length > 0 && (
            <Box sx={{ maxHeight: 72, overflow: 'auto' }}>
              {conflicts.slice(0, 3).map((conflict, i) => (
                <Typography
                  key={i}
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', fontWeight: 500, lineHeight: 1.45, mb: 0.35 }}
                >
                  • {conflict}
                </Typography>
              ))}
            </Box>
          )}
        </Box>
      )}
    />
  );
}

export default function PostureMetricKpiCard({ label, value, statusLabel, animateIndex = 0 }) {
  return (
    <MetricKpiShell
      label={label}
      value={value}
      statusLabel={statusLabel}
      animateIndex={animateIndex}
    />
  );
}

export function PostureMetricsRow({
  healthAnalysis,
  attributeChecks,
  sodAnalysis,
  startIndex = 2,
}) {
  if (!healthAnalysis) return null;

  const labels = healthAnalysis.labels || {};
  const metricByKey = Object.fromEntries(POSTURE_METRICS.map((m) => [m.key, m]));

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'repeat(2, 1fr)',
          lg: 'repeat(4, 1fr)',
        },
        gap: 2,
        alignItems: 'stretch',
      }}
    >
      {POSTURE_METRIC_ROW_ORDER.map((key, i) => {
        const metric = metricByKey[key];
        if (!metric) return null;

        const common = {
          key,
          label: metric.label,
          value: healthAnalysis[key],
          statusLabel: labels[key],
          animateIndex: startIndex + i,
        };

        if (key === 'identityHygiene') {
          return (
            <IdentityHygieneMetricCard
              {...common}
              attributeChecks={attributeChecks}
            />
          );
        }
        if (key === 'sodRisk') {
          return (
            <SodRiskMetricCard
              {...common}
              sodAnalysis={sodAnalysis}
            />
          );
        }
        return <PostureMetricKpiCard {...common} />;
      })}
    </Box>
  );
}
