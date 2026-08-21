import React, { useEffect, useState } from "react";
import {
    Box,
    Card,
    CardContent,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Stack,
    Button,
    CircularProgress,
    Snackbar,
    Switch,
    Grid,
    Avatar,
    Skeleton,
    Alert,
    Tooltip,
    Chip,
    Divider,
    Paper,
    Fade,
    FormControlLabel
} from "@mui/material";

// Icons
import NotificationsActiveRoundedIcon from "@mui/icons-material/NotificationsActiveRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import EventRepeatRoundedIcon from "@mui/icons-material/EventRepeatRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import SecurityRoundedIcon from "@mui/icons-material/SecurityRounded";

import accessCertificationService from "../../../services/accessCertificationService";
import { EmailQueueStatusCard } from "./NotificationDashboard";

/* -----------------------------------
   CONSTANTS & HELPERS
----------------------------------- */
const FREQUENCY_OPTIONS = [
    { value: "WEEKLY", label: "Every Week" },
    { value: "MONTHLY", label: "Every Month" },
    { value: "TWO_DAYS_BEFORE_END", label: "2 Days Before Deadline" },
];

function formatDateTime(d) {
    if (!d) return "Never";
    return new Date(d).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

/* =================================================================
   SUB-COMPONENT: Reminder Frequency & Manual Run
================================================================= */
function ReminderFrequencyCard({ isAdmin, onNotify, scopeLabel }) {
    const [loading, setLoading] = useState(true);
    const [frequency, setFrequency] = useState("WEEKLY");
    const [lastRunAt, setLastRunAt] = useState(null);
    const [tenantName, setTenantName] = useState(null);
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);

    // Load Data
    useEffect(() => {
        let mounted = true;
        accessCertificationService.controller.loadReminderSettings()
            .then((res) => {
                if (!mounted) return;
                const data = res?.data ?? res ?? {};
                setFrequency(data.frequency || "WEEKLY");
                setLastRunAt(data.lastReminderRunAt || null);
                setTenantName(data.tenantName || null);
            })
            .catch((err) => console.error(err))
            .finally(() => mounted && setLoading(false));

        return () => { mounted = false; };
    }, []);

    // Handlers
    const handleFrequencyChange = async (val) => {
        setSaving(true);
        setFrequency(val);
        try {
            await accessCertificationService.controller.saveReminderSettings(val);
            onNotify("Reminder schedule updated", "success");
        } catch (err) {
            onNotify(err.message || "Failed to save", "error");
        } finally {
            setSaving(false);
        }
    };

    const handleRunNow = async () => {
        setRunning(true);
        try {
            await accessCertificationService.controller.runReminderNow();
            const res = await accessCertificationService.controller.loadReminderSettings();
            // Robust extraction for re-fetch
            const data = res?.data ?? res ?? {};
            setLastRunAt(data.lastReminderRunAt || new Date());
            onNotify("Reminders sent successfully", "success");
        } catch (err) {
            onNotify(err.message || "Failed to run", "error");
        } finally {
            setRunning(false);
        }
    };

    if (loading) return <Skeleton variant="rectangular" height={340} sx={{ borderRadius: 4 }} />;

    return (
        <Card
            elevation={0}
            sx={{
                height: "100%",
                borderRadius: 4,
                border: "1px solid",
                borderColor: "divider",
                transition: "all 0.3s ease",
                "&:hover": {
                    borderColor: "primary.main",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.05)"
                }
            }}
        >
            <CardContent sx={{ p: 3 }}>
                {/* Header */}
                <Stack direction="row" spacing={2} alignItems="flex-start" mb={3}>
                    <Avatar
                        variant="rounded"
                        sx={{
                            bgcolor: "primary.50",
                            color: "primary.main",
                            width: 48,
                            height: 48
                        }}
                    >
                        <NotificationsActiveRoundedIcon />
                    </Avatar>
                    <Box>
                        <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                            Email Reminders
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            Automated nudge emails for pending reviewers.
                        </Typography>
                        {tenantName ? (
                            <Chip
                                size="small"
                                label={`Tenant: ${tenantName}`}
                                sx={{ mt: 1, fontWeight: 600 }}
                                color="primary"
                                variant="outlined"
                            />
                        ) : (
                            <Chip
                                size="small"
                                label={scopeLabel || "Global rule set"}
                                sx={{ mt: 1, fontWeight: 600 }}
                                variant="outlined"
                            />
                        )}
                    </Box>
                </Stack>

                <Stack spacing={3}>
                    {/* Frequency Control */}
                    <FormControl fullWidth size="medium" disabled={!isAdmin || saving}>
                        <InputLabel>Frequency Schedule</InputLabel>
                        <Select
                            label="Frequency Schedule"
                            value={frequency}
                            onChange={(e) => handleFrequencyChange(e.target.value)}
                        >
                            {FREQUENCY_OPTIONS.map((opt) => (
                                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* Status Widget */}
                    <Paper
                        elevation={0}
                        sx={{
                            bgcolor: "grey.50",
                            border: "1px solid",
                            borderColor: "divider",
                            p: 2,
                            borderRadius: 3
                        }}
                    >
                        <Stack spacing={2}>
                            {/* Row 1: Last Run */}
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <AccessTimeRoundedIcon fontSize="small" color="action" />
                                    <Typography variant="body2" fontWeight={600} color="text.secondary">
                                        Last Execution
                                    </Typography>
                                </Stack>

                                {lastRunAt ? (
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "success.main" }} />
                                        <Typography variant="body2" fontWeight={600} fontFamily="monospace">
                                            {formatDateTime(lastRunAt)}
                                        </Typography>
                                    </Stack>
                                ) : (
                                    <Chip label="Never Run" size="small" />
                                )}
                            </Stack>

                            <Divider sx={{ borderStyle: "dashed" }} />

                            {/* Row 2: Next Schedule Info */}
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <EventRepeatRoundedIcon fontSize="small" color="action" />
                                    <Typography variant="body2" fontWeight={600} color="text.secondary">
                                        Schedule
                                    </Typography>
                                </Stack>
                                <Typography variant="caption" fontWeight={700} color="primary.main" sx={{ textTransform: 'uppercase' }}>
                                    {frequency.replace(/_/g, " ")}
                                </Typography>
                            </Stack>
                        </Stack>
                    </Paper>

                    {/* Action Area */}
                    <Box>
                        {!isAdmin ? (
                            <Alert severity="info" icon={<LockRoundedIcon />} sx={{ borderRadius: 2 }}>
                                Admin access required to change settings.
                            </Alert>
                        ) : (
                            <Tooltip title="Triggers the email job immediately regardless of schedule">
                                <Button
                                    fullWidth
                                    variant="contained"
                                    size="large"
                                    disabled={running}
                                    onClick={handleRunNow}
                                    startIcon={running ? <CircularProgress size={20} color="inherit" /> : <PlayArrowRoundedIcon />}
                                    sx={{
                                        borderRadius: 2,
                                        height: 48,
                                        textTransform: "none",
                                        fontWeight: 600,
                                        boxShadow: "none",
                                        "&:hover": { boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }
                                    }}
                                >
                                    {running ? "Processing..." : "Run Reminders Now"}
                                </Button>
                            </Tooltip>
                        )}
                    </Box>
                </Stack>
            </CardContent>
        </Card>
    );
}

