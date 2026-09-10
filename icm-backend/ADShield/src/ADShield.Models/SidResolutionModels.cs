namespace ADShield.Models;

/// <summary>
/// Internal SID authority classification for ACL analysis.
/// Only <see cref="Unknown"/> should produce unknown/orphan findings.
/// </summary>
public enum SidClassification
{
    Unknown = 0,
    KnownWellKnown = 1,
    KnownBuiltin = 2,
    KnownDirectoryObject = 3,
    KnownDomainPrincipal = 4,
    KnownForeignPrincipal = 5,
}

/// <summary>
/// Result of resolving a trustee/owner/group SID for ACL analysis.
/// </summary>
public sealed record SidResolutionResult
{
    public string Sid { get; init; } = string.Empty;
    public SidClassification Classification { get; init; } = SidClassification.Unknown;
    public bool IsKnown => Classification != SidClassification.Unknown;
    public string? DistinguishedName { get; init; }
    public string? ObjectName { get; init; }
    public string? ObjectClass { get; init; }
    public bool FromCache { get; init; }
    public bool FromLdapLookup { get; init; }
}

/// <summary>
/// Directory object located by binary objectSid LDAP search.
/// </summary>
public sealed class SidLookupResult
{
    public string Sid { get; init; } = string.Empty;
    public string DistinguishedName { get; init; } = string.Empty;
    public string? ObjectName { get; init; }
    public string? ObjectClass { get; init; }
    public bool IsForeignSecurityPrincipal { get; init; }
}
