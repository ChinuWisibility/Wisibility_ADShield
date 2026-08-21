import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Avatar,
    Box,
    Button,
    Card,
    CardActionArea,
    CardContent,
    Chip,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    Fade,
    IconButton,
    InputAdornment,
    LinearProgress,
    MenuItem,
    Select,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
    alpha,
    useTheme,
} from "@mui/material";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    LabelList,
    Pie,
    PieChart,
    ResponsiveContainer,
    Sector,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from "recharts";
import {
    AccessTime,
    ArrowForwardIos,
    Assignment,
    CheckCircle,
    Close,
    DateRange,
    Download,
    ErrorOutline,
    FilterList,
    OpenInNew,
    PlayCircleOutline,
    Refresh,
    ReportProblem,
    Search,
    Security,
    TrendingUp,
} from "@mui/icons-material";
import accessCertificationService from "../../../services/accessCertificationService";
import { AC_PALETTE, DASHBOARD_CHART, DASHBOARD_PAGE, KPI_CARD_STYLES, STATUS_BADGE_COLORS } from "./AcessStyles";

const TIME_RANGE_OPTIONS = ["7", "30", "90", "all"];

const formatTrendAxisDate = (iso) => {
    if (!iso || typeof iso !== "string") return "";
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return String(iso).slice(5, 10);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const formatTrendTooltipDate = (iso) => {
    if (!iso || typeof iso !== "string") return "";
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" });
};

const getSLAStatus = (dueDate, status) => {
    if (status === "Completed") return { label: "Done", tone: STATUS_BADGE_COLORS.Completed };
    if (!dueDate) return { label: "No Due Date", tone: STATUS_BADGE_COLORS.Draft };

    const diff = Math.ceil((new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24));

    if (diff < 0) return { label: `${Math.abs(diff)}d Overdue`, tone: STATUS_BADGE_COLORS.Expired };
    if (diff <= 3) return { label: `${diff}d Left`, tone: STATUS_BADGE_COLORS.Pending };
    return { label: `${diff}d Left`, tone: STATUS_BADGE_COLORS.Active };
};

const getCampaignStatusTone = (campaign) => {
    if (campaign?.isExpired) return STATUS_BADGE_COLORS.Expired;
    const s = String(campaign?.status || "").toLowerCase();
    if (s.includes("completed")) return STATUS_BADGE_COLORS.Completed;
    if (s.includes("active")) return STATUS_BADGE_COLORS.Active;
    if (s.includes("pending") || s.includes("decision")) return STATUS_BADGE_COLORS.Pending;
    if (s.includes("staged")) return STATUS_BADGE_COLORS.Staged;
    return STATUS_BADGE_COLORS.Draft;
};

const getListTitle = (filterType) => {
    if (filterType === "active") return "Action Required: Active Campaigns";
    if (filterType === "expired") return "Attention: Expired / Defaulted";
    if (filterType === "completed") return "History: Completed Campaigns";
    if (filterType && filterType !== "all") return `Filtered: ${filterType.charAt(0).toUpperCase() + filterType.slice(1)}`;
    return "Recently Created Campaigns";
};

const normalizeCampaign = (campaign, now) => {
    const status = (campaign.status || "").toLowerCase();
    const due = campaign.dueDate ? new Date(campaign.dueDate) : null;
    const isCompleted = status.includes("completed");
    const isExpired = due && due < now && !isCompleted;
    const category = campaign.category || "Other";
    const appName = campaign.appName || campaign.applicationName || "Unknown";
    const progressTot = campaign.progress?.total || campaign.totalScope || 0;
    const progressVal = campaign.progress?.reviewed || campaign.itemsReviewed || 0;
    const created = campaign.createdAt ? new Date(campaign.createdAt).toISOString().slice(0, 10) : null;

    return {
        ...campaign,
        isExpired,
        isCompleted,
        category,
        appName,
        progressVal,
        progressTot,
        rawDate: created,
    };
};

function campaignLevelKey(c) {
    const scope = String(c?.certificationScope || "").toUpperCase();
    if (scope === "APPLICATION") return "APPLICATION";
    if (scope === "PROFILE" || scope === "GOVERNANCE") return "PROFILE";
    if (c?.applicationId || c?.applicationName || c?.appName) return "APPLICATION";
    if (c?.identityProfileId) return "PROFILE";
    return "APPLICATION";
}

const computeTimeFilteredData = (campaigns, timeRange, levelFilters, appFilter) => {
    const now = new Date();
    const cutoff = timeRange === "all" ? null : new Date(now - Number(timeRange) * 86400000);

    const selected = Array.isArray(levelFilters) ? new Set(levelFilters) : null;
    const wantApp = !selected || selected.has("APPLICATION");
    const wantProfile = !selected || selected.has("PROFILE");

    return campaigns
        .filter((campaign) => {
            const createdAt = campaign.createdAt ? new Date(campaign.createdAt) : campaign.startDate ? new Date(campaign.startDate) : null;
            // Some legacy campaigns may not have createdAt/startDate; include them instead of dropping from analytics.
            const timeMatch = !cutoff || !createdAt || createdAt >= cutoff;
            const lvl = campaignLevelKey(campaign);
            const levelMatch =
                !selected ||
                (lvl === "APPLICATION" ? wantApp : wantProfile);
            const appMatch =
                lvl !== "APPLICATION" ||
                !appFilter ||
                appFilter === "all" ||
                campaign.appName === appFilter ||
                campaign.applicationName === appFilter;
            return timeMatch && levelMatch && appMatch;
        })
        .map((campaign) => normalizeCampaign(campaign, now));
};

const computeGlobalMetrics = (timeFilteredData) => {
    const initial = {
        total: 0,
        active: 0,
        completed: 0,
        expired: 0,
        decisionPending: 0,
        expiredCounts: { identity: 0, manager: 0, access: 0 },
        categoryCompletion: {
            identity: { reviewed: 0, total: 0 },
            manager: { reviewed: 0, total: 0 },
            access: { reviewed: 0, total: 0 },
        },
        byCat: {},
        byApp: {},
    };

    return timeFilteredData.reduce((acc, campaign) => {
        acc.total += 1;

        if (campaign.isCompleted) {
            acc.completed += 1;
        } else if (campaign.isExpired) {
            acc.expired += 1;
            const catLower = campaign.category.toLowerCase();
            if (catLower.includes("identity")) acc.expiredCounts.identity += 1;
            else if (catLower.includes("manager")) acc.expiredCounts.manager += 1;
            else acc.expiredCounts.access += 1;
        } else {
            acc.active += 1;
            if ((campaign.status || "").toLowerCase().includes("decision")) acc.decisionPending += 1;
        }

        const categoryKey = (() => {
            const catLower = campaign.category.toLowerCase();
            if (catLower.includes("identity")) return "identity";
            if (catLower.includes("manager")) return "manager";
            return "access";
        })();

        acc.categoryCompletion[categoryKey].reviewed += campaign.progressVal;
        acc.categoryCompletion[categoryKey].total += campaign.progressTot;

        acc.byCat[campaign.category] = (acc.byCat[campaign.category] || 0) + 1;
        acc.byApp[campaign.appName] = (acc.byApp[campaign.appName] || 0) + 1;

        return acc;
    }, initial);
};

const buildTrendData = (list, timeRange) => {
    const trendMap = new Map();
    const now = new Date();
    const days = timeRange === "all" ? 30 : Math.min(Number(timeRange), 60);

    for (let i = days - 1; i >= 0; i -= 1) {
        trendMap.set(new Date(now - i * 86400000).toISOString().slice(0, 10), 0);
    }

    list.forEach((campaign) => {
        if (campaign.rawDate && trendMap.has(campaign.rawDate)) {
            trendMap.set(campaign.rawDate, trendMap.get(campaign.rawDate) + 1);
        }
    });

    return Array.from(trendMap, ([date, count]) => ({ date, count }));
};

const buildViewData = (timeFilteredData, activeFilter, timeRange, globalMetrics) => {
    let list = [...timeFilteredData].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (activeFilter === "active") list = list.filter((campaign) => !campaign.isCompleted && !campaign.isExpired);
    else if (activeFilter === "expired") list = list.filter((campaign) => campaign.isExpired);
    else if (activeFilter === "completed") list = list.filter((campaign) => campaign.isCompleted);
    else if (activeFilter !== "all") list = list.filter((campaign) => campaign.category.toLowerCase() === activeFilter || campaign.appName.toLowerCase() === activeFilter);

    return {
        list,
        trend: buildTrendData(list, timeRange),
        categories: Object.entries(globalMetrics.byCat)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value),
    };
};

