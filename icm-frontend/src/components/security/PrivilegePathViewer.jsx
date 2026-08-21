import { Box, Typography } from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

/**
 * List/table view for privilege paths (graph canvas deferred).
 */
export default function PrivilegePathViewer({ relationships = [] }) {
  if (!relationships.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        No path data available.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {relationships.map((rel, idx) => (
        <Box
          key={idx}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            flexWrap: "wrap",
            p: 1,
            borderRadius: 1,
            bgcolor: "action.hover",
            fontSize: 12,
            fontFamily: "monospace",
          }}
        >
          <Typography component="span" variant="caption" sx={{ fontFamily: "inherit" }}>
            {shortId(rel.from ?? rel.source)}
          </Typography>
          <ArrowForwardIcon sx={{ fontSize: 14, opacity: 0.6 }} />
          <Typography component="span" variant="caption" sx={{ fontFamily: "inherit" }}>
            {shortId(rel.to ?? rel.target)}
          </Typography>
          {(rel.type || rel.rights) && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
              ({rel.type || ""
              }{rel.rights ? `${rel.type ? " · " : ""}${Array.isArray(rel.rights) ? rel.rights.join(", ") : rel.rights}` : ""})
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}

function shortId(id) {
  const s = String(id || "");
  if (!s) return "—";
  if (s.length <= 40) return s;
  const parts = s.split(":");
  return parts[parts.length - 1] || `${s.slice(0, 40)}…`;
}
