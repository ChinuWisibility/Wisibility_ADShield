import { useState } from 'react';

import {

  Autocomplete,

  Box,

  Button,

  IconButton,

  Paper,

  Stack,

  Switch,

  TextField,

  Typography,

  alpha,

} from '@mui/material';

import { Add, Delete } from '@mui/icons-material';

import { useSnackbar } from 'notistack';

import { HYGIENE_BUILTIN_LABELS, IDENTITY_ATTRIBUTES_RULES_TITLE } from '../../../identities/posture/identityPostureLabels';



const STUDIO_ACCENT = '#2563eb';

const ruleEditorColumnSx = { maxWidth: 1000, width: '100%' };



const BUILTIN_CHECK_COLUMNS = {

  hasManager: { label: 'Manager', paths: ['managerId', 'manager', 'managerEmail'] },

  hasEmail: { label: 'Email', paths: ['email'] },

  hasHrRecord: { label: 'HR Record', paths: ['identityProfileId'] },

};



function slugify(name) {

  return String(name || '')

    .trim()

    .toLowerCase()

    .replace(/[^a-z0-9]+/g, '_')

    .replace(/^_|_$/g, '');

}



function labelToAttributeName(label) {

  return String(label || '').trim().replace(/\s+present\s*$/i, '');

}



function isBuiltinHygieneCheck(check) {

  return check?.evaluator?.type === 'builtin';

}



function getCheckAttributeName(check) {

  if (check?.label) {

    const fromLabel = labelToAttributeName(check.label);

    if (fromLabel) return fromLabel;

  }

  if (isBuiltinHygieneCheck(check)) {

    const key = check.evaluator?.key;

    if (key && BUILTIN_CHECK_COLUMNS[key]) return BUILTIN_CHECK_COLUMNS[key].label;

    if (key && HYGIENE_BUILTIN_LABELS[key]) return HYGIENE_BUILTIN_LABELS[key];

  }

  return '';

}



function normalizeIdentityColumns(fields) {

  return (fields || [])

    .map((f) => {

      if (typeof f === 'string') {

        const key = f.trim();

        return key ? { key, label: key, path: key } : null;

      }

      const key = String(f.key || f.name || f.field || '').trim();

      if (!key) return null;

      const label = String(f.label || key).trim();

      const path = String(f.path || f.dbPath || key).trim();

      return { key, label, path };

    })

    .filter(Boolean);

}



function resolveColumnPath(value) {

  if (value == null || value === '') return '';

  if (typeof value === 'string') return value.trim();

  return String(value.path || value.key || '').trim();

}



function columnOptionLabel(option) {

  if (typeof option === 'string') return option;

  return option.label === option.path ? option.label : `${option.label} (${option.path})`;

}



function pathToColumnOption(path, columns) {

  const p = String(path || '').trim();

  if (!p) return null;

  const match = columns.find((c) => c.path === p || c.key === p);

  return match || p;

}



export function buildCustomAttributeCheck(attributeName, columnPath) {
  const name = String(attributeName || '').trim();
  const path = String(columnPath || '').trim();
  const logicalKey = slugify(name) || slugify(path) || 'custom';
  const isManager = logicalKey === 'manager' || /^manager$/i.test(name);
  const resolvePaths = isManager
    ? ['managerId', 'manager', 'managerEmail']
    : [path];
  return {
    id: `custom_${logicalKey}_${Date.now()}`,
    label: `${name} present`,
    enabled: true,
    evaluator: { type: 'fieldPresent', logicalKey, resolvePaths },
  };
}



function AttributeNameField({ value, onChange }) {

  return (

    <TextField

      size="small"

      fullWidth

      label="Attribute name"

      placeholder="Department"

      value={value}

      onChange={(e) => onChange(e.target.value)}

    />

  );

}



function ColumnMapField({ value, onChange, columns }) {

  const options = normalizeIdentityColumns(columns);

  return (

    <Autocomplete

      size="small"

      freeSolo

      options={options}

      value={value}

      onChange={(_, v) => onChange(v)}

      onInputChange={(_, v, reason) => {

        if (reason === 'input') onChange(v);

      }}

      getOptionLabel={(o) => columnOptionLabel(o)}

      isOptionEqualToValue={(a, b) => resolveColumnPath(a) === resolveColumnPath(b)}

      renderInput={(params) => (

        <TextField {...params} label="Map to column" placeholder="e.g. attributes.department" />

      )}

    />

  );

}



