using System.Globalization;

namespace ADShield.ActiveDirectory;

/// <summary>
/// Rebuilds self-relative SECURITY_DESCRIPTOR blobs after DACL ACE removals.
/// Operates only on bytes already read from the directory — no assumed domain structure.
/// </summary>
public static class SecurityDescriptorEditor
{
    private const ushort SeDaclPresent = 0x0004;
    private const ushort SeSelfRelative = 0x8000;

    public sealed class RemoveAceRequest
    {
        public string TrusteeSid { get; init; } = string.Empty;
        public uint? AccessMask { get; init; }
        public int? AceType { get; init; }
        /// <summary>When true, remove all matching ACEs; when false, remove at most one.</summary>
        public bool RemoveAllMatches { get; init; } = true;
    }

    public sealed class RemoveAceResult
    {
        public bool Success { get; init; }
        public byte[]? SecurityDescriptor { get; init; }
        public int RemovedCount { get; init; }
        public string? Error { get; init; }
        public IReadOnlyList<string> Changes { get; init; } = Array.Empty<string>();
    }

    public static RemoveAceResult RemoveDaclAces(byte[]? original, RemoveAceRequest request)
    {
        if (original is null || original.Length < 20)
            return Fail("Security descriptor buffer is missing or too short.");
        if (request is null || string.IsNullOrWhiteSpace(request.TrusteeSid))
            return Fail("TrusteeSid is required to remove a DACL ACE.");

        var wantSid = LdapActiveDirectoryClient.NormalizeSid(request.TrusteeSid);
        if (string.IsNullOrEmpty(wantSid))
            return Fail("TrusteeSid is invalid.");

        try
        {
            var control = BitConverter.ToUInt16(original, 2);
            var ownerRel = BitConverter.ToUInt32(original, 4);
            var groupRel = BitConverter.ToUInt32(original, 8);
            var saclRel = BitConverter.ToUInt32(original, 12);
            var daclRel = BitConverter.ToUInt32(original, 16);

            if (daclRel == 0 || daclRel + 8 > original.Length)
                return Fail("DACL is not present on this security descriptor.");

            var daclStart = (int)daclRel;
            var aceCount = BitConverter.ToUInt16(original, daclStart + 2);
            var aclSize = BitConverter.ToUInt16(original, daclStart + 4);
            var aclEnd = Math.Min(daclStart + aclSize, original.Length);

            var keptAces = new List<byte[]>();
            var removed = new List<string>();
            var cursor = daclStart + 8;
            var parsed = 0;

            while (cursor + 4 <= aclEnd && parsed < aceCount)
            {
                var aceSize = BitConverter.ToUInt16(original, cursor + 2);
                if (aceSize < 4 || cursor + aceSize > aclEnd)
                    return Fail("DACL contains a truncated ACE; refusing to mutate.");

                var aceBytes = original.AsSpan(cursor, aceSize).ToArray();
                var aceType = aceBytes[0];
                uint accessMask = 0;
                var trustee = string.Empty;
                if (aceType is 0x00 or 0x01 or 0x02 or 0x05 or 0x06 && aceSize >= 12)
                {
                    accessMask = BitConverter.ToUInt32(aceBytes, 4);
                    var sidOff = aceType is 0x05 or 0x06
                        ? ObjectAceSidOffset(aceBytes)
                        : 8;
                    if (sidOff > 0 && sidOff < aceBytes.Length)
                        trustee = SecurityDescriptorParser.ParseSid(aceBytes.AsSpan(sidOff));
                }

                var match =
                    LdapActiveDirectoryClient.NormalizeSid(trustee) == wantSid
                    && (!request.AccessMask.HasValue || request.AccessMask.Value == accessMask)
                    && (!request.AceType.HasValue || request.AceType.Value == aceType);

                if (match && (request.RemoveAllMatches || removed.Count == 0))
                {
                    removed.Add(
                        $"Removed DACL ACE type={aceType} mask=0x{accessMask:X8} trustee={wantSid}");
                }
                else
                {
                    keptAces.Add(aceBytes);
                }

                cursor += aceSize;
                parsed++;
            }

            if (removed.Count == 0)
                return Fail($"No DACL ACE matched trustee {wantSid} with the supplied filters.");

            var ownerBytes = CopySidBytes(original, ownerRel);
            var groupBytes = CopySidBytes(original, groupRel);
            var saclBytes = CopyAclBytes(original, saclRel);

            if (ownerBytes is null || groupBytes is null)
                return Fail("Owner or group SID is missing; refusing to mutate descriptor.");

            var newDacl = BuildAcl(keptAces);
            // Layout: header(20) + DACL + optional SACL + owner + group
            var offset = 20;
            var newDaclRel = offset;
            offset += newDacl.Length;
            var newSaclRel = 0;
            if (saclBytes is { Length: > 0 })
            {
                newSaclRel = offset;
                offset += saclBytes.Length;
            }

            var newOwnerRel = offset;
            offset += ownerBytes.Length;
            var newGroupRel = offset;
            offset += groupBytes.Length;

            var rebuilt = new byte[offset];
            rebuilt[0] = original[0]; // revision
            rebuilt[1] = original[1];
            var newControl = (ushort)((control | SeDaclPresent | SeSelfRelative));
            BitConverter.TryWriteBytes(rebuilt.AsSpan(2, 2), newControl);
            BitConverter.TryWriteBytes(rebuilt.AsSpan(4, 4), (uint)newOwnerRel);
            BitConverter.TryWriteBytes(rebuilt.AsSpan(8, 4), (uint)newGroupRel);
            BitConverter.TryWriteBytes(rebuilt.AsSpan(12, 4), (uint)newSaclRel);
            BitConverter.TryWriteBytes(rebuilt.AsSpan(16, 4), (uint)newDaclRel);
            Buffer.BlockCopy(newDacl, 0, rebuilt, newDaclRel, newDacl.Length);
            if (saclBytes is { Length: > 0 })
                Buffer.BlockCopy(saclBytes, 0, rebuilt, newSaclRel, saclBytes.Length);
            Buffer.BlockCopy(ownerBytes, 0, rebuilt, newOwnerRel, ownerBytes.Length);
            Buffer.BlockCopy(groupBytes, 0, rebuilt, newGroupRel, groupBytes.Length);

            // Round-trip parse to refuse corrupt output.
            var parsedOut = SecurityDescriptorParser.Parse(rebuilt, out var parseError);
            if (parsedOut is null)
                return Fail($"Rebuilt descriptor failed validation: {parseError}");

            return new RemoveAceResult
            {
                Success = true,
                SecurityDescriptor = rebuilt,
                RemovedCount = removed.Count,
                Changes = removed,
            };
        }
        catch (Exception ex)
        {
            return Fail($"Failed to rebuild security descriptor: {ex.Message}");
        }
    }

