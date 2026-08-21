import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, TextField, Typography } from "@mui/material";
import { mergePaletteCatalog } from "../../config/paletteCatalogExtras";
import { workflowApi } from "../../services/api";
import { flattenRunnableCatalog } from "../../utils/paletteItems";
import { countTriggerNodes } from "../../utils/workflowStepMeta";
import { resolveBuildCoachState } from "../../utils/workflowBuildCoach";
import StepPickerList from "./StepPickerList";

export default function StepPickerModal({
  open,
  onClose,
  onSelect,
  title = "Add step",
  subtitle = "Choose a step to place on the canvas.",
  nodes = [],
  remediationAction,
  triggerType,
}) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);

  const allowTriggers = countTriggerNodes(nodes) < 1;

  const recommendedStep = resolveBuildCoachState({
    nodes,
    remediationAction,
    triggerType,
  })?.nextPathStep;

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    workflowApi
      .catalog(remediationAction)
      .then((r) => {
        const data = mergePaletteCatalog(r.data.data || {});
        setItems(flattenRunnableCatalog(data, { allowTriggers }));
      })
      .catch(() => setItems(flattenRunnableCatalog({}, { allowTriggers })));
  }, [open, allowTriggers, remediationAction]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {subtitle}
        </Typography>
        <TextField
          fullWidth
          size="small"
          placeholder="Search steps…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          sx={{ mb: 2 }}
        />
        <StepPickerList
          items={items}
          search={search}
          nodes={nodes}
          recommendedStep={recommendedStep}
          onSelect={(item) => {
            onSelect(item);
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
