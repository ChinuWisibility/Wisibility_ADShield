using System.Diagnostics;
using ADShield.ActiveDirectory;
using ADShield.Configuration;
using ADShield.Models;
using Microsoft.Extensions.Logging;

namespace ADShield.Application.Services;

public interface IConnectivityTestService
{
    Task<ConnectivityTestResult> TestAsync(
        ConnectivityTestRequest request,
        CancellationToken cancellationToken = default);
}

public sealed class ConnectivityTestService : IConnectivityTestService
{
    private readonly IActiveDirectoryClientFactory _clientFactory;
    private readonly ILogger<ConnectivityTestService> _logger;

    public ConnectivityTestService(
        IActiveDirectoryClientFactory clientFactory,
        ILogger<ConnectivityTestService> logger)
    {
        _clientFactory = clientFactory;
        _logger = logger;
    }

    public async Task<ConnectivityTestResult> TestAsync(
        ConnectivityTestRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var sw = Stopwatch.StartNew();
        var errors = new List<string>();
        var connection = request.Connection ?? new ActiveDirectoryConnectionOptions();
        connection.EnsureNormalized();
        var endpoint = connection.EndpointDisplay;

        var validation = ActiveDirectoryConnectionOptionsValidator.Validate(connection);
        if (validation.Count > 0)
        {
            return new ConnectivityTestResult
            {
                Success = false,
                Endpoint = endpoint,
                BindSucceeded = false,
                ObjectReadSucceeded = false,
                SecurityDescriptorReadSucceeded = false,
                SecurityDescriptorDecodeSucceeded = false,
                ElapsedMs = sw.ElapsedMilliseconds,
                Errors = validation.ToList(),
            };
        }

        var objectDn = string.IsNullOrWhiteSpace(request.ObjectDn)
            ? connection.EffectiveSearchBaseDn
            : request.ObjectDn.Trim();

        var bindSucceeded = false;
        var objectReadSucceeded = false;
        var sdReadSucceeded = false;
        var sdDecodeSucceeded = false;
        int? sdBytes = null;
        string? ownerSid = null;
        string? groupSid = null;
        IReadOnlyList<AceInfo> aces = Array.Empty<AceInfo>();
        DirectoryObjectResult? directoryObject = null;

        try
        {
            await using var client = _clientFactory.Create(connection);

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromMilliseconds(connection.TimeoutMs));
            var ct = timeoutCts.Token;

            try
            {
                await client.TestConnectionAsync(ct).ConfigureAwait(false);
                bindSucceeded = true;
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                errors.Add($"Bind timed out after {connection.TimeoutMs} ms.");
            }
            catch (Exception ex)
            {
                errors.Add(SanitizeExceptionMessage(ex, "Bind failed"));
                _logger.LogWarning(ex, "AD bind failed for {Endpoint}", endpoint);
            }

            if (bindSucceeded)
            {
                try
                {
                    var obj = await client.ReadObjectAsync(objectDn, cancellationToken: ct).ConfigureAwait(false);
                    if (obj is null)
                    {
                        errors.Add($"Object not found: {objectDn}");
                    }
                    else
                    {
                        objectReadSucceeded = true;
                        objectDn = obj.DistinguishedName;
                        directoryObject = obj;
                    }
                }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                {
                    errors.Add($"Object read timed out after {connection.TimeoutMs} ms.");
                }
                catch (Exception ex)
                {
                    errors.Add(SanitizeExceptionMessage(ex, "Object read failed"));
                    _logger.LogWarning(ex, "AD object read failed for {ObjectDn} on {Endpoint}", objectDn, endpoint);
                }

                if (request.ReadSecurityDescriptor && objectReadSucceeded)
                {
                    try
                    {
                        var sd = await client.ReadSecurityDescriptorAsync(objectDn, ct).ConfigureAwait(false);
                        if (!sd.Found)
                        {
                            errors.Add("nTSecurityDescriptor attribute was not returned (insufficient rights or not present).");
                        }
                        else
                        {
                            sdReadSucceeded = true;
                            sdBytes = sd.ByteLength;
                            if (sd.DecodeSucceeded && sd.Parsed is not null)
                            {
                                sdDecodeSucceeded = true;
                                ownerSid = sd.Parsed.OwnerSid;
                                groupSid = sd.Parsed.GroupSid;
                                aces = sd.Parsed.Aces;
                            }
                            else
                            {
                                errors.Add(sd.DecodeError ?? "Security descriptor decode failed.");
                            }
                        }
                    }
                    catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                    {
                        errors.Add($"Security descriptor read timed out after {connection.TimeoutMs} ms.");
                    }
                    catch (Exception ex)
                    {
                        errors.Add(SanitizeExceptionMessage(ex, "Security descriptor read failed"));
                        _logger.LogWarning(ex, "AD security descriptor read failed for {ObjectDn}", objectDn);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            errors.Add(SanitizeExceptionMessage(ex, "Connectivity test failed"));
            _logger.LogError(ex, "Unexpected failure during connectivity test for {Endpoint}", endpoint);
        }

        sw.Stop();

        var success = bindSucceeded
                      && objectReadSucceeded
                      && (!request.ReadSecurityDescriptor || (sdReadSucceeded && sdDecodeSucceeded));

        return new ConnectivityTestResult
        {
            Success = success,
            Endpoint = endpoint,
            BindSucceeded = bindSucceeded,
            ObjectReadSucceeded = objectReadSucceeded,
            SecurityDescriptorReadSucceeded = sdReadSucceeded,
            SecurityDescriptorDecodeSucceeded = sdDecodeSucceeded,
            ElapsedMs = sw.ElapsedMilliseconds,
            Errors = errors,
            ObjectDn = objectDn,
            SecurityDescriptorByteLength = sdBytes,
            OwnerSid = ownerSid,
            GroupSid = groupSid,
            AceCount = aces.Count,
            Aces = aces,
            Object = directoryObject,
        };
    }

    private static string SanitizeExceptionMessage(Exception ex, string prefix)
    {
        var message = ex.Message ?? ex.GetType().Name;
        message = System.Text.RegularExpressions.Regex.Replace(
            message,
            @"(password|pwd|passwd|secret)\s*=\s*\S+",
            "$1=***",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        return $"{prefix}: {message}";
    }
}
