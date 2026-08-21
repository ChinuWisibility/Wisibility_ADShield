import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Refresh as RefreshIcon,
  VerifiedUserOutlined as ShieldIcon,
  BadgeOutlined as LicenseIcon,
  EventAvailableOutlined as ExpiryIcon,
  GroupsOutlined as IdentitiesIcon,
  DnsOutlined as EnvironmentIcon,
} from "@mui/icons-material";
import { useAuth } from "../../contexts/AuthContext";
import { systemAPI } from "../../services/api";
import { palette } from "../../theme/palette";
import { PRODUCT_ABOUT as P } from "../../constants/productAbout";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function orgNameFromUser(user) {
  const raw =
    user?.tenantId?.name ||
    user?.tenantId?.code ||
    user?.tenant?.name ||
    user?.tenant?.code ||
    user?.tenantName ||
    user?.orgName ||
    user?.organizationName ||
    user?.organization?.name ||
    "";
  return String(raw).trim();
}

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${day}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(num)) return String(value);
  return num.toLocaleString("en-US");
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function StatusChip({ label, tone = "success", size = "small" }) {
  const tones = {
    success: [palette.status.success, palette.status.successBg],
    warning: [palette.status.warning, palette.status.warningBg],
    error: [palette.status.error, palette.status.errorBg],
    info: [palette.status.info, palette.status.infoBg],
  };
  const [fg, bg] = tones[tone] || tones.success;
  return (
    <Chip
      size={size}
      label={label}
      sx={{
        height: 24,
        fontWeight: 700,
        fontSize: "0.7rem",
        letterSpacing: 0.3,
        color: fg,
        bgcolor: bg,
        border: `1px solid ${fg}33`,
      }}
    />
  );
}

function StatCard({ icon, label, value, caption, tone, progress }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        borderRadius: 2,
        border: `1px solid ${palette.border.default}`,
        bgcolor: palette.bg.secondary,
        height: "100%",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: 1.5,
            display: "grid",
            placeItems: "center",
            bgcolor: palette.brand.primaryLight,
            color: palette.brand.primary,
            "& svg": { fontSize: 18 },
          }}
        >
          {icon}
        </Box>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: palette.text.secondary,
          }}
        >
          {label}
        </Typography>
      </Stack>

      {tone ? (
        <StatusChip label={value} tone={tone} />
      ) : (
        <Typography
          sx={{
            fontSize: "1.35rem",
            fontWeight: 700,
            lineHeight: 1.2,
            color: palette.text.primary,
          }}
        >
          {value}
        </Typography>
      )}

      {progress !== null && progress !== undefined ? (
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{
            mt: 1.25,
            height: 6,
            borderRadius: 3,
            bgcolor: palette.bg.elevated,
            "& .MuiLinearProgress-bar": {
              borderRadius: 3,
              bgcolor:
                progress >= 90
                  ? palette.status.error
                  : progress >= 75
                    ? palette.status.warning
                    : palette.brand.primary,
            },
          }}
        />
      ) : null}

      {caption ? (
        <Typography
          variant="caption"
          sx={{ display: "block", mt: 1, color: palette.text.secondary }}
        >
          {caption}
        </Typography>
      ) : null}
    </Paper>
  );
}

