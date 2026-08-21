export const AD_GROUP_FIELDS = [
  { fieldName: 'groupName', label: 'Group Name' },
  { fieldName: 'description', label: 'Description' },
  { fieldName: 'dn', label: 'Distinguished Name (DN)' },
];

export const AD_RULE_OPERATORS = [
  { value: 'contains', label: 'Contains' },
  { value: 'equals', label: 'Equals' },
  { value: 'startsWith', label: 'Starts With' },
  { value: 'endsWith', label: 'Ends With' },
];

export const createDefaultCondition = () => ({
  operator: 'contains',
  value: '',
  caseSensitive: false,
});

export const createDefaultFieldCondition = () => ({
  fieldName: 'groupName',
  conditionLogic: 'OR',
  conditions: [createDefaultCondition()],
});

export const createDefaultStep = () => ({
  fieldLogic: 'OR',
  fieldConditions: [createDefaultFieldCondition()],
});

export const createDefaultRuleDefinition = () => ({
  appName: '',
  stepLogic: 'OR',
  steps: [createDefaultStep()],
});

export function ruleDefinitionToApi(definition) {
  const appName = String(definition?.appName || '').trim();
  const steps = Array.isArray(definition?.steps) ? definition.steps : [];

  return {
    appName,
    ruleSet: {
      stepLogic: String(definition?.stepLogic || 'OR').toUpperCase(),
      steps: steps.map((step) => ({
        fieldLogic: String(step?.fieldLogic || 'OR').toUpperCase(),
        fields: (step?.fieldConditions || []).map((field) => ({
          fieldName: String(field?.fieldName || '').trim(),
          fieldLogic: String(field?.conditionLogic || 'OR').toUpperCase(),
          conditions: (field?.conditions || [])
            .map((condition) => ({
              operator: String(condition?.operator || 'contains'),
              value: String(condition?.value ?? ''),
              caseSensitive: Boolean(condition?.caseSensitive),
            }))
            .filter((condition) => condition.value),
        })),
      })),
    },
  };
}

export function ruleDefinitionFromApi(apiDefinition) {
  const ruleSet = apiDefinition?.ruleSet || {};
  const steps = Array.isArray(ruleSet.steps) ? ruleSet.steps : [];

  return {
    appName: String(apiDefinition?.appName || '').trim(),
    stepLogic: String(ruleSet.stepLogic || 'OR').toUpperCase(),
    steps: steps.length
      ? steps.map((step) => ({
          fieldLogic: String(step?.fieldLogic || 'OR').toUpperCase(),
          fieldConditions: (step?.fields || step?.fieldConditions || []).map(
            (field) => ({
              fieldName: String(field?.fieldName || field?.field || 'groupName'),
              conditionLogic: String(
                field?.fieldLogic || field?.conditionLogic || 'OR',
              ).toUpperCase(),
              conditions: (field?.conditions || []).length
                ? field.conditions.map((condition) => ({
                    operator: condition?.operator || 'contains',
                    value: String(condition?.value ?? ''),
                    caseSensitive: Boolean(condition?.caseSensitive),
                  }))
                : [createDefaultCondition()],
            }),
          ),
        }))
      : [createDefaultStep()],
  };
}

function ruleDefinitionHasContent(definition) {
  if (String(definition?.appName || '').trim()) return true;
  return (definition?.steps || []).some((step) =>
    (step?.fieldConditions || []).some((field) =>
      String(field?.fieldName || '').trim() ||
      (field?.conditions || []).some((condition) =>
        String(condition?.value || '').trim(),
      ),
    ),
  );
}

export function validateRuleDefinitions(definitions) {
  const activeDefinitions = (definitions || []).filter(ruleDefinitionHasContent);
  if (!activeDefinitions.length) {
    return '';
  }

  const names = new Set();
  for (let index = 0; index < activeDefinitions.length; index += 1) {
    const definition = activeDefinitions[index];
    const appName = String(definition?.appName || '').trim();
    if (!appName) {
      return `Application name is required for custom rule ${index + 1}.`;
    }
    const key = appName.toLowerCase();
    if (names.has(key)) {
      return `Duplicate application name in rules: ${appName}`;
    }
    names.add(key);

    const hasCondition = (definition.steps || []).some((step) =>
      (step.fieldConditions || []).some(
        (field) =>
          String(field.fieldName || '').trim() &&
          (field.conditions || []).some((condition) =>
            String(condition?.value || '').trim(),
          ),
      ),
    );
    if (!hasCondition) {
      return `Rule "${appName}" must include at least one field with a condition value.`;
    }
  }

  return '';
}

export function getActiveRuleDefinitions(definitions) {
  return (definitions || [])
    .filter(ruleDefinitionHasContent)
    .filter((definition) => String(definition?.appName || '').trim());
}

