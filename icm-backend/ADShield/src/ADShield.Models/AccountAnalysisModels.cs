using ADShield.Configuration;

namespace ADShield.Models;

/// <summary>
/// Request for POST /api/v1/security/account-analysis.
/// Same credential / search contract as ACL analysis; credentials never persisted.
/// </summary>
public sealed class AccountAnalysisRequest
{
    public string? ScanId { get; set; }
    public string? TenantId { get; set; }
    public string? ApplicationId { get; set; }

    public IReadOnlyList<string> Features { get; set; } = Array.Empty<string>();

    public ActiveDirectoryConnectionOptions Connection { get; set; } = new();

    public AclSearchOptions? Search { get; set; }

    public AccountAnalysisOptions? Options { get; set; }
}

public sealed class AccountAnalysisOptions
{
    public int MaxObjects { get; set; } = 5000;

    /// <summary>Inactive users threshold in days (default 90, matches Node).</summary>
    public int InactiveDays { get; set; } = 90;
}

/// <summary>Reuse ACL analysis result shape for account findings (IdentitySphere contract).</summary>
public sealed class AccountAnalysisResult
{
    public bool Success { get; set; }
    public IReadOnlyList<DiscoveryFindingDto> Findings { get; set; } = Array.Empty<DiscoveryFindingDto>();
    public IReadOnlyList<AclFeatureResultDto> Results { get; set; } = Array.Empty<AclFeatureResultDto>();
    public AccountAnalysisDiagnosticsDto? Diagnostics { get; set; }
    public IReadOnlyList<string> Errors { get; set; } = Array.Empty<string>();
}

public sealed class AccountAnalysisDiagnosticsDto
{
    public int ObjectsScanned { get; set; }
    public string? Endpoint { get; set; }
    public string? SearchBase { get; set; }
    public int InactiveDays { get; set; }
}
