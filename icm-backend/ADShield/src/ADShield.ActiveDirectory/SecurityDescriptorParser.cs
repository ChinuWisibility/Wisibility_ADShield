using System.Globalization;
using System.Text;
using ADShield.Models;

namespace ADShield.ActiveDirectory;

/// <summary>
/// Parses self-relative SECURITY_DESCRIPTOR blobs (MS-DTYP 2.4.6) from LDAP nTSecurityDescriptor.
/// No dependency on domain membership, WinRM, RSAT, or System.DirectoryServices (ADSI).
/// </summary>
public static class SecurityDescriptorParser
{
    private const ushort SdControlSelfRelative = 0x8000;

    private static readonly Dictionary<int, string> AceTypeNames = new()
    {
        [0x00] = "ACCESS_ALLOWED",
        [0x01] = "ACCESS_DENIED",
        [0x02] = "SYSTEM_AUDIT",
        [0x05] = "ACCESS_ALLOWED_OBJECT",
        [0x06] = "ACCESS_DENIED_OBJECT",
    };

    private static readonly (uint Bit, string Label)[] AccessMaskLabels =
    [
        (0x10000000u, "GenericAll"),
        (0x20000000u, "GenericExecute"),
        (0x40000000u, "GenericWrite"),
        (0x80000000u, "GenericRead"),
        (0x00010000u, "Delete"),
        (0x00020000u, "ReadControl"),
        (0x00040000u, "WriteDacl"),
        (0x00080000u, "WriteOwner"),
        (0x00100000u, "Synchronize"),
        (0x00000001u, "CreateChild"),
        (0x00000002u, "DeleteChild"),
        (0x00000004u, "ListChildren"),
        (0x00000008u, "Self"),
        (0x00000010u, "ReadProperty"),
        (0x00000020u, "WriteProperty"),
        (0x00000040u, "DeleteTree"),
        (0x00000080u, "ListObject"),
        (0x00000100u, "ControlAccess"),
    ];

    public static ParsedSecurityDescriptor? Parse(byte[]? input, out string? error)
    {
        error = null;
        if (input is null || input.Length < 20)
        {
            error = "Security descriptor buffer is missing or too short.";
            return null;
        }

        try
        {
            var revision = input[0];
            var control = BitConverter.ToUInt16(input, 2);
            var ownerRel = BitConverter.ToUInt32(input, 4);
            var groupRel = BitConverter.ToUInt32(input, 8);
            var saclRel = BitConverter.ToUInt32(input, 12);
            var daclRel = BitConverter.ToUInt32(input, 16);

            var ownerSid = ownerRel > 0 && ownerRel < input.Length
                ? ParseSidAtOffset(input, (int)ownerRel)
                : string.Empty;
            var groupSid = groupRel > 0 && groupRel < input.Length
                ? ParseSidAtOffset(input, (int)groupRel)
                : string.Empty;

            var dacl = ParseAcl(input, daclRel, "DACL");
            var sacl = ParseAcl(input, saclRel, "SACL");
            var aces = new List<AceInfo>(dacl.Aces.Count + sacl.Aces.Count);
            aces.AddRange(dacl.Aces);
            aces.AddRange(sacl.Aces);

            return new ParsedSecurityDescriptor
            {
                Revision = revision,
                Control = control,
                SelfRelative = (control & SdControlSelfRelative) != 0,
                OwnerSid = ownerSid,
                GroupSid = groupSid,
                DaclPresent = dacl.Present,
                DaclHeaderAceCount = dacl.HeaderAceCount,
                DaclAceCount = dacl.Aces.Count,
                SaclPresent = sacl.Present,
                SaclHeaderAceCount = sacl.HeaderAceCount,
                SaclAceCount = sacl.Aces.Count,
                Aces = aces,
            };
        }
        catch (Exception ex)
        {
            error = $"Failed to parse security descriptor: {ex.Message}";
            return null;
        }
    }

    public static string ParseSid(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length < 8)
            return string.Empty;

        var revision = bytes[0];
        var subCount = bytes[1];
        ulong authority = 0;
        for (var i = 2; i <= 7; i++)
            authority = (authority << 8) + bytes[i];

        var sb = new StringBuilder();
        sb.Append(CultureInfo.InvariantCulture, $"S-{revision}-{authority}");

        var offset = 8;
        for (var i = 0; i < subCount && offset + 4 <= bytes.Length; i++)
        {
            var sub = BitConverter.ToUInt32(bytes.Slice(offset, 4));
            sb.Append('-').Append(sub.ToString(CultureInfo.InvariantCulture));
            offset += 4;
        }

