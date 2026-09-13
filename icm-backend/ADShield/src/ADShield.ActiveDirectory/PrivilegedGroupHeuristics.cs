namespace ADShield.ActiveDirectory;

/// <summary>Privileged-group name heuristics matching Node graphConstants.PRIVILEGED_NAME_TOKENS.</summary>
public static class PrivilegedGroupHeuristics
{
    public const int ToxicPrivilegeMinGroups = 2;
    public const int ExcessivePrivilegeThreshold = 5;

    public static readonly string[] NameTokens =
    [
        "domain admins",
        "enterprise admins",
        "schema admins",
        "administrators",
        "account operators",
        "backup operators",
        "server operators",
        "privileged",
        "admin",
    ];

    public static bool IsPrivilegedGroupName(string? name)
    {
        var n = (name ?? string.Empty).Trim().ToLowerInvariant();
        if (n.Length == 0)
            return false;
        return NameTokens.Any(t => n.Contains(t, StringComparison.Ordinal));
    }

    public static string NormalizeDn(string? dn) => (dn ?? string.Empty).Trim().ToLowerInvariant();
}
