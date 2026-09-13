import {
  fingerprintConfiguration,
  normalizeConfiguration,
  resolveExecutionConfigFromSnapshot,
  versionToApi,
} from "./assessmentVersionService.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const a = normalizeConfiguration({
    features: [
      { featureKey: "disabled_users", enabled: true, implemented: true, ldapFilter: "(x=1)" },
      { featureKey: "inactive_users", enabled: false, implemented: true },
    ],
  });
  const b = normalizeConfiguration({
    features: [
      { featureKey: "disabled_users", enabled: true, implemented: true, ldapFilter: "(x=1)" },
      { featureKey: "inactive_users", enabled: false, implemented: true },
    ],
  });
  assert(a.contentFingerprint === b.contentFingerprint, "identical configs must match");

  const c = normalizeConfiguration({
    features: [
      { featureKey: "disabled_users", enabled: true, implemented: true, ldapFilter: "(x=2)" },
    ],
  });
  assert(a.contentFingerprint !== c.contentFingerprint, "changed filter must differ");

  // Stale enabledMap must not hide a tile enable toggle (regression: Reused Version).
  const staleMap = normalizeConfiguration({
    features: [
      { featureKey: "disabled_users", enabled: true, implemented: true },
      { featureKey: "password_never_expires", enabled: true, implemented: true },
    ],
    enabledMap: {
      disabled_users: true,
      password_never_expires: false,
    },
  });
  assert(
    staleMap.enabledMap.password_never_expires === true,
    "tile enabled must win over stale enabledMap",
  );
  const beforeToggle = normalizeConfiguration({
    features: [
      { featureKey: "disabled_users", enabled: true, implemented: true },
      { featureKey: "password_never_expires", enabled: false, implemented: true },
    ],
    enabledMap: {
      disabled_users: true,
      password_never_expires: false,
    },
  });
  assert(
    staleMap.contentFingerprint !== beforeToggle.contentFingerprint,
    "enabling a feature via tile must change fingerprint",
  );
  const exec = resolveExecutionConfigFromSnapshot(staleMap);
  assert(
    exec.features.includes("password_never_expires"),
    "execution must include newly enabled tile feature",
  );

  // Opt-in assessments: all tiles disabled → execute nothing.
  const allOff = normalizeConfiguration({
    features: [
      { featureKey: "disabled_users", enabled: false, implemented: true },
      { featureKey: "inactive_users", enabled: false, implemented: true },
      { featureKey: "locked_accounts", enabled: false, implemented: true },
    ],
  });
  assert(
    Object.values(allOff.enabledMap).every((v) => !v),
    "forceAllDisabled seed shape must yield no enabled features",
  );
  assert(
    resolveExecutionConfigFromSnapshot(allOff).features.length === 0,
    "all-disabled config must execute zero features",
  );

  const cfg = resolveExecutionConfigFromSnapshot(a);
  assert(cfg.features.includes("disabled_users"), "enabled feature missing");
  assert(!cfg.features.includes("inactive_users"), "disabled feature should be excluded");

  const legacy = versionToApi({
    _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    assessmentId: "bbbbbbbbbbbbbbbbbbbbbbbb",
    applicationId: "cccccccccccccccccccccccc",
    versionNumber: 0,
    configSnapshot: a,
    contentFingerprint: a.contentFingerprint,
  });
  assert(legacy.versionNumber === 0, "version 0 mapping");
  assert(fingerprintConfiguration(a) === a.contentFingerprint, "fingerprint helper");

  console.log("assessmentVersionService.test.js: PASS");
}

run();