/* =================================================================
   SUB-COMPONENT: Auto-Run Identity Certification
================================================================= */
function AutoRunCard({ isAdmin, onNotify }) {
    const [loading, setLoading] = useState(true);
    const [enabled, setEnabled] = useState(false);
    const [dueDays, setDueDays] = useState(7);
    const [saving, setSaving] = useState(false);

    // Load Data
    useEffect(() => {
        let mounted = true;
        accessCertificationService.controller.loadAutoIdentitySettings()
            .then((res) => {
                if (!mounted) return;
                const data = res || {};
                setEnabled(Boolean(data.enabled));
                setDueDays(data.defaultDueDays || 7);
            })
            .catch((err) => console.error(err))
            .finally(() => mounted && setLoading(false));
        return () => { mounted = false; };
    }, []);

    const saveSettings = async (newEnabled, newDueDays) => {
        setSaving(true);
        try {
            const updated = await accessCertificationService.controller.saveAutoIdentitySettings({
                enabled: newEnabled,
                defaultDueDays: newDueDays,
            });
            setEnabled(updated.enabled);
            setDueDays(updated.defaultDueDays);
            onNotify(newEnabled ? "Automation enabled" : "Automation disabled", "success");
        } catch (err) {
            onNotify(err.message, "error");
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <Skeleton variant="rectangular" height={340} sx={{ borderRadius: 4 }} />;

    return (
        <Card
            elevation={0}
            sx={{
                height: "100%",
                borderRadius: 4,
                border: "1px solid",
                borderColor: "divider",
                transition: "all 0.3s ease",
                "&:hover": {
                    borderColor: "secondary.main",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.05)"
                }
            }}
        >
            <CardContent sx={{ p: 3 }}>
                {/* Header */}
                <Stack direction="row" spacing={2} alignItems="flex-start" mb={3}>
                    <Avatar
                        variant="rounded"
                        sx={{
                            bgcolor: "secondary.50",
                            color: "secondary.main",
                            width: 48,
                            height: 48
                        }}
                    >
                        <AutorenewRoundedIcon />
                    </Avatar>
                    <Box>
                        <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                            Auto-Certification
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            Trigger review cycles on app onboarding.
                        </Typography>
                    </Box>
                </Stack>

                <Stack spacing={3}>
                    {/* Main Toggle Switch */}
                    <Paper
                        elevation={0}
                        sx={{
                            p: 2,
                            borderRadius: 3,
                            border: "1px solid",
                            borderColor: enabled ? "secondary.main" : "divider",
                            bgcolor: enabled ? "secondary.50" : "background.paper",
                            transition: "all 0.2s"
                        }}
                    >
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Box>
                                <Typography variant="subtitle2" fontWeight={700} color={enabled ? "secondary.dark" : "text.primary"}>
                                    {enabled ? "Automation Active" : "Automation Disabled"}
                                </Typography>
                                <Typography variant="caption" color={enabled ? "secondary.dark" : "text.secondary"}>
                                    {enabled ? "Listening for new apps..." : "No actions will be taken."}
                                </Typography>
                            </Box>
                            <Switch
                                checked={enabled}
                                onChange={(e) => saveSettings(e.target.checked, dueDays)}
                                disabled={!isAdmin || saving}
                                color="secondary"
                            />
                        </Stack>
                    </Paper>

                    {/* Due Period Selector */}
                    <Box sx={{ opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? 'auto' : 'none', transition: 'opacity 0.2s' }}>
                        <FormControl fullWidth size="medium">
                            <InputLabel>Deadline Duration</InputLabel>
                            <Select
                                label="Deadline Duration"
                                value={dueDays}
                                onChange={(e) => saveSettings(enabled, Number(e.target.value))}
                                disabled={!isAdmin || saving || !enabled}
                            >
                                <MenuItem value={7}>7 Days</MenuItem>
                                <MenuItem value={14}>14 Days</MenuItem>
                                <MenuItem value={30}>30 Days</MenuItem>
                            </Select>
                        </FormControl>
                    </Box>

                    {/* Summary Info */}
                    <Fade in={enabled}>
                        <Alert
                            icon={<CheckCircleRoundedIcon fontSize="inherit" />}
                            severity="success"
                            variant="outlined"
                            sx={{
                                border: 'none',
                                bgcolor: 'success.50',
                                color: 'success.900',
                                '& .MuiAlert-icon': { color: 'success.main' }
                            }}
                        >
                            <Typography variant="caption" fontWeight={600}>
                                Manager reviews will be created with a <strong>{dueDays}-day</strong> deadline.
                            </Typography>
                        </Alert>
                    </Fade>
                </Stack>
            </CardContent>
        </Card>
    );
}

/* =================================================================
   SUB-COMPONENT: Auto-Run Privileged Certification
================================================================= */
function AutoPrivilegedCard({ isAdmin, onNotify }) {
    const [loading, setLoading] = useState(true);
    const [enabled, setEnabled] = useState(false);
    const [dueDays, setDueDays] = useState(7);
    const [notifyTarget, setNotifyTarget] = useState("OWNER");
    const [includeAllAccessItems, setIncludeAllAccessItems] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let mounted = true;
        accessCertificationService.controller.loadAutoPrivilegedSettings()
            .then((res) => {
                if (!mounted) return;
                const data = res || {};
                setEnabled(Boolean(data.enabled));
                setDueDays(data.defaultDueDays || 7);
                setNotifyTarget((data.notifyTarget || "OWNER").toUpperCase());
                setIncludeAllAccessItems(Boolean(data.includeAllAccessItems));
            })
            .catch((err) => console.error(err))
            .finally(() => mounted && setLoading(false));
        return () => { mounted = false; };
    }, []);

    const saveSettings = async (updates) => {
        setSaving(true);
        try {
            const updated = await accessCertificationService.controller.saveAutoPrivilegedSettings({
                enabled: updates.enabled ?? enabled,
                defaultDueDays: updates.defaultDueDays ?? dueDays,
                notifyTarget: (updates.notifyTarget ?? notifyTarget).toUpperCase(),
                includeAllAccessItems: updates.includeAllAccessItems ?? includeAllAccessItems,
            });
            setEnabled(Boolean(updated.enabled));
            setDueDays(updated.defaultDueDays || 7);
            setNotifyTarget((updated.notifyTarget || "OWNER").toUpperCase());
            setIncludeAllAccessItems(Boolean(updated.includeAllAccessItems));
            onNotify("Privileged automation updated", "success");
        } catch (err) {
            onNotify(err.message || "Failed to update", "error");
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <Skeleton variant="rectangular" height={360} sx={{ borderRadius: 4 }} />;

    return (
        <Card
            elevation={0}
            sx={{
                height: "100%",
                borderRadius: 4,
                border: "1px solid",
                borderColor: "divider",
                transition: "all 0.3s ease",
                "&:hover": {
                    borderColor: "primary.main",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
                },
            }}
        >
            <CardContent sx={{ p: 3 }}>
                <Stack direction="row" spacing={2} alignItems="flex-start" mb={3}>
                    <Avatar
                        variant="rounded"
                        sx={{
                            bgcolor: "primary.50",
                            color: "primary.main",
                            width: 48,
                            height: 48,
                        }}
                    >
                        <SecurityRoundedIcon />
                    </Avatar>
                    <Box>
                        <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                            Privileged Auto-Certification
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            Create privileged access reviews when new apps onboard or entitlements are uploaded.
                        </Typography>
                    </Box>
                </Stack>

                <Stack spacing={3}>
                    <Paper
                        elevation={0}
                        sx={{
                            p: 2,
                            borderRadius: 3,
                            border: "1px solid",
                            borderColor: enabled ? "primary.main" : "divider",
                            bgcolor: enabled ? "primary.50" : "background.paper",
                            transition: "all 0.2s",
                        }}
                    >
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Box>
                                <Typography variant="subtitle2" fontWeight={700} color={enabled ? "primary.dark" : "text.primary"}>
                                    {enabled ? "Automation Active" : "Automation Disabled"}
                                </Typography>
                                <Typography variant="caption" color={enabled ? "primary.dark" : "text.secondary"}>
                                    {enabled
                                        ? "Monitoring app creation and entitlement uploads."
                                        : "No privileged reviews will be created."}
                                </Typography>
                            </Box>
                            <Switch
                                checked={enabled}
                                onChange={(e) => saveSettings({ enabled: e.target.checked })}
                                disabled={!isAdmin || saving}
                                color="primary"
                            />
                        </Stack>
                    </Paper>

                    <Box sx={{ opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? "auto" : "none", transition: "opacity 0.2s" }}>
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={includeAllAccessItems}
                                    onChange={(e) => saveSettings({ includeAllAccessItems: e.target.checked })}
                                    disabled={!isAdmin || saving || !enabled}
                                    color="primary"
                                />
                            }
                            label={
                                <Box>
                                    <Typography variant="body2" fontWeight={600}>
                                        Include all access items (not just privileged)
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        When OFF: certify privileged entitlements only. When ON: certify all entitlements.
                                    </Typography>
                                </Box>
                            }
                            sx={{ mb: 1.5, alignItems: "flex-start" }}
                        />

                        <FormControl fullWidth size="medium" sx={{ mb: 2 }}>
                            <InputLabel>Deadline Duration</InputLabel>
                            <Select
                                label="Deadline Duration"
                                value={dueDays}
                                onChange={(e) => saveSettings({ defaultDueDays: Number(e.target.value) })}
                                disabled={!isAdmin || saving || !enabled}
                            >
                                <MenuItem value={7}>7 Days</MenuItem>
                                <MenuItem value={14}>14 Days</MenuItem>
                                <MenuItem value={30}>30 Days</MenuItem>
                            </Select>
                        </FormControl>

                        <FormControl fullWidth size="medium">
                            <InputLabel>Reviewer Target</InputLabel>
                            <Select
                                label="Reviewer Target"
                                value={notifyTarget}
                                onChange={(e) => saveSettings({ notifyTarget: e.target.value })}
                                disabled={!isAdmin || saving || !enabled}
                            >
                                <MenuItem value="OWNER">Application Owner</MenuItem>
                                <MenuItem value="MANAGER">User's Manager</MenuItem>
                                <MenuItem value="BOTH">Owner and Manager</MenuItem>
                            </Select>
                        </FormControl>
                    </Box>

                    <Fade in={enabled}>
                        <Alert
                            icon={<CheckCircleRoundedIcon fontSize="inherit" />}
                            severity="info"
                            variant="outlined"
                            sx={{
                                border: "none",
                                bgcolor: "primary.50",
                                color: "primary.900",
                                "& .MuiAlert-icon": { color: "primary.main" },
                            }}
                        >
                            <Typography variant="caption" fontWeight={600}>
                                Reviews route to {notifyTarget === "OWNER" ? "the app owner" : notifyTarget === "MANAGER" ? "each user's manager" : "both owner and managers"} with a <strong>{dueDays}-day</strong> deadline.
                            </Typography>
                        </Alert>
                    </Fade>
                </Stack>
            </CardContent>
        </Card>
    );
}