        return sb.ToString();
    }

    private static string ParseSidAtOffset(byte[] buf, int offset)
    {
        if (offset < 0 || offset + 8 > buf.Length)
            return string.Empty;
        var subCount = buf[offset + 1];
        var needed = 8 + subCount * 4;
        if (offset + needed > buf.Length)
            return string.Empty;
        return ParseSid(buf.AsSpan(offset, needed));
    }

    private static (bool Present, int HeaderAceCount, IReadOnlyList<AceInfo> Aces) ParseAcl(
        byte[] buf,
        uint relativeOffset,
        string aclType)
    {
        if (relativeOffset == 0 || relativeOffset + 8 > buf.Length)
            return (false, 0, Array.Empty<AceInfo>());

        var start = (int)relativeOffset;
        var aceCount = BitConverter.ToUInt16(buf, start + 2);
        var aclSize = BitConverter.ToUInt16(buf, start + 4);
        var aces = new List<AceInfo>(aceCount);
        var cursor = start + 8;
        var aclEnd = Math.Min(start + aclSize, buf.Length);
        var parsed = 0;

        while (cursor + 4 <= aclEnd && parsed < aceCount)
        {
            var ace = ParseAceAtOffset(buf, cursor, aclType);
            if (ace is null || ace.AceSize < 4)
                break;
            aces.Add(ace);
            cursor += ace.AceSize;
            parsed++;
        }

        return (true, aceCount, aces);
    }

    private static AceInfo? ParseAceAtOffset(byte[] buf, int offset, string aclType)
    {
        if (offset + 4 > buf.Length)
            return null;

        var aceType = buf[offset];
        var aceFlags = buf[offset + 1];
        var aceSize = BitConverter.ToUInt16(buf, offset + 2);
        if (aceSize < 4 || offset + aceSize > buf.Length)
            return null;

        uint accessMask = 0;
        var trusteeSid = string.Empty;
        var hasMask = aceType is 0x00 or 0x01 or 0x02 or 0x05 or 0x06;
        if (hasMask && aceSize >= 12)
        {
            accessMask = BitConverter.ToUInt32(buf, offset + 4);
            // Object ACEs place object/inherited GUIDs before SID; standard ACEs put SID at +8.
            var sidOffset = aceType is 0x05 or 0x06
                ? ResolveObjectAceSidOffset(buf, offset, aceSize)
                : offset + 8;
            if (sidOffset > 0)
                trusteeSid = ParseSidAtOffset(buf, sidOffset);
        }

        AceTypeNames.TryGetValue(aceType, out var typeName);

        return new AceInfo
        {
            AclType = aclType,
            AceType = aceType,
            AceTypeName = typeName ?? $"UNKNOWN_{aceType}",
            AceFlags = aceFlags,
            AceSize = aceSize,
            AccessMask = accessMask,
            AccessMaskHex = $"0x{accessMask:X8}",
            TrusteeSid = trusteeSid,
            IsAllowed = aceType is 0x00 or 0x05,
            IsDenied = aceType is 0x01 or 0x06,
            Rights = DescribeRights(accessMask),
        };
    }

    /// <summary>
    /// Object ACE layout: header(4) + mask(4) + flags(4) + optional ObjectType GUID(16) + optional InheritedObjectType GUID(16) + SID.
    /// </summary>
    private static int ResolveObjectAceSidOffset(byte[] buf, int aceOffset, int aceSize)
    {
        if (aceSize < 12)
            return -1;
        // Object ACE flags at offset+8
        if (aceOffset + 12 > buf.Length)
            return -1;
        var flags = BitConverter.ToUInt32(buf, aceOffset + 8);
        var sidOffset = aceOffset + 12;
        if ((flags & 0x1) != 0) // ACE_OBJECT_TYPE_PRESENT
            sidOffset += 16;
        if ((flags & 0x2) != 0) // ACE_INHERITED_OBJECT_TYPE_PRESENT
            sidOffset += 16;
        if (sidOffset + 8 > aceOffset + aceSize)
            return -1;
        return sidOffset;
    }

    private static IReadOnlyList<string> DescribeRights(uint mask)
    {
        if (mask == 0)
            return Array.Empty<string>();
        var labels = new List<string>();
        foreach (var (bit, label) in AccessMaskLabels)
        {
            if ((mask & bit) != 0)
                labels.Add(label);
        }

        return labels;
    }
}
