using ADShield.ActiveDirectory;
using ADShield.Models;

namespace ADShield.ActiveDirectory.Tests;

public class WellKnownSidRecognizerTests
{
    [Theory]
    [InlineData("S-1-1-0")] // Everyone
    [InlineData("S-1-0-0")] // Null
    [InlineData("S-1-5-18")] // Local System
    [InlineData("S-1-5-19")] // Local Service
    [InlineData("S-1-5-20")] // Network Service
    public void WellKnownSids_AreRecognized(string sid)
    {
        var classification = WellKnownSidRecognizer.TryClassify(sid);
        Assert.NotNull(classification);
        Assert.NotEqual(SidClassification.Unknown, classification);
    }

    [Theory]
    [InlineData("S-1-5-32-544")] // Builtin Administrators
    [InlineData("S-1-5-32-545")] // Builtin Users
    [InlineData("S-1-5-32-554")] // Builtin Pre-Windows 2000 Compatible Access
    [InlineData("S-1-5-32-560")] // Builtin Windows Authorization Access Group
    public void BuiltinSids_AreRecognized(string sid)
    {
        var classification = WellKnownSidRecognizer.TryClassify(sid);
        Assert.Equal(SidClassification.KnownBuiltin, classification);
    }

    [Fact]
    public void DomainAdmins_RequiresMatchingDomainSid_NotRidAlone()
    {
        // RID 512 alone must not be trusted without domain context or LDAP.
        var foreignDomainAdmins = "S-1-5-21-111-222-333-512";
        Assert.Null(WellKnownSidRecognizer.TryClassify(foreignDomainAdmins, accountDomainSids: null));
        Assert.Null(WellKnownSidRecognizer.TryClassify(foreignDomainAdmins, Array.Empty<string>()));

        var domain = "S-1-5-21-111-222-333";
        var classified = WellKnownSidRecognizer.TryClassify(
            foreignDomainAdmins,
            new[] { domain });
        Assert.Equal(SidClassification.KnownDomainPrincipal, classified);
    }

    [Fact]
    public void TryGetAccountDomainSid_ExtractsDomain()
    {
        var domain = WellKnownSidRecognizer.TryGetAccountDomainSid(
            "S-1-5-21-2343654190-3174454252-2740366671-1001");
        Assert.Equal("S-1-5-21-2343654190-3174454252-2740366671", domain);
    }

    [Fact]
    public void InvalidSid_ReturnsNull()
    {
        Assert.Null(WellKnownSidRecognizer.TryClassify("not-a-sid"));
        Assert.Null(WellKnownSidRecognizer.TryClassify(""));
    }
}

public class SidResolutionEngineTests
{
    [Fact]
    public async Task CatalogSid_IsKnownWithoutLdap()
    {
        var lookups = 0;
        var engine = new SidResolutionEngine(
            catalogSids: ["S-1-5-21-1-2-3-1001"],
            accountDomainSids: ["S-1-5-21-1-2-3"],
            domainSearchBaseDn: "DC=example,DC=com",
            ldapLookup: (_, _, _) =>
            {
                lookups++;
                return Task.FromResult<SidLookupResult?>(null);
            });

        var result = await engine.ResolveAsync("S-1-5-21-1-2-3-1001");
        Assert.True(result.IsKnown);
        Assert.Equal(SidClassification.KnownDirectoryObject, result.Classification);
        Assert.Equal(0, lookups);
    }

    [Fact]
    public async Task WellKnownSid_DoesNotCallLdap()
    {
        var lookups = 0;
        var engine = new SidResolutionEngine(
            catalogSids: [],
            accountDomainSids: [],
            domainSearchBaseDn: "DC=example,DC=com",
            ldapLookup: (_, _, _) =>
            {
                lookups++;
                return Task.FromResult<SidLookupResult?>(null);
            });

        var result = await engine.ResolveAsync("S-1-1-0");
        Assert.True(result.IsKnown);
        Assert.Equal(0, lookups);
        Assert.True(engine.WellKnownSidCount >= 1);
    }

