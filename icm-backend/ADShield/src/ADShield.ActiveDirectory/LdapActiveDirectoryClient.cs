using System.DirectoryServices.Protocols;
using System.Net;
using System.Security.Cryptography.X509Certificates;
using System.Text;
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

    public async Task<IReadOnlyList<SecurableDirectoryObject>> SearchSecurableObjectsAsync(
        string searchBaseDn,
        string ldapFilter,
        SearchScopeKind scope,
        int maxResults,
        CancellationToken cancellationToken = default)
    {
        EnsureNotDisposed();
        if (string.IsNullOrWhiteSpace(searchBaseDn))
            throw new ArgumentException("Search base DN is required.", nameof(searchBaseDn));

        await EnsureBoundAsync(cancellationToken).ConfigureAwait(false);

        var filter = string.IsNullOrWhiteSpace(ldapFilter)
            ? "(|(&(objectCategory=person)(objectClass=user))(objectClass=group))"
            : ldapFilter.Trim();
        var limit = Math.Clamp(maxResults, 1, 50_000);
        var ldapScope = scope switch
        {
            SearchScopeKind.Base => SearchScope.Base,
            SearchScopeKind.OneLevel => SearchScope.OneLevel,
            _ => SearchScope.Subtree,
        };

        var request = new SearchRequest(
            searchBaseDn.Trim(),
            filter,
            ldapScope,
            "distinguishedName",
            "objectClass",
            "objectSid",
            "sAMAccountName",
            "cn",
            "name",
            "nTSecurityDescriptor");

        // LDAP_SERVER_SD_FLAGS_OID — OWNER|GROUP|DACL
        request.Controls.Add(new DirectoryControl(
            "1.2.840.113556.1.4.801",
            [0x30, 0x03, 0x02, 0x01, 0x07],
            isCritical: true,
            serverSide: true));

        var pageSize = Math.Min(1000, limit);
        var pageControl = new PageResultRequestControl(pageSize);
        request.Controls.Add(pageControl);

        var results = new List<SecurableDirectoryObject>();
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var response = await SendRequestAsync(request, cancellationToken).ConfigureAwait(false);

            foreach (SearchResultEntry entry in response.Entries)
            {
                results.Add(MapSecurableEntry(entry));
                if (results.Count >= limit)
                    return results;
            }

            var responsePage = response.Controls
                .OfType<PageResultResponseControl>()
                .FirstOrDefault();
            if (responsePage is null || responsePage.Cookie.Length == 0)
                break;

            pageControl.Cookie = responsePage.Cookie;
        }

        return results;
    }

    public async Task<string?> ResolveSidAsync(
        string sidString,
        string searchBaseDn,
        CancellationToken cancellationToken = default)
    {
        var result = await LookupPrincipalBySidAsync(sidString, searchBaseDn, cancellationToken)
            .ConfigureAwait(false);
        return result?.DistinguishedName;
    }

    public async Task<SidLookupResult?> LookupPrincipalBySidAsync(
        string sidString,
        string searchBaseDn,
        CancellationToken cancellationToken = default)
    {
        EnsureNotDisposed();
        var sid = NormalizeSid(sidString);
        if (string.IsNullOrEmpty(sid) || string.IsNullOrWhiteSpace(searchBaseDn))
            return null;

        await EnsureBoundAsync(cancellationToken).ConfigureAwait(false);

        byte[]? sidBytes;
        try
        {
            sidBytes = SidStringToBytes(sid);
        }
        catch
        {
            return null;
        }

        if (sidBytes is null || sidBytes.Length == 0)
            return null;

        var filterBytes = new StringBuilder();
        filterBytes.Append("(objectSid=");
        foreach (var b in sidBytes)
            filterBytes.Append('\\').Append(b.ToString("X2"));
        filterBytes.Append(')');

        var request = new SearchRequest(
            searchBaseDn.Trim(),
            filterBytes.ToString(),
            SearchScope.Subtree,
            "distinguishedName",
            "objectClass",
            "sAMAccountName",
            "cn",
            "name",
            "objectSid");
        request.SizeLimit = 1;

        try
        {
            var response = await SendRequestAsync(request, cancellationToken).ConfigureAwait(false);
            if (response.Entries.Count == 0)
                return null;

            var entry = response.Entries[0];
            var dn = entry.DistinguishedName ?? string.Empty;
            var objectClass = GetLastStringAttr(entry, "objectClass");
            var name =
                GetFirstStringAttr(entry, "sAMAccountName")
                ?? GetFirstStringAttr(entry, "cn")
                ?? GetFirstStringAttr(entry, "name");
            var foreign = (objectClass ?? string.Empty).Contains("foreignsecurityprincipal", StringComparison.OrdinalIgnoreCase)
                          || dn.Contains("ForeignSecurityPrincipals", StringComparison.OrdinalIgnoreCase);

            return new SidLookupResult
            {
                Sid = sid,
                DistinguishedName = dn,
                ObjectName = name,
                ObjectClass = objectClass,
                IsForeignSecurityPrincipal = foreign,
            };
        }
        catch (DirectoryOperationException)
        {
            return null;
        }
    }

    public async Task<IReadOnlyList<DirectorySearchHit>> SearchAsync(
        string searchBaseDn,
        string ldapFilter,
        SearchScopeKind scope,
        IReadOnlyList<string> attributes,
        int maxResults,
        CancellationToken cancellationToken = default)
    {
        EnsureNotDisposed();
        if (string.IsNullOrWhiteSpace(searchBaseDn))
            throw new ArgumentException("Search base DN is required.", nameof(searchBaseDn));
        if (string.IsNullOrWhiteSpace(ldapFilter))
            throw new ArgumentException("LDAP filter is required.", nameof(ldapFilter));
        if (attributes is null || attributes.Count == 0)
            throw new ArgumentException("At least one attribute is required.", nameof(attributes));

        await EnsureBoundAsync(cancellationToken).ConfigureAwait(false);

        var limit = Math.Clamp(maxResults, 1, 50_000);
        var ldapScope = scope switch
        {
            SearchScopeKind.Base => SearchScope.Base,
            SearchScopeKind.OneLevel => SearchScope.OneLevel,
            _ => SearchScope.Subtree,
        };

        var attrArray = attributes.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var request = new SearchRequest(
            searchBaseDn.Trim(),
            ldapFilter.Trim(),
            ldapScope,
            attrArray);

        var pageSize = Math.Min(1000, limit);
        var pageControl = new PageResultRequestControl(pageSize);
        request.Controls.Add(pageControl);

        var results = new List<DirectorySearchHit>();
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var response = await SendSearchAsync(request, cancellationToken).ConfigureAwait(false);

            foreach (SearchResultEntry entry in response.Entries)
            {
                results.Add(MapSearchHit(entry));
                if (results.Count >= limit)
                    return results;
            }

            var responsePage = response.Controls
                .OfType<PageResultResponseControl>()
                .FirstOrDefault();
            if (responsePage is null || responsePage.Cookie.Length == 0)
                break;

            pageControl.Cookie = responsePage.Cookie;
        }

        return results;
    }

    public async Task ModifyAttributesAsync(
        string distinguishedName,
        IReadOnlyList<DirectoryAttributeChange> changes,
        CancellationToken cancellationToken = default)
    {
        EnsureNotDisposed();
        if (string.IsNullOrWhiteSpace(distinguishedName))
            throw new ArgumentException("Distinguished name is required.", nameof(distinguishedName));
        if (changes is null || changes.Count == 0)
            throw new ArgumentException("At least one attribute change is required.", nameof(changes));

        await EnsureBoundAsync(cancellationToken).ConfigureAwait(false);

        var mods = new DirectoryAttributeModification[changes.Count];
        for (var i = 0; i < changes.Count; i++)
        {
            var change = changes[i];
            if (string.IsNullOrWhiteSpace(change.AttributeName))
                throw new ArgumentException($"changes[{i}].AttributeName is required.");

            var mod = new DirectoryAttributeModification
            {
                Name = change.AttributeName.Trim(),
                Operation = change.Operation switch
                {
                    AttributeChangeOperation.Add =>
                        System.DirectoryServices.Protocols.DirectoryAttributeOperation.Add,
                    AttributeChangeOperation.Delete =>
                        System.DirectoryServices.Protocols.DirectoryAttributeOperation.Delete,
                    _ => System.DirectoryServices.Protocols.DirectoryAttributeOperation.Replace,
                },
            };

            foreach (var value in change.Values ?? Array.Empty<object>())
            {
                if (value is null)
                    continue;
                if (value is byte[] bytes)
                    mod.Add(bytes);
                else
                    mod.Add(Convert.ToString(value) ?? string.Empty);
            }

            mods[i] = mod;
        }

        var request = new ModifyRequest(distinguishedName.Trim(), mods);
        await SendDirectoryAsync(request, cancellationToken).ConfigureAwait(false);
        _logger.LogInformation(
            "LDAP modify succeeded on {Dn} ({ChangeCount} change(s))",
            distinguishedName.Trim(),
            changes.Count);
    }

    public async Task ReplaceSecurityDescriptorAsync(
        string distinguishedName,
        byte[] securityDescriptorBytes,
        CancellationToken cancellationToken = default)
    {
        EnsureNotDisposed();
        if (string.IsNullOrWhiteSpace(distinguishedName))
            throw new ArgumentException("Distinguished name is required.", nameof(distinguishedName));
        if (securityDescriptorBytes is null || securityDescriptorBytes.Length < 20)
            throw new ArgumentException("Security descriptor bytes are required.", nameof(securityDescriptorBytes));

        await EnsureBoundAsync(cancellationToken).ConfigureAwait(false);

        var mod = new DirectoryAttributeModification
        {
            Name = "nTSecurityDescriptor",
            Operation = System.DirectoryServices.Protocols.DirectoryAttributeOperation.Replace,
        };
        mod.Add(securityDescriptorBytes);

        var request = new ModifyRequest(distinguishedName.Trim(), mod);
        // LDAP_SERVER_SD_FLAGS_OID — DACL (0x4) write. OWNER|GROUP|DACL = 0x07 is also accepted by DC.
        request.Controls.Add(new DirectoryControl(
            "1.2.840.113556.1.4.801",
            [0x30, 0x03, 0x02, 0x01, 0x07],
            isCritical: true,
            serverSide: true));

        await SendDirectoryAsync(request, cancellationToken).ConfigureAwait(false);
        _logger.LogInformation(
            "Replaced nTSecurityDescriptor on {Dn} ({ByteLength} bytes)",
            distinguishedName.Trim(),
            securityDescriptorBytes.Length);
    }

    public async Task DeleteObjectAsync(
        string distinguishedName,
        CancellationToken cancellationToken = default)
    {
        EnsureNotDisposed();
        if (string.IsNullOrWhiteSpace(distinguishedName))
            throw new ArgumentException("Distinguished name is required.", nameof(distinguishedName));

        await EnsureBoundAsync(cancellationToken).ConfigureAwait(false);
        var request = new DeleteRequest(distinguishedName.Trim());
        await SendDirectoryAsync(request, cancellationToken).ConfigureAwait(false);
        _logger.LogInformation("Deleted directory object {Dn}", distinguishedName.Trim());
    }

    private static DirectorySearchHit MapSearchHit(SearchResultEntry entry)
    {
        var dn = entry.DistinguishedName ?? string.Empty;
        var objectClass = GetLastStringAttr(entry, "objectClass");
        var objectType = ResolveObjectType(objectClass, dn);
        var name =
            GetFirstStringAttr(entry, "sAMAccountName")
            ?? GetFirstStringAttr(entry, "cn")
            ?? GetFirstStringAttr(entry, "name")
            ?? dn;

        var objectSid = string.Empty;
        var attrs = new Dictionary<string, IReadOnlyList<string>>(StringComparer.OrdinalIgnoreCase);
        var binaries = new Dictionary<string, byte[][]>(StringComparer.OrdinalIgnoreCase);

        foreach (string attrName in entry.Attributes.AttributeNames)
        {
            var attr = entry.Attributes[attrName];
            var strings = new List<string>(attr.Count);
            var bins = new List<byte[]>();
            for (var i = 0; i < attr.Count; i++)
            {
                var v = attr[i];
                if (v is byte[] bytes)
                {
                    bins.Add(bytes);
                    if (attrName.Equals("objectSid", StringComparison.OrdinalIgnoreCase) && bytes.Length > 0)
                        objectSid = SecurityDescriptorParser.ParseSid(bytes);
                    else if (attrName.Equals("sIDHistory", StringComparison.OrdinalIgnoreCase) && bytes.Length > 0)
                        strings.Add(SecurityDescriptorParser.ParseSid(bytes));
                    else
                        strings.Add(Convert.ToBase64String(bytes));
                }
                else
                {
                    strings.Add(Convert.ToString(v) ?? string.Empty);
                }
            }

            attrs[attrName] = strings;
            if (bins.Count > 0)
                binaries[attrName] = bins.ToArray();
        }

        return new DirectorySearchHit
        {
            DistinguishedName = dn,
            ObjectType = objectType,
            ObjectName = name,
            ObjectSid = NormalizeSid(objectSid),
            Attributes = attrs,
            BinaryAttributes = binaries,
        };
    }

    private static SecurableDirectoryObject MapSecurableEntry(SearchResultEntry entry)
    {
        var dn = entry.DistinguishedName ?? string.Empty;
        var objectClass = GetLastStringAttr(entry, "objectClass");
        var objectType = ResolveObjectType(objectClass, dn);
        var name =
            GetFirstStringAttr(entry, "sAMAccountName")
            ?? GetFirstStringAttr(entry, "cn")
            ?? GetFirstStringAttr(entry, "name")
            ?? dn;

        var objectSid = string.Empty;
        if (entry.Attributes.Contains("objectSid") && entry.Attributes["objectSid"].Count > 0)
        {
            if (entry.Attributes["objectSid"][0] is byte[] sidBytes)
                objectSid = SecurityDescriptorParser.ParseSid(sidBytes);
        }

        ParsedSecurityDescriptor? parsed = null;
        var descriptorFound = false;
        string? descriptorError = null;
        if (entry.Attributes.Contains("nTSecurityDescriptor") && entry.Attributes["nTSecurityDescriptor"].Count > 0)
        {
            var raw = entry.Attributes["nTSecurityDescriptor"][0];
            byte[]? bytes = raw as byte[] ?? (raw is string s ? Convert.FromBase64String(s) : null);
            if (bytes is { Length: > 0 })
            {
                descriptorFound = true;
                parsed = SecurityDescriptorParser.Parse(bytes, out descriptorError);
            }
        }

        return new SecurableDirectoryObject
        {
            DistinguishedName = dn,
            ObjectType = objectType,
            ObjectName = name,
            ObjectSid = NormalizeSid(objectSid),
            DescriptorFound = descriptorFound,
            ParsedSd = parsed,
            DescriptorError = descriptorError,
        };
    }

    private static string ResolveObjectType(string? objectClass, string dn)
    {
        var oc = (objectClass ?? string.Empty).ToLowerInvariant();
        if (oc.Contains("foreignsecurityprincipal") || dn.Contains("ForeignSecurityPrincipals", StringComparison.OrdinalIgnoreCase))
            return "foreign_security_principal";
        if (oc.Contains("group"))
            return "group";
        if (oc.Contains("user") || oc.Contains("person"))
            return "user";
        if (oc.Contains("computer"))
            return "computer";
        if (oc.Contains("organizationalunit"))
            return "organizationalUnit";
        return "object";
    }

    private static string? GetFirstStringAttr(SearchResultEntry entry, string name)
    {
        if (!entry.Attributes.Contains(name) || entry.Attributes[name].Count == 0)
            return null;
        var v = entry.Attributes[name][0];
        return v switch
        {
            string s when !string.IsNullOrWhiteSpace(s) => s,
            byte[] => null,
            _ => Convert.ToString(v),
        };
    }

    private static string? GetLastStringAttr(SearchResultEntry entry, string name)
    {
        if (!entry.Attributes.Contains(name) || entry.Attributes[name].Count == 0)
            return null;
        var attr = entry.Attributes[name];
        for (var i = attr.Count - 1; i >= 0; i--)
        {
            if (attr[i] is string s && !string.IsNullOrWhiteSpace(s))
                return s;
        }
        return null;
    }

    public static string NormalizeSid(string? sid)
    {
        var s = (sid ?? string.Empty).Trim();
        return string.IsNullOrEmpty(s) ? string.Empty : s.ToUpperInvariant();
    }

    /// <summary>Convert S-1-5-... string to binary SID (MS-DTYP).</summary>
    public static byte[]? SidStringToBytes(string sid)
    {
        var parts = sid.Split('-', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 3 || !parts[0].Equals("S", StringComparison.OrdinalIgnoreCase))
            return null;
        if (!byte.TryParse(parts[1], out var revision))
            return null;
        if (!ulong.TryParse(parts[2], out var authority))
            return null;

        var subAuthorities = new List<uint>();
        for (var i = 3; i < parts.Length; i++)
        {
            if (!uint.TryParse(parts[i], out var sub))
                return null;
            subAuthorities.Add(sub);
        }

        var buf = new byte[8 + subAuthorities.Count * 4];
        buf[0] = revision;
        buf[1] = (byte)subAuthorities.Count;
        buf[2] = (byte)((authority >> 40) & 0xFF);
        buf[3] = (byte)((authority >> 32) & 0xFF);
        buf[4] = (byte)((authority >> 24) & 0xFF);
        buf[5] = (byte)((authority >> 16) & 0xFF);
        buf[6] = (byte)((authority >> 8) & 0xFF);
        buf[7] = (byte)(authority & 0xFF);
        for (var i = 0; i < subAuthorities.Count; i++)
            BitConverter.GetBytes(subAuthorities[i]).CopyTo(buf, 8 + i * 4);
        return buf;
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

    private async Task<SearchResponse> SendSearchAsync(DirectoryRequest request, CancellationToken cancellationToken)
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

    private async Task SendDirectoryAsync(DirectoryRequest request, CancellationToken cancellationToken)
    {
        if (_connection is null)
            throw new InvalidOperationException("LDAP connection is not established.");

        cancellationToken.ThrowIfCancellationRequested();

        await Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                _connection.SendRequest(request);
            },
            cancellationToken).ConfigureAwait(false);
    }

    private async Task<SearchResponse> SendRequestAsync(DirectoryRequest request, CancellationToken cancellationToken)
        => await SendSearchAsync(request, cancellationToken).ConfigureAwait(false);

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
