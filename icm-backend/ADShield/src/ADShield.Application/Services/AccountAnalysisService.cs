using System.Diagnostics;
using System.DirectoryServices.Protocols;
using ADShield.ActiveDirectory;
using ADShield.Configuration;
using ADShield.Models;
using Microsoft.Extensions.Logging;

namespace ADShield.Application.Services;

public interface IAccountAnalysisService
{
    Task<AccountAnalysisResult> AnalyzeAsync(
        AccountAnalysisRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Live user-account Security Posture detectors (Node userAccountSecurity.js semantics).
/// </summary>
public sealed class AccountAnalysisService : IAccountAnalysisService
{
    public static readonly string[] SupportedFeatures =
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

    private static readonly string[] UserAttributes =
    [
        "distinguishedName",
        "sAMAccountName",
        "displayName",
        "cn",
        "userAccountControl",
        "lastLogonTimestamp",
        "lockoutTime",
        "servicePrincipalName",
        "objectClass",
        "objectSid",
    ];

    private readonly IActiveDirectoryClientFactory _clientFactory;
    private readonly ILogger<AccountAnalysisService> _logger;

    public AccountAnalysisService(
        IActiveDirectoryClientFactory clientFactory,
        ILogger<AccountAnalysisService> logger)
    {
        _clientFactory = clientFactory;
        _logger = logger;
    }

    public async Task<AccountAnalysisResult> AnalyzeAsync(
        AccountAnalysisRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var connection = request.Connection ?? new ActiveDirectoryConnectionOptions();
        connection.EnsureNormalized();
        var validation = ActiveDirectoryConnectionOptionsValidator.Validate(connection);
        if (validation.Count > 0)
        {
            return new AccountAnalysisResult { Success = false, Errors = validation };
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
            return new AccountAnalysisResult
            {
                Success = false,
                Errors =
                [
                    $"No supported account features requested. Supported: {string.Join(", ", SupportedFeatures)}.",
                ],
            };
        }

        var opts = request.Options ?? new AccountAnalysisOptions();
        var maxObjects = Math.Clamp(opts.MaxObjects <= 0 ? 5000 : opts.MaxObjects, 1, 50000);
        var inactiveDays = Math.Clamp(opts.InactiveDays <= 0 ? 90 : opts.InactiveDays, 1, 3650);
        var scanId = string.IsNullOrWhiteSpace(request.ScanId) ? Guid.NewGuid().ToString("N") : request.ScanId.Trim();

        var search = request.Search ?? new AclSearchOptions();
        var baseDn = string.IsNullOrWhiteSpace(search.BaseDn)
            ? connection.BaseDn
            : search.BaseDn.Trim();
        if (string.IsNullOrWhiteSpace(baseDn))
        {
            return new AccountAnalysisResult
            {
                Success = false,
                Errors = ["Search.BaseDn (or connection.BaseDn) is required."],
            };
        }

        var filter = string.IsNullOrWhiteSpace(search.Filter)
            ? "(&(objectCategory=person)(objectClass=user))"
            : search.Filter.Trim();
        var scope = ParseScope(search.Scope);

        try
        {
            await using var client = _clientFactory.Create(connection);
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromMilliseconds(connection.TimeoutMs));
            var ct = timeoutCts.Token;

            await client.TestConnectionAsync(ct).ConfigureAwait(false);

            var sw = Stopwatch.StartNew();
            var hits = await client.SearchAsync(baseDn, filter, scope, UserAttributes, maxObjects, ct)
                .ConfigureAwait(false);
            sw.Stop();

            _logger.LogInformation(
                "Account analysis scanned {Count} users in {Ms}ms for features={Features}",
                hits.Count,
                sw.ElapsedMilliseconds,
                string.Join(",", features));

            var findings = new List<DiscoveryFindingDto>();
            var counts = features.ToDictionary(f => f, _ => 0, StringComparer.Ordinal);

            foreach (var hit in hits)
            {
                AnalyzeUser(hit, scanId, features, inactiveDays, findings, counts);
            }

            var results = features
                .Select(f => new AclFeatureResultDto
                {
                    Feature = f,
                    Count = counts[f],
                    DurationMs = sw.ElapsedMilliseconds,
                })
                .ToList();

            return new AccountAnalysisResult
            {
                Success = true,
                Findings = findings,
                Results = results,
                Diagnostics = new AccountAnalysisDiagnosticsDto
                {
                    ObjectsScanned = hits.Count,
                    Endpoint = connection.EndpointDisplay,
                    SearchBase = baseDn,
                    InactiveDays = inactiveDays,
                },
            };
        }
        catch (DirectoryOperationException ex)
        {
            _logger.LogWarning(ex, "Account analysis LDAP failure");
            return new AccountAnalysisResult
            {
                Success = false,
                Errors = [DescribeDirectoryError(ex)],
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Account analysis failed");
            return new AccountAnalysisResult
            {
                Success = false,
                Errors = [ex.Message],
            };
        }
    }

    private static void AnalyzeUser(
        DirectorySearchHit hit,
        string scanId,
        IReadOnlyList<string> features,
        int inactiveDays,
        List<DiscoveryFindingDto> findings,
        Dictionary<string, int> counts)
    {
        var dn = hit.DistinguishedName;
        if (string.IsNullOrWhiteSpace(dn))
            return;

        var uac = UserAccountControl.Parse(UserAccountControl.Attr(hit, "userAccountControl"));
        var sam = UserAccountControl.Attr(hit, "sAMAccountName");
        var display = UserAccountControl.Attr(hit, "displayName");
        var objectName = !string.IsNullOrWhiteSpace(sam)
            ? sam
            : (!string.IsNullOrWhiteSpace(display) ? display : UserAccountControl.Attr(hit, "cn"));
        if (string.IsNullOrWhiteSpace(objectName))
            objectName = dn;

        var lastLogon = UserAccountControl.Attr(hit, "lastLogonTimestamp");
        var lockoutTime = UserAccountControl.Attr(hit, "lockoutTime");
        var spns = UserAccountControl.AttrAll(hit, "servicePrincipalName");
        var accountStatus = UserAccountControl.ClassifyAccountStatus(uac);

        var attrs = new Dictionary<string, object?>
        {
            ["userAccountControl"] = uac,
            ["lastLogonTimestamp"] = string.IsNullOrEmpty(lastLogon) ? null : lastLogon,
            ["lockoutTime"] = string.IsNullOrEmpty(lockoutTime) ? null : lockoutTime,
            ["sAMAccountName"] = sam,
        };

        void Add(
            string feature,
            string status,
            string findingType,
            string[] signals,
            Dictionary<string, object?>? evidence = null)
        {
            counts[feature] += 1;
            findings.Add(new DiscoveryFindingDto
            {
                ScanId = scanId,
                Feature = feature,
                ObjectType = "user",
                ObjectName = objectName,
                Dn = dn,
                Status = status,
                Attributes = new Dictionary<string, object?>(attrs),
                Evidence = evidence ?? new Dictionary<string, object?>(),
                Relationships = Array.Empty<object>(),
                FindingType = findingType,
                FindingSignals = signals,
            });
        }

        if (features.Contains("disabled_users")
            && (UserAccountControl.IsDisabled(uac) || accountStatus == "inactive"))
        {
            Add("disabled_users", "disabled", "DISABLED_USER", ["DISABLED_USER"]);
        }

        if (features.Contains("inactive_users"))
        {
            var activeAccount = !UserAccountControl.IsDisabled(uac) && accountStatus == "active";
            if (activeAccount && UserAccountControl.IsOlderThanDays(lastLogon, inactiveDays))
            {
                Add(
                    "inactive_users",
                    $"inactive_{inactiveDays}d",
                    "INACTIVE_USER",
                    ["INACTIVE_USER"],
                    new Dictionary<string, object?> { ["inactiveDays"] = inactiveDays });
            }
        }

        if (features.Contains("locked_accounts")
            && (UserAccountControl.IsAccountLockedByLockoutTime(lockoutTime)
                || UserAccountControl.IsLocked(uac)))
        {
            Add("locked_accounts", "locked", "LOCKED_ACCOUNT", ["LOCKED_ACCOUNT"]);
        }

        if (features.Contains("password_never_expires") && UserAccountControl.PasswordNeverExpires(uac))
        {
            Add(
                "password_never_expires",
                "password_never_expires",
                "PASSWORD_NEVER_EXPIRES",
                ["PASSWORD_NEVER_EXPIRES"]);
        }

        if (features.Contains("password_not_required") && UserAccountControl.PasswordNotRequired(uac))
        {
            Add(
                "password_not_required",
                "password_not_required",
                "PASSWORD_NOT_REQUIRED",
                ["PASSWORD_NOT_REQUIRED"]);
        }

        if (features.Contains("reversible_encryption_enabled")
            && UserAccountControl.ReversibleEncryptionEnabled(uac))
        {
            Add(
                "reversible_encryption_enabled",
                "reversible_encryption",
                "REVERSIBLE_ENCRYPTION_ENABLED",
                ["REVERSIBLE_ENCRYPTION_ENABLED"]);
        }

        if (features.Contains("smartcard_not_required") && UserAccountControl.SmartcardNotRequired(uac))
        {
            Add(
                "smartcard_not_required",
                "smartcard_not_required",
                "SMARTCARD_NOT_REQUIRED",
                ["SMARTCARD_NOT_REQUIRED"]);
        }

        if (features.Contains("service_accounts") && spns.Count > 0)
        {
            Add(
                "service_accounts",
                "has_spn",
                "SERVICE_ACCOUNT",
                ["SERVICE_ACCOUNT"],
                new Dictionary<string, object?>
                {
                    ["spnCount"] = spns.Count,
                    ["servicePrincipalNames"] = spns.ToList(),
                });
        }
    }

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
