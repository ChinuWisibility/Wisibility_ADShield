using Microsoft.AspNetCore.Mvc;

namespace ADShield.Api.Controllers;

[ApiController]
[Route("health")]
public sealed class HealthController : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult Get()
    {
        return Ok(new
        {
            status = "Healthy",
            service = "ADShield",
            utc = DateTime.UtcNow,
        });
    }
}
