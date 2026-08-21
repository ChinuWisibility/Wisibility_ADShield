import {
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Add, Delete } from '@mui/icons-material';
import { LogicToggle, StepBlock } from './AdSuggestionRuleBuilderParts';
import {
  createDefaultRuleDefinition,
  createDefaultStep,
} from './adSuggestionRuleUtils';

export default function AdSuggestionAdvancedRulesPanel({
  definition,
  defIndex,
  onChange,
  onRemove,
  canRemove,
}) {
  const updateStep = (stepIndex, updatedStep) => {
    onChange({
      ...definition,
      steps: definition.steps.map((step, idx) =>
        idx === stepIndex ? updatedStep : step,
      ),
    });
  };

  const removeStep = (stepIndex) => {
    if (definition.steps.length <= 1) return;
    onChange({
      ...definition,
      steps: definition.steps.filter((_, idx) => idx !== stepIndex),
    });
  };

  const addStep = () => {
    onChange({
      ...definition,
      steps: [...definition.steps, createDefaultStep()],
    });
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: 'grey.50' }}>
      <CardContent>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          sx={{ mb: 2 }}
        >
          <TextField
            label="Application name"
            size="small"
            value={definition.appName}
            onChange={(e) => onChange({ ...definition, appName: e.target.value })}
            sx={{ flex: 1 }}
          />
          <LogicToggle
            value={definition.stepLogic}
            onChange={(value) => onChange({ ...definition, stepLogic: value })}
            label="Also include"
          />
          {canRemove ? (
            <IconButton
              aria-label="Remove rule"
              onClick={onRemove}
              sx={{ color: 'error.main' }}
            >
              <Delete />
            </IconButton>
          ) : null}
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Combine multiple field checks. Use &quot;Also include&quot; to require all steps (AND)
          or any step (OR).
        </Typography>

        {definition.steps.map((step, stepIndex) => (
          <Box key={`adv-step-${defIndex}-${stepIndex}`}>
            {stepIndex > 0 ? (
              <Typography
                variant="body2"
                sx={{
                  textAlign: 'center',
                  fontWeight: 700,
                  color: definition.stepLogic === 'AND' ? 'primary.main' : 'warning.dark',
                  my: 1.5,
                }}
              >
                {definition.stepLogic === 'AND' ? 'And also' : 'Or also'}
              </Typography>
            ) : null}
            <StepBlock
              step={step}
              stepIndex={stepIndex}
              onChange={(updated) => updateStep(stepIndex, updated)}
              onRemove={() => removeStep(stepIndex)}
              canRemove={definition.steps.length > 1}
            />
          </Box>
        ))}

        <Button
          size="small"
          startIcon={<Add />}
          onClick={addStep}
          sx={{ textTransform: 'none', fontWeight: 600, mt: 1 }}
        >
          Add another check
        </Button>
      </CardContent>
    </Card>
  );
}

export function createEmptyAdvancedRule() {
  return createDefaultRuleDefinition();
}
