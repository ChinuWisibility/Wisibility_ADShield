using ADShield.Configuration;

namespace ADShield.Models;

/// <summary>
/// Request body for POST /api/v1/ad/connectivity-test.
/// All AD settings are supplied at runtime.
/// </summary>
public sealed class ConnectivityTestRequest
{
    public ActiveDirectoryConnectionOptions Connection { get; set; } = new();

    /// <summary>
    /// Optional DN to read after bind. Defaults to BaseDn / SearchBaseDn.
    /// </summary>
    public string? ObjectDn { get; set; }

    /// <summary>
    /// When true (default), attempt to read nTSecurityDescriptor on the object.
    /// </summary>
    public bool ReadSecurityDescriptor { get; set; } = true;
}
