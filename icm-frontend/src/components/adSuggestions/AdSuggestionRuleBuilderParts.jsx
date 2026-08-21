import { useState } from 'react';
import {
  alpha,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  FormControl,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add, Close, Delete, DragIndicator, ExpandLess, ExpandMore } from '@mui/icons-material';
import {
  AD_GROUP_FIELDS,
  AD_RULE_OPERATORS,
  createDefaultCondition,
  createDefaultFieldCondition,
} from './adSuggestionRuleUtils';

export function LogicToggle({ value, onChange, label, size = 'small' }) {
  const isAnd = value === 'AND';
  return (
    <Tooltip title={`Switch to ${isAnd ? 'OR' : 'AND'} logic`}>
      <Chip
        label={`${label ? `${label}: ` : ''}${isAnd ? 'AND' : 'OR'}`}
        size={size}
        onClick={() => onChange(isAnd ? 'OR' : 'AND')}
        sx={{
          fontWeight: 700,
          cursor: 'pointer',
          bgcolor: isAnd ? alpha('#2196f3', 0.12) : alpha('#ff9800', 0.12),
          color: isAnd ? '#1565c0' : '#e65100',
          border: `1px solid ${isAnd ? '#2196f3' : '#ff9800'}`,
          '&:hover': {
            bgcolor: isAnd ? alpha('#2196f3', 0.2) : alpha('#ff9800', 0.2),
          },
        }}
      />
    </Tooltip>
  );
}

