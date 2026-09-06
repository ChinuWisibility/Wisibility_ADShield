using System.DirectoryServices.Protocols;
using System.Net;
using System.Security.Cryptography.X509Certificates;
using ADShield.Configuration;
using ADShield.Models;
using Microsoft.Extensions.Logging;

namespace ADShield.ActiveDirectory;

/// <summary>
/// LDAP client based on System.DirectoryServices.Protocols.
/// Works from non-domain-joined hosts using explicit bind credentials.
/// Does not use WinRM, PowerShell, RSAT, or ADSI.
/// </summary>
public sealed class LdapActiveDirectoryClient : IActiveDirectoryClient
{
    private static readonly string[] DefaultObjectAttributes =
    [
        "distinguishedName",
        "objectClass",
        "objectGUID",
        "objectSid",
        "sAMAccountName",
        "cn",
        "name",
    ];

    private readonly ActiveDirectoryConnectionOptions _options;
    private readonly ILogger _logger;
    private LdapConnection? _connection;
    private bool _bound;
    private bool _disposed;

    public LdapActiveDirectoryClient(
        ActiveDirectoryConnectionOptions options,
        ILogger<LdapActiveDirectoryClient> logger)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task TestConnectionAsync(CancellationToken cancellationToken = default)
    {
        EnsureNotDisposed();
        await EnsureBoundAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<DirectoryObjectResult?> ReadObjectAsync(
        string distinguishedName,
        IReadOnlyList<string>? attributes = null,
        CancellationToken cancellationToken = default)
    {
        EnsureNotDisposed();
        if (string.IsNullOrWhiteSpace(distinguishedName))
            throw new ArgumentException("Distinguished name is required.", nameof(distinguishedName));

        await EnsureBoundAsync(cancellationToken).ConfigureAwait(false);

        var attrs = attributes is { Count: > 0 }
            ? attributes.ToArray()
            : DefaultObjectAttributes;

        var request = new SearchRequest(
            distinguishedName.Trim(),
            "(objectClass=*)",
            SearchScope.Base,
            attrs);

        var response = await SendRequestAsync(request, cancellationToken).ConfigureAwait(false);
        if (response.Entries.Count == 0)
            return null;

        return MapEntry(response.Entries[0]);
    }

    public Task<IReadOnlyList<DirectoryObjectResult>> ReadUsersAsync(
        string? ldapFilter = null,
        int? maxResults = null,
        CancellationToken cancellationToken = default)
    {
        EnsureNotDisposed();
        throw new NotImplementedException(
            "ReadUsersAsync is reserved for a later ADShield slice and is not implemented yet.");
    }

    public Task<IReadOnlyList<DirectoryObjectResult>> ReadGroupsAsync(
        string? ldapFilter = null,
        int? maxResults = null,
        CancellationToken cancellationToken = default)
    {
        EnsureNotDisposed();
        throw new NotImplementedException(
            "ReadGroupsAsync is reserved for a later ADShield slice and is not implemented yet.");
    }

    public async Task<SecurityDescriptorResult> ReadSecurityDescriptorAsync(
        string distinguishedName,
        CancellationToken cancellationToken = default)
    {
        EnsureNotDisposed();
        if (string.IsNullOrWhiteSpace(distinguishedName))
            throw new ArgumentException("Distinguished name is required.", nameof(distinguishedName));

        await EnsureBoundAsync(cancellationToken).ConfigureAwait(false);

        var request = new SearchRequest(
            distinguishedName.Trim(),
            "(objectClass=*)",
            SearchScope.Base,
            "nTSecurityDescriptor",
            "distinguishedName");

        // LDAP_SERVER_SD_FLAGS_OID — request OWNER|GROUP|DACL (0x07).
        // BER: SEQUENCE { INTEGER flags }
        request.Controls.Add(new DirectoryControl(
            "1.2.840.113556.1.4.801",
            [0x30, 0x03, 0x02, 0x01, 0x07],
            isCritical: true,
            serverSide: true));

        var response = await SendRequestAsync(request, cancellationToken).ConfigureAwait(false);
        if (response.Entries.Count == 0)
        {
            return new SecurityDescriptorResult
            {
                DistinguishedName = distinguishedName.Trim(),
                Found = false,
                ByteLength = 0,
            };
        }

        var entry = response.Entries[0];
        var dn = entry.DistinguishedName ?? distinguishedName.Trim();
        byte[]? bytes = null;

        if (entry.Attributes.Contains("nTSecurityDescriptor"))
        {
            var attr = entry.Attributes["nTSecurityDescriptor"];
            if (attr.Count > 0)
            {
                bytes = attr[0] as byte[] ?? (attr[0] is string s ? Convert.FromBase64String(s) : null);
            }
        }

        if (bytes is not { Length: > 0 })
        {
            return new SecurityDescriptorResult
            {
                DistinguishedName = dn,
                Found = false,
                ByteLength = 0,
            };
        }

        var parsed = SecurityDescriptorParser.Parse(bytes, out var decodeError);
        return new SecurityDescriptorResult
        {
            DistinguishedName = dn,
            Found = true,
            ByteLength = bytes.Length,
            SecurityDescriptorBase64 = Convert.ToBase64String(bytes),
            DecodeSucceeded = parsed is not null,
            Parsed = parsed,
            DecodeError = decodeError,
        };
    }

    public ValueTask DisposeAsync()
    {
        if (_disposed)
            return ValueTask.CompletedTask;

        _disposed = true;
        try
        {
            _connection?.Dispose();
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Error disposing LDAP connection to {Endpoint}", _options.EndpointDisplay);
        }

        _connection = null;
        _bound = false;
        return ValueTask.CompletedTask;
    }

    private async Task EnsureBoundAsync(CancellationToken cancellationToken)
    {
        if (_bound && _connection is not null)
            return;

        var validation = ActiveDirectoryConnectionOptionsValidator.Validate(_options);
        if (validation.Count > 0)
            throw new InvalidOperationException(string.Join(" ", validation));

        _options.EnsureNormalized();

        _logger.LogInformation(
            "Connecting to AD endpoint {Endpoint} as {BindDn} (ssl={UseSsl}, startTls={UseStartTls})",
            _options.EndpointDisplay,
            _options.BindDn,
            _options.UseSsl,
            _options.UseStartTls);

        var identifier = new LdapDirectoryIdentifier(_options.Host.Trim(), _options.Port, fullyQualifiedDnsHostName: false, connectionless: false);
        var connection = new LdapConnection(identifier)
        {
            Timeout = TimeSpan.FromMilliseconds(_options.TimeoutMs),
            AuthType = _options.AuthType == AdAuthType.Negotiate ? AuthType.Negotiate : AuthType.Basic,
            SessionOptions =
            {
                ProtocolVersion = 3,
                ReferralChasing = ReferralChasingOptions.None,
            },
        };

        if (_options.UseSsl)
        {
            connection.SessionOptions.SecureSocketLayer = true;
        }

        if (_options.AcceptInvalidCertificate)
        {
            connection.SessionOptions.VerifyServerCertificate += AcceptAnyCertificate;
        }

        try
        {
            await Task.Run(() =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (_options.UseStartTls && !_options.UseSsl)
                {
                    connection.SessionOptions.StartTransportLayerSecurity(null);
                }

                cancellationToken.ThrowIfCancellationRequested();
                var credential = BuildCredential(_options.BindDn.Trim(), _options.BindPassword);
                connection.Bind(credential);
            }, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            connection.Dispose();
            throw;
        }

        _connection = connection;
        _bound = true;
        _logger.LogInformation("Bind succeeded against {Endpoint}", _options.EndpointDisplay);
    }

    private async Task<SearchResponse> SendRequestAsync(DirectoryRequest request, CancellationToken cancellationToken)
    {
        if (_connection is null)
            throw new InvalidOperationException("LDAP connection is not established.");

        cancellationToken.ThrowIfCancellationRequested();

        var response = await Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                return (SearchResponse)_connection.SendRequest(request);
            },
            cancellationToken).ConfigureAwait(false);

