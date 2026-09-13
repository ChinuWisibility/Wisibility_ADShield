using System.Diagnostics;
using System.DirectoryServices.Protocols;
using ADShield.ActiveDirectory;
using ADShield.Configuration;
using ADShield.Models;
using Microsoft.Extensions.Logging;

namespace ADShield.Application.Services;

public interface IPostureAnalysisService
{
    Task<PostureAnalysisResult> AnalyzeAsync(
        PostureAnalysisRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Live Security Posture detectors for groups, privileged access, computers,
/// Kerberos, and delegation (Node posture module parity).
/// </summary>
public sealed class PostureAnalysisService : IPostureAnalysisService
{
    public static readonly string[] SupportedFeatures =
    [
        "empty_groups",
        "groups_without_owners",
        "nested_groups",
        "circular_memberships",
        "unused_groups",
        "orphan_groups",
        "duplicate_groups",
        "toxic_privilege_combinations",
        "nested_privileged_access",
        "dormant_privileged_users",
        "excessive_privileges",
        "privilege_escalation_paths",
        "disabled_computers",
        "inactive_computers",
        "missing_os_information",
        "unsupported_os_versions",
        "servers_in_wrong_ou",
        "duplicate_spns",
        "computers_without_owners",
        "kerberoastable_accounts",
        "asrep_roastable_users",
        "preauth_disabled",
        "spn_misconfigurations",
        "unconstrained_delegation",
        "constrained_delegation",
        "rbcd",
        "delegation_exposure",
    ];

    private static readonly string[] GroupAttributes =
    [
        "distinguishedName",
        "sAMAccountName",
        "cn",
        "description",
        "member",
        "memberOf",
        "managedBy",
        "objectSid",
        "objectClass",
    ];

    private static readonly string[] UserAttributes =
    [
        "distinguishedName",
        "sAMAccountName",
        "displayName",
        "cn",
        "userAccountControl",
        "lastLogonTimestamp",
        "servicePrincipalName",
        "memberOf",
        "objectSid",
        "objectClass",
        "msDS-AllowedToDelegateTo",
    ];

    private static readonly string[] ComputerAttributes =
    [
        "distinguishedName",
        "sAMAccountName",
        "cn",
        "userAccountControl",
        "lastLogonTimestamp",
        "operatingSystem",
        "operatingSystemVersion",
        "servicePrincipalName",
        "managedBy",
        "objectSid",
        "objectClass",
        "msDS-AllowedToDelegateTo",
        "msDS-AllowedToActOnBehalfOfOtherIdentity",
    ];

    private static readonly HashSet<string> GroupFeatures = new(StringComparer.Ordinal)
    {
        "empty_groups",
        "groups_without_owners",
        "nested_groups",
        "circular_memberships",
        "unused_groups",
        "orphan_groups",
        "duplicate_groups",
        "toxic_privilege_combinations",
        "nested_privileged_access",
        "dormant_privileged_users",
        "excessive_privileges",
        "privilege_escalation_paths",
    };

    private static readonly HashSet<string> UserFeatures = new(StringComparer.Ordinal)
    {
        "toxic_privilege_combinations",
        "dormant_privileged_users",
        "excessive_privileges",
        "privilege_escalation_paths",
        "kerberoastable_accounts",
        "asrep_roastable_users",
        "preauth_disabled",
        "spn_misconfigurations",
        "unconstrained_delegation",
        "constrained_delegation",
        "delegation_exposure",
    };

    private static readonly HashSet<string> ComputerFeatures = new(StringComparer.Ordinal)
    {
        "disabled_computers",
        "inactive_computers",
        "missing_os_information",
        "unsupported_os_versions",
        "servers_in_wrong_ou",
        "duplicate_spns",
        "computers_without_owners",
        "spn_misconfigurations",
        "unconstrained_delegation",
        "constrained_delegation",
        "rbcd",
        "delegation_exposure",
    };

    private static readonly string[] DefaultWorkstationOuPatterns =
    [
        "ou=workstations",
        "ou=clients",
        "ou=desktops",
        "ou=laptops",
        "ou=desktop",
        "ou=computers",
    ];

    private const string DefaultGroupFilter = "(objectClass=group)";
    private const string DefaultUserFilter = "(&(objectCategory=person)(objectClass=user))";
    private const string DefaultComputerFilter = "(objectClass=computer)";

    private readonly IActiveDirectoryClientFactory _clientFactory;
    private readonly ILogger<PostureAnalysisService> _logger;

    public PostureAnalysisService(
        IActiveDirectoryClientFactory clientFactory,
        ILogger<PostureAnalysisService> logger)
    {
        _clientFactory = clientFactory;
        _logger = logger;
    }

    public async Task<PostureAnalysisResult> AnalyzeAsync(
        PostureAnalysisRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var connection = request.Connection ?? new ActiveDirectoryConnectionOptions();
        connection.EnsureNormalized();
        var validation = ActiveDirectoryConnectionOptionsValidator.Validate(connection);
        if (validation.Count > 0)
        {
            return new PostureAnalysisResult { Success = false, Errors = validation };
        }

        var requested = (request.Features ?? Array.Empty<string>())
            .Select(f => (f ?? string.Empty).Trim())
            .Where(f => f.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var features = requested
            .Where(f => SupportedFeatures.Contains(f, StringComparer.Ordinal))
            .ToList();

        if (features.Count == 0)
        {
            return new PostureAnalysisResult
            {
                Success = false,
                Errors =
                [
                    $"No supported posture features requested. Supported: {string.Join(", ", SupportedFeatures)}.",
                ],
            };
        }

        var opts = request.Options ?? new PostureAnalysisOptions();
        var maxObjects = Math.Clamp(opts.MaxObjects <= 0 ? 5000 : opts.MaxObjects, 1, 50000);
        var inactiveDays = Math.Clamp(opts.InactiveDays <= 0 ? 90 : opts.InactiveDays, 1, 3650);
        var scanId = string.IsNullOrWhiteSpace(request.ScanId)
            ? Guid.NewGuid().ToString("N")
            : request.ScanId.Trim();

        var search = request.Search ?? new AclSearchOptions();
        var baseDn = string.IsNullOrWhiteSpace(search.BaseDn)
            ? connection.BaseDn
            : search.BaseDn.Trim();
        if (string.IsNullOrWhiteSpace(baseDn))
        {
            return new PostureAnalysisResult
            {
                Success = false,
                Errors = ["Search.BaseDn (or connection.BaseDn) is required."],
            };
        }

        var scope = ParseScope(search.Scope);
        var needGroups = features.Any(f => GroupFeatures.Contains(f));
        var needUsers = features.Any(f => UserFeatures.Contains(f));
        var needComputers = features.Any(f => ComputerFeatures.Contains(f));

        // Multi-class posture always uses class-specific default filters under Search.BaseDn.
        // A custom Search.Filter is only applied when exactly one object class is needed and
        // the filter is non-empty (single-class override). Custom filters are ignored when
        // more than one class must be loaded.
        var classCount = (needGroups ? 1 : 0) + (needUsers ? 1 : 0) + (needComputers ? 1 : 0);
        var customFilter = string.IsNullOrWhiteSpace(search.Filter) ? null : search.Filter.Trim();
        var useCustomFilter = customFilter is not null && classCount == 1;

        var workstationOuPatterns = (opts.WorkstationOuPatterns is { Count: > 0 }
                ? opts.WorkstationOuPatterns
                : DefaultWorkstationOuPatterns)
            .Select(p => (p ?? string.Empty).Trim())
            .Where(p => p.Length > 0)
            .ToList();

        var unsupportedOsTokens = (opts.UnsupportedOsTokens ?? Array.Empty<string>())
            .Select(t => (t ?? string.Empty).Trim().ToLowerInvariant())
            .Where(t => t.Length > 0)
            .ToList();

        try
        {
            await using var client = _clientFactory.Create(connection);
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromMilliseconds(connection.TimeoutMs));
            var ct = timeoutCts.Token;

            await client.TestConnectionAsync(ct).ConfigureAwait(false);

            var sw = Stopwatch.StartNew();
            IReadOnlyList<DirectorySearchHit> groupHits = Array.Empty<DirectorySearchHit>();
            IReadOnlyList<DirectorySearchHit> userHits = Array.Empty<DirectorySearchHit>();
            IReadOnlyList<DirectorySearchHit> computerHits = Array.Empty<DirectorySearchHit>();

            if (needGroups)
            {
                var filter = useCustomFilter && needGroups && !needUsers && !needComputers
                    ? customFilter!
                    : DefaultGroupFilter;
                groupHits = await client
                    .SearchAsync(baseDn, filter, scope, GroupAttributes, maxObjects, ct)
                    .ConfigureAwait(false);
            }

            if (needUsers)
            {
                var filter = useCustomFilter && needUsers && !needGroups && !needComputers
                    ? customFilter!
                    : DefaultUserFilter;
                userHits = await client
                    .SearchAsync(baseDn, filter, scope, UserAttributes, maxObjects, ct)
                    .ConfigureAwait(false);
            }

            if (needComputers)
            {
                var filter = useCustomFilter && needComputers && !needGroups && !needUsers
                    ? customFilter!
                    : DefaultComputerFilter;
                computerHits = await client
                    .SearchAsync(baseDn, filter, scope, ComputerAttributes, maxObjects, ct)
                    .ConfigureAwait(false);
            }

            sw.Stop();

            _logger.LogInformation(
                "Posture analysis scanned groups={Groups} users={Users} computers={Computers} in {Ms}ms for features={Features}",
                groupHits.Count,
                userHits.Count,
                computerHits.Count,
                sw.ElapsedMilliseconds,
                string.Join(",", features));

            var findings = new List<DiscoveryFindingDto>();
            var counts = features.ToDictionary(f => f, _ => 0, StringComparer.Ordinal);

            var graph = needGroups ? BuildGroupGraph(groupHits) : null;

            if (features.Contains("empty_groups") && graph is not null)
                DetectEmptyGroups(graph, scanId, findings, counts);
            if (features.Contains("groups_without_owners") && graph is not null)
                DetectGroupsWithoutOwners(graph, scanId, findings, counts);
            if (features.Contains("unused_groups") && graph is not null)
                DetectUnusedGroups(graph, scanId, findings, counts);
            if (features.Contains("orphan_groups") && graph is not null)
                DetectOrphanGroups(graph, scanId, findings, counts);
            if (features.Contains("duplicate_groups") && graph is not null)
                DetectDuplicateGroups(graph, scanId, findings, counts);
            if (features.Contains("nested_groups") && graph is not null)
                DetectNestedGroups(graph, scanId, findings, counts);
            if (features.Contains("circular_memberships") && graph is not null)
                DetectCircularMemberships(graph, scanId, findings, counts);
            if (features.Contains("nested_privileged_access") && graph is not null)
                DetectNestedPrivilegedAccess(graph, scanId, findings, counts);

            if (graph is not null && userHits.Count > 0)
            {
                if (features.Contains("toxic_privilege_combinations"))
                    DetectToxicPrivilegeCombinations(graph, userHits, scanId, findings, counts);
                if (features.Contains("excessive_privileges"))
                    DetectExcessivePrivileges(graph, userHits, scanId, findings, counts);
                if (features.Contains("dormant_privileged_users"))
                    DetectDormantPrivilegedUsers(graph, userHits, scanId, inactiveDays, findings, counts);
                if (features.Contains("privilege_escalation_paths"))
                    DetectPrivilegeEscalationPaths(graph, userHits, scanId, findings, counts);
            }

            if (needComputers)
            {
                if (features.Contains("disabled_computers"))
                    DetectDisabledComputers(computerHits, scanId, findings, counts);
                if (features.Contains("inactive_computers"))
                    DetectInactiveComputers(computerHits, scanId, inactiveDays, findings, counts);
                if (features.Contains("missing_os_information"))
                    DetectMissingOsInformation(computerHits, scanId, findings, counts);
                if (features.Contains("unsupported_os_versions"))
                    DetectUnsupportedOsVersions(computerHits, scanId, unsupportedOsTokens, findings, counts);
                if (features.Contains("servers_in_wrong_ou"))
                    DetectServersInWrongOu(computerHits, scanId, workstationOuPatterns, baseDn, findings, counts);
                if (features.Contains("computers_without_owners"))
                    DetectComputersWithoutOwners(computerHits, scanId, findings, counts);
            }

            if (features.Contains("duplicate_spns"))
                DetectDuplicateSpns(userHits, computerHits, scanId, findings, counts);

            if (needUsers)
            {
                if (features.Contains("kerberoastable_accounts"))
                    DetectKerberoastableAccounts(userHits, scanId, findings, counts);
                if (features.Contains("asrep_roastable_users"))
                    DetectAsrepRoastableUsers(userHits, scanId, findings, counts);
                if (features.Contains("preauth_disabled"))
                    DetectPreauthDisabled(userHits, scanId, findings, counts);
                if (features.Contains("spn_misconfigurations"))
                    DetectSpnMisconfigurations(userHits, computerHits, scanId, findings, counts);
            }

            var unconstrained = 0;
            var constrained = 0;
            var rbcd = 0;

            if (features.Contains("unconstrained_delegation")
                || features.Contains("constrained_delegation")
                || features.Contains("delegation_exposure"))
            {
                if (features.Contains("unconstrained_delegation") || features.Contains("delegation_exposure"))
                {
                    unconstrained = DetectUnconstrainedDelegation(
                        userHits,
                        computerHits,
                        scanId,
                        findings,
                        counts,
                        emit: features.Contains("unconstrained_delegation"));
                }

                if (features.Contains("constrained_delegation") || features.Contains("delegation_exposure"))
                {
                    constrained = DetectConstrainedDelegation(
                        userHits,
                        computerHits,
                        scanId,
                        findings,
                        counts,
                        emit: features.Contains("constrained_delegation"));
                }
            }

            if (features.Contains("rbcd") || features.Contains("delegation_exposure"))
            {
                rbcd = DetectRbcd(
                    computerHits,
                    scanId,
                    findings,
                    counts,
                    emit: features.Contains("rbcd"));
            }

            if (features.Contains("delegation_exposure"))
            {
                // Recount from emitted findings when those features were also requested;
                // otherwise use detection return values gathered above without double-emit.
                if (features.Contains("unconstrained_delegation"))
                    unconstrained = counts["unconstrained_delegation"];
                if (features.Contains("constrained_delegation"))
                    constrained = counts["constrained_delegation"];
                if (features.Contains("rbcd"))
                    rbcd = counts["rbcd"];

                if (unconstrained + constrained + rbcd > 0)
                {
                    counts["delegation_exposure"] += 1;
                    findings.Add(new DiscoveryFindingDto
                    {
                        ScanId = scanId,
                        Feature = "delegation_exposure",
                        ObjectType = "summary",
                        ObjectName = "delegation_exposure",
                        Dn = baseDn,
                        Status = "delegation_exposure",
                        Attributes = new Dictionary<string, object?>(),
                        Evidence = new Dictionary<string, object?>
                        {
                            ["unconstrainedCount"] = unconstrained,
                            ["constrainedCount"] = constrained,
                            ["rbcdCount"] = rbcd,
                            ["totalDelegationFindings"] = unconstrained + constrained + rbcd,
                        },
                        Relationships = Array.Empty<object>(),
                        FindingType = "DELEGATION_EXPOSURE",
                        FindingSignals = ["DELEGATION_EXPOSURE"],
                    });
                }
            }

            var results = features
                .Select(f => new AclFeatureResultDto
                {
                    Feature = f,
                    Count = counts[f],
                    DurationMs = sw.ElapsedMilliseconds,
                })
                .ToList();

            return new PostureAnalysisResult
            {
                Success = true,
                Findings = findings,
                Results = results,
                Diagnostics = new PostureAnalysisDiagnosticsDto
                {
                    GroupsScanned = groupHits.Count,
                    UsersScanned = userHits.Count,
                    ComputersScanned = computerHits.Count,
                    Endpoint = connection.EndpointDisplay,
                    SearchBase = baseDn,
                    InactiveDays = inactiveDays,
                },
            };
        }
        catch (DirectoryOperationException ex)
        {
            _logger.LogWarning(ex, "Posture analysis LDAP failure");
            return new PostureAnalysisResult
            {
                Success = false,
                Errors = [DescribeDirectoryError(ex)],
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Posture analysis failed");
            return new PostureAnalysisResult
            {
                Success = false,
                Errors = [ex.Message],
            };
        }
    }

    // ── Group graph ──────────────────────────────────────────────────────────

    private sealed class GroupNode
    {
        public required string Dn { get; init; }
        public required string NormDn { get; init; }
        public required string Name { get; init; }
        public required string SamAccountName { get; init; }
        public required string Cn { get; init; }
        public required string Description { get; init; }
        public required string ManagedBy { get; init; }
        public required IReadOnlyList<string> Members { get; init; }
        public required IReadOnlyList<string> MemberOf { get; init; }
        public required int DirectMemberCount { get; init; }
        public required bool HasNoDirectMembers { get; init; }
        public string? ObjectSid { get; init; }
    }

    private sealed class GroupGraph
    {
        public Dictionary<string, GroupNode> ByDn { get; } = new(StringComparer.Ordinal);
        public HashSet<string> GroupDnSet { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, List<string>> ParentToChild { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, List<string>> ChildToParent { get; } = new(StringComparer.Ordinal);
        public List<GroupNode> Groups { get; } = [];
    }

    private static GroupGraph BuildGroupGraph(IReadOnlyList<DirectorySearchHit> hits)
    {
        var graph = new GroupGraph();

        foreach (var hit in hits)
        {
            var dn = hit.DistinguishedName;
            if (string.IsNullOrWhiteSpace(dn))
                continue;

            var norm = PrivilegedGroupHeuristics.NormalizeDn(dn);
            if (norm.Length == 0)
                continue;

            var sam = UserAccountControl.Attr(hit, "sAMAccountName");
            var cn = UserAccountControl.Attr(hit, "cn");
            var name = !string.IsNullOrWhiteSpace(sam)
                ? sam
                : (!string.IsNullOrWhiteSpace(cn) ? cn : dn);

            var memberPresent = hit.Attributes.ContainsKey("member");
            var members = memberPresent
                ? UserAccountControl.AttrAll(hit, "member")
                : Array.Empty<string>();
            var directCount = members.Count;
            var hasNoDirect = !memberPresent || directCount == 0;

            var node = new GroupNode
            {
                Dn = dn,
                NormDn = norm,
                Name = name,
                SamAccountName = sam,
                Cn = cn,
                Description = UserAccountControl.Attr(hit, "description"),
                ManagedBy = UserAccountControl.Attr(hit, "managedBy"),
                Members = members,
                MemberOf = UserAccountControl.AttrAll(hit, "memberOf"),
                DirectMemberCount = directCount,
                HasNoDirectMembers = hasNoDirect,
                ObjectSid = string.IsNullOrWhiteSpace(hit.ObjectSid) ? null : hit.ObjectSid,
            };

            graph.ByDn[norm] = node;
            graph.GroupDnSet.Add(norm);
            graph.Groups.Add(node);
        }

        foreach (var group in graph.Groups)
        {
            foreach (var memberDn in group.Members)
            {
                var memberKey = PrivilegedGroupHeuristics.NormalizeDn(memberDn);
                if (memberKey.Length == 0 || !graph.GroupDnSet.Contains(memberKey))
                    continue;

                if (!graph.ByDn.TryGetValue(memberKey, out var child))
                    continue;

                AddEdge(graph.ParentToChild, group.NormDn, child.Dn);
                AddEdge(graph.ChildToParent, child.NormDn, group.Dn);
            }
        }

        // Supplement child→parent from memberOf (often more complete than parent.member).
        foreach (var group in graph.Groups)
        {
            foreach (var parentDn in group.MemberOf)
            {
                var parentKey = PrivilegedGroupHeuristics.NormalizeDn(parentDn);
                if (parentKey.Length == 0 || !graph.GroupDnSet.Contains(parentKey))
                    continue;

                AddEdge(graph.ChildToParent, group.NormDn, parentDn);
                if (graph.ByDn.TryGetValue(parentKey, out var parent))
                    AddEdge(graph.ParentToChild, parent.NormDn, group.Dn);
            }
        }

        return graph;
    }

    private static void AddEdge(Dictionary<string, List<string>> map, string key, string value)
    {
        if (!map.TryGetValue(key, out var list))
        {
            list = [];
            map[key] = list;
        }

        var normValue = PrivilegedGroupHeuristics.NormalizeDn(value);
        if (list.Any(existing => PrivilegedGroupHeuristics.NormalizeDn(existing) == normValue))
            return;
        list.Add(value);
    }

    private static int IncomingParentCount(GroupGraph graph, string dn)
    {
        var key = PrivilegedGroupHeuristics.NormalizeDn(dn);
        if (!graph.ChildToParent.TryGetValue(key, out var parents))
            return 0;
        var count = 0;
        foreach (var parentDn in parents)
        {
            if (graph.GroupDnSet.Contains(PrivilegedGroupHeuristics.NormalizeDn(parentDn)))
                count += 1;
        }

        return count;
    }

    private static bool IsPrivilegedGroupName(GroupNode group) =>
        PrivilegedGroupHeuristics.IsPrivilegedGroupName(group.SamAccountName)
        || PrivilegedGroupHeuristics.IsPrivilegedGroupName(group.Cn)
        || PrivilegedGroupHeuristics.IsPrivilegedGroupName(group.Name);

    private static HashSet<string> PrivilegedGroupDnSet(GroupGraph graph)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var g in graph.Groups)
        {
            if (IsPrivilegedGroupName(g))
                set.Add(g.NormDn);
        }

        return set;
    }

    private static DiscoveryFindingDto GroupFinding(
        string scanId,
        string feature,
        GroupNode group,
        string status,
        string findingType,
        string[] signals,
        Dictionary<string, object?>? evidence = null)
    {
        return new DiscoveryFindingDto
        {
            ScanId = scanId,
            Feature = feature,
            ObjectType = "group",
            ObjectName = group.Name,
            Dn = group.Dn,
            Status = status,
            Attributes = new Dictionary<string, object?>
            {
                ["objectSid"] = group.ObjectSid,
                ["memberCount"] = group.DirectMemberCount,
                ["sAMAccountName"] = group.Name,
            },
            Evidence = evidence ?? new Dictionary<string, object?>(),
            Relationships = Array.Empty<object>(),
            FindingType = findingType,
            FindingSignals = signals,
        };
    }

    private static DiscoveryFindingDto UserFinding(
        string scanId,
        string feature,
        DirectorySearchHit hit,
        string status,
        string findingType,
        string[] signals,
        Dictionary<string, object?>? evidence = null,
        IReadOnlyList<object>? relationships = null,
        Dictionary<string, object?>? extraAttrs = null)
    {
        var dn = hit.DistinguishedName;
        var sam = UserAccountControl.Attr(hit, "sAMAccountName");
        var display = UserAccountControl.Attr(hit, "displayName");
        var objectName = !string.IsNullOrWhiteSpace(sam)
            ? sam
            : (!string.IsNullOrWhiteSpace(display) ? display : UserAccountControl.Attr(hit, "cn"));
        if (string.IsNullOrWhiteSpace(objectName))
            objectName = dn;

        var attrs = new Dictionary<string, object?>
        {
            ["userAccountControl"] = UserAccountControl.Parse(UserAccountControl.Attr(hit, "userAccountControl")),
            ["lastLogonTimestamp"] = NullIfEmpty(UserAccountControl.Attr(hit, "lastLogonTimestamp")),
            ["sAMAccountName"] = sam,
        };
        if (extraAttrs is not null)
        {
            foreach (var kv in extraAttrs)
                attrs[kv.Key] = kv.Value;
        }

        return new DiscoveryFindingDto
        {
            ScanId = scanId,
            Feature = feature,
            ObjectType = "user",
            ObjectName = objectName,
            Dn = dn,
            Status = status,
            Attributes = attrs,
            Evidence = evidence ?? new Dictionary<string, object?>(),
            Relationships = relationships ?? Array.Empty<object>(),
            FindingType = findingType,
            FindingSignals = signals,
        };
    }

    private static DiscoveryFindingDto ComputerFinding(
        string scanId,
        string feature,
        DirectorySearchHit hit,
        string status,
        string findingType,
        string[] signals,
        Dictionary<string, object?>? evidence = null)
    {
        var dn = hit.DistinguishedName;
        var sam = UserAccountControl.Attr(hit, "sAMAccountName");
        var cn = UserAccountControl.Attr(hit, "cn");
        var objectName = !string.IsNullOrWhiteSpace(sam)
            ? sam
            : (!string.IsNullOrWhiteSpace(cn) ? cn : dn);

        return new DiscoveryFindingDto
        {
            ScanId = scanId,
            Feature = feature,
            ObjectType = "computer",
            ObjectName = objectName,
            Dn = dn,
            Status = status,
            Attributes = new Dictionary<string, object?>
            {
                ["operatingSystem"] = NullIfEmpty(UserAccountControl.Attr(hit, "operatingSystem")),
                ["operatingSystemVersion"] = NullIfEmpty(UserAccountControl.Attr(hit, "operatingSystemVersion")),
                ["lastLogonTimestamp"] = NullIfEmpty(UserAccountControl.Attr(hit, "lastLogonTimestamp")),
                ["userAccountControl"] = UserAccountControl.Parse(UserAccountControl.Attr(hit, "userAccountControl")),
                ["sAMAccountName"] = sam,
            },
            Evidence = evidence ?? new Dictionary<string, object?>(),
            Relationships = Array.Empty<object>(),
            FindingType = findingType,
            FindingSignals = signals,
        };
    }

    private static object? NullIfEmpty(string value) =>
        string.IsNullOrEmpty(value) ? null : value;

    // ── Group detectors ──────────────────────────────────────────────────────

    private static void DetectEmptyGroups(
        GroupGraph graph,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var group in graph.Groups)
        {
            if (!group.HasNoDirectMembers)
                continue;
            counts["empty_groups"] += 1;
            findings.Add(GroupFinding(
                scanId,
                "empty_groups",
                group,
                "empty",
                "EMPTY_GROUP",
                ["EMPTY_GROUP"]));
        }
    }

    private static void DetectGroupsWithoutOwners(
        GroupGraph graph,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var group in graph.Groups)
        {
            if (!string.IsNullOrWhiteSpace(group.ManagedBy))
                continue;
            counts["groups_without_owners"] += 1;
            findings.Add(GroupFinding(
                scanId,
                "groups_without_owners",
                group,
                "no_owner",
                "GROUP_WITHOUT_OWNER",
                ["GROUP_WITHOUT_OWNER"]));
        }
    }

    private static void DetectUnusedGroups(
        GroupGraph graph,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var group in graph.Groups)
        {
            if (!group.HasNoDirectMembers)
                continue;
            var parentCount = IncomingParentCount(graph, group.Dn);
            if (parentCount > 0)
                continue;
            counts["unused_groups"] += 1;
            findings.Add(GroupFinding(
                scanId,
                "unused_groups",
                group,
                "empty",
                "UNUSED_GROUP",
                ["UNUSED_GROUP"],
                new Dictionary<string, object?>
                {
                    ["directMemberCount"] = group.DirectMemberCount,
                    ["parentGroupCount"] = parentCount,
                }));
        }
    }

