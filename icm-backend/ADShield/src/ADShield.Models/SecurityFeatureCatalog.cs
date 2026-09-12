namespace ADShield.Models;

/// <summary>
/// Canonical IdentitySphere / AD.md feature IDs for ADShield (.NET).
/// Detection + remediation land here feature-by-feature; Node is not required.
/// </summary>
public static class SecurityFeatureCatalog
{
    public static readonly IReadOnlyList<SecurityFeatureDescriptor> All =
    [
        // Accounts
        D("disabled_users", "Disabled Users", SecurityFeatureArea.Accounts, implemented: false),
        D("inactive_users", "Inactive Users", SecurityFeatureArea.Accounts, implemented: false),
        D("locked_accounts", "Locked Accounts", SecurityFeatureArea.Accounts, implemented: false),
        D("password_never_expires", "Password Never Expires", SecurityFeatureArea.Accounts, implemented: false),
        D("password_not_required", "Password Not Required", SecurityFeatureArea.Accounts, implemented: false),
        D("reversible_encryption_enabled", "Reversible Encryption", SecurityFeatureArea.Accounts, implemented: false),
        D("smartcard_not_required", "Smartcard Not Required", SecurityFeatureArea.Accounts, implemented: false),
        D("service_accounts", "Service Accounts", SecurityFeatureArea.Accounts, implemented: false),
        // Groups
        D("empty_groups", "Empty Groups", SecurityFeatureArea.Groups, implemented: false),
        D("groups_without_owners", "Groups Without Owners", SecurityFeatureArea.Groups, implemented: false),
        D("nested_groups", "Nested Groups", SecurityFeatureArea.Groups, implemented: false),
        D("circular_memberships", "Circular Membership", SecurityFeatureArea.Groups, implemented: false),
        D("unused_groups", "Unused Groups", SecurityFeatureArea.Groups, implemented: false),
        D("orphan_groups", "Orphan Groups", SecurityFeatureArea.Groups, implemented: false),
        D("duplicate_groups", "Duplicate Groups", SecurityFeatureArea.Groups, implemented: false),
        D("toxic_privilege_combinations", "Toxic Privilege Combinations", SecurityFeatureArea.Groups, implemented: false),
        // Privileged
        D("nested_privileged_access", "Nested Privileged Access", SecurityFeatureArea.Privileged, implemented: false),
        D("dormant_privileged_users", "Dormant Privileged Users", SecurityFeatureArea.Privileged, implemented: false),
        D("excessive_privileges", "Excessive Privileges", SecurityFeatureArea.Privileged, implemented: false),
        D("privilege_escalation_paths", "Privilege Escalation Paths", SecurityFeatureArea.Privileged, implemented: false),
        // SID / ACL
        D("orphan_sids", "Orphan SIDs", SecurityFeatureArea.Acl, implemented: true, remediation: true),
        D("shadow_admins", "Shadow Admins", SecurityFeatureArea.Acl, implemented: true, remediation: true,
            requestAliases: ["shadow_admins_acl"]),
        D("sid_history_analysis", "SID History Analysis", SecurityFeatureArea.Acl, implemented: true, remediation: true),
        D("foreign_security_principals", "Foreign Security Principals", SecurityFeatureArea.Acl, implemented: true, remediation: true),
        D("unknown_sid_bindings", "Unknown SID Bindings", SecurityFeatureArea.Acl, implemented: true, remediation: true),
        D("broken_acls", "Broken ACLs", SecurityFeatureArea.Acl, implemented: true, remediation: true),
        // Computers
        D("disabled_computers", "Disabled Computers", SecurityFeatureArea.Computers, implemented: false),
        D("inactive_computers", "Inactive Computers", SecurityFeatureArea.Computers, implemented: false),
        D("missing_os_information", "Missing OS Information", SecurityFeatureArea.Computers, implemented: false),
        D("unsupported_os_versions", "Unsupported OS Versions", SecurityFeatureArea.Computers, implemented: false),
        D("servers_in_wrong_ou", "Servers in Workstation OU", SecurityFeatureArea.Computers, implemented: false),
        D("duplicate_spns", "Duplicate SPNs", SecurityFeatureArea.Computers, implemented: false),
        D("computers_without_owners", "Computers Without Owners", SecurityFeatureArea.Computers, implemented: false),
        // Kerberos
        D("kerberoastable_accounts", "Kerberoastable Accounts", SecurityFeatureArea.Kerberos, implemented: false),
        D("asrep_roastable_users", "AS-REP Roastable Users", SecurityFeatureArea.Kerberos, implemented: false),
        D("preauth_disabled", "Pre-authentication Disabled", SecurityFeatureArea.Kerberos, implemented: false),
        D("spn_misconfigurations", "SPN Misconfigurations", SecurityFeatureArea.Kerberos, implemented: false),
        // Delegation
        D("unconstrained_delegation", "Unconstrained Delegation", SecurityFeatureArea.Delegation, implemented: false),
        D("constrained_delegation", "Constrained Delegation", SecurityFeatureArea.Delegation, implemented: false),
        D("rbcd", "Resource-Based Constrained Delegation", SecurityFeatureArea.Delegation, implemented: false),
        D("delegation_exposure", "Delegation Exposure Summary", SecurityFeatureArea.Delegation, implemented: false),
    ];

    public static IReadOnlyList<SecurityFeatureDescriptor> Implemented =>
        All.Where(f => f.Implemented).ToList();

    public static SecurityFeatureDescriptor? Find(string? featureId)
    {
        var id = (featureId ?? string.Empty).Trim();
        if (id.Length == 0)
            return null;
        return All.FirstOrDefault(f =>
            f.Id.Equals(id, StringComparison.Ordinal)
            || f.RequestAliases.Any(a => a.Equals(id, StringComparison.Ordinal)));
    }

    private static SecurityFeatureDescriptor D(
        string id,
        string name,
        SecurityFeatureArea area,
        bool implemented,
        bool remediation = false,
        string[]? requestAliases = null) =>
        new()
        {
            Id = id,
            Name = name,
            Area = area,
            Implemented = implemented,
            RemediationSupported = remediation,
            RequestAliases = requestAliases ?? Array.Empty<string>(),
        };
}

public enum SecurityFeatureArea
{
    Accounts,
    Groups,
    Privileged,
    Acl,
    Computers,
    Kerberos,
    Delegation,
}

public sealed class SecurityFeatureDescriptor
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public SecurityFeatureArea Area { get; init; }
    public bool Implemented { get; init; }
    public bool RemediationSupported { get; init; }
    public IReadOnlyList<string> RequestAliases { get; init; } = Array.Empty<string>();
}
