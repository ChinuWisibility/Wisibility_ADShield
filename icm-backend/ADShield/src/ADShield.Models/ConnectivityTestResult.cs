namespace ADShield.Models;

/// <summary>
/// Structured diagnostics for an AD connectivity / security-descriptor proof.
/// </summary>
public sealed class ConnectivityTestResult
{
    public bool Success { get; set; }
    public string Endpoint { get; set; } = string.Empty;
    public bool BindSucceeded { get; set; }
    public bool ObjectReadSucceeded { get; set; }
    public bool SecurityDescriptorReadSucceeded { get; set; }
    public bool SecurityDescriptorDecodeSucceeded { get; set; }
    public long ElapsedMs { get; set; }
    public IReadOnlyList<string> Errors { get; set; } = Array.Empty<string>();
    public string? ObjectDn { get; set; }
    public int? SecurityDescriptorByteLength { get; set; }
    public string? OwnerSid { get; set; }
    public string? GroupSid { get; set; }
    public int AceCount { get; set; }
    public IReadOnlyList<AceInfo> Aces { get; set; } = Array.Empty<AceInfo>();
    public DirectoryObjectResult? Object { get; set; }
}
