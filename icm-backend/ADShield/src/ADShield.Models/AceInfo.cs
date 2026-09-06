namespace ADShield.Models;

/// <summary>
/// One ACE from a DACL or SACL (MS-DTYP).
/// </summary>
public sealed class AceInfo
{
    public string AclType { get; init; } = "DACL";
    public int AceType { get; init; }
    public string AceTypeName { get; init; } = string.Empty;
    public int AceFlags { get; init; }
    public int AceSize { get; init; }
    public uint AccessMask { get; init; }
    public string AccessMaskHex { get; init; } = "0x0";
    public string TrusteeSid { get; init; } = string.Empty;
    public bool IsAllowed { get; init; }
    public bool IsDenied { get; init; }
    public IReadOnlyList<string> Rights { get; init; } = Array.Empty<string>();
}

/// <summary>
/// Decoded self-relative SECURITY_DESCRIPTOR.
/// </summary>
public sealed class ParsedSecurityDescriptor
{
    public int Revision { get; init; }
    public int Control { get; init; }
    public bool SelfRelative { get; init; }
    public string OwnerSid { get; init; } = string.Empty;
    public string GroupSid { get; init; } = string.Empty;
    public int DaclAceCount { get; init; }
    public int SaclAceCount { get; init; }
    public IReadOnlyList<AceInfo> Aces { get; init; } = Array.Empty<AceInfo>();
}
