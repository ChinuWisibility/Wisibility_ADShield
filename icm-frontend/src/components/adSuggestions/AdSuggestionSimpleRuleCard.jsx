import { memo, useMemo } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Delete, Visibility } from '@mui/icons-material';
import {
  AD_GROUP_FIELDS,
  AD_RULE_OPERATORS,
} from './adSuggestionRuleUtils';

function MatchPreview({ preview, loading, value }) {
  if (!String(value || '').trim()) {
    return (
      <Typography variant="body2" color="text.secondary">
        Enter a value to see matching groups.
      </Typography>
    );
  }
  if (loading) {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          Checking matches…
        </Typography>
      </Stack>
    );
  }
  if (!preview) return null;

  const count = Number(preview.matchCount) || 0;
  const samples = Array.isArray(preview.samples) ? preview.samples : [];

  return (
    <Box
      sx={{
        mt: 1.5,
        p: 1.5,
        borderRadius: 1.5,
        bgcolor: 'action.hover',
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {count === 0
          ? 'No groups match yet'
          : `${count.toLocaleString()} group${count === 1 ? '' : 's'} match this rule`}
      </Typography>
      {samples.length > 0 ? (
        <Stack spacing={0.5} component="ul" sx={{ m: 0, pl: 2 }}>
          {samples.map((group) => (
            <Typography
              key={group.dn || group.name}
              component="li"
              variant="caption"
              color="text.secondary"
            >
              {group.name || 'Unnamed group'}
              {group.memberCount != null ? ` · ${group.memberCount} members` : ''}
            </Typography>
          ))}
          {count > samples.length ? (
            <Typography component="li" variant="caption" color="text.secondary">
              …and {(count - samples.length).toLocaleString()} more
            </Typography>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  );
}

function AdSuggestionSimpleRuleCard({
  form,
  onChange,
  onRemove,
  canRemove,
  preview,
  previewLoading,
  showPreview,
  onTogglePreview,
}) {
  const fieldOptions = useMemo(() => AD_GROUP_FIELDS, []);

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'stretch', sm: 'flex-start' }}
          >
            <TextField
              label="Application name"
              size="small"
              value={form.appName}
              onChange={(e) => onChange({ ...form, appName: e.target.value })}
              placeholder="e.g. SAP, Tableau, IT"
              sx={{ flex: 1 }}
              fullWidth
            />
            {canRemove ? (
              <IconButton
                aria-label="Remove matching rule"
                onClick={onRemove}
                sx={{ color: 'error.main', alignSelf: { xs: 'flex-end', sm: 'center' } }}
              >
                <Delete />
              </IconButton>
            ) : null}
          </Stack>

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Match groups where
            </Typography>
            <RadioGroup
              row
              value={form.fieldName}
              onChange={(e) => onChange({ ...form, fieldName: e.target.value })}
              sx={{ flexWrap: 'wrap', gap: { xs: 0, sm: 1 } }}
            >
              {fieldOptions.map((field) => (
                <FormControlLabel
                  key={field.fieldName}
                  value={field.fieldName}
                  control={<Radio size="small" />}
                  label={field.label}
                />
              ))}
            </RadioGroup>
          </Box>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'stretch', sm: 'center' }}
          >
            <FormControl size="small" sx={{ minWidth: { sm: 160 } }}>
              <Select
                value={form.operator}
                onChange={(e) => onChange({ ...form, operator: e.target.value })}
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
              label="Value"
              value={form.value}
              onChange={(e) => onChange({ ...form, value: e.target.value })}
              placeholder="e.g. SAP, GRP_IT_, Tableau"
              sx={{ flex: 1 }}
              fullWidth
            />
            <Button
              variant="outlined"
              size="small"
              startIcon={<Visibility fontSize="small" />}
              onClick={onTogglePreview}
              disabled={!String(form.value || '').trim()}
              sx={{ textTransform: 'none', fontWeight: 600, flexShrink: 0 }}
            >
              {showPreview ? 'Hide preview' : 'Preview matches'}
            </Button>
          </Stack>

          {showPreview ? (
            <MatchPreview
              preview={preview}
              loading={previewLoading}
              value={form.value}
            />
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default memo(AdSuggestionSimpleRuleCard);