const buildHeroSpotlight = (globalMetrics, viewDataList) => {
    const completionRate = globalMetrics.total ? Math.round((globalMetrics.completed / globalMetrics.total) * 100) : 0;
    const topCategory = Object.entries(globalMetrics.byCat)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)[0];
    const actionable = viewDataList.find((campaign) => !campaign.isCompleted && !campaign.isExpired) || viewDataList[0] || null;

    return {
        completionRate,
        topCategory,
        actionable,
        riskCount: globalMetrics.expired,
        pendingDecisions: globalMetrics.decisionPending,
    };
};

const useCertificationData = (campaigns, timeRange, levelFilters, activeFilter, appFilter) => {
    const timeFilteredData = useMemo(
        () => computeTimeFilteredData(campaigns, timeRange, levelFilters, appFilter),
        [campaigns, timeRange, levelFilters, appFilter],
    );
    const globalMetrics = useMemo(() => computeGlobalMetrics(timeFilteredData), [timeFilteredData]);
    const viewData = useMemo(
        () => buildViewData(timeFilteredData, activeFilter, timeRange, globalMetrics),
        [timeFilteredData, activeFilter, timeRange, globalMetrics]
    );
    const heroSpotlight = useMemo(() => buildHeroSpotlight(globalMetrics, viewData.list), [globalMetrics, viewData.list]);

    return { timeFilteredData, globalMetrics, viewData, heroSpotlight };
};

// ──────────────────────────────────────────────────────────────
// 1. UTILITIES & STYLES (Minimalist Professional)
// ──────────────────────────────────────────────────────────────

const PageSection = ({ eyebrow, title, children, sx = {} }) => (
    <Box sx={{ width: "100%", ...sx }}>
        <Box
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                mb: 2.5,
                mt: 0.25,
            }}
        >
            <Box
                aria-hidden
                sx={{
                    width: 4,
                    height: 32,
                    borderRadius: 0.5,
                    background: DASHBOARD_PAGE.heroBarGradient,
                    flexShrink: 0,
                    alignSelf: "center",
                }}
            />
            <Box
                sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "baseline",
                    columnGap: 1.25,
                    rowGap: 0.75,
                }}
            >
                {eyebrow && (
                    <Typography
                        component="span"
                        variant="overline"
                        color="text.secondary"
                        sx={{
                            letterSpacing: 1.15,
                            lineHeight: 1.2,
                            fontWeight: 600,
                            pr: 0.25,
                        }}
                    >
                        {eyebrow}
                    </Typography>
                )}
                {eyebrow && title && (
                    <Typography
                        component="span"
                        aria-hidden
                        sx={{
                            color: "text.disabled",
                            fontSize: "0.85rem",
                            lineHeight: 1,
                            fontWeight: 300,
                            userSelect: "none",
                            mx: 0.25,
                        }}
                    >
                        ·
                    </Typography>
                )}
                {title && (
                    <Typography
                        component="span"
                        variant="h6"
                        fontWeight={700}
                        color="text.primary"
                        sx={{ fontSize: { xs: "1.08rem", sm: "1.22rem" }, lineHeight: 1.3 }}
                    >
                        {title}
                    </Typography>
                )}
            </Box>
        </Box>
        {children}
    </Box>
);

const DashboardCard = ({ children, title, action, subHeader, ...props }) => {
    const theme = useTheme();
    return (
        <Card
            elevation={0}
            sx={{
                height: "100%",
                borderRadius: 2,
                border: `1px solid ${DASHBOARD_PAGE.borderTint}`,
                backgroundColor: theme.palette.background.paper,
                boxShadow: DASHBOARD_PAGE.cardShadowSubtle,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                ...props.sx,
            }}
        >
            <CardContent sx={{ p: 2, flex: 1, display: "flex", flexDirection: "column" }}>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={subHeader ? 1 : 1.5}>
                    <Box>
                        <Typography variant="h6" fontWeight={600} color="text.primary" fontSize="1rem">
                            {title}
                        </Typography>
                        {subHeader}
                    </Box>
                    {action}
                </Box>
                <Box flex={1} minHeight={0} position="relative">
                    {children}
                </Box>
            </CardContent>
        </Card>
    );
};

const ChartTooltip = ({ active, payload, label }) => {
    const theme = useTheme();
    if (active && payload && payload.length) {
        return (
            <Box
                sx={{
                    bgcolor: 'background.paper',
                    border: `1px solid ${theme.palette.divider}`,
                    p: 1.5,
                    borderRadius: 1,
                    boxShadow: theme.shadows[1],
                }}
            >
                <Typography variant="subtitle2" fontWeight={600} mb={0.5}>{label}</Typography>
                {payload.map((p, index) => (
                    <Box key={index} display="flex" alignItems="center" gap={1}>
                        <Box width={8} height={8} borderRadius="50%" bgcolor={p.color || p.payload?.fill || p.stroke} />
                        <Typography variant="body2" color="text.secondary">
                            {p.name}: <b>{p.value}</b>
                        </Typography>
                    </Box>
                ))}
            </Box>
        );
    }
    return null;
};

const TrendChartTooltip = ({ active, payload, label }) => {
    const theme = useTheme();
    if (!active || !payload?.length) return null;
    const pretty = formatTrendTooltipDate(label);
    const stroke = DASHBOARD_CHART.areaGradient.stroke;
    return (
        <Box
            sx={{
                bgcolor: "background.paper",
                border: `1px solid ${theme.palette.divider}`,
                p: 1.5,
                borderRadius: 1,
                boxShadow: theme.shadows[3],
                minWidth: 168,
            }}
        >
            <Typography variant="subtitle2" fontWeight={600} mb={0.75} color="text.primary">
                {pretty}
            </Typography>
            {payload.map((p, index) => (
                <Box key={index} display="flex" alignItems="center" gap={1}>
                    <Box width={9} height={9} borderRadius="50%" bgcolor={p.stroke || stroke} border={`1px solid ${alpha("#fff", 0.9)}`} />
                    <Typography variant="body2" color="text.secondary" component="span">
                        {p.name}:{" "}
                        <Typography component="span" fontWeight={700} color="text.primary">
                            {p.value}
                        </Typography>
                    </Typography>
                </Box>
            ))}
        </Box>
    );
};