/** True when rule is a single field + single condition (default simple mode). */
export function isSimpleRuleDefinition(definition) {
  const steps = definition?.steps || [];
  if (steps.length !== 1) return false;
  const step = steps[0];
  if (String(definition?.stepLogic || 'OR').toUpperCase() === 'AND') return false;
  if (String(step?.fieldLogic || 'OR').toUpperCase() === 'AND') return false;

  const fields = step?.fieldConditions || [];
  if (fields.length !== 1) return false;
  const field = fields[0];
  if (String(field?.conditionLogic || 'OR').toUpperCase() === 'AND') return false;

  const conditions = (field?.conditions || []).filter((c) =>
    String(c?.value || '').trim(),
  );
  return conditions.length === 1;
}

export function simpleFormFromDefinition(definition) {
  if (!definition) return createSimpleRuleForm();
  if (!isSimpleRuleDefinition(definition)) {
    return {
      ...createSimpleRuleForm(),
      appName: String(definition?.appName || '').trim(),
      _isAdvanced: true,
    };
  }
  const field = definition.steps[0].fieldConditions[0];
  const condition = field.conditions.find((c) => String(c?.value || '').trim()) || field.conditions[0];
  return {
    appName: String(definition?.appName || '').trim(),
    fieldName: String(field?.fieldName || 'groupName').trim() || 'groupName',
    operator: condition?.operator || 'contains',
    value: String(condition?.value ?? ''),
    _isAdvanced: false,
  };
}

export function createSimpleRuleForm(overrides = {}) {
  return {
    appName: '',
    fieldName: 'groupName',
    operator: 'contains',
    value: '',
    _isAdvanced: false,
    ...overrides,
  };
}

export function definitionFromSimpleForm(form) {
  const appName = String(form?.appName || '').trim();
  const fieldName = String(form?.fieldName || 'groupName').trim() || 'groupName';
  const operator = String(form?.operator || 'contains').trim() || 'contains';
  const value = String(form?.value ?? '');

  return {
    appName,
    stepLogic: 'OR',
    steps: [
      {
        fieldLogic: 'OR',
        fieldConditions: [
          {
            fieldName,
            conditionLogic: 'OR',
            conditions: [
              {
                operator,
                value,
                caseSensitive: false,
              },
            ],
          },
        ],
      },
    ],
  };
}

export function definitionToEditorState(definition) {
  if (!definition || !ruleDefinitionHasContent(definition)) {
    return { mode: 'simple', simple: createSimpleRuleForm(), advanced: createDefaultRuleDefinition() };
  }
  if (isSimpleRuleDefinition(definition)) {
    return {
      mode: 'simple',
      simple: simpleFormFromDefinition(definition),
      advanced: createDefaultRuleDefinition(),
    };
  }
  return {
    mode: 'advanced',
    simple: simpleFormFromDefinition(definition),
    advanced: definition,
  };
}

export function editorStateToDefinition(state) {
  if (state?.mode === 'advanced') {
    return state.advanced || createDefaultRuleDefinition();
  }
  return definitionFromSimpleForm(state?.simple || createSimpleRuleForm());
}

/**
 * Suggested simple rules from auto-detected prefix clusters (for one-click accept).
 * @param {Array<{ appName?: string, suggestionSource?: string, groups?: Array<{ name?: string }> }>} suggestions
 */
export function buildSuggestedRulesFromPrefixClusters(suggestions) {
  const seen = new Set();
  const out = [];

  for (const suggestion of suggestions || []) {
    const source = String(suggestion?.suggestionSource || 'prefix').toLowerCase();
    if (source === 'custom') continue;

    const appName = String(suggestion?.appName || '').trim();
    if (!appName) continue;
    const key = appName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const sampleName = String(
      suggestion?.groups?.[0]?.name || suggestion?.groups?.[0]?.groupName || '',
    ).trim();
    let operator = 'contains';
    let value = appName;
    const upperSample = sampleName.toUpperCase();
    const upperApp = appName.toUpperCase();

    if (upperSample.startsWith(`GRP_${upperApp}_`)) {
      operator = 'startsWith';
      value = `GRP_${appName}_`;
    } else if (upperSample.startsWith(`${upperApp}_`)) {
      operator = 'startsWith';
      value = `${appName}_`;
    }

    const fieldLabel = AD_GROUP_FIELDS.find((f) => f.fieldName === 'groupName')?.label || 'Group Name';
    const opLabel =
      AD_RULE_OPERATORS.find((o) => o.value === operator)?.label?.toLowerCase() || operator;

    out.push({
      appName,
      fieldName: 'groupName',
      operator,
      value,
      summary: `Match ${fieldLabel.toLowerCase()} ${opLabel} “${value}”`,
      groupCount: Number(suggestion?.groupCount) || 0,
    });
  }

  return out.slice(0, 12);
}
