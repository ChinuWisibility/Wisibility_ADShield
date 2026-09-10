using ADShield.Models;

namespace ADShield.ActiveDirectory;

/// <summary>
/// Request-scoped SID resolution: well-known/Builtin → scan catalog → targeted LDAP lookup.
/// Separates principal validity from ACL maxObjects enumeration.
/// </summary>
public sealed class SidResolutionEngine
{
    private readonly Dictionary<string, SidResolutionResult> _cache =
        new(StringComparer.OrdinalIgnoreCase);

    private readonly HashSet<string> _catalogSids;
    private readonly HashSet<string> _accountDomainSids;
    private readonly string _domainSearchBaseDn;
    private readonly Func<string, string, CancellationToken, Task<SidLookupResult?>> _ldapLookup;

    public int SidLookups { get; private set; }
    public int SidResolved { get; private set; }
    public int SidUnknown { get; private set; }
    public int WellKnownSidCount { get; private set; }
    public int CacheHits { get; private set; }

    public SidResolutionEngine(
        IEnumerable<string> catalogSids,
        IEnumerable<string> accountDomainSids,
        string domainSearchBaseDn,
        Func<string, string, CancellationToken, Task<SidLookupResult?>> ldapLookup)
    {
        _catalogSids = new HashSet<string>(
            catalogSids.Select(LdapActiveDirectoryClient.NormalizeSid).Where(s => s.Length > 0),
            StringComparer.OrdinalIgnoreCase);
        _accountDomainSids = new HashSet<string>(
            accountDomainSids.Select(LdapActiveDirectoryClient.NormalizeSid).Where(s => s.Length > 0),
            StringComparer.OrdinalIgnoreCase);
        _domainSearchBaseDn = domainSearchBaseDn?.Trim() ?? string.Empty;
        _ldapLookup = ldapLookup ?? throw new ArgumentNullException(nameof(ldapLookup));
    }

    public static HashSet<string> CollectAccountDomainSids(IEnumerable<string?> objectSids)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var sid in objectSids)
        {
            var domain = WellKnownSidRecognizer.TryGetAccountDomainSid(sid);
            if (!string.IsNullOrEmpty(domain))
                set.Add(domain);
        }
        return set;
    }

    public async Task EnsureResolvedAsync(
        IEnumerable<string> sidCandidates,
        CancellationToken cancellationToken = default)
    {
        foreach (var sid in sidCandidates
                     .Select(LdapActiveDirectoryClient.NormalizeSid)
                     .Where(s => s.Length > 0)
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            cancellationToken.ThrowIfCancellationRequested();
            _ = await ResolveAsync(sid, cancellationToken).ConfigureAwait(false);
        }
    }

    public async Task<SidResolutionResult> ResolveAsync(
        string? sidString,
        CancellationToken cancellationToken = default)
    {
        var sid = LdapActiveDirectoryClient.NormalizeSid(sidString);
        if (string.IsNullOrEmpty(sid))
        {
            return new SidResolutionResult
            {
                Sid = string.Empty,
                Classification = SidClassification.Unknown,
            };
        }

        if (_cache.TryGetValue(sid, out var cached))
        {
            CacheHits++;
            return cached with { FromCache = true };
        }

        // 1) Framework well-known / Builtin (and domain-relative well-known when domain SID known).
        var wellKnown = WellKnownSidRecognizer.TryClassify(sid, _accountDomainSids);
        if (wellKnown is SidClassification wk)
        {
            if (wk is SidClassification.KnownWellKnown or SidClassification.KnownBuiltin)
                WellKnownSidCount++;
            var result = new SidResolutionResult
            {
                Sid = sid,
                Classification = wk,
            };
            _cache[sid] = result;
            SidResolved++;
            return result;
        }

        // 2) Already in ACL enumeration catalog.
        if (_catalogSids.Contains(sid))
        {
            var result = new SidResolutionResult
            {
                Sid = sid,
                Classification = SidClassification.KnownDirectoryObject,
            };
            _cache[sid] = result;
            SidResolved++;
            return result;
        }

        // 3) Targeted LDAP lookup under domain base (NOT limited by maxObjects).
        SidLookups++;
        SidLookupResult? lookup = null;
        if (!string.IsNullOrWhiteSpace(_domainSearchBaseDn))
        {
            try
            {
                lookup = await _ldapLookup(sid, _domainSearchBaseDn, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch
            {
                lookup = null;
            }
        }

        if (lookup is not null && !string.IsNullOrWhiteSpace(lookup.DistinguishedName))
        {
            // Discover domain SID from resolved account for subsequent well-known checks.
            var domain = WellKnownSidRecognizer.TryGetAccountDomainSid(sid);
            if (!string.IsNullOrEmpty(domain))
                _accountDomainSids.Add(domain);

            var classification = lookup.IsForeignSecurityPrincipal
                ? SidClassification.KnownForeignPrincipal
                : SidClassification.KnownDirectoryObject;

            // Re-check domain-relative well-known now that we may have domain SID.
            var wkAfter = WellKnownSidRecognizer.TryClassify(sid, _accountDomainSids);
            if (wkAfter is SidClassification.KnownDomainPrincipal)
                classification = SidClassification.KnownDomainPrincipal;

            var result = new SidResolutionResult
            {
                Sid = sid,
                Classification = classification,
                DistinguishedName = lookup.DistinguishedName,
                ObjectName = lookup.ObjectName,
                ObjectClass = lookup.ObjectClass,
                FromLdapLookup = true,
            };
            _cache[sid] = result;
            SidResolved++;
            return result;
        }

        var unknown = new SidResolutionResult
        {
            Sid = sid,
            Classification = SidClassification.Unknown,
            FromLdapLookup = SidLookups > 0,
        };
        _cache[sid] = unknown;
        SidUnknown++;
        return unknown;
    }

    public bool IsKnown(string? sidString)
    {
        var sid = LdapActiveDirectoryClient.NormalizeSid(sidString);
        if (string.IsNullOrEmpty(sid))
            return false;
        if (_cache.TryGetValue(sid, out var cached))
        {
            CacheHits++;
            return cached.IsKnown;
        }

        // Synchronous fast-path for callers that already ran EnsureResolvedAsync.
        var wk = WellKnownSidRecognizer.TryClassify(sid, _accountDomainSids);
        if (wk is not null)
            return true;
        return _catalogSids.Contains(sid);
    }
}