// ──────────────────────────────────────────────────────────────
// 2. COMPONENT BLOCKS (Minimalist)
// ──────────────────────────────────────────────────────────────

const KPICard = ({ title, value, icon, color, subText, onClick, isActive }) => {
    const theme = useTheme();
    const k = KPI_CARD_STYLES[color] || KPI_CARD_STYLES.primary;
    return (
        <Card
            elevation={0}
            sx={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                borderRadius: 2,
                overflow: "hidden",
                border: `1px solid ${isActive ? k.bottomBar : k.border}`,
                backgroundColor: theme.palette.background.paper,
                boxShadow: isActive ? DASHBOARD_PAGE.cardShadowSubtle : "0 1px 2px rgba(30, 41, 59, 0.03)",
                transition: "box-shadow 0.2s ease, border-color 0.2s ease",
                "&:hover": {
                    borderColor: k.bottomBar,
                    boxShadow: DASHBOARD_PAGE.cardShadowSubtle,
                },
            }}
        >
            <CardActionArea
                onClick={onClick}
                sx={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    justifyContent: "flex-start",
                    p: 2,
                    pb: 1.75,
                }}
            >
                <Box display="flex" justifyContent="space-between" width="100%" mb={1.5} alignItems="flex-start">
                    <Typography variant="caption" fontWeight={700} sx={{ color: k.title, textTransform: "uppercase", letterSpacing: 0.55, pr: 1 }}>
                        {title}
                    </Typography>
                    <Avatar
                        variant="rounded"
                        sx={{
                            bgcolor: k.iconBg,
                            color: k.iconColor,
                            width: 38,
                            height: 38,
                            borderRadius: 1.25,
                            border: `1px solid ${alpha(k.iconColor, 0.12)}`,
                        }}
                    >
                        {icon}
                    </Avatar>
                </Box>
                <Typography variant="h4" fontWeight={700} sx={{ color: k.value, fontSize: "1.85rem", letterSpacing: "-0.02em" }}>
                    {value}
                </Typography>
                {subText && (
                    <Box mt="auto" pt={1.5} width="100%">
                        <Divider sx={{ mb: 1, borderColor: alpha(k.bottomBar, 0.12) }} />
                        <Typography variant="caption" sx={{ color: theme.palette.text.secondary, opacity: 0.92 }}>
                            {subText}
                        </Typography>
                    </Box>
                )}
            </CardActionArea>
            <Box
                aria-hidden
                sx={{
                    height: isActive ? 4 : 3,
                    width: "100%",
                    flexShrink: 0,
                    bgcolor: k.bottomBar,
                    opacity: isActive ? 1 : 0.92,
                }}
            />
        </Card>
    );
};

const trendVolumeDot = (props) => {
    const { cx, cy, payload } = props;
    if (payload?.count > 0 && cx != null && cy != null) {
        return (
            <circle
                cx={cx}
                cy={cy}
                r={3.5}
                fill={DASHBOARD_CHART.areaGradient.stroke}
                stroke="#fff"
                strokeWidth={1.5}
            />
        );
    }
    return null;
};

const ReviewVolumeTrendChart = ({ data, activeFilter }) => {
    const theme = useTheme();
    const stroke = DASHBOARD_CHART.areaGradient.stroke;
    const yMax = useMemo(() => {
        const m = Math.max(0, ...data.map((d) => Number(d.count) || 0));
        const headroom = m <= 0 ? 1 : Math.max(1, Math.ceil(m * 0.18));
        return m + headroom;
    }, [data]);

    return (
        <DashboardCard
            title="Volume Trend"
            subHeader={
                <Typography variant="caption" color="text.secondary">
                    {activeFilter === "all" ? "All Activity" : activeFilter} · daily new campaigns
                </Typography>
            }
        >
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 28 }}>
                    <defs>
                        <linearGradient id="acVolumeTrend" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgba(61, 90, 115, 0.26)" />
                            <stop offset="40%" stopColor="rgba(61, 90, 115, 0.1)" />
                            <stop offset="100%" stopColor="rgba(61, 90, 115, 0)" />
                        </linearGradient>
                    </defs>
                    <CartesianGrid
                        strokeDasharray="4 4"
                        vertical={false}
                        stroke={alpha(theme.palette.divider, 0.65)}
                    />
                    <XAxis
                        dataKey="date"
                        tickFormatter={formatTrendAxisDate}
                        tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                        axisLine={{ stroke: alpha(theme.palette.divider, 0.9) }}
                        tickLine={false}
                        minTickGap={32}
                        dy={10}
                    />
                    <YAxis
                        width={34}
                        domain={[0, yMax]}
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                        axisLine={false}
                        tickLine={false}
                        dx={-2}
                    />
                    <RechartsTooltip
                        content={<TrendChartTooltip />}
                        cursor={{ stroke: alpha(stroke, 0.35), strokeWidth: 1 }}
                    />
                    <Area
                        name="New campaigns"
                        type="monotone"
                        dataKey="count"
                        stroke={stroke}
                        strokeWidth={2.5}
                        fill="url(#acVolumeTrend)"
                        baseLine={0}
                        animationDuration={500}
                        dot={trendVolumeDot}
                        activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff", fill: stroke }}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </DashboardCard>
    );
};

const ActiveSlice = (props) => {
    const {
        cx,
        cy,
        innerRadius,
        outerRadius,
        startAngle,
        endAngle,
        fill,
    } = props;
    return (
        <g>
            <Sector
                cx={cx}
                cy={cy}
                innerRadius={innerRadius}
                outerRadius={outerRadius + 6}
                startAngle={startAngle}
                endAngle={endAngle}
                fill={fill}
                stroke="none"
            />
        </g>
    );
};

const StatusTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <Box
            sx={{
                bgcolor: "background.paper",
                p: 1.5,
                borderRadius: 1,
                boxShadow: 1,
                border: "1px solid",
                borderColor: "divider",
                minWidth: 160
            }}
        >
            <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
                <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: d.fill }} />
                <Typography fontWeight={600}>{d.name}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">Count: <b>{d.value}</b></Typography>
            <Typography variant="body2" color="text.secondary">Share: <b>{d.percentage}%</b></Typography>
        </Box>
    );
};

