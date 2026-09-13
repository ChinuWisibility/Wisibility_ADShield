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
        "enable_account",
        "disable_account",
        "unlock_account",
        "clear_password_never_expires",
        "clear_password_not_required",
        "clear_reversible_encryption",
        "require_smartcard",
        "remove_service_principal_names",
        "delete_user_account",
        "delete_group",
        "delete_computer",
        "remove_group_member",
        "set_managed_by",
        "move_object",
        "clear_dont_require_preauth",
        "clear_trusted_for_delegation",
        "clear_constrained_delegation",
        "clear_rbcd",
    ];

    private static readonly HashSet<string> ProtectedSamAccounts = new(StringComparer.OrdinalIgnoreCase)
    {
        "Administrator",
        "krbtgt",
        "Guest",
    };

    private static readonly HashSet<string> ProtectedGroupSamAccounts = new(StringComparer.OrdinalIgnoreCase)
    {
        "Domain Admins",
        "Enterprise Admins",
        "Schema Admins",
        "Administrators",
    };

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
                "enable_account" => await ModifyUacFlagAsync(
                        client, request, action, targetDn, UserAccountControl.AccountDisabled, clear: true,
                        alreadyOk: uac => !UserAccountControl.IsDisabled(uac),
                        verifyOk: uac => !UserAccountControl.IsDisabled(uac),
                        "enable_account", ct,
                        IsUserOrComputerObject,
                        "Refusing enable_account: target is not a user or computer object.")
                    .ConfigureAwait(false),
                "disable_account" => await ModifyUacFlagAsync(
                        client, request, action, targetDn, UserAccountControl.AccountDisabled, clear: false,
                        alreadyOk: UserAccountControl.IsDisabled,
                        verifyOk: UserAccountControl.IsDisabled,
                        "disable_account", ct,
                        IsUserOrComputerObject,
                        "Refusing disable_account: target is not a user or computer object.")
                    .ConfigureAwait(false),
                "unlock_account" => await UnlockAccountAsync(client, request, action, targetDn, ct)
                    .ConfigureAwait(false),
                "clear_password_never_expires" => await ModifyUacFlagAsync(
                        client, request, action, targetDn, UserAccountControl.DontExpirePasswd, clear: true,
                        alreadyOk: uac => !UserAccountControl.PasswordNeverExpires(uac),
                        verifyOk: uac => !UserAccountControl.PasswordNeverExpires(uac),
                        "clear_password_never_expires", ct)
                    .ConfigureAwait(false),
                "clear_password_not_required" => await ModifyUacFlagAsync(
                        client, request, action, targetDn, UserAccountControl.PasswdNotReqd, clear: true,
                        alreadyOk: uac => !UserAccountControl.PasswordNotRequired(uac),
                        verifyOk: uac => !UserAccountControl.PasswordNotRequired(uac),
                        "clear_password_not_required", ct)
                    .ConfigureAwait(false),
                "clear_reversible_encryption" => await ModifyUacFlagAsync(
                        client, request, action, targetDn, UserAccountControl.EncryptedTextPasswordAllowed,
                        clear: true,
                        alreadyOk: uac => !UserAccountControl.ReversibleEncryptionEnabled(uac),
                        verifyOk: uac => !UserAccountControl.ReversibleEncryptionEnabled(uac),
                        "clear_reversible_encryption", ct)
                    .ConfigureAwait(false),
                "require_smartcard" => await ModifyUacFlagAsync(
                        client, request, action, targetDn, UserAccountControl.SmartcardRequired, clear: false,
                        alreadyOk: uac => !UserAccountControl.SmartcardNotRequired(uac),
                        verifyOk: uac => !UserAccountControl.SmartcardNotRequired(uac),
                        "require_smartcard", ct)
                    .ConfigureAwait(false),
                "remove_service_principal_names" => await RemoveSpnsAsync(client, request, action, targetDn, ct)
                    .ConfigureAwait(false),
                "delete_user_account" => await DeleteUserAccountAsync(client, request, action, targetDn, ct)
                    .ConfigureAwait(false),
                "delete_group" => await DeleteGroupAsync(client, request, action, targetDn, ct)
                    .ConfigureAwait(false),
                "delete_computer" => await DeleteComputerAsync(client, request, action, targetDn, ct)
                    .ConfigureAwait(false),
                "remove_group_member" => await RemoveGroupMemberAsync(client, request, action, targetDn, ct)
                    .ConfigureAwait(false),
                "set_managed_by" => await SetManagedByAsync(client, request, action, targetDn, ct)
                    .ConfigureAwait(false),
                "move_object" => await MoveObjectAsync(client, request, action, targetDn, ct)
                    .ConfigureAwait(false),
                "clear_dont_require_preauth" => await ModifyUacFlagAsync(
                        client, request, action, targetDn, UserAccountControl.DontRequirePreauth, clear: true,
                        alreadyOk: uac => !UserAccountControl.IsDontRequirePreauth(uac),
                        verifyOk: uac => !UserAccountControl.IsDontRequirePreauth(uac),
                        "clear_dont_require_preauth", ct)
                    .ConfigureAwait(false),
                "clear_trusted_for_delegation" => await ModifyUacFlagAsync(
                        client, request, action, targetDn, UserAccountControl.TrustedForDelegation, clear: true,
                        alreadyOk: uac => !UserAccountControl.IsTrustedForDelegation(uac),
                        verifyOk: uac => !UserAccountControl.IsTrustedForDelegation(uac),
                        "clear_trusted_for_delegation", ct,
                        IsUserOrComputerObject,
                        "Refusing clear_trusted_for_delegation: target is not a user or computer object.")
                    .ConfigureAwait(false),
                "clear_constrained_delegation" => await ClearConstrainedDelegationAsync(
                        client, request, action, targetDn, ct)
                    .ConfigureAwait(false),
                "clear_rbcd" => await ClearRbcdAsync(client, request, action, targetDn, ct)
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

    private async Task<SecurityRemediationResult> ModifyUacFlagAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        int flag,
        bool clear,
        Func<int, bool> alreadyOk,
        Func<int, bool> verifyOk,
        string actionType,
        CancellationToken ct,
        Func<DirectoryObjectResult, bool>? objectPredicate = null,
        string? objectTypeError = null)
    {
        var before = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "sAMAccountName", "userAccountControl", "objectClass"],
                ct)
            .ConfigureAwait(false);
        if (before is null)
            return Fail(request, [$"Object not found: {targetDn}"]);

        var predicate = objectPredicate ?? IsUserObject;
        if (!predicate(before))
        {
            return Fail(request,
            [
                objectTypeError ?? "Refusing account remediation: target is not a user object.",
            ]);
        }

        var uacStr = before.Attributes.TryGetValue("userAccountControl", out var vals) && vals.Count > 0
            ? vals[0]
            : "0";
        var uac = UserAccountControl.Parse(uacStr);

        if (alreadyOk(uac))
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = request.DryRun,
                ActionType = actionType,
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = [$"Already remediated: {actionType} on {targetDn} (UAC={uac})"],
                Verification = new Dictionary<string, object?>
                {
                    ["alreadyRemediated"] = true,
                    ["userAccountControl"] = uac,
                    ["verified"] = true,
                },
            };
        }

        var next = clear ? UserAccountControl.ClearFlag(uac, flag) : UserAccountControl.SetFlag(uac, flag);
        var changesDesc = new[]
        {
            $"{actionType}: userAccountControl {uac} → {next} on {targetDn}",
        };

        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = actionType,
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = changesDesc,
                Verification = new Dictionary<string, object?>
                {
                    ["userAccountControlBefore"] = uac,
                    ["userAccountControlAfter"] = next,
                },
            };
        }

        await client.ModifyAttributesAsync(
                targetDn,
                [
                    new DirectoryAttributeChange
                    {
                        AttributeName = "userAccountControl",
                        Operation = AttributeChangeOperation.Replace,
                        Values = [next.ToString()],
                    },
                ],
                ct)
            .ConfigureAwait(false);

        var verification = new Dictionary<string, object?>();
        if (request.VerifyAfter)
        {
            var after = await client.ReadObjectAsync(targetDn, ["userAccountControl"], ct)
                .ConfigureAwait(false);
            var afterUac = UserAccountControl.Parse(
                after?.Attributes.TryGetValue("userAccountControl", out var a) == true && a.Count > 0
                    ? a[0]
                    : "0");
            verification["userAccountControl"] = afterUac;
            verification["verified"] = verifyOk(afterUac);
            if (!verifyOk(afterUac))
            {
                return new SecurityRemediationResult
                {
                    Success = false,
                    ActionType = actionType,
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Write succeeded but verification against live UAC failed."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, actionType, targetDn, changesDesc, verification);
    }

    private async Task<SecurityRemediationResult> UnlockAccountAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        var before = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "sAMAccountName", "userAccountControl", "lockoutTime", "objectClass"],
                ct)
            .ConfigureAwait(false);
        if (before is null)
            return Fail(request, [$"Object not found: {targetDn}"]);
        if (!IsUserObject(before))
            return Fail(request, ["Refusing unlock_account: target is not a user object."]);

        var lockout = before.Attributes.TryGetValue("lockoutTime", out var lt) && lt.Count > 0 ? lt[0] : "0";
        var uac = UserAccountControl.Parse(
            before.Attributes.TryGetValue("userAccountControl", out var uv) && uv.Count > 0 ? uv[0] : "0");
        var locked = UserAccountControl.IsAccountLockedByLockoutTime(lockout)
                     || UserAccountControl.IsLocked(uac);

        if (!locked)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = request.DryRun,
                ActionType = "unlock_account",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = [$"Already remediated: account is not locked ({targetDn})"],
                Verification = new Dictionary<string, object?>
                {
                    ["alreadyRemediated"] = true,
                    ["verified"] = true,
                },
            };
        }

        var changesDesc = new[] { $"Clear lockoutTime on {targetDn}" };
        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "unlock_account",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = changesDesc,
                Verification = new Dictionary<string, object?> { ["lockoutTimeBefore"] = lockout },
            };
        }

        await client.ModifyAttributesAsync(
                targetDn,
                [
                    new DirectoryAttributeChange
                    {
                        AttributeName = "lockoutTime",
                        Operation = AttributeChangeOperation.Replace,
                        Values = ["0"],
                    },
                ],
                ct)
            .ConfigureAwait(false);

        var verification = new Dictionary<string, object?>();
        if (request.VerifyAfter)
        {
            var after = await client.ReadObjectAsync(targetDn, ["lockoutTime", "userAccountControl"], ct)
                .ConfigureAwait(false);
            var afterLock = after?.Attributes.TryGetValue("lockoutTime", out var al) == true && al.Count > 0
                ? al[0]
                : "0";
            var afterUac = UserAccountControl.Parse(
                after?.Attributes.TryGetValue("userAccountControl", out var au) == true && au.Count > 0
                    ? au[0]
                    : "0");
            var stillLocked = UserAccountControl.IsAccountLockedByLockoutTime(afterLock)
                              || UserAccountControl.IsLocked(afterUac);
            verification["lockoutTime"] = afterLock;
            verification["verified"] = !stillLocked;
            if (stillLocked)
            {
                return new SecurityRemediationResult
                {
                    Success = false,
                    ActionType = "unlock_account",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Write succeeded but account still appears locked."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "unlock_account", targetDn, changesDesc, verification);
    }

    private async Task<SecurityRemediationResult> RemoveSpnsAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        var before = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "sAMAccountName", "servicePrincipalName", "objectClass"],
                ct)
            .ConfigureAwait(false);
        if (before is null)
            return Fail(request, [$"Object not found: {targetDn}"]);
        if (!IsUserOrComputerObject(before))
        {
            return Fail(request,
            [
                "Refusing remove_service_principal_names: target is not a user or computer object.",
            ]);
        }

        var existing = before.Attributes.TryGetValue("servicePrincipalName", out var spns)
            ? spns.ToList()
            : new List<string>();
        if (existing.Count == 0)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = request.DryRun,
                ActionType = "remove_service_principal_names",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = [$"Already remediated: no SPNs on {targetDn}"],
                Verification = new Dictionary<string, object?>
                {
                    ["alreadyRemediated"] = true,
                    ["verified"] = true,
                },
            };
        }

        var requested = (action.SpnValues ?? Array.Empty<string>())
            .Select(s => (s ?? string.Empty).Trim())
            .Where(s => s.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var toRemove = requested.Count == 0
            ? existing
            : existing.Where(e => requested.Contains(e, StringComparer.OrdinalIgnoreCase)).ToList();

        if (toRemove.Count == 0)
            return Fail(request, ["None of the requested SPN values are present on the target."]);

        var changesDesc = new[]
        {
            $"Remove {toRemove.Count} servicePrincipalName value(s) on {targetDn}: {string.Join(", ", toRemove)}",
        };

        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "remove_service_principal_names",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = changesDesc,
                Verification = new Dictionary<string, object?> { ["spnCountBefore"] = existing.Count },
            };
        }

        await client.ModifyAttributesAsync(
                targetDn,
                [
                    new DirectoryAttributeChange
                    {
                        AttributeName = "servicePrincipalName",
                        Operation = AttributeChangeOperation.Delete,
                        Values = toRemove.Cast<object>().ToList(),
                    },
                ],
                ct)
            .ConfigureAwait(false);

        var verification = new Dictionary<string, object?>();
        if (request.VerifyAfter)
        {
            var after = await client.ReadObjectAsync(targetDn, ["servicePrincipalName"], ct)
                .ConfigureAwait(false);
            var remaining = after?.Attributes.TryGetValue("servicePrincipalName", out var rem) == true
                ? rem.ToList()
                : new List<string>();
            var stillHas = toRemove.Any(r => remaining.Contains(r, StringComparer.OrdinalIgnoreCase));
            verification["spnCountRemaining"] = remaining.Count;
            verification["verified"] = !stillHas;
            if (stillHas)
            {
                return new SecurityRemediationResult
                {
                    Success = false,
                    ActionType = "remove_service_principal_names",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Write succeeded but requested SPN(s) are still present."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "remove_service_principal_names", targetDn, changesDesc, verification);
    }

    private async Task<SecurityRemediationResult> DeleteUserAccountAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        var before = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "sAMAccountName", "objectClass", "userAccountControl"],
                ct)
            .ConfigureAwait(false);
        if (before is null)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = request.DryRun,
                ActionType = "delete_user_account",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = [$"Already remediated: object not found ({targetDn})"],
                Verification = new Dictionary<string, object?>
                {
                    ["alreadyRemediated"] = true,
                    ["verified"] = true,
                },
            };
        }

        if (!IsUserObject(before))
            return Fail(request, ["Refusing delete_user_account: target is not a user object."]);

        var sam = before.Attributes.TryGetValue("sAMAccountName", out var s) && s.Count > 0
            ? s[0]
            : string.Empty;
        if (ProtectedSamAccounts.Contains(sam))
        {
            return Fail(request,
            [
                $"Refusing delete_user_account: protected account '{sam}' cannot be deleted via ADShield.",
            ]);
        }

        var changesDesc = new[] { $"Delete user account {sam} ({targetDn})" };
        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "delete_user_account",
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
                    ActionType = "delete_user_account",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Delete reported success but object still exists."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "delete_user_account", targetDn, changesDesc, verification);
    }

    private async Task<SecurityRemediationResult> DeleteGroupAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        var before = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "sAMAccountName", "objectClass", "cn"],
                ct)
            .ConfigureAwait(false);
        if (before is null)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = request.DryRun,
                ActionType = "delete_group",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = [$"Already remediated: object not found ({targetDn})"],
                Verification = new Dictionary<string, object?>
                {
                    ["alreadyRemediated"] = true,
                    ["verified"] = true,
                },
            };
        }

        if (!IsGroupObject(before))
            return Fail(request, ["Refusing delete_group: target is not a group object."]);

        var sam = before.Attributes.TryGetValue("sAMAccountName", out var s) && s.Count > 0
            ? s[0]
            : string.Empty;
        if (ProtectedGroupSamAccounts.Contains(sam))
        {
            return Fail(request,
            [
                $"Refusing delete_group: protected group '{sam}' cannot be deleted via ADShield.",
            ]);
        }

        var changesDesc = new[] { $"Delete group {sam} ({targetDn})" };
        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "delete_group",
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
                    ActionType = "delete_group",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Delete reported success but object still exists."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "delete_group", targetDn, changesDesc, verification);
    }

    private async Task<SecurityRemediationResult> DeleteComputerAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        var before = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "sAMAccountName", "objectClass", "cn"],
                ct)
            .ConfigureAwait(false);
        if (before is null)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = request.DryRun,
                ActionType = "delete_computer",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = [$"Already remediated: object not found ({targetDn})"],
                Verification = new Dictionary<string, object?>
                {
                    ["alreadyRemediated"] = true,
                    ["verified"] = true,
                },
            };
        }

        if (!IsComputerObject(before))
            return Fail(request, ["Refusing delete_computer: target is not a computer object."]);

        var sam = before.Attributes.TryGetValue("sAMAccountName", out var s) && s.Count > 0
            ? s[0]
            : string.Empty;
        var changesDesc = new[] { $"Delete computer {sam} ({targetDn})" };
        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "delete_computer",
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
                    ActionType = "delete_computer",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Delete reported success but object still exists."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "delete_computer", targetDn, changesDesc, verification);
    }

    private async Task<SecurityRemediationResult> RemoveGroupMemberAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        var memberDn = (action.MemberDn ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(memberDn))
            return Fail(request, ["Action.MemberDn is required for remove_group_member."]);

        var before = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "sAMAccountName", "objectClass", "member"],
                ct)
            .ConfigureAwait(false);
        if (before is null)
            return Fail(request, [$"Object not found: {targetDn}"]);
        if (!IsGroupObject(before))
            return Fail(request, ["Refusing remove_group_member: TargetDn is not a group object."]);

        var members = before.Attributes.TryGetValue("member", out var m) ? m.ToList() : new List<string>();
        var present = members.Any(x => string.Equals(x, memberDn, StringComparison.OrdinalIgnoreCase));
        if (!present)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = request.DryRun,
                ActionType = "remove_group_member",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = [$"Already remediated: {memberDn} is not a member of {targetDn}"],
                Verification = new Dictionary<string, object?>
                {
                    ["alreadyRemediated"] = true,
                    ["verified"] = true,
                },
            };
        }

        var changesDesc = new[] { $"Remove member {memberDn} from group {targetDn}" };
        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "remove_group_member",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = changesDesc,
                Verification = new Dictionary<string, object?> { ["memberCountBefore"] = members.Count },
            };
        }

        await client.ModifyAttributesAsync(
                targetDn,
                [
                    new DirectoryAttributeChange
                    {
                        AttributeName = "member",
                        Operation = AttributeChangeOperation.Delete,
                        Values = [memberDn],
                    },
                ],
                ct)
            .ConfigureAwait(false);

        var verification = new Dictionary<string, object?>();
        if (request.VerifyAfter)
        {
            var after = await client.ReadObjectAsync(targetDn, ["member"], ct).ConfigureAwait(false);
            var remaining = after?.Attributes.TryGetValue("member", out var rem) == true
                ? rem.ToList()
                : new List<string>();
            var stillMember = remaining.Any(x => string.Equals(x, memberDn, StringComparison.OrdinalIgnoreCase));
            verification["stillMember"] = stillMember;
            verification["verified"] = !stillMember;
            if (stillMember)
            {
                return new SecurityRemediationResult
                {
                    Success = false,
                    ActionType = "remove_group_member",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Write succeeded but member is still present on the group."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "remove_group_member", targetDn, changesDesc, verification);
    }

    private async Task<SecurityRemediationResult> SetManagedByAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        var managedByDn = (action.ManagedByDn ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(managedByDn))
            return Fail(request, ["Action.ManagedByDn is required for set_managed_by."]);

        var before = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "objectClass", "managedBy"],
                ct)
            .ConfigureAwait(false);
        if (before is null)
            return Fail(request, [$"Object not found: {targetDn}"]);

        var current = before.Attributes.TryGetValue("managedBy", out var mb) && mb.Count > 0
            ? mb[0]
            : string.Empty;
        if (string.Equals(current, managedByDn, StringComparison.OrdinalIgnoreCase))
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = request.DryRun,
                ActionType = "set_managed_by",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = [$"Already remediated: managedBy is already {managedByDn}"],
                Verification = new Dictionary<string, object?>
                {
                    ["alreadyRemediated"] = true,
                    ["managedBy"] = current,
                    ["verified"] = true,
                },
            };
        }

        var changesDesc = new[]
        {
            string.IsNullOrEmpty(current)
                ? $"Set managedBy to {managedByDn} on {targetDn}"
                : $"Replace managedBy {current} → {managedByDn} on {targetDn}",
        };

        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "set_managed_by",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = changesDesc,
                Verification = new Dictionary<string, object?>
                {
                    ["managedByBefore"] = current,
                    ["managedByAfter"] = managedByDn,
                },
            };
        }

        await client.ModifyAttributesAsync(
                targetDn,
                [
                    new DirectoryAttributeChange
                    {
                        AttributeName = "managedBy",
                        Operation = AttributeChangeOperation.Replace,
                        Values = [managedByDn],
                    },
                ],
                ct)
            .ConfigureAwait(false);

        var verification = new Dictionary<string, object?>();
        if (request.VerifyAfter)
        {
            var after = await client.ReadObjectAsync(targetDn, ["managedBy"], ct).ConfigureAwait(false);
            var afterVal = after?.Attributes.TryGetValue("managedBy", out var am) == true && am.Count > 0
                ? am[0]
                : string.Empty;
            verification["managedBy"] = afterVal;
            verification["verified"] = string.Equals(afterVal, managedByDn, StringComparison.OrdinalIgnoreCase);
            if (!string.Equals(afterVal, managedByDn, StringComparison.OrdinalIgnoreCase))
            {
                return new SecurityRemediationResult
                {
                    Success = false,
                    ActionType = "set_managed_by",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Write succeeded but managedBy verification failed."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "set_managed_by", targetDn, changesDesc, verification);
    }

    private async Task<SecurityRemediationResult> MoveObjectAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        var newParentDn = (action.NewParentDn ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(newParentDn))
            return Fail(request, ["Action.NewParentDn is required for move_object."]);

        var before = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "objectClass", "cn"],
                ct)
            .ConfigureAwait(false);
        if (before is null)
            return Fail(request, [$"Object not found: {targetDn}"]);

        var rdn = ExtractRdn(targetDn);
        var expectedDn = $"{rdn},{newParentDn}";
        if (string.Equals(targetDn, expectedDn, StringComparison.OrdinalIgnoreCase))
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = request.DryRun,
                ActionType = "move_object",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = [$"Already remediated: object is already under {newParentDn}"],
                Verification = new Dictionary<string, object?>
                {
                    ["alreadyRemediated"] = true,
                    ["verified"] = true,
                },
            };
        }

        var changesDesc = new[] { $"Move {targetDn} under {newParentDn}" };
        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "move_object",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = changesDesc,
                Verification = new Dictionary<string, object?>
                {
                    ["expectedDnAfter"] = expectedDn,
                },
            };
        }

        await client.RenameObjectAsync(targetDn, newParentDn, newRdn: null, ct).ConfigureAwait(false);

        var verification = new Dictionary<string, object?>();
        if (request.VerifyAfter)
        {
            var after = await client.ReadObjectAsync(expectedDn, ["distinguishedName"], ct)
                .ConfigureAwait(false);
            var oldStillThere = await client.ReadObjectAsync(targetDn, ["cn"], ct).ConfigureAwait(false);
            verification["newDnExists"] = after is not null;
            verification["oldDnExists"] = oldStillThere is not null;
            verification["verified"] = after is not null && oldStillThere is null;
            if (after is null || oldStillThere is not null)
            {
                return new SecurityRemediationResult
                {
                    Success = false,
                    ActionType = "move_object",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Move reported success but verification against new/old DN failed."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "move_object", targetDn, changesDesc, verification);
    }

    private async Task<SecurityRemediationResult> ClearConstrainedDelegationAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        const string allowedToDelegateAttr = "msDS-AllowedToDelegateTo";
        var before = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "sAMAccountName", "userAccountControl", "objectClass", allowedToDelegateAttr],
                ct)
            .ConfigureAwait(false);
        if (before is null)
            return Fail(request, [$"Object not found: {targetDn}"]);
        if (!IsUserOrComputerObject(before))
        {
            return Fail(request,
            [
                "Refusing clear_constrained_delegation: target is not a user or computer object.",
            ]);
        }

        var uac = UserAccountControl.Parse(
            before.Attributes.TryGetValue("userAccountControl", out var uv) && uv.Count > 0 ? uv[0] : "0");
        var delegateTo = before.Attributes.TryGetValue(allowedToDelegateAttr, out var dt)
            ? dt.ToList()
            : new List<string>();
        var bitSet = UserAccountControl.IsTrustedToAuthForDelegation(uac);
        if (!bitSet && delegateTo.Count == 0)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = request.DryRun,
                ActionType = "clear_constrained_delegation",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = [$"Already remediated: constrained delegation not present on {targetDn}"],
                Verification = new Dictionary<string, object?>
                {
                    ["alreadyRemediated"] = true,
                    ["userAccountControl"] = uac,
                    ["verified"] = true,
                },
            };
        }

        var nextUac = UserAccountControl.ClearFlag(uac, UserAccountControl.TrustedToAuthForDelegation);
        var changesDesc = new List<string>();
        if (bitSet)
            changesDesc.Add($"clear_constrained_delegation: userAccountControl {uac} → {nextUac} on {targetDn}");
        if (delegateTo.Count > 0)
            changesDesc.Add($"Clear {allowedToDelegateAttr} ({delegateTo.Count} value(s)) on {targetDn}");

        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "clear_constrained_delegation",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = changesDesc,
                Verification = new Dictionary<string, object?>
                {
                    ["userAccountControlBefore"] = uac,
                    ["userAccountControlAfter"] = nextUac,
                    ["allowedToDelegateToCount"] = delegateTo.Count,
                },
            };
        }

        var mods = new List<DirectoryAttributeChange>();
        if (bitSet)
        {
            mods.Add(new DirectoryAttributeChange
            {
                AttributeName = "userAccountControl",
                Operation = AttributeChangeOperation.Replace,
                Values = [nextUac.ToString()],
            });
        }

        if (delegateTo.Count > 0)
        {
            mods.Add(new DirectoryAttributeChange
            {
                AttributeName = allowedToDelegateAttr,
                Operation = AttributeChangeOperation.Delete,
                Values = Array.Empty<object>(),
            });
        }

        await client.ModifyAttributesAsync(targetDn, mods, ct).ConfigureAwait(false);

        var verification = new Dictionary<string, object?>();
        if (request.VerifyAfter)
        {
            var after = await client.ReadObjectAsync(
                    targetDn,
                    ["userAccountControl", allowedToDelegateAttr],
                    ct)
                .ConfigureAwait(false);
            var afterUac = UserAccountControl.Parse(
                after?.Attributes.TryGetValue("userAccountControl", out var au) == true && au.Count > 0
                    ? au[0]
                    : "0");
            var remaining = after?.Attributes.TryGetValue(allowedToDelegateAttr, out var rem) == true
                ? rem.Count
                : 0;
            var ok = !UserAccountControl.IsTrustedToAuthForDelegation(afterUac) && remaining == 0;
            verification["userAccountControl"] = afterUac;
            verification["allowedToDelegateToRemaining"] = remaining;
            verification["verified"] = ok;
            if (!ok)
            {
                return new SecurityRemediationResult
                {
                    Success = false,
                    ActionType = "clear_constrained_delegation",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Write succeeded but constrained delegation verification failed."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "clear_constrained_delegation", targetDn, changesDesc, verification);
    }

    private async Task<SecurityRemediationResult> ClearRbcdAsync(
        IActiveDirectoryClient client,
        SecurityRemediationRequest request,
        SecurityRemediationAction action,
        string targetDn,
        CancellationToken ct)
    {
        const string rbcdAttr = "msDS-AllowedToActOnBehalfOfOtherIdentity";
        var before = await client.ReadObjectAsync(
                targetDn,
                ["distinguishedName", "sAMAccountName", "objectClass", rbcdAttr],
                ct)
            .ConfigureAwait(false);
        if (before is null)
            return Fail(request, [$"Object not found: {targetDn}"]);
        if (!IsComputerObject(before))
            return Fail(request, ["Refusing clear_rbcd: target is not a computer object."]);

        // Binary SD may surface as a formatted string; treat any attribute key presence as set.
        var attrPresent = before.Attributes.Keys.Any(k =>
            string.Equals(k, rbcdAttr, StringComparison.OrdinalIgnoreCase));
        if (!attrPresent)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = request.DryRun,
                ActionType = "clear_rbcd",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = [$"Already remediated: {rbcdAttr} not present on {targetDn}"],
                Verification = new Dictionary<string, object?>
                {
                    ["alreadyRemediated"] = true,
                    ["verified"] = true,
                },
            };
        }

        var changesDesc = new[] { $"Clear {rbcdAttr} on {targetDn}" };
        if (request.DryRun)
        {
            return new SecurityRemediationResult
            {
                Success = true,
                DryRun = true,
                ActionType = "clear_rbcd",
                TargetDn = targetDn,
                Feature = action.Feature,
                CorrelationId = request.CorrelationId,
                Changes = changesDesc,
            };
        }

        await client.ModifyAttributesAsync(
                targetDn,
                [
                    new DirectoryAttributeChange
                    {
                        AttributeName = rbcdAttr,
                        Operation = AttributeChangeOperation.Delete,
                        Values = Array.Empty<object>(),
                    },
                ],
                ct)
            .ConfigureAwait(false);

        var verification = new Dictionary<string, object?>();
        if (request.VerifyAfter)
        {
            var after = await client.ReadObjectAsync(targetDn, [rbcdAttr], ct).ConfigureAwait(false);
            var stillPresent = after?.Attributes.Keys.Any(k =>
                string.Equals(k, rbcdAttr, StringComparison.OrdinalIgnoreCase)) == true;
            verification["attributePresent"] = stillPresent;
            verification["verified"] = !stillPresent;
            if (stillPresent)
            {
                return new SecurityRemediationResult
                {
                    Success = false,
                    ActionType = "clear_rbcd",
                    TargetDn = targetDn,
                    Feature = action.Feature,
                    CorrelationId = request.CorrelationId,
                    Changes = changesDesc,
                    Errors = ["Write succeeded but RBCD attribute is still present."],
                    Verification = verification,
                };
            }
        }

        return Ok(request, action, "clear_rbcd", targetDn, changesDesc, verification);
    }

    private static string ExtractRdn(string distinguishedName)
    {
        var comma = distinguishedName.IndexOf(',');
        return comma < 0
            ? distinguishedName.Trim()
            : distinguishedName[..comma].Trim();
    }

    private static string ObjectClasses(DirectoryObjectResult obj)
    {
        if (obj.Attributes.TryGetValue("objectClass", out var vals) && vals.Count > 0)
            return string.Join(" ", vals);
        return obj.ObjectClass ?? string.Empty;
    }

    private static bool IsUserObject(DirectoryObjectResult obj)
    {
        var oc = ObjectClasses(obj);
        return oc.Contains("user", StringComparison.OrdinalIgnoreCase)
               && !oc.Contains("computer", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsComputerObject(DirectoryObjectResult obj)
    {
        var oc = ObjectClasses(obj);
        return oc.Contains("computer", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsGroupObject(DirectoryObjectResult obj)
    {
        var oc = ObjectClasses(obj);
        return oc.Contains("group", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsUserOrComputerObject(DirectoryObjectResult obj) =>
        IsUserObject(obj) || IsComputerObject(obj);

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
