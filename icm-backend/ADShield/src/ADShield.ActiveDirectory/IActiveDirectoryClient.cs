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

    /// <summary>
    /// Enumerates securable objects (users/groups by default) with security descriptors under a search base.
    /// </summary>
    Task<IReadOnlyList<SecurableDirectoryObject>> SearchSecurableObjectsAsync(
        string searchBaseDn,
        string ldapFilter,
        SearchScopeKind scope,
        int maxResults,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Resolves a SID string to a directory object DN when present in the directory.
    /// Prefer <see cref="LookupPrincipalBySidAsync"/> for richer results.
    /// </summary>
    Task<string?> ResolveSidAsync(
        string sidString,
        string searchBaseDn,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Targeted LDAP lookup by binary objectSid under <paramref name="searchBaseDn"/> (typically domain base DN).
    /// Independent of ACL object enumeration / maxObjects.
    /// </summary>
    Task<SidLookupResult?> LookupPrincipalBySidAsync(
        string sidString,
        string searchBaseDn,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Paged LDAP search returning requested attributes. Search base, filter, and scope are caller-supplied.
    /// </summary>
    Task<IReadOnlyList<DirectorySearchHit>> SearchAsync(
        string searchBaseDn,
        string ldapFilter,
        SearchScopeKind scope,
        IReadOnlyList<string> attributes,
        int maxResults,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Applies attribute modifications (add/delete/replace). Never logs attribute values.
    /// </summary>
    Task ModifyAttributesAsync(
        string distinguishedName,
        IReadOnlyList<DirectoryAttributeChange> changes,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces nTSecurityDescriptor with a self-relative SECURITY_DESCRIPTOR blob.
    /// Uses LDAP_SERVER_SD_FLAGS_OID for DACL write.
    /// </summary>
    Task ReplaceSecurityDescriptorAsync(
        string distinguishedName,
        byte[] securityDescriptorBytes,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes a leaf object (e.g. foreignSecurityPrincipal). Fails if the object has children.
    /// </summary>
    Task DeleteObjectAsync(
        string distinguishedName,
        CancellationToken cancellationToken = default);
}

public enum SearchScopeKind
{
    Base = 0,
    OneLevel = 1,
    Subtree = 2,
}

/// <summary>
/// Creates short-lived AD clients from runtime connection options.
/// </summary>
public interface IActiveDirectoryClientFactory
{
    IActiveDirectoryClient Create(ActiveDirectoryConnectionOptions options);
}