        return response;
    }

    private static DirectoryObjectResult MapEntry(SearchResultEntry entry)
    {
        var attributes = new Dictionary<string, IReadOnlyList<string>>(StringComparer.OrdinalIgnoreCase);
        string? objectClass = null;
        string? objectGuid = null;
        string? objectSid = null;

        foreach (string name in entry.Attributes.AttributeNames)
        {
            var attr = entry.Attributes[name];
            var values = new List<string>(attr.Count);
            for (var i = 0; i < attr.Count; i++)
            {
                values.Add(FormatAttributeValue(attr[i]));
            }

            attributes[name] = values;

            if (name.Equals("objectClass", StringComparison.OrdinalIgnoreCase) && values.Count > 0)
                objectClass = values[^1];
            else if (name.Equals("objectGUID", StringComparison.OrdinalIgnoreCase) && attr.Count > 0 && attr[0] is byte[] guidBytes && guidBytes.Length == 16)
                objectGuid = new Guid(guidBytes).ToString();
            else if (name.Equals("objectSid", StringComparison.OrdinalIgnoreCase) && attr.Count > 0 && attr[0] is byte[] sidBytes)
                objectSid = Convert.ToBase64String(sidBytes);
        }

        return new DirectoryObjectResult
        {
            DistinguishedName = entry.DistinguishedName ?? string.Empty,
            ObjectClass = objectClass,
            ObjectGuid = objectGuid,
            ObjectSid = objectSid,
            Attributes = attributes,
        };
    }

    private static string FormatAttributeValue(object? value) => value switch
    {
        null => string.Empty,
        byte[] bytes => Convert.ToBase64String(bytes),
        string s => s,
        _ => Convert.ToString(value) ?? string.Empty,
    };

    private static NetworkCredential BuildCredential(string bindDn, string password)
    {
        // DOMAIN\user form — set Domain so Basic bind works from non-joined hosts.
        var slash = bindDn.IndexOf('\\');
        if (slash > 0 && slash < bindDn.Length - 1)
        {
            return new NetworkCredential(
                bindDn[(slash + 1)..],
                password,
                bindDn[..slash]);
        }

        return new NetworkCredential(bindDn, password);
    }

    private static bool AcceptAnyCertificate(LdapConnection _, X509Certificate? __) => true;

    private void EnsureNotDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }
}

public sealed class LdapActiveDirectoryClientFactory : IActiveDirectoryClientFactory
{
    private readonly ILoggerFactory _loggerFactory;

    public LdapActiveDirectoryClientFactory(ILoggerFactory loggerFactory)
    {
        _loggerFactory = loggerFactory;
    }

    public IActiveDirectoryClient Create(ActiveDirectoryConnectionOptions options)
    {
        var validation = ActiveDirectoryConnectionOptionsValidator.Validate(options);
        if (validation.Count > 0)
            throw new ArgumentException(string.Join(" ", validation), nameof(options));

        return new LdapActiveDirectoryClient(
            options,
            _loggerFactory.CreateLogger<LdapActiveDirectoryClient>());
    }
}
