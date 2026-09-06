namespace ADShield.Models;

/// <summary>
/// Lightweight directory object projection (no secrets).
/// </summary>
public sealed class DirectoryObjectResult
{
    public string DistinguishedName { get; init; } = string.Empty;
    public string? ObjectClass { get; init; }
    public string? ObjectGuid { get; init; }
    public string? ObjectSid { get; init; }
    public IReadOnlyDictionary<string, IReadOnlyList<string>> Attributes { get; init; }
        = new Dictionary<string, IReadOnlyList<string>>();
}
