import {
  buildEntitlementCatalog,
  countActiveInactive,
  getCompareFieldNames,
  valuesEqual,
} from "./reconciliationAccountUtils.js";

/**
 * Compare current upload vs immediate previous snapshot only.
 *
 * @param {{
 *   currentMap: Map<string, object>,
 *   previousMap: Map<string, object>,
 *   userMappings: object[],
 *   reconciliationConfig?: object,
 * }} params
 */
export function compareAccountMaps({
  currentMap,
  previousMap,
  userMappings,
  reconciliationConfig = {},
}) {
  const compareFields = getCompareFieldNames(
    userMappings,
    reconciliationConfig.compareFieldsMode || "userMappings",
  );
  const changedAt = new Date();

  const userDeltas = [];
  const removedKeys = [];
  let newUsers = 0;
  let updatedUsers = 0;
  let removedUsers = 0;

  for (const [identityKey, current] of currentMap) {
    const previous = previousMap.get(identityKey);
    if (!previous) {
      newUsers += 1;
      userDeltas.push({
        identityKey,
        changeType: "NEW_USER",
        attributeChanges: [],
        entitlementChanges: [...current.entitlements].map((e) => ({
          entitlementName: e,
          changeType: "ADDED",
        })),
        changedAt,
      });
      continue;
    }

    const attributeChanges = [];
    for (const attr of compareFields) {
      if (!valuesEqual(attr, current.attributes[attr], previous.attributes[attr])) {
        attributeChanges.push({
          attribute: attr,
          oldValue: previous.attributes[attr] ?? null,
          newValue: current.attributes[attr] ?? null,
        });
      }
    }

    const entitlementChanges = [];
    for (const e of current.entitlements) {
      if (!previous.entitlements.has(e)) {
        entitlementChanges.push({ entitlementName: e, changeType: "ADDED" });
      }
    }
    for (const e of previous.entitlements) {
      if (!current.entitlements.has(e)) {
        entitlementChanges.push({ entitlementName: e, changeType: "REMOVED" });
      }
    }

    if (attributeChanges.length || entitlementChanges.length) {
      updatedUsers += 1;
      userDeltas.push({
        identityKey,
        changeType: "UPDATED",
        attributeChanges,
        entitlementChanges,
        changedAt,
      });
    }
  }

  for (const identityKey of previousMap.keys()) {
    if (!currentMap.has(identityKey)) {
      removedUsers += 1;
      removedKeys.push(identityKey);
      const previous = previousMap.get(identityKey);
      userDeltas.push({
        identityKey,
        changeType: "REMOVED_USER",
        attributeChanges: [],
        entitlementChanges: [...(previous.entitlements || [])].map((e) => ({
          entitlementName: e,
          changeType: "REMOVED",
        })),
        changedAt,
      });
    }
  }

  const catalogCurrent = buildEntitlementCatalog(currentMap);
  const catalogPrevious = buildEntitlementCatalog(previousMap);
  const entitlementDeltas = [];
  let newEntitlements = 0;
  let removedEntitlements = 0;

  for (const e of catalogCurrent) {
    if (!catalogPrevious.has(e)) {
      newEntitlements += 1;
      entitlementDeltas.push({
        entitlementName: e,
        changeType: "NEW_ENTITLEMENT",
        changedAt,
      });
    }
  }
  for (const e of catalogPrevious) {
    if (!catalogCurrent.has(e)) {
      removedEntitlements += 1;
      entitlementDeltas.push({
        entitlementName: e,
        changeType: "REMOVED_ENTITLEMENT",
        changedAt,
      });
    }
  }

  const { active, inactive } = countActiveInactive(
    currentMap,
    reconciliationConfig.inactiveStatusValues,
  );

  return {
    userDeltas,
    entitlementDeltas,
    removedKeys,
    summary: {
      totalUsers: currentMap.size,
      activeUsers: active,
      inactiveUsers: inactive,
      newUsers,
      updatedUsers,
      removedUsers,
      newEntitlements,
      removedEntitlements,
    },
  };
}
