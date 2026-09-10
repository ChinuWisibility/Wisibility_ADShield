using ADShield.Models;

namespace ADShield.ActiveDirectory;

/// <summary>
/// Live ACL shadow-admin detection — parity with detectAclShadowAdminRights.js.
/// Finding feature is always <c>shadow_admins</c> (IdentitySphere contract).
/// </summary>
public static class ShadowAdminAclDetector
{
    /// <summary>
    /// Privileged name tokens — same set as IdentitySphere PRIVILEGED_NAME_TOKENS /
    /// AclAnalysisService.PrivilegedNameTokens.
    /// </summary>
    public static readonly string[] PrivilegedNameTokens =
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

    /// <summary>
    /// Domain-relative RIDs treated as privileged group/object targets when the
    /// account domain SID is known (not trusted from RID alone).
    /// </summary>
    public static readonly string[] PrivilegedDomainRelativeRids =
    [
        "512", // Domain Admins
        "516", // Domain Controllers
        "518", // Schema Admins
        "519", // Enterprise Admins
        "520", // Group Policy Creator Owners
        "544", // (not domain — Builtin handled separately)
    ];

    public static readonly string[] BuiltinPrivilegedSids =
    [
        "S-1-5-32-544", // Administrators
        "S-1-5-32-548", // Account Operators
        "S-1-5-32-549", // Server Operators
        "S-1-5-32-551", // Backup Operators
    ];

    public sealed class DetectionDiagnostics
    {
        public int TargetsConsidered { get; set; }
        public int PrivilegedTargetsResolved { get; set; }
        public int TrusteeUsersConsidered { get; set; }
        public int ShadowAdminAclHits { get; set; }
    }

    public static bool IsPrivilegedName(string? name)
    {
        var n = (name ?? string.Empty).ToLowerInvariant().Replace(" ", "", StringComparison.Ordinal);
        return PrivilegedNameTokens.Any(t =>
            n.Contains(t.Replace(" ", "", StringComparison.Ordinal), StringComparison.Ordinal));
    }

    public static bool IsPrivilegedTarget(
        SecurableDirectoryObject obj,
        IReadOnlySet<string> privilegedSids)
    {
        if (IsPrivilegedName(obj.ObjectName))
            return true;
        var sid = LdapActiveDirectoryClient.NormalizeSid(obj.ObjectSid);
        return !string.IsNullOrEmpty(sid) && privilegedSids.Contains(sid);
    }

    public static bool IsPrivilegedTrustee(
        string trusteeSid,
        string? trusteeName,
        IReadOnlySet<string> privilegedSids)
    {
        if (privilegedSids.Contains(LdapActiveDirectoryClient.NormalizeSid(trusteeSid)))
            return true;
        return IsPrivilegedName(trusteeName);
    }

