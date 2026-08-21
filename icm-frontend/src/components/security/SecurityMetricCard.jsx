import { Box, Paper, Typography, Skeleton } from "@mui/material";

export default function SecurityMetricCard({
  title,
  value,
  subtitle,
  icon,
  accentColor = "primary.main",
  loading = false,
  onClick,
}) {
  return (
    <Paper
      elevation={0}
      onClick={onClick}
      sx={{
        p: 2,
        height: "100%",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        cursor: onClick ? "pointer" : "default",
        transition: "box-shadow 0.15s",
        "&:hover": onClick ? { boxShadow: 2 } : undefined,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
        {icon && (
          <Box sx={{ color: accentColor, mt: 0.25, opacity: 0.9 }}>{icon}</Box>
        )}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            {title}
          </Typography>
          {loading ? (
            <Skeleton width={48} height={36} />
          ) : (
            <Typography variant="h5" fontWeight={800} sx={{ lineHeight: 1.2, mt: 0.25 }}>
              {value ?? "—"}
            </Typography>
          )}
          {subtitle && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
      </Box>
    </Paper>
  );
}
