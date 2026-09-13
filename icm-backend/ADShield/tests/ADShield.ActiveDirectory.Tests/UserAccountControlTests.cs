using ADShield.ActiveDirectory;
using ADShield.Models;
using Xunit;

namespace ADShield.ActiveDirectory.Tests;

public sealed class UserAccountControlTests
{
    [Theory]
    [InlineData(514, true)]
    [InlineData(512, false)]
    public void IsDisabled_matches_uac_bit(int uac, bool expected)
        => Assert.Equal(expected, UserAccountControl.IsDisabled(uac));

    [Fact]
    public void ClearFlag_removes_dont_expire()
    {
        var uac = 512 | UserAccountControl.DontExpirePasswd;
        var next = UserAccountControl.ClearFlag(uac, UserAccountControl.DontExpirePasswd);
        Assert.False(UserAccountControl.PasswordNeverExpires(next));
        Assert.Equal(512, next);
    }

    [Fact]
    public void SmartcardNotRequired_when_bit_unset()
    {
        Assert.True(UserAccountControl.SmartcardNotRequired(512));
        Assert.False(UserAccountControl.SmartcardNotRequired(512 | UserAccountControl.SmartcardRequired));
    }

    [Fact]
    public void IsAccountLockedByLockoutTime_positive()
    {
        Assert.True(UserAccountControl.IsAccountLockedByLockoutTime("132000000000000000"));
        Assert.False(UserAccountControl.IsAccountLockedByLockoutTime("0"));
        Assert.False(UserAccountControl.IsAccountLockedByLockoutTime(null));
    }
}

public sealed class AccountFeatureCatalogTests
{
    private static readonly string[] AccountFeatures =
    [
        "disabled_users",
        "inactive_users",
        "locked_accounts",
        "password_never_expires",
        "password_not_required",
        "reversible_encryption_enabled",
        "smartcard_not_required",
        "service_accounts",
    ];

    [Fact]
    public void Catalog_marks_account_features_implemented_with_remediation()
    {
        foreach (var id in AccountFeatures)
        {
            var d = SecurityFeatureCatalog.Find(id);
            Assert.NotNull(d);
            Assert.True(d!.Implemented);
            Assert.True(d.RemediationSupported);
        }
    }

    [Fact]
    public void Catalog_marks_all_features_implemented()
    {
        Assert.Equal(41, SecurityFeatureCatalog.All.Count);
        Assert.Equal(41, SecurityFeatureCatalog.All.Count(f => f.Implemented));
        Assert.Equal(38, SecurityFeatureCatalog.All.Count(f => f.RemediationSupported));
        foreach (var id in new[] { "missing_os_information", "unsupported_os_versions", "delegation_exposure" })
        {
            var d = SecurityFeatureCatalog.Find(id);
            Assert.NotNull(d);
            Assert.True(d!.Implemented);
            Assert.False(d.RemediationSupported);
        }
    }
}
