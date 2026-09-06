using ADShield.ActiveDirectory;
using ADShield.Application.Services;
using Microsoft.Extensions.DependencyInjection;

namespace ADShield.Infrastructure;

public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Registers ADShield application and Active Directory services.
    /// </summary>
    public static IServiceCollection AddAdShieldCore(this IServiceCollection services)
    {
        services.AddSingleton<IActiveDirectoryClientFactory, LdapActiveDirectoryClientFactory>();
        services.AddScoped<IConnectivityTestService, ConnectivityTestService>();
        return services;
    }
}
