using ADShield.ActiveDirectory;
using ADShield.Models;

namespace ADShield.ActiveDirectory.Tests;

public class ShadowAdminAclDetectorTests
{
    private static SecurableDirectoryObject Target(
        string sid,
        string name,
        string type,
        params AceInfo[] aces) =>
        new()
        {
            ObjectSid = sid,
            ObjectName = name,
            ObjectType = type,
            DistinguishedName = $"CN={name},DC=example,DC=com",
            DescriptorFound = true,
            ParsedSd = new ParsedSecurityDescriptor
            {
                DaclPresent = true,
                DaclAceCount = aces.Length,
                Aces = aces,
            },
        };

    private static AceInfo Allow(string trustee, uint mask, string aclType = "DACL") =>
        new()
        {
            AclType = aclType,
            AceType = 0x00,
            IsAllowed = true,
            AccessMask = mask,
            TrusteeSid = trustee,
        };

    private static AceInfo Deny(string trustee, uint mask) =>
        new()
        {
            AclType = "DACL",
            AceType = 0x01,
            IsAllowed = false,
            IsDenied = true,
            AccessMask = mask,
            TrusteeSid = trustee,
        };

    private static SidResolutionEngine Engine(
        Dictionary<string, SidLookupResult>? ldap = null,
        IEnumerable<string>? catalog = null)
    {
        ldap ??= new Dictionary<string, SidLookupResult>(StringComparer.OrdinalIgnoreCase);
        return new SidResolutionEngine(
            catalog ?? [],
            ["S-1-5-21-1-2-3"],
            "DC=example,DC=com",
            (sid, _, _) =>
            {
                ldap.TryGetValue(sid, out var hit);
                return Task.FromResult(hit);
            });
    }

    private static SidLookupResult User(string sid, string name) =>
        new()
        {
            Sid = sid,
            DistinguishedName = $"CN={name},OU=Users,DC=example,DC=com",
            ObjectName = name,
            ObjectClass = "user",
        };

    private static SidLookupResult Group(string sid, string name) =>
        new()
        {
            Sid = sid,
            DistinguishedName = $"CN={name},CN=Users,DC=example,DC=com",
            ObjectName = name,
            ObjectClass = "group",
        };

    [Theory]
    [InlineData(ShadowAdminAccessRights.GenericAll, "GenericAll")]
    [InlineData(ShadowAdminAccessRights.GenericWrite, "GenericWrite")]
    [InlineData(ShadowAdminAccessRights.WriteDac, "WriteDACL")]
    [InlineData(ShadowAdminAccessRights.WriteOwner, "WriteOwner")]
    public async Task DangerousAllowAce_OnPrivilegedGroup_EmitsFinding(uint mask, string rightLabel)
    {
        const string trustee = "S-1-5-21-1-2-3-1105";
        const string target = "S-1-5-21-1-2-3-512";
        var engine = Engine(new Dictionary<string, SidLookupResult>
        {
            [trustee] = User(trustee, "alice"),
        });
        var objects = new[]
        {
            Target(target, "Domain Admins", "group", Allow(trustee, mask)),
        };
        var privileged = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { target };
        var diag = new ShadowAdminAclDetector.DetectionDiagnostics();

        var findings = await ShadowAdminAclDetector.DetectAsync(
            "scan-1", objects, engine, privileged, "DC=example,DC=com", diag);

        Assert.Single(findings);
        var f = findings[0];
        Assert.Equal("shadow_admins", f.Feature);
        Assert.Equal("acl_derived_shadow_admin", f.Status);
        Assert.Equal("SHADOW_ADMIN", f.FindingType);
        Assert.Contains("SHADOW_ADMIN", f.FindingSignals);
        Assert.Contains("PRIVILEGED_USER", f.FindingSignals);
        Assert.Equal("user", f.ObjectType);
        Assert.Equal("alice", f.ObjectName);
        var rights = Assert.IsAssignableFrom<IEnumerable<string>>(f.Evidence["rights"]);
        Assert.Equal(new[] { rightLabel }, rights.ToArray());
        Assert.Equal(1, diag.ShadowAdminAclHits);
    }

