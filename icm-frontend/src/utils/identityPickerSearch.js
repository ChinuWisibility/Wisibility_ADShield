/** Primary identity fields used for user-picker search (name, login, email — not manager/department). */

function pickerFields(identity) {
  const attrs = identity?.attributes || {};
  return [
    identity?.displayName,
    identity?.firstName,
    identity?.lastName,
    identity?.email,
    identity?.employeeId,
    attrs.userName,
    attrs.username,
    attrs.user_name,
    attrs.uid,
    attrs.login,
    attrs.user_login,
    attrs.samAccountName,
    attrs.sAMAccountName,
    attrs.userPrincipalName,
    attrs.gh_login,
    [identity?.firstName, identity?.lastName].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .map((s) => String(s).trim().toLowerCase());
}

/** Keep rows where every query word appears in a primary identity field. */
export function identityMatchesPickerQuery(identity, rawQuery) {
  const words = String(rawQuery || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return false;

  const fields = pickerFields(identity);
  return words.every((word) => fields.some((field) => field.includes(word)));
}

function pickerMatchScore(identity, rawQuery) {
  const words = String(rawQuery || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const last = String(identity?.lastName || '').toLowerCase();
  const first = String(identity?.firstName || '').toLowerCase();
  const display = String(identity?.displayName || '').toLowerCase();
  const email = String(identity?.email || '').toLowerCase();

  let score = 0;
  for (const word of words) {
    if (last === word) score += 100;
    else if (last.startsWith(word)) score += 80;
    else if (display === word) score += 70;
    else if (display.startsWith(word)) score += 60;
    else if (first === word) score += 55;
    else if (first.startsWith(word)) score += 50;
    else if (email.startsWith(word)) score += 45;
    else if (email.includes(word)) score += 35;
    else if (display.includes(word)) score += 25;
    else score += 10;
  }
  return score;
}

/** Drop manager/attribute false positives; sort best name matches first (or A–Z when browsing). */
export function identityPickerSortLabel(identity) {
  return (
    identity?.displayName ||
    [identity?.firstName, identity?.lastName].filter(Boolean).join(' ') ||
    identity?.email ||
    ''
  )
    .trim()
    .toLowerCase();
}

function dedupeIdentityPickerRows(rows) {
  const deduped = [];
  const seen = new Set();
  for (const row of rows || []) {
    const id = String(row?._id || row?.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push(row);
  }
  return deduped;
}

export function sortIdentitiesAlphabetically(rows) {
  return dedupeIdentityPickerRows(rows).sort((a, b) =>
    identityPickerSortLabel(a).localeCompare(identityPickerSortLabel(b), undefined, { sensitivity: 'base' }),
  );
}

export function refineIdentityPickerResults(rows, query) {
  const deduped = dedupeIdentityPickerRows(rows);
  const q = String(query || '').trim();
  if (!q) return sortIdentitiesAlphabetically(deduped);

  return deduped
    .filter((row) => identityMatchesPickerQuery(row, query))
    .sort((a, b) => pickerMatchScore(b, query) - pickerMatchScore(a, query));
}

export const IDENTITY_PICKER_MIN_SEARCH_LEN = 2;
