import {
  isMaintenanceEnforced,
  isMaintenanceForcedOff,
  normalizePlatformSettings,
} from "./platformSettingsService.js";

describe("platform settings", () => {
  test("normalizes operational settings", () => {
    expect(
      normalizePlatformSettings({
        sessionTimeoutMinutes: 60,
        maintenanceMode: true,
        maintenanceMessage: "Upgrading ADSecurity",
        supportEmail: "Support@Example.com",
        auditRetentionDays: 730,
      }),
    ).toEqual({
      sessionTimeoutMinutes: 60,
      maintenanceMode: true,
      maintenanceMessage: "Upgrading ADSecurity",
      supportEmail: "support@example.com",
      auditRetentionDays: 730,
    });
  });

  test("rejects unsafe timeout and retention values", () => {
    expect(() =>
      normalizePlatformSettings({ sessionTimeoutMinutes: 5 }),
    ).toThrow("Session timeout must be between 15 and 1440");

    expect(() =>
      normalizePlatformSettings({ auditRetentionDays: 10 }),
    ).toThrow("Audit retention days must be between 30 and 3650");
  });

  test("validates support email", () => {
    expect(() =>
      normalizePlatformSettings({ supportEmail: "not-an-email" }),
    ).toThrow("Support email must be a valid email address");
  });

  describe("maintenance enforcement outside production", () => {
    const original = process.env.MAINTENANCE_MODE_ENFORCE;
    const originalForceOff = process.env.MAINTENANCE_MODE_FORCE_OFF;

    afterEach(() => {
      if (original === undefined) delete process.env.MAINTENANCE_MODE_ENFORCE;
      else process.env.MAINTENANCE_MODE_ENFORCE = original;
      if (originalForceOff === undefined) {
        delete process.env.MAINTENANCE_MODE_FORCE_OFF;
      } else {
        process.env.MAINTENANCE_MODE_FORCE_OFF = originalForceOff;
      }
    });

    test("stays dormant so development cannot be locked out", () => {
      delete process.env.MAINTENANCE_MODE_ENFORCE;
      expect(isMaintenanceEnforced()).toBe(false);
    });

    test("can be opted into for local testing", () => {
      process.env.MAINTENANCE_MODE_ENFORCE = "true";
      expect(isMaintenanceEnforced()).toBe(true);
    });

    test("break-glass override disables enforcement", () => {
      process.env.MAINTENANCE_MODE_ENFORCE = "true";
      process.env.MAINTENANCE_MODE_FORCE_OFF = "true";
      expect(isMaintenanceForcedOff()).toBe(true);
      expect(isMaintenanceEnforced()).toBe(false);
    });
  });
});
