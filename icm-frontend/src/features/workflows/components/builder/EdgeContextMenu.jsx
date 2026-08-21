import { Menu, MenuItem } from "@mui/material";

export default function EdgeContextMenu({ anchor, onClose, onInsertStep, onDeleteConnection }) {
  return (
    <Menu
      open={Boolean(anchor)}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={anchor ? { top: anchor.y, left: anchor.x } : undefined}
    >
      <MenuItem
        onClick={() => {
          onInsertStep();
          onClose();
        }}
      >
        Insert Step
      </MenuItem>
      <MenuItem
        onClick={() => {
          onDeleteConnection();
          onClose();
        }}
      >
        Delete Connection
      </MenuItem>
    </Menu>
  );
}
