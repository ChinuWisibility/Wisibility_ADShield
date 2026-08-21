import { useCallback, useMemo } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Tooltip,
  IconButton,
  Skeleton,
  Link,
  alpha,
  Chip,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { WIDGET_THEME, getApplicationTileTheme } from './widgetTheme';
import { WIDGET_TITLES } from '../widgetDetailSupport';

/** Prefer frontend title map so renames show even when summary cache still has old API titles. */
function resolveWidgetTitle(widgetId, fallbackTitle) {
  if (widgetId && WIDGET_TITLES[widgetId]) return WIDGET_TITLES[widgetId];
  return fallbackTitle || '—';
}

function resolveRowLabel(row) {
  const fromMap =
    row?.detailWidgetId && WIDGET_TITLES[row.detailWidgetId]
      ? WIDGET_TITLES[row.detailWidgetId]
      : null;
  return fromMap || row?.label || row?.application || row?.title || '—';
}

const TOOLTIPS = {
  orphanedProfiles:
    'Accounts in target applications that do not correlate to a recognized authoritative identity (e.g. HR). Percentage is of that application’s total accounts.',
  missingManagers:
    'Active identities with no resolved manager, an unresolved manager reference (manager correlation), or declared top of hierarchy. Grouped by identity / HR source (sourceApplication).',
  missingManagersByApplication:
    'Same manager hygiene identities, counted once per non-authoritative (target) application with an active account link. Authoritative HR / identity source apps are excluded — use Missing managers (by identity source) for those. Percentage is of that application’s total accounts.',
  managerMismatches:
    'Correlated accounts whose manager values in application data (for example manager_name, manager_login, manager_id, manager_email) do not match the identity profile manager values. Percentage is of that application’s total accounts.',
  statusMismatches:
    'Correlated non-authoritative (target) application accounts whose ACCOUNT STATUS disagrees with identity STATUS — identity ACTIVE with an inactive app account, or identity inactive (INACTIVE / LEAVER / TERMINATED / QUARANTINE) with an active app account. Authoritative HR / identity source apps are excluded. Percentage is of that application’s total accounts.',
  unassignedEntitlements:
    'Entitlements in app_iga_<tenant>_<app>_entitlements with no matching row in app_<app>_correlation after account/entitlement correlation — by application.',
  inactiveUsersWithAccess:
    'Per application: users in the app extract (app_iga_*_*_users) whose status is inactive, disabled, or terminated, but who still have entitlements — e.g. member_of_entitlements, entitlements, roles, or groups on the user row or in rawData. Percentage is of that application’s total accounts.',
  privilegedEntitlements:
    'Entitlements in app_iga_<tenant>_<app>_entitlements flagged as privileged (is_privilege / isPrivileged / classification). Percentage is the share of all entitlements in that application catalog.',
  entitlementsMissingOwner:
    'Rows in app_iga_<tenant>_<app>_entitlements with no owner after trimming: owner, ownerEmail, and entitlement_owner are all empty. Percentage is the share of all entitlements in that application.',
  accessCertificationCampaigns:
    'Access certification campaigns in access_certification_campaigns, grouped by application. Campaigns without an application (profile / identity or governance) appear as Identity or Governance.',
  sodPoliciesViolations:
    'SoD policies in sod_policies scoped to each application (first application on the policy). Count is policies in scope; click a row for live open, total, remediated, and exception counts from sod_violations. Not scoped covers policies with no application assignment.',
  duplicateAccountsByApplication:
    'Duplicate PK groups in application_user_duplicates after user ingest (first row wins in live users; extras stored as duplicate groups). Count is groups per application; percentage is of that application’s total accounts.',
};

