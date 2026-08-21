/**
 * Shared search-field helpers for materialized hygiene findings.
 */

/**
 * @param {unknown} v
 * @returns {string}
 */
export function normalizeHygieneSearchField(v) {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}

/**
 * Build indexed search fields from a hygiene widget item payload.
 * @param {object} item
 * @returns {{
 *   searchText: string,
 *   searchDisplayName: string,
 *   searchEmail: string,
 *   searchAccount: string,
 *   searchEmployeeId: string,
 *   mismatchType: string|null,
 * }}
 */
export function buildHygieneFindingSearchFields(item) {
  const displayName = normalizeHygieneSearchField(
    item?.displayName ?? item?.name ?? item?.identityDisplayName,
  );
  const email = normalizeHygieneSearchField(item?.email ?? item?.identityEmail);
  const account = normalizeHygieneSearchField(
    item?.accountName ?? item?.username ?? item?.userId ?? item?.accountId,
  );
  const employeeId = normalizeHygieneSearchField(
    item?.employeeId ?? item?.identityEmployeeId,
  );
  const mismatchType =
    item?.mismatchType != null ? String(item.mismatchType) : null;

  const parts = [
    displayName,
    email,
    account,
    employeeId,
    mismatchType ? normalizeHygieneSearchField(mismatchType) : "",
    normalizeHygieneSearchField(item?.identityId),
    normalizeHygieneSearchField(item?.applicationName),
  ].filter(Boolean);

  return {
    searchText: parts.join(" ").slice(0, 2000),
    searchDisplayName: displayName,
    searchEmail: email,
    searchAccount: account,
    searchEmployeeId: employeeId,
    mismatchType,
  };
}
