import { getDefaultConfig, getStepDefinition } from "../config/stepConfigCatalog.js";

export function getPresetConfig(stepType, presetId) {
  const def = getStepDefinition(stepType);
  const preset = def?.presets?.find((p) => p.id === presetId);
  if (preset?.config) return JSON.parse(JSON.stringify(preset.config));
  return getDefaultConfig(stepType);
}

export function resolveStepConfig(pathStep, nodes) {
  let config = pathStep.presetId
    ? getPresetConfig(pathStep.stepType, pathStep.presetId)
    : getDefaultConfig(pathStep.stepType);

  if (typeof pathStep.configResolver === "function") {
    config = { ...config, ...pathStep.configResolver(nodes) };
  }
  if (pathStep.config) {
    config = { ...config, ...pathStep.config };
  }
  if (pathStep.configPatch) {
    config = { ...config, ...pathStep.configPatch };
  }
  return config;
}
