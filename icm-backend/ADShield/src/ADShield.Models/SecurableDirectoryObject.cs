namespace ADShield.Models;

/// <summary>
/// Securable directory object with optional parsed security descriptor (live LDAP).
/// </summary>
public sealed class SecurableDirectoryObject
{
    public string DistinguishedName { get; init; } = string.Empty;
    public string ObjectType { get; init; } = "object";
    public string ObjectName { get; init; } = string.Empty;
    public string ObjectSid { get; init; } = string.Empty;
    public bool DescriptorFound { get; init; }
    public ParsedSecurityDescriptor? ParsedSd { get; init; }
    public string? DescriptorError { get; init; }
}
