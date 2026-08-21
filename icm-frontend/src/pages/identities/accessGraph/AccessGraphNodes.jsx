/**
 * Custom React Flow nodes for the Identity Access Map.
 * Identity hub card, application circles, account pills, role pills and the
 * decorative orbit rings — styled after the radial mindmap mockup.
 */

import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Avatar, Box, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import {
  Add,
  Remove,
  CheckCircle,
  ErrorOutline,
  PersonOutline,
  ShieldOutlined,
  ArrowForward,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import ApplicationLogo from './ApplicationLogo';
import {
  GLASS_SURFACE,
  GRAPH_COLORS,
  GRAPH_FONT,
  HOVER_SHADOW,
  NODE_SIZE,
  SOFT_SHADOW,
} from './accessGraphTheme';
import {
  fetchIdentityPosture,
  identityPostureQueryKey,
  IDENTITY_POSTURE_STALE_MS,
} from '../catalog/identityCatalogQueries';
import { FINAL_POSTURE_SCORE_LABEL } from '../posture/identityPostureLabels';

const HIDDEN_HANDLE = {
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  border: 'none',
  background: 'transparent',
  opacity: 0,
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'none',
};

/** Centre-anchored handles; the floating edge computes real attachment points. */
function CenterHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} id="in" style={HIDDEN_HANDLE} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="out" style={HIDDEN_HANDLE} isConnectable={false} />
    </>
  );
}

const ENTER = {
  initial: { opacity: 0, scale: 0.82 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.82 },
  transition: { type: 'spring', stiffness: 260, damping: 24, mass: 0.7 },
};

function ExpandButton({ expanded, count, onClick, accent, label, size = 26 }) {
  return (
    <Tooltip title={expanded ? `Collapse ${label}` : `Expand ${label}${count ? ` (${count})` : ''}`} arrow>
      <Box
        component="button"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClick?.();
        }}
        className="nodrag nopan"
        aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          p: 0,
          border: `1.5px solid ${accent}`,
          bgcolor: expanded ? accent : GRAPH_COLORS.surfaceRing,
          color: expanded ? '#0B1222' : accent,
          boxShadow: `0 2px 10px rgba(2,6,18,0.55), 0 0 12px ${accent}55`,
          transition: 'transform 140ms ease, box-shadow 140ms ease',
          '&:hover': { transform: 'scale(1.12)', boxShadow: `0 4px 16px rgba(2,6,18,0.6), 0 0 18px ${accent}88` },
        }}
      >
        {expanded ? <Remove sx={{ fontSize: size * 0.66 }} /> : <Add sx={{ fontSize: size * 0.66 }} />}
      </Box>
    </Tooltip>
  );
}

function dimSx(isDimmed) {
  return isDimmed
    ? { opacity: 0.22, filter: 'saturate(0.35)', transition: 'opacity 200ms ease' }
    : { opacity: 1, transition: 'opacity 200ms ease' };
}

function matchRing(isMatch) {
  return isMatch ? `0 0 0 3px ${GRAPH_COLORS.match}66, ${HOVER_SHADOW}` : null;
}

function postureTone(score, apiLabel) {
  const n = Number(score);
  const label = String(apiLabel || '').trim().toUpperCase()
    || (Number.isFinite(n)
      ? (n >= 80 ? 'STRONG' : n >= 60 ? 'GOOD' : n >= 40 ? 'FAIR' : 'WEAK')
      : '—');
  if (!Number.isFinite(n)) {
    return { label, color: GRAPH_COLORS.inkSoft, bg: GRAPH_COLORS.surfaceAlt };
  }
  if (n >= 80) return { label, color: '#86EFAC', bg: 'rgba(22,163,74,0.22)' };
  if (n >= 60) return { label, color: '#BBF7D0', bg: 'rgba(22,163,74,0.18)' };
  if (n >= 40) return { label, color: '#FCD34D', bg: 'rgba(217,119,6,0.22)' };
  return { label, color: '#FCA5A5', bg: 'rgba(220,38,38,0.22)' };
}