    [Fact]
    public async Task LdapLookup_ResolvesSidOutsideCatalog()
    {
        var engine = new SidResolutionEngine(
            catalogSids: ["S-1-5-21-1-2-3-1001"],
            accountDomainSids: ["S-1-5-21-1-2-3"],
            domainSearchBaseDn: "DC=example,DC=com",
            ldapLookup: (sid, baseDn, _) =>
            {
                Assert.Equal("DC=example,DC=com", baseDn);
                // Non-well-known RID — must require LDAP (not RID allowlist alone).
                if (sid == "S-1-5-21-1-2-3-7777")
                {
                    return Task.FromResult<SidLookupResult?>(new SidLookupResult
                    {
                        Sid = sid,
                        DistinguishedName = "CN=Extra User,CN=Users,DC=example,DC=com",
                        ObjectName = "extra",
                        ObjectClass = "user",
                    });
                }
                return Task.FromResult<SidLookupResult?>(null);
            });

        var result = await engine.ResolveAsync("S-1-5-21-1-2-3-7777");
        Assert.True(result.IsKnown);
        Assert.True(result.FromLdapLookup);
        Assert.Equal(1, engine.SidLookups);
    }

    [Fact]
    public async Task DomainAdmins_WithKnownDomain_ResolvedWithoutLdap()
    {
        var lookups = 0;
        var engine = new SidResolutionEngine(
            catalogSids: ["S-1-5-21-1-2-3-1001"],
            accountDomainSids: ["S-1-5-21-1-2-3"],
            domainSearchBaseDn: "DC=example,DC=com",
            ldapLookup: (_, _, _) =>
            {
                lookups++;
                return Task.FromResult<SidLookupResult?>(null);
            });

        var result = await engine.ResolveAsync("S-1-5-21-1-2-3-512");
        Assert.True(result.IsKnown);
        Assert.Equal(SidClassification.KnownDomainPrincipal, result.Classification);
        Assert.Equal(0, lookups);
    }

    [Fact]
    public async Task UnknownSid_RemainsUnknown()
    {
        var engine = new SidResolutionEngine(
            catalogSids: [],
            accountDomainSids: [],
            domainSearchBaseDn: "DC=example,DC=com",
            ldapLookup: (_, _, _) => Task.FromResult<SidLookupResult?>(null));

        var result = await engine.ResolveAsync("S-1-5-21-9-9-9-99999");
        Assert.False(result.IsKnown);
        Assert.Equal(SidClassification.Unknown, result.Classification);
        Assert.Equal(1, engine.SidUnknown);
    }

    [Fact]
    public async Task DuplicateResolve_HitsCache()
    {
        var lookups = 0;
        var engine = new SidResolutionEngine(
            catalogSids: [],
            accountDomainSids: [],
            domainSearchBaseDn: "DC=example,DC=com",
            ldapLookup: (sid, _, _) =>
            {
                lookups++;
                return Task.FromResult<SidLookupResult?>(new SidLookupResult
                {
                    Sid = sid,
                    DistinguishedName = "CN=x,DC=example,DC=com",
                    ObjectName = "x",
                    ObjectClass = "user",
                });
            });

        await engine.ResolveAsync("S-1-5-21-1-2-3-7777");
        await engine.ResolveAsync("S-1-5-21-1-2-3-7777");
        Assert.Equal(1, lookups);
        Assert.Equal(1, engine.CacheHits);
    }

    [Fact]
    public async Task MaxObjectsCatalog_DoesNotBlockDomainSidResolution()
    {
        // Catalog only has one low-privilege user (simulating small maxObjects page).
        var engine = new SidResolutionEngine(
            catalogSids: ["S-1-5-21-1-2-3-1100"],
            accountDomainSids: ["S-1-5-21-1-2-3"],
            domainSearchBaseDn: "DC=example,DC=com",
            ldapLookup: (sid, _, _) =>
            {
                if (sid.EndsWith("-512", StringComparison.Ordinal))
                {
                    return Task.FromResult<SidLookupResult?>(new SidLookupResult
                    {
                        Sid = sid,
                        DistinguishedName = "CN=Domain Admins,CN=Users,DC=example,DC=com",
                        ObjectName = "Domain Admins",
                        ObjectClass = "group",
                    });
                }
                return Task.FromResult<SidLookupResult?>(null);
            });

        var result = await engine.ResolveAsync("S-1-5-21-1-2-3-512");
        Assert.True(result.IsKnown);
        Assert.True(engine.IsKnown("S-1-5-21-1-2-3-512"));
    }

    [Fact]
    public void BinarySidRoundTrip_MatchesSecurityDescriptorParser()
    {
        // S-1-1-0 Everyone
        byte[] everyone = [0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00];
        var sddl = SecurityDescriptorParser.ParseSid(everyone);
        Assert.Equal("S-1-1-0", sddl);
        var bytes = LdapActiveDirectoryClient.SidStringToBytes(sddl);
        Assert.NotNull(bytes);
        Assert.Equal(everyone, bytes);
    }
}
