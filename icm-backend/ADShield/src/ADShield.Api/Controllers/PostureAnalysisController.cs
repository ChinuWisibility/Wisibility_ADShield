using ADShield.Application.Services;
using ADShield.Models;
using Microsoft.AspNetCore.Mvc;

namespace ADShield.Api.Controllers;

[ApiController]
[Route("api/v1/security")]
public sealed class PostureAnalysisController : ControllerBase
{
    private readonly IPostureAnalysisService _postureAnalysisService;
    private readonly ILogger<PostureAnalysisController> _logger;
    private readonly IConfiguration _configuration;

    public PostureAnalysisController(
        IPostureAnalysisService postureAnalysisService,
        ILogger<PostureAnalysisController> logger,
        IConfiguration configuration)
    {
        _postureAnalysisService = postureAnalysisService;
        _logger = logger;
        _configuration = configuration;
    }

    /// <summary>
    /// Live Security Posture analysis for IdentitySphere
    /// (groups, privileged, computers, kerberos, delegation).
    /// Credentials are request-scoped and never persisted.
    /// </summary>
    [HttpPost("posture-analysis")]
    [ProducesResponseType(typeof(PostureAnalysisResult), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(PostureAnalysisResult), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(PostureAnalysisResult), StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<PostureAnalysisResult>> Analyze(
        [FromBody] PostureAnalysisRequest request,
        CancellationToken cancellationToken)
    {
        if (!ValidateApiKey())
        {
            return Unauthorized(new PostureAnalysisResult
            {
                Success = false,
                Errors = ["Invalid or missing X-ADShield-Key."],
            });
        }

        if (request is null)
        {
            return BadRequest(new PostureAnalysisResult
            {
                Success = false,
                Errors = ["Request body is required."],
            });
        }

        _logger.LogInformation(
            "Posture analysis requested for endpoint {Endpoint}; features={Features}",
            request.Connection?.EndpointDisplay ?? "(unspecified)",
            string.Join(",", request.Features ?? Array.Empty<string>()));

        var result = await _postureAnalysisService
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
