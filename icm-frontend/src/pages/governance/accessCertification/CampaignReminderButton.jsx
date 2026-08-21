import React, { useState } from "react";
import {
    IconButton,
    Tooltip,
    Snackbar,
    Alert,
    CircularProgress
} from "@mui/material";
import { NotificationsActive } from "@mui/icons-material";

// ⚠️ Check this path matches your project structure
// If this file is in 'src/components', go up one level to find 'services'
import accessCertificationService from "../../../services/accessCertificationService";

const CampaignReminderButton = ({ campaignId, campaignName, isCompleted, isExpired = false }) => {
    const [loading, setLoading] = useState(false);
    const [snackbar, setSnackbar] = useState({
        open: false,
        message: "",
        severity: "success",
    });

    const handleRemind = async (e) => {
        e.stopPropagation(); // 🛑 Prevent triggering parent row clicks

        // 1. Check if campaign is already done
        if (isCompleted) {
            setSnackbar({
                open: true,
                message: `Campaign "${campaignName}" is completed. No reminders needed.`,
                severity: "info",
            });
            return;
        }

        if (!campaignId) return;

        // 2. Confirm Action (different message if expired)
        const confirmed = window.confirm(
            isExpired
                ? `Send expiry notice to the campaign owner for "${campaignName}"?`
                : `Send email reminders to all pending reviewers for "${campaignName}"?`
        );
        if (!confirmed) return;

        setLoading(true);

        try {
            // 3. Call Backend
            const res = await accessCertificationService.controller.triggerIndividualReminder(
                campaignId
            );

            // Handle response count (safely handle 0)
            const emailsSent = res?.emailsSent ?? 0;
            const failedDeliveries = res?.failedDeliveries ?? 0;
            const lastError = res?.lastError || res?.deliveryErrors?.[0]?.error || null;
            const reviewersWithPending = Array.isArray(res?.reviewersWithPending)
                ? res.reviewersWithPending
                : [];

            if (isExpired) {
                setSnackbar({
                    open: true,
                    message: emailsSent > 0 ? "Expiry notice sent to owner." : "No owner email sent (check address)",
                    severity: emailsSent > 0 ? "success" : "warning",
                });
            } else {
                if (failedDeliveries > 0 || (reviewersWithPending.length > 0 && emailsSent === 0 && lastError)) {
                    setSnackbar({
                        open: true,
                        message: lastError
                            ? `Email failed: ${lastError}`
                            : "Pending reviewers exist, but email delivery failed. Check email configuration.",
                        severity: "error",
                    });
                } else if (reviewersWithPending.length > 0 && emailsSent === 0) {
                    setSnackbar({
                        open: true,
                        message: "Pending reviewers exist, but no email was delivered. Check email configuration.",
                        severity: "error",
                    });
                } else if (emailsSent > 0) {
                    setSnackbar({
                        open: true,
                        message: `Success! Reminders sent to ${emailsSent} reviewers.`,
                        severity: "success",
                    });
                } else if ((res?.skippedDuplicate ?? 0) > 0) {
                    const nextEligible = res?.nextEligibleAt
                        ? new Date(res.nextEligibleAt).toLocaleString()
                        : null;
                    setSnackbar({
                        open: true,
                        message: nextEligible
                            ? `Already reminded this cycle for ${res.skippedDuplicate} reviewer(s). Next eligible: ${nextEligible}. No duplicate email was created.`
                            : "Already reminded this cycle. No duplicate email was created.",
                        severity: "info",
                    });
                } else {
                    setSnackbar({
                        open: true,
                        message: "No pending reviewers found. No emails sent.",
                        severity: "warning",
                    });
                }
            }
        } catch (err) {
            console.error("Reminder failed:", err);
            setSnackbar({
                open: true,
                message: err.message || "Failed to send reminders.",
                severity: "error",
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Tooltip title={isCompleted ? "Campaign Completed" : "Send Email Reminder"}>
                {/* Span wrapper allows Tooltip to work even if button is disabled */}
                <span>
                    <IconButton
                        onClick={handleRemind}
                        size="small"
                        disabled={loading}
                        // 🎨 Visual Cue: Grey/Faded if completed, Blue if active
                        color={isCompleted ? "default" : "primary"}
                        sx={{
                            opacity: isCompleted ? 0.5 : 1,
                            transition: 'opacity 0.2s'
                        }}
                    >
                        {loading ? (
                            <CircularProgress size={20} />
                        ) : (
                            <NotificationsActive fontSize="small" />
                        )}
                    </IconButton>
                </span>
            </Tooltip>

            {/* Feedback Toast */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={snackbar.severity === "error" ? 10000 : 4000}
                onClose={() => setSnackbar({ ...snackbar, open: false })}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            >
                <Alert
                    onClose={() => setSnackbar({ ...snackbar, open: false })}
                    severity={snackbar.severity}
                    variant="filled"
                    sx={{ width: "100%", maxWidth: 560, boxShadow: 3, alignItems: "flex-start" }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </>
    );
};

export default CampaignReminderButton;