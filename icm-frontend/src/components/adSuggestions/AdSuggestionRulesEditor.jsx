import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Collapse,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { Add, ExpandMore, Save } from '@mui/icons-material';
import { adAPI, applicationAPI } from '../../services/api';
import AdSuggestionSimpleRuleCard from './AdSuggestionSimpleRuleCard';
import AdSuggestionAdvancedRulesPanel, {
  createEmptyAdvancedRule,
} from './AdSuggestionAdvancedRulesPanel';
import {
  createSimpleRuleForm,
  definitionFromSimpleForm,
  editorStateToDefinition,
  definitionToEditorState,
  getActiveRuleDefinitions,
  isSimpleRuleDefinition,
  ruleDefinitionFromApi,
  ruleDefinitionToApi,
  validateRuleDefinitions,
} from './adSuggestionRuleUtils';

const PREVIEW_DEBOUNCE_MS = 400;

function createEmptyEditorState() {
  return definitionToEditorState(createSimpleRuleForm());
}

export default function AdSuggestionRulesEditor({
  applicationId,
  onRulesApplied,
  groupsAvailable = true,
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editorStates, setEditorStates] = useState([]);
  const [advancedOpenByIndex, setAdvancedOpenByIndex] = useState({});
  const [previewOpenByIndex, setPreviewOpenByIndex] = useState({});
  const [previewByIndex, setPreviewByIndex] = useState({});
  const [previewLoadingByIndex, setPreviewLoadingByIndex] = useState({});
  const [connectionConfig, setConnectionConfig] = useState(null);
  const [sectionExpanded, setSectionExpanded] = useState(true);
  const previewTimersRef = useRef({});

  const loadRules = useCallback(async () => {
    if (!applicationId) {
      setLoading(false);
      setEditorStates([]);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await applicationAPI.getById(applicationId);
      const app = res.data?.data || res.data;
      const adConfig = app?.connectionConfig?.ad || {};
      const storedDefinitions = Array.isArray(adConfig.suggestionRuleDefinitions)
        ? adConfig.suggestionRuleDefinitions.map(ruleDefinitionFromApi)
        : [];

      setConnectionConfig(app?.connectionConfig || {});
      setEditorStates(
        storedDefinitions.length
          ? storedDefinitions.map((def) => definitionToEditorState(def))
          : [],
      );
      const advancedFlags = {};
      storedDefinitions.forEach((def, idx) => {
        if (!isSimpleRuleDefinition(def)) advancedFlags[idx] = true;
      });
      setAdvancedOpenByIndex(advancedFlags);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load matching rules.');
      setEditorStates([]);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const definitions = useMemo(
    () => editorStates.map((state) => editorStateToDefinition(state)),
    [editorStates],
  );

  const fetchPreview = useCallback(
    async (index, form) => {
      if (!applicationId || !String(form?.value || '').trim()) {
        setPreviewByIndex((prev) => ({ ...prev, [index]: null }));
        return;
      }
      setPreviewLoadingByIndex((prev) => ({ ...prev, [index]: true }));
      try {
        const res = await adAPI.previewGroupRuleMatches(applicationId, {
          rule: definitionFromSimpleForm(form),
        });
        setPreviewByIndex((prev) => ({
          ...prev,
          [index]: res.data?.data || null,
        }));
      } catch {
        setPreviewByIndex((prev) => ({ ...prev, [index]: { matchCount: 0, samples: [] } }));
      } finally {
        setPreviewLoadingByIndex((prev) => ({ ...prev, [index]: false }));
      }
    },
    [applicationId],
  );

  const schedulePreview = useCallback(
    (index, form) => {
      if (previewTimersRef.current[index]) {
        clearTimeout(previewTimersRef.current[index]);
      }
      previewTimersRef.current[index] = setTimeout(() => {
        fetchPreview(index, form);
      }, PREVIEW_DEBOUNCE_MS);
    },
    [fetchPreview],
  );

  useEffect(
    () => () => {
      Object.values(previewTimersRef.current).forEach(clearTimeout);
    },
    [],
  );

  const updateEditorState = (index, nextState) => {
    setEditorStates((prev) => prev.map((item, idx) => (idx === index ? nextState : item)));
  };

  const updateSimpleForm = (index, form) => {
    const current = editorStates[index] || createEmptyEditorState();
    const next = {
      ...current,
      mode: 'simple',
      simple: form,
    };
    updateEditorState(index, next);
    if (previewOpenByIndex[index]) {
      schedulePreview(index, form);
    }
  };

  const addRule = (seedForm = null) => {
    const simple = seedForm || createSimpleRuleForm();
    setEditorStates((prev) => [
      ...prev,
      { mode: 'simple', simple, advanced: createEmptyAdvancedRule() },
    ]);
  };

  const removeRule = (index) => {
    setEditorStates((prev) => prev.filter((_, idx) => idx !== index));
    setAdvancedOpenByIndex((prev) => {
      const next = {};
      Object.keys(prev).forEach((key) => {
        const k = Number(key);
        if (k < index) next[k] = prev[k];
        else if (k > index) next[k - 1] = prev[k];
      });
      return next;
    });
  };

  const toggleAdvanced = (index) => {
    const opening = !advancedOpenByIndex[index];
    setAdvancedOpenByIndex((prev) => ({ ...prev, [index]: opening }));
    if (opening) {
      const state = editorStates[index];
      if (state?.mode === 'simple') {
        updateEditorState(index, {
          mode: 'advanced',
          simple: state.simple,
          advanced: definitionFromSimpleForm(state.simple),
        });
      }
    } else {
      const state = editorStates[index];
      const def = state?.advanced || definitionFromSimpleForm(state?.simple);
      if (isSimpleRuleDefinition(def)) {
        updateEditorState(index, {
          mode: 'simple',
          simple: {
            appName: def.appName,
            fieldName: def.steps[0].fieldConditions[0].fieldName,
            operator: def.steps[0].fieldConditions[0].conditions[0].operator,
            value: def.steps[0].fieldConditions[0].conditions[0].value,
          },
          advanced: createEmptyAdvancedRule(),
        });
      }
    }
  };

  const persistRules = async () => {
    if (!applicationId) return false;

    const validationError = validateRuleDefinitions(definitions);
    if (validationError) {
      setError(validationError);
      return false;
    }

    setSaving(true);
    setError('');
    try {
      const apiDefinitions = getActiveRuleDefinitions(definitions).map(ruleDefinitionToApi);

      const nextAdConfig = {
        ...(connectionConfig?.ad || {}),
        suggestionGroupingMode: 'hybrid',
        suggestionRuleDefinitions: apiDefinitions,
      };

      await applicationAPI.update(applicationId, {
        connectionConfig: {
          ...(connectionConfig || {}),
          ad: nextAdConfig,
        },
      });

      setConnectionConfig((prev) => ({
        ...(prev || {}),
        ad: nextAdConfig,
      }));

      await adAPI.recomputeSuggestions(applicationId, {
        suggestionRuleDefinitions: apiDefinitions,
      });
      if (onRulesApplied) await onRulesApplied();
      return true;
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to save matching rules.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'stretch', sm: 'flex-start' }}
        justifyContent="space-between"
      >
        <Stack direction="row" spacing={0.5} alignItems="flex-start" sx={{ flex: 1, minWidth: 0 }}>
          <IconButton
            size="small"
            aria-label={sectionExpanded ? 'Collapse custom matching rules' : 'Expand custom matching rules'}
            aria-expanded={sectionExpanded}
            onClick={() => setSectionExpanded((prev) => !prev)}
            sx={{ mt: 0.25, flexShrink: 0 }}
          >
            <ExpandMore
              sx={{
                transform: sectionExpanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s',
              }}
            />
          </IconButton>
          <Box
            sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
            onClick={() => setSectionExpanded((prev) => !prev)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSectionExpanded((prev) => !prev);
              }
            }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
              Custom matching rules
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720 }}>
              Tell Wisibility how to recognize related AD groups. Each rule creates a suggested
              application from matching groups.
            </Typography>
          </Box>
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
        >
          <Button
            variant="outlined"
            size="small"
            startIcon={<Add />}
            onClick={() => {
              setSectionExpanded(true);
              addRule();
            }}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Add matching rule
          </Button>
          <Button
            variant="contained"
            size="small"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save />}
            disabled={saving}
            onClick={persistRules}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {saving ? 'Saving…' : 'Save rules'}
          </Button>
        </Stack>
      </Stack>

      <Collapse in={sectionExpanded} timeout="auto" unmountOnExit={false}>
        <Box sx={{ pt: 2 }}>
      {error ? (
        <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {!groupsAvailable ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Scan Active Directory first (above) so we can preview which groups match your rules.
        </Alert>
      ) : null}

      <Stack spacing={2} sx={{ mt: 2 }}>
        {editorStates.map((state, index) => {
          const showAdvanced = Boolean(advancedOpenByIndex[index]) || state.mode === 'advanced';
          return (
            <Box key={`rule-editor-${index}`}>
              {!showAdvanced ? (
                <AdSuggestionSimpleRuleCard
                  form={state.simple || createSimpleRuleForm()}
                  onChange={(form) => updateSimpleForm(index, form)}
                  onRemove={() => removeRule(index)}
                  canRemove={editorStates.length > 1 || Boolean(state.simple?.appName)}
                  preview={previewByIndex[index]}
                  previewLoading={previewLoadingByIndex[index]}
                  showPreview={Boolean(previewOpenByIndex[index])}
                  onTogglePreview={() => {
                    const next = !previewOpenByIndex[index];
                    setPreviewOpenByIndex((prev) => ({ ...prev, [index]: next }));
                    if (next) fetchPreview(index, state.simple);
                  }}
                />
              ) : (
                <AdSuggestionAdvancedRulesPanel
                  definition={state.advanced || createEmptyAdvancedRule()}
                  defIndex={index}
                  onChange={(advanced) =>
                    updateEditorState(index, { ...state, mode: 'advanced', advanced })
                  }
                  onRemove={() => removeRule(index)}
                  canRemove
                />
              )}

              <Button
                size="small"
                endIcon={
                  <ExpandMore
                    sx={{
                      transform: showAdvanced ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.2s',
                    }}
                  />
                }
                onClick={() => toggleAdvanced(index)}
                sx={{ mt: 1, textTransform: 'none', fontWeight: 600 }}
              >
                {showAdvanced ? 'Use simple matching' : 'Advanced matching options'}
              </Button>
            </Box>
          );
        })}
      </Stack>
        </Box>
      </Collapse>
      </CardContent>
    </Card>
  );
}
