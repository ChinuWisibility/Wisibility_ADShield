using ADShield.Configuration;
using ADShield.Models;

namespace ADShield.ActiveDirectory;

/// <summary>
/// Abstraction over Active Directory / LDAP access.
/// Implementations must use explicit runtime connection options (no domain join required).
/// </summary>
public interface IActiveDirectoryClient : IAsyncDisposable
{
    /// <summary>
    /// Opens a connection and performs an explicit bind. Throws on failure.
    /// </summary>
    Task TestConnectionAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads a single object by distinguished name.
    /// </summary>
    Task<DirectoryObjectResult?> ReadObjectAsync(
        string distinguishedName,
        IReadOnlyList<string>? attributes = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads user objects under the effective search base. Not implemented in this foundation slice.
    /// </summary>
    Task<IReadOnlyList<DirectoryObjectResult>> ReadUsersAsync(
        string? ldapFilter = null,
        int? maxResults = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads group objects under the effective search base. Not implemented in this foundation slice.
    /// </summary>
    Task<IReadOnlyList<DirectoryObjectResult>> ReadGroupsAsync(
        string? ldapFilter = null,
        int? maxResults = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads the binary nTSecurityDescriptor for an object.
    /// </summary>
    Task<SecurityDescriptorResult> ReadSecurityDescriptorAsync(
        string distinguishedName,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Creates short-lived AD clients from runtime connection options.
/// </summary>
public interface IActiveDirectoryClientFactory
{
    IActiveDirectoryClient Create(ActiveDirectoryConnectionOptions options);
}