function AttributeCard({

  check,

  idx,

  schemaFields = [],

  onToggle,

  onLabelChange,

  onColumnChange,

  onDelete,

}) {

  const columns = normalizeIdentityColumns(schemaFields);

  const attrName = getCheckAttributeName(check);

  const columnValue = pathToColumnOption(check.evaluator?.resolvePaths?.[0], columns);



  return (

    <Paper

      variant="outlined"

      sx={{

        px: 1.5,

        py: 1.25,

        borderRadius: 1.5,

        borderColor: check.enabled ? alpha(STUDIO_ACCENT, 0.3) : 'divider',

        bgcolor: check.enabled ? alpha(STUDIO_ACCENT, 0.02) : '#fff',

      }}

    >

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'flex-start' }}>

        <Box sx={{ flex: 1, minWidth: 0 }}>

          <AttributeNameField

            value={attrName}

            onChange={(name) => {

              const trimmed = name.trim();

              onLabelChange(idx, trimmed ? `${trimmed} present` : '');

            }}

          />

        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>

          <ColumnMapField

            value={columnValue}

            columns={columns}

            onChange={(col) => onColumnChange(idx, resolveColumnPath(col))}

          />

        </Box>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ pt: { md: 0.5 } }}>

          <Switch size="small" checked={!!check.enabled} onChange={(e) => onToggle(idx, e.target.checked)} />

          <IconButton size="small" color="error" onClick={() => onDelete(idx)} aria-label="Remove attribute">

            <Delete sx={{ fontSize: 18 }} />

          </IconButton>

        </Stack>

      </Stack>

    </Paper>

  );

}



export default function IdentityAttributesRules({

  attributeChecks,

  checks,

  schemaFields,

  onUpdateCheck,

  onDeleteCheck,

  onAddCheck,

}) {

  const { enqueueSnackbar } = useSnackbar();

  const [attrName, setAttrName] = useState('');

  const [columnMap, setColumnMap] = useState(null);



  const handleAdd = () => {

    const name = attrName.trim();

    const path = resolveColumnPath(columnMap);

    if (!name) {

      enqueueSnackbar('Enter an attribute name first', { variant: 'warning' });

      return;

    }

    if (!path) {

      enqueueSnackbar('Map the attribute to an identity column', { variant: 'warning' });

      return;

    }

    onAddCheck(buildCustomAttributeCheck(name, path));

    setAttrName('');

    setColumnMap(null);

    enqueueSnackbar('Attribute added — click Save all to persist', { variant: 'success' });

  };



  const handleDelete = (idx) => {

    const target = checks[idx];

    if (!window.confirm(`Remove "${target?.label || 'this attribute'}"?`)) return;

    onDeleteCheck(idx);

  };



  return (

    <Box sx={ruleEditorColumnSx}>

      <Typography variant="h6" fontWeight={700} sx={{ mb: 0.75 }}>

        {IDENTITY_ATTRIBUTES_RULES_TITLE}

      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.55, maxWidth: 520 }}>

        Define each attribute and map it to an identity column. Points are split automatically — 100 divided

        evenly across all enabled attributes (e.g. 2 attributes = 50 each, 4 = 25 each).

      </Typography>



      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: '#fff', mb: 1.5 }}>

        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>

          Add attribute

        </Typography>

        <Stack spacing={1.5}>

          <Box>

            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.25 }}>

              Define attribute

            </Typography>

            <AttributeNameField value={attrName} onChange={setAttrName} />

          </Box>

          <Box>

            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.25 }}>

              Map to column

            </Typography>

            <ColumnMapField value={columnMap} onChange={setColumnMap} columns={schemaFields} />

          </Box>

        </Stack>

      </Paper>



      <Button startIcon={<Add />} variant="contained" size="small" onClick={handleAdd} sx={{ mb: 2.5 }}>

        Add attribute

      </Button>



      {attributeChecks.length > 0 ? (

        <Stack spacing={1}>

          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 0.5 }}>

            Saved attributes

          </Typography>

          {attributeChecks.map((check) => {

            const idx = checks.findIndex((c) => c.id === check.id);

            return (

              <AttributeCard

                key={check.id}

                check={check}

                idx={idx}

                schemaFields={schemaFields}

                onToggle={(i, enabled) => onUpdateCheck(i, { enabled })}

                onLabelChange={(i, label) => onUpdateCheck(i, { label })}

                onColumnChange={(i, path) => {

                  const current = checks[i];

                  onUpdateCheck(i, {

                    evaluator: { ...current?.evaluator, type: 'fieldPresent', resolvePaths: path ? [path] : [] },

                  });

                }}

                onDelete={handleDelete}

              />

            );

          })}

        </Stack>

      ) : (

        <Typography variant="body2" color="text.secondary">

          No attributes yet. Add one above — it will show on identity posture after you save.

        </Typography>

      )}

    </Box>

  );

}


