using System.Diagnostics;
using System.Text.RegularExpressions;
using ADShield.ActiveDirectory;
using ADShield.Configuration;
using ADShield.Models;
using Microsoft.Extensions.Logging;

namespace ADShield.Application.Services;

public interface IAclAnalysisService
{
    Task<AclAnalysisResult> AnalyzeAsync(
        AclAnalysisRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Live AD ACL analysis for IdentitySphere:
/// Phase 1: broken_acls, unknown_sid_bindings.
/// Phase 2: shadow_admins_acl (findings emit feature shadow_admins).
/// SID validity is resolved independently of maxObjects ACL enumeration.
/// </summary>
public sealed class AclAnalysisService : IAclAnalysisService
{
    public static readonly string[] SupportedFeatures =
    [
        "broken_acls",
        "unknown_sid_bindings",
        "shadow_admins_acl",
    ];

    private readonly IActiveDirectoryClientFactory _clientFactory;
    private readonly ILogger<AclAnalysisService> _logger;

    public AclAnalysisService(
        IActiveDirectoryClientFactory clientFactory,
        ILogger<AclAnalysisService> logger)
    {
        _clientFactory = clientFactory;
        _logger = logger;
    }

    public async Task<AclAnalysisResult> AnalyzeAsync(
        AclAnalysisRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var errors = new List<string>();
        var connection = request.Connection ?? new ActiveDirectoryConnectionOptions();
        connection.EnsureNormalized();
        var endpoint = connection.EndpointDisplay;

        var validation = ActiveDirectoryConnectionOptionsValidator.Validate(connection);
        if (validation.Count > 0)
        {
            return new AclAnalysisResult
            {
                Success = false,
                Errors = validation.ToList(),
                Diagnostics = new AclAnalysisDiagnosticsDto { Endpoint = endpoint },
            };
        }

        var features = (request.Features ?? Array.Empty<string>())
            .Select(f => (f ?? string.Empty).Trim())
            .Where(f => SupportedFeatures.Contains(f, StringComparer.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (features.Count == 0)
        {
            return new AclAnalysisResult
            {
                Success = false,
                Errors =
                [
                    "No supported ACL features requested. Supported: broken_acls, unknown_sid_bindings, shadow_admins_acl.",
                ],
                Diagnostics = new AclAnalysisDiagnosticsDto { Endpoint = endpoint },
            };
        }

        var searchBase = string.IsNullOrWhiteSpace(request.Search?.BaseDn)
            ? connection.EffectiveSearchBaseDn
            : request.Search!.BaseDn!.Trim();
        // SID resolution / privileged-target fetch uses domain base DN — independent of ACL search OU / maxObjects.
        var domainSearchBase = connection.BaseDn.Trim();
        var filter = string.IsNullOrWhiteSpace(request.Search?.Filter)
            ? "(|(&(objectCategory=person)(objectClass=user))(objectClass=group))"
            : request.Search!.Filter!.Trim();
        var scope = ParseScope(request.Search?.Scope);
        var maxObjects = Math.Clamp(request.Options?.MaxObjects ?? 5000, 1, 50_000);
        var scanId = string.IsNullOrWhiteSpace(request.ScanId)
            ? Guid.NewGuid().ToString()
            : request.ScanId.Trim();
        var wantShadow = features.Contains("shadow_admins_acl", StringComparer.Ordinal);

        try
        {
            await using var client = _clientFactory.Create(connection);
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromMilliseconds(connection.TimeoutMs));
            var ct = timeoutCts.Token;

            await client.TestConnectionAsync(ct).ConfigureAwait(false);

            var objects = (await client.SearchSecurableObjectsAsync(
                    searchBase,
                    filter,
                    scope,
                    maxObjects,
                    ct)
                .ConfigureAwait(false)).ToList();

            var catalogSids = objects
                .Select(o => o.ObjectSid)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .ToList();
            var accountDomainSids = SidResolutionEngine.CollectAccountDomainSids(catalogSids);

            var privilegedSids = BuildPrivilegedSidSet(objects);
            foreach (var sid in request.Options?.PrivilegedSids ?? Array.Empty<string>())
            {
                var n = LdapActiveDirectoryClient.NormalizeSid(sid);
                if (!string.IsNullOrEmpty(n))
                    privilegedSids.Add(n);
            }

            var shadowDiag = new ShadowAdminAclDetector.DetectionDiagnostics();
            if (wantShadow)
            {
                var candidates = ShadowAdminAclDetector.BuildPrivilegedSidCandidates(
                    catalogSids,
                    privilegedSids,
                    accountDomainSids);
                foreach (var sid in candidates)
                    privilegedSids.Add(sid);

                var supplemental = await ResolveMissingPrivilegedTargetsAsync(
                        client,
                        objects,
                        privilegedSids,
                        domainSearchBase,
                        ct)
                    .ConfigureAwait(false);
                shadowDiag.PrivilegedTargetsResolved = supplemental.Count;
                if (supplemental.Count > 0)
                {
                    objects.AddRange(supplemental);
                    foreach (var o in supplemental)
                    {
                        var s = LdapActiveDirectoryClient.NormalizeSid(o.ObjectSid);
                        if (!string.IsNullOrEmpty(s))
                            catalogSids.Add(s);
                    }
                }
            }

            var sidEngine = new SidResolutionEngine(
                catalogSids,
                accountDomainSids,
                domainSearchBase,
                (sid, baseDn, token) => client.LookupPrincipalBySidAsync(sid, baseDn, token));

            var uniqueTrusteeSids = CollectTrusteeSids(objects, features, privilegedSids);
            await sidEngine.EnsureResolvedAsync(uniqueTrusteeSids, ct).ConfigureAwait(false);

            var usersBySid = objects
                .Where(o => string.Equals(o.ObjectType, "user", StringComparison.OrdinalIgnoreCase))
                .Where(o => !string.IsNullOrWhiteSpace(o.ObjectSid))
                .GroupBy(o => LdapActiveDirectoryClient.NormalizeSid(o.ObjectSid), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

            var allFindings = new List<DiscoveryFindingDto>();
            var featureResults = new List<AclFeatureResultDto>();

            foreach (var feature in features)
            {
                var sw = Stopwatch.StartNew();
                List<DiscoveryFindingDto> featureFindings = feature switch
                {
                    "broken_acls" => DetectBrokenAcls(scanId, objects, sidEngine, privilegedSids),
                    "unknown_sid_bindings" => DetectUnknownSidBindings(scanId, objects, sidEngine),
                    "shadow_admins_acl" => await ShadowAdminAclDetector.DetectAsync(
                            scanId,
                            objects,
                            sidEngine,
                            privilegedSids,
                            searchBase,
                            shadowDiag,
                            usersBySid,
                            ct)
                        .ConfigureAwait(false),
                    _ => [],
                };
                sw.Stop();
                allFindings.AddRange(featureFindings);
                featureResults.Add(new AclFeatureResultDto
                {
                    Feature = feature,
                    Count = featureFindings.Count,
                    DurationMs = sw.ElapsedMilliseconds,
                });
            }

            var descriptorsRead = objects.Count(o => o.DescriptorFound && o.ParsedSd is not null);

            return new AclAnalysisResult
            {
                Success = true,
                Findings = allFindings,
                Results = featureResults,
                Diagnostics = new AclAnalysisDiagnosticsDto
                {
                    ObjectsScanned = objects.Count,
                    DescriptorsRead = descriptorsRead,
                    Endpoint = endpoint,
                    SearchBase = searchBase,
                    SidLookups = sidEngine.SidLookups,
                    SidResolved = sidEngine.SidResolved,
                    SidUnknown = sidEngine.SidUnknown,
                    WellKnownSidCount = sidEngine.WellKnownSidCount,
                    CacheHits = sidEngine.CacheHits,
                    ShadowAdminAclHits = shadowDiag.ShadowAdminAclHits,
                    TargetsConsidered = shadowDiag.TargetsConsidered,
                    TrusteeUsersConsidered = shadowDiag.TrusteeUsersConsidered,
                    PrivilegedTargetsResolved = shadowDiag.PrivilegedTargetsResolved,
                },
                Errors = errors,
            };
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            errors.Add($"ACL analysis timed out after {connection.TimeoutMs} ms.");
            return Fail(errors, endpoint, searchBase);
        }
        catch (Exception ex)
        {
            errors.Add(SanitizeExceptionMessage(ex, "ACL analysis failed"));
            _logger.LogWarning(
                "ACL analysis failed for {Endpoint}: {Error}",
                endpoint,
                SanitizeExceptionMessage(ex, "ACL analysis failed"));
            return Fail(errors, endpoint, searchBase);
        }
    }

    private static async Task<List<SecurableDirectoryObject>> ResolveMissingPrivilegedTargetsAsync(
        IActiveDirectoryClient client,
        IReadOnlyList<SecurableDirectoryObject> existing,
        IReadOnlySet<string> privilegedSids,
        string domainSearchBase,
        CancellationToken cancellationToken)
    {
        var have = new HashSet<string>(
            existing.Select(o => LdapActiveDirectoryClient.NormalizeSid(o.ObjectSid))
                .Where(s => s.Length > 0),
            StringComparer.OrdinalIgnoreCase);

        var added = new List<SecurableDirectoryObject>();
        foreach (var sid in privilegedSids)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var norm = LdapActiveDirectoryClient.NormalizeSid(sid);
            if (string.IsNullOrEmpty(norm) || have.Contains(norm))
                continue;

            SidLookupResult? lookup;
            try
            {
                lookup = await client.LookupPrincipalBySidAsync(norm, domainSearchBase, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch
            {
                continue;
            }

            if (lookup is null || string.IsNullOrWhiteSpace(lookup.DistinguishedName))
                continue;

            SecurityDescriptorResult sd;
            try
            {
                sd = await client.ReadSecurityDescriptorAsync(lookup.DistinguishedName, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch
            {
                continue;
            }

            var objectType = ResolveObjectType(lookup.ObjectClass, lookup.DistinguishedName);
            // Shadow-admin Node parity: users + groups only as targets.
            if (objectType is not ("user" or "group"))
                continue;

            added.Add(new SecurableDirectoryObject
            {
                DistinguishedName = lookup.DistinguishedName,
                ObjectType = objectType,
                ObjectName = lookup.ObjectName
                              ?? lookup.DistinguishedName,
                ObjectSid = norm,
                DescriptorFound = sd.Found && sd.Parsed is not null,
                ParsedSd = sd.Parsed,
                DescriptorError = sd.DecodeError,
            });
            have.Add(norm);
        }

        return added;
    }

    private static string ResolveObjectType(string? objectClass, string dn)
    {
        var oc = (objectClass ?? string.Empty).ToLowerInvariant();
        if (oc.Contains("foreignsecurityprincipal", StringComparison.Ordinal)
            || dn.Contains("ForeignSecurityPrincipals", StringComparison.OrdinalIgnoreCase))
            return "foreign_security_principal";
        if (oc.Contains("group", StringComparison.Ordinal))
            return "group";
        if (oc.Contains("user", StringComparison.Ordinal) || oc.Contains("person", StringComparison.Ordinal))
            return "user";
        if (oc.Contains("computer", StringComparison.Ordinal))
            return "computer";
        if (oc.Contains("organizationalunit", StringComparison.Ordinal))
            return "organizationalUnit";
        return "object";
    }

    private static AclAnalysisResult Fail(List<string> errors, string endpoint, string searchBase) =>
        new()
        {
            Success = false,
            Errors = errors,
            Diagnostics = new AclAnalysisDiagnosticsDto
            {
                Endpoint = endpoint,
                SearchBase = searchBase,
            },
        };

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

    private static HashSet<string> BuildPrivilegedSidSet(IReadOnlyList<SecurableDirectoryObject> objects)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var obj in objects)
        {
            if (!IsPrivilegedName(obj.ObjectName))
                continue;
            var sid = LdapActiveDirectoryClient.NormalizeSid(obj.ObjectSid);
            if (!string.IsNullOrEmpty(sid))
                set.Add(sid);
        }
        return set;
    }

    private static bool IsPrivilegedName(string? name) =>
        ShadowAdminAclDetector.IsPrivilegedName(name);

    private static bool IsSensitiveObject(SecurableDirectoryObject obj, HashSet<string> privilegedSids)
    {
        var sid = LdapActiveDirectoryClient.NormalizeSid(obj.ObjectSid);
        if (!string.IsNullOrEmpty(sid) && privilegedSids.Contains(sid))
            return true;
        return Regex.IsMatch(obj.ObjectName ?? string.Empty, "admin|privileged|schema|enterprise", RegexOptions.IgnoreCase);
    }

    private static List<string> CollectTrusteeSids(
        IReadOnlyList<SecurableDirectoryObject> objects,
        IReadOnlyList<string> features,
        IReadOnlySet<string> privilegedSids)
    {
        var needBroken = features.Contains("broken_acls", StringComparer.Ordinal)
                         || features.Contains("unknown_sid_bindings", StringComparer.Ordinal);
        var needShadow = features.Contains("shadow_admins_acl", StringComparer.Ordinal);
        if (!needBroken && !needShadow)
            return [];

        var candidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var obj in objects)
        {
            var parsed = obj.ParsedSd;
            if (parsed is null)
                continue;

            void Consider(string? sid)
            {
                var norm = LdapActiveDirectoryClient.NormalizeSid(sid);
                if (string.IsNullOrEmpty(norm))
                    return;
                if (!norm.StartsWith("S-", StringComparison.OrdinalIgnoreCase))
                    return;
                candidates.Add(norm);
            }

            if (needBroken)
            {
                Consider(parsed.OwnerSid);
                Consider(parsed.GroupSid);
                foreach (var ace in parsed.Aces)
                    Consider(ace.TrusteeSid);
            }

            if (needShadow && ShadowAdminAclDetector.IsPrivilegedTarget(obj, privilegedSids))
            {
                foreach (var ace in parsed.Aces)
                {
                    if (!ace.IsAllowed || !ShadowAdminAccessRights.HasShadowAdminRights(ace.AccessMask))
                        continue;
                    Consider(ace.TrusteeSid);
                }
            }
        }

        return candidates.ToList();
    }

    private static List<DiscoveryFindingDto> DetectBrokenAcls(
        string scanId,
        IReadOnlyList<SecurableDirectoryObject> objects,
        SidResolutionEngine sidEngine,
        HashSet<string> privilegedSids)
    {
        var findings = new List<DiscoveryFindingDto>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var obj in objects)
        {
            var parsed = obj.ParsedSd;
            if (parsed is null)
                continue;

            var isSensitive = IsSensitiveObject(obj, privilegedSids);

            if (parsed.DaclPresent && parsed.DaclHeaderAceCount > 0 && parsed.DaclAceCount == 0)
            {
                var sig = $"{obj.DistinguishedName}|invalid_ace_structure";
                if (seen.Add(sig))
                {
                    findings.Add(Finding(
                        scanId,
                        "broken_acls",
                        obj,
                        "invalid_ace_structure",
                        "BROKEN_ACL",
                        new Dictionary<string, object?>
                        {
                            ["expectedAceCount"] = parsed.DaclHeaderAceCount,
                            ["parsedAceCount"] = parsed.DaclAceCount,
                        }));
                }
            }

            if (isSensitive && parsed.DaclPresent && parsed.DaclAceCount == 0)
            {
                var sig = $"{obj.DistinguishedName}|empty_dacl";
                if (seen.Add(sig))
                {
                    findings.Add(Finding(
                        scanId,
                        "broken_acls",
                        obj,
                        "empty_dacl_on_sensitive_object",
                        "BROKEN_ACL",
                        new Dictionary<string, object?>
                        {
                            ["ownerSid"] = parsed.OwnerSid,
                            ["groupSid"] = parsed.GroupSid,
                        }));
                }
            }

            foreach (var ace in parsed.Aces)
            {
                var sid = LdapActiveDirectoryClient.NormalizeSid(ace.TrusteeSid);
                if (string.IsNullOrEmpty(sid))
                {
                    var sig = $"{obj.DistinguishedName}|missing_trustee|{ace.AceSize}";
                    if (!seen.Add(sig))
                        continue;
                    findings.Add(Finding(
                        scanId,
                        "broken_acls",
                        obj,
                        "invalid_ace_target",
                        "BROKEN_ACL",
                        new Dictionary<string, object?>
                        {
                            ["aclType"] = ace.AclType,
                            ["aceType"] = ace.AceType,
                            ["aceSize"] = ace.AceSize,
                        }));
                    continue;
                }

                if (!sidEngine.IsKnown(sid))
                {
                    var sig = $"{obj.DistinguishedName}|orphan|{sid}";
                    if (!seen.Add(sig))
                        continue;
                    findings.Add(Finding(
                        scanId,
                        "broken_acls",
                        obj,
                        "orphan_acl_principal",
                        "BROKEN_ACL",
                        new Dictionary<string, object?>
                        {
                            ["orphanSid"] = sid,
                            ["aclType"] = ace.AclType,
                            ["accessMask"] = ace.AccessMask,
                            ["stalePermission"] = true,
                        }));
                }
            }
        }

        return findings;
    }

    private static List<DiscoveryFindingDto> DetectUnknownSidBindings(
        string scanId,
        IReadOnlyList<SecurableDirectoryObject> objects,
        SidResolutionEngine sidEngine)
    {
        var findings = new List<DiscoveryFindingDto>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var obj in objects)
        {
            var parsed = obj.ParsedSd;
            if (parsed is null)
                continue;

            void CheckPrincipal(string? sid, string role)
            {
                var norm = LdapActiveDirectoryClient.NormalizeSid(sid);
                if (string.IsNullOrEmpty(norm) || sidEngine.IsKnown(norm))
                    return;
                var sig = $"{obj.DistinguishedName}|{role}|{norm}";
                if (!seen.Add(sig))
                    return;
                findings.Add(Finding(
                    scanId,
                    "unknown_sid_bindings",
                    obj,
                    "unknown_descriptor_principal",
                    "UNKNOWN_SID_BINDING",
                    new Dictionary<string, object?>
                    {
                        ["unresolvedSid"] = norm,
                        ["bindingRole"] = role,
                        ["descriptorRevision"] = parsed.Revision,
                    }));
            }

            CheckPrincipal(parsed.OwnerSid, "owner");
            CheckPrincipal(parsed.GroupSid, "group");

            foreach (var ace in parsed.Aces)
            {
                var sid = LdapActiveDirectoryClient.NormalizeSid(ace.TrusteeSid);
                if (string.IsNullOrEmpty(sid) || sidEngine.IsKnown(sid))
                    continue;
                var sig = $"{obj.DistinguishedName}|ace|{sid}|{ace.AccessMask}";
                if (!seen.Add(sig))
                    continue;
                findings.Add(Finding(
                    scanId,
                    "unknown_sid_bindings",
                    obj,
                    "unknown_ace_trustee",
                    "UNKNOWN_SID_BINDING",
                    new Dictionary<string, object?>
                    {
                        ["unresolvedSid"] = sid,
                        ["aclType"] = ace.AclType,
                        ["aceType"] = ace.AceType,
                        ["accessMask"] = ace.AccessMask,
                        ["aceFlags"] = ace.AceFlags,
                    }));
            }
        }

        return findings;
    }

    private static DiscoveryFindingDto Finding(
        string scanId,
        string feature,
        SecurableDirectoryObject obj,
        string status,
        string signal,
        Dictionary<string, object?> evidence) =>
        new()
        {
            ScanId = scanId,
            Feature = feature,
            ObjectType = obj.ObjectType,
            ObjectName = string.IsNullOrWhiteSpace(obj.ObjectName) ? "—" : obj.ObjectName,
            Dn = obj.DistinguishedName,
            Status = status,
            Attributes = new Dictionary<string, object?>(),
            Evidence = evidence,
            Relationships = Array.Empty<object>(),
            FindingType = signal,
            FindingSignals = [signal],
        };

    private static string SanitizeExceptionMessage(Exception ex, string prefix)
    {
        var message = ex.Message ?? ex.GetType().Name;
        message = Regex.Replace(
            message,
            @"(password|pwd|passwd|secret)\s*=\s*\S+",
            "$1=***",
            RegexOptions.IgnoreCase);
        return $"{prefix}: {message}";
    }
}
