import {
  detectInactiveComputers,
  detectMissingOSInformation,
  detectUnsupportedOperatingSystems,
  detectServersInWorkstationOu,
  detectDuplicateComputerSpns,
  detectComputerObjectsWithoutOwners,
  detectDisabledComputers,
  dnMatchesWorkstationOu,
  dnMatchesWorkstationOuPattern,
} from "./computerSecurity.js";
import {
  isInactiveComputer,
  isUnsupportedComputerOperatingSystem,
} from "./utils/adSecurityHelpers.js";
import { resolveFeatureLdapFilter } from "./postureFeatureLdap.js";

describe("computer security analyzers (test.ps1 parity)", () => {
  test("isInactiveComputer treats null lastLogonTimestamp as inactive", () => {
    expect(isInactiveComputer(null, 90, "4096")).toBe(true);
    expect(isInactiveComputer("0", 90, "4096")).toBe(true);
    expect(isInactiveComputer(null, 90, "4098")).toBe(false);
  });

  test("detectInactiveComputers flags never-authenticated enabled computers", () => {
    const findings = detectInactiveComputers(
      [
        {
          computerName: "Never",
          distinguishedName: "CN=Never,OU=Computers,DC=corp,DC=local",
          userAccountControl: "4096",
          lastLogonTimestamp: null,
        },
        {
          computerName: "Disabled",
          distinguishedName: "CN=Disabled,OU=Computers,DC=corp,DC=local",
          userAccountControl: "4098",
          lastLogonTimestamp: null,
        },
      ],
      "scan-1",
      90,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].objectName).toBe("Never");
  });

  test("detectMissingOSInformation requires OS and version", () => {
    const findings = detectMissingOSInformation(
      [
        {
          computerName: "NoOs",
          distinguishedName: "CN=NoOs,OU=Computers,DC=corp,DC=local",
          operatingSystem: "",
          operatingSystemVersion: "",
        },
        {
          computerName: "NoVersion",
          distinguishedName: "CN=NoVersion,OU=Computers,DC=corp,DC=local",
          operatingSystem: "Windows 10",
          operatingSystemVersion: "",
        },
        {
          computerName: "Complete",
          distinguishedName: "CN=Complete,OU=Computers,DC=corp,DC=local",
          operatingSystem: "Windows 10",
          operatingSystemVersion: "10.0",
        },
      ],
      "scan-1",
    );
    expect(findings).toHaveLength(2);
  });

  test("isUnsupportedComputerOperatingSystem matches legacy Windows regex", () => {
    expect(isUnsupportedComputerOperatingSystem("Windows Server 2008 R2 Standard")).toBe(true);
    expect(isUnsupportedComputerOperatingSystem("Windows 10 Enterprise")).toBe(false);
  });

  test("detectServersInWorkstationOu uses DN suffix match", () => {
    const findings = detectServersInWorkstationOu(
      [
        {
          computerName: "Srv",
          distinguishedName: "CN=Srv,OU=Workstations,OU=Computers,OU=wisibility,DC=wisibility,DC=lcl",
          operatingSystem: "Windows Server 2019 Standard",
        },
        {
          computerName: "SrvOther",
          distinguishedName: "CN=SrvOther,OU=Servers,OU=wisibility,DC=wisibility,DC=lcl",
          operatingSystem: "Windows Server 2019 Standard",
        },
      ],
      "scan-1",
      ["OU=Computers,OU=wisibility,DC=wisibility,DC=lcl"],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].objectName).toBe("Srv");
  });

  test("dnMatchesWorkstationOuPattern matches nested ou=workstations RDN", () => {
    const dn = "CN=Srv,OU=Workstations,OU=Computers,OU=wisibility,DC=wisibility,DC=lcl";
    expect(dnMatchesWorkstationOuPattern(dn, "ou=workstations")).toBe(true);
  });

  test("detectServersInWorkstationOu honors workstation search base scope", () => {
    const searchBase = "OU=Workstations,OU=Computers,OU=wisibility,DC=wisibility,DC=lcl";
    const findings = detectServersInWorkstationOu(
      [
        {
          computerName: "WIS-Sd-PC-SrvWr",
          distinguishedName: "CN=WIS-Sd-PC-SrvWr,OU=Workstations,OU=Computers,OU=wisibility,DC=wisibility,DC=lcl",
          operatingSystem: "Windows Server 2019 Standard",
        },
      ],
      "scan-1",
      ["ou=desktop"],
      searchBase,
    );
    expect(findings).toHaveLength(1);
  });

  test("detectDuplicateComputerSpns finds duplicates within computer scope only", () => {
    const findings = detectDuplicateComputerSpns(
      [
        {
          computerName: "A",
          distinguishedName: "CN=A,DC=corp,DC=local",
          servicePrincipalNames: ["HTTP/web"],
        },
        {
          computerName: "B",
          distinguishedName: "CN=B,DC=corp,DC=local",
          servicePrincipalNames: ["HTTP/web"],
        },
      ],
      "scan-1",
    );
    expect(findings).toHaveLength(2);
  });

  test("detectComputerObjectsWithoutOwners flags empty managedBy", () => {
    const findings = detectComputerObjectsWithoutOwners(
      [
        {
          computerName: "NoOwner",
          distinguishedName: "CN=NoOwner,DC=corp,DC=local",
          managedBy: "",
        },
      ],
      "scan-1",
    );
    expect(findings).toHaveLength(1);
  });

  test("inactive_computers uses broad LDAP filter", () => {
    const filter = resolveFeatureLdapFilter("inactive_computers", {});
    expect(filter).toContain("objectCategory=computer");
    expect(filter).not.toContain("userAccountControl:1.2.840.113556.1.4.803:=2");
  });
});
