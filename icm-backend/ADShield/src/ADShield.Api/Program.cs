using ADShield.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.AddDebug();

builder.Services.AddControllers()
    .ConfigureApiBehaviorOptions(options =>
    {
        // Prefer ADShield structured ConnectivityTestResult over ProblemDetails for this API.
        options.SuppressModelStateInvalidFilter = true;
    })
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        options.JsonSerializerOptions.DefaultIgnoreCondition =
            System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
        options.JsonSerializerOptions.Converters.Add(
            new System.Text.Json.Serialization.JsonStringEnumConverter(
                System.Text.Json.JsonNamingPolicy.CamelCase,
                allowIntegerValues: true));
    });

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new()
    {
        Title = "ADShield API",
        Version = "v1",
        Description = "Standalone Active Directory security engine foundation. " +
                      "AD endpoints and credentials are supplied at runtime per request.",
    });
});

builder.Services.AddAdShieldCore();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.MapControllers();

app.Logger.LogInformation("ADShield API starting. AD credentials are never hardcoded; supply them per request.");

app.Run();

public partial class Program;
