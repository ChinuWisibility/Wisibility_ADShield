import { lazy, Suspense, memo, useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  TextField,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  CircularProgress,
  InputAdornment,
  Switch,
  useMediaQuery,
  useTheme,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItemButton,
  ListItemText,
  Paper,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  SCAN_CENTER_CATEGORIES,
  groupFeaturesByCategory,
  buildFeatureLastRunMap,
  formatFeatureLastRun,
  resolveScanCenterCategoryId,
} from "../../utils/scanCenterCategories";
import { SCAN_CENTER_INK } from "../../pages/security/securityTheme";

const SecurityFeatureDetailPanel = lazy(() => import("./SecurityFeatureDetailPanel"));

function FeatureListTable({
  features,
  lastRunMap,
  selectedFeatureKey,
  onSelectFeature,
  onToggleEnabled,
  readOnly = false,
}) {
  if (!features.length) {
    return (
      <Box sx={{ p: 3, textAlign: "center" }}>
        <Typography variant="body2" sx={{ color: SCAN_CENTER_INK.muted }}>
          No features match your search.
        </Typography>
      </Box>
    );
  }

  return (
    <Table size="small" stickyHeader>
      <TableHead>
        <TableRow>
          <TableCell sx={{ fontWeight: 700, py: 1 }}>Feature</TableCell>
          <TableCell sx={{ fontWeight: 700, py: 1, width: 72 }} align="center">
            Enabled
          </TableCell>
          <TableCell sx={{ fontWeight: 700, py: 1, width: 140 }}>Last run</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {features.map((feature) => {
          const selected = feature.featureKey === selectedFeatureKey;
          return (
            <TableRow
              key={feature.featureKey}
              hover
              selected={selected}
              onClick={() => onSelectFeature(feature.featureKey)}
              sx={{
                cursor: "pointer",
                "& td": { py: 0.75 },
                opacity: feature.implemented ? 1 : 0.55,
              }}
            >
              <TableCell>
                <Typography variant="body2" fontWeight={selected ? 700 : 500} noWrap>
                  {feature.name}
                </Typography>
                {!feature.implemented && (
                  <Typography variant="caption" sx={{ color: SCAN_CENTER_INK.soft }}>
                    Coming soon
                  </Typography>
                )}
              </TableCell>
              <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                <Switch
                  size="small"
                  checked={Boolean(feature.enabled)}
                  disabled={readOnly || !feature.implemented}
                  onChange={(e) => onToggleEnabled(feature, e.target.checked)}
                />
              </TableCell>
              <TableCell>
                <Typography variant="caption" noWrap sx={{ color: SCAN_CENTER_INK.soft }}>
                  {formatFeatureLastRun(lastRunMap.get(feature.featureKey))}
                </Typography>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function CategorySidebar({
  categories,
  grouped,
  activeCategoryId,
  onSelectCategory,
}) {
  return (
    <List dense disablePadding sx={{ py: 0.5 }}>
      {categories.map((cat) => {
        const count = grouped.get(cat.id)?.length || 0;
        const active = activeCategoryId === cat.id;
        return (
          <ListItemButton
            key={cat.id}
            selected={active}
            onClick={() => onSelectCategory(cat.id)}
            sx={{
              py: 0.75,
              px: 1.5,
              borderRadius: 1,
              mx: 0.5,
              mb: 0.25,
            }}
          >
            <ListItemText
              primary={cat.label}
              primaryTypographyProps={{
                variant: "body2",
                fontWeight: active ? 700 : 500,
                noWrap: true,
              }}
            />
            <Typography variant="caption" sx={{ ml: 1, flexShrink: 0, color: SCAN_CENTER_INK.soft }}>
              {count}
            </Typography>
          </ListItemButton>
        );
      })}
    </List>
  );
}

function ScanCenterFeatureWorkspace({
  applicationId,
  application,
  features,
  scans,
  selectedFeatureKey,
  onSelectFeature,
  onSaved,
  runScan,
  scanRunning,
  activeScanFeatureKey,
  featureActionsRef,
  onToggleEnabled,
  readOnly = false,
}) {
  const theme = useTheme();
  const compactNav = useMediaQuery(theme.breakpoints.down(1400));
  const [activeCategoryId, setActiveCategoryId] = useState("user_security");
  const [expandedAccordion, setExpandedAccordion] = useState("user_security");
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => groupFeaturesByCategory(features), [features]);
  const lastRunMap = useMemo(() => buildFeatureLastRunMap(scans), [scans]);

  const visibleFeatures = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = features;
    if (q) {
      list = features.filter(
        (f) =>
          f.name?.toLowerCase().includes(q) ||
          f.featureKey?.toLowerCase().includes(q) ||
          f.description?.toLowerCase().includes(q),
      );
    } else {
      list = grouped.get(activeCategoryId) || [];
    }
    return list;
  }, [features, grouped, activeCategoryId, search]);

  const selectedFeature = useMemo(
    () => features.find((f) => f.featureKey === selectedFeatureKey) || null,
    [features, selectedFeatureKey],
  );

  useEffect(() => {
    if (selectedFeatureKey) return;
    const first = visibleFeatures[0];
    if (first) onSelectFeature(first.featureKey);
  }, [activeCategoryId, search, visibleFeatures, selectedFeatureKey, onSelectFeature]);

  useEffect(() => {
    if (!selectedFeature) return;
    setActiveCategoryId(resolveScanCenterCategoryId(selectedFeature));
  }, [selectedFeature]);

  const handleToggleEnabled = (feature, enabled) => {
    onToggleEnabled?.(feature, enabled);
  };

  const handleCategorySelect = (catId) => {
    setActiveCategoryId(catId);
    setSearch("");
    if (compactNav) setExpandedAccordion(catId);
    const first = grouped.get(catId)?.[0];
    if (first) onSelectFeature(first.featureKey);
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        display: "flex",
        flexDirection: compactNav ? "column" : "row",
        minHeight: 420,
        maxHeight: compactNav ? "none" : "calc(100vh - 320px)",
        overflow: "hidden",
        mb: 2,
      }}
    >
      {/* Left — categories */}
      <Box
        sx={{
          width: compactNav ? "100%" : 250,
          flexShrink: 0,
          borderRight: compactNav ? 0 : 1,
          borderColor: "divider",
          bgcolor: "action.hover",
          overflow: compactNav ? "visible" : "auto",
        }}
      >
        <Box sx={{ px: 1.5, py: 1.25, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="caption" fontWeight={700} sx={{ color: SCAN_CENTER_INK.soft }}>
            CATEGORIES
          </Typography>
        </Box>
        {compactNav ? (
          <Box>
            {SCAN_CENTER_CATEGORIES.map((cat) => {
              const count = grouped.get(cat.id)?.length || 0;
              const expanded = expandedAccordion === cat.id;
              return (
                <Accordion
                  key={cat.id}
                  expanded={expanded}
                  onChange={(_, isExpanded) => {
                    setExpandedAccordion(isExpanded ? cat.id : false);
                    if (isExpanded) handleCategorySelect(cat.id);
                  }}
                  disableGutters
                  elevation={0}
                  sx={{ "&:before": { display: "none" }, bgcolor: "transparent" }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, px: 1.5 }}>
                    <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
                      {cat.label}
                    </Typography>
                    <Typography variant="caption" sx={{ mr: 1, color: SCAN_CENTER_INK.soft }}>
                      {count}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: 0, bgcolor: "background.paper" }}>
                    <List dense disablePadding>
                      {(grouped.get(cat.id) || []).map((f) => (
                        <ListItemButton
                          key={f.featureKey}
                          selected={f.featureKey === selectedFeatureKey}
                          onClick={() => onSelectFeature(f.featureKey)}
                          sx={{ py: 0.5, pl: 3 }}
                        >
                          <ListItemText
                            primary={f.name}
                            primaryTypographyProps={{ variant: "body2", noWrap: true }}
                          />
                        </ListItemButton>
                      ))}
                    </List>
                  </AccordionDetails>
                </Accordion>
              );
            })}
          </Box>
        ) : (
          <CategorySidebar
            categories={SCAN_CENTER_CATEGORIES}
            grouped={grouped}
            activeCategoryId={activeCategoryId}
            onSelectCategory={handleCategorySelect}
          />
        )}
      </Box>

      {/* Center — feature list */}
      <Box
        sx={{
          flex: compactNav ? "none" : "1 1 280px",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: compactNav ? 0 : 1,
          borderColor: "divider",
          maxHeight: compactNav ? 280 : "none",
        }}
      >
        <Box sx={{ p: 1.25, borderBottom: 1, borderColor: "divider" }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Search features…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: SCAN_CENTER_INK.soft }} />
                </InputAdornment>
              ),
            }}
          />
        </Box>
        <Box sx={{ flex: 1, overflow: "auto" }}>
          <FeatureListTable
            features={visibleFeatures}
            lastRunMap={lastRunMap}
            selectedFeatureKey={selectedFeatureKey}
            onSelectFeature={onSelectFeature}
            onToggleEnabled={handleToggleEnabled}
            readOnly={readOnly}
          />
        </Box>
      </Box>

      {/* Right — detail (lazy, single mount) */}
      <Box
        sx={{
          width: compactNav ? "100%" : 380,
          flexShrink: 0,
          overflow: "auto",
          bgcolor: "background.paper",
          minHeight: compactNav ? 320 : "auto",
        }}
      >
        {selectedFeature ? (
          <Suspense
            fallback={
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress size={24} />
              </Box>
            }
          >
            <SecurityFeatureDetailPanel
              key={selectedFeature.featureKey}
              feature={selectedFeature}
              applicationId={applicationId}
              application={application}
              enabled={selectedFeature.enabled}
              onSaved={onSaved}
              runScan={runScan}
              scanRunning={scanRunning}
              isRunningThis={
                scanRunning && activeScanFeatureKey === selectedFeature.featureKey
              }
              featureActionsRef={featureActionsRef}
              readOnly={readOnly}
            />
          </Suspense>
        ) : (
          <Box sx={{ p: 3, textAlign: "center" }}>
            <Typography variant="body2" sx={{ color: SCAN_CENTER_INK.muted }}>
              Select a feature to view configuration.
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
}

export default memo(ScanCenterFeatureWorkspace);
