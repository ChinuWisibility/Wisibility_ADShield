import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, TextField, Typography } from "@mui/material";
import { mergePaletteCatalog } from "../../config/paletteCatalogExtras";
import { workflowApi } from "../../services/api";
import { flattenRunnableCatalog } from "../../utils/paletteItems";
import { resolveBuildCoachState } from "../../utils/workflowBuildCoach";
import StepPickerList from "./StepPickerList";

export default function InsertStepPicker({
  open,
  onClose,
  onSelect,
  remediationAction,
  triggerType,
  nodes = [],
}) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);

  const recommendedStep = resolveBuildCoachState({
    nodes,
    remediationAction,
    triggerType,
  })?.nextPathStep;

  useEffect(() => {
    if (!open) return;
    workflowApi
      .catalog(remediationAction)
      .then((r) => {
        const data = mergePaletteCatalog(r.data.data || {});
        setItems(flattenRunnableCatalog(data, { allowTriggers: false }));
      })
      .catch(() => setItems(flattenRunnableCatalog({}, { allowTriggers: false })));
  }, [open, remediationAction]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Insert step</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Choose a step to insert on the selected connection.
        </Typography>
        <TextField
          fullWidth
          size="small"
          placeholder="Search steps…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
