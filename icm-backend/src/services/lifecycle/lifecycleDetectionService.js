/**
 * Before/after identity comparison → change set + lifecycle events.
 * Pure detection only — does not enqueue workflows or call connectors.
 *
 * P6 MOVER foundation:
 * - Explicit mover-sensitive attributes (not every tracked field)
 * - Case/whitespace-normalized comparison for human-entered strings
 * - Termination / REHIRE suppress MOVER
 */

import { createHash } from "crypto";

/** Snapshot allowlist (audit trail). Not all of these emit MOVER. */
const TRACKED_FIELDS = [
  "department",
  "location",
  "title",
  "manager",
  "managerId",
  "managerEmail",
  "managerEmployeeId",
  "email",
  "displayName",
  "firstName",
  "lastName",
  "phoneNumber",
  "lifecycleState",
  "isActive",
  "endDate",
  "startDate",
  "identityType",
  "employmentType",
  "employmentStatus",
  "costCenter",
  "division",
  "country",
  "role",
];

/**
 * Fields that can emit a primary MOVER when changed on an existing identity.
 * Includes org-structure and employment attributes available on identity/profile.
 */
export const MOVER_ATTRIBUTE_FIELDS = Object.freeze([
  "department",
  "location",
  "title",
  "manager",
  "managerId",
  "managerEmail",
  "managerEmployeeId",
  "costCenter",
  "division",
  "country",
  "role",
  "employmentType",
]);

const MOVER_SIGNAL_EVENTS = [
  "DEPARTMENT_CHANGED",
  "LOCATION_CHANGED",
  "TITLE_CHANGED",
  "MANAGER_CHANGED",
  "ROLE_CHANGED",
];

/** Attribute events that imply MOVER when present (classic signals). */
const MOVER_SIGNAL_EVENT_SET = new Set(MOVER_SIGNAL_EVENTS);
/** Human-entered string fields compared case-insensitively after trim. */
const CASE_INSENSITIVE_FIELDS = new Set([
  "department",
  "location",
  "title",
  "manager",
  "managerEmail",
  "managerEmployeeId",
  "role",
  "email",
  "displayName",
  "firstName",
  "lastName",
  "phoneNumber",
  "costCenter",
  "division",
  "country",
  "identityType",
  "employmentType",
  "employmentStatus",
]);

const TERMINATED_STATES = new Set(["TERMINATED", "LEAVER", "INACTIVE"]);
const ACTIVE_STATES = new Set(["ACTIVE", "NEW", "MOVER", "REHIRE"]);

const SECRET_KEYS =
  /password|passwd|secret|token|credential|apikey|api_key|privatekey|private_key|binddn|bindpassword/i;

function isObjectIdLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value._bsontype === "ObjectID" || typeof value.toHexString === "function"),
  );
}

/**
 * Normalize a value for equality comparison.
 * - null / undefined / blank string → ""
 * - Dates → ISO
 * - ObjectIds → string
 * - booleans → "true"/"false"
 * - case-insensitive fields → lowercased trim
 */
export function normalizeComparableValue(value, field = null) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (isObjectIdLike(value)) return String(value);
  const text = String(value).trim();
  if (text === "") return "";
  if (field && CASE_INSENSITIVE_FIELDS.has(field)) {
    return text.toLowerCase();
  }
  return text;
}

function norm(value, field = null) {
  return normalizeComparableValue(value, field);
}

function extractRole(identityLike = {}) {
  if (identityLike.role != null && String(identityLike.role).trim()) {
    return identityLike.role;
  }
  const attrs =
    identityLike.attributes && typeof identityLike.attributes === "object"
      ? identityLike.attributes
      : {};
  return (
    attrs.role ??
    attrs.jobRole ??
    attrs.jobCode ??
    attrs.employmentType ??
    null
  );
}

function extractEmploymentType(identityLike = {}) {
  if (identityLike.employmentType != null) return identityLike.employmentType;
  if (identityLike.identityType != null) return identityLike.identityType;
  const attrs =
    identityLike.attributes && typeof identityLike.attributes === "object"
      ? identityLike.attributes
      : {};
  return attrs.employmentType ?? attrs.empType ?? null;
}

function extractEmploymentStatus(identityLike = {}) {
  if (identityLike.employmentStatus != null) return identityLike.employmentStatus;
  const attrs =
    identityLike.attributes && typeof identityLike.attributes === "object"
      ? identityLike.attributes
      : {};
  return attrs.employmentStatus ?? attrs.empStatus ?? null;
}

/**
 * Allowlisted, secret-free snapshot for BEFORE/AFTER comparison + persistence.
 */