function InfoRow({ label, value, tone, mono, caption, last }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "minmax(190px, 250px) 1fr" },
        columnGap: 3,
        rowGap: 0.5,
        py: 1.5,
        borderBottom: last ? "none" : `1px solid ${palette.border.default}`,
        alignItems: "center",
      }}
    >
      <Typography
        variant="body2"
        sx={{ fontWeight: 600, color: palette.text.secondary }}
      >
        {label}
      </Typography>
      <Box sx={{ minWidth: 0 }}>
        {tone ? (
          <StatusChip label={value} tone={tone} />
        ) : (
          <Typography
            variant="body2"
            sx={{
              fontWeight: 500,
              color: palette.text.primary,
              fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined,
            }}
          >
            {value}
          </Typography>
        )}
        {caption ? (
          <Typography
            variant="caption"
            sx={{ display: "block", mt: 0.25, color: palette.text.secondary }}
          >
            {caption}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

function GroupLabel({ children }) {
  return (
    <Typography
      variant="caption"
      sx={{
        display: "block",
        mt: 2.5,
        mb: 0.5,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: 0.8,
        color: palette.brand.primary,
      }}
    >
      {children}
    </Typography>
  );
}

export default function AboutADSecurity() {
  const { user } = useAuth();
  const [about, setAbout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [liveError, setLiveError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await systemAPI.about();
      setAbout(res?.data?.data || null);
      setLiveError("");
    } catch (err) {
      setAbout(null);
      setLiveError(
        err?.response?.data?.message ||
          "Live product details are unavailable — showing the published datasheet.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const data = useMemo(() => {
    const product = about?.product || {};
    const license = about?.license || {};
    const platform = about?.platform || {};
    const usage = about?.usage || {};

    const expiry = formatDate(license.expiresAt) || (P.showLicenseExpiry ? P.licenseExpiry : null);
    const seats =
      formatNumber(usage.licensedIdentities ?? license.licensedIdentities) ||
      (P.showLicensedIdentities ? P.licensedIdentities : null);
    const inUse = formatNumber(usage.identities);
    const licenseStatus = about ? license.status || "Inactive" : P.licenseStatus;
    const platformStatus = about ? platform.status || "Degraded" : P.platformStatus;

    return {
      name: product.name || P.productName,
      tagline: product.tagline || P.tagline,
      description: product.description || P.description,
      edition: product.edition || P.edition,
      version: product.version || P.version,
      buildNumber: product.buildNumber || P.buildNumber,
      releaseDate: product.releaseDate || P.releaseDate,
      deploymentModel: product.deploymentModel || P.deploymentModel,
      productType: product.productType || P.productType,
      platformStatus,
      licenseModel: license.model || P.licenseModel,
      licenseStatus,
      expiry,
      daysRemaining: license.daysRemaining ?? null,
      seats,
      inUse,
      utilizationPct: usage.utilizationPct ?? null,
      environment: platform.environment || P.environment,
      organization:
        about?.tenant?.name ||
        orgNameFromUser(user) ||
        license.customer ||
        "<Organization Name>",
      applications: formatNumber(usage.applications),
      generatedAt: about?.generatedAt || null,
    };
  }, [about, user]);

  const rows = [
    { group: "Product" },
    { label: "Product Name", value: data.name },
    { label: "Product Edition", value: data.edition },
    { label: "Product Version", value: data.version, mono: true },
    { label: "Build Number", value: data.buildNumber, mono: true },
    { label: "Release Date", value: data.releaseDate },
    { group: "Deployment" },
    ...(data.deploymentModel
      ? [{ label: "Deployment Model", value: `${data.deploymentModel}*` }]
      : []),
    { label: "Product Type", value: data.productType },
    {
      label: "Platform Status",
      value: data.platformStatus,
      tone: data.platformStatus === "Active" ? "success" : "warning",
    },
    { group: "Licensing" },
    { label: "License Model", value: data.licenseModel },
    {
      label: "License Status",
      value: data.licenseStatus,
      tone: data.licenseStatus === "Active" ? "success" : "warning",
    },
    ...(data.expiry
      ? [
          {
            label: "License Expiry",
            value: `${data.expiry}*`,
            caption:
              data.daysRemaining !== null
                ? `${formatNumber(data.daysRemaining)} days remaining`
                : null,
          },
        ]
      : []),
    ...(data.seats
      ? [
          {
            label: "Licensed Identities",
            value: `${data.seats}*`,
            caption:
              data.inUse !== null
                ? `${data.inUse} identities in use${
                    data.utilizationPct !== null ? ` · ${data.utilizationPct}% of licence` : ""
                  }`
                : null,
          },
        ]
      : []),
    { group: "Environment" },
    { label: "Environment", value: data.environment },
    {
      label: "Tenant / Organization",
      value: data.organization,
      caption: data.applications !== null ? `${data.applications} connected applications` : null,
    },
  ];

  const lastRow = rows.length - 1;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, width: "100%" }}>
      {/* Page header */}
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={2}
        sx={{ mb: 2.5 }}
      >
        <Box>
          <Typography
            variant="overline"
            sx={{ letterSpacing: 1.4, fontWeight: 700, color: palette.text.secondary }}
          >
            Admin · Product
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700, color: palette.text.primary }}>
            {P.pageTitle}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <StatusChip
            label={about ? "Live" : "Datasheet"}
            tone={about ? "success" : "warning"}
          />
          {data.generatedAt ? (
            <Typography variant="caption" sx={{ color: palette.text.secondary }}>
              Updated {formatTime(data.generatedAt)}
            </Typography>
          ) : null}
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={load} disabled={loading}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {liveError ? (
        <Alert severity="info" sx={{ mb: 2.5, borderRadius: 2 }}>
          {liveError}
        </Alert>
      ) : null}

      {/* Product identity band */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, md: 3.5 },
          mb: 2.5,
          borderRadius: 2,
          border: `1px solid ${palette.border.default}`,
          background: `linear-gradient(135deg, ${palette.bg.secondary} 0%, ${palette.brand.primaryLight} 60%, ${palette.bg.elevated} 100%)`,
        }}
      >
        <Stack direction="row" spacing={2.5} alignItems="flex-start">
          <Box
            sx={{
              width: 52,
              height: 52,
              flexShrink: 0,
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              color: "#fff",
              background: `linear-gradient(135deg, ${palette.brand.primary}, ${palette.brand.secondary})`,
              boxShadow: `0 6px 16px ${palette.brand.primary}33`,
              "& svg": { fontSize: 28 },
            }}
          >
            <ShieldIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="h4"
              sx={{
                fontWeight: 800,
                letterSpacing: "-0.025em",
                lineHeight: 1.2,
                color: palette.text.primary,
              }}
            >
              {data.name}
            </Typography>
            <Typography
              sx={{
                fontStyle: "italic",
                fontSize: "1.05rem",
                color: palette.text.secondary,
                mt: 0.5,
                mb: 1.75,
              }}
            >
              {data.tagline}
            </Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
              <Chip
                size="small"
                label={`Version ${data.version}`}
                sx={{
                  fontWeight: 700,
                  bgcolor: palette.bg.secondary,
                  border: `1px solid ${palette.border.default}`,
                }}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`Build ${data.buildNumber}`}
                sx={{ fontWeight: 600, color: palette.text.secondary }}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`${data.edition} Edition`}
                sx={{ fontWeight: 600, color: palette.text.secondary }}
              />
              <StatusChip
                label={data.platformStatus}
                tone={data.platformStatus === "Active" ? "success" : "warning"}
              />
            </Stack>

            <Box
              sx={{
                pl: 2,
                borderLeft: `3px solid ${palette.brand.primary}`,
              }}
            >
              <Typography
                variant="body1"
                sx={{ color: palette.text.secondary, lineHeight: 1.75 }}
              >
                {data.description}
              </Typography>
            </Box>
          </Box>
        </Stack>
      </Paper>

      {/* Live summary */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            lg: "repeat(4, minmax(0, 1fr))",
          },
          gap: 2,
          mb: 3,
        }}
      >
        {loading && !about ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={126} sx={{ borderRadius: 2 }} />
          ))
        ) : (
          <>
            <StatCard
              icon={<LicenseIcon />}
              label="License Status"
              value={data.licenseStatus}
              tone={data.licenseStatus === "Active" ? "success" : "warning"}
              caption={data.licenseModel}
            />
            <StatCard
              icon={<ExpiryIcon />}
              label="License Expiry"
              value={data.expiry || "—"}
              caption={
                data.daysRemaining !== null
                  ? `${formatNumber(data.daysRemaining)} days remaining`
                  : "Per subscription agreement"
              }
            />
            <StatCard
              icon={<IdentitiesIcon />}
              label="Licensed Identities"
              value={data.seats || "—"}
              progress={data.utilizationPct}
              caption={
                data.inUse !== null
                  ? `${data.inUse} in use${
                      data.utilizationPct !== null ? ` · ${data.utilizationPct}%` : ""
                    }`
                  : "Usage unavailable"
              }
            />
            <StatCard
              icon={<EnvironmentIcon />}
              label="Environment"
              value={data.environment}
              caption={data.organization}
            />
          </>
        )}
      </Box>

      {/* Product information */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, md: 3.5 },
          borderRadius: 2,
          border: `1px solid ${palette.border.default}`,
          bgcolor: palette.bg.secondary,
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 700, color: palette.text.primary }}>
          Product Information
        </Typography>
        <Typography variant="body2" sx={{ color: palette.text.secondary, mt: 0.5, mb: 2 }}>
          Deployment, licensing, and environment details for this instance.
        </Typography>

        <Divider />

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "minmax(190px, 250px) 1fr" },
            columnGap: 3,
            py: 1.25,
            borderBottom: `1px solid ${palette.border.default}`,
          }}
        >
          {["Information", "Details"].map((head, idx) => (
            <Typography
              key={head}
              variant="caption"
              sx={{
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: 0.7,
                color: palette.text.secondary,
                display: idx === 1 ? { xs: "none", sm: "block" } : "block",
              }}
            >
              {head}
            </Typography>
          ))}
        </Box>

        {loading && !about
          ? Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} height={44} sx={{ my: 0.5 }} />
            ))
          : rows.map((row, idx) =>
              row.group ? (
                <GroupLabel key={`group-${row.group}`}>{row.group}</GroupLabel>
              ) : (
                <InfoRow
                  key={row.label}
                  label={row.label}
                  value={row.value}
                  tone={row.tone}
                  mono={row.mono}
                  caption={row.caption}
                  last={idx === lastRow}
                />
              ),
            )}

        <Typography
          variant="caption"
          sx={{
            display: "block",
            mt: 2.5,
            pt: 2,
            borderTop: `1px solid ${palette.border.light}`,
            color: palette.text.secondary,
          }}
        >
          *Display only when applicable to the customer&apos;s deployment and license.
        </Typography>
      </Paper>
    </Box>
  );
}
