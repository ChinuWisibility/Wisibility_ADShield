using System.DirectoryServices.Protocols;
using ADShield.ActiveDirectory;
using ADShield.Configuration;
using ADShield.Models;
using Microsoft.Extensions.Logging;

namespace ADShield.Application.Services;

public interface ISecurityRemediationService
{
    Task<SecurityRemediationResult> RemediateAsync(
        SecurityRemediationRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Explicit AD write remediations. Every action requires an exact target DN and typed action.
/// No inferred targets, no hardcoded domain/OU assumptions.
/// </summary>
public sealed class SecurityRemediationService : ISecurityRemediationService
{
    public static readonly string[] SupportedActions =
    [
        "remove_dacl_ace",
        "clear_sid_history",
        "delete_foreign_security_principal",
    ];

    private readonly IActiveDirectoryClientFactory _clientFactory;
    private readonly ILogger<SecurityRemediationService> _logger;

    public SecurityRemediationService(
        IActiveDirectoryClientFactory clientFactory,
        ILogger<SecurityRemediationService> logger)
    {
        _clientFactory = clientFactory;
        _logger = logger;
    }

    public async Task<SecurityRemediationResult> RemediateAsync(
        SecurityRemediationRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var connection = request.Connection ?? new ActiveDirectoryConnectionOptions();
        connection.EnsureNormalized();
        var validation = ActiveDirectoryConnectionOptionsValidator.Validate(connection);
        if (validation.Count > 0)
            return Fail(request, validation);

        var action = request.Action ?? new SecurityRemediationAction();
        var type = (action.Type ?? string.Empty).Trim().ToLowerInvariant();
        var targetDn = (action.TargetDn ?? string.Empty).Trim();

        if (string.IsNullOrEmpty(type) || !SupportedActions.Contains(type, StringComparer.Ordinal))
        {
            return Fail(request,
            [
                $"Unsupported or missing action Type. Supported: {string.Join(", ", SupportedActions)}.",
            ]);
        }

        if (string.IsNullOrEmpty(targetDn))
            return Fail(request, ["Action.TargetDn is required (exact distinguished name)."]);

        try
        {
            await using var client = _clientFactory.Create(connection);
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromMilliseconds(connection.TimeoutMs));
            var ct = timeoutCts.Token;

            await client.TestConnectionAsync(ct).ConfigureAwait(false);

            return type switch
            {
                "remove_dacl_ace" => await RemoveDaclAceAsync(client, request, action, targetDn, ct)
                    .ConfigureAwait(false),
                "clear_sid_history" => await ClearSidHistoryAsync(client, request, action, targetDn, ct)
                    .ConfigureAwait(false),
                "delete_foreign_security_principal" => await DeleteFspAsync(client, request, action, targetDn, ct)
                    .ConfigureAwait(false),
                _ => Fail(request, [$"Action '{type}' is not implemented."]),
            };
        }
        catch (DirectoryOperationException ex)
        {
            _logger.LogWarning(ex, "Remediation LDAP failure on {Dn}", targetDn);
            return Fail(request, [DescribeDirectoryError(ex)]);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Remediation failed on {Dn}", targetDn);
            return Fail(request, [ex.Message]);
        }
    }

    private async Task<SecurityRemediationResult> RemoveDaclAceAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        var trustee = LdapActiveDirectoryClient.NormalizeSid(action.TrusteeSid);
        if (string.IsNullOrEmpty(trustee))
            return Fail(request, ["Action.TrusteeSid is required for remove_dacl_ace."]);

        if (!SecurityDescriptorEditor.TryParseAccessMask(action.AccessMask, out var mask, out var maskError))
            return Fail(request, [maskError!]);

        var sd = await client.ReadSecurityDescriptorAsync(targetDn, ct).ConfigureAwait(false);
        if (!sd.Found || string.IsNullOrEmpty(sd.SecurityDescriptorBase64))
            return Fail(request, [$"nTSecurityDescriptor could not be read for {targetDn}."]);

        byte[] original;
        try
        {
            original = Convert.FromBase64String(sd.SecurityDescriptorBase64);
        }
        catch
        {
            return Fail(request, ["Stored security descriptor was not valid base64."]);
        }

        var edited = SecurityDescriptorEditor.RemoveDaclAces(original, new SecurityDescriptorEditor.RemoveAceRequest
        {
            TrusteeSid = trustee,
            AccessMask = string.IsNullOrWhiteSpace(action.AccessMask) ? null : mask,
            AceType = action.AceType,
            RemoveAllMatches = true,
        });

        if (!edited.Success || edited.SecurityDescriptor is null)
            return Fail(request, [edited.Error ?? "ACE removal failed."]);

        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "remove_dacl_ace",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = edited.Changes,
                Verification = new Dictionary<string, object?>
                {
                    ["wouldRemoveCount"] = edited.RemovedCount,
                    ["descriptorBytesBefore"] = original.Length,
                    ["descriptorBytesAfter"] = edited.SecurityDescriptor.Length,
                },
            };
        }

        await client.ReplaceSecurityDescriptorAsync(targetDn, edited.SecurityDescriptor, ct)
            .ConfigureAwait(false);

        var verification = new Dictionary<string, object?>();
        if (request.VerifyAfter)
        {
            var after = await client.ReadSecurityDescriptorAsync(targetDn, ct).ConfigureAwait(false);
            var remaining = after.Parsed?.Aces?
                .Count(a => LdapActiveDirectoryClient.NormalizeSid(a.TrusteeSid) == trustee
                            && (!string.IsNullOrWhiteSpace(action.AccessMask) ? a.AccessMask == mask : true)
                            && (!action.AceType.HasValue || a.AceType == action.AceType.Value))
                ?? -1;
            verification["trusteeAcesRemaining"] = remaining;
            verification["verified"] = remaining == 0;
            if (remaining != 0)
            {
                return new SecurityRemediationResult
                {
                    Success = false,
                    ActionType = "remove_dacl_ace",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = edited.Changes,
                    Errors = ["Write succeeded but verification still found matching trustee ACE(s)."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "remove_dacl_ace", targetDn, edited.Changes, verification);
    }

    private async Task<SecurityRemediationResult> ClearSidHistoryAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        var before = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "sAMAccountName", "sIDHistory", "objectClass"],
                ct)
            .ConfigureAwait(false);
        if (before is null)
            return Fail(request, [$"Object not found: {targetDn}"]);

        var history = before.Attributes.TryGetValue("sIDHistory", out var vals) ? vals : Array.Empty<string>();
        if (history.Count == 0)
            return Fail(request, ["Object has no sIDHistory attribute to clear."]);

        var changesDesc = new[] { $"Clear sIDHistory ({history.Count} value(s)) on {targetDn}" };

        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "clear_sid_history",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = changesDesc,
                Verification = new Dictionary<string, object?> { ["sidHistoryCount"] = history.Count },
            };
        }

        // Replace with empty = clear multi-valued attribute on AD.
        await client.ModifyAttributesAsync(
                targetDn,
                [
                    new DirectoryAttributeChange
                    {
                        AttributeName = "sIDHistory",
                        Operation = AttributeChangeOperation.Delete,
                        Values = Array.Empty<object>(),
                    },
                ],
                ct)
            .ConfigureAwait(false);

        var verification = new Dictionary<string, object?>();
        if (request.VerifyAfter)
        {
            var after = await client.ReadObjectAsync(targetDn, ["sIDHistory"], ct).ConfigureAwait(false);
            var remaining = after?.Attributes.TryGetValue("sIDHistory", out var h) == true ? h.Count : 0;
            verification["sidHistoryRemaining"] = remaining;
            verification["verified"] = remaining == 0;
            if (remaining != 0)
            {
                return new SecurityRemediationResult
                {
                    Success = false,
                    ActionType = "clear_sid_history",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Write succeeded but sIDHistory is still present."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "clear_sid_history", targetDn, changesDesc, verification);
    }

    private async Task<SecurityRemediationResult> DeleteFspAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        var obj = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "objectClass", "objectSid", "cn"],
                ct)
            .ConfigureAwait(false);
        if (obj is null)
            return Fail(request, [$"Object not found: {targetDn}"]);

        var oc = obj.ObjectClass ?? string.Empty;
        var isFsp =
            oc.Contains("foreignSecurityPrincipal", StringComparison.OrdinalIgnoreCase)
            || targetDn.Contains("CN=ForeignSecurityPrincipals,", StringComparison.OrdinalIgnoreCase);
        if (!isFsp)
        {
            return Fail(request,
            [
                "Refusing delete_foreign_security_principal: target is not a foreignSecurityPrincipal.",
            ]);
        }

        var changesDesc = new[] { $"Delete foreignSecurityPrincipal {targetDn}" };
        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "delete_foreign_security_principal",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = changesDesc,
            };
        }

        await client.DeleteObjectAsync(targetDn, ct).ConfigureAwait(false);

        var verification = new Dictionary<string, object?>();
        if (request.VerifyAfter)
        {
            var after = await client.ReadObjectAsync(targetDn, ["cn"], ct).ConfigureAwait(false);
            verification["stillExists"] = after is not null;
            verification["verified"] = after is null;
            if (after is not null)
            {
                return new SecurityRemediationResult
                {
                    Success = false,
                    ActionType = "delete_foreign_security_principal",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Delete reported success but object still exists."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "delete_foreign_security_principal", targetDn, changesDesc, verification);
    }

    private static SecurityRemediationResult Ok(
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string type,
        string targetDn,
        IReadOnlyList<string> changes,
        Dictionary<string, object?> verification) =>
        new()
        {
            Success = true,
            DryRun = false,
            ActionType = type,
            TargetDn = targetDn,
            Feature = action.Feature,
            CorrelationId = request.CorrelationId,
            Changes = changes,
            Verification = verification,
        };

    private static SecurityRemediationResult Fail(
        SecurityRemediationRequest request,
        IReadOnlyList<string> errors) =>
        new()
        {
            Success = false,
            DryRun = request.DryRun,
            ActionType = request.Action?.Type ?? string.Empty,
            TargetDn = request.Action?.TargetDn ?? string.Empty,
            Feature = request.Action?.Feature,
            CorrelationId = request.CorrelationId,
            Errors = errors.ToList(),
        };

    private static string DescribeDirectoryError(DirectoryOperationException ex)
    {
        var response = ex.Response;
        if (response is not null)
            return $"LDAP {response.ResultCode}: {response.ErrorMessage ?? ex.Message}";
        return ex.Message;
    }
}