export function pickSnapshot(identityLike = {}) {
  if (!identityLike || typeof identityLike !== "object") return {};
  const out = {};
  for (const field of TRACKED_FIELDS) {
    if (field === "role") continue;
    if (field === "employmentType") continue;
    if (field === "employmentStatus") continue;
    if (Object.prototype.hasOwnProperty.call(identityLike, field)) {
      const v = identityLike[field];
      out[field] = v === undefined ? null : v;
    }
  }
  // Prefer mapped location; fall back to attributes.location
  if (out.location == null || out.location === "") {
    const attrs = identityLike.attributes;
    if (attrs && typeof attrs === "object" && attrs.location != null) {
      out.location = attrs.location;
    }
  }
  const role = extractRole(identityLike);
  if (role != null && String(role).trim()) out.role = role;
  const employmentType = extractEmploymentType(identityLike);
  if (employmentType != null && String(employmentType).trim()) {
    out.employmentType = employmentType;
  }
  const employmentStatus = extractEmploymentStatus(identityLike);
  if (employmentStatus != null && String(employmentStatus).trim()) {
    out.employmentStatus = employmentStatus;
  }
  for (const k of Object.keys(out)) {
    if (SECRET_KEYS.test(k)) delete out[k];
  }
  return out;
}

function fieldChanged(before, after, field) {
  return norm(before?.[field], field) !== norm(after?.[field], field);
}

/**
 * Pure attribute change detector for configured fields.
 * Returns original (sanitized) before/after values, not normalized forms.
 *
 * @returns {{ attribute: string, before: any, after: any }[]}
 */
export function detectLifecycleAttributeChanges(
  before,
  after,
  configuredAttributes = MOVER_ATTRIBUTE_FIELDS,
) {
  const prev = before ? pickSnapshot(before) : {};
  const next = pickSnapshot(after || {});
  const attrs = configuredAttributes?.length
    ? configuredAttributes
    : MOVER_ATTRIBUTE_FIELDS;
  const out = [];
  for (const attribute of attrs) {
    if (!fieldChanged(prev, next, attribute)) continue;
    out.push({
      attribute,
      before: prev?.[attribute] ?? null,
      after: next?.[attribute] ?? null,
    });
  }
  return out;
}

function isTerminationState(state) {
  return TERMINATED_STATES.has(String(state || "").toUpperCase());
}

function isActiveLikeState(state) {
  return ACTIVE_STATES.has(String(state || "").toUpperCase());
}

function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function deriveLifecycleType(eventType, lifecycleEvents = []) {
  if (["JOINER", "MOVER", "LEAVER", "REHIRE"].includes(eventType)) return eventType;
  if (eventType === "IDENTITY_CREATED") return "JOINER";
  if (eventType === "TERMINATION_EFFECTIVE") return "LEAVER";
  if (eventType === "TERMINATION_SCHEDULED") return "NONE";
  if (MOVER_SIGNAL_EVENTS.includes(eventType)) return "MOVER";
  if (lifecycleEvents.includes("REHIRE")) return "REHIRE";
  if (lifecycleEvents.includes("LEAVER")) return "LEAVER";
  if (lifecycleEvents.includes("MOVER")) return "MOVER";
  if (lifecycleEvents.includes("JOINER")) return "JOINER";
  return "NONE";
}

/**
 * Compare previous vs current identity documents.
 */
