namespace ADShield.ActiveDirectory;

/// <summary>
/// DN / search-base scoping helpers (IdentitySphere isAdObjectInSearchScope parity).
/// </summary>
public static class DnScope
{
    /// <summary>
    /// True when <paramref name="dn"/> is the search base or a descendant of it.
    /// Empty search base → everything in scope.
    /// </summary>
    public static bool IsUnderSearchBase(string? dn, string? searchBaseDn)
    {
        var baseDn = (searchBaseDn ?? string.Empty).Trim();
        if (baseDn.Length == 0)
            return true;

        var normalizedDn = (dn ?? string.Empty).Trim();
        if (normalizedDn.Length == 0)
            return false;

        if (normalizedDn.Equals(baseDn, StringComparison.OrdinalIgnoreCase))
            return true;

        return normalizedDn.EndsWith("," + baseDn, StringComparison.OrdinalIgnoreCase);
    }
}
