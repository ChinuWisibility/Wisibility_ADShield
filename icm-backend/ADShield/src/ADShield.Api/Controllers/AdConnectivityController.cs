using ADShield.Application.Services;
using ADShield.Models;
using Microsoft.AspNetCore.Mvc;

namespace ADShield.Api.Controllers;

[ApiController]
[Route("api/v1/ad")]
public sealed class AdConnectivityController : ControllerBase
{
    private readonly IConnectivityTestService _connectivityTestService;
    private readonly ILogger<AdConnectivityController> _logger;

    public AdConnectivityController(
        IConnectivityTestService connectivityTestService,
        ILogger<AdConnectivityController> logger)
    {
        _connectivityTestService = connectivityTestService;
        _logger = logger;
    }

    /// <summary>
    /// Probes AD connectivity using runtime-supplied connection options.
    /// Does not persist credentials.
    /// </summary>
    [HttpPost("connectivity-test")]
    [ProducesResponseType(typeof(ConnectivityTestResult), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ConnectivityTestResult), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ConnectivityTestResult>> ConnectivityTest(
        [FromBody] ConnectivityTestRequest request,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new ConnectivityTestResult
            {
                Success = false,
                Errors = ["Request body is required."],
            });
        }

        _logger.LogInformation(
            "Connectivity test requested for endpoint {Endpoint}",
            request.Connection?.EndpointDisplay ?? "(unspecified)");

        var result = await _connectivityTestService
            .TestAsync(request, cancellationToken)
            .ConfigureAwait(false);

        // Always return the structured diagnostics body; Success indicates probe outcome.
        if (!result.Success && !result.BindSucceeded && result.Errors.Count > 0
            && result.Errors.Any(e => e.Contains("required", StringComparison.OrdinalIgnoreCase)
                                      || e.Contains("must be", StringComparison.OrdinalIgnoreCase)
                                      || e.Contains("cannot both", StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(result);
        }

        return Ok(result);
    }
}