const CampaignStatusChart = ({ stats, onFilter, innerRadius = 40, outerRadius = 140, paddingAngle = 2, cornerRadius = 3 }) => {
    const theme = useTheme();
    const [hoverIndex, setHoverIndex] = useState(null);

    const chartData = useMemo(() => {
        const base = [
            { name: "Active", value: stats.active, ...DASHBOARD_CHART.donut.Active },
            { name: "Complete", value: stats.completed, ...DASHBOARD_CHART.donut.Complete },
            { name: "Expire", value: stats.expired, ...DASHBOARD_CHART.donut.Expire },
        ].filter((d) => d.value > 0);

        const total = base.reduce((a, b) => a + b.value, 0);
        return base.map((d, i) => ({
            ...d,
            id: i,
            percentage: ((d.value / total) * 100).toFixed(1),
        }));
    }, [stats]);

    if (!chartData.length) {
        return (
            <DashboardCard title="Status Mix" subHeader={<Typography variant="caption" color="text.secondary">Click a slice to filter campaigns</Typography>}>
                <Box py={5} px={2} textAlign="center" color="text.secondary">No campaign data available</Box>
            </DashboardCard>
        );
    }

    const total = chartData.reduce((acc, cur) => acc + cur.value, 0);
    const focusSlice = hoverIndex !== null ? chartData[hoverIndex] : null;
    const renderLabel = ({ cx, cy, midAngle, outerRadius, percent, payload }) => {
        const RAD = Math.PI / 180;
        const r = outerRadius + 18;
        const x = cx + r * Math.cos(-midAngle * RAD);
        const y = cy + r * Math.sin(-midAngle * RAD);
        const textAnchor = x > cx ? 'start' : 'end';
        return (
            <text
                x={x}
                y={y}
                textAnchor={textAnchor}
                dominantBaseline="central"
                fontSize={11}
                fontWeight={500}
                fill={theme.palette.text.secondary}
            >
                {payload?.name ?? ''} {(percent * 100).toFixed(0)}%
            </text>
        );
    };
    const headerAction = (
        <Stack direction="row" spacing={1} alignItems="center">
            <Chip label={`Total: ${total}`} size="small" sx={{ borderRadius: 1, fontWeight: 500, bgcolor: AC_PALETTE.surface }} />
            <Chip
                label={focusSlice ? `${focusSlice.name}: ${focusSlice.value} (${focusSlice.percentage}%)` : "Hover for details"}
                size="small"
                sx={{
                    borderRadius: 1,
                    bgcolor: AC_PALETTE.cardBg,
                    border: "1px solid",
                    borderColor: focusSlice?.fill ?? AC_PALETTE.border,
                    fontWeight: focusSlice ? 600 : 500,
                }}
            />
        </Stack>
    );

    return (
        <DashboardCard
            title="Campaign Status Mix"
            subHeader={<Typography variant="caption" color="text.secondary">Hover a slice to filter campaigns</Typography>}
            action={headerAction}
        >
            <Box sx={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={innerRadius}
                            outerRadius={outerRadius}
                            paddingAngle={paddingAngle}
                            cornerRadius={cornerRadius}
                            dataKey="value"
                            activeIndex={hoverIndex}
                            activeShape={ActiveSlice}
                            isAnimationActive={false}
                            label={renderLabel}
                            labelLine={{ stroke: theme.palette.divider, strokeWidth: 1 }}
                            onMouseEnter={(_, index) => setHoverIndex(index)}
                            onMouseLeave={() => setHoverIndex(null)}
                        >
                            {chartData.map((d) => (
                                <Cell
                                    key={d.name}
                                    fill={d.fill}
                                    stroke={d.stroke}
                                    strokeWidth={2}
                                    opacity={hoverIndex !== null && hoverIndex !== d.id ? 0.5 : 1}
                                />
                            ))}
                        </Pie>
                        <RechartsTooltip content={<StatusTooltip />} />
                    </PieChart>
                </ResponsiveContainer>
            </Box>
        </DashboardCard>
    );
};

const CertificationCampaignList = ({ campaignList, filterType, setFilterType, onSelect, listRef }) => {
    const theme = useTheme();
    const [searchTerm, setSearchTerm] = useState("");
    const listTitle = getListTitle(filterType);

    const filteredCampaigns = campaignList.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.appName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <Box>
            <Card
                elevation={0}
                ref={listRef}
                sx={{
                    borderRadius: 2,
                    border: `1px solid ${DASHBOARD_PAGE.borderTint}`,
                    backgroundColor: theme.palette.background.paper,
                    boxShadow: DASHBOARD_PAGE.cardShadow,
                    overflow: "hidden",
                }}
            >
                <Box
                    sx={{
                        p: 2,
                        borderBottom: `1px solid ${theme.palette.divider}`,
                        display: "flex",
                        flexDirection: { xs: "column", md: "row" },
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 1.5,
                        background: `linear-gradient(180deg, ${alpha(theme.palette.background.paper, 1)} 0%, ${AC_PALETTE.surface} 100%)`,
                    }}
                >
                    <Box display="flex" alignItems="center" gap={1}>
                        <Avatar sx={{ bgcolor: AC_PALETTE.accentSoft, width: 32, height: 32 }}>
                            <FilterList sx={{ fontSize: 18, color: AC_PALETTE.accent }} />
                        </Avatar>
                        <Box>
                            <Typography variant="subtitle1" fontWeight={600}>{listTitle}</Typography>
                            <Typography variant="caption" color="text.secondary">Showing {filteredCampaigns.length} items</Typography>
                        </Box>
                    </Box>

                    <Stack direction="row" spacing={1} width={{ xs: '100%', md: 'auto' }}>
                        <TextField
                            placeholder="Search campaigns..."
                            size="small"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            InputProps={{
                                startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>,
                                sx: { borderRadius: 1, fontSize: '0.9rem', bgcolor: AC_PALETTE.surface }
                            }}
                            sx={{ width: { xs: '100%', md: 250 } }}
                        />
                        {filterType !== 'all' && (
                            <Button size="small" variant="outlined" color="inherit" onClick={() => setFilterType('all')} startIcon={<Close />}>
                                Clear Filter
                            </Button>
                        )}
                    </Stack>
                </Box>

                <Box sx={{ maxHeight: 560, overflowY: "auto" }}>
                    {filteredCampaigns.length === 0 ? (
                        <Box p={8} textAlign="center" display="flex" flexDirection="column" alignItems="center">
                            <Assignment sx={{ fontSize: 48, color: theme.palette.action.disabled, mb: 1 }} />
                            <Typography color="text.secondary">No campaigns match the "{filterType}" filter.</Typography>
                        </Box>
                    ) : (
                        <Stack divider={<Divider />}>
                            {filteredCampaigns.map(c => {
                                const sla = getSLAStatus(c.dueDate, c.status);
                                return (
                                    <Box key={c._id || c.id} onClick={() => onSelect(c)}
                                        sx={{
                                            p: 1.75, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2.5fr 1.5fr 1fr 1fr auto' }, alignItems: 'center', gap: 1.5,
                                            "&:hover": { bgcolor: AC_PALETTE.surface, cursor: "pointer" },
                                            transition: "background-color 0.16s ease",
                                        }}
                                    >
                                        <Box minWidth={0}>
                                            <Typography variant="subtitle2" fontWeight={600} color="text.primary" noWrap>{c.name}</Typography>
                                            <Stack direction="row" alignItems="center" spacing={1}>
                                                <Chip label={c.category} size="small" sx={{ height: 18, fontSize: '0.65rem', borderRadius: 0.5, bgcolor: AC_PALETTE.accentSoft, color: AC_PALETTE.accent, fontWeight: 500 }} />
                                                <Typography variant="caption" color="text.secondary" noWrap>• {c.appName}</Typography>
                                            </Stack>
                                        </Box>

                                        <Box>
                                            <Box display="flex" alignItems="center" justifyContent="space-between" mb={0.5}>
                                                <Typography variant="caption" color="text.secondary">Progress</Typography>
                                                <Typography variant="caption" fontWeight={600}>{Math.round((c.progressVal / (c.progressTot || 1)) * 100)}%</Typography>
                                            </Box>
                                            <LinearProgress
                                                variant="determinate"
                                                value={c.progressTot > 0 ? (c.progressVal / c.progressTot) * 100 : 0}
                                                sx={{
                                                    height: 5,
                                                    borderRadius: 2,
                                                    backgroundColor: AC_PALETTE.surface,
                                                    "& .MuiLinearProgress-bar": { backgroundColor: AC_PALETTE.accent },
                                                }}
                                            />
                                        </Box>

                                        <Box>
                                            {(() => {
                                                const tone = getCampaignStatusTone(c);
                                                return (
                                                    <Chip label={c.isExpired ? "Expired" : c.status} size="small"
                                                        sx={{
                                                            height: 24, fontSize: '0.75rem', fontWeight: 500, borderRadius: 1,
                                                            bgcolor: tone.bg,
                                                            color: tone.text,
                                                            border: `1px solid ${tone.border}`,
                                                        }} />
                                                );
                                            })()}
                                        </Box>
                                        <Box>
                                            {!c.isCompleted && (
                                                <Chip
                                                    label={sla.label}
                                                    size="small"
                                                    icon={<AccessTime sx={{ fontSize: '12px !important' }} />}
                                                    sx={{
                                                        fontWeight: 500,
                                                        bgcolor: sla.tone.bg,
                                                        color: sla.tone.text,
                                                        border: `1px solid ${sla.tone.border}`,
                                                    }}
                                                />
                                            )}
                                        </Box>
                                        <IconButton size="small"><ArrowForwardIos fontSize="small" sx={{ fontSize: 14, opacity: 0.5 }} /></IconButton>
                                    </Box>
                                );
                            })}
                        </Stack>
                    )}
                </Box>
            </Card>
        </Box>
    );
};

