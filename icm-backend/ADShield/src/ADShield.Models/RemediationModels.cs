using ADShield.Configuration;

namespace ADShield.Models;

/// <summary>
/// Explicit, request-scoped remediation. No guessed targets — caller must supply object DN + action.
/// Credentials are never persisted.
/// </summary>
public sealed class SecurityRemediationRequest
{
    public string? CorrelationId { get; set; }
    public ActiveDirectoryConnectionOptions Connection { get; set; } = new();
    public SecurityRemediationAction Action { get; set; } = new();

    /// <summary>When true, validate and describe the change but do not write.</summary>
    public bool DryRun { get; set; }

    /// <summary>Re-read the object after a successful write (default true).</summary>
    public bool VerifyAfter { get; set; } = true;
}

public sealed class SecurityRemediationAction
{
    /// <summary>
    /// Action id. Supported (ACL phase):
    /// remove_dacl_ace | clear_sid_history | delete_foreign_security_principal
    /// </summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>Feature that produced the finding (for audit / routing).</summary>
    public string? Feature { get; set; }

    /// <summary>Exact target DN — required. Must be under the client's chosen directory.</summary>
    public string TargetDn { get; set; } = string.Empty;

    /// <summary>Trustee SID to remove from DACL (required for remove_dacl_ace).</summary>
    public string? TrusteeSid { get; set; }

    /// <summary>Optional access mask filter (uint or 0x hex). When set, only matching ACEs are removed.</summary>
    public string? AccessMask { get; set; }

    /// <summary>Optional ACE type filter (0=allow, 1=deny, …).</summary>
    public int? AceType { get; set; }
}

public sealed class SecurityRemediationResult
{
    public bool Success { get; set; }
    public bool DryRun { get; set; }
    public string ActionType { get; set; } = string.Empty;
    public string TargetDn { get; set; } = string.Empty;
    public string? Feature { get; set; }
    public string? CorrelationId { get; set; }
    public IReadOnlyList<string> Changes { get; set; } = Array.Empty<string>();
    public IReadOnlyList<string> Errors { get; set; } = Array.Empty<string>();
    public Dictionary<string, object?> Verification { get; set; } = new();
}

/// <summary>Generic directory object from a scoped LDAP search (client-supplied base/filter).</summary>
public sealed class DirectorySearchHit
{
    public string DistinguishedName { get; init; } = string.Empty;
    public string ObjectType { get; init; } = "object";
    public string ObjectName { get; init; } = string.Empty;
    public string ObjectSid { get; init; } = string.Empty;
    public IReadOnlyDictionary<string, IReadOnlyList<string>> Attributes { get; init; }
        = new Dictionary<string, IReadOnlyList<string>>(StringComparer.OrdinalIgnoreCase);
    public IReadOnlyDictionary<string, byte[][]> BinaryAttributes { get; init; }
        = new Dictionary<string, byte[][]>(StringComparer.OrdinalIgnoreCase);
}

public enum AttributeChangeOperation
{
    Add = 0,
    Delete = 1,
    Replace = 2,
}

public sealed class DirectoryAttributeChange
{
    public string AttributeName { get; init; } = string.Empty;
    public AttributeChangeOperation Operation { get; init; }
    public IReadOnlyList<object> Values { get; init; } = Array.Empty<object>();
}
