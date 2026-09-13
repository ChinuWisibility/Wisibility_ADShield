import {
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  InputAdornment,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { CATEGORY_FILTERS, SEVERITY_FILTERS } from "../adShieldRemediationMeta";

export default function RemediationFindingFilters({
  severity = "all",
  category = "all",
  search = "",
  onSeverityChange,
  onCategoryChange,
  onSearchChange,
}) {
  return (
    <Stack spacing={1.5} sx={{ mb: 2 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={severity}
        onChange={(_, v) => v && onSeverityChange?.(v)}
        sx={{ flexWrap: "wrap" }}
      >
        {SEVERITY_FILTERS.map((f) => (
          <ToggleButton key={f.id} value={f.id} sx={{ textTransform: "none", px: 1.5 }}>
            {f.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <ToggleButtonGroup
        exclusive
        size="small"
        value={category}
        onChange={(_, v) => v && onCategoryChange?.(v)}
        sx={{ flexWrap: "wrap" }}
      >
        {CATEGORY_FILTERS.map((f) => (
          <ToggleButton key={f.id} value={f.id} sx={{ textTransform: "none", px: 1.5 }}>
            {f.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <TextField
        size="small"
        placeholder="Search findings..."
        value={search}
        onChange={(e) => onSearchChange?.(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" color="action" />
            </InputAdornment>
          ),
        }}
        sx={{ maxWidth: 420 }}
      />
    </Stack>
  );
}
