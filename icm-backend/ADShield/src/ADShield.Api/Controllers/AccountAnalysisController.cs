using ADShield.Application.Services;
using ADShield.Models;
using Microsoft.AspNetCore.Mvc;

namespace ADShield.Api.Controllers;

[ApiController]
[Route("api/v1/security")]
public sealed class AccountAnalysisController : ControllerBase
{
    private readonly IAccountAnalysisService _accountAnalysisService;
    private readonly ILogger<AccountAnalysisController> _logger;
    private readonly IConfiguration _configuration;

    public AccountAnalysisController(
        IAccountAnalysisService accountAnalysisService,
        ILogger<AccountAnalysisController> logger,
        IConfiguration configuration)
    {
        _accountAnalysisService = accountAnalysisService;
        _logger = logger;
        _configuration = configuration;
    }

    /// <summary>
    /// Live user-account Security Posture analysis for IdentitySphere.
    /// Credentials are request-scoped and never persisted.
    /// </summary>
    [HttpPost("account-analysis")]
    [ProducesResponseType(typeof(AccountAnalysisResult), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(AccountAnalysisResult), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(AccountAnalysisResult), StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<AccountAnalysisResult>> Analyze(
        [FromBody] AccountAnalysisRequest request,
        CancellationToken cancellationToken)
    {
        if (!ValidateApiKey())
        {
            return Unauthorized(new AccountAnalysisResult
            {
                Success = false,
                Errors = ["Invalid or missing X-ADShield-Key."],
            });
        }

        if (request is null)
        {
            return BadRequest(new AccountAnalysisResult
            {
                Success = false,
                Errors = ["Request body is required."],
            });
        }

        _logger.LogInformation(
            "Account analysis requested for endpoint {Endpoint}; features={Features}",
            request.Connection?.EndpointDisplay ?? "(unspecified)",
            string.Join(",", request.Features ?? Array.Empty<string>()));

        var result = await _accountAnalysisService
            .AnalyzeAsync(request, cancellationToken)
            .ConfigureAwait(false);

        if (!result.Success && result.Errors.Count > 0
            && result.Errors.Any(e =>
                e.Contains("required", StringComparison.OrdinalIgnoreCase)
                || e.Contains("No supported", StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(result);
        }

        return Ok(result);
    }

    private bool ValidateApiKey()
    {
        var expected = _configuration["ADShield:ApiKey"]
                       ?? Environment.GetEnvironmentVariable("ADSHIELD_API_KEY");
        if (string.IsNullOrWhiteSpace(expected))
            return true;

        if (!Request.Headers.TryGetValue("X-ADShield-Key", out var provided))
            return false;
        return string.Equals(provided.ToString(), expected.Trim(), StringComparison.Ordinal);
    }
}