function severityColor(percent, soft = false) {
  if (soft) {
    if (percent >= 40) return { bar: '#d45c5c', bg: '#fde8e8', text: '#a83232', badge: '#f8c8c8' };
    if (percent >= 15) return { bar: '#d4883a', bg: '#fdf0e0', text: '#9a5a18', badge: '#f6d8a8' };
    if (percent >= 5) return { bar: '#c9a820', bg: '#fdf6d8', text: '#7a6210', badge: '#f2e4a0' };
    return { bar: '#4a9a68', bg: '#e0f4ea', text: '#2a6a48', badge: '#b8e0c8' };
  }
  if (percent >= 40) return { bar: '#ef4444', bg: '#fef2f2', text: '#dc2626', badge: '#fee2e2' };
  if (percent >= 15) return { bar: '#f97316', bg: '#fff7ed', text: '#ea580c', badge: '#ffedd5' };
  if (percent >= 5) return { bar: '#eab308', bg: '#fefce8', text: '#ca8a04', badge: '#fef9c3' };
  return { bar: '#22c55e', bg: '#f0fdf4', text: '#16a34a', badge: '#dcfce7' };
}

function buildDetailQuery(applicationId, tenantIdForLinks, dashboardView, themeIndex) {
  const q = new URLSearchParams();
  if (applicationId != null && applicationId !== '') {
    q.set('applicationId', String(applicationId));
  } else {
    q.set('applicationId', '');
  }
  if (tenantIdForLinks) q.set('tenantId', String(tenantIdForLinks));
  if (dashboardView === 'application') {
    q.set('dashboardView', 'application');
    if (themeIndex != null && themeIndex !== '') {
      q.set('appThemeIndex', String(themeIndex));
    }
  }
  return q.toString();
}

