using ADShield.Application.Services;
using ADShield.Models;
using Microsoft.AspNetCore.Mvc;

namespace ADShield.Api.Controllers;

[ApiController]
[Route("api/v1/security")]
public sealed class AclAnalysisController : ControllerBase
{
    private readonly IAclAnalysisService _aclAnalysisService;
    private readonly ILogger<AclAnalysisController> _logger;
    private readonly IConfiguration _configuration;

    public AclAnalysisController(
        IAclAnalysisService aclAnalysisService,
        ILogger<AclAnalysisController> logger,
        IConfiguration configuration)
    {
        _aclAnalysisService = aclAnalysisService;
        _logger = logger;
        _configuration = configuration;
    }

    /// <summary>
    /// Live ACL / security-descriptor analysis for IdentitySphere.
    /// Credentials are request-scoped and never persisted.
    /// </summary>
    [HttpPost("acl-analysis")]
    [ProducesResponseType(typeof(AclAnalysisResult), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(AclAnalysisResult), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(AclAnalysisResult), StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<AclAnalysisResult>> Analyze(
        [FromBody] AclAnalysisRequest request,
        CancellationToken cancellationToken)
    {
        if (!ValidateApiKey())
        {
            return Unauthorized(new AclAnalysisResult
            {
                Success = false,
                Errors = ["Invalid or missing X-ADShield-Key."],
            });
        }

        if (request is null)
        {
            return BadRequest(new AclAnalysisResult
            {
                Success = false,
                Errors = ["Request body is required."],
            });
        }

        _logger.LogInformation(
            "ACL analysis requested for endpoint {Endpoint}; features={Features}",
            request.Connection?.EndpointDisplay ?? "(unspecified)",
            string.Join(",", request.Features ?? Array.Empty<string>()));

        var result = await _aclAnalysisService
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
            return true; // auth optional when unset (matches Node client)

        if (!Request.Headers.TryGetValue("X-ADShield-Key", out var provided))
            return false;
        return string.Equals(provided.ToString(), expected.Trim(), StringComparison.Ordinal);
    }
}