function ConditionRow({ condition, onChange, onRemove, canRemove }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
      <FormControl size="small" sx={{ minWidth: 140 }}>
        <Select
          value={condition.operator}
          onChange={(e) => onChange({ ...condition, operator: e.target.value })}
        >
          {AD_RULE_OPERATORS.map((op) => (
            <MenuItem key={op.value} value={op.value}>
              {op.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField
        size="small"
        placeholder="Value…"
        value={condition.value}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        sx={{ flex: 1, minWidth: 140 }}
      />
      {canRemove ? (
        <IconButton size="small" onClick={onRemove} sx={{ color: 'error.main' }}>
          <Close fontSize="small" />
        </IconButton>
      ) : null}
    </Stack>
  );
}

function FieldConditionBlock({ fieldCondition, onChange, onRemove, canRemove }) {
  const updateCondition = (condIdx, updated) => {
    const newConds = [...fieldCondition.conditions];
    newConds[condIdx] = updated;
    onChange({ ...fieldCondition, conditions: newConds });
  };
  const removeCondition = (condIdx) => {
    if (fieldCondition.conditions.length <= 1) return;
    onChange({
      ...fieldCondition,
      conditions: fieldCondition.conditions.filter((_, i) => i !== condIdx),
    });
  };
  const addCondition = () => {
    onChange({
      ...fieldCondition,
      conditions: [...fieldCondition.conditions, createDefaultCondition()],
    });
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mb: 1.5,
        borderColor: alpha('#2196f3', 0.25),
        bgcolor: (theme) =>
          theme.palette.mode === 'dark'
            ? alpha('#2196f3', 0.04)
            : alpha('#2196f3', 0.02),
        borderRadius: 2,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <Autocomplete
          size="small"
          options={AD_GROUP_FIELDS}
          getOptionLabel={(option) =>
            typeof option === 'string' ? option : option.label
          }
          value={
            AD_GROUP_FIELDS.find((field) => field.fieldName === fieldCondition.fieldName) ||
            fieldCondition.fieldName
          }
          onChange={(_, option) =>
            onChange({
              ...fieldCondition,
              fieldName:
                typeof option === 'string'
                  ? option
                  : option?.fieldName || fieldCondition.fieldName,
            })
          }
          onInputChange={(_, value, reason) => {
            if (reason === 'input') {
              onChange({ ...fieldCondition, fieldName: value || '' });
            }
          }}
          renderInput={(params) => (
            <TextField {...params} label="Field" placeholder="groupName" />
          )}
          sx={{ minWidth: 220, flex: 1 }}
        />
        <LogicToggle
          value={fieldCondition.conditionLogic}
          onChange={(value) => onChange({ ...fieldCondition, conditionLogic: value })}
          label="Any of"
        />
        {canRemove ? (
          <IconButton size="small" onClick={onRemove} sx={{ color: 'error.main' }}>
            <Delete fontSize="small" />
          </IconButton>
        ) : null}
      </Stack>

      {fieldCondition.conditions.map((cond, condIdx) => (
        <Box key={condIdx}>
          {condIdx > 0 ? (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                textAlign: 'center',
                color: 'text.secondary',
                fontWeight: 700,
                my: 0.5,
              }}
            >
              {fieldCondition.conditionLogic}
            </Typography>
          ) : null}
          <ConditionRow
            condition={cond}
            onChange={(updated) => updateCondition(condIdx, updated)}
            onRemove={() => removeCondition(condIdx)}
            canRemove={fieldCondition.conditions.length > 1}
          />
        </Box>
      ))}

      <Button
        size="small"
        startIcon={<Add />}
        onClick={addCondition}
        sx={{ textTransform: 'none', fontWeight: 600, mt: 0.5 }}
      >
        Add value
      </Button>
    </Paper>
  );
}

export function StepBlock({ step, stepIndex, onChange, onRemove, canRemove }) {
  const [collapsed, setCollapsed] = useState(false);

  const updateFieldCondition = (fcIdx, updated) => {
    const newFcs = [...step.fieldConditions];
    newFcs[fcIdx] = updated;
    onChange({ ...step, fieldConditions: newFcs });
  };
  const removeFieldCondition = (fcIdx) => {
    if (step.fieldConditions.length <= 1) return;
    onChange({
      ...step,
      fieldConditions: step.fieldConditions.filter((_, i) => i !== fcIdx),
    });
  };
  const addFieldCondition = () => {
    onChange({
      ...step,
      fieldConditions: [...step.fieldConditions, createDefaultFieldCondition()],
    });
  };

  const fieldCount = step.fieldConditions?.length || 0;
  const condCount = (step.fieldConditions || []).reduce(
    (sum, fc) => sum + (fc.conditions?.length || 0),
    0,
  );

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 2,
        borderColor: (theme) => alpha(theme.palette.primary.main, 0.3),
        borderRadius: 2,
        overflow: 'visible',
      }}
    >
      <CardContent sx={{ pb: '12px !important' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: collapsed ? 0 : 2 }}>
          <DragIndicator sx={{ color: 'text.disabled', fontSize: 20 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>
            Check {stepIndex + 1}
          </Typography>
          <Chip
            size="small"
            label={`${fieldCount} field${fieldCount !== 1 ? 's' : ''} · ${condCount} condition${condCount !== 1 ? 's' : ''}`}
            variant="outlined"
            sx={{ fontWeight: 600, fontSize: '0.7rem' }}
          />
          <LogicToggle
            value={step.fieldLogic}
            onChange={(value) => onChange({ ...step, fieldLogic: value })}
            label="Match on"
          />
          <IconButton size="small" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ExpandMore fontSize="small" /> : <ExpandLess fontSize="small" />}
          </IconButton>
          {canRemove ? (
            <IconButton size="small" onClick={onRemove} sx={{ color: 'error.main' }}>
              <Delete fontSize="small" />
            </IconButton>
          ) : null}
        </Stack>

        <Collapse in={!collapsed}>
          {step.fieldConditions.map((fc, fcIdx) => (
            <Box key={fcIdx}>
              {fcIdx > 0 ? (
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    textAlign: 'center',
                    color: 'text.secondary',
                    fontWeight: 800,
                    my: 1,
                    fontSize: '0.85rem',
                  }}
                >
                  {step.fieldLogic}
                </Typography>
              ) : null}
              <FieldConditionBlock
                fieldCondition={fc}
                onChange={(updated) => updateFieldCondition(fcIdx, updated)}
                onRemove={() => removeFieldCondition(fcIdx)}
                canRemove={step.fieldConditions.length > 1}
              />
            </Box>
          ))}
          <Button
            size="small"
            startIcon={<Add />}
            onClick={addFieldCondition}
            sx={{ textTransform: 'none', fontWeight: 600, mt: 1 }}
          >
            Add field
          </Button>
        </Collapse>
      </CardContent>
    </Card>
  );
}
