using ADShield.Models;

namespace ADShield.ActiveDirectory;

/// <summary>
/// Cross-platform well-known / Builtin SID recognition.
/// Uses managed SDDL authority tables so ADShield works on non-Windows hosts
/// (LDAP clients). When running on Windows, results align with
/// <c>System.Security.Principal.WellKnownSidType</c> authorities.
/// </summary>
public static class WellKnownSidRecognizer
{
    /// <summary>
    /// Absolute well-known SIDs (no domain qualifier), from Windows well-known SID authorities.
    /// </summary>
    private static readonly HashSet<string> AbsoluteWellKnownSids = new(StringComparer.OrdinalIgnoreCase)
    {
        "S-1-0-0",       // Null
        "S-1-1-0",       // Everyone / World
        "S-1-2-0",       // Local
        "S-1-2-1",       // Console Logon
        "S-1-3-0",       // Creator Owner
        "S-1-3-1",       // Creator Group
        "S-1-3-2",       // Creator Owner Server
        "S-1-3-3",       // Creator Group Server
        "S-1-3-4",       // Owner Rights
        "S-1-5-1",       // Dialup
        "S-1-5-2",       // Network
        "S-1-5-3",       // Batch
        "S-1-5-4",       // Interactive
        "S-1-5-6",       // Service
        "S-1-5-7",       // Anonymous
        "S-1-5-8",       // Proxy
        "S-1-5-9",       // Enterprise Domain Controllers
        "S-1-5-10",      // Principal Self
        "S-1-5-11",      // Authenticated Users
        "S-1-5-12",      // Restricted Code
        "S-1-5-13",      // Terminal Server Users
        "S-1-5-14",      // Remote Interactive Logon
        "S-1-5-15",      // This Organization
        "S-1-5-17",      // IUSR
        "S-1-5-18",      // Local System
        "S-1-5-19",      // Local Service
        "S-1-5-20",      // Network Service
        "S-1-5-80",      // NT Service (prefix authority; exact service SIDs vary)
        "S-1-5-113",     // Local account
        "S-1-5-114",     // Local account and member of Administrators
        "S-1-16-0",      // Untrusted Mandatory Level
        "S-1-16-4096",   // Low Mandatory Level
        "S-1-16-8192",   // Medium Mandatory Level
        "S-1-16-8448",   // Medium Plus
        "S-1-16-12288",  // High Mandatory Level
        "S-1-16-16384",  // System Mandatory Level
    };

    /// <summary>
    /// Domain-relative RIDs that are well-known only when prefixed by the real account domain SID.
    /// </summary>
    private static readonly HashSet<string> DomainRelativeWellKnownRids = new(StringComparer.Ordinal)
    {
        "500", // Administrator
        "501", // Guest
        "502", // KRBTGT
        "512", // Domain Admins
        "513", // Domain Users
        "514", // Domain Guests
        "515", // Domain Computers
        "516", // Domain Controllers
        "517", // Cert Publishers
        "518", // Schema Admins
        "519", // Enterprise Admins
        "520", // Group Policy Creator Owners
        "521", // Read-only Domain Controllers
        "522", // Cloneable Domain Controllers
        "525", // Protected Users
        "526", // Key Admins
        "527", // Enterprise Key Admins
        "553", // RAS and IAS Servers
    };

    public static SidClassification? TryClassify(
        string? sidString,
        IReadOnlyCollection<string>? accountDomainSids = null)
    {
        var normalized = LdapActiveDirectoryClient.NormalizeSid(sidString);
        if (string.IsNullOrEmpty(normalized))
            return null;
        if (!IsPlausibleSid(normalized))
            return null;

        if (AbsoluteWellKnownSids.Contains(normalized))
            return SidClassification.KnownWellKnown;

        // NT SERVICE\ and other S-1-5-80-* service SIDs
        if (normalized.StartsWith("S-1-5-80-", StringComparison.OrdinalIgnoreCase))
            return SidClassification.KnownWellKnown;

        // BUILTIN\* — S-1-5-32 or S-1-5-32-<RID>
        if (normalized.Equals("S-1-5-32", StringComparison.OrdinalIgnoreCase)
            || normalized.StartsWith("S-1-5-32-", StringComparison.OrdinalIgnoreCase))
            return SidClassification.KnownBuiltin;

        if (accountDomainSids is { Count: > 0 }
            && TryMatchDomainRelativeWellKnown(normalized, accountDomainSids))
        {
            return SidClassification.KnownDomainPrincipal;
        }

        return null;
    }

    public static bool IsKnownWithoutDirectory(
        string? sidString,
        IReadOnlyCollection<string>? accountDomainSids = null) =>
        TryClassify(sidString, accountDomainSids) is not null;

    public static string? TryGetAccountDomainSid(string? sidString)
    {
        var normalized = LdapActiveDirectoryClient.NormalizeSid(sidString);
        if (string.IsNullOrEmpty(normalized))
            return null;

        // S-1-5-21-A-B-C-RID → S-1-5-21-A-B-C
        var parts = normalized.Split('-', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 8)
            return null;
        if (!parts[0].Equals("S", StringComparison.OrdinalIgnoreCase)
            || parts[1] != "1"
            || parts[2] != "5"
            || parts[3] != "21")
            return null;

        return string.Join('-', parts.Take(7)).ToUpperInvariant();
    }

    private static bool TryMatchDomainRelativeWellKnown(
        string sid,
        IReadOnlyCollection<string> accountDomainSids)
    {
        var parts = sid.Split('-', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 8)
            return false;
        var rid = parts[^1];
        if (!DomainRelativeWellKnownRids.Contains(rid))
            return false;

        var domain = TryGetAccountDomainSid(sid);
        if (string.IsNullOrEmpty(domain))
            return false;

        foreach (var candidate in accountDomainSids)
        {
            var normDomain = LdapActiveDirectoryClient.NormalizeSid(candidate);
            if (string.Equals(normDomain, domain, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private static bool IsPlausibleSid(string sid)
    {
        if (!sid.StartsWith("S-", StringComparison.OrdinalIgnoreCase))
            return false;
        var parts = sid.Split('-', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 3)
            return false;
        for (var i = 1; i < parts.Length; i++)
        {
            if (!ulong.TryParse(parts[i], out _))
                return false;
        }
        return true;
    }
}
