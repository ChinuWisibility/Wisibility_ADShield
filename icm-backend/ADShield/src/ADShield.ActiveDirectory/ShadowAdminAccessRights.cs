namespace ADShield.ActiveDirectory;

/// <summary>
/// Shadow-admin dangerous access masks — parity with IdentitySphere aceConstants.js.
/// </summary>
public static class ShadowAdminAccessRights
{
    public const uint GenericAll = 0x10000000;
    public const uint GenericWrite = 0x40000000;
    public const uint WriteDac = 0x00040000;
    public const uint WriteOwner = 0x00080000;

    public const uint ShadowAdminMask =
        GenericAll | GenericWrite | WriteDac | WriteOwner;

    /// <summary>Labels match Node DANGEROUS_RIGHT_LABELS (WriteDACL casing).</summary>
    private static readonly (uint Bit, string Label)[] Labels =
    [
        (GenericAll, "GenericAll"),
        (GenericWrite, "GenericWrite"),
        (WriteDac, "WriteDACL"),
        (WriteOwner, "WriteOwner"),
    ];

    public static bool HasShadowAdminRights(uint accessMask) =>
        (accessMask & ShadowAdminMask) != 0;

    public static IReadOnlyList<string> DescribeDangerousRights(uint accessMask)
    {
        var labels = new List<string>(4);
        foreach (var (bit, label) in Labels)
        {
            if ((accessMask & bit) != 0)
                labels.Add(label);
        }
        return labels;
    }
}
