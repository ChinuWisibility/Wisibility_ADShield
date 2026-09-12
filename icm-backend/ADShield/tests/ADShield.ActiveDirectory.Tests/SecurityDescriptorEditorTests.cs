using ADShield.ActiveDirectory;

namespace ADShield.ActiveDirectory.Tests;

public class SecurityDescriptorEditorTests
{
    [Fact]
    public void RemoveDaclAces_RemovesMatchingTrustee_AndRoundTrips()
    {
        var everyone = new byte[] { 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00 };
        // S-1-5-32-544 Administrators
        var admins = new byte[]
        {
            0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x20, 0x00, 0x00, 0x00, 0x20, 0x02, 0x00, 0x00,
        };
        var aceKeep = BuildAccessAllowedAce(0x10000000u, everyone);
        var aceDrop = BuildAccessAllowedAce(0x00040000u, admins); // WriteDacl
        var dacl = BuildAcl(aceKeep, aceDrop);

        var ownerRel = 20;
        var groupRel = ownerRel + everyone.Length;
        var daclRel = groupRel + everyone.Length;
        var sd = new byte[daclRel + dacl.Length];
        sd[0] = 1;
        BitConverter.TryWriteBytes(sd.AsSpan(2, 2), (ushort)0x8004);
        BitConverter.TryWriteBytes(sd.AsSpan(4, 4), (uint)ownerRel);
        BitConverter.TryWriteBytes(sd.AsSpan(8, 4), (uint)groupRel);
        BitConverter.TryWriteBytes(sd.AsSpan(12, 4), 0u);
        BitConverter.TryWriteBytes(sd.AsSpan(16, 4), (uint)daclRel);
        Buffer.BlockCopy(everyone, 0, sd, ownerRel, everyone.Length);
        Buffer.BlockCopy(everyone, 0, sd, groupRel, everyone.Length);
        Buffer.BlockCopy(dacl, 0, sd, daclRel, dacl.Length);

        var result = SecurityDescriptorEditor.RemoveDaclAces(sd, new SecurityDescriptorEditor.RemoveAceRequest
        {
            TrusteeSid = "S-1-5-32-544",
            AccessMask = 0x00040000u,
        });

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RemovedCount);
        Assert.NotNull(result.SecurityDescriptor);

        var parsed = SecurityDescriptorParser.Parse(result.SecurityDescriptor, out var err);
        Assert.Null(err);
        Assert.NotNull(parsed);
        Assert.Equal(1, parsed!.DaclAceCount);
        Assert.Equal("S-1-1-0", parsed.Aces[0].TrusteeSid);
        Assert.DoesNotContain(parsed.Aces, a => a.TrusteeSid.Equals("S-1-5-32-544", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void RemoveDaclAces_NoMatch_FailsWithoutMutation()
    {
        var everyone = new byte[] { 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00 };
        var ace = BuildAccessAllowedAce(0x10000000u, everyone);
        var dacl = BuildAcl(ace);
        var ownerRel = 20;
        var groupRel = ownerRel + everyone.Length;
        var daclRel = groupRel + everyone.Length;
        var sd = new byte[daclRel + dacl.Length];
        sd[0] = 1;
        BitConverter.TryWriteBytes(sd.AsSpan(2, 2), (ushort)0x8004);
        BitConverter.TryWriteBytes(sd.AsSpan(4, 4), (uint)ownerRel);
        BitConverter.TryWriteBytes(sd.AsSpan(8, 4), (uint)groupRel);
        BitConverter.TryWriteBytes(sd.AsSpan(16, 4), (uint)daclRel);
        Buffer.BlockCopy(everyone, 0, sd, ownerRel, everyone.Length);
        Buffer.BlockCopy(everyone, 0, sd, groupRel, everyone.Length);
        Buffer.BlockCopy(dacl, 0, sd, daclRel, dacl.Length);

        var result = SecurityDescriptorEditor.RemoveDaclAces(sd, new SecurityDescriptorEditor.RemoveAceRequest
        {
            TrusteeSid = "S-1-5-32-544",
        });

        Assert.False(result.Success);
        Assert.Contains("No DACL ACE matched", result.Error);
    }

    private static byte[] BuildAccessAllowedAce(uint accessMask, byte[] trusteeSid)
    {
        var size = 8 + trusteeSid.Length;
        var ace = new byte[size];
        ace[0] = 0x00;
        BitConverter.TryWriteBytes(ace.AsSpan(2, 2), (ushort)size);
        BitConverter.TryWriteBytes(ace.AsSpan(4, 4), accessMask);
        Buffer.BlockCopy(trusteeSid, 0, ace, 8, trusteeSid.Length);
        return ace;
    }

    private static byte[] BuildAcl(params byte[][] aces)
    {
        var body = aces.Sum(a => a.Length);
        var size = 8 + body;
        var acl = new byte[size];
        acl[0] = 2;
        BitConverter.TryWriteBytes(acl.AsSpan(2, 2), (ushort)aces.Length);
        BitConverter.TryWriteBytes(acl.AsSpan(4, 2), (ushort)size);
        var offset = 8;
        foreach (var ace in aces)
        {
            Buffer.BlockCopy(ace, 0, acl, offset, ace.Length);
            offset += ace.Length;
        }

        return acl;
    }
}