export function detectIdentityLifecycleChanges(before, after) {
  const previousState = before ? pickSnapshot(before) : null;
  const newState = pickSnapshot(after || {});
  const changes = [];

  if (!before) {
    const attributeEvents = ["IDENTITY_CREATED"];
    const lifecycleEvents = ["JOINER"];
    return {
      changed: true,
      changes: [{ field: "_created", before: null, after: true }],
      changedAttributes: [],
      attributeEvents,
      lifecycleEvents,
      previousState: null,
      newState,
      effectiveDate: parseDate(after?.startDate) || new Date(),
      lifecycleTypeByEvent: {
        IDENTITY_CREATED: "JOINER",
        JOINER: "JOINER",
      },
    };
  }

  const fieldsToCompare = new Set([
    ...Object.keys(previousState || {}),
    ...Object.keys(newState || {}),
  ]);

  for (const field of fieldsToCompare) {
    if (fieldChanged(previousState, newState, field)) {
      changes.push({
        field,
        before: previousState?.[field] ?? null,
        after: newState?.[field] ?? null,
      });
    }
  }

  const changedAttributes = detectLifecycleAttributeChanges(
    previousState,
    newState,
    MOVER_ATTRIBUTE_FIELDS,
  );

  if (!changes.length) {
    return {
      changed: false,
      changes: [],
      changedAttributes: [],
      attributeEvents: [],
      lifecycleEvents: [],
      previousState,
      newState,
      effectiveDate: null,
      lifecycleTypeByEvent: {},
    };
  }

  const attributeEvents = [];
  if (fieldChanged(previousState, newState, "department")) {
    attributeEvents.push("DEPARTMENT_CHANGED");
  }
  if (fieldChanged(previousState, newState, "location")) {
    attributeEvents.push("LOCATION_CHANGED");
  }
  if (fieldChanged(previousState, newState, "title")) {
    attributeEvents.push("TITLE_CHANGED");
  }
  if (
    fieldChanged(previousState, newState, "manager") ||
    fieldChanged(previousState, newState, "managerId") ||
    fieldChanged(previousState, newState, "managerEmail") ||
    fieldChanged(previousState, newState, "managerEmployeeId")
  ) {
    attributeEvents.push("MANAGER_CHANGED");
  }
  if (fieldChanged(previousState, newState, "role")) {
    attributeEvents.push("ROLE_CHANGED");
  }

  const genericAttrChange = changes.some((c) =>
    [
      "email",
      "displayName",
      "firstName",
      "lastName",
      "phoneNumber",
      "identityType",
      "employmentStatus",
    ].includes(c.field),
  );
  // costCenter/division/country/employmentType are MOVER allowlist fields;
  // still mark IDENTITY_UPDATED when they (or classic signals) change.
  if (genericAttrChange || attributeEvents.length || changedAttributes.length) {
    if (!attributeEvents.includes("IDENTITY_UPDATED")) {
      attributeEvents.unshift("IDENTITY_UPDATED");
    }
  }

  const lifecycleEvents = [];
  const beforeLife = String(previousState?.lifecycleState || "").toUpperCase();
  const afterLife = String(newState?.lifecycleState || "").toUpperCase();
  const beforeEnd = parseDate(previousState?.endDate);
  const afterEnd = parseDate(newState?.endDate);
  const now = Date.now();

  // Rehire: inactive/terminated → active-like
  if (
    (isTerminationState(beforeLife) || previousState?.isActive === false) &&
    (isActiveLikeState(afterLife) || newState?.isActive === true) &&
    !isTerminationState(afterLife)
  ) {
    lifecycleEvents.push("REHIRE");
  }

  const becameTerminated =
    (!isTerminationState(beforeLife) &&
      (afterLife === "TERMINATED" || afterLife === "INACTIVE")) ||
    (previousState?.isActive !== false && newState?.isActive === false);

  const endDateChanged =
    (afterEnd && !beforeEnd) ||
    (afterEnd && beforeEnd && afterEnd.getTime() !== beforeEnd.getTime());
  const isFutureEnd = afterEnd && afterEnd.getTime() > now + 60_000;
  const isPastOrDueEnd = afterEnd && afterEnd.getTime() <= now + 60_000;

  if (becameTerminated || isPastOrDueEnd) {
    attributeEvents.push("TERMINATION_EFFECTIVE");
    lifecycleEvents.push("LEAVER");
  } else if (
    isFutureEnd &&
    (endDateChanged || afterLife === "LEAVER") &&
    newState?.isActive !== false
  ) {
    attributeEvents.push("TERMINATION_SCHEDULED");
  }

  // MOVER when any allowlisted attribute changed (classic events or org fields).
  const hasMoverSignal =
    changedAttributes.length > 0 ||
    attributeEvents.some((e) => MOVER_SIGNAL_EVENT_SET.has(e));
  const hasTerminationSignal =
    lifecycleEvents.includes("LEAVER") ||
    attributeEvents.includes("TERMINATION_EFFECTIVE") ||
    attributeEvents.includes("TERMINATION_SCHEDULED");
  const stillActive =
    !lifecycleEvents.includes("LEAVER") &&
    !isTerminationState(afterLife) &&
    newState?.isActive !== false;

  // Any termination signal (including future scheduled) suppresses MOVER.
  // REHIRE also suppresses MOVER on the same transition.
  if (
    hasMoverSignal &&
    stillActive &&
    !lifecycleEvents.includes("REHIRE") &&
    !hasTerminationSignal
  ) {
    lifecycleEvents.push("MOVER");
  }

  const uniqueAttr = [...new Set(attributeEvents)];
  const uniqueLife = [...new Set(lifecycleEvents)];
  const lifecycleTypeByEvent = {};
  for (const et of [...uniqueAttr, ...uniqueLife]) {
    lifecycleTypeByEvent[et] = deriveLifecycleType(et, uniqueLife);
  }

  return {
    changed: true,
    changes,
    changedAttributes,
    attributeEvents: uniqueAttr,
    lifecycleEvents: uniqueLife,
    previousState,
    newState,
    effectiveDate: parseDate(afterEnd) || parseDate(after?.startDate) || new Date(),
    lifecycleTypeByEvent,
  };
}

/**
 * Sync-scoped idempotency: same sync+identity+eventType reuses;
 * a later syncJobId can recreate after prior completion.
 */
export function buildLifecycleIdempotencyKey({
  tenantId,
  identityId,
  eventType,
  syncJobId,
  changeFingerprint,
}) {
  const sync = syncJobId || "nosync";
  const fp = changeFingerprint ? `:${changeFingerprint.slice(0, 32)}` : "";
  return `lc:${tenantId}:${identityId}:${eventType}:${sync}${fp}`;
}

/**
 * Stable hash of a change set (for same-sync collision disambiguation).
 * Uses the same normalization as field comparison.
 */
export function fingerprintChanges(changes = []) {
  const raw = changes
    .map((c) => {
      const field = c.field || c.attribute;
      return `${field}:${norm(c.before, field)}=>${norm(c.after, field)}`;
    })
    .sort()
    .join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

export { TRACKED_FIELDS, MOVER_SIGNAL_EVENTS, deriveLifecycleType };
