using ADShield.Configuration;

namespace ADShield.Models;

/// <summary>
/// Request for POST /api/v1/security/posture-analysis (groups, privileged, computers, kerberos, delegation).
/// Same credential / search contract as account analysis; credentials never persisted.
/// </summary>
public sealed class PostureAnalysisRequest
{
    public string? ScanId { get; set; }
    public string? TenantId { get; set; }
    public string? ApplicationId { get; set; }

    public IReadOnlyList<string> Features { get; set; } = Array.Empty<string>();

    public ActiveDirectoryConnectionOptions Connection { get; set; } = new();

    public AclSearchOptions? Search { get; set; }

    public PostureAnalysisOptions? Options { get; set; }
}

public sealed class PostureAnalysisOptions
{
    public int MaxObjects { get; set; } = 5000;

    /// <summary>Inactive users / computers / dormant privileged threshold (default 90).</summary>
    public int InactiveDays { get; set; } = 90;

    /// <summary>Optional workstation OU DN patterns for servers_in_wrong_ou.</summary>
    public IReadOnlyList<string>? WorkstationOuPatterns { get; set; }

    /// <summary>Optional unsupported OS substrings (in addition to built-in regex).</summary>
    public IReadOnlyList<string>? UnsupportedOsTokens { get; set; }
}

public sealed class PostureAnalysisResult
{
    public bool Success { get; set; }
    public IReadOnlyList<DiscoveryFindingDto> Findings { get; set; } = Array.Empty<DiscoveryFindingDto>();
    public IReadOnlyList<AclFeatureResultDto> Results { get; set; } = Array.Empty<AclFeatureResultDto>();
    public PostureAnalysisDiagnosticsDto? Diagnostics { get; set; }
    public IReadOnlyList<string> Errors { get; set; } = Array.Empty<string>();
}

public sealed class PostureAnalysisDiagnosticsDto
{
    public int GroupsScanned { get; set; }
    public int UsersScanned { get; set; }
    public int ComputersScanned { get; set; }
    public string? Endpoint { get; set; }
    public string? SearchBase { get; set; }
    public int InactiveDays { get; set; }
}
