/** Ensured palette items when backend catalog is stale or not yet redeployed. */
const ACTION_EXTRAS = [];

function mergeGroup(apiItems = [], extras = []) {
  const seen = new Set(apiItems.map((item) => item.label));
  return [...apiItems, ...extras.filter((item) => !seen.has(item.label))];
}

export function mergePaletteCatalog(catalog = {}) {
  return {
    ...catalog,
    actions: mergeGroup(catalog.actions, ACTION_EXTRAS),
  };
}