    [Fact]
    public async Task DeniedAce_NoFinding()
    {
        const string trustee = "S-1-5-21-1-2-3-1105";
        const string target = "S-1-5-21-1-2-3-512";
        var engine = Engine(new Dictionary<string, SidLookupResult>
        {
            [trustee] = User(trustee, "alice"),
        });
        var objects = new[]
        {
            Target(target, "Domain Admins", "group",
                Deny(trustee, ShadowAdminAccessRights.GenericAll)),
        };
        var privileged = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { target };
        var diag = new ShadowAdminAclDetector.DetectionDiagnostics();

        var findings = await ShadowAdminAclDetector.DetectAsync(
            "scan-1", objects, engine, privileged, null, diag);
        Assert.Empty(findings);
    }

    [Fact]
    public async Task PrivilegedUserTrustee_Skipped()
    {
        const string trustee = "S-1-5-21-1-2-3-1105";
        const string target = "S-1-5-21-1-2-3-512";
        var engine = Engine(new Dictionary<string, SidLookupResult>
        {
            [trustee] = User(trustee, "Domain Admin Helper"),
        });
        var objects = new[]
        {
            Target(target, "Domain Admins", "group",
                Allow(trustee, ShadowAdminAccessRights.GenericAll)),
        };
        // Trustee marked privileged by SID set (Node isPrivilegedSid parity).
        var privileged = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            target,
            trustee,
        };
        var diag = new ShadowAdminAclDetector.DetectionDiagnostics();

