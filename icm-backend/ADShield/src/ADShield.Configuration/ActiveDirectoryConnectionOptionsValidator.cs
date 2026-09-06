namespace ADShield.Configuration;

public static class ActiveDirectoryConnectionOptionsValidator
{
    public static IReadOnlyList<string> Validate(ActiveDirectoryConnectionOptions? options)
    {
        var errors = new List<string>();
        if (options is null)
        {
            errors.Add("Connection options are required.");
            return errors;
        }

        options.EnsureNormalized();

        if (string.IsNullOrWhiteSpace(options.Host) && string.IsNullOrWhiteSpace(options.Url))
            errors.Add("Host or Url is required.");
        else if (string.IsNullOrWhiteSpace(options.Host))
            errors.Add("Host could not be resolved from Url.");

        if (options.Port is < 1 or > 65535)
            errors.Add("Port must be between 1 and 65535.");

        if (string.IsNullOrWhiteSpace(options.BindDn))
            errors.Add("BindDn is required.");

        if (string.IsNullOrWhiteSpace(options.BindPassword))
            errors.Add("BindPassword is required.");

        if (string.IsNullOrWhiteSpace(options.BaseDn))
            errors.Add("BaseDn is required.");

        if (options.TimeoutMs is < 1000 or > 600_000)
            errors.Add("TimeoutMs must be between 1000 and 600000.");

        if (options.UseSsl && options.UseStartTls)
            errors.Add("UseSsl and UseStartTls cannot both be true.");

        return errors;
    }
}