    public static bool TryParseAccessMask(string? raw, out uint mask, out string? error)
    {
        mask = 0;
        error = null;
        if (string.IsNullOrWhiteSpace(raw))
            return true;
        var s = raw.Trim();
        try
        {
            if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
                mask = uint.Parse(s[2..], NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            else
                mask = uint.Parse(s, NumberStyles.Integer, CultureInfo.InvariantCulture);
            return true;
        }
        catch
        {
            error = $"AccessMask '{raw}' is not a valid integer or 0x hex value.";
            return false;
        }
    }

    private static RemoveAceResult Fail(string error) =>
        new() { Success = false, Error = error };

    private static byte[]? CopySidBytes(byte[] buf, uint relativeOffset)
    {
        if (relativeOffset == 0 || relativeOffset + 8 > buf.Length)
            return null;
        var start = (int)relativeOffset;
        var subCount = buf[start + 1];
        var needed = 8 + subCount * 4;
        if (start + needed > buf.Length)
            return null;
        return buf.AsSpan(start, needed).ToArray();
    }

    private static byte[]? CopyAclBytes(byte[] buf, uint relativeOffset)
    {
        if (relativeOffset == 0 || relativeOffset + 8 > buf.Length)
            return null;
        var start = (int)relativeOffset;
        var aclSize = BitConverter.ToUInt16(buf, start + 4);
        if (aclSize < 8 || start + aclSize > buf.Length)
            return null;
        return buf.AsSpan(start, aclSize).ToArray();
    }

    private static byte[] BuildAcl(IReadOnlyList<byte[]> aces)
    {
        var body = 0;
        foreach (var a in aces)
            body += a.Length;
        var size = 8 + body;
        var acl = new byte[size];
        acl[0] = 2; // ACL revision for AD DACLs
        BitConverter.TryWriteBytes(acl.AsSpan(2, 2), (ushort)aces.Count);
        BitConverter.TryWriteBytes(acl.AsSpan(4, 2), (ushort)size);
        var offset = 8;
        foreach (var ace in aces)
        {
            Buffer.BlockCopy(ace, 0, acl, offset, ace.Length);
            offset += ace.Length;
        }

        return acl;
    }

    private static int ObjectAceSidOffset(byte[] ace)
    {
        if (ace.Length < 12)
            return -1;
        var flags = BitConverter.ToUInt32(ace, 8);
        var sidOffset = 12;
        if ((flags & 0x1) != 0)
            sidOffset += 16;
        if ((flags & 0x2) != 0)
            sidOffset += 16;
        if (sidOffset + 8 > ace.Length)
            return -1;
        return sidOffset;
    }
}
