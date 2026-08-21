import { describe, expect, test } from "@jest/globals";
import { getConnectorDefinition } from "../../../config/connectorCatalog.js";

/**
 * Ensures AD and CSV families resolve without application-name branching.
 * (Worker uses family via resolveProvisioningConnector — tested here at catalog level.)
 */
describe("connector family resolution for provisioning", () => {
  test("ACTIVE_DIRECTORY → ldap_ad", () => {
    expect(getConnectorDefinition("ACTIVE_DIRECTORY").family).toBe("ldap_ad");
  });

  test("DelimitedFile → file_delimited", () => {
    expect(getConnectorDefinition("CONNECTOR_DELIMITEDFILE").family).toBe("file_delimited");
  });

  test("SAP-named app does not hardcode family from name alone", () => {
    // Without connectorType, catalog returns none — engine must use connectorType/family
    const def = getConnectorDefinition("", "SAP");
    expect(def.family).not.toBe("ldap_ad");
  });
});
