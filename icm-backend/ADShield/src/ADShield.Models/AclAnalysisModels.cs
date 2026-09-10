using ADShield.Configuration;

namespace ADShield.Models;

/// <summary>
/// Request body for POST /api/v1/security/acl-analysis.
/// Credentials are request-scoped and never persisted.
/// </summary>
public sealed class AclAnalysisRequest
{
    public string? ScanId { get; set; }
    public string? TenantId { get; set; }
    public string? ApplicationId { get; set; }

    public IReadOnlyList<string> Features { get; set; } = Array.Empty<string>();

    public ActiveDirectoryConnectionOptions Connection { get; set; } = new();

    public AclSearchOptions? Search { get; set; }

    public AclAnalysisOptions? Options { get; set; }
}

public sealed class AclSearchOptions
{
    public string? BaseDn { get; set; }
    public string? Filter { get; set; }
    /// <summary>LDAP scope: base | one | sub (default sub).</summary>
    public string? Scope { get; set; }
}

public sealed class AclAnalysisOptions
{
    public int MaxObjects { get; set; } = 5000;

    /// <summary>
    /// Optional privileged object SIDs from IdentitySphere (request-scoped, non-secret).
    /// Used to resolve privileged ACL targets that may fall outside maxObjects.
    /// </summary>
    public IReadOnlyList<string>? PrivilegedSids { get; set; }
}

/// <summary>
/// IdentitySphere discovery-finding compatible payload (no risk/severity).
/// </summary>
public sealed class DiscoveryFindingDto
{
    public string ScanId { get; set; } = string.Empty;
    public string Feature { get; set; } = string.Empty;
    public string ObjectType { get; set; } = string.Empty;
    public string ObjectName { get; set; } = string.Empty;
    public string Dn { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public Dictionary<string, object?> Attributes { get; set; } = new();
    public Dictionary<string, object?> Evidence { get; set; } = new();
    public IReadOnlyList<object> Relationships { get; set; } = Array.Empty<object>();
    public string FindingType { get; set; } = string.Empty;
    public IReadOnlyList<string> FindingSignals { get; set; } = Array.Empty<string>();
}

public sealed class AclFeatureResultDto
{
    public string Feature { get; set; } = string.Empty;
    public int Count { get; set; }
    public long DurationMs { get; set; }
}

public sealed class AclAnalysisDiagnosticsDto
{
    public int ObjectsScanned { get; set; }
    public int DescriptorsRead { get; set; }
    public string? Endpoint { get; set; }
    public string? SearchBase { get; set; }

    public int SidLookups { get; set; }
    public int SidResolved { get; set; }
    public int SidUnknown { get; set; }
    public int WellKnownSidCount { get; set; }
    public int CacheHits { get; set; }

    public int ShadowAdminAclHits { get; set; }
    public int TargetsConsidered { get; set; }
    public int TrusteeUsersConsidered { get; set; }
    public int PrivilegedTargetsResolved { get; set; }
}

public sealed class AclAnalysisResult
{
    public bool Success { get; set; }
    public IReadOnlyList<DiscoveryFindingDto> Findings { get; set; } = Array.Empty<DiscoveryFindingDto>();
    public IReadOnlyList<AclFeatureResultDto> Results { get; set; } = Array.Empty<AclFeatureResultDto>();
    public AclAnalysisDiagnosticsDto? Diagnostics { get; set; }
    public IReadOnlyList<string> Errors { get; set; } = Array.Empty<string>();
}