// ──────────────────────────────────────────────────────────────
// 3. MAIN DASHBOARD (Minimalist Professional)
// ──────────────────────────────────────────────────────────────

export default function AccessCertificationDashboard({ onReviewClick, userRole = "admin" }) {
    const theme = useTheme();
    const [certificationCampaigns, setCertificationCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [timeRange, setTimeRange] = useState("all");
    // Two-button filter; when both are selected, it naturally shows ALL certifications.
    const [levelFilters, setLevelFilters] = useState(["APPLICATION", "PROFILE"]);
    const [activeFilter, setActiveFilter] = useState("all");
    const [appFilter, setAppFilter] = useState("all");
    const [selectedCampaign, setSelectedCampaign] = useState(null);
    const listRef = useRef(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            if (!accessCertificationService?.controller) throw new Error("Service not found");
            await accessCertificationService.controller.loadDashboardStats(
                (data) => setCertificationCampaigns(Array.isArray(data) ? data : data?.campaigns || []),
                (err) => setError(err),
                true, // forceRefresh: avoid stale cached counts (e.g., "9 campaigns")
            );
        } catch (e) {
            console.error("[Dashboard] Failed to load campaigns:", e?.message);
            setCertificationCampaigns([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const wantApplication = levelFilters.includes("APPLICATION");
    const effectiveAppFilter = wantApplication ? appFilter : "all";
    const { timeFilteredData, globalMetrics, viewData, heroSpotlight } = useCertificationData(
        certificationCampaigns,
        timeRange,
        levelFilters,
        activeFilter,
        effectiveAppFilter,
    );

    const applicationNames = useMemo(() => {
        const apps = new Set();
        certificationCampaigns.forEach(c => {
            if (campaignLevelKey(c) !== "APPLICATION") return;
            const appName = c.appName || c.applicationName;
            if (appName && appName !== "Unknown") apps.add(appName);
        });
        return ["all", ...Array.from(apps).sort()];
    }, [certificationCampaigns]);

    const privilegedMetrics = useMemo(() => {
        const now = new Date();
        const privileged = certificationCampaigns.filter(c => {
            const cat = (c.category || "").toLowerCase();
            return cat.includes("sensitive") || cat.includes("privileged") || cat.includes("admin");
        });
        return {
            total: privileged.length,
            pending: privileged.filter(c => {
                const status = (c.status || "").toLowerCase();
                const isCompleted = status.includes("completed");
                const due = c.dueDate ? new Date(c.dueDate) : null;
                const isExpired = due && due < now && !isCompleted;
                return !isCompleted && !isExpired;
            }).length,
            expired: privileged.filter(c => {
                const status = (c.status || "").toLowerCase();
                const isCompleted = status.includes("completed");
                const due = c.dueDate ? new Date(c.dueDate) : null;
                return due && due < now && !isCompleted;
            }).length,
            completed: privileged.filter(c => (c.status || "").toLowerCase().includes("completed")).length,
        };
    }, [certificationCampaigns]);

    const handleFilter = useCallback((type) => {
        if (!type) return;
        setActiveFilter(type);
        setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }, []);

    const handleExport = useCallback(() => {
        if (!timeFilteredData || !timeFilteredData.length) return;
        const headers = ["Name", "Application", "Category", "Status", "Due Date", "Created At", "Reviewed", "Total"];
        const rows = timeFilteredData.map((c) => {
            const csvSafe = (value) => {
                const str = value == null ? "" : String(value);
                const escaped = str.replace(/"/g, '""');
                return `"${escaped}"`;
            };
            return [
                csvSafe(c.name || c.title || ""),
                csvSafe(c.appName || c.applicationName || ""),
                csvSafe(c.category || ""),
                csvSafe(c.status || (c.isExpired ? "Expired" : "")),
                csvSafe(c.dueDate ? new Date(c.dueDate).toLocaleDateString() : ""),
                csvSafe(c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ""),
                csvSafe(c.progressVal ?? c.progress?.reviewed ?? 0),
                csvSafe(c.progressTot ?? c.progress?.total ?? 0),
            ].join(",");
        });
        const csvContent = [headers.join(","), ...rows].join("\r\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", "access-certification-report.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    }, [timeFilteredData]);

    if (loading) {
        return (
            <Box
                minHeight="100vh"
                width="100%"
                display="flex"
                alignItems="center"
                justifyContent="center"
                sx={{ background: DASHBOARD_PAGE.background, px: 1 }}
            >
                <Box
                    sx={{
                        p: 2.5,
                        maxWidth: 360,
                        width: "100%",
                        textAlign: "center",
                        borderRadius: 2,
                        bgcolor: "background.paper",
                        border: `1px solid ${DASHBOARD_PAGE.borderTint}`,
                        boxShadow: DASHBOARD_PAGE.cardShadow,
                    }}
                >
                    <CircularProgress size={40} sx={{ color: AC_PALETTE.accent, mb: 2 }} />
                    <Typography color="text.secondary" fontWeight={500}>
                        Loading analytics…
                    </Typography>
                </Box>
            </Box>
        );
    }
    if (error && certificationCampaigns.length === 0) {
        return (
            <Box minHeight="60vh" display="flex" alignItems="center" justifyContent="center" sx={{ background: DASHBOARD_PAGE.background, p: 3 }}>
                <Alert severity="error" sx={{ maxWidth: 520, width: "100%" }}>
                    {error}
                </Alert>
            </Box>
        );
    }

    return (
        <Fade in>
            <Box
                sx={{
                    width: "100%",
                    minHeight: "100vh",
                    background: DASHBOARD_PAGE.background,
                    position: "relative",
                }}
            >
                <Box
                    sx={{
                        maxWidth: DASHBOARD_PAGE.maxWidth,
                        mx: "auto",
                        width: "100%",
                        px: { xs: 1.5, sm: 2, md: 2.5 },
                        py: { xs: 1.5, md: 2 },
                        pb: 5,
                    }}
                >
                {/* Hero — full-width card with accent bar */}
                <Box mb={1.25}>
                    <Box
                        sx={{
                            position: "relative",
                            borderRadius: 2,
                            overflow: "hidden",
                            backgroundColor: theme.palette.background.paper,
                            border: `1px solid ${DASHBOARD_PAGE.borderTint}`,
                            boxShadow: DASHBOARD_PAGE.cardShadow,
                        }}
                    >
                        <Box sx={{ height: 3, width: "100%", background: DASHBOARD_PAGE.heroBarGradient }} />
                    <Box sx={{ p: { xs: 2, md: 3 } }}>
                        <Stack
                            direction={{ xs: 'column', md: 'row' }}
                            spacing={2}
                            alignItems={{ xs: 'flex-start', md: 'center' }}
                            justifyContent="space-between"
                            mb={2.5}
                        >
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={1}>
                                <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.6 }}>
                                    Time Range
                                </Typography>
                                <ToggleButtonGroup
                                    size="small"
                                    exclusive
                                    value={timeRange}
                                    onChange={(_, value) => value && setTimeRange(value)}
                                    sx={{
                                        bgcolor: AC_PALETTE.surface,
                                        borderRadius: 1,
                                        '& .MuiToggleButton-root': {
                                            textTransform: 'none',
                                            px: 1.5,
                                            fontSize: '0.75rem',
                                            borderColor: theme.palette.divider,
                                        },
                                        '& .MuiToggleButton-root.Mui-selected': {
                                            bgcolor: AC_PALETTE.accentSoft,
                                            color: AC_PALETTE.accent,
                                            fontWeight: 600,
                                            borderColor: `${AC_PALETTE.accent} !important`,
                                            '&:hover': { bgcolor: alpha(AC_PALETTE.accentSoft, 0.95) },
                                        },
                                    }}
                                >
                                    {TIME_RANGE_OPTIONS.map((range) => (
                                        <ToggleButton key={range} value={range}>
                                            {range === 'all' ? 'All time' : `Last ${range}d`}
                                        </ToggleButton>
                                    ))}
                                </ToggleButtonGroup>
                            </Stack>

                            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" rowGap={1}>

                                <Tooltip title="Refresh data" arrow>
                                    <span>
                                        <IconButton
                                            size="small"
                                            onClick={() => fetchData()}
                                            sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1, bgcolor: 'background.paper' }}
                                        >
                                            <Refresh fontSize="small" />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                                {userRole === 'admin' && (
                                    <Tooltip title="Export current view" arrow>
                                        <span>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                startIcon={<Download />}
                                                sx={{ textTransform: 'none', borderRadius: 1 }}
                                                onClick={handleExport}
                                                disabled={!timeFilteredData || !timeFilteredData.length}
                                            >
                                                Export Report
                                            </Button>
                                        </span>
                                    </Tooltip>
                                )}
                            </Stack>
                        </Stack>

                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between">
                            <Box flex={1}>
                                <Stack direction="row" spacing={1} alignItems="center" mb={1.25} flexWrap="wrap" rowGap={1}>
                                    <Chip label="Access Certification" size="small" sx={{ fontWeight: 600, borderRadius: 1, border: `1px solid ${DASHBOARD_PAGE.borderTint}`, bgcolor: AC_PALETTE.accentSoft, color: AC_PALETTE.accent }} />
                                    <Chip label={timeRange === 'all' ? 'All Time' : `Last ${timeRange} Days`} size="small" icon={<DateRange sx={{ fontSize: '14px !important' }} />} sx={{ fontWeight: 500, borderRadius: 1 }} />
                                    {heroSpotlight.topCategory && (
                                        <Chip label={`Top category: ${heroSpotlight.topCategory.name}`} size="small" icon={<TrendingUp sx={{ fontSize: '14px !important' }} />} sx={{ fontWeight: 500, borderRadius: 1 }} />
                                    )}
                                </Stack>

                                <Typography variant="h4" fontWeight={700} mb={0.5} lineHeight={1.2} sx={{ fontSize: { xs: '1.5rem', md: '1.8rem' } }}>
                                    Access Certification Dashboard
                                </Typography>
                                <Typography variant="body2" color="text.secondary" maxWidth={620}>
                                    Monitor campaign health, review status, and take action.
                                </Typography>

                                <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1.25} mt={2}>
                                    <Chip label={`Completion ${heroSpotlight.completionRate}%`} variant="outlined" icon={<CheckCircle sx={{ fontSize: '16px !important' }} />} sx={{ borderRadius: 1, fontWeight: 500 }} />
                                    <Chip label={`${heroSpotlight.riskCount} at SLA risk`} variant="outlined" icon={<ReportProblem sx={{ fontSize: '16px !important' }} />} sx={{ borderRadius: 1, fontWeight: 500 }} />
                                    <Chip label={`${heroSpotlight.pendingDecisions} pending decisions`} variant="outlined" icon={<AccessTime sx={{ fontSize: '16px !important' }} />} sx={{ borderRadius: 1, fontWeight: 500 }} />
                                </Stack>
                            </Box>

                            <Box width={{ xs: '100%', md: 280 }}>
                                <Card elevation={0} sx={{ borderRadius: 2, border: `1px solid ${DASHBOARD_PAGE.borderTint}`, backgroundColor: theme.palette.background.paper, boxShadow: DASHBOARD_PAGE.cardShadowSubtle }}>
                                    <CardContent>
                                        <Typography variant="caption" color="text.secondary" fontWeight={500}>Completion Pulse</Typography>
                                        <Box display="flex" justifyContent="center" mt={1.5}>
                                            <Box position="relative" display="inline-flex">
                                                <CircularProgress
                                                    variant="determinate"
                                                    value={heroSpotlight.completionRate}
                                                    size={120}
                                                    thickness={5}
                                                    sx={{ color: AC_PALETTE.accent, filter: "drop-shadow(0 1px 2px rgba(51, 78, 104, 0.12))" }}
                                                />
                                                <Box
                                                    sx={{
                                                        top: 0,
                                                        left: 0,
                                                        bottom: 0,
                                                        right: 0,
                                                        position: 'absolute',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        flexDirection: 'column'
                                                    }}
                                                >
                                                    <Typography variant="h6" fontWeight={700}>{heroSpotlight.completionRate}%</Typography>
                                                    <Typography variant="caption" color="text.secondary">of {globalMetrics.total}</Typography>
                                                </Box>
                                            </Box>
                                        </Box>
                                        <Stack spacing={1.25} mt={2}>
                                            <Box display="flex" justifyContent="space-between" alignItems="center">
                                                <Typography variant="body2" fontWeight={500}>Completed</Typography>
                                                <Typography variant="subtitle2">{globalMetrics.completed}</Typography>
                                            </Box>
                                            <LinearProgress
                                                variant="determinate"
                                                value={globalMetrics.total ? (globalMetrics.completed / globalMetrics.total) * 100 : 0}
                                                sx={{
                                                    height: 6,
                                                    borderRadius: 2,
                                                    backgroundColor: AC_PALETTE.surface,
                                                    "& .MuiLinearProgress-bar": { backgroundColor: DASHBOARD_CHART.donut.Complete.fill },
                                                }}
                                            />
                                            <Box display="flex" justifyContent="space-between" alignItems="center">
                                                <Typography variant="body2" fontWeight={500}>Active</Typography>
                                                <Typography variant="subtitle2">{globalMetrics.active}</Typography>
                                            </Box>
                                            <LinearProgress
                                                variant="determinate"
                                                value={globalMetrics.total ? (globalMetrics.active / globalMetrics.total) * 100 : 0}
                                                sx={{
                                                    height: 6,
                                                    borderRadius: 2,
                                                    backgroundColor: AC_PALETTE.surface,
                                                    "& .MuiLinearProgress-bar": { backgroundColor: DASHBOARD_CHART.donut.Active.fill },
                                                }}
                                            />
                                        </Stack>
                                    </CardContent>
                                </Card>
                            </Box>
                        </Stack>

                        <Box mt={2.5} display="flex" flexWrap="wrap" gap={1.75}>
                            <Card elevation={0} sx={{ flex: "1 1 280px", borderRadius: 2, border: `1px solid ${DASHBOARD_PAGE.borderTint}`, backgroundColor: theme.palette.background.paper, boxShadow: DASHBOARD_PAGE.cardShadowSubtle }}>
                                <CardContent>
                                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
                                        <Box>
                                            <Typography variant="caption" color="text.secondary" fontWeight={500}>Next action</Typography>
                                            <Typography variant="subtitle1" fontWeight={600} mt={0.5}>
                                                {heroSpotlight.actionable ? heroSpotlight.actionable.name : 'Nothing pending'}
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                {heroSpotlight.actionable ? `Due ${heroSpotlight.actionable.dueDate ? new Date(heroSpotlight.actionable.dueDate).toLocaleDateString() : 'N/A'} • ${heroSpotlight.actionable.appName}` : 'All campaigns are caught up.'}
                                            </Typography>
                                        </Box>
                                        <Button
                                            variant="contained"
                                            endIcon={<OpenInNew />}
                                            disabled={!heroSpotlight.actionable}
                                            sx={{ borderRadius: 1, textTransform: 'none', fontWeight: 600, boxShadow: 'none', bgcolor: AC_PALETTE.accent, '&:hover': { bgcolor: alpha(AC_PALETTE.accent, 0.9), boxShadow: 'none' } }}
                                            onClick={() => heroSpotlight.actionable && onReviewClick?.(heroSpotlight.actionable)}
                                        >
                                            Launch
                                        </Button>
                                    </Stack>
                                </CardContent>
                            </Card>

                            <Card elevation={0} sx={{ flex: "1 1 260px", borderRadius: 2, border: `1px solid ${DASHBOARD_PAGE.borderTint}`, backgroundColor: theme.palette.background.paper, boxShadow: DASHBOARD_PAGE.cardShadowSubtle }}>
                                <CardContent>
                                    <Stack direction="row" alignItems="center" spacing={2}>
                                        <Avatar variant="rounded" sx={{ bgcolor: AC_PALETTE.accentSoft, color: AC_PALETTE.accent }}>
                                            <Security />
                                        </Avatar>
                                        <Box flex={1}>
                                            <Typography variant="caption" color="text.secondary" fontWeight={500}>SLA Outlook</Typography>
                                            <Typography variant="subtitle1" fontWeight={600}>Active vs Expired</Typography>
                                            <LinearProgress
                                                variant="determinate"
                                                value={globalMetrics.total ? (globalMetrics.active / globalMetrics.total) * 100 : 0}
                                                sx={{
                                                    mt: 1.25,
                                                    height: 7,
                                                    borderRadius: 2,
                                                    backgroundColor: AC_PALETTE.surface,
                                                    "& .MuiLinearProgress-bar": {
                                                        background: `linear-gradient(90deg, ${DASHBOARD_CHART.donut.Active.fill} 0%, ${AC_PALETTE.accent} 100%)`,
                                                    },
                                                }}
                                                color="inherit"
                                            />
                                            <Stack direction="row" spacing={2} mt={1}>
                                                <Typography variant="caption" color="text.secondary">Active {globalMetrics.active}</Typography>
                                                <Typography variant="caption" color="text.secondary">Expired {globalMetrics.expired}</Typography>
                                            </Stack>
                                        </Box>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Box>
                    </Box>
                    </Box>
                </Box>

                <Stack spacing={3}>
                    <PageSection eyebrow="Snapshot">
                        <Box display="flex" flexWrap="wrap" gap={1.75}>
                            <Box flex={{ xs: "1 1 100%", sm: "1 1 45%", md: "1 1 18%" }}>
                                <KPICard title="Total Campaigns" value={globalMetrics.total} icon={<Assignment />} color="primary" isActive={activeFilter === 'all'} onClick={() => handleFilter('all')} subText="Total records in range" />
                            </Box>
                            <Box flex={{ xs: "1 1 100%", sm: "1 1 45%", md: "1 1 18%" }}>
                                <KPICard title="Active Pending" value={globalMetrics.active} icon={<PlayCircleOutline />} color="warning" isActive={activeFilter === 'active'} onClick={() => handleFilter('active')} subText={`${globalMetrics.decisionPending} waiting decision`} />
                            </Box>
                            <Box flex={{ xs: "1 1 100%", sm: "1 1 45%", md: "1 1 18%" }}>
                                <KPICard title="Expired / Default" value={globalMetrics.expired} icon={<ErrorOutline />} color="error" isActive={activeFilter === 'expired'} onClick={() => handleFilter('expired')} subText="Auto-action required" />
                            </Box>
                            <Box flex={{ xs: "1 1 100%", sm: "1 1 45%", md: "1 1 18%" }}>
                                <KPICard title="Completed" value={globalMetrics.completed} icon={<CheckCircle />} color="success" isActive={activeFilter === 'completed'} onClick={() => handleFilter('completed')} subText={`${((globalMetrics.completed / (globalMetrics.total || 1)) * 100).toFixed(0)}% Completion Rate`} />
                            </Box>
                        </Box>
                    </PageSection>

                    <PageSection eyebrow="Analytics">
                        <Box display="flex" flexWrap="wrap" gap={{ xs: 2, md: 2.5 }} alignItems="stretch">
                            <Box flex={{ xs: "1 1 100%", md: "1 1 30%" }} height={440}>
                                <CampaignStatusChart stats={globalMetrics} onFilter={handleFilter} />
                            </Box>
                            <Box flex={{ xs: "1 1 100%", md: "1 1 30%" }} height={440}>
                                <DashboardCard title="Campaign Distribution">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={viewData.categories} margin={{ top: 20, left: 0, right: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.palette.divider} />
                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} dy={10} />
                                            <RechartsTooltip content={<ChartTooltip />} cursor={{ fill: "transparent" }} />
                                            <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={36} maxBarSize={48}>
                                                {viewData.categories.map((_, i) => (
                                                    <Cell key={`cat-${i}`} fill={DASHBOARD_CHART.bar[i % DASHBOARD_CHART.bar.length]} />
                                                ))}
                                                <LabelList dataKey="value" position="top" style={{ fill: theme.palette.text.primary, fontSize: 11, fontWeight: 600 }} />
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </DashboardCard>
                            </Box>
                        </Box>
                        <Box mt={2.5} height={360}>
                            <ReviewVolumeTrendChart data={viewData.trend} activeFilter={activeFilter} />
                        </Box>
                    </PageSection>

                    <PageSection eyebrow="Operations">
                        <Stack spacing={2.5}>
                            <DashboardCard title="Defaulted / Expired Summary" subHeader={<Typography variant="body2" color="text.secondary">Items that triggered automatic default logic due to expiry</Typography>}>
                                {globalMetrics.expired === 0 ? (
                                    <Box py={3.5} display="flex" flexDirection="column" alignItems="center" justifyContent="center" gap={1} opacity={0.65}>
                                        <Security fontSize="large" />
                                        <Typography variant="body2">No defaulted items found in the current time range.</Typography>
                                    </Box>
                                ) : (
                                    <Box display="flex" flexDirection={{ xs: 'column', md: 'row' }} gap={2} mt={1.5}>
                                        {[
                                            { label: 'Identity', count: globalMetrics.expiredCounts.identity, color: 'grey' },
                                            { label: 'Manager', count: globalMetrics.expiredCounts.manager, color: 'grey' },
                                            { label: 'Access', count: globalMetrics.expiredCounts.access, color: 'grey' }
                                        ].map(i => (
                                            <Box key={i.label} flex={1} display="flex" alignItems="center" justifyContent="space-between" p={2} borderRadius={2} border={`1px solid ${theme.palette.divider}`} bgcolor={theme.palette.background.default}>
                                                <Box display="flex" alignItems="center" gap={2}>
                                                    <Avatar variant="rounded" sx={{ bgcolor: AC_PALETTE.surface, color: AC_PALETTE.textMuted }}>
                                                        <ReportProblem fontSize="small" />
                                                    </Avatar>
                                                    <Box>
                                                        <Typography variant="body2" fontWeight={500}>{i.label} Defaulted</Typography>
                                                        <Typography variant="caption" color="text.secondary">Auto-rejected</Typography>
                                                    </Box>
                                                </Box>
                                                <Typography variant="h4" fontWeight={700} color="text.primary">{i.count}</Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                )}
                            </DashboardCard>

                            <DashboardCard title="Progress by Category" subHeader={<Typography variant="body2" color="text.secondary">Item level completion status across all campaigns</Typography>}>
                                <Stack spacing={2.5} mt={1.5}>
                                    {['Identity', 'Manager', 'Access'].map(key => {
                                        const k = key.toLowerCase();
                                        const d = globalMetrics.categoryCompletion[k];
                                        const pct = d.total > 0 ? (d.reviewed / d.total) * 100 : 0;
                                        return (
                                            <Box key={key} width="100%">
                                                <Box display="flex" justifyContent="space-between" mb={1}>
                                                    <Box display="flex" alignItems="center" gap={1}>
                                                        <Typography variant="body2" fontWeight={500}>{key}</Typography>
                                                        <Chip label={`${Math.round(pct)}%`} size="small" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 500, bgcolor: AC_PALETTE.surface, color: AC_PALETTE.textMuted }} />
                                                    </Box>
                                                    <Typography variant="caption" color="text.secondary">{d.reviewed} / {d.total} items</Typography>
                                                </Box>
                                                <LinearProgress
                                                    variant="determinate"
                                                    value={pct}
                                                    sx={{
                                                        height: 6,
                                                        borderRadius: 2,
                                                        backgroundColor: AC_PALETTE.surface,
                                                        "& .MuiLinearProgress-bar": { backgroundColor: AC_PALETTE.accent },
                                                    }}
                                                />
                                            </Box>
                                        )
                                    })}
                                </Stack>
                            </DashboardCard>
                        </Stack>
                    </PageSection>

                    <PageSection eyebrow="Details">
                        <CertificationCampaignList campaignList={viewData.list} filterType={activeFilter} setFilterType={handleFilter} onSelect={setSelectedCampaign} listRef={listRef} />
                    </PageSection>
                </Stack>
                </Box>

                <Dialog open={Boolean(selectedCampaign)} onClose={() => setSelectedCampaign(null)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 2, p: 1, border: `1px solid ${DASHBOARD_PAGE.borderTint}`, boxShadow: DASHBOARD_PAGE.cardShadow } }}>
                    <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="h6" fontWeight={600}>Campaign Details</Typography>
                        <IconButton onClick={() => setSelectedCampaign(null)}><Close /></IconButton>
                    </DialogTitle>
                    <DialogContent>
                        {selectedCampaign && (
                            <Stack spacing={3}>
                                <Box p={2} bgcolor={theme.palette.background.default} borderRadius={1}>
                                    <Typography variant="subtitle1" fontWeight={600}>{selectedCampaign.name}</Typography>
                                    <Typography variant="body2" color="text.secondary">Application: {selectedCampaign.appName}</Typography>
                                </Box>
                                <Box display="flex" flexWrap="wrap" gap={1.5}>
                                    <Box flex="1 1 45%"><Typography variant="caption" color="text.secondary">Category</Typography><Typography variant="subtitle2">{selectedCampaign.category}</Typography></Box>
                                    <Box flex="1 1 45%"><Typography variant="caption" color="text.secondary">Status</Typography><Typography variant="subtitle2" color={selectedCampaign.isExpired ? "error" : "text.primary"}>{selectedCampaign.status}</Typography></Box>
                                    <Box flex="1 1 45%"><Typography variant="caption" color="text.secondary">Due Date</Typography><Typography variant="subtitle2">{selectedCampaign.dueDate ? new Date(selectedCampaign.dueDate).toLocaleDateString() : 'N/A'}</Typography></Box>
                                    <Box flex="1 1 45%"><Typography variant="caption" color="text.secondary">Progress</Typography><Typography variant="subtitle2">{selectedCampaign.progressVal} / {selectedCampaign.progressTot}</Typography></Box>
                                </Box>
                                <Button variant="contained" fullWidth size="large" onClick={() => { onReviewClick(selectedCampaign); setSelectedCampaign(null); }} startIcon={<OpenInNew />} sx={{ borderRadius: 1, height: 44, fontWeight: 600, boxShadow: 'none', bgcolor: AC_PALETTE.accent, '&:hover': { bgcolor: alpha(AC_PALETTE.accent, 0.9), boxShadow: 'none' } }}>
                                    Launch Review
                                </Button>
                            </Stack>
                        )}
                    </DialogContent>
                </Dialog>
            </Box>
        </Fade>
    );
}