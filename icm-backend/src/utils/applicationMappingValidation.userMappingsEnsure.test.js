/**
 * Regression: One-step Import and Map & Import must expose identical userMappings
 * metadata so Identity Profile Mapping Attribute dropdown options match.
 */
import {
  buildUserMappingsFromDetectedHeaders,
  ensureUserMappingsFromCompleteSchema,
  mergeUserMappingsPreserveExisting,
  validateUserMappings,
} from "./applicationMappingValidation.js";

/** Mirrors IdentityProfileMappingTab.attributeOptionsFor primary branch. */
function attributeOptionsFromUserMappings(userMappings) {
  const systemFields = (userMappings || [])
    .map((m) => String(m.standardField || "").trim())
    .filter(Boolean);
  return [...new Set(systemFields)].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

const SAMPLE_CSV_HEADERS = [
  "user_id",
  "email",
  "display_name",
  "status",
  "department",
  "title",
  "manager_id",
  "telephone",
  "member_of_entitlements",
];

/** Reduced Map & import modal payload (PK + required + a few optionals). */
const REDUCED_IMPORT_MAPPINGS = [
  {
    csvColumn: "user_id",
    standardField: "user_id",
    dataType: "String",
    isPrimaryKey: true,
    displayName: "User Id",
  },
  {
    csvColumn: "display_name",
    standardField: "display_name",
    dataType: "String",
    isPrimaryKey: false,
    displayName: "Display Name",
  },
  {
    csvColumn: "status",
    standardField: "status",
    dataType: "String",
    isPrimaryKey: false,
    displayName: "Status",
  },
  {
    csvColumn: "department",
    standardField: "department",
    dataType: "String",
    isPrimaryKey: false,
    displayName: "Department",
  },
];

describe("buildUserMappingsFromDetectedHeaders", () => {
  test("builds One-step-shaped schema: standardField equals each CSV header", () => {
    const schema = buildUserMappingsFromDetectedHeaders(SAMPLE_CSV_HEADERS);
    expect(schema).toHaveLength(SAMPLE_CSV_HEADERS.length);
    expect(schema.map((m) => m.standardField)).toEqual(SAMPLE_CSV_HEADERS);
    expect(schema.filter((m) => m.isPrimaryKey)).toHaveLength(1);
    expect(schema.find((m) => m.isPrimaryKey).standardField).toBe("user_id");
  });
});

describe("ensureUserMappingsFromCompleteSchema", () => {
  test("when empty, populates from complete detected schema (Map & Import guarantee)", () => {
    const complete = buildUserMappingsFromDetectedHeaders(SAMPLE_CSV_HEADERS);
    const result = ensureUserMappingsFromCompleteSchema([], complete);
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.userMappings.map((m) => m.standardField)).toEqual(SAMPLE_CSV_HEADERS);
  });

  test("does not overwrite existing metadata with reduced/partial field list", () => {
    const existing = buildUserMappingsFromDetectedHeaders(SAMPLE_CSV_HEADERS);
    const result = ensureUserMappingsFromCompleteSchema(existing, REDUCED_IMPORT_MAPPINGS);
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.userMappings.map((m) => m.standardField)).toEqual(SAMPLE_CSV_HEADERS);
  });

  test("merges missing attributes into existing without dropping prior fields", () => {
    const existing = buildUserMappingsFromDetectedHeaders(["user_id", "email", "status"]);
    const complete = buildUserMappingsFromDetectedHeaders(SAMPLE_CSV_HEADERS);
    const result = ensureUserMappingsFromCompleteSchema(existing, complete);
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    const fields = result.userMappings.map((m) => m.standardField);
    expect(fields).toEqual(expect.arrayContaining(SAMPLE_CSV_HEADERS));
    expect(fields).toHaveLength(SAMPLE_CSV_HEADERS.length);
    expect(result.userMappings.filter((m) => m.isPrimaryKey)).toHaveLength(1);
  });
});