/* =================================================================
   MAIN CONTAINER
================================================================= */
export default function ReminderSettings({ isAdmin = true, scopeLabel, compact = false }) {
    const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
    const [queueStats, setQueueStats] = useState(null);

    useEffect(() => {
        if (compact) return;
        accessCertificationService.getEmailQueueStats().then((res) => {
            if (res.success) setQueueStats(res.data);
        });
    }, [compact]);

    const handleNotify = (message, severity = "success") => {
        setSnackbar({ open: true, message, severity });
    };

    const handleCloseSnackbar = () => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    };

    return (
        <Box sx={{ p: compact ? 0 : 2 }}>
            {!compact && <EmailQueueStatusCard stats={queueStats} />}

            <Grid container spacing={4} alignItems="stretch">
                <Grid item xs={12} md={6}>
                    <ReminderFrequencyCard isAdmin={isAdmin} onNotify={handleNotify} scopeLabel={scopeLabel} />
                </Grid>
                {/* <Grid item xs={12} md={6}>
                    <AutoRunCard isAdmin={isAdmin} onNotify={handleNotify} />
                </Grid>
                <Grid item xs={12} md={6}>
                    <AutoPrivilegedCard isAdmin={isAdmin} onNotify={handleNotify} />
                </Grid> */}
            </Grid>

            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={handleCloseSnackbar}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            >
                <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} variant="filled" sx={{ width: "100%", boxShadow: 3 }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}