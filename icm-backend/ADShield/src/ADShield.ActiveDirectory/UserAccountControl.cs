using ADShield.Models;

namespace ADShield.ActiveDirectory;

/// <summary>
/// AD userAccountControl flag bits (Microsoft docs) + helpers matching Node adSecurityHelpers.js.
/// </summary>
public static class UserAccountControl
{
    public const int AccountDisabled = 0x2;
    public const int Lockout = 0x10;
    public const int PasswdNotReqd = 0x20;
    public const int EncryptedTextPasswordAllowed = 0x80;
    public const int DontExpirePasswd = 0x10000;
    public const int SmartcardRequired = 0x40000;
    public const int TrustedForDelegation = 0x80000;
    public const int TrustedToAuthForDelegation = 0x1000000;
    public const int DontRequirePreauth = 0x400000;

    private static readonly long FiletimeUnixEpochOffset = 116444736000000000L;

    public static int Parse(string? uac)
    {
        if (string.IsNullOrWhiteSpace(uac))
            return 0;
        return int.TryParse(uac.Trim(), out var n) ? n : 0;
    }

    public static bool HasFlag(int uac, int flag) => (uac & flag) == flag;

    public static bool IsDisabled(int uac) => HasFlag(uac, AccountDisabled);

    public static bool IsLocked(int uac) => HasFlag(uac, Lockout);

    public static bool PasswordNeverExpires(int uac) => HasFlag(uac, DontExpirePasswd);

    public static bool PasswordNotRequired(int uac) => HasFlag(uac, PasswdNotReqd);

    public static bool ReversibleEncryptionEnabled(int uac) => HasFlag(uac, EncryptedTextPasswordAllowed);

    /// <summary>Risk when SMARTCARD_REQUIRED is not set.</summary>
    public static bool SmartcardNotRequired(int uac) => !HasFlag(uac, SmartcardRequired);

    public static bool IsTrustedForDelegation(int uac) => HasFlag(uac, TrustedForDelegation);

    public static bool IsTrustedToAuthForDelegation(int uac) => HasFlag(uac, TrustedToAuthForDelegation);

    public static bool IsDontRequirePreauth(int uac) => HasFlag(uac, DontRequirePreauth);

    public static int ClearFlag(int uac, int flag) => uac & ~flag;

    public static int SetFlag(int uac, int flag) => uac | flag;

    /// <summary>
    /// Inactive computer rule (Node isInactiveComputer): skip disabled;
    /// null/0 lastLogonTimestamp counts as never authenticated.
    /// </summary>
    public static bool IsInactiveComputer(string? lastLogonTimestamp, int days, int uac)
    {
        if (IsDisabled(uac))
            return false;
        if (string.IsNullOrWhiteSpace(lastLogonTimestamp) || lastLogonTimestamp.Trim() == "0")
            return true;
        var d = FiletimeToDate(lastLogonTimestamp);
        if (d is null)
            return true;
        return DateTimeOffset.UtcNow - d.Value >= TimeSpan.FromDays(days);
    }

    /// <summary>SPN shape validation aligned with Node isMalformedSpn / test.ps1.</summary>
    public static bool IsMalformedSpn(string? spn)
    {
        var s = (spn ?? string.Empty).Trim();
        if (s.Length == 0)
            return true;
        if (!s.Contains('/'))
            return true;
        if (s.StartsWith('/'))
            return true;
        if (s.EndsWith('/'))
            return true;
        if (s.Contains("://", StringComparison.Ordinal))
            return true;
        var parts = s.Split('/');
        if (parts.Length < 2)
            return true;
        if (string.IsNullOrWhiteSpace(parts[0]) || string.IsNullOrWhiteSpace(parts[1]))
            return true;
        return false;
    }

    private static readonly System.Text.RegularExpressions.Regex UnsupportedComputerOsRegex = new(
        @"Windows\s+(XP|Vista|7|8(\.1)?|Server\s+2003(\s+R2)?|Server\s+2008(\s+R2)?|Server\s+2012(\s+R2)?)",
        System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Compiled);

    public static bool IsUnsupportedComputerOperatingSystem(string? operatingSystem)
    {
        var os = (operatingSystem ?? string.Empty).Trim();
        return os.Length > 0 && UnsupportedComputerOsRegex.IsMatch(os);
    }

    public static bool IsAccountLockedByLockoutTime(string? lockoutTime)
    {
        if (string.IsNullOrWhiteSpace(lockoutTime))
            return false;
        return long.TryParse(lockoutTime.Trim(), out var v) && v > 0;
    }

    /// <summary>Classify like Node classifyAccountStatusRaw for numeric UAC.</summary>
    public static string ClassifyAccountStatus(int uac) =>
        IsDisabled(uac) ? "inactive" : "active";

    public static DateTimeOffset? FiletimeToDate(string? filetime)
    {
        if (string.IsNullOrWhiteSpace(filetime) || filetime.Trim() == "0")
            return null;
        if (!long.TryParse(filetime.Trim(), out var ft) || ft <= 0)
            return null;
        try
        {
            var ms = (ft - FiletimeUnixEpochOffset) / 10000L;
            return DateTimeOffset.FromUnixTimeMilliseconds(ms);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>True when lastLogon is older than <paramref name="days"/> (or missing → false, matching Node).</summary>
    public static bool IsOlderThanDays(string? lastLogonTimestamp, int days)
    {
        var d = FiletimeToDate(lastLogonTimestamp);
        if (d is null)
            return false;
        return DateTimeOffset.UtcNow - d.Value >= TimeSpan.FromDays(days);
    }

    public static string Attr(DirectorySearchHit hit, string name)
    {
        if (hit.Attributes.TryGetValue(name, out var vals) && vals.Count > 0)
            return vals[0] ?? string.Empty;
        return string.Empty;
    }

    public static IReadOnlyList<string> AttrAll(DirectorySearchHit hit, string name)
    {
        if (hit.Attributes.TryGetValue(name, out var vals))
            return vals;
        return Array.Empty<string>();
    }
}
