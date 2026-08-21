import { useMemo } from "react";
import {
  Box,
  TextField,
  MenuItem,
  InputAdornment,
  Button,
  Autocomplete,
  Chip,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { featureLabel } from "../../pages/security/securityFeatureMeta";
import {
  SCAN_CENTER_CATEGORIES,
  featureKeysForCategories,
} from "../../utils/scanCenterCategories";

const OBJECT_TYPES = ["", "user", "group", "computer", "entitlement"];

/**
 * Findings Explorer filters — Category → Feature (multi-select), aligned with Scan Center.
 */
export default function FindingsFilters({
  filters,
  onChange,
  onReset,
}) {
  const categories = Array.isArray(filters.categories) ? filters.categories : [];
  const features = Array.isArray(filters.features) ? filters.features : [];

  const selectedCategoryOptions = useMemo(
    () => SCAN_CENTER_CATEGORIES.filter((c) => categories.includes(c.id)),
    [categories],
  );

  const featureOptions = useMemo(() => {
    const keys = featureKeysForCategories(categories);
    return keys.map((key) => ({ key, label: featureLabel(key) }));
  }, [categories]);

  const selectedFeatureOptions = useMemo(
    () => featureOptions.filter((o) => features.includes(o.key)),
    [featureOptions, features],
  );

  const set = (patch) => onChange({ ...filters, ...patch });

  const handleCategoriesChange = (_event, selected) => {
    const nextCategories = (selected || []).map((c) => c.id);
    const allowed = new Set(featureKeysForCategories(nextCategories));
    const nextFeatures = features.filter((f) => allowed.has(f));
    set({ categories: nextCategories, features: nextFeatures });
  };

  const handleFeaturesChange = (_event, selected) => {
    set({ features: (selected || []).map((o) => o.key) });
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        gap: 1.5,
        alignItems: "center",
        mb: 2,
      }}
    >
      <TextField
        size="small"
        placeholder="Search user, group, DN, SID…"
        value={filters.search || ""}
        onChange={(e) => set({ search: e.target.value })}
        sx={{ minWidth: 220, flex: "1 1 200px" }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
      />

      <Autocomplete
        multiple
        size="small"
        options={SCAN_CENTER_CATEGORIES}
        value={selectedCategoryOptions}
        onChange={handleCategoriesChange}
        getOptionLabel={(o) => o.label}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        disableCloseOnSelect
        sx={{ minWidth: 220, flex: "1 1 200px" }}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip
              {...getTagProps({ index })}
              key={option.id}
              size="small"
              label={option.label}
            />
          ))
        }
        renderInput={(params) => (
          <TextField {...params} label="Category" placeholder="Select categories" />
        )}
      />

      <Autocomplete
        multiple
        size="small"
        options={featureOptions}
        value={selectedFeatureOptions}
        onChange={handleFeaturesChange}
        getOptionLabel={(o) => o.label}
        isOptionEqualToValue={(a, b) => a.key === b.key}
        disableCloseOnSelect
        sx={{ minWidth: 240, flex: "1 1 220px" }}
        noOptionsText={
          categories.length
            ? "No features in selected categories"
            : "All detectors — or pick categories first"
        }
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip
              {...getTagProps({ index })}
              key={option.key}
              size="small"
              label={option.label}
            />
          ))
        }
        renderInput={(params) => (
          <TextField {...params} label="Feature" placeholder="Select features" />
        )}
      />

      <TextField
        select
        size="small"
        label="Object type"
        value={filters.objectType || ""}
        onChange={(e) => set({ objectType: e.target.value })}
        sx={{ minWidth: 130 }}
      >
        {OBJECT_TYPES.map((t) => (
          <MenuItem key={t || "all"} value={t}>
            {t ? t : "All types"}
          </MenuItem>
        ))}
      </TextField>

      {onReset && (
        <Button size="small" startIcon={<ClearIcon />} onClick={onReset}>
          Reset
        </Button>
      )}
    </Box>
  );
}