describe("One-step Import vs Map & Import — identical Attribute dropdown options", () => {
  test("both flows produce the same userMappings standardField set and Attribute options", () => {
    // --- Simulate One-step Import: PUT full CSV schema as userMappings ---
    const oneStepDraft = buildUserMappingsFromDetectedHeaders(SAMPLE_CSV_HEADERS);
    const oneStepValidated = validateUserMappings(oneStepDraft);
    expect(oneStepValidated.ok).toBe(true);
    const oneStepUserMappings = oneStepValidated.normalized;

    // One-step then saves reduced csvImportMapping separately (does not replace userMappings).
    const oneStepImportMapping = validateUserMappings(REDUCED_IMPORT_MAPPINGS);
    expect(oneStepImportMapping.ok).toBe(true);

    // --- Simulate Map & Import without prior PUT (backend-only guarantee path) ---
    // saveCsvImportMapping receives reduced mappings + complete detectedHeaders / schemaMappings.
    let mapImportUserMappings = [];
    const mapImportComplete = buildUserMappingsFromDetectedHeaders(SAMPLE_CSV_HEADERS, {
      primaryKey: "user_id",
    });
    const afterSaveMapping = ensureUserMappingsFromCompleteSchema(
      mapImportUserMappings,
      mapImportComplete,
    );
    expect(afterSaveMapping.ok).toBe(true);
    mapImportUserMappings = afterSaveMapping.userMappings;

    // uploadApplicationUsersCsvMapped also ensures from CSV headers (idempotent here).
    const afterMappedUpload = ensureUserMappingsFromCompleteSchema(
      mapImportUserMappings,
      buildUserMappingsFromDetectedHeaders(SAMPLE_CSV_HEADERS),
    );
    expect(afterMappedUpload.ok).toBe(true);
    mapImportUserMappings = afterMappedUpload.userMappings;

    // --- Map & Import frontend path: persist full schema first (same as One-step payload) ---
    const mapImportFrontendPut = validateUserMappings(
      buildUserMappingsFromDetectedHeaders(SAMPLE_CSV_HEADERS),
    );
    expect(mapImportFrontendPut.ok).toBe(true);

    const oneStepFields = oneStepUserMappings.map((m) => m.standardField).sort();
    const mapImportBackendFields = mapImportUserMappings.map((m) => m.standardField).sort();
    const mapImportFrontendFields = mapImportFrontendPut.normalized
      .map((m) => m.standardField)
      .sort();

    expect(mapImportBackendFields).toEqual(oneStepFields);
    expect(mapImportFrontendFields).toEqual(oneStepFields);

    const oneStepOptions = attributeOptionsFromUserMappings(oneStepUserMappings);
    const mapImportOptions = attributeOptionsFromUserMappings(mapImportUserMappings);
    const mapImportFrontendOptions = attributeOptionsFromUserMappings(
      mapImportFrontendPut.normalized,
    );

    expect(mapImportOptions).toEqual(oneStepOptions);
    expect(mapImportFrontendOptions).toEqual(oneStepOptions);
    expect(oneStepOptions).toEqual([...SAMPLE_CSV_HEADERS].sort((a, b) => a.localeCompare(b)));
  });

  test("reduced import mappings alone must not become the Attribute source when complete schema exists", () => {
    const complete = buildUserMappingsFromDetectedHeaders(SAMPLE_CSV_HEADERS);
    const after = ensureUserMappingsFromCompleteSchema(complete, REDUCED_IMPORT_MAPPINGS);
    const options = attributeOptionsFromUserMappings(after.userMappings);
    // Must still include columns that are NOT in the reduced mapping (e.g. telephone).
    expect(options).toContain("telephone");
    expect(options).toContain("member_of_entitlements");
    expect(options.length).toBe(SAMPLE_CSV_HEADERS.length);
  });
});

describe("mergeUserMappingsPreserveExisting", () => {
  test("keeps existing PK when merging additional fields", () => {
    const existing = [
      {
        csvColumn: "user_id",
        standardField: "user_id",
        dataType: "String",
        isPrimaryKey: true,
      },
      {
        csvColumn: "email",
        standardField: "email",
        dataType: "String",
        isPrimaryKey: false,
      },
    ];
    const incoming = buildUserMappingsFromDetectedHeaders(["user_id", "email", "status"]);
    const merged = mergeUserMappingsPreserveExisting(existing, incoming);
    expect(merged.filter((m) => m.isPrimaryKey)).toHaveLength(1);
    expect(merged.find((m) => m.isPrimaryKey).standardField).toBe("user_id");
    expect(merged.map((m) => m.standardField)).toEqual(
      expect.arrayContaining(["user_id", "email", "status"]),
    );
  });
});
