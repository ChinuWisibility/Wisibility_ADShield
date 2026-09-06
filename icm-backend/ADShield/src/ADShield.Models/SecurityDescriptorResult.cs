namespace ADShield.Models;

/// <summary>
/// Raw + decoded nTSecurityDescriptor read result.
/// </summary>
public sealed class SecurityDescriptorResult
{
    public string DistinguishedName { get; init; } = string.Empty;
    public bool Found { get; init; }
    public int ByteLength { get; init; }

    /// <summary>
    /// Base64 of the binary nTSecurityDescriptor when present.
    /// </summary>
    public string? SecurityDescriptorBase64 { get; init; }

    /// <summary>
    /// True when binary SD was successfully decoded.
    /// </summary>
    public bool DecodeSucceeded { get; init; }

    public ParsedSecurityDescriptor? Parsed { get; init; }

    public string? DecodeError { get; init; }
}