export default function DataHygieneWidgetCard({
  widget,
  loading,
  tenantIdForLinks = null,
  dashboardView = 'metric',
  themeIndex = 0,
  /** Optional: override detail navigation base (default Data Hygiene). */
  detailBasePath = '/datahygine',
  /** Optional: override application analytics base path. Null disables title link. */
  applicationAnalyticsBasePath = '/datahygine/application',
  /** Optional theme registry (defaults to Data Hygiene WIDGET_THEME). */
  themeRegistry = WIDGET_THEME,
  /** Extra query params appended to detail/analytics links (e.g. baselineScanId). */
  linkQueryParams = null,
}) {
  const navigate = useNavigate();
  const {
    id,
    themeKey,
    title: rawTitle,
    tip: customTip,
    percentLabel,
    rows = [],
    primaryColumnLabel = 'Application',
    countColumnLabel,
  } = widget || {};

  const title = resolveWidgetTitle(id, rawTitle);
  const isApplicationView = dashboardView === 'application';
  const tileApplicationId = useMemo(() => {
    if (widget?.applicationId != null && widget.applicationId !== '') {
      return String(widget.applicationId);
    }
    if (typeof id === 'string' && id.startsWith('application:')) {
      return id.slice('application:'.length);
    }
    const fromRow = rows.find((r) => r.applicationId != null && r.applicationId !== '');
    return fromRow ? String(fromRow.applicationId) : null;
  }, [id, rows, widget?.applicationId]);

  const applicationAnalyticsHref = useMemo(() => {
    if (!applicationAnalyticsBasePath || !isApplicationView || !tileApplicationId) return null;
    const q = new URLSearchParams();
    if (tenantIdForLinks) q.set('tenantId', String(tenantIdForLinks));
    q.set('appThemeIndex', String(themeIndex));
    if (linkQueryParams && typeof linkQueryParams === 'object') {
      Object.entries(linkQueryParams).forEach(([k, v]) => {
        if (v != null && v !== '') q.set(k, String(v));
      });
    }
    const qs = q.toString();
    return `${applicationAnalyticsBasePath}/${encodeURIComponent(tileApplicationId)}${qs ? `?${qs}` : ''}`;
  }, [
    applicationAnalyticsBasePath,
    isApplicationView,
    linkQueryParams,
    tenantIdForLinks,
    themeIndex,
    tileApplicationId,
  ]);

  const theme = isApplicationView
    ? getApplicationTileTheme(themeIndex)
    : themeRegistry[themeKey || id] || themeRegistry._default || WIDGET_THEME._default;
  const accentColor = theme.main;
  const countHeader = countColumnLabel || 'Count';

  const totalCount = rows.reduce((s, r) => s + (r.count || 0), 0);
  const maxCount = rows.length ? Math.max(...rows.map((r) => r.count || 0), 1) : 1;
  const tip = customTip || TOOLTIPS[id] || 'Hygiene metric for this tenant.';

  const openRowDetail = useCallback(
    (row) => {
      const detailWidgetId = row.detailWidgetId || (!isApplicationView ? id : null);
      if (!detailWidgetId) return;
      const targetApplicationId =
        row.detailApplicationId ?? row.applicationId ?? widget?.applicationId ?? null;
      const qs = buildDetailQuery(
        targetApplicationId,
        tenantIdForLinks,
        dashboardView,
        isApplicationView ? themeIndex : undefined,
      );
      const params = new URLSearchParams(qs);
      if (linkQueryParams && typeof linkQueryParams === 'object') {
        Object.entries(linkQueryParams).forEach(([k, v]) => {
          if (v != null && v !== '') params.set(k, String(v));
        });
      }
      navigate(`${detailBasePath}/${encodeURIComponent(detailWidgetId)}?${params.toString()}`);
    },
    [
      dashboardView,
      detailBasePath,
      id,
      isApplicationView,
      linkQueryParams,
      navigate,
      tenantIdForLinks,
      themeIndex,
      widget?.applicationId,
    ],
  );

  return (
    <Paper
      elevation={0}
      sx={{
        border: '1px solid',
        borderColor: alpha(accentColor, isApplicationView ? 0.38 : 0.22),
        borderRadius: 3,
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: isApplicationView ? 'background.paper' : undefined,
        transition: 'box-shadow 0.2s, transform 0.2s',
        '&:hover': {
          boxShadow: isApplicationView
            ? `0 4px 20px ${alpha(accentColor, 0.12)}`
            : `0 8px 32px ${alpha(accentColor, 0.18)}`,
          transform: isApplicationView ? 'none' : 'translateY(-2px)',
        },
      }}
    >
      {/* Top accent */}
      <Box
        sx={{
          height: isApplicationView ? 6 : 4,
          bgcolor: accentColor,
        }}
      />

      {/* Header */}
      <Box
        sx={{
          px: isApplicationView ? 2.25 : 2,
          py: 1.25,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: isApplicationView ? `2px solid ${accentColor}` : '1px solid',
          borderColor: isApplicationView ? undefined : alpha(accentColor, 0.12),
          bgcolor: isApplicationView ? 'background.paper' : undefined,
          background: isApplicationView
            ? undefined
            : `linear-gradient(135deg, ${alpha(accentColor, 0.08)} 0%, ${alpha(accentColor, 0.03)} 100%)`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: isApplicationView ? 32 : 28,
              height: isApplicationView ? 32 : 28,
              borderRadius: 1.5,
              bgcolor: isApplicationView ? 'transparent' : alpha(accentColor, 0.15),
              border: isApplicationView ? `1.5px solid ${accentColor}` : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: isApplicationView ? 18 : 14,
            }}
          >
            {theme.icon || (
              <TrendingUpIcon sx={{ fontSize: isApplicationView ? 20 : 16, color: accentColor }} />
            )}
          </Box>
          {applicationAnalyticsHref ? (
            <Link
              component={RouterLink}
              to={applicationAnalyticsHref}
              state={{ tile: widget }}
              underline="hover"
              onClick={(e) => e.stopPropagation()}
              sx={{
                color: accentColor,
                fontSize: isApplicationView ? 14 : 12,
                fontWeight: 800,
                letterSpacing: 0.5,
                lineHeight: 1.3,
              }}
              title="Open application hygiene overview"
            >
              {title}
            </Link>
          ) : (
            <Typography
              variant="caption"
              fontWeight={800}
              letterSpacing={0.5}
              sx={{
                color: isApplicationView ? accentColor : 'text.primary',
                fontSize: isApplicationView ? 14 : 12,
              }}
            >
              {title}
            </Typography>
          )}
        </Box>
        <Tooltip title={tip} arrow placement="top">
          <IconButton
            size="small"
            aria-label="About this metric"
            sx={{
              color: alpha(accentColor, 0.7),
              '&:hover': { bgcolor: alpha(accentColor, 0.1), color: accentColor },
            }}
          >
            <InfoOutlinedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Table */}
      <TableContainer
        sx={{
          flex: 1,
          maxHeight: isApplicationView ? 300 : 280,
        }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  fontWeight: 700,
                  fontSize: isApplicationView ? 12 : 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: theme.dark,
                  bgcolor: isApplicationView ? 'background.paper' : alpha(accentColor, 0.04),
                  borderBottom: `2px solid ${alpha(accentColor, isApplicationView ? 0.35 : 0.2)}`,
                }}
              >
                {primaryColumnLabel}
              </TableCell>
              <TableCell
                align="center"
                sx={{
                  fontWeight: 700,
                  fontSize: isApplicationView ? 12 : 11,
                  width: isApplicationView ? 112 : 110,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: theme.dark,
                  bgcolor: isApplicationView ? 'background.paper' : alpha(accentColor, 0.04),
                  borderBottom: `2px solid ${alpha(accentColor, isApplicationView ? 0.35 : 0.2)}`,
                }}
              >
                {countHeader}
              </TableCell>
              <TableCell
                align="right"
                sx={{
                  fontWeight: 700,
                  fontSize: isApplicationView ? 12 : 11,
                  width: isApplicationView ? 84 : 88,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: theme.dark,
                  bgcolor: isApplicationView ? 'background.paper' : alpha(accentColor, 0.04),
                  borderBottom: `2px solid ${alpha(accentColor, isApplicationView ? 0.35 : 0.2)}`,
                }}
              >
                {percentLabel}
              </TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {loading ? (
              [...Array(isApplicationView ? 8 : 4)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton variant="text" width="70%" height={20} />
                  </TableCell>
                  <TableCell>
                    <Skeleton variant="text" width="80%" height={20} />
                  </TableCell>
                  <TableCell>
                    <Skeleton variant="text" width="60%" height={20} />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3}>
                  <Box sx={{ py: 3, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
                      ✓ No findings
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, idx) => {
                const rowLabel = resolveRowLabel(row);
                const hasFindings = (row.count || 0) > 0;
                // N/A only for authoritative (identity-source) application tiles with no findings.
                const showAsNa =
                  isApplicationView && Boolean(widget?.authoritativeSource) && !hasFindings;
                const pct = row.percent ?? 0;
                const barW = hasFindings
                  ? Math.max(8, Math.round((100 * row.count) / maxCount))
                  : 0;
                const colors = showAsNa ? null : severityColor(pct, isApplicationView);
                const isOdd = idx % 2 === 0;
                // Metrics view: widget id is on the card. Application tiles: detailWidgetId on each row.
                const rowDetailWidgetId = row.detailWidgetId || (!isApplicationView ? id : null);
                const isClickable = Boolean(rowDetailWidgetId && hasFindings);

                return (
                  <TableRow
                    key={`${row.detailWidgetId || id}:${row.applicationId || rowLabel}:${idx}`}
                    hover
                    tabIndex={isClickable ? 0 : -1}
                    onClick={isClickable ? () => openRowDetail(row) : undefined}
                    onKeyDown={(e) => {
                      if (!isClickable) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openRowDetail(row);
                      }
                    }}
                    role={isClickable ? 'link' : undefined}
                    aria-label={isClickable ? `View details for ${rowLabel}` : undefined}
                    sx={{
                      cursor: isClickable ? 'pointer' : 'default',
                      bgcolor: isOdd
                        ? isApplicationView
                          ? 'grey.50'
                          : alpha(accentColor, 0.025)
                        : 'transparent',
                      transition: 'background-color 0.15s',
                      '&:hover': {
                        bgcolor: isApplicationView
                          ? 'action.hover'
                          : alpha(accentColor, isClickable ? 0.08 : 0.04),
                      },
                    }}
                  >
                    <TableCell
                      sx={{
                        fontSize: isApplicationView ? 14 : 13,
                        fontWeight: 500,
                        color: theme.dark,
                        borderBottom: `1px solid ${alpha(accentColor, 0.08)}`,
                        maxWidth: isApplicationView ? 180 : 140,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {rowLabel}
                    </TableCell>

                    <TableCell
                      align="center"
                      sx={{ borderBottom: `1px solid ${alpha(accentColor, 0.08)}` }}
                    >
                      {showAsNa ? (
                        <Typography
                          variant="body2"
                          sx={{
                            color: 'text.disabled',
                            fontSize: isApplicationView ? 13 : 12,
                            fontWeight: 600,
                          }}
                        >
                          N/A
                        </Typography>
                      ) : (
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 0.75,
                          }}
                        >
                          <Typography
                            variant="body2"
                            fontWeight={700}
                            sx={{
                              color: colors.text,
                              fontSize: isApplicationView ? 14 : 13,
                              minWidth: 28,
                            }}
                          >
                            {row.count}
                          </Typography>
                          <Box
                            sx={{
                              width: isApplicationView ? 48 : 44,
                              height: isApplicationView ? 8 : 7,
                              borderRadius: 99,
                              bgcolor: alpha(colors.bar, 0.18),
                              overflow: 'hidden',
                            }}
                          >
                            <Box
                              sx={{
                                width: `${barW}%`,
                                height: '100%',
                                bgcolor: colors.bar,
                                borderRadius: 99,
                                transition: 'width 0.4s ease',
                              }}
                            />
                          </Box>
                        </Box>
                      )}
                    </TableCell>

                    <TableCell
                      align="right"
                      sx={{ borderBottom: `1px solid ${alpha(accentColor, 0.08)}` }}
                    >
                      {showAsNa ? (
                        <Typography
                          variant="body2"
                          sx={{
                            color: 'text.disabled',
                            fontSize: isApplicationView ? 12 : 11,
                            fontWeight: 600,
                          }}
                        >
                          N/A
                        </Typography>
                      ) : (
                        <Chip
                          label={`${pct}%`}
                          size="small"
                          sx={{
                            bgcolor: colors.badge,
                            color: colors.text,
                            fontWeight: 700,
                            fontSize: isApplicationView ? 12 : 11,
                            height: 20,
                            px: 0.25,
                            border: `1px solid ${alpha(colors.bar, 0.25)}`,
                          }}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Footer */}
      <Box
        sx={{
          px: isApplicationView ? 2.25 : 2,
          py: 1.25,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: isApplicationView ? `2px solid ${accentColor}` : '1px solid',
          borderColor: isApplicationView ? undefined : alpha(accentColor, 0.15),
          bgcolor: isApplicationView ? theme.muted : undefined,
          background: isApplicationView ? undefined : theme.gradient,
        }}
      >
        <Typography
          variant="caption"
          fontWeight={800}
          sx={{
            color: isApplicationView ? theme.dark : '#fff',
            textTransform: 'uppercase',
            letterSpacing: 1,
            fontSize: isApplicationView ? 11 : 10,
            opacity: isApplicationView ? 1 : 0.9,
          }}
        >
          Total
        </Typography>
        <Box
          sx={{
            bgcolor: isApplicationView ? alpha(accentColor, 0.18) : alpha('#fff', 0.2),
            border: isApplicationView ? `1px solid ${alpha(accentColor, 0.35)}` : 'none',
            borderRadius: 99,
            px: 1.25,
            py: 0.25,
            backdropFilter: isApplicationView ? undefined : 'blur(4px)',
          }}
        >
          <Typography
            variant="caption"
            fontWeight={800}
            sx={{ color: isApplicationView ? theme.dark : '#fff', fontSize: isApplicationView ? 14 : 13 }}
          >
            {loading ? '—' : totalCount.toLocaleString()}
          </Typography>
        </Box>
      </Box>
    </Paper>
  );
}