import React, { useState } from "react";
import {
  Box,
  Chip,
  IconButton,
  Popover,
  Typography,
  Divider,
  Button,
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Link as RouterLink } from "react-router-dom";
import {
  buildRemediationDetailLines,
  resolveWorkflowLabelFromExecution,
  resolveWorkflowStyleFromExecution,
} from "../../../utils/remediationWorkflowStatus";
import { remediationEventsPath } from "../../../features/remediation-events/paths";

/**
 * Remediation column — plain-language status chip, short subtitle, and detail popover.
 */
export default function WorkflowStatusCell({
  remediationUi,
  workflowUi,
  execution,
  remediationStatus,
  provisioningStatus,
  entitlementStatus,
}) {
  const [anchorEl, setAnchorEl] = useState(null);

  const ui = remediationUi || workflowUi;
  if (!ui && !execution && !remediationStatus && !provisioningStatus) {
    return (
      <Typography sx={{ fontSize: "0.72rem", color: "#CBD5E1" }}>—</Typography>
    );
  }

  const label = resolveWorkflowLabelFromExecution(execution, workflowUi, remediationUi);
  const style = resolveWorkflowStyleFromExecution(execution, workflowUi, remediationUi);
  const subtitle = remediationUi?.subtitle || workflowUi?.subtitle || "";
  const detailLines = buildRemediationDetailLines({
    remediationStatus,
    provisioningStatus,
    entitlementStatus,
    execution,
  });
  const hasDetail = detailLines.length > 0;
  const open = Boolean(anchorEl);
  const taskId = execution?.taskId || execution?.executionId;

  const openPopover = (e) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.25 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Chip
            label={label}
            size="small"
            sx={{
              fontSize: "0.68rem",
              height: 22,
              fontWeight: 600,
              bgcolor: style.bg,
              color: style.text,
              border: `1px solid ${style.border}`,
              cursor: hasDetail ? "pointer" : "default",
              maxWidth: "100%",
            }}
            onClick={hasDetail ? openPopover : undefined}
          />
          {subtitle && (
            <Typography
              sx={{
                fontSize: "0.62rem",
                color: "#64748B",
                lineHeight: 1.35,
                mt: 0.35,
                pr: 0.5,
              }}
              title={subtitle}
            >
              {subtitle}
            </Typography>
          )}
        </Box>
        {hasDetail && (
          <IconButton
            size="small"
            onClick={openPopover}
            sx={{ width: 22, height: 22, color: "#94A3B8", mt: -0.25, flexShrink: 0 }}
            aria-label="Remediation details"
          >
            <InfoOutlinedIcon sx={{ fontSize: 14 }} />
          </IconButton>
        )}
      </Box>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        onClick={(e) => e.stopPropagation()}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.5,
              borderRadius: 2,
              border: "1px solid #E2E8F0",
              boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
              maxWidth: 380,
              minWidth: 300,
            },
          },
        }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography sx={{ fontSize: "0.8rem", fontWeight: 800, color: "#0F172A", mb: 0.5 }}>
            Remediation status
          </Typography>
          {subtitle && (
            <Typography sx={{ fontSize: "0.72rem", color: "#64748B", mb: 1.25, lineHeight: 1.45 }}>
              {subtitle}
            </Typography>
          )}
          {detailLines.map((line, idx) => (
            <Box key={`${line.label}-${idx}`} sx={{ mb: 1 }}>
              <Typography
                sx={{
                  fontSize: "0.62rem",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "#94A3B8",
                  mb: 0.2,
                }}
              >
                {line.label}
              </Typography>
              <Typography
                sx={{
                  fontSize: line.multiline ? "0.72rem" : "0.78rem",
                  fontWeight: line.emphasize ? 700 : 500,
                  color: line.emphasize && label === "Failed" ? "#B91C1C" : "#334155",
                  lineHeight: 1.45,
                  whiteSpace: line.multiline ? "pre-line" : "normal",
                  wordBreak: "break-word",
                }}
              >
                {line.value}
              </Typography>
            </Box>
          ))}
          {taskId && (
            <>
              <Divider sx={{ my: 1 }} />
              <Button
                component={RouterLink}
                to={remediationEventsPath("access-revoke", { taskId })}
                size="small"
                endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                onClick={() => setAnchorEl(null)}
                sx={{
                  textTransform: "none",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  px: 0,
                  minWidth: 0,
                }}
              >
                Open in Remediation Events
              </Button>
            </>
          )}
        </Box>
      </Popover>
    </Box>
  );
}