    /// <summary>
    /// Detect ACL-derived shadow admins.
    /// </summary>
    /// <param name="trusteeSearchBaseDn">
    /// Trustee user DN must fall under this base (IdentitySphere search-base scope).
    /// Empty = no trustee DN filter.
    /// </param>
    /// <param name="usersBySid">
    /// Optional index of user objects from the live scan (Node "synced user" parity).
    /// </param>
    public static async Task<List<DiscoveryFindingDto>> DetectAsync(
        string scanId,
        IReadOnlyList<SecurableDirectoryObject> objects,
        SidResolutionEngine sidEngine,
        IReadOnlySet<string> privilegedSids,
        string? trusteeSearchBaseDn,
        DetectionDiagnostics diagnostics,
        IReadOnlyDictionary<string, SecurableDirectoryObject>? usersBySid = null,
        CancellationToken cancellationToken = default)
    {
        var findings = new List<DiscoveryFindingDto>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        diagnostics.TargetsConsidered = objects.Count;
        usersBySid ??= new Dictionary<string, SecurableDirectoryObject>(StringComparer.OrdinalIgnoreCase);

        foreach (var obj in objects)
        {
            if (!IsPrivilegedTarget(obj, privilegedSids))
                continue;

            var parsed = obj.ParsedSd;
            if (parsed is null)
                continue;

            foreach (var ace in parsed.Aces)
            {
                // Node: ace.isAllowed && hasShadowAdminRights — DACL+SACL via flattened Aces.
                if (!ace.IsAllowed || !ShadowAdminAccessRights.HasShadowAdminRights(ace.AccessMask))
                    continue;

                var trusteeSid = LdapActiveDirectoryClient.NormalizeSid(ace.TrusteeSid);
                if (string.IsNullOrEmpty(trusteeSid))
                    continue;

                string? trusteeName = null;
                string? trusteeDn = null;
                var isUser = false;

                if (usersBySid.TryGetValue(trusteeSid, out var userObj))
                {
                    isUser = true;
                    trusteeName = userObj.ObjectName;
                    trusteeDn = userObj.DistinguishedName;
                }
                else
                {
                    var resolved = await sidEngine.ResolveAsync(trusteeSid, cancellationToken)
                        .ConfigureAwait(false);
                    if (!IsUserTrustee(resolved))
                        continue;
                    isUser = true;
                    trusteeName = resolved.ObjectName;
                    trusteeDn = resolved.DistinguishedName;
                }

                if (!isUser)
                    continue;

                diagnostics.TrusteeUsersConsidered++;

                if (!DnScope.IsUnderSearchBase(trusteeDn, trusteeSearchBaseDn))
                    continue;

                if (IsPrivilegedTrustee(trusteeSid, trusteeName, privilegedSids))
                    continue;

                var sig = $"{trusteeSid}|{obj.ObjectSid}|{ace.AccessMask}";
                if (!seen.Add(sig))
                    continue;

                var rights = ShadowAdminAccessRights.DescribeDangerousRights(ace.AccessMask);
                var sourceName = string.IsNullOrWhiteSpace(trusteeName) ? trusteeSid : trusteeName!;
                var targetName = string.IsNullOrWhiteSpace(obj.ObjectName)
                    ? obj.DistinguishedName
                    : obj.ObjectName;

                findings.Add(new DiscoveryFindingDto
                {
                    ScanId = scanId,
                    Feature = "shadow_admins",
                    ObjectType = "user",
                    ObjectName = sourceName,
                    Dn = trusteeDn ?? string.Empty,
                    Status = "acl_derived_shadow_admin",
                    Attributes = new Dictionary<string, object?>(),
                    Evidence = new Dictionary<string, object?>
                    {
                        ["detection"] = "acl_derived_privilege_path",
                        ["trusteeSid"] = trusteeSid,
                        ["targetSid"] = LdapActiveDirectoryClient.NormalizeSid(obj.ObjectSid),
                        ["targetDn"] = obj.DistinguishedName,
                        ["targetType"] = obj.ObjectType,
                        ["accessMask"] = ace.AccessMask,
                        ["rights"] = rights,
                        ["aclType"] = ace.AclType,
                    },
                    Relationships =
                    [
                        new Dictionary<string, object?>
                        {
                            ["type"] = "ACL_GRANT",
                            ["source"] = sourceName,
                            ["target"] = targetName,
                            ["rights"] = rights,
                        },
                    ],
                    FindingType = "SHADOW_ADMIN",
                    FindingSignals = ["SHADOW_ADMIN", "PRIVILEGED_USER"],
                });
                diagnostics.ShadowAdminAclHits++;
            }
        }

        return findings;
    }

    public static bool IsUserTrustee(SidResolutionResult resolved)
    {
        if (!resolved.IsKnown)
            return false;

        if (resolved.Classification is SidClassification.KnownWellKnown
            or SidClassification.KnownBuiltin)
            return false;

        if (resolved.Classification is SidClassification.KnownForeignPrincipal)
            return false;

        var oc = (resolved.ObjectClass ?? string.Empty).ToLowerInvariant();
        if (oc.Contains("group", StringComparison.Ordinal))
            return false;
        if (oc.Contains("foreignsecurityprincipal", StringComparison.Ordinal))
            return false;
        if (oc.Contains("computer", StringComparison.Ordinal))
            return false;

        return oc.Contains("user", StringComparison.Ordinal)
               || oc.Contains("person", StringComparison.Ordinal);
    }

    /// <summary>
    /// Build candidate privileged SIDs: request list + Builtin privileged + domain RID groups.
    /// </summary>
    public static HashSet<string> BuildPrivilegedSidCandidates(
        IEnumerable<string?> scannedObjectSids,
        IEnumerable<string?> requestPrivilegedSids,
        IEnumerable<string> accountDomainSids)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var sid in requestPrivilegedSids)
        {
            var n = LdapActiveDirectoryClient.NormalizeSid(sid);
            if (!string.IsNullOrEmpty(n))
                set.Add(n);
        }

        foreach (var sid in BuiltinPrivilegedSids)
            set.Add(sid);

        foreach (var domain in accountDomainSids)
        {
            var d = LdapActiveDirectoryClient.NormalizeSid(domain);
            if (string.IsNullOrEmpty(d))
                continue;
            foreach (var rid in PrivilegedDomainRelativeRids)
            {
                if (rid == "544")
                    continue; // Builtin, not domain
                set.Add($"{d}-{rid}");
            }
        }

        // Also mark scanned name-privileged objects' SIDs.
        foreach (var sid in scannedObjectSids)
        {
            var n = LdapActiveDirectoryClient.NormalizeSid(sid);
            if (!string.IsNullOrEmpty(n))
            {
                // Only add if already privileged candidate — name check happens on objects.
            }
        }

        return set;
    }
}
