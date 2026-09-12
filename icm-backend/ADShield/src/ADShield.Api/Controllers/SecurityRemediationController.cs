using ADShield.Application.Services;
using ADShield.Models;
using Microsoft.AspNetCore.Mvc;

namespace ADShield.Api.Controllers;

[ApiController]
[Route("api/v1/security")]
public sealed class SecurityRemediationController : ControllerBase
{
    private readonly ISecurityRemediationService _remediationService;
    private readonly ILogger<SecurityRemediationController> _logger;
    private readonly IConfiguration _configuration;

    public SecurityRemediationController(
        ISecurityRemediationService remediationService,
        ILogger<SecurityRemediationController> logger,
        IConfiguration configuration)
    {
        _remediationService = remediationService;
        _logger = logger;
        _configuration = configuration;
    }

    /// <summary>
    /// Feature catalog: which of the 41 anomalies are implemented in ADShield (.NET).
    /// </summary>
    [HttpGet("features")]
    [ProducesResponseType(typeof(object), StatusCodes.Status200OK)]
    public ActionResult<object> Features()
    {
        if (!ValidateApiKey())
            return Unauthorized(new { success = false, errors = new[] { "Invalid or missing X-ADShield-Key." } });

        var all = SecurityFeatureCatalog.All;
        return Ok(new
        {
            success = true,
            total = all.Count,
            implementedCount = all.Count(f => f.Implemented),
            remediationCount = all.Count(f => f.RemediationSupported),
            features = all.Select(f => new
            {
                f.Id,
                f.Name,
                area = f.Area.ToString(),
                f.Implemented,
                f.RemediationSupported,
                f.RequestAliases,
            }),
            remediationActions = SecurityRemediationService.SupportedActions,
        });
    }

    /// <summary>
    /// Explicit AD write remediation. Requires exact TargetDn + action Type.
    /// Credentials are request-scoped and never persisted.
    /// </summary>
    [HttpPost("remediate")]
    [ProducesResponseType(typeof(SecurityRemediationResult), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(SecurityRemediationResult), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(SecurityRemediationResult), StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<SecurityRemediationResult>> Remediate(
        [FromBody] SecurityRemediationRequest request,
        CancellationToken cancellationToken)
    {
        if (!ValidateApiKey())
        {
            return Unauthorized(new SecurityRemediationResult
            {
                Success = false,
                Errors = ["Invalid or missing X-ADShield-Key."],
            });
        }

        if (request is null)
        {
            return BadRequest(new SecurityRemediationResult
            {
                Success = false,
                Errors = ["Request body is required."],
            });
        }

        _logger.LogInformation(
            "Remediation requested action={Action} dryRun={DryRun} endpoint={Endpoint}",
            request.Action?.Type,
            request.DryRun,
            request.Connection?.EndpointDisplay ?? "(unspecified)");

        var result = await _remediationService
            .RemediateAsync(request, cancellationToken)
            .ConfigureAwait(false);

        if (!result.Success
            && result.Errors.Any(e =>
                e.Contains("required", StringComparison.OrdinalIgnoreCase)
                || e.Contains("Unsupported", StringComparison.OrdinalIgnoreCase)
                || e.Contains("Refusing", StringComparison.OrdinalIgnoreCase)))
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
