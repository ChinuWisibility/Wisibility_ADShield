/**
 * App Registry may store Delimited File as generic catalog code (CONNECTOR_DELIMITEDFILE)
 * or HR-specific (HRMS_DELIMITED_FILE). Both participate in identity profile + HRMS CSV flows.
 */
export function connectorTypeImpliesHrmsDelimited(connectorType) {
  if (!connectorType) return false;
  const u = String(connectorType).toUpperCase();
  if (u === "HRMS_DELIMITED_FILE" || u === "HRMS_ORANGEHRM") return true;
  if (u === "CONNECTOR_DELIMITEDFILE" || u === "DELIMITEDFILE") return true;
  return false;
}

/**
 * When `hrms.connector` is missing, infer delimited CSV mode from catalog `connectorType` only.
 * Excludes OrangeHRM — those use OAuth, not CSV preview rows.
 */
export function inferDelimitedFileConnector(connectorType) {
  if (!connectorType) return null;
  const u = String(connectorType).toUpperCase().replace(/\s+/g, "");
  if (u === "HRMS_DELIMITED_FILE") return "delimited_file";
  if (u === "CONNECTOR_DELIMITEDFILE" || u === "DELIMITEDFILE") return "delimited_file";
  if (u.includes("DELIMITED") && u.includes("FILE")) return "delimited_file";
  return null;
}
