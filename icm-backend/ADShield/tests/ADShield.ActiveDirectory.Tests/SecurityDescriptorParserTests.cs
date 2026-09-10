using ADShield.ActiveDirectory;

namespace ADShield.ActiveDirectory.Tests;

public class SecurityDescriptorParserTests
{
    [Fact]
    public void ParseSid_WellKnownWorld_Succeeds()
    {
        // S-1-1-0 (Everyone)
        byte[] sid = [0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00];
        Assert.Equal("S-1-1-0", SecurityDescriptorParser.ParseSid(sid));
    }

    [Fact]
    public void Parse_MinimalSelfRelativeDescriptor_WithAllowAce_Succeeds()
    {
        // Build a minimal self-relative SD:
        // Owner SID S-1-1-0, Group SID S-1-1-0, DACL with one ACCESS_ALLOWED ACE (GenericAll) for S-1-1-0
        var ownerSid = new byte[] { 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00 };
        var groupSid = ownerSid.ToArray();
        var ace = BuildAccessAllowedAce(0x10000000u, ownerSid); // GenericAll
        var dacl = BuildAcl(ace);

        // Layout: header(20) + owner + group + dacl
        var ownerRel = 20;
        var groupRel = ownerRel + ownerSid.Length;
        var daclRel = groupRel + groupSid.Length;
        var total = daclRel + dacl.Length;

        var sd = new byte[total];
        sd[0] = 1; // revision
        // control: SE_DACL_PRESENT (0x0004) | SE_SELF_RELATIVE (0x8000)
        BitConverter.TryWriteBytes(sd.AsSpan(2, 2), (ushort)0x8004);
        BitConverter.TryWriteBytes(sd.AsSpan(4, 4), (uint)ownerRel);
        BitConverter.TryWriteBytes(sd.AsSpan(8, 4), (uint)groupRel);
        BitConverter.TryWriteBytes(sd.AsSpan(12, 4), 0u); // no SACL
        BitConverter.TryWriteBytes(sd.AsSpan(16, 4), (uint)daclRel);
        Buffer.BlockCopy(ownerSid, 0, sd, ownerRel, ownerSid.Length);
        Buffer.BlockCopy(groupSid, 0, sd, groupRel, groupSid.Length);
        Buffer.BlockCopy(dacl, 0, sd, daclRel, dacl.Length);

        var parsed = SecurityDescriptorParser.Parse(sd, out var error);

        Assert.Null(error);
        Assert.NotNull(parsed);
        Assert.True(parsed!.SelfRelative);
        Assert.True(parsed.DaclPresent);
        Assert.Equal(1, parsed.DaclHeaderAceCount);
        Assert.Equal("S-1-1-0", parsed.OwnerSid);
        Assert.Equal("S-1-1-0", parsed.GroupSid);
        Assert.Equal(1, parsed.DaclAceCount);
        Assert.Single(parsed.Aces);
        Assert.True(parsed.Aces[0].IsAllowed);
        Assert.Equal("ACCESS_ALLOWED", parsed.Aces[0].AceTypeName);
        Assert.Equal(0x10000000u, parsed.Aces[0].AccessMask);
        Assert.Contains("GenericAll", parsed.Aces[0].Rights);
        Assert.Equal("S-1-1-0", parsed.Aces[0].TrusteeSid);
    }

    private static byte[] BuildAccessAllowedAce(uint accessMask, byte[] trusteeSid)
    {
        var size = 8 + trusteeSid.Length; // type,flags,size,mask + sid
        var ace = new byte[size];
        ace[0] = 0x00; // ACCESS_ALLOWED
        ace[1] = 0x00;
        BitConverter.TryWriteBytes(ace.AsSpan(2, 2), (ushort)size);
        BitConverter.TryWriteBytes(ace.AsSpan(4, 4), accessMask);
        Buffer.BlockCopy(trusteeSid, 0, ace, 8, trusteeSid.Length);
        return ace;
    }

    private static byte[] BuildAcl(byte[] ace)
    {
        var size = 8 + ace.Length;
        var acl = new byte[size];
        acl[0] = 2; // ACL revision
        BitConverter.TryWriteBytes(acl.AsSpan(2, 2), (ushort)1); // AceCount
        BitConverter.TryWriteBytes(acl.AsSpan(4, 2), (ushort)size);
        Buffer.BlockCopy(ace, 0, acl, 8, ace.Length);
        return acl;
    }
}
