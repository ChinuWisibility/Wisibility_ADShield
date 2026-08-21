import {
  getMemberDnsFromEntry,
  hasLdapMemberAttribute,
} from "./ldapEntryAttributes.js";

describe("ldapEntryAttributes member parsing", () => {
  test("getMemberDnsFromEntry reads member;range on ldapts direct-key entries", () => {
    const entry = {
      dn: "CN=Large,OU=Security,DC=corp,DC=local",
      member: [],
      "member;range=0-1": [
        "CN=User1,DC=corp,DC=local",
        "CN=User2,DC=corp,DC=local",
      ],
    };
    expect(hasLdapMemberAttribute(entry)).toBe(true);
    expect(getMemberDnsFromEntry(entry)).toEqual([
      "CN=User1,DC=corp,DC=local",
      "CN=User2,DC=corp,DC=local",
    ]);
  });

  test("getMemberDnsFromEntry reads member;range from ldapjs attributes array", () => {
    const entry = {
      dn: "CN=Large,OU=Security,DC=corp,DC=local",
      attributes: [
        { type: "member", values: [] },
        {
          type: "member;range=0-0",
          values: ["CN=Nested,OU=Security,DC=corp,DC=local"],
        },
      ],
    };
    expect(getMemberDnsFromEntry(entry)).toEqual([
      "CN=Nested,OU=Security,DC=corp,DC=local",
    ]);
  });
});