        var findings = await ShadowAdminAclDetector.DetectAsync(
            "scan-1", objects, engine, privileged, null, diag);
        Assert.Empty(findings);
    }

    [Fact]
    public async Task GroupTrustee_Ignored()
    {
        const string trustee = "S-1-5-21-1-2-3-1200";
        const string target = "S-1-5-21-1-2-3-512";
        var engine = Engine(new Dictionary<string, SidLookupResult>
        {
            [trustee] = Group(trustee, "Helpdesk"),
        });
        var objects = new[]
        {
            Target(target, "Domain Admins", "group",
                Allow(trustee, ShadowAdminAccessRights.GenericAll)),
        };
        var privileged = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { target };
        var diag = new ShadowAdminAclDetector.DetectionDiagnostics();

        var findings = await ShadowAdminAclDetector.DetectAsync(
            "scan-1", objects, engine, privileged, null, diag);
        Assert.Empty(findings);
    }

    [Fact]
    public async Task UnknownTrustee_NoFinding()
    {
        const string trustee = "S-1-5-21-9-9-9-99999";
        const string target = "S-1-5-21-1-2-3-512";
        var engine = Engine();
        var objects = new[]
        {
            Target(target, "Domain Admins", "group",
                Allow(trustee, ShadowAdminAccessRights.GenericAll)),
        };
        var privileged = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { target };
        var diag = new ShadowAdminAclDetector.DetectionDiagnostics();

        var findings = await ShadowAdminAclDetector.DetectAsync(
            "scan-1", objects, engine, privileged, null, diag);
        Assert.Empty(findings);
    }

    [Fact]
    public async Task SameAce_ProcessedOnce()
    {
        const string trustee = "S-1-5-21-1-2-3-1105";
        const string target = "S-1-5-21-1-2-3-512";
        var engine = Engine(new Dictionary<string, SidLookupResult>
        {
            [trustee] = User(trustee, "alice"),
        });
        var ace = Allow(trustee, ShadowAdminAccessRights.GenericAll);
        var objects = new[]
        {
            Target(target, "Domain Admins", "group", ace, ace),
        };
        var privileged = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { target };
        var diag = new ShadowAdminAclDetector.DetectionDiagnostics();

        var findings = await ShadowAdminAclDetector.DetectAsync(
            "scan-1", objects, engine, privileged, null, diag);
        Assert.Single(findings);
    }

    [Fact]
    public async Task SacL_AllowAce_EmitsFinding_ParityWithNode()
    {
        const string trustee = "S-1-5-21-1-2-3-1105";
        const string target = "S-1-5-21-1-2-3-512";
        var engine = Engine(new Dictionary<string, SidLookupResult>
        {
            [trustee] = User(trustee, "alice"),
        });
        var objects = new[]
        {
            Target(target, "Domain Admins", "group",
                Allow(trustee, ShadowAdminAccessRights.WriteDac, "SACL")),
        };
        var privileged = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { target };
        var diag = new ShadowAdminAclDetector.DetectionDiagnostics();

        var findings = await ShadowAdminAclDetector.DetectAsync(
            "scan-1", objects, engine, privileged, null, diag);
        Assert.Single(findings);
        Assert.Equal("SACL", findings[0].Evidence["aclType"]);
    }

    [Fact]
    public async Task NonPrivilegedTarget_NoFinding()
    {
        const string trustee = "S-1-5-21-1-2-3-1105";
        const string target = "S-1-5-21-1-2-3-2000";
        var engine = Engine(new Dictionary<string, SidLookupResult>
        {
            [trustee] = User(trustee, "alice"),
        });
        var objects = new[]
        {
            Target(target, "Regular Users", "group",
                Allow(trustee, ShadowAdminAccessRights.GenericAll)),
        };
        var privileged = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var diag = new ShadowAdminAclDetector.DetectionDiagnostics();

        var findings = await ShadowAdminAclDetector.DetectAsync(
            "scan-1", objects, engine, privileged, null, diag);
        Assert.Empty(findings);
    }

    [Fact]
    public async Task TrusteeOutsideSearchBase_Skipped()
    {
        const string trustee = "S-1-5-21-1-2-3-1105";
        const string target = "S-1-5-21-1-2-3-512";
        var engine = Engine(new Dictionary<string, SidLookupResult>
        {
            [trustee] = new SidLookupResult
            {
                Sid = trustee,
                DistinguishedName = "CN=alice,OU=Other,DC=example,DC=com",
                ObjectName = "alice",
                ObjectClass = "user",
            },
        });
        var objects = new[]
        {
            Target(target, "Domain Admins", "group",
                Allow(trustee, ShadowAdminAccessRights.GenericAll)),
        };
        var privileged = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { target };
        var diag = new ShadowAdminAclDetector.DetectionDiagnostics();

        var findings = await ShadowAdminAclDetector.DetectAsync(
            "scan-1",
            objects,
            engine,
            privileged,
            "OU=Users,DC=example,DC=com",
            diag);
        Assert.Empty(findings);
    }

    [Fact]
    public async Task SidResolution_CacheReused()
    {
        const string trustee = "S-1-5-21-1-2-3-1105";
        var lookups = 0;
        var engine = new SidResolutionEngine(
            [],
            ["S-1-5-21-1-2-3"],
            "DC=example,DC=com",
            (sid, _, _) =>
            {
                lookups++;
                return Task.FromResult<SidLookupResult?>(User(trustee, "alice"));
            });

        await engine.ResolveAsync(trustee);
        await engine.ResolveAsync(trustee);
        Assert.Equal(1, lookups);
        Assert.Equal(1, engine.CacheHits);
    }

    [Fact]
    public void PrivilegedTarget_RecognizedByName()
    {
        var obj = Target("S-1-5-21-1-2-3-999", "Enterprise Admins", "group");
        Assert.True(ShadowAdminAclDetector.IsPrivilegedTarget(
            obj, new HashSet<string>(StringComparer.OrdinalIgnoreCase)));
    }

    [Fact]
    public void BuildPrivilegedSidCandidates_IncludesDomainAdminsRid()
    {
        var set = ShadowAdminAclDetector.BuildPrivilegedSidCandidates(
            [],
            [],
            ["S-1-5-21-1-2-3"]);
        Assert.Contains("S-1-5-21-1-2-3-512", set);
        Assert.Contains("S-1-5-32-544", set);
    }

    [Fact]
    public void DnScope_RespectsSearchBase()
    {
        Assert.True(DnScope.IsUnderSearchBase(
            "CN=a,OU=Users,DC=example,DC=com",
            "OU=Users,DC=example,DC=com"));
        Assert.False(DnScope.IsUnderSearchBase(
            "CN=a,OU=Other,DC=example,DC=com",
            "OU=Users,DC=example,DC=com"));
    }
}