    private static void DetectOrphanGroups(
        GroupGraph graph,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var group in graph.Groups)
        {
            if (!group.HasNoDirectMembers)
                continue;
            var parentCount = IncomingParentCount(graph, group.Dn);
            if (parentCount > 0)
                continue;
            if (!string.IsNullOrWhiteSpace(group.ManagedBy))
                continue;
            counts["orphan_groups"] += 1;
            findings.Add(GroupFinding(
                scanId,
                "orphan_groups",
                group,
                "orphan",
                "ORPHAN_GROUP",
                ["ORPHAN_GROUP"],
                new Dictionary<string, object?>
                {
                    ["directMemberCount"] = group.DirectMemberCount,
                    ["parentGroupCount"] = parentCount,
                }));
        }
    }

    private static void DetectDuplicateGroups(
        GroupGraph graph,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        var byDescription = new Dictionary<string, List<GroupNode>>(StringComparer.Ordinal);
        foreach (var group in graph.Groups)
        {
            var description = (group.Description ?? string.Empty).Trim();
            if (description.Length == 0)
                continue;
            var key = description.ToLowerInvariant();
            if (!byDescription.TryGetValue(key, out var list))
            {
                list = [];
                byDescription[key] = list;
            }

            list.Add(group);
        }

        foreach (var dupes in byDescription.Values)
        {
            if (dupes.Count < 2)
                continue;
            var relatedNames = string.Join(", ", dupes.Select(g => g.Name));
            foreach (var group in dupes)
            {
                counts["duplicate_groups"] += 1;
                findings.Add(GroupFinding(
                    scanId,
                    "duplicate_groups",
                    group,
                    "duplicate_description",
                    "DUPLICATE_GROUP",
                    ["DUPLICATE_GROUP"],
                    new Dictionary<string, object?>
                    {
                        ["duplicateField"] = "Description",
                        ["duplicateValue"] = group.Description,
                        ["duplicateCount"] = dupes.Count,
                        ["relatedNames"] = relatedNames,
                    }));
            }
        }
    }

    private static void DetectNestedGroups(
        GroupGraph graph,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var group in graph.Groups)
        {
            var visited = new HashSet<string>(StringComparer.Ordinal) { group.NormDn };
            TraverseNested(graph, group.Dn, group.Dn, 1, visited, scanId, findings, counts);
        }
    }

    private static void TraverseNested(
        GroupGraph graph,
        string startDn,
        string currentDn,
        int depth,
        HashSet<string> visited,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        var currentKey = PrivilegedGroupHeuristics.NormalizeDn(currentDn);
        if (!graph.ParentToChild.TryGetValue(currentKey, out var children))
            return;

        foreach (var childDn in children)
        {
            var childKey = PrivilegedGroupHeuristics.NormalizeDn(childDn);
            if (!visited.Add(childKey))
                continue;

            if (!graph.ByDn.TryGetValue(childKey, out var childGroup))
                continue;

            graph.ByDn.TryGetValue(PrivilegedGroupHeuristics.NormalizeDn(startDn), out var startGroup);
            counts["nested_groups"] += 1;
            findings.Add(GroupFinding(
                scanId,
                "nested_groups",
                childGroup,
                $"nested_depth_{depth}",
                "NESTED_GROUP",
                ["NESTED_GROUP"],
                new Dictionary<string, object?>
                {
                    ["parentGroup"] = startGroup?.Name ?? startDn,
                    ["parentDn"] = startDn,
                    ["childGroup"] = childGroup.Name,
                    ["childDn"] = childDn,
                    ["depth"] = depth,
                }));

            TraverseNested(graph, startDn, childDn, depth + 1, visited, scanId, findings, counts);
        }
    }

    private static void DetectCircularMemberships(
        GroupGraph graph,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        // 0=unvisited, 1=in stack, 2=done
        var visitedState = new Dictionary<string, int>(StringComparer.Ordinal);
        var pathStack = new List<string>();
        var detectedCycles = new HashSet<string>(StringComparer.Ordinal);

        void Traverse(string nodeDn)
        {
            var nodeKey = PrivilegedGroupHeuristics.NormalizeDn(nodeDn);
            if (visitedState.TryGetValue(nodeKey, out var state))
            {
                if (state == 1)
                {
                    var cycleStartIdx = pathStack.FindIndex(
                        dn => PrivilegedGroupHeuristics.NormalizeDn(dn) == nodeKey);
                    if (cycleStartIdx >= 0)
                    {
                        var cycleNodes = pathStack.Skip(cycleStartIdx).ToList();
                        cycleNodes.Add(nodeDn);
                        var cycleNames = cycleNodes.Select(dn =>
                        {
                            graph.ByDn.TryGetValue(PrivilegedGroupHeuristics.NormalizeDn(dn), out var g);
                            return g?.Name ?? dn;
                        }).ToList();
                        var cyclePath = string.Join(" -> ", cycleNames);
                        if (detectedCycles.Add(cyclePath)
                            && graph.ByDn.TryGetValue(nodeKey, out var group))
                        {
                            counts["circular_memberships"] += 1;
                            findings.Add(GroupFinding(
                                scanId,
                                "circular_memberships",
                                group,
                                "cycle_detected",
                                "CIRCULAR_GROUP_MEMBERSHIP",
                                ["CIRCULAR_GROUP_MEMBERSHIP"],
                                new Dictionary<string, object?>
                                {
                                    ["cycleLength"] = cycleNodes.Count - 1,
                                    ["cyclePath"] = cyclePath,
                                    ["cycleGroups"] = string.Join(" > ", cycleNames),
                                }));
                        }
                    }
                }

                return;
            }

            visitedState[nodeKey] = 1;
            pathStack.Add(nodeDn);

            if (graph.ParentToChild.TryGetValue(nodeKey, out var children))
            {
                foreach (var childDn in children)
                    Traverse(childDn);
            }

            visitedState[nodeKey] = 2;
            pathStack.RemoveAt(pathStack.Count - 1);
        }

        foreach (var group in graph.Groups)
        {
            if (!visitedState.ContainsKey(group.NormDn))
                Traverse(group.Dn);
        }
    }

    private static void DetectNestedPrivilegedAccess(
        GroupGraph graph,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var group in graph.Groups)
        {
            if (!IsPrivilegedGroupName(group))
                continue;

            var parentCount = IncomingParentCount(graph, group.Dn);
            if (parentCount < 1)
                continue;

            var hasDirectNonGroup = group.Members.Any(memberDn =>
            {
                var key = PrivilegedGroupHeuristics.NormalizeDn(memberDn);
                return key.Length > 0 && !graph.GroupDnSet.Contains(key);
            });
            if (!hasDirectNonGroup)
                continue;

            var parents = new List<string>();
            if (graph.ChildToParent.TryGetValue(group.NormDn, out var parentDns))
            {
                foreach (var parentDn in parentDns)
                {
                    var parentKey = PrivilegedGroupHeuristics.NormalizeDn(parentDn);
                    if (!graph.ByDn.TryGetValue(parentKey, out var parent))
                        continue;
                    parents.Add(parent.Name);
                }
            }

            counts["nested_privileged_access"] += 1;
            findings.Add(GroupFinding(
                scanId,
                "nested_privileged_access",
                group,
                "privileged_inherited_via_nesting",
                "NESTED_PRIVILEGED_ACCESS",
                ["NESTED_PRIVILEGED_ACCESS", "PRIVILEGED_USER"],
                new Dictionary<string, object?>
                {
                    ["parentGroupCount"] = parents.Count,
                    ["parents"] = string.Join("; ", parents),
                    ["directMemberCount"] = group.DirectMemberCount,
                }));
        }
    }

    // ── Privileged user detectors ────────────────────────────────────────────

    /// <summary>
    /// BFS from the user's direct memberOf upward through group nesting (child→parent / memberOf).
    /// Returns normalized DNs of reachable privileged groups.
    /// </summary>
    private static List<string> PrivilegedGroupsReachable(
        GroupGraph graph,
        DirectorySearchHit user,
        int maxDepth = 16)
    {
        var privileged = PrivilegedGroupDnSet(graph);
        if (privileged.Count == 0)
            return [];

        var reachable = new List<string>();
        var visited = new HashSet<string>(StringComparer.Ordinal);
        var queue = new Queue<(string NormDn, int Depth)>();

        foreach (var memberOf in UserAccountControl.AttrAll(user, "memberOf"))
        {
            var key = PrivilegedGroupHeuristics.NormalizeDn(memberOf);
            if (key.Length == 0 || !visited.Add(key))
                continue;
            queue.Enqueue((key, 1));
        }

        while (queue.Count > 0)
        {
            var (normDn, depth) = queue.Dequeue();
            if (privileged.Contains(normDn))
                reachable.Add(normDn);

            if (depth >= maxDepth)
                continue;

            if (!graph.ChildToParent.TryGetValue(normDn, out var parents))
                continue;

            foreach (var parentDn in parents)
            {
                var parentKey = PrivilegedGroupHeuristics.NormalizeDn(parentDn);
                if (parentKey.Length == 0 || !visited.Add(parentKey))
                    continue;
                if (!graph.GroupDnSet.Contains(parentKey))
                    continue;
                queue.Enqueue((parentKey, depth + 1));
            }
        }

        return reachable;
    }

    private static void DetectToxicPrivilegeCombinations(
        GroupGraph graph,
        IReadOnlyList<DirectorySearchHit> users,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        var privileged = PrivilegedGroupDnSet(graph);
        if (privileged.Count == 0)
            return;

        foreach (var user in users)
        {
            if (string.IsNullOrWhiteSpace(user.DistinguishedName))
                continue;

            var directPriv = new HashSet<string>(StringComparer.Ordinal);
            foreach (var memberOf in UserAccountControl.AttrAll(user, "memberOf"))
            {
                var key = PrivilegedGroupHeuristics.NormalizeDn(memberOf);
                if (privileged.Contains(key))
                    directPriv.Add(key);
            }

            if (directPriv.Count < PrivilegedGroupHeuristics.ToxicPrivilegeMinGroups)
                continue;

            counts["toxic_privilege_combinations"] += 1;
            findings.Add(UserFinding(
                scanId,
                "toxic_privilege_combinations",
                user,
                $"privileged_groups_{directPriv.Count}",
                "TOXIC_PRIVILEGE_COMBINATION",
                ["TOXIC_PRIVILEGE_COMBINATION", "PRIVILEGED_USER"],
                new Dictionary<string, object?>
                {
                    ["privilegedGroupCount"] = directPriv.Count,
                }));
        }
    }

    private static void DetectExcessivePrivileges(
        GroupGraph graph,
        IReadOnlyList<DirectorySearchHit> users,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var user in users)
        {
            if (string.IsNullOrWhiteSpace(user.DistinguishedName))
                continue;

            var privCount = PrivilegedGroupsReachable(graph, user).Count;
            if (privCount < PrivilegedGroupHeuristics.ExcessivePrivilegeThreshold)
                continue;

            counts["excessive_privileges"] += 1;
            findings.Add(UserFinding(
                scanId,
                "excessive_privileges",
                user,
                $"privileged_paths_{privCount}",
                "EXCESSIVE_PRIVILEGES",
                ["EXCESSIVE_PRIVILEGES", "PRIVILEGED_USER"],
                new Dictionary<string, object?>
                {
                    ["privilegedPathCount"] = privCount,
                }));
        }
    }

    private static void DetectDormantPrivilegedUsers(
        GroupGraph graph,
        IReadOnlyList<DirectorySearchHit> users,
        string scanId,
        int inactiveDays,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var user in users)
        {
            if (string.IsNullOrWhiteSpace(user.DistinguishedName))
                continue;

            var uac = UserAccountControl.Parse(UserAccountControl.Attr(user, "userAccountControl"));
            if (UserAccountControl.IsDisabled(uac))
                continue;

            var reachable = PrivilegedGroupsReachable(graph, user);
            if (reachable.Count < 1)
                continue;

            var lastLogon = UserAccountControl.Attr(user, "lastLogonTimestamp");
            var neverLoggedOn = string.IsNullOrWhiteSpace(lastLogon) || lastLogon.Trim() == "0";
            if (!neverLoggedOn && !UserAccountControl.IsOlderThanDays(lastLogon, inactiveDays))
                continue;

            counts["dormant_privileged_users"] += 1;
            findings.Add(UserFinding(
                scanId,
                "dormant_privileged_users",
                user,
                $"dormant_privileged_{inactiveDays}d",
                "DORMANT_PRIVILEGED_USER",
                ["DORMANT_PRIVILEGED_USER", "PRIVILEGED_USER", "INACTIVE_USER"],
                new Dictionary<string, object?>
                {
                    ["inactiveDays"] = inactiveDays,
                    ["privilegedGroupCount"] = reachable.Count,
                }));
        }
    }

    private static void DetectPrivilegeEscalationPaths(
        GroupGraph graph,
        IReadOnlyList<DirectorySearchHit> users,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        var privileged = PrivilegedGroupDnSet(graph);
        if (privileged.Count == 0)
            return;

        const int maxDepth = 12;
        var privTargets = privileged.Take(100).ToList();

        foreach (var user in users)
        {
            var userDn = user.DistinguishedName;
            if (string.IsNullOrWhiteSpace(userDn))
                continue;

            List<string>? bestPath = null;
            string? targetPriv = null;

            foreach (var target in privTargets)
            {
                var path = ShortestPathToGroup(graph, user, target, maxDepth);
                if (path is null || path.Count < 3)
                    continue;
                bestPath = path;
                targetPriv = target;
                break;
            }

            if (bestPath is null || targetPriv is null)
                continue;

            var relationships = new List<object>();
            for (var i = 0; i < bestPath.Count - 1; i++)
            {
                relationships.Add(new Dictionary<string, object?>
                {
                    ["from"] = bestPath[i],
                    ["to"] = bestPath[i + 1],
                    ["type"] = "NESTED_MEMBER_OF",
                });
            }

            counts["privilege_escalation_paths"] += 1;
            findings.Add(UserFinding(
                scanId,
                "privilege_escalation_paths",
                user,
                "escalation_path",
                "PRIVILEGE_ESCALATION_PATH",
                ["PRIVILEGE_ESCALATION_PATH", "PRIVILEGED_USER"],
                new Dictionary<string, object?>
                {
                    ["pathLength"] = bestPath.Count,
                    ["privilegedGroup"] = targetPriv,
                    ["path"] = bestPath,
                },
                relationships));
        }
    }

    /// <summary>
    /// Shortest path user → … → privileged group via memberOf + upward group nesting.
    /// Path nodes are DNs; length is node count (Node parity: length &gt;= 3).
    /// </summary>
    private static List<string>? ShortestPathToGroup(
        GroupGraph graph,
        DirectorySearchHit user,
        string targetNormDn,
        int maxDepth)
    {
        var userDn = user.DistinguishedName;
        var visited = new HashSet<string>(StringComparer.Ordinal) { "__user__" };
        var queue = new Queue<(string NormKey, List<string> Path)>();
        queue.Enqueue(("__user__", [userDn]));

        while (queue.Count > 0)
        {
            var (normKey, path) = queue.Dequeue();
            if (path.Count - 1 >= maxDepth)
                continue;

            IEnumerable<string> nextDns;
            if (normKey == "__user__")
            {
                nextDns = UserAccountControl.AttrAll(user, "memberOf");
            }
            else if (graph.ChildToParent.TryGetValue(normKey, out var parents))
            {
                nextDns = parents;
            }
            else
            {
                continue;
            }

            foreach (var nextDn in nextDns)
            {
                var nextKey = PrivilegedGroupHeuristics.NormalizeDn(nextDn);
                if (nextKey.Length == 0 || !visited.Add(nextKey))
                    continue;
                if (normKey != "__user__" && !graph.GroupDnSet.Contains(nextKey))
                    continue;

                var displayDn = graph.ByDn.TryGetValue(nextKey, out var g) ? g.Dn : nextDn;
                var nextPath = new List<string>(path) { displayDn };
                if (nextKey == targetNormDn)
                    return nextPath;

                queue.Enqueue((nextKey, nextPath));
            }
        }

        return null;
    }

    // ── Computer detectors ───────────────────────────────────────────────────

    private static void DetectDisabledComputers(
        IReadOnlyList<DirectorySearchHit> computers,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var computer in computers)
        {
            if (string.IsNullOrWhiteSpace(computer.DistinguishedName))
                continue;
            var uac = UserAccountControl.Parse(UserAccountControl.Attr(computer, "userAccountControl"));
            if (!UserAccountControl.IsDisabled(uac))
                continue;
            counts["disabled_computers"] += 1;
            findings.Add(ComputerFinding(
                scanId,
                "disabled_computers",
                computer,
                "disabled",
                "DISABLED_COMPUTER",
                ["DISABLED_COMPUTER"]));
        }
    }

    private static void DetectInactiveComputers(
        IReadOnlyList<DirectorySearchHit> computers,
        string scanId,
        int inactiveDays,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var computer in computers)
        {
            if (string.IsNullOrWhiteSpace(computer.DistinguishedName))
                continue;
            var uac = UserAccountControl.Parse(UserAccountControl.Attr(computer, "userAccountControl"));
            var lastLogon = UserAccountControl.Attr(computer, "lastLogonTimestamp");
            if (!UserAccountControl.IsInactiveComputer(lastLogon, inactiveDays, uac))
                continue;
            counts["inactive_computers"] += 1;
            findings.Add(ComputerFinding(
                scanId,
                "inactive_computers",
                computer,
                $"inactive_{inactiveDays}d",
                "INACTIVE_COMPUTER",
                ["INACTIVE_COMPUTER"],
                new Dictionary<string, object?>
                {
                    ["inactiveDays"] = inactiveDays,
                    ["lastLogonTimestamp"] = NullIfEmpty(lastLogon),
                }));
        }
    }

    private static void DetectMissingOsInformation(
        IReadOnlyList<DirectorySearchHit> computers,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var computer in computers)
        {
            if (string.IsNullOrWhiteSpace(computer.DistinguishedName))
                continue;
            var os = UserAccountControl.Attr(computer, "operatingSystem").Trim();
            var osVersion = UserAccountControl.Attr(computer, "operatingSystemVersion").Trim();
            if (os.Length > 0 && osVersion.Length > 0)
                continue;
            counts["missing_os_information"] += 1;
            findings.Add(ComputerFinding(
                scanId,
                "missing_os_information",
                computer,
                "missing_operating_system",
                "MISSING_OS_INFORMATION",
                ["MISSING_OS_INFORMATION"]));
        }
    }

    private static void DetectUnsupportedOsVersions(
        IReadOnlyList<DirectorySearchHit> computers,
        string scanId,
        IReadOnlyList<string> osTokens,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var computer in computers)
        {
            if (string.IsNullOrWhiteSpace(computer.DistinguishedName))
                continue;
            var operatingSystem = UserAccountControl.Attr(computer, "operatingSystem").Trim();
            if (operatingSystem.Length == 0)
                continue;

            var regexMatch = UserAccountControl.IsUnsupportedComputerOperatingSystem(operatingSystem);
            string? tokenMatch = null;
            var osLower = operatingSystem.ToLowerInvariant();
            foreach (var token in osTokens)
            {
                if (osLower.Contains(token, StringComparison.Ordinal))
                {
                    tokenMatch = token;
                    break;
                }
            }

            if (!regexMatch && tokenMatch is null)
                continue;

            counts["unsupported_os_versions"] += 1;
            findings.Add(ComputerFinding(
                scanId,
                "unsupported_os_versions",
                computer,
                "unsupported_os",
                "UNSUPPORTED_OS",
                ["UNSUPPORTED_OS"],
                new Dictionary<string, object?>
                {
                    ["matchedToken"] = regexMatch ? operatingSystem : tokenMatch,
                    ["operatingSystem"] = operatingSystem,
                    ["matchedBy"] = regexMatch ? "regex" : "token",
                }));
        }
    }

    private static void DetectServersInWrongOu(
        IReadOnlyList<DirectorySearchHit> computers,
        string scanId,
        IReadOnlyList<string> ouPatterns,
        string searchBase,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var computer in computers)
        {
            var dn = computer.DistinguishedName;
            if (string.IsNullOrWhiteSpace(dn))
                continue;
            var os = UserAccountControl.Attr(computer, "operatingSystem");
            if (!os.Contains("server", StringComparison.OrdinalIgnoreCase))
                continue;
            if (!DnMatchesWorkstationOu(dn, ouPatterns, searchBase))
                continue;

            counts["servers_in_wrong_ou"] += 1;
            findings.Add(ComputerFinding(
                scanId,
                "servers_in_wrong_ou",
                computer,
                "server_in_workstation_ou",
                "SERVER_IN_WRONG_OU",
                ["SERVER_IN_WRONG_OU"],
                new Dictionary<string, object?>
                {
                    ["ouPatternsMatched"] = MatchingWorkstationOuPatterns(dn, ouPatterns, searchBase),
                }));
        }
    }

    private static bool IsWorkstationRelatedSearchBase(string? searchBase)
    {
        var bas = (searchBase ?? string.Empty).Trim().ToLowerInvariant();
        if (bas.Length == 0)
            return false;
        if (System.Text.RegularExpressions.Regex.IsMatch(
                bas,
                @"(?:^|,)ou=(?:workstations|clients|desktops|laptops|desktop|computers)(?:,|$)"))
            return true;
        return System.Text.RegularExpressions.Regex.IsMatch(bas, @"workstation|desktop|laptop|client",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }

    private static bool DnMatchesWorkstationOuPattern(string dn, string pattern)
    {
        var normalizedDn = (dn ?? string.Empty).Trim().ToLowerInvariant();
        var p = (pattern ?? string.Empty).Trim().ToLowerInvariant();
        if (normalizedDn.Length == 0 || p.Length == 0)
            return false;
        if (normalizedDn == p || normalizedDn.EndsWith($",{p}", StringComparison.Ordinal))
            return true;
        if (!p.Contains(',') && p.StartsWith("ou=", StringComparison.Ordinal))
        {
            return normalizedDn.Contains($",{p},", StringComparison.Ordinal)
                   || normalizedDn.EndsWith($",{p}", StringComparison.Ordinal);
        }

        return false;
    }

    private static bool DnMatchesWorkstationOu(
        string dn,
        IReadOnlyList<string> patterns,
        string? searchBase)
    {
        var normalizedDn = (dn ?? string.Empty).Trim().ToLowerInvariant();
        if (normalizedDn.Length == 0)
            return false;

        var lowerBase = (searchBase ?? string.Empty).Trim().ToLowerInvariant();
        if (lowerBase.Length > 0
            && IsWorkstationRelatedSearchBase(lowerBase)
            && (normalizedDn == lowerBase
                || normalizedDn.EndsWith($",{lowerBase}", StringComparison.Ordinal)))
        {
            return true;
        }

        foreach (var pattern in patterns)
        {
            if (DnMatchesWorkstationOuPattern(normalizedDn, pattern))
                return true;
        }

        return false;
    }

    private static List<string> MatchingWorkstationOuPatterns(
        string dn,
        IReadOnlyList<string> patterns,
        string? searchBase)
    {
        var matches = patterns
            .Where(pattern => DnMatchesWorkstationOuPattern(dn, pattern))
            .ToList();
        var lowerBase = (searchBase ?? string.Empty).Trim().ToLowerInvariant();
        var normalizedDn = (dn ?? string.Empty).Trim().ToLowerInvariant();
        if (matches.Count == 0
            && lowerBase.Length > 0
            && IsWorkstationRelatedSearchBase(lowerBase)
            && (normalizedDn == lowerBase
                || normalizedDn.EndsWith($",{lowerBase}", StringComparison.Ordinal))
            && !string.IsNullOrWhiteSpace(searchBase))
        {
            matches.Add(searchBase);
        }

        return matches;
    }

    private static void DetectComputersWithoutOwners(
        IReadOnlyList<DirectorySearchHit> computers,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var computer in computers)
        {
            if (string.IsNullOrWhiteSpace(computer.DistinguishedName))
                continue;
            if (!string.IsNullOrWhiteSpace(UserAccountControl.Attr(computer, "managedBy")))
                continue;
            counts["computers_without_owners"] += 1;
            findings.Add(ComputerFinding(
                scanId,
                "computers_without_owners",
                computer,
                "missing_managed_by",
                "COMPUTER_WITHOUT_OWNER",
                ["COMPUTER_WITHOUT_OWNER"]));
        }
    }

    // ── SPN / Kerberos ───────────────────────────────────────────────────────

    private sealed class SpnHolder
    {
        public required string ObjectType { get; init; }
        public required string ObjectName { get; init; }
        public required string Dn { get; init; }
    }

    private static Dictionary<string, List<SpnHolder>> BuildSpnIndex(
        IReadOnlyList<DirectorySearchHit> users,
        IReadOnlyList<DirectorySearchHit> computers)
    {
        var index = new Dictionary<string, List<SpnHolder>>(StringComparer.OrdinalIgnoreCase);

        void Add(DirectorySearchHit hit, string objectType)
        {
            var dn = hit.DistinguishedName;
            if (string.IsNullOrWhiteSpace(dn))
                return;
            var sam = UserAccountControl.Attr(hit, "sAMAccountName");
            var display = objectType == "user"
                ? UserAccountControl.Attr(hit, "displayName")
                : UserAccountControl.Attr(hit, "cn");
            var objectName = !string.IsNullOrWhiteSpace(sam)
                ? sam
                : (!string.IsNullOrWhiteSpace(display) ? display : dn);

            foreach (var spn in UserAccountControl.AttrAll(hit, "servicePrincipalName"))
            {
                var key = spn.Trim();
                if (key.Length == 0)
                    continue;
                if (!index.TryGetValue(key, out var list))
                {
                    list = [];
                    index[key] = list;
                }

                list.Add(new SpnHolder
                {
                    ObjectType = objectType,
                    ObjectName = objectName,
                    Dn = dn,
                });
            }
        }

        foreach (var u in users)
            Add(u, "user");
        foreach (var c in computers)
            Add(c, "computer");

        return index;
    }

    private static void DetectDuplicateSpns(
        IReadOnlyList<DirectorySearchHit> users,
        IReadOnlyList<DirectorySearchHit> computers,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        var index = BuildSpnIndex(users, computers);
        foreach (var (spn, holders) in index)
        {
            if (holders.Count < 2)
                continue;
            var holderPayload = holders
                .Select(h => new Dictionary<string, object?>
                {
                    ["objectType"] = h.ObjectType,
                    ["objectName"] = h.ObjectName,
                    ["dn"] = h.Dn,
                })
                .ToList();

            foreach (var holder in holders)
            {
                counts["duplicate_spns"] += 1;
                findings.Add(new DiscoveryFindingDto
                {
                    ScanId = scanId,
                    Feature = "duplicate_spns",
                    ObjectType = holder.ObjectType,
                    ObjectName = holder.ObjectName,
                    Dn = holder.Dn,
                    Status = "duplicate_spn",
                    Attributes = new Dictionary<string, object?>(),
                    Evidence = new Dictionary<string, object?>
                    {
                        ["spn"] = spn,
                        ["duplicateCount"] = holders.Count,
                        ["holders"] = holderPayload,
                    },
                    Relationships = Array.Empty<object>(),
                    FindingType = "DUPLICATE_SPN",
                    FindingSignals = ["DUPLICATE_SPN"],
                });
            }
        }
    }

    private static void DetectKerberoastableAccounts(
        IReadOnlyList<DirectorySearchHit> users,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var user in users)
        {
            if (string.IsNullOrWhiteSpace(user.DistinguishedName))
                continue;
            var spns = UserAccountControl.AttrAll(user, "servicePrincipalName")
                .Select(s => s.Trim())
                .Where(s => s.Length > 0)
                .ToList();
            if (spns.Count == 0)
                continue;
            var uac = UserAccountControl.Parse(UserAccountControl.Attr(user, "userAccountControl"));
            if (UserAccountControl.IsDisabled(uac))
                continue;

            counts["kerberoastable_accounts"] += 1;
            findings.Add(UserFinding(
                scanId,
                "kerberoastable_accounts",
                user,
                "kerberoastable_spn",
                "KERBEROASTABLE_ACCOUNT",
                ["KERBEROASTABLE_ACCOUNT"],
                new Dictionary<string, object?>
                {
                    ["servicePrincipalNames"] = spns,
                }));
        }
    }

    private static void DetectAsrepRoastableUsers(
        IReadOnlyList<DirectorySearchHit> users,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var user in users)
        {
            if (string.IsNullOrWhiteSpace(user.DistinguishedName))
                continue;
            var uac = UserAccountControl.Parse(UserAccountControl.Attr(user, "userAccountControl"));
            if (!UserAccountControl.IsDontRequirePreauth(uac))
                continue;
            if (UserAccountControl.IsDisabled(uac))
                continue;

            counts["asrep_roastable_users"] += 1;
            findings.Add(UserFinding(
                scanId,
                "asrep_roastable_users",
                user,
                "dont_require_preauth",
                "ASREP_ROASTABLE_USER",
                ["ASREP_ROASTABLE_USER"],
                new Dictionary<string, object?>
                {
                    ["userAccountControl"] = uac,
                }));
        }
    }

    private static void DetectPreauthDisabled(
        IReadOnlyList<DirectorySearchHit> users,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        foreach (var user in users)
        {
            if (string.IsNullOrWhiteSpace(user.DistinguishedName))
                continue;
            var uac = UserAccountControl.Parse(UserAccountControl.Attr(user, "userAccountControl"));
            if (!UserAccountControl.IsDontRequirePreauth(uac))
                continue;

            counts["preauth_disabled"] += 1;
            findings.Add(UserFinding(
                scanId,
                "preauth_disabled",
                user,
                "preauth_disabled",
                "PREAUTH_DISABLED",
                ["PREAUTH_DISABLED"],
                new Dictionary<string, object?>
                {
                    ["objectClass"] = "user",
                }));
        }
    }

    private static void DetectSpnMisconfigurations(
        IReadOnlyList<DirectorySearchHit> users,
        IReadOnlyList<DirectorySearchHit> computers,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        var index = BuildSpnIndex(users, computers);

        foreach (var user in users)
        {
            if (string.IsNullOrWhiteSpace(user.DistinguishedName))
                continue;
            var spns = UserAccountControl.AttrAll(user, "servicePrincipalName")
                .Select(s => s.Trim())
                .Where(s => s.Length > 0)
                .ToList();

            foreach (var spn in spns)
            {
                if (UserAccountControl.IsMalformedSpn(spn))
                {
                    counts["spn_misconfigurations"] += 1;
                    findings.Add(UserFinding(
                        scanId,
                        "spn_misconfigurations",
                        user,
                        "malformed_spn",
                        "SPN_MISCONFIGURATION",
                        ["SPN_MISCONFIGURATION"],
                        new Dictionary<string, object?> { ["spn"] = spn }));
                }

                if (index.TryGetValue(spn, out var holders) && holders.Count > 1)
                {
                    counts["spn_misconfigurations"] += 1;
                    findings.Add(UserFinding(
                        scanId,
                        "spn_misconfigurations",
                        user,
                        "duplicate_spn",
                        "SPN_MISCONFIGURATION",
                        ["SPN_MISCONFIGURATION", "DUPLICATE_SPN"],
                        new Dictionary<string, object?>
                        {
                            ["spn"] = spn,
                            ["duplicateCount"] = holders.Count,
                            ["holders"] = holders
                                .Select(h => new Dictionary<string, object?>
                                {
                                    ["objectType"] = h.ObjectType,
                                    ["objectName"] = h.ObjectName,
                                    ["dn"] = h.Dn,
                                })
                                .ToList(),
                        }));
                }
            }
        }
    }

    // ── Delegation ───────────────────────────────────────────────────────────

    private static int DetectUnconstrainedDelegation(
        IReadOnlyList<DirectorySearchHit> users,
        IReadOnlyList<DirectorySearchHit> computers,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts,
        bool emit)
    {
        var found = 0;

        void Inspect(DirectorySearchHit hit, string objectType)
        {
            if (string.IsNullOrWhiteSpace(hit.DistinguishedName))
                return;
            var uac = UserAccountControl.Parse(UserAccountControl.Attr(hit, "userAccountControl"));
            if (!UserAccountControl.IsTrustedForDelegation(uac))
                return;
            found += 1;
            if (!emit)
                return;

            counts["unconstrained_delegation"] += 1;
            if (objectType == "computer")
            {
                findings.Add(ComputerFinding(
                    scanId,
                    "unconstrained_delegation",
                    hit,
                    "unconstrained_delegation",
                    "UNCONSTRAINED_DELEGATION",
                    ["UNCONSTRAINED_DELEGATION"],
                    new Dictionary<string, object?>
                    {
                        ["delegationType"] = "unconstrained",
                        ["userAccountControl"] = uac,
                    }));
            }
            else
            {
                findings.Add(UserFinding(
                    scanId,
                    "unconstrained_delegation",
                    hit,
                    "unconstrained_delegation",
                    "UNCONSTRAINED_DELEGATION",
                    ["UNCONSTRAINED_DELEGATION"],
                    new Dictionary<string, object?>
                    {
                        ["delegationType"] = "unconstrained",
                        ["userAccountControl"] = uac,
                    }));
            }
        }

        foreach (var u in users)
            Inspect(u, "user");
        foreach (var c in computers)
            Inspect(c, "computer");
        return found;
    }

    private static int DetectConstrainedDelegation(
        IReadOnlyList<DirectorySearchHit> users,
        IReadOnlyList<DirectorySearchHit> computers,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts,
        bool emit)
    {
        var found = 0;

        void Inspect(DirectorySearchHit hit, string objectType)
        {
            if (string.IsNullOrWhiteSpace(hit.DistinguishedName))
                return;
            var targets = UserAccountControl.AttrAll(hit, "msDS-AllowedToDelegateTo")
                .Select(t => t.Trim())
                .Where(t => t.Length > 0)
                .ToList();
            var uac = UserAccountControl.Parse(UserAccountControl.Attr(hit, "userAccountControl"));
            var uacConstrained = UserAccountControl.IsTrustedToAuthForDelegation(uac);
            if (targets.Count == 0 && !uacConstrained)
                return;

            found += 1;
            if (!emit)
                return;

            counts["constrained_delegation"] += 1;
            var evidence = new Dictionary<string, object?>
            {
                ["delegationType"] = "constrained",
                ["targetServices"] = targets,
                ["userAccountControl"] = uac,
            };
            if (objectType == "computer")
            {
                findings.Add(ComputerFinding(
                    scanId,
                    "constrained_delegation",
                    hit,
                    "constrained_delegation",
                    "CONSTRAINED_DELEGATION",
                    ["CONSTRAINED_DELEGATION"],
                    evidence));
            }
            else
            {
                findings.Add(UserFinding(
                    scanId,
                    "constrained_delegation",
                    hit,
                    "constrained_delegation",
                    "CONSTRAINED_DELEGATION",
                    ["CONSTRAINED_DELEGATION"],
                    evidence));
            }
        }

        foreach (var u in users)
            Inspect(u, "user");
        foreach (var c in computers)
            Inspect(c, "computer");
        return found;
    }

    private static bool HasRbcd(DirectorySearchHit hit)
    {
        if (hit.BinaryAttributes.TryGetValue("msDS-AllowedToActOnBehalfOfOtherIdentity", out var bins)
            && bins is { Length: > 0 }
            && bins.Any(b => b is { Length: > 0 }))
        {
            return true;
        }

        if (hit.Attributes.TryGetValue("msDS-AllowedToActOnBehalfOfOtherIdentity", out var vals)
            && vals.Count > 0
            && vals.Any(v => !string.IsNullOrWhiteSpace(v)))
        {
            return true;
        }

        return false;
    }

    private static int DetectRbcd(
        IReadOnlyList<DirectorySearchHit> computers,
        string scanId,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts,
        bool emit)
    {
        var found = 0;
        foreach (var computer in computers)
        {
            if (string.IsNullOrWhiteSpace(computer.DistinguishedName))
                continue;
            if (!HasRbcd(computer))
                continue;
            found += 1;
            if (!emit)
                continue;

            counts["rbcd"] += 1;
            findings.Add(ComputerFinding(
                scanId,
                "rbcd",
                computer,
                "resource_based_constrained_delegation",
                "RBCD_CONFIGURED",
                ["RBCD_CONFIGURED"],
                new Dictionary<string, object?>
                {
                    ["delegationType"] = "rbcd",
                }));
        }

        return found;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static SearchScopeKind ParseScope(string? scope)
    {
        var s = (scope ?? "sub").Trim().ToLowerInvariant();
        return s switch
        {
            "base" or "0" => SearchScopeKind.Base,
            "one" or "onelevel" or "1" => SearchScopeKind.OneLevel,
            _ => SearchScopeKind.Subtree,
        };
    }

    private static string DescribeDirectoryError(DirectoryOperationException ex)
    {
        var response = ex.Response;
        if (response is not null)
            return $"LDAP {response.ResultCode}: {response.ErrorMessage ?? ex.Message}";
        return ex.Message;
    }
}
