import React, { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  KeyboardArrowDown,
  KeyboardArrowUp,
  ViewColumn,
} from '@mui/icons-material';
import { moveColumnKeyInOrder } from '../../utils/accountTableColumns';
import { palette } from '../../theme/palette';

/**
 * Columns menu: show/hide + up/down reorder (maps to left/right on the table).
 */
export default function AccountTableColumnPicker({
  columnDefs = [],
  columnOrderKeys = [],
  visibleColumns = [],
  onColumnOrderChange,
  onVisibleColumnsChange,
  /** Called only after user clicks move left/right (not on checkbox toggle). */
  onColumnReorder,
  disabled = false,
  buttonSx = {},
  helperText = 'Show/hide and arrow order are saved for this application when you change them.',
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  const defsByKey = React.useMemo(
    () => new Map(columnDefs.map((d) => [d.key, d])),
    [columnDefs],
  );

  const orderedRows = (columnOrderKeys.length ? columnOrderKeys : columnDefs.map((d) => d.key))
    .map((key) => {
      const def = defsByKey.get(key);
      if (!def) return null;
      return def;
    })
    .filter(Boolean);

  const handleToggle = (key, event) => {
    event?.stopPropagation();
    onVisibleColumnsChange((prev) => {
      if (prev.includes(key)) {
        if (prev.length <= 1) return prev;
        return prev.filter((c) => c !== key);
      }
      return [...prev, key];
    });
  };

  const handleMove = (key, direction) => {
    onColumnOrderChange((prev) => {
      const next = moveColumnKeyInOrder(prev, key, direction);
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        onColumnReorder?.(next);
      }
      return next;
    });
  };

  if (!columnDefs.length) return null;

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<ViewColumn sx={{ fontSize: 18 }} />}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        size="small"
        disabled={disabled}
        sx={{
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.8rem',
          borderRadius: '10px',
          borderColor: alpha('#0f172a', 0.12),
          color: '#334155',
          px: 1.5,
          '&:hover': { borderColor: alpha('#2563eb', 0.45), bgcolor: alpha('#2563eb', 0.04) },
          ...buttonSx,
        }}
      >
        Columns
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        PaperProps={{ sx: { maxHeight: 440, width: 320 } }}
      >
        <Box sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${palette.border.default}` }}>
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 700, letterSpacing: '0.05em', fontSize: '0.72rem', textTransform: 'uppercase', color: palette.text.secondary }}
          >
            Columns
          </Typography>
          <Typography variant="caption" sx={{ color: palette.text.secondary, display: 'block', mt: 0.5, lineHeight: 1.4 }}>
            {helperText}
          </Typography>
        </Box>
        {orderedRows.map((def, index) => {
          const isFirst = index === 0;
          const isLast = index === orderedRows.length - 1;
          return (
            <MenuItem
              key={def.key}
              dense
              disableRipple
              sx={{ py: 0.25, px: 1, cursor: 'default' }}
              onClick={(e) => e.stopPropagation()}
            >
              <Box
                sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 0.25, minWidth: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={visibleColumns.includes(def.key)}
                      size="small"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleToggle(def.key, e)}
                    />
                  }
                  label={
                    <Typography variant="body2" noWrap sx={{ maxWidth: 168 }} title={def.label}>
                      {def.label}
                    </Typography>
                  }
                  sx={{ flex: 1, m: 0, minWidth: 0 }}
                />
                
                  <span>
                    <IconButton
                      size="small"
                      disabled={isFirst}
                      aria-label={`Move ${def.label} left`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMove(def.key, -1);
                      }}
                      sx={{ color: palette.text.secondary }}
                    >
                      <KeyboardArrowUp fontSize="small" />
                    </IconButton>
                  </span>
               
               
                  <span>
                    <IconButton
                      size="small"
                      disabled={isLast}
                      aria-label={`Move ${def.label} right`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMove(def.key, 1);
                      }}
                      sx={{ color: palette.text.secondary }}
                    >
                      <KeyboardArrowDown fontSize="small" />
                    </IconButton>
                  </span>
               
              </Box>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
