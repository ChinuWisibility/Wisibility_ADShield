using System.ComponentModel.DataAnnotations;

namespace ADShield.Configuration;

/// <summary>
/// Runtime Active Directory / LDAP connection settings.
/// No domain, host, credentials, or ports are baked into the service.
/// Compatible with IdentitySphere Application.connectionConfig.ad shape (url / bindDn / baseDn).
/// </summary>
public sealed class ActiveDirectoryConnectionOptions
{
    /// <summary>
    /// Optional full LDAP URL, e.g. "ldap://dc.example.local:389" or "ldaps://dc:636".
    /// When set, Host/Port/UseSsl are derived unless Host is also explicitly provided.
    /// </summary>
    public string? Url { get; set; }

    /// <summary>
    /// LDAP host or IP (without scheme), e.g. "dc01.contoso.local".
    /// </summary>
    public string Host { get; set; } = string.Empty;

    /// <summary>
    /// TCP port. Typical values: 389 (LDAP), 636 (LDAPS).
    /// </summary>
    [Range(1, 65535)]
    public int Port { get; set; } = 389;

    /// <summary>
    /// When true, negotiate LDAPS (SSL) on connect.
    /// </summary>
    public bool UseSsl { get; set; }

    /// <summary>
    /// When true and <see cref="UseSsl"/> is false, issue StartTLS after connect.
    /// </summary>
    public bool UseStartTls { get; set; }

    /// <summary>
    /// Bind identity (UPN, DOMAIN\user, or DN). Required for explicit bind.
    /// </summary>
    [Required]
    [MinLength(1)]
    public string BindDn { get; set; } = string.Empty;

    /// <summary>
    /// Bind password / secret. Never logged.
    /// </summary>
    [Required]
    [MinLength(1)]
    public string BindPassword { get; set; } = string.Empty;

    /// <summary>
    /// Directory base DN used as default search root, e.g. "DC=contoso,DC=local".
    /// </summary>
    [Required]
    [MinLength(1)]
    public string BaseDn { get; set; } = string.Empty;

    /// <summary>
    /// Optional narrower search base for scoped operations.
    /// When empty, <see cref="BaseDn"/> is used.
    /// </summary>
    public string? SearchBaseDn { get; set; }

    /// <summary>
    /// Per-operation timeout in milliseconds.
    /// </summary>
    [Range(1000, 600_000)]
    public int TimeoutMs { get; set; } = 30_000;

    /// <summary>
    /// When true, accept the LDAP server certificate without chain validation.
    /// Maps from IdentitySphere tlsInsecure.
    /// </summary>
    public bool AcceptInvalidCertificate { get; set; }

    /// <summary>
    /// Alias for <see cref="AcceptInvalidCertificate"/> (IdentitySphere naming).
    /// </summary>
    public bool TlsInsecure
    {
        get => AcceptInvalidCertificate;
        set => AcceptInvalidCertificate = value;
    }

    /// <summary>
    /// Auth type for bind. Default Basic supports non-domain-joined hosts.
    /// </summary>
    public AdAuthType AuthType { get; set; } = AdAuthType.Basic;

    /// <summary>
    /// Effective search base: SearchBaseDn if set, otherwise BaseDn.
    /// </summary>
    public string EffectiveSearchBaseDn =>
        string.IsNullOrWhiteSpace(SearchBaseDn) ? BaseDn : SearchBaseDn.Trim();

    /// <summary>
    /// Safe endpoint string for diagnostics (never includes credentials).
    /// </summary>
    public string EndpointDisplay
    {
        get
        {
            EnsureNormalized();
            return $"{(UseSsl ? "ldaps" : "ldap")}://{Host}:{Port}";
        }
    }

    private bool _normalized;

    /// <summary>
    /// Applies Url → Host/Port/UseSsl when Url is provided.
    /// </summary>
    public void EnsureNormalized()
    {
        if (_normalized)
            return;
        _normalized = true;

        if (string.IsNullOrWhiteSpace(Url))
            return;

        if (!Uri.TryCreate(Url.Trim(), UriKind.Absolute, out var uri))
            return;

        var scheme = uri.Scheme.ToLowerInvariant();
        if (scheme is not ("ldap" or "ldaps"))
            return;

        if (string.IsNullOrWhiteSpace(Host))
            Host = uri.Host;

        var ldaps = scheme == "ldaps";
        if (ldaps)
            UseSsl = true;

        if (uri.Port > 0 && !uri.IsDefaultPort)
            Port = uri.Port;
        else if (ldaps && Port == 389)
            Port = 636;
    }
}

public enum AdAuthType
{
    Basic = 0,
    Negotiate = 1,
}