/* ------------------------------------------------------------------ */
/* Identity hub card                                                   */
/* ------------------------------------------------------------------ */

export const IdentityNode = memo(function IdentityNode({ data }) {
  const { identity, expanded, hasChildren, isMatch, isDimmed } = data;
  const identityId = identity.identityId;
  const postureQuery = useQuery({
    queryKey: identityPostureQueryKey(identityId),
    queryFn: () => fetchIdentityPosture(identityId),
    enabled: Boolean(identityId),
    staleTime: IDENTITY_POSTURE_STALE_MS,
  });
  const health = postureQuery.data?.healthAnalysis;
  const postureScore = Number.isFinite(Number(health?.finalPosture))
    ? Math.max(0, Math.min(100, Math.round(Number(health.finalPosture))))
    : null;
  const tone = postureTone(postureScore, health?.labels?.finalPosture);
  const initials = String(identity.name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
  const subtitle = [identity.employeeId, identity.jobTitle].filter(Boolean).join('  •  ');
  const statusLabel = identity.isActive
    ? (identity.lifecycleState || 'Active').toUpperCase()
    : (identity.lifecycleState || 'Inactive').toUpperCase();

  return (
    <motion.div {...ENTER} style={{ width: NODE_SIZE.identity.w, height: NODE_SIZE.identity.h }}>
      <CenterHandles />
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: '22px',
          px: 2,
          pt: 2,
          pb: 1.5,
          boxSizing: 'border-box',
          ...GLASS_SURFACE,
          border: `1px solid ${GRAPH_COLORS.border}`,
          boxShadow: matchRing(isMatch) || '0 20px 48px rgba(2, 6, 18, 0.62), 0 0 26px rgba(96, 165, 250, 0.18)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
          overflow: 'visible',
          ...dimSx(isDimmed),
        }}
      >
        {/* Avatar with gradient orbit ring */}
        <Box
          sx={{
            position: 'relative',
            width: 72,
            height: 72,
            borderRadius: '50%',
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            background: `conic-gradient(from 210deg, ${GRAPH_COLORS.identity}, ${GRAPH_COLORS.application}, #22D3EE, ${GRAPH_COLORS.identity})`,
            p: '3px',
          }}
        >
          <Avatar
            src={data.photoSrc || undefined}
            sx={{
              width: '100%',
              height: '100%',
              fontFamily: GRAPH_FONT,
              fontWeight: 800,
              fontSize: '1.3rem',
              bgcolor: GRAPH_COLORS.identity,
              color: '#0B1222',
              border: `3px solid ${GRAPH_COLORS.surfaceRing}`,
            }}
          >
            {initials || '?'}
          </Avatar>
          <Tooltip title={identity.isActive ? 'Active identity' : 'Inactive identity'} arrow>
            <Box
              sx={{
                position: 'absolute',
                right: -1,
                bottom: -1,
                width: 20,
                height: 20,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                bgcolor: GRAPH_COLORS.surfaceRing,
                boxShadow: '0 1px 6px rgba(2,6,18,0.6)',
              }}
            >
              {identity.isActive ? (
                <CheckCircle sx={{ fontSize: 17, color: GRAPH_COLORS.success }} />
              ) : (
                <ErrorOutline sx={{ fontSize: 17, color: GRAPH_COLORS.warning }} />
              )}
            </Box>
          </Tooltip>
        </Box>

        <Box sx={{ width: '100%', textAlign: 'center', minHeight: 0 }}>
          <Typography
            sx={{
              fontFamily: GRAPH_FONT,
              fontWeight: 800,
              fontSize: '1.02rem',
              color: GRAPH_COLORS.ink,
              lineHeight: 1.25,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={identity.name}
          >
            {identity.name}
          </Typography>
          {subtitle ? (
            <Typography
              sx={{
                fontFamily: GRAPH_FONT,
                fontSize: '0.7rem',
                fontWeight: 600,
                color: GRAPH_COLORS.inkSoft,
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={subtitle}
            >
              {subtitle}
            </Typography>
          ) : null}
        </Box>

        <Box
          sx={{
            px: 1.4,
            py: 0.3,
            borderRadius: 999,
            bgcolor: identity.isActive ? GRAPH_COLORS.successSoft : 'rgba(217,119,6,0.12)',
            color: identity.isActive ? GRAPH_COLORS.success : GRAPH_COLORS.warning,
            fontFamily: GRAPH_FONT,
            fontWeight: 800,
            fontSize: '0.62rem',
            letterSpacing: '0.08em',
            lineHeight: 1.5,
          }}
        >
          {statusLabel}
        </Box>

        <Box
          sx={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.45,
            px: 1.25,
            py: 0.7,
            borderRadius: 2.5,
            border: `1px solid ${GRAPH_COLORS.border}`,
            bgcolor: GRAPH_COLORS.surfaceAlt,
            boxSizing: 'border-box',
          }}
        >
          <Typography
            sx={{
              fontFamily: GRAPH_FONT,
              fontSize: '0.62rem',
              fontWeight: 700,
              color: GRAPH_COLORS.inkSoft,
              lineHeight: 1.2,
            }}
          >
            {FINAL_POSTURE_SCORE_LABEL}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              sx={{
                px: 0.9,
                py: 0.1,
                borderRadius: 999,
                bgcolor: tone.bg,
                color: tone.color,
                fontFamily: GRAPH_FONT,
                fontWeight: 800,
                fontSize: '0.58rem',
                letterSpacing: '0.04em',
                lineHeight: 1.6,
                flexShrink: 0,
              }}
            >
              {tone.label}
            </Box>
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'baseline', gap: 0.25, flexShrink: 0 }}>
              <Typography sx={{ fontFamily: GRAPH_FONT, fontWeight: 800, fontSize: '0.86rem', color: GRAPH_COLORS.ink }}>
                {postureScore != null ? postureScore : '—'}
              </Typography>
              <Typography sx={{ fontFamily: GRAPH_FONT, fontWeight: 600, fontSize: '0.62rem', color: GRAPH_COLORS.inkFaint }}>
                /100
              </Typography>
            </Box>
          </Box>
        </Box>

        {data.onViewDetails ? (
          <Box
            component="button"
            type="button"
            className="nodrag nopan"
            onClick={(event) => {
              event.stopPropagation();
              data.onViewDetails?.(identity);
            }}
            sx={{
              mt: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              border: 'none',
              bgcolor: 'transparent',
              cursor: 'pointer',
              p: 0.25,
              fontFamily: GRAPH_FONT,
              fontWeight: 800,
              fontSize: '0.76rem',
              color: GRAPH_COLORS.identity,
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            View Identity Details
            <ArrowForward sx={{ fontSize: 14 }} />
          </Box>
        ) : null}

        {hasChildren && (
          <Box sx={{ position: 'absolute', bottom: -13, left: '50%', transform: 'translateX(-50%)' }}>
            <ExpandButton
              expanded={expanded}
              count={identity.counts.applications}
              accent={GRAPH_COLORS.identity}
              label="applications"
              onClick={() => data.onToggle?.(identity.id)}
              size={28}
            />
          </Box>
        )}
      </Box>
    </motion.div>
  );
});

/* ------------------------------------------------------------------ */
/* Application circle                                                  */
/* ------------------------------------------------------------------ */

export const ApplicationNode = memo(function ApplicationNode({ data }) {
  const { application, expanded, hasChildren, isMatch, isDimmed } = data;
  const roleCount = application.counts.entitlements;

  return (
    <motion.div {...ENTER} style={{ width: NODE_SIZE.application.w, height: NODE_SIZE.application.h }}>
      <CenterHandles />
      <Tooltip
        arrow
        placement="top"
        title={
          <Box sx={{ py: 0.25 }}>
            <Typography sx={{ fontFamily: GRAPH_FONT, fontWeight: 800, fontSize: '0.78rem' }}>
              {application.name}
            </Typography>
            <Typography sx={{ fontFamily: GRAPH_FONT, fontSize: '0.7rem' }}>
              {roleCount} role{roleCount === 1 ? '' : 's'}
            </Typography>
            {application.counts.privileged > 0 && (
              <Typography sx={{ fontFamily: GRAPH_FONT, fontSize: '0.7rem', color: '#FCA5A5' }}>
                {application.counts.privileged} high risk
              </Typography>
            )}
          </Box>
        }
      >
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            boxSizing: 'border-box',
            ...GLASS_SURFACE,
            border: `2px solid ${GRAPH_COLORS.application}66`,
            boxShadow: matchRing(isMatch) || `${SOFT_SHADOW}, 0 0 20px ${GRAPH_COLORS.application}33`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.4,
            px: 1.25,
            cursor: hasChildren ? 'pointer' : 'default',
            transition: 'box-shadow 160ms ease, transform 160ms ease',
            '&:hover': { transform: 'translateY(-2px)', boxShadow: HOVER_SHADOW },
            ...dimSx(isDimmed),
          }}
          onClick={() => hasChildren && data.onToggle?.(application.id)}
        >
          <ApplicationLogo
            name={application.name}
            icon={application.icon}
            color={application.color}
            size={38}
          />
          <Typography
            sx={{
              fontFamily: GRAPH_FONT,
              fontWeight: 800,
              fontSize: '0.78rem',
              color: GRAPH_COLORS.ink,
              lineHeight: 1.15,
              textAlign: 'center',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {application.name}
          </Typography>
          <Box
            sx={{
              px: 1,
              py: 0.15,
              borderRadius: 999,
              bgcolor: GRAPH_COLORS.applicationSoft,
              color: GRAPH_COLORS.application,
              fontFamily: GRAPH_FONT,
              fontWeight: 800,
              fontSize: '0.64rem',
              lineHeight: 1.6,
              whiteSpace: 'nowrap',
            }}
          >
            {roleCount} role{roleCount === 1 ? '' : 's'}
          </Box>

          {hasChildren && (
            <Box sx={{ position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)' }}>
              <ExpandButton
                expanded={expanded}
                count={application.counts.entitlements}
                accent={GRAPH_COLORS.application}
                label="accounts"
                onClick={() => data.onToggle?.(application.id)}
                size={24}
              />
            </Box>
          )}
        </Box>
      </Tooltip>
    </motion.div>
  );
});

/* ------------------------------------------------------------------ */
/* Account pill                                                        */
/* ------------------------------------------------------------------ */

export const AccountNode = memo(function AccountNode({ data }) {
  const { account, application, expanded, hasChildren, isMatch, isDimmed } = data;
  const statusText = String(account.status || 'Active');
  const inactive = /inactive|disabled|term/i.test(statusText);
  const name = String(account.name || 'Account');
  const atIndex = name.indexOf('@');
  const primary = atIndex > 0 ? name.slice(0, atIndex) : name;
  const secondary = atIndex > 0 ? name.slice(atIndex) : statusText;

  return (
    <motion.div {...ENTER} style={{ position: 'relative', width: NODE_SIZE.account.w, height: NODE_SIZE.account.h, overflow: 'visible' }}>
      <CenterHandles />
      <Tooltip
        arrow
        placement="top"
        title={
          <Box sx={{ py: 0.25 }}>
            <Typography sx={{ fontFamily: GRAPH_FONT, fontWeight: 800, fontSize: '0.78rem' }}>
              {application?.name ? `${application.name} account` : 'Account'}
            </Typography>
            <Typography sx={{ fontFamily: GRAPH_FONT, fontSize: '0.7rem' }}>{name}</Typography>
            <Typography sx={{ fontFamily: GRAPH_FONT, fontSize: '0.7rem' }}>
              {statusText} · {account.counts.entitlements} role{account.counts.entitlements === 1 ? '' : 's'}
            </Typography>
            {account.correlationField && (
              <Typography sx={{ fontFamily: GRAPH_FONT, fontSize: '0.7rem' }}>
                Matched on {account.correlationField}
              </Typography>
            )}
          </Box>
        }
      >
        <Box
          sx={{
            width: '100%',
            height: '100%',
            borderRadius: '18px',
            px: 1.4,
            boxSizing: 'border-box',
            bgcolor: GRAPH_COLORS.accountFill,
            border: `1.5px solid ${GRAPH_COLORS.account}55`,
            boxShadow: matchRing(isMatch) || '0 10px 26px rgba(2, 6, 18, 0.5), 0 0 16px rgba(56, 214, 236, 0.22)',
            display: 'flex',
            alignItems: 'center',
            gap: 0.9,
            transition: 'box-shadow 160ms ease, transform 160ms ease',
            '&:hover': { transform: 'translateY(-2px)', boxShadow: HOVER_SHADOW },
            ...dimSx(isDimmed),
          }}
        >
          <Box
            sx={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              bgcolor: GRAPH_COLORS.surfaceRing,
              border: `1px solid ${GRAPH_COLORS.account}55`,
              color: inactive ? GRAPH_COLORS.warning : GRAPH_COLORS.account,
            }}
          >
            <PersonOutline sx={{ fontSize: 16 }} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              sx={{
                fontFamily: GRAPH_FONT,
                fontWeight: 800,
                fontSize: '0.74rem',
                color: GRAPH_COLORS.ink,
                lineHeight: 1.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {primary}
            </Typography>
            <Typography
              sx={{
                fontFamily: GRAPH_FONT,
                fontWeight: 600,
                fontSize: '0.68rem',
                color: inactive ? GRAPH_COLORS.warning : GRAPH_COLORS.account,
                lineHeight: 1.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {secondary}
            </Typography>
          </Box>
        </Box>
      </Tooltip>
      {hasChildren ? (
        <Box sx={{ position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)' }}>
          <ExpandButton
            expanded={expanded}
            count={account.counts.entitlements}
            accent={GRAPH_COLORS.account}
            label="roles"
            onClick={() => data.onToggle?.(account.id)}
            size={22}
          />
        </Box>
      ) : null}
    </motion.div>
  );
});

/* ------------------------------------------------------------------ */
/* Role / entitlement pill                                             */
/* ------------------------------------------------------------------ */

export const EntitlementNode = memo(function EntitlementNode({ data }) {
  const { entitlement, isMatch, isDimmed } = data;
  const privileged = Boolean(entitlement.privileged);

  return (
    <motion.div {...ENTER} style={{ width: NODE_SIZE.entitlement.w, height: NODE_SIZE.entitlement.h }}>
      <CenterHandles />
      <Tooltip
        arrow
        placement="top"
        title={
          <Box sx={{ py: 0.25 }}>
            <Typography sx={{ fontFamily: GRAPH_FONT, fontWeight: 800, fontSize: '0.78rem' }}>
              {entitlement.name}
            </Typography>
            <Typography sx={{ fontFamily: GRAPH_FONT, fontSize: '0.7rem' }}>
              {privileged ? 'High risk role' : 'Role / entitlement'}
            </Typography>
          </Box>
        }
      >
        <Box
          sx={{
            width: '100%',
            height: '100%',
            borderRadius: 999,
            px: 1.4,
            boxSizing: 'border-box',
            ...GLASS_SURFACE,
            border: `1.5px solid ${privileged ? GRAPH_COLORS.privileged : GRAPH_COLORS.entitlement}77`,
            boxShadow:
              matchRing(isMatch) ||
              `0 8px 22px rgba(2,6,18,0.5), 0 0 14px ${privileged ? GRAPH_COLORS.privileged : GRAPH_COLORS.entitlement}33`,
            display: 'flex',
            alignItems: 'center',
            gap: 0.85,
            transition: 'box-shadow 160ms ease, transform 160ms ease',
            '&:hover': { transform: 'translateY(-1px)', boxShadow: HOVER_SHADOW },
            ...dimSx(isDimmed),
          }}
        >
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              flexShrink: 0,
              bgcolor: GRAPH_COLORS.entitlementDot,
            }}
          />
          <Typography
            sx={{
              fontFamily: GRAPH_FONT,
              fontWeight: 700,
              fontSize: '0.75rem',
              color: GRAPH_COLORS.ink,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {entitlement.name}
          </Typography>
          {privileged ? (
            <Box
              sx={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
                bgcolor: GRAPH_COLORS.privileged,
                color: '#2A0B0B',
                boxShadow: '0 2px 10px rgba(248,113,113,0.55)',
              }}
            >
              <ShieldOutlined sx={{ fontSize: 11 }} />
            </Box>
          ) : null}
        </Box>
      </Tooltip>
    </motion.div>
  );
});

/* ------------------------------------------------------------------ */
/* Decorative spider-web background (concentric rings + radial spokes) */
/* ------------------------------------------------------------------ */

export const OrbitNode = memo(function OrbitNode({ data }) {
  const { innerRadius, outerRadius, angles = [], dimmed } = data;
  const span = (outerRadius + 30) * 2;
  const c = span / 2;

  // Intermediate rings between identity orbit and app ring (spider-web layers)
  const midCount = 3;
  const midRadii = [];
  for (let i = 1; i <= midCount; i += 1) {
    const t = i / (midCount + 1);
    midRadii.push(innerRadius + (outerRadius - innerRadius) * t);
  }

  // Extra outer halo just beyond apps
  const haloRadius = outerRadius + 18;

  // Spokes: use app angles; if none, evenly space a soft web
  const spokeAngles =
    angles.length > 0
      ? angles
      : Array.from({ length: 12 }, (_, i) => (Math.PI * 2 * i) / 12);

  // Secondary spokes halfway between primary ones for denser web
  const secondarySpokes = [];
  if (spokeAngles.length >= 2) {
    for (let i = 0; i < spokeAngles.length; i += 1) {
      const a = spokeAngles[i];
      const b = spokeAngles[(i + 1) % spokeAngles.length];
      let mid = (a + b) / 2;
      // handle wrap-around across ±π
      const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      mid = a + diff / 2;
      secondarySpokes.push(mid);
    }
  }

  return (
    <div
      style={{
        width: span,
        height: span,
        position: 'relative',
        pointerEvents: 'none',
        opacity: dimmed ? 0.22 : 1,
        transition: 'opacity 200ms ease',
      }}
    >
      <svg width={span} height={span} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <linearGradient id="orbit-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={GRAPH_COLORS.identity} stopOpacity="0.75" />
            <stop offset="45%" stopColor={GRAPH_COLORS.application} stopOpacity="0.85" />
            <stop offset="100%" stopColor="#22D3EE" stopOpacity="0.7" />
          </linearGradient>
          <radialGradient id="spider-web-wash" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={GRAPH_COLORS.application} stopOpacity="0.06" />
            <stop offset="55%" stopColor={GRAPH_COLORS.identity} stopOpacity="0.03" />
            <stop offset="100%" stopColor={GRAPH_COLORS.canvas} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Soft wash behind the web */}
        <circle cx={c} cy={c} r={haloRadius} fill="url(#spider-web-wash)" />

        {/* Primary radial spokes (app angles) */}
        {spokeAngles.map((angle, index) => {
          const x2 = c + Math.cos(angle) * outerRadius;
          const y2 = c + Math.sin(angle) * outerRadius;
          const x1 = c + Math.cos(angle) * (innerRadius * 0.35);
          const y1 = c + Math.sin(angle) * (innerRadius * 0.35);
          return (
            <line
              key={`spoke-${index}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={GRAPH_COLORS.application}
              strokeWidth={1.15}
              strokeOpacity={0.28}
              strokeLinecap="round"
            />
          );
        })}

        {/* Secondary spokes for denser spider-web feel */}
        {secondarySpokes.map((angle, index) => {
          const x2 = c + Math.cos(angle) * outerRadius;
          const y2 = c + Math.sin(angle) * outerRadius;
          const x1 = c + Math.cos(angle) * (innerRadius * 0.55);
          const y1 = c + Math.sin(angle) * (innerRadius * 0.55);
          return (
            <line
              key={`spoke-sec-${index}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={GRAPH_COLORS.orbit}
              strokeWidth={0.9}
              strokeOpacity={0.35}
              strokeDasharray="2 7"
              strokeLinecap="round"
            />
          );
        })}

        {/* Outer halo ring */}
        <circle
          cx={c}
          cy={c}
          r={haloRadius}
          fill="none"
          stroke={GRAPH_COLORS.orbit}
          strokeWidth={1}
          strokeOpacity={0.35}
          strokeDasharray="2 10"
          strokeLinecap="round"
        />

        {/* Intermediate concentric rings */}
        {midRadii.map((r, index) => (
          <circle
            key={`mid-${index}`}
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={GRAPH_COLORS.orbit}
            strokeWidth={1.15}
            strokeOpacity={0.45}
            strokeDasharray={index % 2 === 0 ? '4 7' : '2 6'}
            strokeLinecap="round"
          />
        ))}

        {/* Outer dashed circle through the application centres */}
        <circle
          cx={c}
          cy={c}
          r={outerRadius}
          fill="none"
          stroke={GRAPH_COLORS.application}
          strokeWidth={1.7}
          strokeOpacity={0.55}
          strokeDasharray="3 8"
          strokeLinecap="round"
        />

        {/* Inner gradient orbit hugging the identity card */}
        <circle
          cx={c}
          cy={c}
          r={innerRadius}
          fill="none"
          stroke="url(#orbit-ring-gradient)"
          strokeWidth={5}
          strokeDasharray="42 14"
          strokeLinecap="round"
          opacity={0.55}
        />

        {/* Junction dots where primary spokes cross the inner orbit */}
        {spokeAngles.map((angle, index) => (
          <circle
            key={`dot-inner-${index}`}
            cx={c + Math.cos(angle) * innerRadius}
            cy={c + Math.sin(angle) * innerRadius}
            r={3.5}
            fill={GRAPH_COLORS.surfaceRing}
            stroke={GRAPH_COLORS.application}
            strokeWidth={1.75}
          />
        ))}

        {/* Smaller dots on the app ring at spoke tips */}
        {spokeAngles.map((angle, index) => (
          <circle
            key={`dot-outer-${index}`}
            cx={c + Math.cos(angle) * outerRadius}
            cy={c + Math.sin(angle) * outerRadius}
            r={2.5}
            fill={GRAPH_COLORS.application}
            fillOpacity={0.55}
          />
        ))}
      </svg>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Junction dot (kept for the application-rooted graph)                */
/* ------------------------------------------------------------------ */

export const JunctionNode = memo(function JunctionNode({ data }) {
  const dimmed = Boolean(data?.dimmed);
  return (
    <div style={{ width: NODE_SIZE.junction.w, height: NODE_SIZE.junction.h, position: 'relative' }}>
      <CenterHandles />
      <Box
        sx={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          bgcolor: GRAPH_COLORS.account,
          border: `2px solid ${GRAPH_COLORS.surfaceRing}`,
          boxShadow: '0 0 12px rgba(56,214,236,0.55)',
          opacity: dimmed ? 0.25 : 1,
        }}
      />
    </div>
  );
});

export const accessGraphNodeTypes = {
  identityNode: IdentityNode,
  applicationNode: ApplicationNode,
  accountNode: AccountNode,
  entitlementNode: EntitlementNode,
  junctionNode: JunctionNode,
  orbitNode: OrbitNode,
};
