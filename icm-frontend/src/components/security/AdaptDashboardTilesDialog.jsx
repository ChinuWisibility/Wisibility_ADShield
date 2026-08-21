import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControlLabel,
  Checkbox,
  Typography,
  Divider,
  Box,
  Stack,
  Alert,
} from "@mui/material";
import {
  SECURITY_DASHBOARD_METRIC_TILES,
  SECURITY_DASHBOARD_PRIVILEGE_TILES,
  SECURITY_DASHBOARD_PANELS,
  defaultSecurityDashboardPrefs,
  normalizeSecurityDashboardPrefs,
} from "../../utils/securityDashboardTiles";

/**
 * Adapt which Security Posture Dashboard tiles/panels are visible.
 * Preferences are saved via backend user preferences (survive reload).
 */
export default function AdaptDashboardTilesDialog({
  open,
  onClose,
  initialPrefs,
  onSave,
  saving = false,
}) {
  const [draft, setDraft] = useState(defaultSecurityDashboardPrefs());

  useEffect(() => {
    if (open) setDraft(normalizeSecurityDashboardPrefs(initialPrefs || {}));
  }, [open, initialPrefs]);

  const hidden = useMemo(() => new Set(draft.hiddenTiles || []), [draft.hiddenTiles]);

  const toggle = (id) => {
    setDraft((prev) => {
      const set = new Set(prev.hiddenTiles || []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, hiddenTiles: [...set] };
    });
  };

  const showAll = () => setDraft((prev) => ({ ...prev, hiddenTiles: [] }));
  const hideAllMetrics = () =>
    setDraft((prev) => ({
      ...prev,
      hiddenTiles: [
        ...new Set([
          ...(prev.hiddenTiles || []),
          ...SECURITY_DASHBOARD_METRIC_TILES.map((t) => t.id),
        ]),
      ],
    }));

  const groupedMetrics = useMemo(() => {
    const map = new Map();
    for (const tile of SECURITY_DASHBOARD_METRIC_TILES) {
      if (!map.has(tile.group)) map.set(tile.group, []);
      map.get(tile.group).push(tile);
    }
    return [...map.entries()];
  }, []);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle fontWeight={800}>Adapt dashboard tiles</DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2 }}>
          Choices are saved to your account and apply on every reload. Hidden tiles
          stay out of the UI until you show them again.
        </Alert>

        <FormControlLabel
          control={
            <Checkbox
              checked={Boolean(draft.hideZeroMetrics)}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, hideZeroMetrics: e.target.checked }))
              }
            />
          }
          label="Hide metrics with zero findings (adapt filter)"
        />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          When enabled, tiles that currently report 0 are hidden automatically so empty
          signals don’t compete with real exposure.
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Button size="small" onClick={showAll} sx={{ textTransform: "none" }}>
            Show all
          </Button>
          <Button size="small" onClick={hideAllMetrics} sx={{ textTransform: "none" }}>
            Hide all metric tiles
          </Button>
        </Stack>

        <Typography variant="subtitle2" fontWeight={800} gutterBottom>
          Metric tiles
        </Typography>
        {groupedMetrics.map(([group, tiles]) => (
          <Box key={group} sx={{ mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={700}>
              {group}
            </Typography>
            <Stack>
              {tiles.map((tile) => (
                <FormControlLabel
                  key={tile.id}
                  control={
                    <Checkbox
                      checked={!hidden.has(tile.id)}
                      onChange={() => toggle(tile.id)}
                      size="small"
                    />
                  }
                  label={tile.label}
                />
              ))}
            </Stack>
          </Box>
        ))}

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" fontWeight={800} gutterBottom>
          Privilege exposure tiles
        </Typography>
        <Stack>
          {SECURITY_DASHBOARD_PRIVILEGE_TILES.map((tile) => (
            <FormControlLabel
              key={tile.id}
              control={
                <Checkbox
                  checked={!hidden.has(tile.id)}
                  onChange={() => toggle(tile.id)}
                  size="small"
                />
              }
              label={tile.label}
            />
          ))}
        </Stack>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" fontWeight={800} gutterBottom>
          Dashboard sections
        </Typography>
        <Stack>
          {SECURITY_DASHBOARD_PANELS.map((tile) => (
            <FormControlLabel
              key={tile.id}
              control={
                <Checkbox
                  checked={!hidden.has(tile.id)}
                  onChange={() => toggle(tile.id)}
                  size="small"
                />
              }
              label={tile.label}
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={saving}
          onClick={() => onSave(normalizeSecurityDashboardPrefs(draft))}
          sx={{ textTransform: "none" }}
        >
          {saving ? "Saving…" : "Save preferences"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
