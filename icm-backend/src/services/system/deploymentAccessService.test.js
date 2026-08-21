import { normalizeDeploymentAccess } from "./deploymentAccessService.js";

describe("deployment access settings", () => {
  const previous = {
    smtp: {
      host: "smtp.old.example",
      port: 465,
      user: "mailer",
      pass: "existing-secret",
      secure: true,
    },
  };

  test("derives a single CORS origin from the public URL", () => {
    const result = normalizeDeploymentAccess(
      {
        mode: "internal",
        publicUrl: "https://iga.example.com/app/",
        iamTeamEmail: "iam@example.com",
        smtp: { port: 587, secure: false },
      },
      previous,
    );

    expect(result.publicUrl).toBe("https://iga.example.com/app");
    expect(result.allowedOrigins).toEqual([
      "https://iga.example.com",
      "http://127.0.0.1:8081",
      "http://localhost:8081",
    ]);
    expect(result.iamTeamEmail).toBe("iam@example.com");
    expect(result.smtp.pass).toBe("existing-secret");
  });

  test("requires HTTPS for internet deployments", () => {
    expect(() =>
      normalizeDeploymentAccess(
        {
          mode: "public",
          publicUrl: "http://iga.example.com",
          smtp: { port: 465 },
        },
        previous,
      ),
    ).toThrow("Public internet access requires an HTTPS application URL");
  });

  test("rejects invalid IAM team email", () => {
    expect(() =>
      normalizeDeploymentAccess(
        {
          mode: "internal",
          publicUrl: "https://iga.example.com",
          iamTeamEmail: "not-an-email",
          smtp: { port: 465 },
        },
        previous,
      ),
    ).toThrow("IAM team email must be a valid email address");
  });
});
